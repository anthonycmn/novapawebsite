# Launch Checklist — custom registration go-live

Working doc for the staging → production launch. Owner: Jason (site/DB), CJ (Sawyer/Regpack/Stripe).

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
