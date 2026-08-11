-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.set_my_camper_birthdate(p_name text, p_birthdate date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fid families.id%type;
begin
  fid := my_family_id();
  if fid is null or p_name is null or p_birthdate is null then return; end if;
  update campers set birthdate = p_birthdate
  where lower(btrim(name)) = lower(btrim(p_name))
    and (family_id = fid or birthdate is null or birthdate = p_birthdate);
  if not exists (select 1 from campers where family_id=fid and name=p_name) then
    insert into campers(family_id, name, birthdate, source) values (fid, p_name, p_birthdate, 'web');
  end if;
end $function$

