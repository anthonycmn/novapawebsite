-- QR badge check-in for production rehearsals (Oct 6 2026, Frozen badges).
--
-- Each cast badge carries a QR code that resolves to /checkin/?b=<camper>.<prod>
-- where <camper> is campers.id without dashes and <prod> is the first 8 hex
-- of staff_portal.productions.id. Scanning it marks the child in
-- staff_portal.curriculum_attendance, the same rows the staff portal's
-- attendance grid reads and writes, keyed by the same roster_key v_roster
-- builds (enrollment_id || ':' || ord). Nothing new to reconcile.
--
-- Rules:
--   * Day is America/New_York, not UTC: a 7pm rehearsal is still "today".
--   * Late = scanned more than 10 minutes after the scheduled start on a
--     scheduled rehearsal day. Any other day (tech week, an added call)
--     records present.
--   * An earlier present or late is never overwritten, so the first scan is
--     the arrival time. An absent or excused mark IS overwritten: the child
--     is standing at the door.
--   * A child with two enrollments on one production (a legacy Sawyer row
--     and a web order for the same seat) has two roster rows in the staff
--     portal; both are marked so the grid agrees with itself.
--
-- Called only by netlify/functions/checkin.mjs with the service role; the
-- staff passcode is checked there. No grant to anon or authenticated.

create or replace function public.production_checkin(p_camper uuid, p_prod_prefix text, p_by text default 'QR check-in')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now   timestamp := now() at time zone 'America/New_York';
  v_day   date := v_now::date;
  v_prod  staff_portal.productions;
  v_keys  text[];
  v_start time;
  v_prev  record;
  v_status text;
  v_card  jsonb;
begin
  if p_prod_prefix !~ '^[0-9a-f]{8}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;

  select pr.* into v_prod
  from staff_portal.productions pr
  where left(pr.id::text, 8) = p_prod_prefix
    and pr.cancelled_at is null and pr.archived_at is null
  limit 1;
  if v_prod.id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_production');
  end if;

  select array_agg(distinct e.enrollment_id || ':' || rp.ord) into v_keys
  from staff_portal.v_reg_enrollments_live e
  join staff_portal.reg_offering_links l on l.offering_key = e.offering_key
  join staff_portal.v_reg_participants_live rp on rp.enrollment_id = e.enrollment_id
  where l.production_id = v_prod.id and rp.participant_id = p_camper;
  if v_keys is null then
    return jsonb_build_object('ok', false, 'error', 'not_on_roster', 'production', v_prod.title);
  end if;

  v_card := public.production_checkin_card(p_camper) || jsonb_build_object('production', v_prod.title);

  select a.status, a.updated_at into v_prev
  from staff_portal.curriculum_attendance a
  where a.production_id = v_prod.id and a.day = v_day and a.roster_key = any(v_keys)
    and a.status in ('present', 'late')
  order by a.updated_at
  limit 1;
  if found then
    return v_card || jsonb_build_object('ok', true, 'already', true, 'status', v_prev.status,
      'at', to_char(v_prev.updated_at at time zone 'America/New_York', 'FMHH12:MI AM'));
  end if;

  select s.starts_at into v_start
  from staff_portal.production_schedule s
  where s.production_id = v_prod.id and s.day_of_week = extract(dow from v_day)::int
  order by s.starts_at limit 1;
  v_status := case when v_start is not null and v_now::time > v_start + interval '10 minutes'
                   then 'late' else 'present' end;

  insert into staff_portal.curriculum_attendance (production_id, day, roster_key, participant_name, status, updated_by, updated_at)
  select v_prod.id, v_day, k, v_card->>'name', v_status, nullif(btrim(p_by), ''), now()
  from unnest(v_keys) k
  on conflict (production_id, day, roster_key) do update
    set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    where staff_portal.curriculum_attendance.status not in ('present', 'late');

  return v_card || jsonb_build_object('ok', true, 'already', false, 'status', v_status,
    'at', to_char(v_now, 'FMHH12:MI AM'));
end;
$function$;

-- What the door screen shows once a badge scans: who it is and what staff
-- need to know right then. Same sources the badges were printed from.
create or replace function public.production_checkin_card(p_camper uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'name', coalesce(nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), c.name),
    'nickname', coalesce(nullif(btrim(s.preferred_name), ''), split_part(btrim(c.name), ' ', 1)),
    'allergies', array_remove(array[
        nullif(btrim(s.allergies), ''), nullif(btrim(c.allergies), ''),
        nullif(btrim(c.profile->>'env_allergies'), ''), nullif(btrim(c.profile->>'med_allergies'), '')], null),
    'epipen', coalesce(c.profile->>'epipen', ''),
    'medical', coalesce(nullif(btrim(s.medical_flags), ''), ''),
    'emergency', coalesce(
        (select jsonb_agg(jsonb_build_object('name', x->>'fullName', 'phone', x->>'phone', 'rel', x->>'relationship'))
           from jsonb_array_elements(coalesce(b.emergency_contacts, '[]'::jsonb)) x
          where coalesce(x->>'phone', '') <> ''),
        case when coalesce(c.profile->>'emergency_phone', '') <> ''
             then jsonb_build_array(jsonb_build_object('name', c.profile->>'emergency_name', 'phone', c.profile->>'emergency_phone', 'rel', ''))
        end,
        -- No emergency contact on file: the parents are the next call, so
        -- the door screen never comes up empty when a phone exists anywhere.
        (select jsonb_agg(jsonb_build_object('name', g->>'fullName', 'phone', g->>'phone', 'rel', 'Parent'))
           from jsonb_array_elements(coalesce(b.guardians, '[]'::jsonb)) g
          where coalesce(g->>'phone', '') <> ''),
        case when coalesce(f.phone, '') <> ''
             then jsonb_build_array(jsonb_build_object('name', coalesce(f.parent_name, 'Parent'), 'phone', f.phone, 'rel', 'Parent'))
        end,
        '[]'::jsonb)
  )
  from campers c
  left join families f on f.id = c.family_id
  left join lateral (select * from family_hub.students s where s.camper_id = c.id order by s.updated_at desc limit 1) s on true
  left join lateral (select * from family_hub.v_student_profile_bridge b where b.student_id = s.id limit 1) b on true
  where c.id = p_camper;
$function$;

-- Who is in and who is not yet, for every production rehearsing today. The
-- door screen polls this so staff can see the missing names at a glance.
create or replace function public.production_checkin_today()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with today as (select (now() at time zone 'America/New_York')::date d),
  prods as (
    select pr.id, pr.title, min(s.starts_at) starts_at
    from staff_portal.productions pr
    join staff_portal.production_schedule s on s.production_id = pr.id
    cross join today
    where pr.cancelled_at is null and pr.archived_at is null
      and s.day_of_week = extract(dow from today.d)::int
      and today.d between coalesce(pr.starts_on, today.d) and coalesce(pr.ends_on, today.d)
    group by pr.id, pr.title
  ),
  kids as (
    select l.production_id, rp.participant_id, min(c.name) name,
           array_agg(e.enrollment_id || ':' || rp.ord) keys
    from staff_portal.v_reg_enrollments_live e
    join staff_portal.reg_offering_links l on l.offering_key = e.offering_key
    join staff_portal.v_reg_participants_live rp on rp.enrollment_id = e.enrollment_id
    join campers c on c.id = rp.participant_id
    where l.production_id in (select id from prods)
    group by l.production_id, rp.participant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'title', p.title,
      'starts', to_char(p.starts_at, 'FMHH12:MI AM'),
      'kids', (select coalesce(jsonb_agg(jsonb_build_object('name', k.name, 'status', st.status) order by k.name), '[]'::jsonb)
               from kids k
               left join lateral (
                 select a.status from staff_portal.curriculum_attendance a, today
                 where a.production_id = p.id and a.day = today.d and a.roster_key = any(k.keys)
                 order by (a.status in ('present', 'late')) desc limit 1) st on true
               where k.production_id = p.id)
    ) order by p.starts_at), '[]'::jsonb)
  from prods p;
$function$;

revoke all on function public.production_checkin(uuid, text, text) from public, anon, authenticated;
revoke all on function public.production_checkin_card(uuid) from public, anon, authenticated;
revoke all on function public.production_checkin_today() from public, anon, authenticated;
grant execute on function public.production_checkin(uuid, text, text) to service_role;
grant execute on function public.production_checkin_card(uuid) to service_role;
grant execute on function public.production_checkin_today() to service_role;
