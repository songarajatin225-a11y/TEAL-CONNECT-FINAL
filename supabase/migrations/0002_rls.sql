-- ===========================================================================
-- Row-level security.
--
-- The browser build enforced visibility in JavaScript: visibleLeads() filtered
-- a sales user down to their own book. That is a UI convenience, not a control
-- — anyone could open the console and read the rest. These policies move the
-- same three rules into the database, where the anon key cannot talk its way
-- around them:
--
--   admin       reads and writes everything
--   sales       reads and writes only the leads they own, and the contacts,
--               activities and notifications hanging off those leads
--   management  reads everything, writes nothing
--
-- Everything is denied by default: enabling RLS with no matching policy on a
-- table returns zero rows rather than erroring, so a table added later without
-- policies fails closed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Helpers.
--
-- SECURITY DEFINER because the policies on profiles would otherwise recurse:
-- reading profiles to decide whether you may read profiles. Marked stable so
-- the planner calls them once per statement rather than once per row, and
-- pinned to an explicit search_path so a caller cannot shadow public.profiles
-- with a temp table of their own.
-- ---------------------------------------------------------------------------
create or replace function public.current_profile_id()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.active
  limit 1
$$;

-- Not named current_role(): that is a reserved word in PostgreSQL.
create or replace function public.current_app_role()
returns app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.active
  limit 1
$$;

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select public.current_app_role() = 'admin'
$$;

-- Management is deliberately excluded: it reads the whole book but never
-- writes to it.
create or replace function public.can_write()
returns boolean language sql stable as $$
  select public.current_app_role() in ('admin', 'sales')
$$;

create or replace function public.sees_all_leads()
returns boolean language sql stable as $$
  select public.current_app_role() in ('admin', 'management')
$$;

-- One place that answers "may the caller see this lead", so every dependent
-- table's policy stays a single call instead of a copied subquery.
create or replace function public.can_see_lead(target_lead_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = target_lead_id
      and (public.sees_all_leads() or l.owner_id = public.current_profile_id())
  )
$$;

revoke execute on function public.current_profile_id()   from public;
revoke execute on function public.current_app_role()     from public;
revoke execute on function public.can_see_lead(text)     from public;
grant  execute on function public.current_profile_id()   to authenticated;
grant  execute on function public.current_app_role()     to authenticated;
grant  execute on function public.can_see_lead(text)     to authenticated;

-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.exhibitions        enable row level security;
alter table public.products           enable row level security;
alter table public.companies          enable row level security;
alter table public.contacts           enable row level security;
alter table public.leads              enable row level security;
alter table public.activities         enable row level security;
alter table public.notifications      enable row level security;
alter table public.notification_reads enable row level security;
alter table public.audit_log          enable row level security;
alter table public.app_settings       enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
--
-- Every signed-in user reads the directory: the leads table shows an owner's
-- name, the team report lists everyone, and reassignment needs a picker. Only
-- an administrator changes who exists or what role they hold — a sales user
-- who could write their own role row could promote themselves to admin.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (true);

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Reference data: readable by everyone signed in, written by administrators.
-- ---------------------------------------------------------------------------
drop policy if exists exhibitions_read on public.exhibitions;
create policy exhibitions_read on public.exhibitions
  for select to authenticated using (true);

drop policy if exists exhibitions_admin_write on public.exhibitions;
create policy exhibitions_admin_write on public.exhibitions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select to authenticated using (true);

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- companies
--
-- Readable in full by anyone signed in, and that is a deliberate call rather
-- than an oversight. createLead reuses an existing company when the name
-- matches, so a sales user who could only see their own accounts would create
-- a second "Vertex Microsystems" every time a colleague had already captured
-- it, and the Account 360 would fragment. A company row holds firm-level facts
-- — name, industry, city, website — not another rep's pipeline. Personal data
-- lives in contacts, which is scoped.
-- ---------------------------------------------------------------------------
drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies
  for select to authenticated using (true);

drop policy if exists companies_write on public.companies;
create policy companies_write on public.companies
  for insert to authenticated with check (public.can_write());

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update to authenticated using (public.can_write()) with check (public.can_write());

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- contacts — named people, so scoped to the leads the caller can see, plus the
-- rows they captured themselves (a contact is written a moment before the lead
-- that references it exists).
-- ---------------------------------------------------------------------------
drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts
  for select to authenticated
  using (
    public.sees_all_leads()
    or created_by = public.current_profile_id()
    or exists (
      select 1 from public.leads l
      where l.contact_id = contacts.id
        and l.owner_id = public.current_profile_id()
    )
  );

drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts
  for insert to authenticated
  with check (public.can_write() and created_by = public.current_profile_id());

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts
  for update to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.leads l
      where l.contact_id = contacts.id
        and l.owner_id = public.current_profile_id()
    )
  )
  with check (public.can_write());

drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- leads — the rule everything else follows from.
-- ---------------------------------------------------------------------------
drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads
  for select to authenticated
  using (public.sees_all_leads() or owner_id = public.current_profile_id());

-- A sales user files leads under themselves and nobody else. The browser
-- already sets ownerId to the signed-in user because a booth tablet gets
-- passed around; this makes it a rule rather than a convention.
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert to authenticated
  with check (
    public.can_write()
    and (public.is_admin() or owner_id = public.current_profile_id())
  );

-- using() is checked against the row as it stands, with_check() against the
-- row as it would be. Both are required: without using(), a sales user could
-- claim someone else's lead by patching owner_id to their own id; without
-- with_check(), they could push their own lead onto a colleague.
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using (public.is_admin() or owner_id = public.current_profile_id())
  with check (public.is_admin() or owner_id = public.current_profile_id());

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- activities — the timeline follows its lead's visibility.
--
-- Append-only for everyone: an activity is a record of what happened, and a
-- timeline that can be quietly edited is not evidence of anything.
-- ---------------------------------------------------------------------------
drop policy if exists activities_read on public.activities;
create policy activities_read on public.activities
  for select to authenticated using (public.can_see_lead(lead_id));

drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert to authenticated
  with check (public.can_write() and public.can_see_lead(lead_id));

drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- notifications — addressed to one person, or to whoever can see the lead.
-- ---------------------------------------------------------------------------
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications
  for select to authenticated
  using (
    recipient_id = public.current_profile_id()
    or (recipient_id is null
        and (lead_id is null or public.can_see_lead(lead_id)))
  );

drop policy if exists notifications_admin_write on public.notifications;
create policy notifications_admin_write on public.notifications
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Marking something read is the one thing anyone may do to a notification, and
-- it writes to their own row here rather than to the shared notification.
drop policy if exists notification_reads_own on public.notification_reads;
create policy notification_reads_own on public.notification_reads
  for all to authenticated
  using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());

-- ---------------------------------------------------------------------------
-- audit_log — append-only, administrator-readable.
--
-- There is no update or delete policy and that is the point: not even an
-- administrator can rewrite the log through the API. Deliberately no read
-- policy for sales or management either, since the log spans every book.
-- ---------------------------------------------------------------------------
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (actor_id is null or actor_id = public.current_profile_id());

drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- app_settings — scoring weights. Everyone reads them, because the Lead 360
-- shows the breakdown that produced the score and the promise is that anyone
-- can audit how the number was reached. Only an administrator changes them.
-- ---------------------------------------------------------------------------
drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings
  for select to authenticated using (true);

drop policy if exists settings_admin_write on public.app_settings;
create policy settings_admin_write on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Table grants. RLS narrows what a role may touch; it does not grant access on
-- its own. anon gets nothing at all — every screen requires a session.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select on public.profiles, public.exhibitions, public.products,
                public.companies, public.contacts, public.leads,
                public.activities, public.notifications, public.app_settings
  to authenticated;

grant insert, update on public.companies, public.contacts, public.leads to authenticated;
grant insert on public.activities, public.audit_log to authenticated;
grant select on public.audit_log to authenticated;
grant insert, update, delete, select on public.notification_reads to authenticated;
grant delete on public.companies, public.contacts, public.leads, public.activities
  to authenticated;
grant update on public.profiles, public.exhibitions, public.products,
                public.notifications, public.app_settings to authenticated;
grant insert, delete on public.profiles, public.exhibitions, public.products,
                        public.notifications to authenticated;

revoke all on schema public from anon;
