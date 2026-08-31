
alter table public.admin_emails add column if not exists role text not null default 'full';
insert into public.admin_emails (email, role) values ('katie@novapa.org','ops') on conflict (email) do update set role='ops';
-- Role probe for the dashboard and for money/marketing functions.
-- 'full' = everything. 'ops' = leads + registration management + camper info
-- (Katie, Director of Public Safety, Aug 31 2026). is_admin() stays true for
-- BOTH roles so the registration/camper RPCs keep working for ops; anything
-- money or marketing must check admin_role() = 'full' instead.
create or replace function public.admin_role() returns text
language sql stable security definer set search_path to 'public'
as $$
  select role from admin_emails
   where email = nullif(lower(coalesce(auth.jwt()->>'email','')), '');
$$;
grant execute on function public.admin_role to authenticated;
select email, role from public.admin_emails order by email;
