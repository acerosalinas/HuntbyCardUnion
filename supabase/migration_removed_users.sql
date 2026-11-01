-- Remembers the email of every account an admin removed, so that someone who tries to come back (sign in, sign up
-- again) is told to message you instead of just seeing "incorrect password". Run once in the Supabase SQL editor.
-- Until it is run the "Delete" button on the Manage page refuses to delete (it will not remove someone it cannot remember).

create table if not exists removed_users (
  email text primary key,           -- always lower-case
  removed_at timestamptz not null default now(),
  removed_by uuid references auth.users (id) on delete set null
);

alter table removed_users enable row level security;
-- No policies: only the server (service role) reads or writes this table.
