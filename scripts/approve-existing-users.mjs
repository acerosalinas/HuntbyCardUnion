// One-time step for turning on approval-only sign-ups: marks every account that exists today as approved, so nobody
// who already has an account gets locked out. Accounts created after this need an admin to approve them.
// Safe to re-run (accounts already approved, and admin accounts, are skipped).
//
// Usage:
//   node scripts/approve-existing-users.mjs --dry-run   (show who would be approved, change nothing)
//   node scripts/approve-existing-users.mjs             (do it)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

let envText = "";
try {
  envText = readFileSync("./.env.local", "utf8");
} catch {
  // values may come from the environment instead
}
const env = {};
for (const rawLine of envText.split("\n")) {
  const line = rawLine.replace(/\r$/, "");
  const eq = line.indexOf("=");
  if (eq === -1 || line.startsWith("#")) continue;
  env[line.slice(0, eq)] = line.slice(eq + 1).trim();
}
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) env[k] ??= process.env[k];

const dryRun = process.argv.includes("--dry-run");
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error(error.message);
  users.push(...data.users);
  if (data.users.length < 1000) break;
}

let admins = 0;
let already = 0;
const todo = [];
for (const u of users) {
  const role = u.app_metadata?.role;
  if (role === "ADMIN" || role === "SUPER_ADMIN") admins++;
  else if (u.app_metadata?.approved === true) already++;
  else todo.push(u);
}
console.log(`${users.length} accounts: ${admins} admins, ${already} already approved, ${todo.length} to approve${dryRun ? " (dry run)" : ""}.`);
for (const u of todo.slice(0, 50)) console.log(`  ${u.email ?? u.id}`);

if (!dryRun) {
  let done = 0;
  for (const u of todo) {
    const { error } = await supabase.auth.admin.updateUserById(u.id, { app_metadata: { ...u.app_metadata, approved: true } });
    if (error) console.error(`Failed for ${u.email ?? u.id}: ${error.message}`);
    else done++;
  }
  console.log(`Approved ${done} of ${todo.length}.`);
}
