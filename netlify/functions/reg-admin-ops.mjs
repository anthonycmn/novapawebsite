// Write actions for the registration dashboard — POST /api/reg-admin-ops
//   { action: 'products_list' }                      -> every activity, incl hidden
//   { action: 'product_update', id, fields, reason } -> edit; price change logs + needs reason
//   { action: 'product_create', fields }             -> new activity (id auto from 2000000)
//   { action: 'move', item_id, show|band|activity_id, force } -> move a paid seat
//   { action: 'cancel', item_id, dry_run:true }      -> preview a cancel + refund
//   { action: 'cancel', item_id, amount_cents, confirm:'REFUND' } -> execute
//   { action: 'referral_add', referrer, referred_email } -> manual referral credit
//
// Same trust shape as reg-coupons: caller proves admin via their own JWT
// (is_admin RPC), then the work runs service-role. Every write lands in
// admin_actions with the admin's email, so "who moved this kid" has an answer.
import Stripe from "stripe";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./reg-config.mjs";

async function whoIsAdmin(userToken) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok || (await r.text()).trim() !== "true") return null;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userToken}` },
  });
  if (!u.ok) return null;
  return ((await u.json()).email || "").toLowerCase() || null;
}
function svc(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}
async function db(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: svc(init.headers || {}) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return null; }
}
async function rpc(name, args) {
  return db(`rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}
async function audit(action, actor, payload) {
  await db("admin_actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, actor, payload }),
  });
}

// Fields an admin may edit. Retiring = bookable:false + hidden:true — there is
// deliberately no delete; sold history hangs off these ids forever.
const EDITABLE = ["name", "schedule_name", "age_range", "price_cents", "capacity", "bookable", "hidden", "category", "location"];

export default async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const actor = auth ? await whoIsAdmin(auth) : null;
  if (!actor) return Response.json({ error: "not admin" }, { status: 403 });

  let body = {};
  try { body = await req.json(); } catch {}
  const action = body.action || "";

  try {
    if (action === "products_list") {
      const rows = await db("activities?select=id,name,category,schedule_name,age_range,price_cents,capacity,sold,booked_offline,bookable,hidden,active,location&order=name&limit=1000");
      return Response.json({ products: rows || [] });
    }

    if (action === "product_update") {
      const id = Number(body.id);
      if (!id) return Response.json({ error: "no id" }, { status: 400 });
      const cur = (await db(`activities?id=eq.${id}&select=*`))[0];
      if (!cur) return Response.json({ error: "activity not found" }, { status: 404 });

      const fields = {};
      for (const k of EDITABLE) if (k in (body.fields || {})) fields[k] = body.fields[k];
      if (!Object.keys(fields).length) return Response.json({ error: "nothing to change" }, { status: 400 });

      if ("price_cents" in fields) {
        fields.price_cents = Math.round(Number(fields.price_cents));
        if (!isFinite(fields.price_cents) || fields.price_cents < 0)
          return Response.json({ error: "bad price" }, { status: 400 });
        if (fields.price_cents !== cur.price_cents && !String(body.reason || "").trim())
          return Response.json({ error: "price changes need a reason (it goes in the price log)" }, { status: 400 });
      }
      if ("capacity" in fields) {
        fields.capacity = Math.round(Number(fields.capacity));
        const floor = (cur.sold || 0) + (cur.booked_offline || 0);
        if (!isFinite(fields.capacity) || fields.capacity < floor)
          return Response.json({ error: `capacity can't go below ${floor} (already registered)` }, { status: 400 });
      }

      const rows = await db(`activities?id=eq.${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(fields),
      });
      if ("price_cents" in fields && fields.price_cents !== cur.price_cents) {
        await db("activity_price_log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activity_id: id, old_price_cents: cur.price_cents, new_price_cents: fields.price_cents,
            reason: String(body.reason).trim(), changed_by: actor,
          }),
        });
      }
      await audit("product_update", actor, { id, fields, was: Object.fromEntries(Object.keys(fields).map((k) => [k, cur[k]])) });
      return Response.json({ ok: true, product: (rows || [])[0] || null });
    }

    if (action === "product_create") {
      const f = body.fields || {};
      const name = String(f.name || "").trim();
      const price = Math.round(Number(f.price_cents));
      const cap = Math.round(Number(f.capacity));
      if (!name) return Response.json({ error: "name required" }, { status: 400 });
      if (!isFinite(price) || price < 0) return Response.json({ error: "bad price" }, { status: 400 });
      if (!isFinite(cap) || cap < 1) return Response.json({ error: "bad capacity" }, { status: 400 });
      // ids ≥ 2000000 are dashboard-created (imports own the lower ranges)
      const maxRow = (await db("activities?select=id&id=gte.2000000&order=id.desc&limit=1"))[0];
      const id = maxRow ? maxRow.id + 1 : 2000000;
      const rows = await db("activities", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({
          id, name, category: String(f.category || "class"),
          schedule_name: f.schedule_name || null, age_range: f.age_range || null,
          location: f.location || null,
          price_cents: price, capacity: cap, sold: 0,
          active: true, bookable: f.bookable !== false, hidden: !!f.hidden,
        }),
      });
      await audit("product_create", actor, { id, name, price_cents: price, capacity: cap });
      return Response.json({ ok: true, product: (rows || [])[0] || null });
    }

    if (action === "move") {
      const out = await rpc("admin_move_camper", {
        p_item_id: String(body.item_id || ""),
        p_show: body.show || null, p_band: body.band || null,
        p_activity_id: body.activity_id ? Number(body.activity_id) : null,
        p_actor: actor, p_force: !!body.force,
      });
      if (out && out.error) return Response.json(out, { status: 400 });
      return Response.json(out);
    }

    if (action === "cancel") {
      const itemId = String(body.item_id || "");
      if (!itemId) return Response.json({ error: "no item" }, { status: 400 });
      const item = (await db(`order_items?id=eq.${itemId}&select=*`))[0];
      if (!item) return Response.json({ error: "item not found (already cancelled?)" }, { status: 404 });
      const order = (await db(`orders?id=eq.${item.order_id}&select=*`))[0];
      const actName = item.activity_id
        ? ((await db(`activities?id=eq.${item.activity_id}&select=name`))[0] || {}).name
        : null;
      const what = item.show ? `${item.show} · ${item.band}` : (actName || "unknown");

      if (body.dry_run) {
        return Response.json({
          preview: {
            camper: item.camper_name, what, email: order?.email,
            paid_cents: item.unit_price_cents,
            order_total_cents: order?.total_cents, order_plan: order?.plan,
            suggested_refund_cents: item.unit_price_cents,
            has_stripe_pi: !!order?.stripe_payment_intent,
            has_schedule: !!order?.stripe_schedule,
            schedule_warning: order?.stripe_schedule
              ? "This order has a payment schedule — cancelling one seat does NOT change future installments. Adjust the schedule in Stripe (or ask Jason) after this."
              : null,
          },
        });
      }

      if (body.confirm !== "REFUND") return Response.json({ error: "type REFUND to confirm" }, { status: 400 });
      const amount = Math.round(Number(body.amount_cents));
      if (!isFinite(amount) || amount < 0) return Response.json({ error: "bad amount" }, { status: 400 });

      let refundId = null;
      if (amount > 0) {
        if (!order?.stripe_payment_intent)
          return Response.json({ error: "no Stripe payment on this order — refund it wherever it was paid, then cancel with amount 0" }, { status: 400 });
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        const refund = await stripe.refunds.create({
          payment_intent: order.stripe_payment_intent,
          amount,
          metadata: { admin: actor, item_id: itemId, camper: item.camper_name || "" },
        });
        refundId = refund.id;
      }

      const out = await rpc("admin_cancel_item", {
        p_item_id: itemId, p_actor: actor,
        p_note: refundId ? `refund ${refundId} for $${(amount / 100).toFixed(2)}` : "no refund (seat freed only)",
      });
      if (out && out.error) {
        // refund already happened — surface loudly rather than silently losing it
        return Response.json({ error: `refund ${refundId || "none"} succeeded but seat unwind failed: ${out.error} — tell Jason`, refund_id: refundId }, { status: 500 });
      }
      return Response.json({ ...out, refund_id: refundId, refunded_cents: amount });
    }

    if (action === "referral_add") {
      const referred = String(body.referred_email || "").trim().toLowerCase();
      const who = String(body.referrer || "").trim();
      if (!referred || !who) return Response.json({ error: "need referrer (email or code) and referred email" }, { status: 400 });
      const q = who.includes("@")
        ? `email=ilike.${encodeURIComponent(who)}`
        : `ref_code=eq.${encodeURIComponent(who.toUpperCase())}`;
      const fam = (await db(`families?${q}&select=email,ref_code,parent_name,is_test`))[0];
      if (!fam) return Response.json({ error: "no family matches that referrer" }, { status: 404 });
      const dupe = await db(`referral_rewards?referred_email=ilike.${encodeURIComponent(referred)}&select=id`);
      if (dupe.length) return Response.json({ error: "that family already has a referral reward" }, { status: 409 });
      const rows = await db("referral_rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({
          ref_code: fam.ref_code, referrer_email: fam.email,
          referred_email: referred, status: "earned",
        }),
      });
      await audit("referral_add", actor, { referrer: fam.email, referred, code: fam.ref_code });
      return Response.json({ ok: true, reward: (rows || [])[0] || null, referrer_name: fam.parent_name });
    }

    return Response.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) {
    console.error("reg-admin-ops", action, e);
    return Response.json({ error: "server error: " + (e.message || "").slice(0, 200) }, { status: 500 });
  }
};

export const config = { path: "/api/reg-admin-ops" };
