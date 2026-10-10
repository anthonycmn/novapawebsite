-- The text of the terms each family agreed to (Oct 9 2026, Todd: "when
-- parents sign the terms and conditions as written we need the system to
-- capture what is in the terms and conditions").
--
-- Builds on public.terms_acceptances, created Sep 30 2026 for the parent-
-- portal front door (db/terms-acceptances.sql on unify-catalog, PR #168, applied
-- that day on CJ's OK). That table records who, when, and a version LABEL
-- the app sends ("novapa-terms-2026-09-30"), one row per Stripe intent. A
-- label says which version, but not what it said, and nothing on the website
-- checkout wrote to it.
--
-- This adds the words themselves:
--
-- terms_versions holds the full text of every version ever served, keyed by
-- a hash of the text: /terms, the Terms & Conditions section of /policies,
-- and the exact checkbox sentence on /register. A row is written the first
-- time any code sees that text (reg-terms.mjs) and never edited after,
-- except for the two watch columns below.
--
-- terms_acceptances gains terms_hash (which of those texts), hold_id, and
-- the checkout's IP and browser. reg-webhook (paid) and reg-pay ($0) write
-- the row after confirm_order, keyed by the same stripe_intent the front
-- door uses ("free_<hold>" for $0 orders), so the two writers meet on one
-- row instead of making two.
--
-- went_live_at / notice_campaign_id belong to reg-terms-watch: the daily
-- check that notices production serving a new version and drafts the notice
-- to registered families as a 'draft' campaign. A person sends it.
--
-- RLS on, no policies: only the service key writes or reads directly.
-- Admins read through the two is_admin()-gated functions at the bottom.
--
-- Safe to re-run.

create table if not exists public.terms_versions (
  hash               text primary key,      -- sha256 hex of the three texts
  captured_at        timestamptz not null default now(),
  source_url         text not null,         -- the deploy the text was read from
  terms_text         text not null,         -- /terms, legal content only
  policies_text      text not null,         -- /policies, Terms & Conditions section
  checkbox_text      text not null,         -- the "I agree" sentence at checkout
  went_live_at       timestamptz,           -- first seen on production by the watch
  notice_campaign_id uuid,                  -- the draft notice, when one was made
  is_baseline        boolean not null default false  -- first version: no notice
);
alter table public.terms_versions enable row level security;
revoke all on public.terms_versions from anon, authenticated;

alter table public.terms_acceptances
  add column if not exists terms_hash  text references public.terms_versions(hash),
  add column if not exists hold_id     uuid,
  add column if not exists checkout_ip text,
  add column if not exists user_agent  text;
create index if not exists terms_acceptances_hash_idx on public.terms_acceptances (terms_hash);
create index if not exists terms_acceptances_order_idx on public.terms_acceptances (order_id);

-- Who agreed to what. p_q null or blank = the latest 200; otherwise matches
-- email or parent name.
create or replace function public.admin_terms_acceptances(p_q text default null)
 returns table(agreed_at timestamptz, email text, parent_name text, order_no bigint,
               order_id uuid, terms_version text, terms_hash text,
               version_captured_at timestamptz, source text, checkout_ip text, user_agent text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not is_admin() then return; end if;
  return query
    select a.accepted_at, a.email, o.parent_name, o.order_no, a.order_id, a.terms_version,
           a.terms_hash, v.captured_at, a.source, a.checkout_ip, a.user_agent
      from terms_acceptances a
      left join orders o on o.id = a.order_id
      left join terms_versions v on v.hash = a.terms_hash
     where nullif(trim(coalesce(p_q, '')), '') is null
        or a.email ilike '%' || trim(p_q) || '%'
        or o.parent_name ilike '%' || trim(p_q) || '%'
     order by a.accepted_at desc
     limit 200;
end; $function$;
revoke execute on function public.admin_terms_acceptances(text) from public;
grant execute on function public.admin_terms_acceptances(text) to authenticated, service_role;

-- The full text of one version, for the admin "view" link.
create or replace function public.admin_terms_version(p_hash text)
 returns table(hash text, captured_at timestamptz, went_live_at timestamptz,
               terms_text text, policies_text text, checkbox_text text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not is_admin() then return; end if;
  return query
    select v.hash, v.captured_at, v.went_live_at, v.terms_text, v.policies_text, v.checkbox_text
      from terms_versions v where v.hash = p_hash;
end; $function$;
revoke execute on function public.admin_terms_version(text) from public;
grant execute on function public.admin_terms_version(text) to authenticated, service_role;

do $chk$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.terms_versions'::regclass) then
    raise exception 'terms_versions: RLS is off';
  end if;
  if has_table_privilege('anon', 'public.terms_versions', 'select')
     or has_table_privilege('authenticated', 'public.terms_versions', 'select') then
    raise exception 'terms_versions: anon/authenticated can still reach it';
  end if;
end
$chk$;
