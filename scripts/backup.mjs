// Read-only full backup: every public table (JSON), auth users, storage buckets (files).
// Usage: node scripts/backup.mjs <project folder with .env.local> <output folder>
// Photos live on Cloudflare R2, not Supabase, so they are NOT in this backup (R2 keeps its own copies).
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
const out = process.argv[3];
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
  }),
);
const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}` };
fs.mkdirSync(path.join(out, "tables"), { recursive: true });
fs.mkdirSync(path.join(out, "storage"), { recursive: true });
const summary = { tables: {}, authUsers: 0, buckets: {}, errors: [] };

// ---- tables
const spec = await (await fetch(`${base}/rest/v1/`, { headers: H })).json();
const tables = Object.keys(spec.definitions ?? {});
for (const t of tables) {
  const rows = [];
  let from = 0;
  let failed = null;
  for (;;) {
    const r = await fetch(`${base}/rest/v1/${encodeURIComponent(t)}?select=*`, { headers: { ...H, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) { failed = `${r.status} ${(await r.text()).slice(0, 150)}`; break; }
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) break;
    from += 1000;
  }
  if (failed) { summary.errors.push(`table ${t}: ${failed}`); continue; }
  fs.writeFileSync(path.join(out, "tables", `${t}.json`), JSON.stringify(rows));
  summary.tables[t] = rows.length;
}

// ---- auth users
const users = [];
for (let page = 1; ; page++) {
  const r = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: H });
  if (!r.ok) { summary.errors.push(`auth users: ${r.status}`); break; }
  const j = await r.json();
  users.push(...(j.users ?? []));
  if ((j.users ?? []).length < 1000) break;
}
fs.writeFileSync(path.join(out, "auth_users.json"), JSON.stringify(users));
summary.authUsers = users.length;

// ---- storage
const br = await fetch(`${base}/storage/v1/bucket`, { headers: H });
const buckets = br.ok ? await br.json() : [];
if (!br.ok) summary.errors.push(`buckets: ${br.status}`);
async function walk(bucket, prefix) {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${base}/storage/v1/object/list/${bucket}`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ prefix, limit: 1000, offset }) });
    if (!r.ok) { summary.errors.push(`list ${bucket}/${prefix}: ${r.status}`); break; }
    const items = await r.json();
    for (const it of items) {
      if (it.id === null) files.push(...(await walk(bucket, prefix ? `${prefix}/${it.name}` : it.name)));
      else files.push(prefix ? `${prefix}/${it.name}` : it.name);
    }
    if (items.length < 1000) break;
  }
  return files;
}
for (const b of buckets) {
  const files = await walk(b.name, "");
  let bytes = 0, ok = 0;
  for (const f of files) {
    const r = await fetch(`${base}/storage/v1/object/${b.name}/${f.split("/").map(encodeURIComponent).join("/")}`, { headers: H });
    if (!r.ok) { summary.errors.push(`download ${b.name}/${f}: ${r.status}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const dest = path.join(out, "storage", b.name, ...f.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    bytes += buf.length; ok++;
  }
  summary.buckets[b.name] = { public: b.public, listed: files.length, saved: ok, mb: Math.round(bytes / 1048576 * 10) / 10 };
}
fs.writeFileSync(path.join(out, "SUMMARY.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
