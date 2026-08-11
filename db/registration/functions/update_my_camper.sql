-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.update_my_camper(p_name text, p_birthdate date, p_allergies text, p_emergency text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_fam uuid;
begin
  if v_email = '' then raise exception 'not authenticated'; end if;
  v_fam := my_family_id();
  if v_fam is null then
    insert into families (email) values (v_email)
    on conflict (email) do nothing;
    v_fam := my_family_id();
  end if;
  insert into campers (family_id, name, birthdate, allergies, emergency_contact)
  select v_fam, p_name, p_birthdate, p_allergies, p_emergency
  where not exists (select 1 from campers where family_id = v_fam and name = p_name);
  update campers c set birthdate = coalesce(p_birthdate, c.birthdate),
    allergies = coalesce(p_allergies, c.allergies),
    emergency_contact = coalesce(p_emergency, c.emergency_contact)
  where c.family_id = v_fam and c.name = p_name;
end;
$function$

