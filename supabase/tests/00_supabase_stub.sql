-- ===========================================================================
-- Enough of Supabase to run the migrations against a plain PostgreSQL 15+.
--
-- Supabase provides the auth schema, auth.uid() and the anon / authenticated /
-- service_role roles. Recreating the parts the policies actually depend on
-- lets the row-level security rules be tested in CI, or on a laptop, without
-- a Supabase project and without pointing tests at production data.
--
-- Never run this against a real Supabase database — it would shadow the
-- genuine auth schema.
-- ===========================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase reads the caller's user id out of the verified JWT. PostgREST puts
-- the claims into GUCs, so the stub reads the same GUC the real one does.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$ begin create role anon          nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role  nologin bypassrls; exception when duplicate_object then null; end $$;

grant usage on schema auth to authenticated, anon, service_role;
grant select on auth.users to authenticated, service_role;

-- Sign in as somebody for the length of a test.
create or replace function auth.become(user_email text)
returns void
language plpgsql
as $$
declare uid uuid;
begin
  select id into uid from auth.users where email = user_email;
  if uid is null then
    raise exception 'auth.become: no such user %', user_email;
  end if;
  perform set_config('request.jwt.claim.sub', uid::text, false);
end $$;
