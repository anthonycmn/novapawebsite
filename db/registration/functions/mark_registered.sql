-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres
--
-- AHEAD OF PRODUCTION as of Sep 21 2026. The two `family_id = fid` predicates
-- below are NOT in the live function yet. They are proposed in
-- db/registration/mark-registered-family-scope.sql and wait on CJ's go. Until
-- that migration is applied, live still writes already_registered onto every
-- camper of that name in any family. Delete this note when it lands and this
-- file is a true export again.

CREATE OR REPLACE FUNCTION public.mark_registered(p_email text, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fid uuid; r record; slug text;
begin
  -- 2026-08-27: an empty p_email used to match every family whose cc_email is
  -- null (the '' = '' trap that misfiled campers). Refuse it outright.
  if nullif(lower(btrim(coalesce(p_email,''))), '') is null then return; end if;
  select id into fid from (
    select id, 1 as pri from families where lower(email) = lower(p_email)
    union all
    select id, 2 from families where lower(coalesce(cc_email,'')) = lower(p_email)
  ) t order by pri limit 1;
  if fid is null then return; end if;
  for r in select it->>'show' s, it->>'camper' c from jsonb_array_elements(p_items) it
           where (it->>'show') is not null loop
    -- 2026-09-21: family_id = fid. Without it this wrote onto every camper of
    -- that name in any family, and the match made `not found` false so the
    -- paying household never got a camper row of its own.
    update campers set already_registered =
      (select array_agg(distinct x) from unnest(coalesce(already_registered,'{}') || array[r.s]) x)
    where family_id = fid and lower(btrim(name)) = lower(btrim(r.c));
    if not found then
      insert into campers(family_id, name, already_registered, source)
      values (fid, r.c, array[r.s], 'web');
    end if;
  end loop;
  -- fall/year-round shows + day camps count too; classes never do
  for r in select (it->>'activity_id')::bigint aid, it->>'camper' c from jsonb_array_elements(p_items) it
           where (it->>'activity_id') is not null and (it->>'camper') is not null loop
    select case when a.name ~* 'frozen' then 'frozen'
                when a.name ~* 'mermaid' then 'mermaid'
                when a.category = 'class' then null
                else 'act' || a.id::text end
      into slug from activities a where a.id = r.aid;
    if slug is null then continue; end if;
    -- 2026-09-21: family_id = fid, same reason as the loop above.
    update campers set already_registered =
      (select array_agg(distinct x) from unnest(coalesce(already_registered,'{}') || array[slug]) x)
    where family_id = fid and lower(btrim(name)) = lower(btrim(r.c));
    if not found then
      insert into campers(family_id, name, already_registered, source)
      values (fid, r.c, array[slug], 'web');
    end if;
  end loop;
end $function$

