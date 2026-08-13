-- Roster for one sellable thing: summer camps by (show, band), everything
-- else by activity_id. One row per seat: who, which family, what they paid,
-- which order. Unions the legacy (Sawyer/Regpack) rows so pre-platform
-- registrations appear alongside web ones. Admin-gated.
CREATE OR REPLACE FUNCTION public.admin_roster(
  p_show text DEFAULT NULL, p_band text DEFAULT NULL, p_activity_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN NOT is_admin() THEN NULL ELSE COALESCE(jsonb_agg(r ORDER BY r->>'camper'), '[]'::jsonb) END
  FROM (
    SELECT jsonb_build_object(
      'source', 'web',
      'item_id', oi.id,
      'camper', oi.camper_name,
      'parent_name', o.parent_name,
      'email', o.email,
      'paid_cents', oi.unit_price_cents,
      'plan', o.plan,
      'order_id', o.id,
      'order_status', o.status,
      'stripe_pi', o.stripe_payment_intent,
      'ordered_at', o.created_at
    ) AS r
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status IN ('paid','confirmed','complete','succeeded')
      AND ((p_activity_id IS NOT NULL AND oi.activity_id = p_activity_id)
        OR (p_show IS NOT NULL AND oi.show = p_show AND (p_band IS NULL OR oi.band = p_band)))
    UNION ALL
    SELECT jsonb_build_object(
      'source', le.source,
      'camper', le.camper_name,
      'parent_name', (SELECT f.parent_name FROM families f WHERE lower(f.email) = lower(le.email) LIMIT 1),
      'email', le.email,
      'paid_cents', le.paid_cents,
      'plan', 'legacy',
      'order_id', NULL,
      'order_status', 'legacy',
      'stripe_pi', NULL,
      'ordered_at', le.imported_at
    )
    FROM legacy_enrollments le
    WHERE p_activity_id IS NOT NULL AND le.activity_id = p_activity_id
  ) t;
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_roster(text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_roster(text, text, bigint) TO anon, authenticated, service_role;
