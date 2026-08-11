-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.confirm_order(p_hold_id uuid, p_email text, p_parent_name text, p_plan text, p_amount_today_cents integer, p_total_cents integer, p_installment_cents integer, p_stripe_payment_intent text, p_stripe_customer text, p_unit_prices jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id uuid;
  v_items jsonb;
  it jsonb;
  i int := 0;
begin
  if exists (select 1 from orders where stripe_payment_intent = p_stripe_payment_intent) then
    select id into v_order_id from orders where stripe_payment_intent = p_stripe_payment_intent;
    return v_order_id;
  end if;
  select items into v_items from holds where id = p_hold_id;
  if v_items is null then raise exception 'hold not found'; end if;

  update holds set status = 'confirmed' where id = p_hold_id;

  insert into orders (email, parent_name, hold_id, plan, amount_today_cents, total_cents,
                      installment_cents, stripe_payment_intent, stripe_customer)
  values (lower(p_email), p_parent_name, p_hold_id, p_plan, p_amount_today_cents,
          p_total_cents, p_installment_cents, p_stripe_payment_intent, p_stripe_customer)
  returning id into v_order_id;

  for it in select * from jsonb_array_elements(v_items) loop
    if it ? 'show' then
      update inventory set booked = booked + 1
      where show = it->>'show' and band = it->>'band';
    end if;
    if it ? 'activity_id' then
      update activities set sold = sold + 1 where id = (it->>'activity_id')::bigint;
    end if;
    insert into order_items (order_id, show, band, camper_name, unit_price_cents, activity_id)
    values (v_order_id, it->>'show', it->>'band', coalesce(it->>'camper','TBD'),
            coalesce((p_unit_prices->>i)::int, 0), (it->>'activity_id')::bigint);
    i := i + 1;
  end loop;
  return v_order_id;
end;
$function$

