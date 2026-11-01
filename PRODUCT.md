# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Two audiences, equally important (confirmed):
- **Buyers**: approved, invite-only members who browse trading cards (Pokémon, One Piece), claim "dibs", make offers, save wishlists and request cards they can't find. Mostly on phones (inferred from the mobile-first navigation and the TikTok/Facebook contact points).
- **Sellers/admins**: run inventory, offers, payments, disputes and live sales, on phone and desktop. A super-admin also uses the Live Tracker to enter cards sold during a live, record payments, split owner payouts, ship and send invoices.

## Product Purpose
Hunt by Card Union is a private marketplace where several sellers list single cards and sealed products, and buyers claim them at a fixed price or make an offer, with no bidding. Live selling (on TikTok/Facebook, inferred) feeds into the Live Tracker, which turns lives into balances, installment plans, invoices and distribution. Success: a buyer can claim a card in seconds, and a seller can run a live and settle it without spreadsheets.

## Positioning
Invite-only and seller-curated rather than an open marketplace; "claim it, message the seller, done: no bidding wars, no waiting rooms" (existing site copy). Prices in Philippine pesos.

## Operating Context
Buyers arrive pre-approved by an admin; contact and support run through TikTok (@cardunion) and Facebook (Card Union). Orders can ship or be stashed with the seller; payment is prepaid or cash on delivery. Admins work in dense tables (inventory, sales log, payments) and a fast-entry screen during live sales.

## Capabilities and Constraints
- Next.js app on Supabase; light and dark themes both ship.
- Roles: buyer, admin, super admin; the Live Tracker is restricted to specific accounts.
- Must remain usable one-handed on small phones and dense on desktop admin screens.

## Brand Commitments
Logo and name stay as they are (confirmed): "Hunt by Card Union", with the existing card-pair logo. Everything else about the current look (palette, typography, mood) is open to replacement.

## Evidence on Hand
Existing logo assets in the repo and real card photography uploaded by sellers. No testimonials, press or sales figures are on file; none should be invented.

## Product Principles
- The card is the hero: photography and card name come before chrome.
- Speed to claim: the primary action is always obvious and one tap away.
- Honest state: availability, holds, payment and shipping status are never ambiguous.
- One system, two densities: the same visual language serves relaxed browsing and dense admin work.
- Trust through clarity: money, balances and statuses read unmistakably.

## Accessibility & Inclusion
Readable in dim rooms and bright daylight (both themes); touch targets sized for phones; keyboard focus always visible.
