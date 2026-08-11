-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.deh_roster_set(p_person_id text, p_name text, p_role text, p_kind text, p_sort integer, p_active boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into deh_roster (person_id, name, role, kind, sort, active, updated_at)
  values (p_person_id, trim(p_name), nullif(trim(p_role), ''),
          coalesce(nullif(trim(p_kind), ''), 'cast'), coalesce(p_sort, 100),
          coalesce(p_active, true), now())
  on conflict (person_id) do update set
    name = excluded.name, role = excluded.role, kind = excluded.kind,
    sort = excluded.sort, active = excluded.active, updated_at = now();
$function$

