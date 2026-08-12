-- Overview donuts, computed instead of hardcoded: one ring per program group
-- with capacity and taken derived live, plus an `items` breakdown (one entry
-- per camp/cast/class inside the group) powering the click-to-expand
-- sub-donuts on the Overview tab. Replaces admin_offering_fill's hardcoded
-- activity-id list, which silently showed 0% for any renumbered id.
--
-- Grouping facts (verified Aug 12 2026): the fall shows and teen conservatory
-- productions are category 'camp', NOT 'performance' — the only 'performance'
-- rows are three $0 ticket stubs. So shows are picked out of 'camp' by name
-- and excluded from Day Camps. Per-activity taken includes legacy_enrollments
-- so the numbers match what admin_roster shows on drill-in. A group with no
-- matching activities still renders (0/0) instead of disappearing. Admin-gated.
CREATE OR REPLACE FUNCTION public.admin_overview_groups()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH act AS (
    SELECT a.id, a.name, a.capacity, a.category, a.price_cents,
      a.sold + COALESCE(a.booked_offline, 0)
        + COALESCE((SELECT count(*) FROM legacy_enrollments le WHERE le.activity_id = a.id), 0) AS taken
    FROM activities a
    WHERE a.active
  ),
  grp AS (
    SELECT 'fallshows' AS key, act.* FROM act
      WHERE category = 'camp' AND name ~* 'frozen|mermaid'
    UNION ALL
    SELECT 'classes', act.* FROM act WHERE category = 'class'
    UNION ALL
    SELECT 'daycamps', act.* FROM act
      WHERE category = 'camp' AND price_cents <= 20000
        AND name !~* 'frozen|mermaid|sweeney|hadestown|conservatory'
    UNION ALL
    SELECT 'teencons', act.* FROM act
      WHERE category = 'camp' AND name ~* 'sweeney|hadestown|conservatory'
    UNION ALL
    SELECT 'coaching', act.* FROM act WHERE id BETWEEN 970000 AND 979999
  ),
  defs(ord, key, label) AS (VALUES
    ('2','fallshows','Fall Shows'), ('3','classes','Classes'),
    ('4','daycamps','Day Camps'), ('5','teencons','Teen Conservatory'),
    ('6','coaching','Coaching'))
  SELECT CASE WHEN NOT is_admin() THEN NULL ELSE jsonb_agg(g ORDER BY g->>'ord') END
  FROM (
    -- summer camps: inventory is the counter, one item per show x age band
    SELECT jsonb_build_object('ord','1','key','summer','label','Summer 2027',
      'cap', COALESCE(SUM(i.cap),0), 'taken', COALESCE(SUM(i.booked),0),
      'items', COALESCE(jsonb_agg(jsonb_build_object(
        'show', i.show, 'band', i.band, 'cap', i.cap, 'taken', i.booked)
        ORDER BY i.show, i.band), '[]'::jsonb)) AS g
    FROM inventory i
    UNION ALL
    SELECT jsonb_build_object('ord', d.ord, 'key', d.key, 'label', d.label,
      'cap', COALESCE(SUM(x.capacity),0), 'taken', COALESCE(SUM(x.taken),0),
      'items', COALESCE(jsonb_agg(jsonb_build_object(
        'activity_id', x.id, 'label', x.name, 'cap', x.capacity, 'taken', x.taken)
        ORDER BY x.name) FILTER (WHERE x.id IS NOT NULL), '[]'::jsonb))
    FROM defs d LEFT JOIN grp x ON x.key = d.key
    GROUP BY d.ord, d.key, d.label
  ) t;
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_overview_groups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_overview_groups() TO anon, authenticated, service_role;
