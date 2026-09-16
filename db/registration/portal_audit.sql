-- Registration ↔ parent portal audit (Sep 11 2026, per CJ: "run an audit
-- every single day ... make sure that balances in Stripe match the balances
-- in the parent portal and that the children are signed up for the right
-- programs").
--
-- The website's orders and the parent portal's family_hub.enrollments live
-- in the same database, so the whole comparison is one query. What it
-- checks, per paid order line:
--
--   not_in_portal      the line has no enrollment in the parent portal at
--                      all — the family cannot see the child in the show
--   wrong_child        the enrollment is on a student whose name is not the
--                      camper the line was bought for — by either the
--                      student record or its linked camper record, since a
--                      parent writes "Ruthie" at checkout and "Ruth" in the
--                      portal for the same child
--   wrong_program      the enrollment points at a production/class whose
--                      registration_activity_id is not the line's activity
--   withdrawn_but_paid the order is paid but the portal shows withdrawn
--   balance_mismatch   what the portal says the family still owes for the
--                      order differs from the order's own figure
--                      (total − checkout − recorded installments)
--
-- Orders ↔ Stripe is the other half, and lives in
-- netlify/functions/reg-balance-audit.mjs, which records any installment
-- the database has not seen (record_installment_paid) BEFORE calling this,
-- so "the order's own figure" here is already Stripe's figure.
--
-- Two lines for the same child in the same show (a double-booked pair) map
-- to ONE enrollment in the portal, so the second line is judged covered by
-- the first's enrollment rather than reported missing. Test families
-- (public.families.is_test) are skipped.

create or replace function public.registration_portal_audit()
returns table(kind text, order_no integer, email text, camper text, detail text)
language sql
security definer
set search_path to 'public', 'family_hub'
as $function$
with items as (
  select oi.id as item_id, o.id as order_id, o.order_no, o.email,
         oi.camper_name, oi.activity_id, oi.show, oi.unit_price_cents,
         lower(regexp_replace(trim(oi.camper_name), '\s+', ' ', 'g')) as camper_key,
         greatest(0, o.total_cents - o.amount_today_cents - o.installments_paid_cents) as order_balance
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  left join public.families f on lower(f.email) = lower(o.email)
  where o.status in ('paid', 'confirmed', 'complete', 'succeeded')
    and coalesce(f.is_test, false) = false
),
enr as (
  select e.id, e.external_id, e.student_id, e.status, e.balance_cents,
         lower(regexp_replace(trim(s.first_name || ' ' || s.last_name), '\s+', ' ', 'g')) as student_key,
         lower(regexp_replace(trim(coalesce(cm.name, '')), '\s+', ' ', 'g')) as linked_camper_key,
         coalesce(p.registration_activity_id, c.registration_activity_id) as portal_activity_id,
         coalesce(p.title, c.name) as portal_offering
  from family_hub.enrollments e
  join family_hub.students s on s.id = e.student_id
  left join public.campers cm on cm.id = s.camper_id
  left join family_hub.productions p on p.id = e.production_id
  left join family_hub.classes c on c.id = e.class_id
  where e.external_source = 'website'
),
-- the enrollment stamped with this exact line, if any
direct as (
  select i.*, e.id as enr_id, e.status as enr_status, e.balance_cents,
         e.student_key, e.linked_camper_key, e.portal_activity_id, e.portal_offering
  from items i
  left join enr e on e.external_id = i.item_id::text
)
-- 1. a paid line the portal does not have (allowing the double-booked twin)
select 'not_in_portal', d.order_no, d.email, d.camper_name,
       coalesce(d.show, 'activity ' || d.activity_id::text, '?') || ' — no enrollment in the parent portal'
from direct d
where d.enr_id is null
  and not exists (
    select 1 from items i2 join enr e2 on e2.external_id = i2.item_id::text
    where i2.order_id = d.order_id and i2.item_id <> d.item_id
      and i2.camper_key = d.camper_key
      and (i2.activity_id = d.activity_id or (i2.activity_id is null and d.activity_id is null and i2.show = d.show)))
union all
-- 2. right line, wrong child
select 'wrong_child', d.order_no, d.email, d.camper_name,
       'portal enrollment is on "' || d.student_key || '"'
from direct d
where d.enr_id is not null and d.student_key <> d.camper_key and d.linked_camper_key <> d.camper_key
union all
-- 3. right child, wrong show or class
select 'wrong_program', d.order_no, d.email, d.camper_name,
       'bought activity ' || d.activity_id::text || ', portal has "' || coalesce(d.portal_offering, '?') || '" (activity ' || coalesce(d.portal_activity_id::text, 'none') || ')'
from direct d
where d.enr_id is not null and d.activity_id is not null
  and d.portal_activity_id is not null and d.portal_activity_id <> d.activity_id
union all
-- 4. paid, but the portal says withdrawn
select 'withdrawn_but_paid', d.order_no, d.email, d.camper_name,
       'order is paid, portal enrollment is ' || d.enr_status
from direct d
where d.enr_id is not null and d.enr_status = 'withdrawn'
union all
-- 5. the family's portal balance for this order is not the order's balance
select 'balance_mismatch', x.order_no, x.email, null,
       'portal shows $' || to_char(x.portal_balance / 100.0, 'FM999990.00') ||
       ' owed, order says $' || to_char(x.order_balance / 100.0, 'FM999990.00')
from (
  select d.order_no, d.email, max(d.order_balance) as order_balance,
         coalesce(sum(d.balance_cents), 0) as portal_balance, count(*) as n_items
  from direct d
  group by d.order_id, d.order_no, d.email
) x
where abs(x.portal_balance - x.order_balance) > x.n_items  -- cents of per-line rounding
$function$;

revoke all on function public.registration_portal_audit() from public, anon, authenticated;
grant execute on function public.registration_portal_audit() to service_role;
