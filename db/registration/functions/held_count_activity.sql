-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.held_count_activity(p_activity_id bigint)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select count(*)::int from holds h, jsonb_array_elements(h.items) it
  where h.status = 'active' and h.expires_at > now()
    and (it->>'activity_id')::bigint = p_activity_id;
$function$

