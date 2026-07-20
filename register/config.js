// Public client config for the Summer 2027 registration flow.
// Both keys below are publishable-by-design (Supabase anon key is guarded by
// RLS + SECURITY DEFINER RPCs; Stripe publishable key is meant for browsers).
window.NOVAREG = {
  SUPABASE_URL: "https://tlkuqwsqicxcjdmumkje.supabase.co",
  SUPABASE_ANON_KEY:
    "sb_publishable_8ar97CkK-C0YlWuOGtI_tA_mwTDVE6H",
  // Stripe PUBLISHABLE key (pk_test_... for testing, pk_live_... at launch).
  // Set by Jason — leave "" to show the payments-not-configured notice.
  STRIPE_PUBLISHABLE_KEY: "pk_live_51TvMGTGWP2ZbtaszSIFv1Ee0L7eyPtRVfvkaaR7xtnLTEMtGvngtbTwJngTlJKq70OkQ9LyGH5xt0y4JfziZVdTx001CwdMSlg",

  // Display constants — server (reg-config.mjs) is the source of truth.
  PRICE: 995,
  DEPOSIT_PER_CAMP: 180,
  INSTALLMENTS: 8,
  INSURANCE_PCT: 10,
  EARLYBIRD_END: "2026-08-15T23:59:59-04:00",
  PUBLIC_OPEN_AT: "2026-08-01T10:00:00-04:00",
};
