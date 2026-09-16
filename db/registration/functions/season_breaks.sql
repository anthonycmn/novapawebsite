-- The season's breaks, for the mid-month class proration (CJ, Sep 16 2026:
-- "honor the holiday breaks too"). One source: staff_portal.season_events
-- rows of kind 'break' — the same rows the portal's class_calendar() skips —
-- so a break added or moved in the portal reprices checkout the same minute.
-- Read by register/index.html (anon, to draw the number) and reg-pay.mjs
-- (to charge it). Titles and dates only; they are already on calendar.html.
-- Applied 2026-09-16 via the Supabase MCP as season_breaks_for_class_proration.

CREATE OR REPLACE FUNCTION public.season_breaks()
 RETURNS TABLE(title text, starts_on date, ends_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'staff_portal', 'public'
AS $function$
  select se.title, se.starts_on, se.ends_on
    from staff_portal.season_events se
   where se.kind::text = 'break'
     and se.ends_on >= current_date - interval '2 months'
   order by se.starts_on;
$function$;

REVOKE ALL ON FUNCTION public.season_breaks() FROM public;
GRANT EXECUTE ON FUNCTION public.season_breaks() TO anon, authenticated, service_role;
