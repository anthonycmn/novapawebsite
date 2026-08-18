-- Every change to the shared catalogue, recorded by the database itself.
--
-- Exists because on 17 Aug 2026 our side unhid Sweeney/Hadestown (per CJ's
-- own request) without stamping updated_by; CJ's tooling saw an anonymous
-- flip, read it as a glitch, and reverted it — killing public registration
-- for an evening. Humans will not reliably announce changes to each other.
-- A trigger never forgets.
--
-- Both sides read this: our admin dashboard and CJ's portal can answer
-- "who changed this and when" without an email thread. Writes should still
-- stamp updated_by with a name ('jason', 'portal:<email>', 'reg-webhook');
-- the trigger records it either way, falling back to the database role.

create table if not exists public.activities_audit (
  id          bigint generated always as identity primary key,
  activity_id bigint not null,
  changed_at  timestamptz not null default now(),
  changed_by  text,
  changes     jsonb not null
);

create or replace function public.log_activity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  diff jsonb := '{}'::jsonb;
  k text;
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
begin
  for k in select jsonb_object_keys(n) loop
    if k in ('updated_at') then continue; end if;
    if o->k is distinct from n->k then
      diff := diff || jsonb_build_object(k, jsonb_build_object('from', o->k, 'to', n->k));
    end if;
  end loop;
  if diff = '{}'::jsonb then return NEW; end if;
  insert into public.activities_audit (activity_id, changed_by, changes)
  values (NEW.id, coalesce(NEW.updated_by, current_user), diff);
  return NEW;
end;
$$;

drop trigger if exists trg_activities_audit on public.activities;
create trigger trg_activities_audit
  after update on public.activities
  for each row execute function public.log_activity_change();

-- Reads for both sides' tooling; writes only through the trigger.
revoke all on table public.activities_audit from anon;
grant select on table public.activities_audit to authenticated, service_role;
