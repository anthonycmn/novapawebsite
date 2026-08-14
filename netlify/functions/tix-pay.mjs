// POST /api/tix-pay — create a PaymentIntent for held seats.
// GET  /api/tix-pay?show=sweeney-todd            -> show + performances + tiers
// GET  /api/tix-pay?performance=<id>             -> live seat map
//
// Guest checkout, same reasoning as dcu-pay: ticket buyers are grandparents
// and family friends making one purchase. No account, no magic link. All
// pricing is computed here from the database — the client's numbers are
// display only. Deliberately imports nothing from reg-config: no edit to this
// file can move a camp price, and vice versa.
import Stripe from "stripe";

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
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

  let total = 0;
  const lines = rows.map((s) => {
    const t = tierBy[s.tier];
    if (!t) throw new Error(`no tier ${s.tier}`);
    const cents = t.price_cents + t.fee_cents;
    total += cents;
    return `${s.section === "HL" ? "House Left" : "House Right"} ${s.row_label}${s.seat_no}`;
  });
  if (total < 50) return Response.json({ error: "bad_total" }, { status: 500 });

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
    },
  });

  return Response.json({
    client_secret: pi.client_secret,
    hold_id: hold.hold_id,
    expires_in: hold.expires_in,
    pricing: { total_cents: total, seats: lines },
  });
};

export const config = { path: "/api/tix-pay" };
