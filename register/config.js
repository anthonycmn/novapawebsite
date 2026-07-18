// Public client config for the Summer 2027 registration flow.
// Both keys below are publishable-by-design (Supabase anon key is guarded by
// RLS + SECURITY DEFINER RPCs; Stripe publishable key is meant for browsers).
window.NOVAREG = {
  SUPABASE_URL: "https://osagllrzztcxzpnpudcr.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zYWdsbHJ6enRjeHpwbnB1ZGNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzOTE1NjEsImV4cCI6MjA5OTk2NzU2MX0.YFF_O55bpSU8JdRw-CtmyHiQ-8K7saoF1a6lXYoWPkA",
  // Stripe PUBLISHABLE key (pk_test_... for testing, pk_live_... at launch).
  // Set by Jason — leave "" to show the payments-not-configured notice.
  STRIPE_PUBLISHABLE_KEY: "pk_test_51Ofz6ZHHQ0jZRpHdzK7YkFWlnU6M0hAwgFcnJPV8ZEDMKU8H0I0SOfJ7aVYGeQzMoiBuYSz5nFFyF3gyMmA03RNr00ItKrhNzQ",

  // Display constants — server (reg-config.mjs) is the source of truth.
  PRICE: 995,
  DEPOSIT_PER_CAMP: 180,
  FAMILY_FEE: 25,
  INSTALLMENTS: 8,
  EARLYBIRD_END: "2026-08-15T23:59:59-04:00",
  PUBLIC_OPEN_AT: "2026-08-01T10:00:00-04:00",
};
