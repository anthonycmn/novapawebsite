-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.held_count(p_show text, p_band text)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select count(*)::int
  from holds h, jsonb_array_elements(h.items) it
  where h.status = 'active' and h.expires_at > now()
    and it->>'show' = p_show and it->>'band' = p_band;
$function$

