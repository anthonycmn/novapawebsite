-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.admin_balances()
 RETURNS SETOF platform_balances
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return query select * from platform_balances order by balance_cents desc nulls last;
end;
$function$

