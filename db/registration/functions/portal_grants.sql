-- Catalogue-writing portal functions must not be callable without a login.
-- They were created with Supabase's default EXECUTE grant to anon. The
-- internal is_chief() gate already refuses anonymous callers (no session ->
-- no portal_users row -> no role), so this is hardening, not a live hole:
-- an unauthenticated request should be refused at the door, not by the gate.
-- activity_facts and catalog_list keep anon on purpose — checkout and the
-- register page call them with the anon key.
revoke execute on function public.portal_save_activity(jsonb) from anon;
revoke execute on function public.portal_list_activities() from anon;
revoke execute on function public.portal_may_write_catalogue() from anon;
