-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.admin_camper_history(p_name text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not is_admin() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'source', e.source, 'order_ref', e.order_ref, 'email', e.email,
      'activity', e.activity_text, 'activity_id', e.activity_id,
      'show', e.show, 'dates', e.dates, 'paid_cents', e.paid_cents))
    from legacy_enrollments e
    where lower(e.camper_name) = lower(p_name)), '[]'::jsonb) end;
$function$

