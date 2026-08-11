-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.admin_campers()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not is_admin() then null else (
    select jsonb_agg(j order by j->>'name') from (
      select jsonb_build_object(
        'name', min(c.name),
        'emails', array_agg(distinct f.email),
        'bday', max(c.birthdate),
        'sources', array_agg(distinct coalesce(c.source,'web')),
        'profile', (array_agg(coalesce(c.profile,'{}'::jsonb) order by length(coalesce(c.profile,'{}'::jsonb)::text) desc))[1],
        'allergies', max(c.allergies),
        'emergency', max(c.emergency_contact),
        'registered', (array_agg(to_jsonb(coalesce(c.already_registered,'{}'::text[])) order by coalesce(array_length(c.already_registered,1),0) desc))[1]
      ) j
      from campers c join families f on f.id = c.family_id
      group by lower(btrim(c.name)), c.birthdate
    ) t
  ) end;
$function$

