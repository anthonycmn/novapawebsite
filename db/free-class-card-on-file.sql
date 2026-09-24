-- A card on file for every free class, a $30 no-show fee, and one-click
-- enrollment afterward.
--
-- CJ, 24 Sep 2026: "We want to collect a credit card for the free class trial
-- that gets charged if they do not show ($30 no show fee) and then they
-- receive an email with a one click button authorizing us to charge for the
-- class." Charge automatically on a no-show; free cancellation up to 24 hours
-- before the class; the one-click button is to enroll.
--
-- What the columns carry:
--
--   stripe_customer_id / stripe_payment_method_id
--       The card the family saved on the booking page (a SetupIntent, no
--       money moved). Null on every booking made before this shipped, and
--       those rows behave exactly as before: no fee, no one-click button.
--   card_saved_at
--       When the family agreed to the terms and saved the card.
--   link_token
--       The unguessable key in the "cancel" and "enroll" links. A link is the
--       only thing a family holds, so it stands in for a sign-in; it names one
--       booking and nothing else.
--   cancelled_at
--       When the family canceled from the link (status becomes cancelled).
--   no_show_fee_state
--       null      nothing to do, or not yet due
--       charging  reg-freeclass-noshow claimed it (stamped BEFORE the charge,
--                 so two scheduled ticks can never both charge)
--       charged   the $30 went through; no_show_fee_pi is the payment
--       failed    the card refused; the office was emailed
--       waived    set by hand when the office forgives it (refund in Stripe)
--   no_show_fee_pi / no_show_fee_at / no_show_fee_note
--       The Stripe payment, when, and why it failed if it did.
--
-- Run in the Supabase SQL editor. Idempotent: safe to run twice.

begin;

alter table public.free_class_bookings
  add column if not exists stripe_customer_id       text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists card_saved_at            timestamptz,
  add column if not exists link_token               uuid not null default gen_random_uuid(),
  add column if not exists cancelled_at             timestamptz,
  add column if not exists no_show_fee_state        text,
  add column if not exists no_show_fee_pi           text,
  add column if not exists no_show_fee_at           timestamptz,
  add column if not exists no_show_fee_note         text;

alter table public.free_class_bookings
  drop constraint if exists free_class_bookings_no_show_fee_state_check;
alter table public.free_class_bookings
  add constraint free_class_bookings_no_show_fee_state_check
  check (no_show_fee_state is null or no_show_fee_state in ('charging', 'charged', 'failed', 'waived'));

create unique index if not exists free_class_bookings_link_token_key
  on public.free_class_bookings (link_token);

-- What the no-show job scans every 15 minutes: marked absent, card on file,
-- fee not yet handled.
create index if not exists free_class_bookings_no_show_fee_due
  on public.free_class_bookings (class_date)
  where status = 'no_show' and stripe_payment_method_id is not null and no_show_fee_state is null;

comment on column public.free_class_bookings.link_token is
  'Key in the family''s cancel and enroll links (novapa.org/free-class/manage and /enroll). Names this one booking only.';
comment on column public.free_class_bookings.no_show_fee_state is
  'null | charging | charged | failed | waived. The $30 no-show fee, charged by reg-freeclass-noshow.mjs two hours after the class ends. Set waived by hand to forgive one; refund the payment in Stripe.';

commit;
