-- Katie Hamberger gets the registration alerts (Sep 20 2026).
--
-- NOT YET APPLIED. CJ runs this. Nothing in code changes; the alert
-- functions read public.admin_emails at send time and pick the new row up
-- on the next order.
--
-- Why. Every "New registration" alert (reg-webhook on a Stripe payment,
-- reg-pay on a fully credited free order, reg-freeclass on a trial booking,
-- reg-apply on an employment interest) goes to whoever is in
-- public.admin_emails. On Sep 20 2026 that is four rows: todd@, cj@, jen@
-- and katie@, and katie@ is Katie Rivers, Health and Safety. Katie
-- Hamberger, katieh@, the Director of Education who builds the day camp
-- rosters, is on no registration alert at all. On Sep 19 a seat was taken
-- for the next morning's camp at 7:45 PM and the person who needed to know
-- was not on the list.
--
-- The same table gates the admin dashboard through is_admin(), so the row
-- carries a role. 'ops' is what katie@ has (admin_role.sql, Aug 31 2026):
-- leads, registration management and camper info, and none of the money
-- or marketing pages, which check admin_role() = 'full'. That is the right
-- fit for a roster builder.
--
-- Expected: 1 row inserted; the select afterwards returns 5 rows.

insert into public.admin_emails (email, role)
values ('katieh@novapa.org', 'ops')
on conflict (email) do update set role = excluded.role;

select email, role from public.admin_emails order by email;
