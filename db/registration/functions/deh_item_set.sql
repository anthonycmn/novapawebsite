-- Exported from live DB (tlkuqwsqicxcjdmumkje) on 2026-08-11.
-- ACL at export: postgres=X/postgres | service_role=X/postgres

CREATE OR REPLACE FUNCTION public.deh_item_set(p_item_id text, p_status text, p_vendor text, p_link text, p_price_cents integer, p_qty integer, p_by text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into deh_items (item_id, status, vendor, link, price_cents, qty, updated_by, updated_at)
  values (p_item_id,
          coalesce(nullif(trim(p_status), ''), 'todo'),
          nullif(trim(p_vendor), ''),
          nullif(trim(p_link), ''),
          greatest(coalesce(p_price_cents, 0), 0),
          greatest(coalesce(p_qty, 1), 1),
          nullif(trim(p_by), ''), now())
  on conflict (item_id) do update set
    status      = excluded.status,
    vendor      = excluded.vendor,
    link        = excluded.link,
    price_cents = excluded.price_cents,
    qty         = excluded.qty,
    updated_by  = excluded.updated_by,
    updated_at  = now();
$function$

