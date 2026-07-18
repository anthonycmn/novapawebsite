// Shared pricing + window config for the Summer 2027 registration flow.
// Single source of truth for money math — the client only displays numbers,
// reg-pay.mjs recomputes everything server-side.
// All dollar amounts pending CJ sign-off are marked.

export const SUPABASE_URL = "https://osagllrzztcxzpnpudcr.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zYWdsbHJ6enRjeHpwbnB1ZGNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzOTE1NjEsImV4cCI6MjA5OTk2NzU2MX0.YFF_O55bpSU8JdRw-CtmyHiQ-8K7saoF1a6lXYoWPkA";

export const PRICE_CENTS = 99500;            // $995 per camp
export const DEPOSIT_PER_CAMP_CENTS = 18000; // $180 reserve per camp (CJ sign-off)
export const FAMILY_FEE_CENTS = 2500;        // $25 annual family fee; waived on pay-in-full (CJ sign-off)
export const INSTALLMENTS = 8;               // monthly, Sep 2026 – Apr 2027
export const EARLYBIRD_END = "2026-08-15T23:59:59-04:00";
export const PUBLIC_OPEN_AT = "2026-08-01T10:00:00-04:00";
export const INSTALLMENT_START_UTC = Date.UTC(2026, 8, 1, 4, 0, 0) / 1000; // Sep 1 2026 00:00 ET

export const SHOWS = {
  httyd: "How to Train Your Dragon JR.",
  charlie: "Charlie and the Chocolate Factory JR.",
  trolls: "Trolls The Musical JR.",
};
export const BANDS = ["5-9", "9-12", "12-15", "tech"];

export function discountRate(nCamps, now = new Date()) {
  if (now > new Date(EARLYBIRD_END)) return 0;
  if (nCamps >= 3) return 0.20;
  if (nCamps === 2) return 0.15;
  return 0.10;
}

// items: [{show, band, camper}] — every item is one camp registration.
export function priceOrder(items, plan, now = new Date()) {
  const n = items.length;
  const rate = discountRate(n, now);
  const unitCents = Math.round(PRICE_CENTS * (1 - rate));
  const subtotalCents = unitCents * n;
  if (plan === "full") {
    return {
      n, rate, unitCents, subtotalCents,
      familyFeeCents: 0, // waived incentive
      totalCents: subtotalCents,
      todayCents: subtotalCents,
      installmentCents: 0,
    };
  }
  // deposit plan
  const todayCents = DEPOSIT_PER_CAMP_CENTS * n + FAMILY_FEE_CENTS;
  const totalCents = subtotalCents + FAMILY_FEE_CENTS;
  const remainder = subtotalCents - DEPOSIT_PER_CAMP_CENTS * n;
  const installmentCents = Math.ceil(remainder / INSTALLMENTS);
  return { n, rate, unitCents, subtotalCents, familyFeeCents: FAMILY_FEE_CENTS,
           totalCents, todayCents, installmentCents };
}
