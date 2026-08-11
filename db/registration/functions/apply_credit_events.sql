-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.apply_credit_events(p_pi text, p_email text, p_detail jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g record; v_fam uuid;
begin
  insert into credit_events (payment_intent, email, detail)
  values (p_pi, lower(p_email), p_detail)
  on conflict (payment_intent) do nothing;
  if not found then return; end if;
  select id into v_fam from families where lower(email) = lower(p_email) limit 1;
  if v_fam is null then return; end if;
  for g in select * from jsonb_to_recordset(coalesce(p_detail->'grants','[]'::jsonb))
           as x(camper text, day int, snow int) loop
    update campers set day_camp_credits = day_camp_credits + coalesce(g.day, 0),
                       snow_day_credits = snow_day_credits + coalesce(g.snow, 0)
    where family_id = v_fam and lower(name) = lower(g.camper);
  end loop;
  for g in select * from jsonb_to_recordset(coalesce(p_detail->'redemptions','[]'::jsonb))
           as x(camper text, day int, snow int) loop
    update campers set day_camp_credits = greatest(0, day_camp_credits - coalesce(g.day, 0)),
                       snow_day_credits = greatest(0, snow_day_credits - coalesce(g.snow, 0))
    where family_id = v_fam and lower(name) = lower(g.camper);
  end loop;
end $function$

