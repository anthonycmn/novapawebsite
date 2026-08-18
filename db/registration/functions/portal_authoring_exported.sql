-- Portal offering authoring: CJ's changes to the public schema, applied to
-- prod 17 Aug 2026 and EXPORTED FROM THE LIVE DATABASE 17 Aug 2026 so this
-- repo stays the complete record of public. Authored by CJ (source file
-- portal-authoring.sql lives in his novapa-registration repo); his email
-- "Public schema + registration changes" (17 Aug) is the design writeup.
-- Columns are additive and NULL on all pre-portal rows; NULL means "behave
-- exactly as before" everywhere they are read. catalog_list was dropped and
-- recreated with four more columns and a selling-window filter; verified to
-- return identical rows for existing listings. sells_now deliberately
-- ignores 'hidden' (hidden+bookable listings are sold by direct link).

-- ── new columns on public.activities ─────────────────────────────────────
--   authored_in_portal       boolean
--   description              text
--   ends_on                  date
--   max_age                  integer
--   meets_days               ARRAY
--   meets_end                time without time zone
--   meets_start              time without time zone
--   min_age                  integer
--   offering_kind            text
--   registration_closes_at   timestamp with time zone
--   registration_opens_at    timestamp with time zone
--   session_dates            ARRAY
--   starts_on                date
--   updated_at               timestamp with time zone
--   updated_by               text

-- ── check constraints on activities (all, for reference) ────────────────
--   activities_age_bounds_ck: CHECK (((min_age IS NULL) OR (max_age IS NULL) OR (min_age <= max_age)))
--   activities_category_check: CHECK ((category = ANY (ARRAY['class'::text, 'camp'::text, 'performance'::text, 'coaching'::text])))
--   activities_offering_kind_ck: CHECK (((offering_kind IS NULL) OR (offering_kind = ANY (ARRAY['show'::text, 'camp'::text, 'day_camp'::text, 'class'::text, 'coaching'::text]))))
--   activities_reg_window_ck: CHECK (((registration_opens_at IS NULL) OR (registration_closes_at IS NULL) OR (registration_opens_at < registration_closes_at)))

create sequence if not exists public.portal_activity_id_seq start 5000001;

CREATE OR REPLACE FUNCTION public.activity_facts(p_ids bigint[])
 RETURNS TABLE(id bigint, name text, category text, offering_kind text, price_cents integer, bb_gated boolean, starts_on date, ends_on date, registration_opens_at timestamp with time zone, registration_closes_at timestamp with time zone, sells_now boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.name, a.category, a.offering_kind, a.price_cents, a.bb_gated,
         a.starts_on, a.ends_on,
         a.registration_opens_at, a.registration_closes_at,
         (a.active and a.bookable
          and (a.registration_opens_at  is null or now() >= a.registration_opens_at)
          and (a.registration_closes_at is null or now() <  a.registration_closes_at))
  from public.activities a
  where a.id = any(p_ids);
$function$
;

CREATE OR REPLACE FUNCTION public.catalog_list(p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(id bigint, category text, name text, schedule_name text, age_range text, pricing text[], price_cents integer, open_spots integer, pdp_url text, image_url text, widget_tags text[], bb_gated boolean, bookable boolean, remaining integer, gate_open boolean, class_times jsonb, description text, offering_kind text, starts_on date, ends_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.category, a.name, a.schedule_name, a.age_range, a.pricing, a.price_cents,
         a.open_spots, a.pdp_url, a.image_url, a.widget_tags, a.bb_gated,
         (a.bookable
          and (a.registration_opens_at  is null or now() >= a.registration_opens_at)
          and (a.registration_closes_at is null or now() <  a.registration_closes_at)),
         case when a.capacity is null then null
              else greatest(0, a.capacity - a.sold - a.booked_offline - held_count_activity(a.id)) end,
         is_gate_open(),
         a.class_times,
         a.description, a.offering_kind, a.starts_on, a.ends_on
  from activities a
  where a.active and (not a.hidden or a.id = any(coalesce(p_ids, '{}'::bigint[])))
  order by a.category, a.name;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_clock(t time without time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when t is null then null
              else lower(to_char(t, 'FMHH12:MI')) || lower(to_char(t, 'am')) end;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_date_span(a date, b date)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when a is null and b is null then null
    when a is null              then to_char(b, 'FMMon FMDD, YYYY')
    when b is null or a = b     then to_char(a, 'FMMon FMDD, YYYY')
    else to_char(a, 'FMMon FMDD') || ' ' || chr(8211) || ' ' || to_char(b, 'FMMon FMDD, YYYY')
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_dow_name(dow smallint)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case dow when 1 then 'Mon' when 2 then 'Tue' when 3 then 'Wed'
                  when 4 then 'Thu' when 5 then 'Fri' when 6 then 'Sat'
                  when 7 then 'Sun' else null end;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_list_activities()
 RETURNS SETOF activities
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'staff_portal'
AS $function$
  select a.* from public.activities a
  where public.portal_may_write_catalogue()
  order by a.active desc, a.category, coalesce(a.starts_on, '2099-12-31'::date), a.name;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_may_write_catalogue()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'staff_portal'
AS $function$
  select coalesce(staff_portal.is_chief(), false);
$function$
;

CREATE OR REPLACE FUNCTION public.portal_save_activity(p jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'staff_portal'
AS $function$
declare
  v_id          bigint  := nullif(p->>'id', '')::bigint;
  v_new         boolean := v_id is null;
  v_actor       text    := coalesce(staff_portal.actor_email(), 'unknown');
  v_kind        text    := nullif(p->>'offering_kind', '');
  v_category    text    := nullif(p->>'category', '');
  v_price       integer := nullif(p->>'price_cents', '')::integer;
  v_capacity    integer := nullif(p->>'capacity', '')::integer;
  v_min_age     integer := nullif(p->>'min_age', '')::integer;
  v_max_age     integer := nullif(p->>'max_age', '')::integer;
  v_starts_on   date    := nullif(p->>'starts_on', '')::date;
  v_ends_on     date    := nullif(p->>'ends_on', '')::date;
  v_meets_start time    := nullif(p->>'meets_start', '')::time;
  v_meets_end   time    := nullif(p->>'meets_end', '')::time;
  v_meets_days  smallint[] := coalesce((select array_agg(x::smallint order by x::smallint)
                                  from jsonb_array_elements_text(coalesce(p->'meets_days','[]'::jsonb)) x),
                                '{}'::smallint[]);
  v_dates       date[]     := coalesce((select array_agg(x::date order by x::date)
                                  from jsonb_array_elements_text(coalesce(p->'session_dates','[]'::jsonb)) x),
                                '{}'::date[]);
  v_tags        text[]     := coalesce((select array_agg(x)
                                  from jsonb_array_elements_text(coalesce(p->'widget_tags','[]'::jsonb)) x),
                                '{}'::text[]);
  v_existing    public.activities%rowtype;
  v_orders      integer := 0;
  v_span_from   date;
  v_span_to     date;
  v_age_range   text;
  v_pricing     text[];
  v_times       jsonb;
  v_schedule    text;
  v_label       text := nullif(trim(coalesce(p->>'schedule_label','')), '');
begin
  if not public.portal_may_write_catalogue() then
    raise exception 'Only a staff portal Super Admin may write the catalogue'
      using errcode = '42501';
  end if;

  if coalesce(trim(p->>'name'), '') = '' then
    raise exception 'An offering needs a name' using errcode = '23514';
  end if;
  if v_category is null then
    raise exception 'An offering needs a category (camp, class, coaching or performance)'
      using errcode = '23514';
  end if;
  if v_price is null or v_price < 0 then
    raise exception 'An offering needs a price in cents (0 is allowed, null is not)'
      using errcode = '23514';
  end if;

  if not v_new then
    select * into v_existing from public.activities where id = v_id;
    if not found then
      raise exception 'No activity % to edit', v_id using errcode = 'P0002';
    end if;

    select count(*) into v_orders from public.order_items where activity_id = v_id;

    -- The category is the pricing rule and it is the tax treatment. Once money
    -- has moved against a listing, changing it rewrites the meaning of what was
    -- already taken — including which lines land on a family's Dependent Care
    -- FSA statement. Rename it, reprice it, close it; do not reclassify it.
    if v_orders > 0 and v_existing.category is distinct from v_category then
      raise exception
        'Activity % has % order line(s), so its category cannot change from % to %',
        v_id, v_orders, v_existing.category, v_category using errcode = '23514';
    end if;

    if v_capacity is not null
       and v_capacity < (coalesce(v_existing.sold,0) + coalesce(v_existing.booked_offline,0)) then
      raise exception 'Capacity % is below the % already booked on activity %',
        v_capacity, coalesce(v_existing.sold,0) + coalesce(v_existing.booked_offline,0), v_id
        using errcode = '23514';
    end if;
  end if;

  -- ── the span this offering covers ──────────────────────────────────────
  -- A dated event carries its dates; a weekly class carries a term. Either
  -- way the catalogue needs one span, and starts_on is what the payment-plan
  -- window is anchored to, so it is filled in both cases.
  v_span_from := coalesce(v_starts_on, (select min(d) from unnest(v_dates) d));
  v_span_to   := coalesce(v_ends_on,   (select max(d) from unnest(v_dates) d));

  -- ── generated display strings ──────────────────────────────────────────
  -- The en dash and the trailing " yrs" are the catalogue's own house style
  -- ("9 – 12 yrs"), and the register page's age regex is written against it.
  v_age_range := case
    when v_min_age is not null and v_max_age is not null
      then v_min_age || ' ' || chr(8211) || ' ' || v_max_age || ' yrs'
    when v_min_age is not null then v_min_age || '+ yrs'
    when v_max_age is not null then 'up to ' || v_max_age || ' yrs'
    else nullif(trim(coalesce(p->>'age_range','')), '')
  end;

  -- Classes are sold as a monthly bundle, so their card says "/mo". Everything
  -- else shows the one-off price. Whole dollars where the price is whole
  -- dollars, because "$79.00" on a card reads as though a machine wrote it.
  v_pricing := array[
    '$' || trim(to_char(v_price / 100.0,
             case when v_price % 100 = 0 then 'FM999G999' else 'FM999G999D00' end))
        || case when v_category = 'class' then '/mo' else '' end];

  -- class_times in the vendor's own shape, because register/index.html and the
  -- family hub's session-date parser both already read it. One block per date
  -- for a dated event; one block per weekday for a weekly class.
  if array_length(v_dates, 1) is not null then
    select jsonb_agg(jsonb_build_object(
             'title_text',          to_char(d, 'FMDy'),
             'primary_text',        jsonb_build_array(public.portal_time_range(v_meets_start, v_meets_end, d)),
             'mobile_primary_text', jsonb_build_array(public.portal_clock(v_meets_start)),
             'secondary_text',      to_char(d, 'FMMon FMDD, YYYY'),
             'product_detail_date', to_char(d, 'FMMon FMDD, YYYY'),
             'fine_print',          null) order by d)
      into v_times from unnest(v_dates) d;
  elsif array_length(v_meets_days, 1) is not null then
    select jsonb_agg(jsonb_build_object(
             'title_text',          public.portal_dow_name(dow),
             'primary_text',        jsonb_build_array(public.portal_time_range(v_meets_start, v_meets_end, v_span_from)),
             'mobile_primary_text', jsonb_build_array(public.portal_clock(v_meets_start)),
             'secondary_text',      public.portal_date_span(v_span_from, v_span_to),
             'product_detail_date', public.portal_date_span(v_span_from, v_span_to),
             'fine_print',          null) order by dow)
      into v_times from unnest(v_meets_days) dow;
  else
    v_times := coalesce(p->'class_times', '[]'::jsonb);
  end if;

  -- "Broadway Bound Day Camp | Oct 29, 2026" — a label and the when, which is
  -- the shape the register page splits on '|' to get its date line.
  v_schedule := case
    when v_label is null then public.portal_date_span(v_span_from, v_span_to)
    when public.portal_date_span(v_span_from, v_span_to) is null then v_label
    else v_label || ' | ' || public.portal_date_span(v_span_from, v_span_to)
  end;

  -- ── the write ──────────────────────────────────────────────────────────
  if v_new then
    v_id := nextval('public.portal_activity_id_seq');
    insert into public.activities (
      id, category, session_type, name, description, schedule_name,
      age_range, min_age, max_age, pricing, price_cents, capacity, open_spots,
      location, image_url, pdp_url, widget_tags, class_times, labels,
      offering_kind, starts_on, ends_on, meets_days, meets_start, meets_end,
      session_dates, registration_opens_at, registration_closes_at,
      raw, active, bookable, hidden, bb_gated,
      authored_in_portal, imported_at, updated_at, updated_by
    ) values (
      v_id, v_category,
      case when v_category = 'class' then 'session' else 'session-camp' end,
      trim(p->>'name'), nullif(trim(coalesce(p->>'description','')), ''), v_schedule,
      v_age_range, v_min_age, v_max_age, v_pricing, v_price, v_capacity, v_capacity,
      nullif(trim(coalesce(p->>'location','')), ''),
      nullif(trim(coalesce(p->>'image_url','')), ''),
      '/register/?activity=' || v_id,
      v_tags, v_times, '[]'::jsonb,
      v_kind, v_span_from, v_span_to,
      nullif(v_meets_days, '{}'::smallint[]), v_meets_start, v_meets_end,
      nullif(v_dates, '{}'::date[]),
      nullif(p->>'registration_opens_at','')::timestamptz,
      nullif(p->>'registration_closes_at','')::timestamptz,
      p,
      coalesce((p->>'active')::boolean, true),
      coalesce((p->>'bookable')::boolean, false),
      coalesce((p->>'hidden')::boolean, false),
      coalesce((p->>'bb_gated')::boolean, false),
      true, now(), now(), v_actor
    );
  else
    update public.activities set
      category               = v_category,
      name                   = trim(p->>'name'),
      description            = nullif(trim(coalesce(p->>'description','')), ''),
      schedule_name          = coalesce(v_schedule, schedule_name),
      age_range              = coalesce(v_age_range, age_range),
      min_age                = v_min_age,
      max_age                = v_max_age,
      pricing                = v_pricing,
      price_cents            = v_price,
      capacity               = v_capacity,
      -- open_spots is the vendor's own "how many are left". Keep it in step
      -- with capacity so the two can never contradict each other on a card.
      open_spots             = case when v_capacity is null then open_spots
                                    else greatest(0, v_capacity - coalesce(sold,0)
                                                     - coalesce(booked_offline,0)) end,
      location               = nullif(trim(coalesce(p->>'location','')), ''),
      image_url              = nullif(trim(coalesce(p->>'image_url','')), ''),
      widget_tags            = v_tags,
      class_times            = v_times,
      offering_kind          = v_kind,
      starts_on              = v_span_from,
      ends_on                = v_span_to,
      meets_days             = nullif(v_meets_days, '{}'::smallint[]),
      meets_start            = v_meets_start,
      meets_end              = v_meets_end,
      session_dates          = nullif(v_dates, '{}'::date[]),
      registration_opens_at  = nullif(p->>'registration_opens_at','')::timestamptz,
      registration_closes_at = nullif(p->>'registration_closes_at','')::timestamptz,
      raw                    = p,
      active                 = coalesce((p->>'active')::boolean, active),
      bookable               = coalesce((p->>'bookable')::boolean, bookable),
      hidden                 = coalesce((p->>'hidden')::boolean, hidden),
      bb_gated               = coalesce((p->>'bb_gated')::boolean, bb_gated),
      imported_at            = now(),
      updated_at             = now(),
      updated_by             = v_actor
    where id = v_id;

    -- A price move is the one edit somebody will later be asked to account for.
    if v_existing.price_cents is distinct from v_price then
      insert into public.activity_price_log
        (activity_id, old_price_cents, new_price_cents, reason, changed_by)
      values (v_id, v_existing.price_cents, v_price,
              coalesce(nullif(trim(coalesce(p->>'price_reason','')), ''),
                       'edited in the staff portal'),
              v_actor);
    end if;
  end if;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_time_range(a time without time zone, b time without time zone, d date DEFAULT NULL::date)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when a is null then null
    when b is null then public.portal_clock(a) || ' ' || public.portal_tz_label(d)
    else public.portal_clock(a) || ' - ' || public.portal_clock(b)
           || ' ' || public.portal_tz_label(d)
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_tz_label(d date DEFAULT NULL::date)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case when ((coalesce(d, current_date) + time '12:00') at time zone 'America/New_York')
                 - ((coalesce(d, current_date) + time '12:00') at time zone 'UTC')
                 = interval '4 hours'
              then 'EDT' else 'EST' end;
$function$
;

