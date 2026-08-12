-- Overview donuts, computed instead of hardcoded: one ring per program group
-- with capacity and taken derived live. Replaces admin_offering_fill's
-- hardcoded activity-id list, which silently showed 0% for any renumbered id.
-- Groups mirror how the team talks about the catalog. Admin-gated.
CREATE OR REPLACE FUNCTION public.admin_overview_groups()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN NOT is_admin() THEN NULL ELSE jsonb_agg(g ORDER BY g->>'ord') END
  FROM (
    -- summer camps: inventory is the counter
    SELECT jsonb_build_object('ord','1','key','summer','label','Summer 2027',
      'cap', COALESCE(SUM(cap),0), 'taken', COALESCE(SUM(booked),0)) AS g
    FROM inventory
    UNION ALL
    -- fall/winter shows (frozen + mermaid casts): activities counters + regpack legacy
    SELECT jsonb_build_object('ord','2','key','fallshows','label','Fall Shows',
      'cap', COALESCE(SUM(a.capacity),0),
      'taken', COALESCE(SUM(a.sold + COALESCE(a.booked_offline,0)),0)
        + (SELECT count(*) FROM legacy_enrollments le JOIN activities a2 ON a2.id = le.activity_id
           WHERE a2.name ~* 'frozen|mermaid'))
    FROM activities a
    WHERE a.active AND a.name ~* 'frozen|mermaid' AND a.category = 'performance'
    UNION ALL
    SELECT jsonb_build_object('ord','3','key','classes','label','Classes',
      'cap', COALESCE(SUM(a.capacity),0),
      'taken', COALESCE(SUM(a.sold + COALESCE(a.booked_offline,0)),0))
    FROM activities a WHERE a.active AND a.category = 'class'
    UNION ALL
    SELECT jsonb_build_object('ord','4','key','daycamps','label','Day Camps',
      'cap', COALESCE(SUM(a.capacity),0),
      'taken', COALESCE(SUM(a.sold + COALESCE(a.booked_offline,0)),0))
    FROM activities a WHERE a.active AND a.category = 'camp' AND a.price_cents <= 20000
    UNION ALL
    SELECT jsonb_build_object('ord','5','key','teencons','label','Teen Conservatory',
      'cap', COALESCE(SUM(a.capacity),0),
      'taken', COALESCE(SUM(a.sold + COALESCE(a.booked_offline,0)),0)
        + (SELECT count(*) FROM legacy_enrollments le JOIN activities a2 ON a2.id = le.activity_id
           WHERE a2.name ~* 'sweeney|hadestown|conservatory'))
    FROM activities a
    WHERE a.active AND (a.name ~* 'sweeney|hadestown|conservatory') AND a.category = 'performance'
    UNION ALL
    SELECT jsonb_build_object('ord','6','key','coaching','label','Coaching',
      'cap', COALESCE(SUM(a.capacity),0),
      'taken', COALESCE(SUM(a.sold),0))
    FROM activities a WHERE a.active AND a.id BETWEEN 970000 AND 979999
  ) t;
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_overview_groups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_overview_groups() TO anon, authenticated, service_role;
