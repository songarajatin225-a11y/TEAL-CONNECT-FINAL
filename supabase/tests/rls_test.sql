-- ===========================================================================
-- Row-level security tests.
--
-- These assert the three rules the product promises: a sales user sees only
-- their own book, management can read everything but change nothing, and an
-- administrator can do both. Each assertion raises an exception on failure, so
-- psql -v ON_ERROR_STOP=1 turns the file into a pass/fail gate.
--
--   psql -v ON_ERROR_STOP=1 -f 00_supabase_stub.sql \
--        -f ../migrations/0001_schema.sql -f ../migrations/0002_rls.sql \
--        -f rls_test.sql
-- ===========================================================================

create or replace function public.assert(claim boolean, what text)
returns void language plpgsql as $$
begin
  if claim is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice '  ok  %', what;
end $$;

-- ---- fixtures (as the owner, bypassing the policies under test) -----------
set role postgres;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@teal.test'),
  ('22222222-2222-2222-2222-222222222222', 'priya@teal.test'),
  ('33333333-3333-3333-3333-333333333333', 'arun@teal.test'),
  ('44444444-4444-4444-4444-444444444444', 'kavita@teal.test')
on conflict do nothing;

insert into public.profiles (id, auth_user_id, name, email, role) values
  ('u-admin',  '11111111-1111-1111-1111-111111111111', 'Admin',  'admin@teal.test',  'admin'),
  ('u-priya',  '22222222-2222-2222-2222-222222222222', 'Priya',  'priya@teal.test',  'sales'),
  ('u-arun',   '33333333-3333-3333-3333-333333333333', 'Arun',   'arun@teal.test',   'sales'),
  ('u-kavita', '44444444-4444-4444-4444-444444444444', 'Kavita', 'kavita@teal.test', 'management')
on conflict do nothing;

insert into public.exhibitions (id, code, name) values ('ex-1', 'EX1', 'Test Expo')
on conflict do nothing;

insert into public.companies (id, name) values
  ('co-1', 'Vertex Microsystems'), ('co-2', 'Helios Components')
on conflict do nothing;

insert into public.contacts (id, company_id, name, email, created_by) values
  ('ct-1', 'co-1', 'Nisha',  'nisha@vertex.test',  'u-priya'),
  ('ct-2', 'co-2', 'Rakesh', 'rakesh@helios.test', 'u-arun')
on conflict do nothing;

insert into public.leads (id, code, contact_id, company_id, exhibition_id, owner_id, stage) values
  ('ld-1', 'TEAL-EX1-00001', 'ct-1', 'co-1', 'ex-1', 'u-priya', 'NEW'),
  ('ld-2', 'TEAL-EX1-00002', 'ct-2', 'co-2', 'ex-1', 'u-arun',  'DEMO')
on conflict do nothing;

insert into public.activities (id, lead_id, company_id, type, title, actor_id) values
  ('ac-1', 'ld-1', 'co-1', 'lead_captured', 'Captured', 'u-priya'),
  ('ac-2', 'ld-2', 'co-2', 'lead_captured', 'Captured', 'u-arun')
on conflict do nothing;

insert into public.app_settings (id, payload) values ('singleton', '{"scoring":{}}'::jsonb)
on conflict do nothing;

-- ===========================================================================
\echo '== sales: sees only their own book =='
set role authenticated;
select auth.become('priya@teal.test');

select public.assert(public.current_profile_id() = 'u-priya', 'identified as u-priya');
select public.assert(public.current_app_role() = 'sales',     'role resolves to sales');
select public.assert(public.is_admin() = false,               'sales is not admin');
select public.assert(public.can_write() = true,               'sales may write');
select public.assert(public.sees_all_leads() = false,         'sales does not see all leads');

select public.assert(count(*) = 1, 'sales sees exactly their own 1 lead') from public.leads;
select public.assert(bool_and(owner_id = 'u-priya'), 'every visible lead is theirs') from public.leads;
select public.assert(count(*) = 0, 'a colleague''s lead is invisible')
  from public.leads where id = 'ld-2';

select public.assert(count(*) = 1, 'sales sees only the contact under their lead')
  from public.contacts;
select public.assert(count(*) = 1, 'sales sees only their own activities')
  from public.activities;

-- Companies are readable in full, by design: capture reuses an existing
-- account by name, and fragmenting them is worse than showing a firm name.
select public.assert(count(*) = 2, 'companies are readable in full by design')
  from public.companies;

\echo '== sales: cannot take, hand off, or delete leads =='
-- Claiming a colleague's lead. using() rejects the row before with_check() is
-- ever consulted, so this updates nothing rather than succeeding.
update public.leads set owner_id = 'u-priya' where id = 'ld-2';
select public.assert(count(*) = 0, 'cannot claim a colleague''s lead')
  from public.leads where id = 'ld-2' and owner_id = 'u-priya';

-- Pushing your own lead onto someone else. This one is caught by with_check().
do $$ begin
  update public.leads set owner_id = 'u-arun' where id = 'ld-1';
  raise exception 'FAILED: sales reassigned their lead to another user';
exception
  when insufficient_privilege then raise notice '  ok  cannot reassign a lead away';
end $$;

do $$ begin
  insert into public.leads (id, code, owner_id, exhibition_id)
  values ('ld-x', 'TEAL-EX1-09999', 'u-arun', 'ex-1');
  raise exception 'FAILED: sales filed a lead under another user';
exception
  when insufficient_privilege then raise notice '  ok  cannot file a lead under someone else';
end $$;

delete from public.leads where id = 'ld-1';
select public.assert(count(*) = 1, 'sales cannot delete leads') from public.leads where id = 'ld-1';

-- The audit log spans every book, so it is not a sales user's to read.
select public.assert(count(*) = 0, 'sales cannot read the audit log') from public.audit_log;

\echo '== sales: own writes still work =='
insert into public.leads (id, code, owner_id, exhibition_id, company_id, contact_id)
values ('ld-3', 'TEAL-EX1-00003', 'u-priya', 'ex-1', 'co-1', 'ct-1');
select public.assert(count(*) = 1, 'sales can file a lead under themselves')
  from public.leads where id = 'ld-3';

update public.leads set stage = 'QUALIFIED' where id = 'ld-1';
select public.assert(count(*) = 1, 'sales can advance their own lead')
  from public.leads where id = 'ld-1' and stage = 'QUALIFIED';

-- A contact is written a moment before the lead that references it. Without
-- the created_by clause the capture form could not read back its own row.
insert into public.contacts (id, company_id, name, email, created_by)
values ('ct-9', 'co-1', 'Fresh Capture', 'fresh@vertex.test', 'u-priya');
select public.assert(count(*) = 1, 'a just-captured contact is readable before its lead exists')
  from public.contacts where id = 'ct-9';

do $$ begin
  insert into public.contacts (id, company_id, name, created_by)
  values ('ct-8', 'co-1', 'Forged', 'u-arun');
  raise exception 'FAILED: contact created under another user''s name';
exception
  when insufficient_privilege then raise notice '  ok  cannot attribute a contact to someone else';
end $$;

\echo '== sales: cannot promote themselves =='
-- Note the shape of this one. An UPDATE with no policy granting it does not
-- raise: using() filters the row out and the statement reports zero rows
-- affected. Only a with_check() violation raises. So the assertion has to be
-- on the value afterwards, not on an exception — a test written the other way
-- round passes whether or not the rule actually holds.
update public.profiles set role = 'admin' where id = 'u-priya';
select public.assert((select role from public.profiles where id = 'u-priya') = 'sales',
                     'sales cannot promote themselves to admin');

update public.profiles set active = false where id = 'u-arun';
select public.assert((select active from public.profiles where id = 'u-arun') = true,
                     'sales cannot deactivate a colleague');

-- ===========================================================================
\echo '== the other sales user sees the mirror image =='
select auth.become('arun@teal.test');
select public.assert(count(*) = 1, 'arun sees only his own lead') from public.leads;
select public.assert(bool_and(owner_id = 'u-arun'), 'and it is his') from public.leads;

-- ===========================================================================
\echo '== management: reads everything, writes nothing =='
select auth.become('kavita@teal.test');
select public.assert(public.sees_all_leads() = true, 'management sees all leads');
select public.assert(public.can_write() = false,     'management cannot write');
select public.assert(count(*) = 3, 'management sees every lead') from public.leads;
select public.assert(count(*) >= 2, 'management sees every contact') from public.contacts;

do $$ begin
  insert into public.leads (id, code, owner_id, exhibition_id)
  values ('ld-m', 'TEAL-EX1-08888', 'u-kavita', 'ex-1');
  raise exception 'FAILED: management inserted a lead';
exception
  when insufficient_privilege then raise notice '  ok  management cannot insert a lead';
end $$;

update public.leads set stage = 'WON' where id = 'ld-2';
select public.assert(count(*) = 0, 'management cannot change a stage')
  from public.leads where id = 'ld-2' and stage = 'WON';

select public.assert(count(*) = 0, 'management cannot read the audit log') from public.audit_log;

update public.app_settings set payload = '{"scoring":{"tampered":true}}'::jsonb;
select public.assert(
  (select payload from public.app_settings where id = 'singleton') = '{"scoring":{}}'::jsonb,
  'management cannot rewrite the scoring weights');

-- ===========================================================================
\echo '== admin: everything =='
select auth.become('admin@teal.test');
select public.assert(public.is_admin() = true, 'admin is admin');
select public.assert(count(*) = 3, 'admin sees every lead') from public.leads;

update public.leads set owner_id = 'u-arun' where id = 'ld-1';
select public.assert(count(*) = 1, 'admin can reassign any lead')
  from public.leads where id = 'ld-1' and owner_id = 'u-arun';

insert into public.audit_log (id, action, entity, entity_id, actor, actor_id)
values ('au-1', 'lead_updated', 'lead', 'ld-1', 'admin@teal.test', 'u-admin');
select public.assert(count(*) = 1, 'admin can read the audit log') from public.audit_log;

\echo '== the audit log cannot be rewritten, by anyone =='
-- No update or delete policy exists on audit_log for any role, so both fail
-- for an administrator too. A log that can be edited proves nothing.
do $$ begin
  update public.audit_log set detail = 'tampered' where id = 'au-1';
  raise exception 'FAILED: audit log was editable';
exception
  when insufficient_privilege then raise notice '  ok  audit entries cannot be edited';
end $$;

do $$ begin
  delete from public.audit_log where id = 'au-1';
  raise exception 'FAILED: audit log was deletable';
exception
  when insufficient_privilege then raise notice '  ok  audit entries cannot be deleted';
end $$;

-- ===========================================================================
\echo '== duplicate detection reaches across books, narrowly =='
select auth.become('priya@teal.test');

-- ld-2 belongs to Arun and Priya cannot read it. She can still be told the
-- visitor in front of her is already logged, which is the entire point.
select public.assert(count(*) = 0, 'the colleague''s lead is still unreadable directly')
  from public.leads where id = 'ld-2';

select public.assert(
  (select lead_id from public.find_duplicate_lead('rakesh@helios.test', '')) = 'ld-2',
  'a colleague''s duplicate is found by email');
select public.assert(
  (select owner_name from public.find_duplicate_lead('rakesh@helios.test', '')) = 'Arun',
  'and it names who already owns it');
select public.assert(
  (select is_mine from public.find_duplicate_lead('rakesh@helios.test', '')) = false,
  'and reports it is not the caller''s');
select public.assert(
  (select is_mine from public.find_duplicate_lead('nisha@vertex.test', '')) = true,
  'the caller''s own lead reports as theirs');

-- The narrowness matters: no partial match, no wildcard, no empty-argument
-- enumeration of the whole table.
select public.assert(count(*) = 0, 'an empty query returns nothing')
  from public.find_duplicate_lead('', '');
select public.assert(count(*) = 0, 'a partial email returns nothing')
  from public.find_duplicate_lead('rakesh', '');
select public.assert(count(*) = 0, 'a wildcard returns nothing')
  from public.find_duplicate_lead('%', '');
select public.assert(count(*) = 0, 'a short phone fragment returns nothing')
  from public.find_duplicate_lead('', '99');

\echo '== lead codes are allocated by the database =='
select public.assert(public.next_lead_code('ex-1') = 'TEAL-EX1-00004',
                     'the next code follows the highest already issued');
-- Counting rows instead of reading the maximum would reissue a deleted number.
select public.assert(
  public.next_lead_code('ex-1') = public.next_lead_code('ex-1'),
  'allocation is stable until a lead actually lands');

-- ===========================================================================
\echo '== signed out: nothing at all =='
select set_config('request.jwt.claim.sub', '', false);
select public.assert(public.current_profile_id() is null, 'no profile without a session');
select public.assert(count(*) = 0, 'no leads without a session')    from public.leads;
select public.assert(count(*) = 0, 'no contacts without a session') from public.contacts;

-- A deactivated account keeps its rows but loses its session.
set role postgres;
update public.profiles set active = false where id = 'u-arun';
set role authenticated;
select auth.become('arun@teal.test');
select public.assert(public.current_profile_id() is null, 'a deactivated user resolves to no profile');
select public.assert(count(*) = 0, 'a deactivated user sees no leads') from public.leads;

set role postgres;
\echo ''
\echo 'All row-level security tests passed.'
