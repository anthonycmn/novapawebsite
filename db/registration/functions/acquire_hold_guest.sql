-- acquire_hold_guest(p_items, p_email) — the guest-checkout hold (Aug 18 2026).
--
-- acquire_hold_v2/v3 read the email from auth.jwt(), which is exactly right
-- for signed-in families and exactly wrong for guest checkout: the entire
-- point of the guest flow is that a new family types an email and pays
-- without a sign-in round trip (Meta cold traffic must not hit an email
-- gate). Same inventory math and row shape as v2; the email arrives as a
-- validated parameter instead.
--
-- Abuse surface: anon can hold seats for any typed email for 30 minutes.
-- The release-existing-holds step means one email can never hold more than
-- one active cart, which keeps a spammer from locking a show with a single
-- address; the 12-item cap is inherited from v2.
create or replace function public.acquire_hold_guest(p_items jsonb, p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_hold_id uuid;
  v_expires timestamptz := now() + interval '30 minutes';
  r record;
  v_avail int;
  v_cap int;
  v_gated boolean;
  v_known boolean;
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid email';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 12 then
    raise exception 'invalid items';
  end if;

  -- gate check mirrors v2: BB items require a returning family pre-Aug 1
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
$$;

grant execute on function public.acquire_hold_guest(jsonb, text) to anon, authenticated, service_role;
