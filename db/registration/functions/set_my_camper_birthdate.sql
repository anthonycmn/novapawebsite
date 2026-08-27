-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- TIGHTENED 2026-08-27, same reason as update_my_camper_v2: this wrote a
-- child's birthdate onto any same-named child in any family. Scoped to the
-- caller's own household (their family row plus any row linked by
-- email/cc_email).

CREATE OR REPLACE FUNCTION public.set_my_camper_birthdate(p_name text, p_birthdate date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fid families.id%type;
  v_emails text[];
begin
  if nullif(lower(coalesce(auth.jwt()->>'email','')), '') is null then return; end if;
  fid := my_family_id();
  if fid is null or p_name is null or p_birthdate is null then return; end if;

  select array_remove(array_remove(array[lower(btrim(email)), lower(btrim(cc_email))], null), '')
    into v_emails
    from families where id = fid;

  update campers c set birthdate = p_birthdate
  where lower(btrim(c.name)) = lower(btrim(p_name))
    and (
      c.family_id = fid
      or c.family_id in (
        select f.id from families f
         where lower(btrim(f.email)) = any(v_emails)
            or lower(btrim(f.cc_email)) = any(v_emails)
      )
    )
    and (c.family_id = fid or c.birthdate is null or c.birthdate = p_birthdate);

  if not exists (select 1 from campers where family_id=fid and lower(btrim(name))=lower(btrim(p_name))) then
    insert into campers(family_id, name, birthdate, source) values (fid, btrim(p_name), p_birthdate, 'web');
  end if;
end $function$
