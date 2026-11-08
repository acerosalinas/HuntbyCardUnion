-- Payment distribution: track "distributed" on every card payment, not only on customer proofs.
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against an EXISTING project. Safe to paste and run more than once.
--
-- The Distribution page lists every payment for cards - whether a customer sent
-- a proof that was confirmed, or the seller marked the invoice / card paid
-- directly - so the "distributed" marker has to live on the payment itself.
-- Payments whose proof was already marked distributed (migration_proof_distributed.sql)
-- keep that mark.

alter table tracker_payments add column if not exists distributed_at timestamptz;

update tracker_payments p
   set distributed_at = c.distributed_at
  from tracker_payment_claims c
 where c.payment_id = p.id
   and c.distributed_at is not null
   and p.distributed_at is null;
