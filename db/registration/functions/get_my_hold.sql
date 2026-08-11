-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.get_my_hold(p_hold_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', h.id, 'email', h.email, 'items', h.items,
                            'expires_at', h.expires_at, 'status', h.status)
  from holds h
  where h.id = p_hold_id and lower(h.email) = lower(coalesce(auth.jwt()->>'email',''));
$function$

