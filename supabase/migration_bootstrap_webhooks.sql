-- Bootstraps the internal plumbing the Supabase Dashboard's "Database
-- Webhooks" UI normally creates automatically the first time you use it -
-- this project is missing it, causing "schema supabase_functions does not
-- exist" when trying to create a webhook. Run this once in the Supabase SQL
-- editor, then retry creating the webhook from the Dashboard. Safe to run
-- more than once (re-running this corrected version replaces the earlier,
-- buggy one - net.http_get/http_post return a plain bigint, not a table, so
-- "select x into y from net.http_post(...)" silently failed every insert
-- into notifications once the webhook trigger existed).

create extension if not exists pg_net;

create schema if not exists supabase_functions;

create table if not exists supabase_functions.hooks (
  id bigserial primary key,
  hook_table_id integer not null,
  hook_name text not null,
  created_at timestamptz default now() not null,
  request_id bigint
);

create index if not exists supabase_functions_hooks_request_id_idx
  on supabase_functions.hooks (request_id);
create index if not exists supabase_functions_hooks_h_table_id_h_name_idx
  on supabase_functions.hooks (hook_table_id, hook_name);

comment on table supabase_functions.hooks is 'Supabase Functions Hooks: Audit trail for triggered hooks.';

create or replace function supabase_functions.http_request()
  returns trigger
  language plpgsql
as $$
  declare
    request_id bigint;
    payload jsonb;
    url text := TG_ARGV[0]::text;
    method text := TG_ARGV[1]::text;
    headers jsonb default '{}'::jsonb;
    params jsonb default '{}'::jsonb;
    timeout_ms integer default 1000;
  begin
    if url is null or url = 'null' then
      raise exception 'url argument is missing';
    end if;

    if method is null or method = 'null' then
      raise exception 'method argument is missing';
    end if;

    if TG_ARGV[2] is null or TG_ARGV[2] = 'null' then
      headers = '{"Content-Type": "application/json"}'::jsonb;
    else
      headers = TG_ARGV[2]::jsonb;
    end if;

    if TG_ARGV[3] is null or TG_ARGV[3] = 'null' then
      params = '{}'::jsonb;
    else
      params = TG_ARGV[3]::jsonb;
    end if;

    if TG_ARGV[4] is null or TG_ARGV[4] = 'null' then
      timeout_ms = 1000;
    else
      timeout_ms = TG_ARGV[4]::integer;
    end if;

    case
      when method = 'GET' then
        request_id := net.http_get(
          url,
          params,
          headers,
          timeout_ms
        );
      when method = 'POST' then
        payload = jsonb_build_object(
          'old_record', OLD,
          'record', NEW,
          'type', TG_OP,
          'table', TG_TABLE_NAME,
          'schema', TG_TABLE_SCHEMA
        );

        request_id := net.http_post(
          url,
          payload,
          params,
          headers,
          timeout_ms
        );
      else
        raise exception 'method argument % is invalid', method;
    end case;

    insert into supabase_functions.hooks (hook_table_id, hook_name, request_id)
      values (TG_RELID, TG_NAME, request_id);

    return NEW;
  end
$$;

grant usage on schema supabase_functions to postgres, anon, authenticated, service_role;
grant all on supabase_functions.hooks to postgres, anon, authenticated, service_role;
grant all on sequence supabase_functions.hooks_id_seq to postgres, anon, authenticated, service_role;
