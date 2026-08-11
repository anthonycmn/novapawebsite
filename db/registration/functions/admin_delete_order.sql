-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.admin_delete_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order orders%rowtype;
  v_items jsonb;
  r record; slug text; n_unmarked int := 0; n_inv int := 0; n_sold int := 0;
begin
  if not is_admin() then return jsonb_build_object('error','not admin'); end if;
  select * into v_order from orders where orders.id = p_order_id;
  if v_order.id is null then return jsonb_build_object('error','order not found'); end if;
  select h.items into v_items from holds h where h.id = v_order.hold_id;

  for r in select it->>'show' s, it->>'band' b, (it->>'activity_id')::bigint aid, it->>'camper' c
           from jsonb_array_elements(coalesce(v_items,'[]'::jsonb)) it
           where (it->>'camper') is not null loop
    if r.s is not null then
      slug := r.s;
      update inventory set booked = greatest(0, booked - 1) where show = r.s and band = r.b;
      n_inv := n_inv + 1;
    elsif r.aid is not null then
      select case when a.name ~* 'frozen' then 'frozen'
                  when a.name ~* 'mermaid' then 'mermaid'
                  when a.category = 'class' then null
                  else 'act' || a.id::text end into slug
        from activities a where a.id = r.aid;
      update activities set sold = greatest(0, sold - 1) where activities.id = r.aid;
      n_sold := n_sold + 1;
    else
      continue;
    end if;
    if slug is not null then
      update campers set already_registered =
        coalesce((select array_agg(x) from unnest(coalesce(already_registered,'{}')) x where x <> slug), '{}')
      where lower(btrim(name)) = lower(btrim(r.c)) and already_registered @> array[slug];
      n_unmarked := n_unmarked + 1;
    end if;
  end loop;

  delete from order_items where order_id = p_order_id;
  delete from orders where orders.id = p_order_id;
  delete from holds where holds.id = v_order.hold_id;
  return jsonb_build_object('ok', true, 'email', v_order.email,
    'unmarked', n_unmarked, 'inv_freed', n_inv, 'sold_freed', n_sold,
    'stripe_pi', v_order.stripe_payment_intent, 'stripe_schedule', v_order.stripe_schedule);
end $function$

