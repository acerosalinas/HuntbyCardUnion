-- Optional "strict payments" mode for the Live Tracker: money paid for a live only pays that live's cards and is
-- never carried over to the customer's other cards. Off by default (existing behaviour is unchanged).
alter table tracker_settings add column if not exists strict_payments boolean not null default false;
