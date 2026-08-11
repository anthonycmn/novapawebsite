-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.marketing_get()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not is_admin() then null else jsonb_build_object(
    'sequences', (select jsonb_agg(to_jsonb(s) order by s.seq, s.step) from email_sequences s),
    'pipeline', (select jsonb_agg(jsonb_build_object('seq', seq, 'stage', stage, 'status', status, 'n', n) order by seq, stage)
      from (select seq, stage, status, count(*) n from retarget_state group by 1,2,3) t),
    'recent', (select jsonb_agg(jsonb_build_object('email', r.email, 'seq', r.seq, 'stage', r.stage, 'status', r.status,
        'anchor', r.anchor_at, 'sent', r.last_sent_at, 'ctx', r.ctx) order by r.updated_at desc)
      from (select * from retarget_state order by updated_at desc limit 60) r)
  ) end;
$function$

