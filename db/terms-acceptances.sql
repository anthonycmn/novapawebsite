-- ---------------------------------------------------------------------------
-- terms_acceptances — who agreed to the terms and conditions, which version,
-- when, for which order.
-- ---------------------------------------------------------------------------
-- CJ, 30 Sep 2026: the checkout's "I agree to all terms and conditions" box
-- (the website's policies, photo release included — one box, his call) is to
-- be RECORDED. Until now it was enforced in the browser and saved nowhere.
--
-- Written only by reg-webhook and reg-pay (service role) through
-- reg-frontdoor.mjs recordTerms(); one row per Stripe intent, so a webhook
-- retry is a no-op. The staff portal and the family's portal read it later.
-- RLS on, no policies: nothing but the service role touches it.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------
create table if not exists public.terms_acceptances (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  order_id       uuid,
  stripe_intent  text not null unique,
  terms_version  text not null,
  source         text not null default 'register',
  accepted_at    timestamptz not null default now()
);
alter table public.terms_acceptances enable row level security;
create index if not exists terms_acceptances_email_idx on public.terms_acceptances (lower(email));
revoke all on public.terms_acceptances from anon, authenticated;

do $chk$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.terms_acceptances'::regclass) then
    raise exception 'terms_acceptances: RLS is off';
  end if;
  if has_table_privilege('anon', 'public.terms_acceptances', 'select')
     or has_table_privilege('authenticated', 'public.terms_acceptances', 'insert') then
    raise exception 'terms_acceptances: anon/authenticated can still reach it';
  end if;
end
$chk$;
