-- auth_probe(p_email) -> { known, password }
-- Powers the email-first login card on /register/account.html: after the
-- parent types their email, the card shows password login only if a password
-- actually exists, otherwise falls straight to the 8-digit code flow.
--
-- "Has a password" CANNOT be read from encrypted_password: GoTrue stores a
-- placeholder hash for every user, including code-only sign-ups (verified
-- Aug 16 2026 — all 348 users had one, which briefly routed every family to
-- the password step). Instead the card stamps raw_user_meta_data.pw_set='1'
-- whenever a parent deliberately saves a password, and that stamp is the
-- only thing this probe trusts.
--
-- Service-role only: called from reg-account.mjs (action "probe"), never
-- from the browser.
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
        and u.raw_user_meta_data->>'pw_set' = '1'
    )
  );
$$;

revoke all on function public.auth_probe(text) from public;
revoke all on function public.auth_probe(text) from anon;
revoke all on function public.auth_probe(text) from authenticated;
grant execute on function public.auth_probe(text) to service_role;
