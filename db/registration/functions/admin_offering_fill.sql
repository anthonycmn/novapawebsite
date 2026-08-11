-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.admin_offering_fill()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select case when not is_admin() then '[]'::jsonb else jsonb_build_array(
  jsonb_build_object('label','Summer Camps',
    'cap',(select sum(cap) from inventory where show in ('httyd','charlie','trolls')),
    'taken',(select sum(booked) from inventory where show in ('httyd','charlie','trolls'))),
  jsonb_build_object('label','Mean Girls',
    'cap',(select coalesce(sum(capacity),0) from activities where id in (990001,990002)),
    'taken',(select coalesce(sum(sold+booked_offline),0) from activities where id in (990001,990002))),
  jsonb_build_object('label','Frozen',
    'cap',(select coalesce(sum(capacity),0) from activities where id in (1959789,1959787,1959805)),
    'taken',(select coalesce(sum(sold+booked_offline),0) from activities where id in (1959789,1959787,1959805))),
  jsonb_build_object('label','Little Mermaid',
    'cap',(select coalesce(sum(capacity),0) from activities where id in (1959850,1959854,1959851)),
    'taken',(select coalesce(sum(sold+booked_offline),0) from activities where id in (1959850,1959854,1959851))),
  jsonb_build_object('label','Teen Conservatory',
    'cap',(select coalesce(sum(capacity),0) from activities where id in (1960809,1960811,1805731)),
    'taken',(select coalesce(sum(sold+booked_offline),0) from activities where id in (1960809,1960811,1805731))),
  jsonb_build_object('label','Day Camps',
    'cap',(select coalesce(sum(capacity),0) from activities where category='camp' and bookable and coalesce(price_cents,0) <= 20000 and coalesce(price_cents,0) > 0),
    'taken',(select coalesce(sum(sold+booked_offline),0) from activities where category='camp' and bookable and coalesce(price_cents,0) <= 20000 and coalesce(price_cents,0) > 0)),
  jsonb_build_object('label','Classes',
    'cap',(select coalesce(sum(capacity),0) from activities where category='class' and bookable),
    'taken',(select coalesce(sum(sold+booked_offline),0) from activities where category='class' and bookable))
) end;
$function$

