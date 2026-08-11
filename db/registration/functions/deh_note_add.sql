-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.deh_note_add(p_note_id text, p_day date, p_dept text, p_body text, p_author text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into deh_notes (note_id, day, dept, body, author)
  values (p_note_id, p_day, coalesce(nullif(trim(p_dept), ''), 'general'),
          trim(p_body), nullif(trim(p_author), ''))
  on conflict (note_id) do update set
    dept = excluded.dept, body = excluded.body, author = excluded.author;
$function$

