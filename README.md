# Card Union

A private card-collecting marketplace: a cart-based checkout with dibs
claiming and a waitlist queue, a negotiation/offer system, franchise-scoped
browsing, and an admin verification dashboard with a sales log. Built with
Next.js (App Router), Tailwind CSS, and Supabase (Postgres + Realtime).

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com/dashboard).

3. **Run the schema.** Open the SQL editor in your Supabase project and run
   the contents of [`supabase/schema.sql`](supabase/schema.sql). This creates
   the `cards`, `offers`, `dibs_queue`, `orders`, `profiles`, `disputes`, and
   `dispute_evidence` tables, RLS policies, the `submit_offer` /
   `place_order` / `try_claim_order_confirmation` / `open_dispute` /
   `withdraw_dispute` RPC functions, the buyer-signup trigger, the private
   `dispute-evidence` storage bucket, enables Realtime, and seeds a few
   sample cards. If you already have an existing project from before any of
   this, run "MIGRATION 2" and/or "MIGRATION 3" near the end of the file
   instead of the whole thing — see the comment at the top of the file.

4. **Configure environment variables.** Copy `.env.local.example` to
   `.env.local` and fill in:

   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from
     Project Settings → API.
   - `SUPABASE_SERVICE_ROLE_KEY` — same page; **server-only**, used by admin
     Server Actions. Never expose this to the browser.
   - `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — from [resend.com](https://resend.com),
     used to email buyers when admin confirms their payment/order. Until you
     verify a sending domain in Resend, it can only deliver to the account
     owner's own email address.
   - `NEXT_PUBLIC_NEXT_DROP_AT` (optional) — ISO timestamp for the Live Drop
     Banner countdown; leave blank to hide the banner.

5. **(Optional) Enable Google sign-in for buyers.** Buyers can sign up/log in
   with email+password or Google — nothing to configure in `.env.local` for
   this, it's set up entirely in the two dashboards:

   - **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)):
     create/select a project → **APIs & Services → OAuth consent screen**
     (fill in app name + support email) → **APIs & Services → Credentials →
     Create Credentials → OAuth client ID** (type: Web application). For
     **Authorized redirect URIs**, use the exact callback URL Supabase shows
     you in the next step (looks like
     `https://<project-ref>.supabase.co/auth/v1/callback`) — copy the
     resulting **Client ID** and **Client Secret**.
   - **Supabase dashboard**: **Authentication → Providers → Google** → enable
     it, paste the Client ID + Client Secret from above, save. Then
     **Authentication → URL Configuration → Redirect URLs** → add
     `http://localhost:3000/auth/callback` (and your production URL once
     deployed, e.g. `https://your-app.vercel.app/auth/callback`).

   Google doesn't know about this app's `@handle` field, so a first-time
   Google sign-in lands on `/account/complete-profile` to pick one before
   they can dibs/offer — see `app/auth/callback/route.ts`.

6. **Create the first Super Admin account.** Admin accounts live in Supabase
   Auth, not an env var, so the very first one has to be created directly
   (there's no "manage admins" screen until you're already logged in as a
   Super Admin). In the Supabase dashboard: **Authentication → Users → Add
   user**, enter an email + password, then open that user and set
   **App Metadata** to:

   ```json
   { "role": "SUPER_ADMIN" }
   ```

   From then on, that account can create further Admin/Super Admin accounts
   from `/admin/manage` in the app itself.

7. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Without Supabase env
   vars configured, the app shows a "Connect Supabase" setup screen instead of
   erroring.

## How it works

- **Cart & checkout.** Buyers browse and click **Add to Cart** — that's a
  purely local action (no server call, no reservation) so nothing gets
  locked just from browsing. Clicking **Place Order** in the cart drawer
  calls the `place_order` RPC with every card ID in the cart at once: cards
  still `AVAILABLE` get claimed for that buyer, cards already `PENDING` under
  someone else add the buyer to the queue instead, and the result is grouped
  into one `orders` row. The client then sends **one consolidated Messenger
  message** (grouped by seller, for the rare case a cart spans sellers)
  instead of a separate message per card.
- **No reservation timer.** A claimed card stays `PENDING` indefinitely.
  There's no auto-expiry — the admin decides what happens next via the
  Pending Payments tab: **Confirm Paid**, **Next in Queue** (promotes the
  earliest waiting buyer to `current_claimant` — the admin then messages that
  buyer directly, since the app has no way to message a buyer on its own), or
  **Cancel / Re-list** (releases it back to `AVAILABLE` and cancels the
  remaining queue).
- **Offers** go through the `submit_offer` RPC, which enforces the
  75%–100%-of-listed-price rule server-side (the client also validates for
  instant feedback) and is independent of the cart — it's still a direct,
  single-card action from the card detail page.
- **Rate limiting.** Both buyer RPCs (`submit_offer`, `place_order`) reject a
  buyer making more than 10 offers or 5 orders per minute, keyed on their
  authenticated user id.
- **Franchises**: every card belongs to a franchise (`lib/franchises.ts`).
  The homepage is a pedestal picker (Pokémon / One Piece / ...); each
  pedestal links to `/[franchise]`, a scoped version of the marketplace grid.
- **Buyer accounts** use Supabase Auth (email + password, email
  confirmation required). Signing up at `/account/signup` collects full name
  and a unique `@handle`, and creates a `profiles` row via a database trigger
  (`handle_new_user`, see `supabase/schema.sql`). `submit_offer` and
  `place_order` identify the caller from their session (`auth.uid()`), not a
  client-supplied handle, so a buyer can no longer claim/offer under someone
  else's name. `/my-dibs` requires a signed-in session (enforced in
  `proxy.ts`); the cart itself doesn't, since checkout is where sign-in is
  actually needed.
- **Payment-confirmation emails.** When admin clicks **Confirm Paid**, if the
  card has a linked buyer account, `app/admin/actions.ts` emails them via
  Resend (`lib/email.ts`). A cart order confirmed one card at a time only
  sends a single consolidated email once every card in the order is
  accounted for — see `try_claim_order_confirmation` in `supabase/schema.sql`
  for how that's made race-safe. A failed email never blocks or fails the
  actual payment confirmation.
- **Admin auth** uses Supabase Auth (email + password), checked in `proxy.ts`
  on every `/admin/*` request. Each admin's role (`ADMIN` or `SUPER_ADMIN`)
  lives in that user's `app_metadata`, set via the service-role Admin API —
  see `lib/adminAuth.ts`. Buyers and admins share the same Supabase Auth user
  pool (distinguished by the presence/absence of that role claim), so they
  also share one browser cookie namespace — signing in as one signs the
  other out in the same browser profile. Use separate browser profiles when
  testing both roles at once.
- **Multi-admin scoping**: every card has an `admin_id` (the admin who
  created it). Regular `ADMIN` accounts only ever see/manage their own
  listings — Pending Payments, Incoming Offers, Inventory, and the Sales Log
  are all filtered by `admin_id`. `SUPER_ADMIN` accounts see and manage
  everything, and are the only ones who can reach `/admin/manage` to create
  new admin accounts. Ownership is also enforced server-side in every
  mutation (`app/admin/actions.ts`), not just hidden in the UI.
- **Sales Log** (`/admin/logs`): every card marked SOLD shows up with the
  sale date/time, which order it was part of, buyer, price, and a
  Shipped/Delivered checkbox admins can toggle.
- **Admin mutations** run as Next.js Server Actions using the service-role
  key, which bypasses Row Level Security — these are trusted, server-only
  operations, gated by the ownership check above.
- **Realtime connection status**: a thin banner appears site-wide if the
  Supabase Realtime connection drops, so stale data (someone else claimed a
  card while your Realtime socket was disconnected) doesn't go unnoticed.
- **Image upload hardening**: uploaded card photos are checked against their
  actual file signature (magic bytes), not just the browser-reported MIME
  type, before being written to Storage (`lib/imageValidation.ts`, shared by
  card-image uploads and dispute evidence).
- **Disputes.** A buyer who bought a card (`claimant_id` matches, card is
  `SOLD`) can open a dispute from `/my-dibs` or `/account/disputes` —
  "Item Not Received," "Not as Described," "Damaged in Transit," or "Other" —
  and attach photo evidence. There's no separate seller-accounts system in
  this app, so the "seller side" of a dispute is handled by whichever admin
  owns the card (`disputes.seller_admin_id`, snapshotted from `cards.admin_id`
  at open time); Super Admins can act on any dispute. Evidence photos live in
  a **private** Storage bucket (`dispute-evidence`) with no public/RLS access
  at all — every read goes through a short-lived signed URL minted
  server-side after an ownership check, never a public URL. Status moves
  through `OPEN → SELLER_RESPONDED → UNDER_REVIEW → RESOLVED_REFUND` /
  `RESOLVED_DISMISSED` (`lib/disputeStatus.ts` is the single source of truth
  for which transitions are valid, enforced server-side, not just in the
  UI). `RESOLVED_REFUND` is bookkeeping only — same as `confirmPaid`, there's
  no payment integration anywhere in this app, so admin still issues any
  actual refund themselves off-platform.

## Testing

```bash
npm test
```

Runs on Node's built-in test runner via `tsx` — no test framework
dependency. Two kinds of tests:

- **Unit tests** (`tests/unit/`) — pure functions (currency/countdown
  formatting, condition-grade parsing, franchise lookup). Run with no setup.
- **Integration test** (`tests/integration/concurrency.test.ts`) — proves the
  core safety property of the whole system: firing several concurrent
  `place_order` calls at the same `AVAILABLE` card yields exactly one winner,
  never zero, never two. This needs its **own Supabase project** to run
  against (never point it at production) — set `SUPABASE_TEST_URL`,
  `SUPABASE_TEST_ANON_KEY`, and `SUPABASE_TEST_SERVICE_ROLE_KEY` to enable
  it; without them it skips cleanly.

## Known limitations

Worth knowing about before treating this as fully production-hardened:

- **No staging environment.** Development so far has happened directly
  against the one Supabase project this app is configured for. Before
  significant future changes, consider standing up a second Supabase project
  from the same `schema.sql` and pointing local development /
  `SUPABASE_TEST_*` at it, so schema experiments and the concurrency test
  never touch real listings or buyers.
- **Historical buyers have no account.** Cards claimed before buyer accounts
  existed keep their `current_claimant`/`buyer_handle` text (still shown
  everywhere), but have no linked `claimant_id`/`buyer_id` and can't receive
  payment-confirmation emails — there's no way to know which real account, if
  any, corresponds to an old free-text handle, so no backfill was attempted.
- **Resend delivery is limited until a domain is verified.** Until you verify
  a sending domain in your Resend account, it can only deliver to the account
  owner's own email address — fine for testing, not for real buyers.
- **Supabase's built-in signup-confirmation email is rate-limited** on the
  free tier (a handful per hour). If buyer signups pick up, configure custom
  SMTP in the Supabase dashboard (Authentication → Email) — you can reuse
  your Resend credentials there too.
- **Dispute resolutions are final.** Once a dispute is marked
  `RESOLVED_REFUND`/`RESOLVED_DISMISSED` there's no reopen path — a buyer can
  open a new dispute on the same card instead (capped at 2 lifetime attempts
  per card to prevent repeat-filing abuse), or a developer corrects the DB
  directly for a genuine mistake. A real reopen feature would need
  resolution tracking to become an append-only history instead of the
  current single `resolution_note`/`resolved_by`/`resolved_at` columns, to
  avoid silently overwriting the record of an earlier resolution.
- **Dispute evidence is photos only** for now (reuses the same magic-byte
  validation as card images). Video support would need its own
  file-signature rules and larger size limits — a clean, separate follow-up.

## Project structure

- `app/` — routes: franchise picker (`/`), franchise-scoped marketplace
  (`/[franchise]`), card detail (`/card/[id]`), cart (`/cart`), buyer dibs
  (`/my-dibs`), buyer auth + disputes (`/account/*` — signup, login, profile,
  logout, `disputes/*`), admin dashboard (`/admin/*`, including
  `/admin/disputes`).
- `components/` — UI, including `ui/` primitives (`Button`, `Modal`, `Input`,
  `Select`, `Badge`) with no external component library. `CartProvider`
  holds the client-side cart, persisted to `localStorage`;
  `BuyerIdentityProvider` holds the signed-in buyer's session + profile
  (Supabase Auth, not `localStorage`).
- `lib/supabase/` — four clients: `client.ts` (browser, anon key, cookie-aware
  via `@supabase/ssr`), `server.ts` (RSC reads, anon key), `admin.ts` (service
  role, server-only), `authServer.ts` (cookie-aware, anon key — Supabase Auth
  sessions for both admin and buyer login).
- `lib/adminAuth.ts` / `lib/buyerAuth.ts` — server-side session/role
  resolution for admins and buyers respectively, mirroring each other.
- `lib/email.ts` — Resend wrapper for payment-confirmation emails.
- `lib/disputeStatus.ts` — the dispute status state machine
  (`canTransitionDispute`), used both as a real server-side guard and as the
  unit-tested source of truth for valid transitions.
- `lib/imageValidation.ts` — shared magic-byte file validation, used by both
  card-image uploads and dispute evidence uploads.
- `hooks/` — `useRealtimeCards` / `useRealtimeCard` (Supabase Realtime
  subscriptions), `useCardQueue` (live waitlist for one card),
  `useRealtimeConnection` (drives the connection-status banner).
- `lib/franchises.ts` — the list of known franchises (slug + label); add an
  entry here to add a new pedestal + browse page.
- `supabase/schema.sql` — full schema, RLS policies, RPCs, Realtime
  publication, seed data.
- `tests/` — see **Testing** above.
"# HuntbyCardUnion" 
