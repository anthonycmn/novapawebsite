# Launch Checklist — custom registration go-live

Working doc for the staging → production launch. Owner: Jason (site/DB), CJ (Sawyer/Regpack/Stripe).

## Stripe live cutover (Broadway Bound account)
- [x] STRIPE_SECRET_KEY (live) in Netlify env — set by Jason. Confirm the var applies to
      **branch deploys** too (Netlify → Site config → Environment variables → the var →
      scopes/contexts), or staging tests will still hit the old account.
- [x] Live publishable key committed to register/config.js (staging).
- [ ] **Webhook endpoint** in the Broadway Bound Stripe dashboard (live mode):
      Developers → Webhooks → Add destination/endpoint.
      URL now (testing): `https://staging-summer-sprint--northernvirginiaperformingarts.netlify.app/api/reg-webhook`
      Event: **payment_intent.succeeded** only (that's all the handler consumes).
      Copy its signing secret (whsec_...) → Netlify env `STRIPE_WEBHOOK_SECRET` → redeploy.
- [ ] At launch: add a second endpoint for `https://www.northernvirginiaperformingarts.org/api/reg-webhook`
      (its own whsec_) and scope Netlify's STRIPE_WEBHOOK_SECRET per context
      (production = prod endpoint secret, branch = staging endpoint secret).
- [ ] Stripe → Settings → Emails: turn ON "Successful payments" (customer receipts) and
      "Refunds". Set support email + statement descriptor while there.
- [ ] Stripe → Settings → Payment method domains: add the staging domain AND
      www.northernvirginiaperformingarts.org (Apple Pay button won't render without this).
- [ ] Stripe → Settings → Billing → Revenue recovery: enable Smart Retries + failed-payment
      emails (covers bounced installment/class autopay cards).
- [ ] Live E2E test (our checkout has NO coupon field by design — test with real money, then
      refund from the Stripe dashboard): cheapest full-flow item is a $70 day camp via
      classes/catalog, or a $180 summer deposit to exercise the installment schedule.
      Verify after paying: order confirmed in admin dashboard, inventory decremented,
      subscription schedule created in Stripe with correct dates (1st of month), receipt
      email arrived, FSA receipt prints. Then refund in Stripe (Stripe keeps ~2.9% fee).
- [ ] Test both entries: RETURNING (real family email → magic link → prefilled kids) and
      NEW (waitlist capture pre-Aug 1).

## Email (blocking for launch)
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
- [ ] Audition form link on teen_conservatory_auditions.html still points at Regpack —
      page is now unlinked from the site, but give auditions a new home before killing Regpack.

## Stripe / email
- [ ] CJ creates NOVAPA live Stripe account; Jason pastes live keys into Netlify env.
- [ ] Google Workspace SMTP app password into Supabase auth (magic-link emails).

## Nice-to-have before launch
- [ ] Camper × camp double-book guard at checkout (46 Regpack families could re-buy the same camp).
- [ ] reg-sync.mjs daily catalog/open_spots re-sync (classes stay both-doors).
- [ ] Admin write actions: record offline payment, mark settled, sawyer_entered toggle.
