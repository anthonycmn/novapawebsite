// Tell the Chief when a seat offer is redeemed.
//
// CJ, 11 Sep 2026: "Add the email to me when a seat offer is redeemed."
//
// An offer (db/registration/seat_offers.sql) is a decision to let one family
// past a full cast; the person who made it wants to hear that it landed,
// without reading the ordinary registration receipt to work it out. Called
// right after confirm_order from both places that confirm an order —
// reg-webhook.mjs (paid) and reg-pay.mjs (a $0 order) — and it finds the
// offers by the order id confirm_order stamped onto them.
//
// One email per seat, ever: Stripe redelivers webhook events for days and
// confirm_order is idempotent, so the same order can come through here more
// than once. alerted_at is stamped before the send is treated as done, and
// only rows without it are sent. A failed email is logged and retried on the
// next delivery, never allowed to fail the order.
import { SUPABASE_URL } from "./reg-config.mjs";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const whenET = (iso) => new Date(iso).toLocaleString("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
});

export async function alertSeatOffersRedeemed(orderId) {
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rk = process.env.RESEND_API_KEY;
  if (!orderId || !svc || !rk) return 0;
  const hdrs = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/seat_offers?order_id=eq.${encodeURIComponent(orderId)}&alerted_at=is.null` +
    `&select=id,activity_id,email,camper_name,parent_name,issued_by,issued_at,redeemed_at,waitlist_id`,
    { headers: hdrs });
  const offers = r.ok ? await r.json() : [];
  if (!Array.isArray(offers) || !offers.length) return 0;

  // Same recipient as the "somebody joined the waitlist" alert: whoever
  // decides capacity. cj@ since 11 Sep 2026.
  const to = (process.env.WAITLIST_ALERT_TO || "cj@novapa.org").split(",").map((s) => s.trim()).filter(Boolean);
  let sent = 0;

  for (const o of offers) {
    try {
      const [act, still] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${o.activity_id}&select=name,capacity,sold,booked_offline`, { headers: hdrs })
          .then((x) => (x.ok ? x.json() : [])).then((rows) => rows[0] || {}),
        // what is left at the door, so the next decision can be made from the email
        Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/cast_waitlist?activity_id=eq.${o.activity_id}&notified_at=is.null&select=id`,
            { headers: { ...hdrs, Prefer: "count=exact", Range: "0-0" } }),
          fetch(`${SUPABASE_URL}/rest/v1/seat_offers?activity_id=eq.${o.activity_id}&redeemed_at=is.null&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id`,
            { headers: { ...hdrs, Prefer: "count=exact", Range: "0-0" } }),
        ]).then(([w, p]) => ({
          waiting: parseInt((w.headers.get("content-range") || "").split("/")[1], 10) || 0,
          open: parseInt((p.headers.get("content-range") || "").split("/")[1], 10) || 0,
        })),
      ]);
      const booked = (act.sold || 0) + (act.booked_offline || 0);
      const name = act.name || `activity ${o.activity_id}`;
      const who = o.camper_name || "The camper";

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "NOVAPA Alerts <leads@mail.novapa.org>", to,
          subject: `Seat taken: ${who} — ${name}`,
          html: `<div style="max-width:600px;margin:0 auto;padding:26px 22px;font-family:Helvetica,Arial,sans-serif;color:#0B1422">
<div style="font:700 20px/1.3 Helvetica,Arial,sans-serif">${esc(who)} took the seat</div>
<div style="font:14px/1.8 Helvetica,Arial,sans-serif;margin-top:10px">
<b>${esc(name)}</b> is now <b>${booked}${act.capacity != null ? ` of ${act.capacity}` : ""}</b>.<br>
Parent: ${esc(o.parent_name || "?")} &middot; <a href="mailto:${esc(o.email)}" style="color:#0B1422">${esc(o.email)}</a><br>
Offered ${esc(whenET(o.issued_at))} by ${esc(o.issued_by)} &middot; paid ${esc(whenET(o.redeemed_at || new Date().toISOString()))}</div>
<div style="font:13px/1.7 Helvetica,Arial,sans-serif;color:#5B6472;margin-top:14px">
Still at the door: ${still.waiting} waiting with no offer yet, ${still.open} offer${still.open === 1 ? "" : "s"} open.
Staff portal &rsaquo; Offerings &rsaquo; Waitlist to offer the next one.</div></div>`,
        }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 160)}`);

      await fetch(`${SUPABASE_URL}/rest/v1/seat_offers?id=eq.${o.id}`, {
        method: "PATCH", headers: { ...hdrs, Prefer: "return=minimal" },
        body: JSON.stringify({ alerted_at: new Date().toISOString() }),
      });
      sent++;
    } catch (e) {
      console.error("seat offer alert:", o.id, e.message);
    }
  }
  return sent;
}
