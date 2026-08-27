-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.update_my_camper_v2(p_name text, p_birthdate date, p_profile jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fam families.id%type;
  v_bday date;
  v_clean jsonb;
begin
  -- Defense in depth (2026-08-27): never act for an unauthenticated caller,
  -- even if my_family_id() were ever to resolve one again.
  if nullif(lower(coalesce(auth.jwt()->>'email','')), '') is null then return; end if;
  v_fam := my_family_id();
  if v_fam is null then return; end if;
  -- drop empty-string values so blank fields never clobber saved data
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_clean
    from jsonb_each(coalesce(p_profile,'{}'::jsonb))
   where value <> '""'::jsonb and value <> 'null'::jsonb;
  insert into campers (family_id, name, birthdate, source)
    select v_fam, btrim(p_name), p_birthdate, 'web'
    where not exists (select 1 from campers where family_id=v_fam and lower(btrim(name))=lower(btrim(p_name)));
  update campers c set
    birthdate = coalesce(p_birthdate, c.birthdate),
    profile = coalesce(c.profile,'{}'::jsonb) || v_clean
  where c.family_id=v_fam and lower(btrim(c.name))=lower(btrim(p_name));
  select coalesce(p_birthdate, max(c.birthdate)) into v_bday
    from campers c where c.family_id=v_fam and lower(btrim(c.name))=lower(btrim(p_name));
  -- propagate to the same kid under other family emails (compatible birthday only)
  update campers c set
    birthdate = coalesce(c.birthdate, v_bday),
    profile = coalesce(c.profile,'{}'::jsonb) || v_clean
  where c.family_id <> v_fam
    and lower(btrim(c.name))=lower(btrim(p_name))
    and (v_bday is null or c.birthdate is null or c.birthdate = v_bday);
end $function$

