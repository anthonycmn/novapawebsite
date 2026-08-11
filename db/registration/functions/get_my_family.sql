-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.get_my_family()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_fam uuid := my_family_id();
  v_result jsonb;
begin
  if v_email = '' then raise exception 'not authenticated'; end if;
  select jsonb_build_object(
    'email', f.email,
    'parent_name', f.parent_name,
    'campers', coalesce((
       select jsonb_agg(jsonb_build_object(
         'name', c.name, 'age', c.age,
         'already_registered', c.already_registered,
         'day_camp_credits', c.day_camp_credits,
         'snow_day_credits', c.snow_day_credits,
         'verified', coalesce((
            select jsonb_agg(distinct v.show) from (
              select oi.show
              from order_items oi join orders o on o.id = oi.order_id
              where lower(o.email) in (lower(f.email), lower(coalesce(f.cc_email,'')))
                and o.status = 'paid'
                and lower(oi.camper_name) = lower(c.name) and oi.show is not null
              union
              select case when lower(a.name) like '%frozen%' then 'frozen'
                          when lower(a.name) like '%mermaid%' then 'mermaid' end
              from order_items oi join orders o on o.id = oi.order_id
                join activities a on a.id = oi.activity_id
              where lower(o.email) in (lower(f.email), lower(coalesce(f.cc_email,'')))
                and o.status = 'paid'
                and lower(oi.camper_name) = lower(c.name)
                and (lower(a.name) like '%frozen%' or lower(a.name) like '%mermaid%')
            ) v where v.show is not null), '[]'::jsonb))
         order by c.name)
       from campers c where c.family_id = f.id), '[]'::jsonb))
  into v_result
  from families f where f.id = v_fam;
  return coalesce(v_result, jsonb_build_object('email', v_email, 'parent_name', null, 'campers', '[]'::jsonb));
end;
$function$

