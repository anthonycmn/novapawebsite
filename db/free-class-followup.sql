-- The note from CJ after a free class: what was sent, and when.
--
-- reg-freeclass-followup.mjs (16 Sep 2026) emails a family once their
-- attended free class has ended. followup_sent_at is the claim: it is stamped
-- before the send, and only rows without it are ever picked up, so a family is
-- never written to twice. followup_message_id is Resend's id for the email,
-- or "FAILED <when> <why>" when the send did not go, so the roster can show
-- which families still need a human note.
--
-- Idempotent: safe to run twice. Applied to the live project via the Supabase
-- MCP on 16 Sep 2026.

alter table public.free_class_bookings
  add column if not exists followup_sent_at    timestamptz,
  add column if not exists followup_message_id text;

comment on column public.free_class_bookings.followup_sent_at is
  'When the after-class note from CJ was claimed for sending (reg-freeclass-followup.mjs). Stamped before the send; a row with this set is never emailed again.';
comment on column public.free_class_bookings.followup_message_id is
  'Resend message id of the after-class note, or "FAILED <when> <why>" when it did not send.';

create index if not exists free_class_bookings_followup_idx
  on public.free_class_bookings (class_date)
  where status = 'attended' and followup_sent_at is null;
