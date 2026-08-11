-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.deh_progress_set(p_block_id text, p_done boolean, p_by text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into deh_progress (block_id, done, done_by, done_at, updated_at)
  values (p_block_id, p_done, nullif(trim(p_by), ''), case when p_done then now() end, now())
  on conflict (block_id) do update set
    done       = excluded.done,
    done_by    = excluded.done_by,
    done_at    = excluded.done_at,
    updated_at = now();
$function$

