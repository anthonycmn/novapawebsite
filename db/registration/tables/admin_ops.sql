-- Phase C write-action support tables (Aug 12 2026).
-- activity_price_log: every price change with a required reason — Todd's
-- audit trail for "why did this class cost X in March".
-- admin_actions: one row per dashboard write (move, cancel, product edit,
-- manual referral) with the acting admin's email.
-- RLS is enabled with no policies: only service_role (the Netlify functions)
-- can touch them; the anon key sees nothing.

CREATE TABLE IF NOT EXISTS public.activity_price_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activity_id bigint NOT NULL,
  old_price_cents integer,
  new_price_cents integer,
  reason text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_price_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
