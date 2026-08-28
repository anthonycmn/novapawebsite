-- Move a legacy (Regpack / Sawyer) enrollment to a different session.
--
-- A legacy row IS a registration — Jason, Aug 20: "show this as an official
-- sign up same as others, note on the billing side" — but admin_move_camper
-- only takes an order_items id, so these rows had no move action at all. A
-- family whose every registration came through Regpack (Tommy Dolan: one
-- Sawyer, two Regpack) could not be touched from the admin at all.
--
-- Mirrors admin_move_camper exactly: capacity-check the target, free the old
-- seat counter, take the new one, swap the camper's already_registered slug,
-- rewrite the row, and log it. Money is untouched; a move is a seat swap and
-- the legacy paid_cents stays with the row wherever it lands.
CREATE OR REPLACE FUNCTION public.admin_move_legacy(
  p_legacy_id bigint, p_show text, p_band text, p_activity_id bigint,
  p_actor text, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  le legacy_enrollments%rowtype;
  v_avail int;
  v_from text; v_to text;
  old_slug text; new_slug text;
begin
  select * into le from legacy_enrollments where id = p_legacy_id;
  if le.id is null then return jsonb_build_object('error','legacy enrollment not found'); end if;

  if (p_show is null) = (p_activity_id is null) then
    return jsonb_build_object('error','pick exactly one target: show+band or activity');
  end if;
  if p_show is not null and le.show is not distinct from p_show then
    return jsonb_build_object('error','already in that session');
  end if;
  if p_activity_id is not null and le.activity_id is not distinct from p_activity_id then
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

  -- free the old seat. A legacy row may carry neither show nor activity_id
  -- (imported as free text only) — then there is no counter to give back and
  -- v_from falls back to the text we imported, so the audit line still reads.
  if le.show is not null then
    update inventory set booked = greatest(0, booked - 1) where show = le.show and band = le.dates;
    v_from := le.show;
    old_slug := le.show;
  elsif le.activity_id is not null then
    update activities set sold = greatest(0, sold - 1) where id = le.activity_id;
    select case when a.name ~* 'frozen' then 'frozen'
                when a.name ~* 'mermaid' then 'mermaid'
                when a.category = 'class' then null
                else 'act' || a.id::text end,
           a.name
      into old_slug, v_from from activities a where a.id = le.activity_id;
  else
    v_from := coalesce(le.activity_text, 'unlinked');
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

  if old_slug is not null then
    update campers set already_registered =
      coalesce((select array_agg(x) from unnest(coalesce(already_registered,'{}')) x where x <> old_slug), '{}')
    where lower(btrim(name)) = lower(btrim(le.camper_name)) and already_registered @> array[old_slug];
  end if;
  if new_slug is not null then
    update campers set already_registered = already_registered || new_slug
    where lower(btrim(name)) = lower(btrim(le.camper_name))
      and not (coalesce(already_registered,'{}') @> array[new_slug]);
  end if;

  -- activity_text is what the admin actually reads on the row, so keep it in
  -- step with the move instead of leaving it describing the old session.
  update legacy_enrollments
     set show = p_show, activity_id = p_activity_id,
         activity_text = coalesce(v_to, activity_text)
   where id = p_legacy_id;

  insert into admin_actions (action, actor, payload) values ('move_legacy', p_actor,
    jsonb_build_object('legacy_id', p_legacy_id, 'camper', le.camper_name, 'email', le.email,
      'source', le.source, 'from', v_from, 'to', v_to, 'forced', p_force and v_avail <= 0));

  return jsonb_build_object('ok', true, 'camper', le.camper_name, 'from', v_from, 'to', v_to);
end $function$;
REVOKE EXECUTE ON FUNCTION public.admin_move_legacy(bigint, text, text, bigint, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_move_legacy(bigint, text, text, bigint, text, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_legacy(bigint, text, text, bigint, text, boolean) TO service_role;
