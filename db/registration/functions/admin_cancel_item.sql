-- Cancel one paid seat: frees its counter and camper slug and deletes the
-- order_items row, but KEEPS the order (it is the money record — the Stripe
-- refund happens in reg-admin-ops before this is called, and the order row
-- with its payment intent is the audit trail). Mirrors admin_delete_order's
-- unwind for a single item. Records the cancellation in admin_actions.
-- Called service-role only from reg-admin-ops.
CREATE OR REPLACE FUNCTION public.admin_cancel_item(p_item_id uuid, p_actor text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  oi order_items%rowtype;
  o orders%rowtype;
  slug text; what text;
  remaining int;
begin
  select * into oi from order_items where id = p_item_id;
  if oi.id is null then return jsonb_build_object('error','item not found'); end if;
  select * into o from orders where id = oi.order_id;

  if oi.show is not null then
    update inventory set booked = greatest(0, booked - 1) where show = oi.show and band = oi.band;
    slug := oi.show;
    what := oi.show || ' · ' || oi.band;
  elsif oi.activity_id is not null then
    update activities set sold = greatest(0, sold - 1) where id = oi.activity_id;
    select case when a.name ~* 'frozen' then 'frozen'
                when a.name ~* 'mermaid' then 'mermaid'
                when a.category = 'class' then null
                else 'act' || a.id::text end,
           a.name
      into slug, what from activities a where a.id = oi.activity_id;
  end if;

  if slug is not null then
    update campers set already_registered =
      coalesce((select array_agg(x) from unnest(coalesce(already_registered,'{}')) x where x <> slug), '{}')
    where lower(btrim(name)) = lower(btrim(oi.camper_name)) and already_registered @> array[slug];
  end if;

  delete from order_items where id = p_item_id;
  select count(*) into remaining from order_items where order_id = oi.order_id;

  insert into admin_actions (action, actor, payload) values ('cancel_item', p_actor,
    jsonb_build_object('item_id', p_item_id, 'camper', oi.camper_name, 'email', o.email,
      'what', what, 'paid_cents', oi.unit_price_cents, 'order_id', oi.order_id,
      'items_remaining', remaining, 'note', p_note));

  return jsonb_build_object('ok', true, 'camper', oi.camper_name, 'what', what,
    'email', o.email, 'items_remaining', remaining,
    'stripe_pi', o.stripe_payment_intent, 'stripe_schedule', o.stripe_schedule);
end $function$;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_item(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_item(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_item(uuid, text, text) TO service_role;
