// POST /api/tix-pay — create a PaymentIntent for held seats.
// GET  /api/tix-pay?show=sweeney-todd            -> show + performances + tiers
// GET  /api/tix-pay?performance=<id>             -> live seat map
//
// Guest checkout, same reasoning as dcu-pay: ticket buyers are grandparents
// and family friends making one purchase. No account, no magic link. All
// pricing is computed here from the database — the client's numbers are
// display only. Deliberately imports nothing from reg-config: no edit to this
// file can move a camp price, and vice versa.
// Credits (Jason, Aug 14): a generic "apply credits" step at checkout.
// Priority 1: an unredeemed referral reward ("2 tickets to any show") on the
// signed-in account frees the two priciest seats in the cart. Priority 2: a
// credit/coupon code deducts from what remains, spending down partially like
// everywhere else. If the total reaches $0 we skip Stripe entirely and
// confirm directly, mirroring the camps free-order path. Sign-in is never
// required — the page silently reuses an existing My NOVAPA session because
// it lives on the same origin.
import Stripe from "stripe";

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";
// Publishable by design (shipped to every browser in register/config.js).
const SUPABASE_ANON_KEY = "sb_publishable_8ar97CkK-C0YlWuOGtI_tA_mwTDVE6H";

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// Resolve a Supabase session token to an email; null on anything invalid.
async function emailFromJwt(req) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return (u.email || "").toLowerCase() || null;
}

// The first unredeemed referral reward for this account, either side of it.
async function rewardFor(email) {
  const enc = encodeURIComponent(email);
  const rows = await (await fetch(
    `${SUPABASE_URL}/rest/v1/referral_rewards?select=*&status=eq.earned` +
    `&or=(referrer_email.ilike.${enc},referred_email.ilike.${enc})&order=created_at`,
    { headers: svcHeaders() })).json();
  for (const r of rows || []) {
    if (r.referrer_email?.toLowerCase() === email && !r.referrer_redeemed_at) {
      return { id: r.id, side: "referrer" };
    }
    if (r.referred_email?.toLowerCase() === email && !r.referred_redeemed_at) {
      return { id: r.id, side: "referred" };
    }
  }
  return null;
}
async function rpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: svcHeaders(), body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return t; }
}
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

export default async (req) => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  if (req.method === "GET") {
    const u = new URL(req.url);
    const slug = u.searchParams.get("show");
    const perf = parseInt(u.searchParams.get("performance") || "0", 10);
    try {
      // GET ?credits=1 with a session token -> what this account can apply.
      if (u.searchParams.get("credits")) {
        const email = await emailFromJwt(req);
        if (!email) return Response.json({ free_tickets: 0 });
        const reward = await rewardFor(email);
        return Response.json({ email, free_tickets: reward ? 2 : 0 });
      }
      if (slug) {
        const show = await rpc("tix_show", { p_slug: clean(slug, 60) });
        if (!show) return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json(show);
      }
      if (perf) return Response.json({ seats: await rpc("tix_seatmap", { p_performance_id: perf }) });
    } catch (e) {
      console.error("tix-pay GET:", e.message);
      return Response.json({ error: "server_error" }, { status: 500 });
    }
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  if (!process.env.STRIPE_SECRET_KEY) return Response.json({ error: "payments_not_configured" }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }

  const performanceId = parseInt(body.performance_id, 10);
  const seatIds = Array.isArray(body.seat_ids) ? body.seat_ids.map(Number).filter(Boolean) : [];
  const email = clean(body.email, 200).toLowerCase();
  const buyerName = clean(body.buyer_name, 100);
  if (!performanceId || !seatIds.length || seatIds.length > 12) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return Response.json({ error: "bad_email" }, { status: 400 });
  if (!buyerName) return Response.json({ error: "missing_name" }, { status: 400 });

  // Price server-side: seat -> tier -> price for THIS show. Also verify the
  // performance is on sale and the show's master switch is on.
  const rows = await (await fetch(
    `${SUPABASE_URL}/rest/v1/tix_seats?id=in.(${seatIds.join(",")})&select=id,tier,row_label,seat_no,section`,
    { headers: svcHeaders() })).json();
  if (!Array.isArray(rows) || rows.length !== seatIds.length) {
    return Response.json({ error: "unknown_seat" }, { status: 400 });
  }
  const perfRows = await (await fetch(
    `${SUPABASE_URL}/rest/v1/tix_performances?id=eq.${performanceId}&select=id,status,starts_at,show_id,tix_shows(slug,title,on_sale)`,
    { headers: svcHeaders() })).json();
  const perf = perfRows[0];
  if (!perf || perf.status !== "onsale" || !perf.tix_shows?.on_sale) {
    return Response.json({ error: "not_on_sale" }, { status: 409 });
  }
  const tiers = await (await fetch(
    `${SUPABASE_URL}/rest/v1/tix_tiers?show_id=eq.${perf.show_id}&select=name,price_cents,fee_cents`,
    { headers: svcHeaders() })).json();
  const tierBy = Object.fromEntries(tiers.map((t) => [t.name, t]));

  const priced = rows.map((s) => {
    const t = tierBy[s.tier];
    if (!t) throw new Error(`no tier ${s.tier}`);
    return {
      cents: t.price_cents + t.fee_cents,
      line: `${s.section === "HL" ? "House Left" : "House Right"} ${s.row_label}${s.seat_no}`,
    };
  });
  let total = priced.reduce((n, p) => n + p.cents, 0);
  const listTotal = total;
  const lines = priced.map((p) => p.line);

  // --- credits, in priority order -----------------------------------------
  // 1. Referral reward: only for a verified session, never for a typed email —
  //    otherwise anyone who knows a member's address could spend their reward.
  let reward = null, rewardCents = 0;
  if (body.apply_reward) {
    const sessionEmail = await emailFromJwt(req);
    if (sessionEmail) reward = await rewardFor(sessionEmail);
    if (reward) {
      const byPrice = [...priced].sort((a, b) => b.cents - a.cents);
      rewardCents = byPrice.slice(0, 2).reduce((n, p) => n + p.cents, 0);
      total -= rewardCents;
      reward.email = sessionEmail;
    }
  }
  // 2. Credit / coupon code. Invalid codes are a hard error so the client can
  //    never show a discount and then silently charge full price (reg-pay rule).
  const couponCode = clean(body.coupon, 20).toUpperCase();
  let couponCents = 0;
  if (couponCode) {
    const c = await rpc("check_coupon", { p_code: couponCode });
    if (!c || (!c.pct && !c.amount_cents)) {
      return Response.json({ error: "bad_coupon" }, { status: 400 });
    }
    couponCents = c.pct ? Math.round(total * c.pct / 100) : Math.min(c.amount_cents, total);
    total -= couponCents;
  }

  // Hold the seats (atomic; races answer SEAT_TAKEN cleanly).
  let hold;
  try {
    hold = await rpc("tix_hold_seats", {
      p_performance_id: performanceId, p_seat_ids: seatIds, p_email: email,
    });
  } catch (e) {
    if (/SEAT_TAKEN/.test(e.message)) return Response.json({ error: "seat_taken" }, { status: 409 });
    console.error("tix hold:", e.message);
    return Response.json({ error: "hold_failed" }, { status: 500 });
  }

  const when = new Date(perf.starts_at).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });

  const creditMeta = {
    list_cents: String(listTotal),
    ...(reward ? { reward_id: String(reward.id), reward_side: reward.side,
                   reward_email: reward.email, reward_cents: String(rewardCents) } : {}),
    ...(couponCode && couponCents ? { coupon: couponCode, coupon_cents: String(couponCents) } : {}),
  };

  // Fully covered by credits: nothing to charge, so Stripe never enters the
  // picture. Confirm immediately through the same idempotent path the webhook
  // uses, keyed by a synthetic intent id, then settle the credits.
  if (total === 0) {
    try {
      const { confirmTickets } = await import("./tix-confirm.mjs");
      const res = await confirmTickets({
        id: "free_" + hold.hold_id,
        metadata: {
          tix_hold_id: hold.hold_id,
          tix_performance_id: String(performanceId),
          email, buyer_name: buyerName,
          total_cents: "0",
          seats: lines.join(", ").slice(0, 480),
          show_title: perf.tix_shows.title.slice(0, 100),
          performance_when: when,
          ...creditMeta,
        },
      });
      return Response.json({ confirmed: true, code: res.code,
        pricing: { total_cents: 0, list_cents: listTotal, seats: lines } });
    } catch (e) {
      console.error("free ticket order failed:", e.message);
      return Response.json({ error: "confirm_failed" }, { status: 500 });
    }
  }
  if (total < 50) return Response.json({ error: "credit_leaves_tiny_total" }, { status: 400 });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const pi = await stripe.paymentIntents.create({
    amount: total,
    currency: "usd",
    payment_method_types: ["card", "link"],
    description: `NOVAPA Tickets — ${perf.tix_shows.title}, ${when}`,
    statement_descriptor_suffix: "NOVAPA TIX",
    metadata: {
      // Branch key for the shared webhook. Nothing else in reg-webhook fires
      // without hold_id + plan, so tix events pass through it inert.
      tix_hold_id: hold.hold_id,
      tix_performance_id: String(performanceId),
      email, buyer_name: buyerName,
      total_cents: String(total),
      seats: lines.join(", ").slice(0, 480),
      show_title: perf.tix_shows.title.slice(0, 100),
      performance_when: when,
      ...creditMeta,
    },
  });

  return Response.json({
    client_secret: pi.client_secret,
    hold_id: hold.hold_id,
    expires_in: hold.expires_in,
    pricing: { total_cents: total, list_cents: listTotal,
      reward_cents: rewardCents, coupon_cents: couponCents, seats: lines },
  });
};

export const config = { path: "/api/tix-pay" };
