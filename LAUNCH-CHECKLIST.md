# Launch Checklist — custom registration go-live

Working doc for the staging → production launch. Owner: Jason (site/DB), CJ (Sawyer/Regpack/Stripe).

## Stripe live cutover (Broadway Bound account)
- [x] STRIPE_SECRET_KEY (live) in Netlify env — set by Jason. Confirm the var applies to
      **branch deploys** too (Netlify → Site config → Environment variables → the var →
      scopes/contexts), or staging tests will still hit the old account.
- [x] Live publishable key committed to register/config.js (staging).
- [x] **Webhook endpoint** live and enabled. Verified Sep 21, 2026 by reading
      `/v1/webhook_endpoints` on the live account `acct_1TvMGTGWP2Zbtasz`.
      Endpoint `we_1TvOVrGWP2ZbtaszwuhxWPnc`, status `enabled`,
      URL `https://novapa.org/api/reg-webhook`.
      Events: **payment_intent.succeeded, setup_intent.succeeded, invoice.paid**.
      This line used to read "payment_intent.succeeded only (that's all the handler
      consumes)". That stopped being true on Sep 20, 2026, when PRs #143 and #144 added
      `invoice.paid` handling to `reg-webhook.mjs` so class subscription invoices record
      through `record_installment_paid`. `setup_intent.succeeded` carries the cards saved
      at checkout for a first charge on the 1st. Do NOT narrow this endpoint back to one
      event: class and installment cash stops recording the moment you do.
      Its signing secret is already in Netlify env `STRIPE_WEBHOOK_SECRET`.
- [x] Second live endpoint exists and is enabled: `we_1UCOqIGWP2ZbtaszcupFo4b2`,
      URL `https://portal.novapa.org/api/store/stripe-webhook`, event
      `checkout.session.completed` (parent portal store). Production runs on
      `novapa.org`, so the planned `www.northernvirginiaperformingarts.org` reg-webhook
      endpoint and the per-context secret split are not needed. No staging endpoint is
      registered; the staging URL this section used to name is retired.
- [ ] Stripe → Settings → Emails: turn ON "Successful payments" (customer receipts) and
      "Refunds". Set support email + statement descriptor while there.
      Browser only. A restricted API key can neither read nor set these, so only a person
      who has opened the page can tick this. Still open as of Sep 21, 2026.
- [ ] Stripe → Settings → Payment method domains: add the staging domain AND
      www.northernvirginiaperformingarts.org (Apple Pay button won't render without this).
      Browser only. `/v1/payment_method_domains` returns a permissions error on the key
      this repo's agents hold, so the live state is unknown. Still open as of Sep 21, 2026.
- [ ] Stripe → Settings → Billing → Revenue recovery: enable Smart Retries + failed-payment
      emails (covers bounced installment/class autopay cards).
      Browser only, no API exists for it:
      https://dashboard.stripe.com/settings/billing/automatic
      This is the one that matters before Oct 1, 2026: 65 cards draw $11,762.52 that
      morning and 19 of them have never been charged once. Still open as of Sep 21, 2026.
- [ ] Live E2E test (our checkout has NO coupon field by design — test with real money, then
      refund from the Stripe dashboard): cheapest full-flow item is a $70 day camp via
      classes/catalog, or a $180 summer deposit to exercise the installment schedule.
      Verify after paying: order confirmed in admin dashboard, inventory decremented,
      subscription schedule created in Stripe with correct dates (1st of month), receipt
      email arrived, FSA receipt prints. Then refund in Stripe (Stripe keeps ~2.9% fee).
- [ ] Test both entries: RETURNING (real family email → magic link → prefilled kids) and
      NEW (waitlist capture pre-Aug 1).

## Email (blocking for launch)
- [ ] Post-launch: migrate SMTP off jason@novapa.org to a role account (info@ or no-reply@,
      must be a real licensed mailbox with 2FA — not a Group alias). App passwords die with
      the account they're created on; swap = new app password → Supabase SMTP + Netlify
      SMTP_USER/SMTP_PASS.
- [ ] **Supabase SMTP**: paste the Google Workspace app password into Supabase Auth → SMTP
      settings. Without it, magic-link sign-in emails are rate-limited to a couple per hour
      on Supabase's built-in mailer — this WILL break under a newsletter push.
- [x] Payment receipts: Stripe sends these once the Emails toggle above is on.
- [ ] Registration confirmation email (what you signed up for, dates, next steps): we do NOT
      send one yet — the done page + Stripe receipt cover launch; build post-launch or skip.

## Site + database
- [ ] Wipe test data: Jason's 4 test registrations (inflate `inventory.booked`), test orders/holds.
- [ ] Merge `staging-summer-sprint` → `main` (needs Jason's explicit approval).
- [ ] After Sawyer listings flip private (below): re-run the offline-booked import so
      `activities.booked_offline` (Sawyer sold + Regpack) is final as of the flip.
- [ ] Final Regpack re-snapshot after Todd's audit/refunds settle (full replace, not merge).

## Sawyer admin (CJ or Jason)
- [ ] Flip **private**: 12 Summer 2027 BB listings + Frozen ×3 + Little Mermaid ×3.
- [ ] Flip **private**: all 10 day-camp listings (Disney Adventure, K-Pop Superstars,
      Villain Academy, Island Adventures, Pop Star Academy, Musical Theatre Day Camp ×5) —
      these now sell through the site.
- [ ] Keep **public** on Sawyer: classes (both doors, we re-sync), Dear Evan Hansen intensive
      (legacy, only thing left selling on Sawyer for camps), Broadway Bound Teen
      (Sweeney Todd + Hadestown — casts set, current-member registrations only).
- [ ] **Aug 15**: archive auto discounts "Premium early bird summer camps" and
      "Teen conservatory two shows" — Sawyer auto discounts have NO end-date field,
      so the launch-sale cutoff is a manual archive.
- [ ] Optional: rename Sawyer listings "Teen Conservatory Fall/Spring …" →
      "Broadway Bound Teen …" (renamed everywhere else already).
- [ ] "Apply uniquely per registrant" toggles: on "Teen conservatory two shows" the ON
      toggle is now CORRECT (per-kid two-show bundle). On "Premium early bird summer camps"
      it still needs CJ's call (ON = per-kid, which matches the new per-kid tiers).

## Regpack (CJ)
- [ ] Disable the 3 Summer 2027 products (still actively selling as of Jul 15 order).
- [x] Every Regpack and Sawyer embed is off the website (Jul 31). What is left below is
      admin cleanup in their dashboards, not anything a visitor can still reach.
- [x] Audition form link on teen_conservatory_auditions.html no longer points at Regpack
      (Jul 31) — the page now asks families to email info@novapa.org for a slot. A real
      audition form still needs a home in our own system.
- [ ] Coaching moved off the Regpack embed (Jul 31): /coaching-registration.html is deleted
      and redirected to /register/?coaching. **Run `db/coaching-activities.sql` in the
      Supabase SQL editor** — until those 24 rows exist, the Coaching menu offers an email
      instead of a checkout link.

## Stripe / email
- [ ] CJ creates NOVAPA live Stripe account; Jason pastes live keys into Netlify env.
- [ ] Google Workspace SMTP app password into Supabase auth (magic-link emails).

## Nice-to-have before launch
- [ ] Camper × camp double-book guard at checkout (46 Regpack families could re-buy the same camp).
- [ ] reg-sync.mjs daily catalog/open_spots re-sync (classes stay both-doors).
- [ ] Admin write actions: record offline payment, mark settled, sawyer_entered toggle.
