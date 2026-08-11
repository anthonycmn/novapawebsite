-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.acquire_hold_v2(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_hold_id uuid;
  v_expires timestamptz := now() + interval '30 minutes';
  r record;
  v_avail int;
  v_cap int;
  v_gated boolean;
  v_known boolean;
begin
  if v_email = '' then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 12 then
    raise exception 'invalid items';
  end if;

  -- gate check: BB items require returning family before Aug 1
  if not is_gate_open() then
    select exists(select 1 from jsonb_array_elements(p_items) it
                  join activities a on a.id = (it->>'activity_id')::bigint
                  where a.bb_gated) into v_gated;
    if v_gated then
      select exists(select 1 from families where lower(email) = v_email) into v_known;
      if not v_known then raise exception 'GATED'; end if;
    end if;
  end if;

  update holds set status = 'released' where email = v_email and status = 'active';

  -- summer-band items: existing inventory check
  for r in
    select it->>'show' as show, it->>'band' as band, count(*)::int as needed
    from jsonb_array_elements(p_items) it
    where it ? 'show'
    group by 1, 2
  loop
    select cap - booked - held_count(r.show, r.band) into v_avail
    from inventory where show = r.show and band = r.band for update;
    if v_avail is null then raise exception 'unknown show/band %/%', r.show, r.band; end if;
    if v_avail < r.needed then raise exception 'SOLD_OUT:%:%', r.show, r.band; end if;
  end loop;

  -- catalog items: capacity check only when capacity is set
  for r in
    select (it->>'activity_id')::bigint as aid, count(*)::int as needed
    from jsonb_array_elements(p_items) it
    where it ? 'activity_id'
    group by 1
  loop
    select capacity into v_cap from activities where id = r.aid and bookable for update;
    if not found then raise exception 'unknown activity %', r.aid; end if;
    if v_cap is not null then
      select v_cap - sold - booked_offline - held_count_activity(r.aid) into v_avail from activities where id = r.aid;
      if v_avail < r.needed then raise exception 'SOLD_OUT_ACTIVITY:%', r.aid; end if;
    end if;
  end loop;

  insert into holds (email, items, expires_at) values (v_email, p_items, v_expires)
  returning id into v_hold_id;
  return jsonb_build_object('hold_id', v_hold_id, 'expires_at', v_expires);
end;
$function$

