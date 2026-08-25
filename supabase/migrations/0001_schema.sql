-- ===========================================================================
-- TEAL LeadConnect — schema
--
-- Primary keys are the text ids the application already generates ('ld-001',
-- 'co-004', 'u-priya'). Using them directly rather than introducing uuids is
-- what lets the existing frontend join records without a translation table:
-- lead.company_id still reads 'co-001' in the browser exactly as it did when
-- the data came from data/*.json.
--
-- Columns are snake_case; js/api.js converts to and from the camelCase the
-- views expect. The conversion is mechanical, so the database stays idiomatic
-- for anyone querying it with SQL or pointing a BI tool at it.
--
-- Timestamps that arrived as naive strings in the seed data ('2026-08-12T14:15:00')
-- are stored as timestamptz anchored to IST, which is where the events happened.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enumerations. Declared as types rather than check constraints so the values
-- are discoverable from the schema and PostgREST reports them in its OpenAPI.
-- ---------------------------------------------------------------------------
do $$ begin
  create type app_role as enum ('admin', 'sales', 'management');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_stage as enum
    ('NEW', 'QUALIFIED', 'ENGAGED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles — one row per person who can sign in.
--
-- id stays the application's text id so lead.owner_id does not have to change.
-- auth_user_id links to Supabase Auth; it is nullable so an administrator can
-- create the profile before the invitation is accepted.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            text primary key,
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  name          text        not null,
  email         text        not null unique,
  role          app_role    not null default 'sales',
  title         text        not null default '',
  region        text        not null default '',
  active        boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Application users. Row-level security keys off this table, not off auth.users.';

-- ---------------------------------------------------------------------------
-- Reference data: exhibitions and products.
-- ---------------------------------------------------------------------------
create table if not exists public.exhibitions (
  id         text primary key,
  code       text        not null unique,
  name       text        not null,
  city       text        not null default '',
  venue      text        not null default '',
  start_date date,
  end_date   date,
  active     boolean     not null default false,
  visitors   integer     not null default 0,
  booth_cost numeric(14,2) not null default 0,
  focus      jsonb       not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id       text primary key,
  name     text not null,
  category text not null default '',
  family   text not null default ''
);

-- ---------------------------------------------------------------------------
-- companies and contacts.
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id           text primary key,
  name         text not null,
  industry     text not null default '',
  size         text not null default '',
  city         text not null default '',
  state        text not null default '',
  country      text not null default 'India',
  website      text not null default '',
  account_type text not null default '',
  segment      text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The account view reconciles leads by company name, and createLead reuses an
-- existing company when the name matches. Enforce that here too so two tablets
-- capturing the same firm at the same booth cannot fork the account.
create unique index if not exists companies_name_unique
  on public.companies (lower(btrim(name)));

create table if not exists public.contacts (
  id          text primary key,
  company_id  text references public.companies (id) on delete set null,
  name        text not null,
  designation text not null default '',
  authority   text not null default 'Unknown',
  email       text not null default '',
  phone       text not null default '',
  linkedin    text not null default '',
  city        text not null default '',
  country     text not null default 'India',
  -- Who captured this contact. A contact exists for a moment before its lead
  -- row lands, and without this the person mid-capture could not read back the
  -- row they just wrote without also making orphan contacts world-readable.
  created_by  text references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists contacts_company_idx on public.contacts (company_id);

-- Duplicate detection in the browser matches on email, then the last ten
-- digits of the phone. These indexes make the same checks cheap server-side
-- and give findDuplicate something to query rather than scanning every lead.
create index if not exists contacts_email_idx
  on public.contacts (lower(btrim(email))) where btrim(email) <> '';
create index if not exists contacts_phone_tail_idx
  on public.contacts (right(regexp_replace(phone, '\D', '', 'g'), 10))
  where length(regexp_replace(phone, '\D', '', 'g')) >= 10;

-- ---------------------------------------------------------------------------
-- leads — the record everything else hangs off.
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                   text primary key,
  code                 text not null unique,
  contact_id           text references public.contacts (id) on delete set null,
  company_id           text references public.companies (id) on delete set null,
  exhibition_id        text references public.exhibitions (id) on delete set null,
  owner_id             text not null references public.profiles (id) on delete restrict,
  stage                lead_stage not null default 'NEW',

  products             jsonb not null default '[]'::jsonb,
  product_ids          jsonb not null default '[]'::jsonb,
  application          text not null default '',
  problem              text not null default '',
  quantity             text not null default '',
  budget               text not null default 'Not Defined',
  timeline             text not null default 'Not Defined',
  authority            text not null default 'Unknown',
  current_solution     text not null default '',
  competitor           text not null default '',
  value                numeric(16,2) not null default 0,
  source               text not null default 'Booth Conversation',
  engagement           jsonb not null default
                         '{"booth":true,"demo":false,"meeting":false,"technical":false,"commercial":false}'::jsonb,

  captured_at          timestamptz not null default now(),
  next_follow_up       date,
  next_best_action     text not null default '',
  next_best_action_why text not null default '',
  consent              boolean not null default false,
  tags                 jsonb not null default '[]'::jsonb,
  notes                text not null default '',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists leads_owner_idx      on public.leads (owner_id);
create index if not exists leads_stage_idx      on public.leads (stage);
create index if not exists leads_exhibition_idx on public.leads (exhibition_id);
create index if not exists leads_company_idx    on public.leads (company_id);
create index if not exists leads_followup_idx   on public.leads (next_follow_up)
  where next_follow_up is not null;

-- ---------------------------------------------------------------------------
-- activities — the Lead 360 timeline.
-- ---------------------------------------------------------------------------
create table if not exists public.activities (
  id         text primary key,
  lead_id    text not null references public.leads (id) on delete cascade,
  company_id text references public.companies (id) on delete set null,
  type       text not null,
  title      text not null default '',
  body       text not null default '',
  actor_id   text references public.profiles (id) on delete set null,
  at         timestamptz not null default now()
);

create index if not exists activities_lead_idx on public.activities (lead_id, at desc);

-- ---------------------------------------------------------------------------
-- notifications.
--
-- recipient_id null means the notification is for everyone who can see the
-- lead it points at, which is how the seeded alerts behave.
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id           text primary key,
  recipient_id text references public.profiles (id) on delete cascade,
  severity     text not null default 'info',
  type         text not null default '',
  title        text not null default '',
  body         text not null default '',
  lead_id      text references public.leads (id) on delete cascade,
  at           timestamptz not null default now(),
  read         boolean not null default false
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, read);

-- Read state is per person, so it cannot live in a boolean on a shared row.
-- notifications.read stays for the seeded single-user case; this table is what
-- markNotificationsRead writes to once several people share one alert.
create table if not exists public.notification_reads (
  notification_id text not null references public.notifications (id) on delete cascade,
  profile_id      text not null references public.profiles (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- audit_log — append-only. No update or delete policy is ever granted.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id        text primary key,
  action    text not null,
  entity    text not null default '',
  entity_id text not null default '',
  detail    text not null default '',
  actor     text not null default 'system',
  actor_id  text references public.profiles (id) on delete set null,
  at        timestamptz not null default now()
);

create index if not exists audit_at_idx on public.audit_log (at desc);

-- ---------------------------------------------------------------------------
-- app_settings — the scoring weights and reference lists, previously
-- data/settings.json. One row, so an administrator can change a weight without
-- a redeploy and every device picks it up on next load.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id         text primary key default 'singleton',
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 'singleton')
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'companies', 'contacts', 'leads'] loop
    execute format(
      'drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;
