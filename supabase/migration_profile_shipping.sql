-- MIGRATION: saved shipping default on buyer profiles.
--
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query) against your existing project. Safe to run more than once.
--
-- Lets checkout pre-fill from a buyer's saved shipping info instead of
-- asking for it every order. Mirrors the same change in supabase/schema.sql.

alter table profiles add column if not exists ship_name text;
alter table profiles add column if not exists ship_phone text;
alter table profiles add column if not exists ship_address text;
alter table profiles add column if not exists ship_zip text;
