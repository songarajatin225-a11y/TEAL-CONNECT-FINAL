-- ===========================================================================
-- Server-side functions the client calls by name.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- find_duplicate_lead
--
-- The browser's findDuplicate() scans the leads already in memory. Under row-
-- level security that set is only the caller's own book, which means it misses
-- the one duplicate that actually costs money: the same visitor written down
-- twice by two people working the same stand at the same time. Neither of them
-- can see the other's leads, so neither gets warned.
--
-- This runs as the definer so it can look across every lead, and returns a
-- deliberately narrow row: enough to say "Nisha Banerjee from Vertex is
-- already logged, Priya owns it, it is at Proposal" and no more. No value, no
-- notes, no contact details, no requirement.
--
-- That is a considered trade-off rather than an oversight. It tells a sales
-- user a fact about a person standing in front of them, which is the whole
-- point of the check, and it is strictly less than the industry-wide company
-- directory they can already read. What it does not do is let someone page
-- through a colleague's pipeline: it answers only for an exact email or an
-- exact ten-digit phone match that the caller already had to know to ask.
-- ---------------------------------------------------------------------------
create or replace function public.find_duplicate_lead(
  p_email      text default '',
  p_phone_tail text default ''
)
returns table (
  lead_id      text,
  code         text,
  stage        text,
  company_name text,
  contact_name text,
  owner_id     text,
  owner_name   text,
  is_mine      boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    l.id,
    l.code,
    l.stage::text,
    co.name,
    ct.name,
    l.owner_id,
    p.name,
    l.owner_id = public.current_profile_id()
  from public.leads l
  join public.contacts ct on ct.id = l.contact_id
  left join public.companies co on co.id = l.company_id
  left join public.profiles  p  on p.id  = l.owner_id
  where
    -- Only ever an exact match on something the caller already typed in.
    -- No prefix search, no fuzzy match, nothing that can be walked.
    public.current_profile_id() is not null
    and (
      (nullif(btrim(p_email), '') is not null
       and lower(btrim(ct.email)) = lower(btrim(p_email)))
      or
      (length(btrim(p_phone_tail)) = 10
       and right(regexp_replace(ct.phone, '\D', '', 'g'), 10) = btrim(p_phone_tail))
    )
  order by l.captured_at desc
  limit 1
$$;

revoke execute on function public.find_duplicate_lead(text, text) from public, anon;
grant  execute on function public.find_duplicate_lead(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- next_lead_code
--
-- Lead codes were generated per device, so two tablets at one booth would both
-- hand out TEAL-PROD26-00042 and one of them would lose. Sequence allocation
-- belongs on the one machine that can see every lead.
--
-- The unique index on leads.code is what actually guarantees it; this makes
-- collisions not happen in the first place rather than surfacing as a failed
-- save in front of a visitor.
-- ---------------------------------------------------------------------------
create or replace function public.next_lead_code(p_exhibition_id text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ex_code text;
  seq     integer;
begin
  select e.code into ex_code from public.exhibitions e where e.id = p_exhibition_id;
  if ex_code is null then
    raise exception 'next_lead_code: unknown exhibition %', p_exhibition_id;
  end if;

  -- Take the highest number already issued for this exhibition rather than
  -- counting rows: counting reuses a number as soon as a lead is deleted.
  select coalesce(max(substring(l.code from '(\d+)$')::integer), 0) + 1
    into seq
  from public.leads l
  where l.exhibition_id = p_exhibition_id;

  return 'TEAL-' || ex_code || '-' || lpad(seq::text, 5, '0');
end $$;

revoke execute on function public.next_lead_code(text) from public, anon;
grant  execute on function public.next_lead_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Notification read state, resolved per caller.
--
-- notifications.read is a single flag on a row several people can see, so it
-- cannot answer "have I read this". This view does.
-- ---------------------------------------------------------------------------
create or replace view public.notifications_for_me
with (security_invoker = true)
as
  select
    n.*,
    (n.read or r.notification_id is not null) as read_by_me
  from public.notifications n
  left join public.notification_reads r
    on r.notification_id = n.id
   and r.profile_id = public.current_profile_id();

grant select on public.notifications_for_me to authenticated;
