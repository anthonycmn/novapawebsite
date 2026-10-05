-- Every family gets a referral code the moment its row exists.
--
-- The referral program ("give 2 tickets, get 2 tickets", Jul 30) shares
-- /register/?ref=CODE, and reg-pay.mjs looks the code up in families.ref_code
-- to credit the referrer. The codes were minted by a one-off backfill on
-- launch day and nothing minted them afterwards: no column default, no
-- trigger, no Netlify function. Between Sep 10 and Sep 18 2026, 12 of the 23
-- new families were created without a code — every guest checkout
-- (reg-webhook.mjs), every DC Unifieds buyer (dcu-family.mjs) and every
-- portal sign-in (ensure_my_family) that inserts into families — and were
-- silently outside the program.
--
-- The fix is a BEFORE INSERT trigger, so every path that inserts into
-- families is covered without touching the callers, plus the unique index
-- that keeps a code pointing at exactly one family.
--
-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-09-18, where all of
-- this is already applied and the 12 families are backfilled. Safe to re-run.
--
-- Code format matches the 804 codes already shared with families:
--   first name, letters only, upper-cased, at most 8   + 4 hex   NEELAF716
--   no parent name: email local part, letters, at most 6 + 4 hex   MAJATRA908
--   neither: NOVAPA                                    + 4 hex   NOVAPA4747
-- reg-pay.mjs upper-cases the incoming ?ref= and accepts /^[A-Z0-9]{1,20}$/,
-- so a code is always A–Z0–9 and at most 12 characters.

CREATE OR REPLACE FUNCTION public.mint_ref_code(p_email text, p_parent_name text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_prefix text;
  v_code text;
  v_tries int := 0;
begin
  v_prefix := left(upper(regexp_replace(split_part(coalesce(p_parent_name,''),' ',1),'[^a-zA-Z]','','g')), 8);
  if v_prefix = '' then
    v_prefix := left(upper(regexp_replace(split_part(coalesce(p_email,''),'@',1),'[^a-zA-Z]','','g')), 6);
  end if;
  if v_prefix = '' then
    v_prefix := 'NOVAPA';
  end if;

  loop
    v_tries := v_tries + 1;
    v_code := v_prefix || upper(lpad(to_hex((random() * 65535)::int), 4, '0'));
    exit when not exists (select 1 from public.families where ref_code = v_code);
    if v_tries >= 50 then
      raise exception 'could not mint a unique ref_code for % after % tries', p_email, v_tries;
    end if;
  end loop;

  return v_code;
end;
$function$;

CREATE OR REPLACE FUNCTION public.families_set_ref_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.ref_code is null or btrim(new.ref_code) = '' then
    new.ref_code := public.mint_ref_code(new.email, new.parent_name);
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_families_ref_code ON public.families;
CREATE TRIGGER trg_families_ref_code
  BEFORE INSERT ON public.families
  FOR EACH ROW EXECUTE FUNCTION public.families_set_ref_code();

-- One code, one family. mint_ref_code checks before it returns, and this
-- catches the two-inserts-at-once race the check cannot.
CREATE UNIQUE INDEX IF NOT EXISTS families_ref_code_key ON public.families USING btree (ref_code);

-- Backfill: any family that predates the trigger and still has no code.
UPDATE public.families
   SET ref_code = public.mint_ref_code(email, parent_name)
 WHERE ref_code IS NULL OR btrim(ref_code) = '';

-- Verification: every row should say OK.
SELECT 'trigger present' AS item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_families_ref_code'
                            AND tgrelid = 'public.families'::regclass) THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL
SELECT 'unique index present',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'families_ref_code_key'
                            AND indexdef ILIKE 'CREATE UNIQUE INDEX%') THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'families without a code',
       CASE WHEN (SELECT count(*) FROM public.families WHERE ref_code IS NULL OR btrim(ref_code) = '') = 0
            THEN 'OK' ELSE 'FAIL: ' || (SELECT count(*) FROM public.families WHERE ref_code IS NULL OR btrim(ref_code) = '') END
UNION ALL
SELECT 'codes outside A-Z0-9 / 12 chars',
       CASE WHEN (SELECT count(*) FROM public.families WHERE ref_code !~ '^[A-Z0-9]{1,12}$') = 0
            THEN 'OK' ELSE 'FAIL: ' || (SELECT count(*) FROM public.families WHERE ref_code !~ '^[A-Z0-9]{1,12}$') END;
