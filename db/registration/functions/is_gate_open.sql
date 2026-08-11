-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.is_gate_open()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ select now() >= '2026-08-01T10:00:00-04:00'::timestamptz; $function$

