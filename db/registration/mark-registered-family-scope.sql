-- mark_registered() scopes its camper updates to the paying family (Sep 21 2026).
--
-- NOT APPLIED. Proposed SQL for CJ to run through the Supabase MCP on his go.
-- Nothing in this file has touched production. Verified against the live
-- function on Sep 21 2026: db/registration/functions/mark_registered.sql was
-- byte for byte identical to `pg_get_functiondef` before this change.
--
-- Why. mark_registered() resolves the payer's email to exactly one family at
-- the top:
--
--     if fid is null then return; end if;
--
-- and then never uses fid again except in the two inserts. Both loops update
-- campers like this:
--
--     update campers set already_registered = ...
--     where lower(btrim(name)) = lower(btrim(r.c));
--
-- No family_id predicate. Two consequences, and the second is the quiet one:
--
--   1. A registration writes already_registered onto EVERY camper row in the
--      database carrying that name, in any family. A common child's name means
--      a stranger's record is edited by somebody else's checkout.
--   2. Because the update matched somebody, `not found` is false, so the
--      `if not found then insert` never fires for the household that actually
--      registered. That household gets a paid registration and no camper row
--      of its own, and the child is invisible to anything that joins through
--      public.campers, which is how the parent portal reads a family
--      (family_hub.students.camper_id).
--
-- Consequence 1 is happening now. Measured read-only on Sep 21 2026: 33 camper
-- rows across 27 families carry a slug no paid order under their family ever
-- bought, 9 of those slug instances sitting on a row where another family's
-- paid order names the same child and the same show. "Grace Smith" carries
-- four such slugs across two rows. The SQL that produced those counts is in
-- the pull request that adds this file.
--
-- Consequence 2 has not bitten yet, and the reason is luck, not design. The
-- register page calls set_my_camper_birthdate() during the cart flow, which
-- inserts into the caller's own family (my_family_id()), so by the time the
-- Stripe webhook calls mark_registered() the correct camper row usually
-- already exists and the unscoped update finds it inside its own family
-- anyway. Measured the same day: 0 households have a paid
-- order_items.camper_name with no campers row in that family. The insert
-- branch here is a backstop that has so far not been needed; guest checkout
-- (register/index.html gates those RPCs on `state.guest ||`) is the path that
-- would need it, and it is exactly the path the missing predicate disarms.
--
-- What changes. Two `where` clauses gain `family_id = fid`. Nothing else: the
-- signature, the slug derivation, the empty-email guard, the class exclusion
-- and the array_agg(distinct) merge are all untouched, so every caller keeps
-- working and a re-run is still idempotent.
--
-- What this does NOT do. It stops new damage and undoes none of the old. The
-- 33 rows above stay wrong until they are cleaned up, and that cleanup is a
-- separate decision because roughly two thirds of those rows are sawyer and
-- regpack imports whose slugs may be legitimate offline history rather than
-- this bug. Do not fold a backfill into this migration.
--
-- Not changed here, worth its own look: admin_move_camper(), admin_move_legacy(),
-- admin_cancel_item() and admin_delete_order() all match campers by name with
-- no family predicate too. Same defect, different blast radius, and an admin
-- action has a human behind it. Also, loop 1 filters on `show is not null` but
-- not on `camper is not null`, so a null camper name would insert a nameless
-- camper row; loop 2 guards against it. Left alone to keep this diff surgical.
--
-- Expected effect on apply: 0 rows changed. This replaces a function; it does
-- not read or write campers. The next checkout after it lands writes
-- already_registered only inside the paying family.

CREATE OR REPLACE FUNCTION public.mark_registered(p_email text, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fid uuid; r record; slug text;
begin
  -- 2026-08-27: an empty p_email used to match every family whose cc_email is
  -- null (the '' = '' trap that misfiled campers). Refuse it outright.
  if nullif(lower(btrim(coalesce(p_email,''))), '') is null then return; end if;
  select id into fid from (
    select id, 1 as pri from families where lower(email) = lower(p_email)
    union all
    select id, 2 from families where lower(coalesce(cc_email,'')) = lower(p_email)
  ) t order by pri limit 1;
  if fid is null then return; end if;
  for r in select it->>'show' s, it->>'camper' c from jsonb_array_elements(p_items) it
           where (it->>'show') is not null loop
    -- 2026-09-21: family_id = fid. Without it this wrote onto every camper of
    -- that name in any family, and the match made `not found` false so the
    -- paying household never got a camper row of its own.
    update campers set already_registered =
      (select array_agg(distinct x) from unnest(coalesce(already_registered,'{}') || array[r.s]) x)
    where family_id = fid and lower(btrim(name)) = lower(btrim(r.c));
    if not found then
      insert into campers(family_id, name, already_registered, source)
      values (fid, r.c, array[r.s], 'web');
    end if;
  end loop;
  -- fall/year-round shows + day camps count too; classes never do
  for r in select (it->>'activity_id')::bigint aid, it->>'camper' c from jsonb_array_elements(p_items) it
           where (it->>'activity_id') is not null and (it->>'camper') is not null loop
    select case when a.name ~* 'frozen' then 'frozen'
                when a.name ~* 'mermaid' then 'mermaid'
                when a.category = 'class' then null
                else 'act' || a.id::text end
      into slug from activities a where a.id = r.aid;
    if slug is null then continue; end if;
    -- 2026-09-21: family_id = fid, same reason as the loop above.
    update campers set already_registered =
      (select array_agg(distinct x) from unnest(coalesce(already_registered,'{}') || array[slug]) x)
    where family_id = fid and lower(btrim(name)) = lower(btrim(r.c));
    if not found then
      insert into campers(family_id, name, already_registered, source)
      values (fid, r.c, array[slug], 'web');
    end if;
  end loop;
end $function$;

-- Restates the ACL the live function already carries
-- (postgres=X/postgres | service_role=X/postgres). CREATE OR REPLACE keeps the
-- existing grants, so these lines change nothing; they are here so the file is
-- the whole truth if it is ever replayed onto a fresh database.
revoke all on function public.mark_registered(text, jsonb) from public, anon, authenticated;
grant execute on function public.mark_registered(text, jsonb) to service_role;
