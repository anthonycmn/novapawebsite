-- Ticketing RPCs. Same posture as the registration flow: anon-callable
-- SECURITY DEFINER reads and hold-taking, service-role-only confirmation.

-- Public payload for the tickets page: show, performances, tiers.
CREATE OR REPLACE FUNCTION public.tix_show(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'show', to_jsonb(s) - 'created_at',
    'performances', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'starts_at', p.starts_at, 'label', p.label, 'status', p.status,
        'sold', (select count(*) from tix_tickets t where t.performance_id = p.id)
      ) order by p.starts_at), '[]'::jsonb)
      from tix_performances p where p.show_id = s.id),
    'tiers', (
      select jsonb_agg(jsonb_build_object(
        'name', t.name, 'color', t.color,
        'price_cents', t.price_cents, 'fee_cents', t.fee_cents) order by t.price_cents desc)
      from tix_tiers t where t.show_id = s.id)
  )
  from tix_shows s
  where s.slug = p_slug and s.on_sale;
$function$;

-- Seat map for one performance: every seat with its live status. `held` means
-- an unexpired active hold covers it; expired holds simply stop counting, so
-- there is nothing to sweep.
CREATE OR REPLACE FUNCTION public.tix_seatmap(p_performance_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select jsonb_agg(jsonb_build_object(
    'id', st.id, 'section', st.section, 'row', st.row_label, 'seat', st.seat_no,
    'tier', st.tier,
    'status', case
      when tk.seat_id is not null then 'sold'
      when hd.seat_id is not null then 'held'
      else 'open' end
  ) order by st.row_label, st.section, st.seat_no)
  from tix_seats st
  left join tix_tickets tk
    on tk.performance_id = p_performance_id and tk.seat_id = st.id
  left join lateral (
    select 1 as seat_id from tix_holds h
    where h.performance_id = p_performance_id
      and h.status = 'active' and h.expires_at > now()
      and st.id = any(h.seat_ids)
    limit 1
  ) hd on true
  where st.venue = 'loudoun';
$function$;

-- Atomically hold a set of seats for ten minutes. Rechecks sold AND held under
-- a per-performance advisory lock, so two buyers grabbing the same seat get a
-- clean winner and a clean CONFLICT error, never a double hold.
CREATE OR REPLACE FUNCTION public.tix_hold_seats(p_performance_id bigint, p_seat_ids bigint[], p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_hold uuid;
  v_bad  bigint;
begin
  if coalesce(array_length(p_seat_ids, 1), 0) = 0 or array_length(p_seat_ids, 1) > 12 then
    raise exception 'BAD_SEAT_COUNT';
  end if;
  perform pg_advisory_xact_lock(hashtext('tix:' || p_performance_id::text));

  select seat_id into v_bad from (
    select unnest(p_seat_ids) seat_id
  ) want
  where exists (select 1 from tix_tickets t
                where t.performance_id = p_performance_id and t.seat_id = want.seat_id)
     or exists (select 1 from tix_holds h
                where h.performance_id = p_performance_id
                  and h.status = 'active' and h.expires_at > now()
                  and want.seat_id = any(h.seat_ids))
  limit 1;
  if v_bad is not null then
    raise exception 'SEAT_TAKEN:%', v_bad;
  end if;

  insert into tix_holds (performance_id, seat_ids, email, expires_at)
  values (p_performance_id, p_seat_ids, lower(p_email), now() + interval '10 minutes')
  returning id into v_hold;

  return jsonb_build_object('hold_id', v_hold, 'expires_in', 600);
end $function$;

CREATE OR REPLACE FUNCTION public.tix_release_hold(p_hold_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  update tix_holds set status = 'released' where id = p_hold_id and status = 'active';
$function$;

-- Confirmation, called by the webhook with the service role. Idempotent on the
-- payment intent, exactly like confirm_order: a Stripe redelivery returns the
-- existing order instead of double-selling. The UNIQUE(performance, seat)
-- constraint on tix_tickets is the last-line oversell guard.
CREATE OR REPLACE FUNCTION public.tix_confirm(
  p_hold_id uuid, p_email text, p_buyer_name text,
  p_total_cents int, p_stripe_payment_intent text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_order tix_orders;
  v_hold  tix_holds;
  v_code  text;
  v_seat  bigint;
  v_tier  text;
  v_price int;
begin
  select * into v_order from tix_orders where stripe_payment_intent = p_stripe_payment_intent;
  if found then
    return jsonb_build_object('order_id', v_order.id, 'code', v_order.code, 'duplicate', true);
  end if;

  select * into v_hold from tix_holds where id = p_hold_id;
  if not found then raise exception 'HOLD_NOT_FOUND'; end if;

  -- Money has moved by the time we are called, so a hold that expired while
  -- the buyer typed their card number still confirms; the seats were only
  -- soft-released and the unique constraint below catches a true collision.
  update tix_holds set status = 'confirmed' where id = p_hold_id;

  v_code := upper(substr(md5(p_hold_id::text || p_stripe_payment_intent), 1, 6));
  insert into tix_orders (email, buyer_name, performance_id, total_cents, stripe_payment_intent, code)
  values (lower(p_email), p_buyer_name, v_hold.performance_id, p_total_cents, p_stripe_payment_intent, v_code)
  returning * into v_order;

  foreach v_seat in array v_hold.seat_ids loop
    select t.price_cents + t.fee_cents, s.tier into v_price, v_tier
    from tix_seats s
    join tix_performances p on p.id = v_hold.performance_id
    join tix_tiers t on t.show_id = p.show_id and t.name = s.tier
    where s.id = v_seat;
    insert into tix_tickets (order_id, performance_id, seat_id, price_cents)
    values (v_order.id, v_hold.performance_id, v_seat, coalesce(v_price, 0));
  end loop;

  return jsonb_build_object('order_id', v_order.id, 'code', v_order.code);
end $function$;

-- ACLs: reads and holds for everyone (the page is public); confirm is
-- service-role only.
REVOKE EXECUTE ON FUNCTION public.tix_confirm(uuid, text, text, int, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tix_confirm(uuid, text, text, int, text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.tix_show(text) TO anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.tix_seatmap(bigint) TO anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.tix_hold_seats(bigint, bigint[], text) TO anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.tix_release_hold(uuid) TO anon, authenticated, service_role;
