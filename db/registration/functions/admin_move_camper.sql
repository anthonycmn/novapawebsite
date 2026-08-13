-- Move one paid seat (an order_items row) to a different session: summer camps
-- addressed by (show, band), everything else by activity_id. Transactional:
-- frees the old seat's counter and camper slug, capacity-checks and takes the
-- new one, rewrites the item, and records the move in admin_actions. Money is
-- untouched — a move is a seat swap, price differences are handled as coupons
-- or refunds separately. p_force skips the capacity check (Todd overselling a
-- class on purpose). Called service-role only from reg-admin-ops.
CREATE OR REPLACE FUNCTION public.admin_move_camper(
  p_item_id uuid, p_show text, p_band text, p_activity_id bigint,
  p_actor text, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  oi order_items%rowtype;
  o orders%rowtype;
  v_avail int;
  v_from text; v_to text;
  old_slug text; new_slug text;
begin
  select * into oi from order_items where id = p_item_id;
  if oi.id is null then return jsonb_build_object('error','item not found'); end if;
  select * into o from orders where id = oi.order_id;

  if (p_show is null) = (p_activity_id is null) then
    return jsonb_build_object('error','pick exactly one target: show+band or activity');
  end if;
  if p_show is not null and oi.show = p_show and oi.band = p_band then
    return jsonb_build_object('error','already in that session');
  end if;
  if p_activity_id is not null and oi.activity_id = p_activity_id then
    return jsonb_build_object('error','already in that session');
  end if;

  -- capacity on the target
  if p_show is not null then
    select cap - booked into v_avail from inventory where show = p_show and band = p_band;
    if v_avail is null then return jsonb_build_object('error','no such summer session'); end if;
    v_to := p_show || ' · ' || p_band;
  else
    select a.capacity - a.sold - coalesce(a.booked_offline,0), a.name
      into v_avail, v_to from activities a where a.id = p_activity_id;
    if v_avail is null then return jsonb_build_object('error','no such activity'); end if;
  end if;
  if v_avail <= 0 and not p_force then
    return jsonb_build_object('error','target is full', 'needs_force', true);
  end if;

  -- free the old seat
  if oi.show is not null then
    update inventory set booked = greatest(0, booked - 1) where show = oi.show and band = oi.band;
    v_from := oi.show || ' · ' || oi.band;
    old_slug := oi.show;
  elsif oi.activity_id is not null then
    update activities set sold = greatest(0, sold - 1) where id = oi.activity_id;
    select case when a.name ~* 'frozen' then 'frozen'
                when a.name ~* 'mermaid' then 'mermaid'
                when a.category = 'class' then null
                else 'act' || a.id::text end,
           a.name
      into old_slug, v_from from activities a where a.id = oi.activity_id;
  end if;

  -- take the new one
  if p_show is not null then
    update inventory set booked = booked + 1 where show = p_show and band = p_band;
    new_slug := p_show;
  else
    update activities set sold = sold + 1 where id = p_activity_id;
    select case when a.name ~* 'frozen' then 'frozen'
                when a.name ~* 'mermaid' then 'mermaid'
                when a.category = 'class' then null
                else 'act' || a.id::text end
      into new_slug from activities a where a.id = p_activity_id;
  end if;

  -- swap the camper's already-registered slugs (matched by name, as everywhere)
  if old_slug is not null then
    update campers set already_registered =
      coalesce((select array_agg(x) from unnest(coalesce(already_registered,'{}')) x where x <> old_slug), '{}')
    where lower(btrim(name)) = lower(btrim(oi.camper_name)) and already_registered @> array[old_slug];
  end if;
  if new_slug is not null then
    update campers set already_registered = already_registered || new_slug
    where lower(btrim(name)) = lower(btrim(oi.camper_name))
      and not (coalesce(already_registered,'{}') @> array[new_slug]);
  end if;

  update order_items set show = p_show, band = p_band, activity_id = p_activity_id
  where id = p_item_id;

  insert into admin_actions (action, actor, payload) values ('move_camper', p_actor,
    jsonb_build_object('item_id', p_item_id, 'camper', oi.camper_name, 'email', o.email,
      'from', v_from, 'to', v_to, 'forced', p_force and v_avail <= 0));

  return jsonb_build_object('ok', true, 'camper', oi.camper_name, 'from', v_from, 'to', v_to);
end $function$;
REVOKE EXECUTE ON FUNCTION public.admin_move_camper(uuid, text, text, bigint, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_move_camper(uuid, text, text, bigint, text, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_camper(uuid, text, text, bigint, text, boolean) TO service_role;
