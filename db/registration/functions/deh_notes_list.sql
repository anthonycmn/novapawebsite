-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.deh_notes_list(p_day date)
 RETURNS SETOF deh_notes
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from deh_notes where day = p_day order by created_at;
$function$

