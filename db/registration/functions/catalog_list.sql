-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.catalog_list(p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(id bigint, category text, name text, schedule_name text, age_range text, pricing text[], price_cents integer, open_spots integer, pdp_url text, image_url text, widget_tags text[], bb_gated boolean, bookable boolean, remaining integer, gate_open boolean, class_times jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.category, a.name, a.schedule_name, a.age_range, a.pricing, a.price_cents,
         a.open_spots, a.pdp_url, a.image_url, a.widget_tags, a.bb_gated, a.bookable,
         case when a.capacity is null then null
              else greatest(0, a.capacity - a.sold - a.booked_offline - held_count_activity(a.id)) end,
         is_gate_open(),
         a.class_times
  from activities a
  where a.active and (not a.hidden or a.id = any(coalesce(p_ids, '{}'::bigint[])))
  order by a.category, a.name;
$function$

