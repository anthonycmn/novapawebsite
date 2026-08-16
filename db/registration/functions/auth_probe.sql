-- auth_probe(p_email) -> { known, password }
-- Powers the email-first login card on /register/account.html: after the
-- parent types their email, the card shows password login only if a password
-- actually exists, otherwise falls straight to the 8-digit code flow.
-- encrypted_password lives in auth.users, which the admin REST API does not
-- expose, hence this security-definer function. Service-role only: it is
-- called from reg-account.mjs (action "probe"), never from the browser.
create or replace function public.auth_probe(p_email text)
returns json
language sql
security definer
set search_path = public, auth
as $$
  select json_build_object(
    'known', exists (select 1 from auth.users u where lower(u.email) = lower(p_email)),
    'password', exists (
      select 1 from auth.users u
      where lower(u.email) = lower(p_email)
        and u.encrypted_password is not null
        and u.encrypted_password <> ''
    )
  );
$$;

revoke all on function public.auth_probe(text) from public;
revoke all on function public.auth_probe(text) from anon;
revoke all on function public.auth_probe(text) from authenticated;
grant execute on function public.auth_probe(text) to service_role;
