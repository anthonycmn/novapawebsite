-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.admin_inventory()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'summer', (select jsonb_agg(jsonb_build_object('show', show, 'band', band, 'cap', cap,
               'booked', booked, 'held', held_count(show, band)) order by show, band) from inventory),
    'summer_regpack', (select jsonb_object_agg(show, cnt) from regpack_enrollments where show is not null),
    'activities', (select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name,
                   'category', a.category, 'schedule', a.schedule_name, 'age', a.age_range,
                   'open_spots', a.open_spots, 'sold', a.sold, 'bb_gated', a.bb_gated,
                   -- Sawyer sold + Regpack, frozen at the cutover. This is the
                   -- one true offline count; open_spots below is Sawyer's own
                   -- field and is unreliable (it reads 663 for a 50 seat show).
                   'booked_offline', coalesce(a.booked_offline, 0),
                   'price_cents', a.price_cents, 'raw_in_progress', a.raw->>'in_progress',
                   'capacity', a.capacity,
                   'sessions', case when jsonb_typeof(a.raw->'class_times')='array' then jsonb_array_length(a.raw->'class_times') else null end,
                   'regpack', coalesce((select sum(e.cnt) from regpack_enrollments e
                      where e.activity_name is not null
                        and lower(regexp_replace(a.name,'[^a-z0-9]','','gi')) = lower(regexp_replace(e.activity_name,'[^a-z0-9]','','gi'))),0))
                   order by a.category, a.name) from activities a where a.active)
  );
end;
$function$

