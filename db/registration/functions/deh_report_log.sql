-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.deh_report_log(p_day date, p_by text, p_to text, p_summary jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into deh_reports (day, sent_at, sent_by, sent_to, summary)
  values (p_day, now(), nullif(trim(p_by), ''), p_to, p_summary)
  on conflict (day) do update set
    sent_at = now(), sent_by = excluded.sent_by,
    sent_to = excluded.sent_to, summary = excluded.summary;
$function$

