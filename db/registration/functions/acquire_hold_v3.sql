-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.acquire_hold_v3(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text; r record;
begin
  v_email := lower(coalesce(auth.jwt()->>'email',''));
  if v_email <> '' then
    for r in select it->>'show' s, (it->>'activity_id') aid, it->>'camper' c
             from jsonb_array_elements(p_items) it
             where (it->>'camper') is not null loop
      -- Hard-block ONLY on a real completed web order for this family + camper +
      -- same show/activity. Import flags (sawyer/regpack already_registered) are
      -- unreliable (abandoned carts) and no longer block — see Madison Choi 7/22.
      if exists (
        select 1 from order_items oi
        join orders o on o.id = oi.order_id
        where lower(o.email) = v_email
          and lower(btrim(oi.camper_name)) = lower(btrim(r.c))
          and (
            (r.s is not null and oi.show = r.s)
            or (r.aid is not null and oi.activity_id = r.aid::bigint)
          )
      ) then
        raise exception 'DUPLICATE:%:%', coalesce(r.s, 'act'||r.aid), r.c;
      end if;
    end loop;
  end if;
  return acquire_hold_v2(p_items);
end $function$

