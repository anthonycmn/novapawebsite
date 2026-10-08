-- ---------------------------------------------------------------------------
-- acquire_hold_guest_split — one checkout, two holds (classes | everything else)
-- ---------------------------------------------------------------------------
-- CJ, 30 Sep 2026: the parent-portal front door sells classes and shows in
-- one cart. A class is a monthly subscription and a show is a one-off or a
-- plan, so reg-pay needs them as two holds and makes two charges on one card.
--
-- acquire_hold_guest releases every other active hold for the address before
-- it takes a new one, so calling it twice leaves only the second. This takes
-- both in ONE transaction: classes first, then the rest (which releases the
-- class hold), then puts the class hold back. The two item sets never share
-- an activity, so neither capacity check can see the other's seats, and the
-- moment the class hold is "released" never leaves this transaction.
--
-- Every check (email shape, item count, the returning-families gate, seat
-- offers, SOLD_OUT) is acquire_hold_guest's own, run for each half.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------
create or replace function public.acquire_hold_guest_split(
  p_class_items jsonb, p_other_items jsonb, p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_class jsonb;
  v_other jsonb;
begin
  if jsonb_typeof(p_class_items) <> 'array' or jsonb_array_length(p_class_items) = 0
     or jsonb_typeof(p_other_items) <> 'array' or jsonb_array_length(p_other_items) = 0 then
    raise exception 'invalid items';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_class_items) c
      join jsonb_array_elements(p_other_items) o on o->>'activity_id' = c->>'activity_id'
  ) then
    raise exception 'invalid items';
  end if;
  v_class := public.acquire_hold_guest(p_class_items, p_email);
  v_other := public.acquire_hold_guest(p_other_items, p_email);
  update public.holds
     set status = 'active'
   where id = (v_class->>'hold_id')::uuid and status = 'released';
  return jsonb_build_object('class', v_class, 'other', v_other);
end;
$$;
revoke all on function public.acquire_hold_guest_split(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.acquire_hold_guest_split(jsonb, jsonb, text) to anon, authenticated, service_role;

do $chk$
begin
  if has_function_privilege('public', 'public.acquire_hold_guest_split(jsonb, jsonb, text)', 'execute') then
    raise exception 'acquire_hold_guest_split: PUBLIC can execute';
  end if;
end
$chk$;
