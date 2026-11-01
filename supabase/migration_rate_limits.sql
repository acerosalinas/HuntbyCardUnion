-- Rate limiting for sign-in, sign-up, password reset, catalog search and uploads.
-- Run once in the Supabase SQL editor. Until it is run the app simply skips rate limiting (nothing breaks).

create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

alter table rate_limits enable row level security;
-- No policies: only the server (service role) touches this table.

-- Counts one attempt for `p_key` in the current window and says whether it is still allowed.
create or replace function rate_limit_hit(p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  win timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  used int;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, win, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into used;

  -- Tidy up old windows now and then so the table stays small.
  if random() < 0.02 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;

  return used <= p_max;
end;
$$;

revoke all on function rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, int, int) to service_role;
