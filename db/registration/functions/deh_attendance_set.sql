-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.deh_attendance_set(p_day date, p_person_id text, p_status text, p_note text, p_by text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into deh_attendance (day, person_id, status, note, updated_by, updated_at)
  values (p_day, p_person_id, coalesce(nullif(trim(p_status), ''), 'present'),
          nullif(trim(p_note), ''), nullif(trim(p_by), ''), now())
  on conflict (day, person_id) do update set
    status = excluded.status, note = excluded.note,
    updated_by = excluded.updated_by, updated_at = now();
$function$

