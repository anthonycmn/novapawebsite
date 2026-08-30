// "My NOVAPA" family dashboard — POST /api/reg-account
// Bearer <supabase session token> -> { family, campers: [{name, items:[{title, dates}]}] }
//
// Read-only. The signed-in email is the key: web orders by email, plus
// imported Sawyer/Regpack enrollments matched by email OR camper name
// (legacy rows from portal sweeps often lack an email).

import { SHOWS, CAMP_START } from "./reg-config.mjs";

const SUPABASE_URL = "https://tlkuqwsqicxcjdmumkje.supabase.co";
const ANON_KEY = "sb_publishable_8ar97CkK-C0YlWuOGtI_tA_mwTDVE6H";

async function svc(path) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`db ${r.status}`);
  return r.json();
}

async function svcPatch(path, body) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`db ${r.status}`);
  return r.json();
}

// Live billing for this family, straight from Stripe: upcoming charges and
// recent payments. Uses STRIPE_READ_KEY — a read-only restricted key that can
// see customers/subscriptions/invoices/charges and nothing else; the main
// stripe key deliberately cannot read these. Families asked for this
// (Haemy Park, Aug 16 2026: "the payment plan (all payment transactions)").
// Whole section is skipped when the key is absent, so the portal degrades
// to exactly what it showed before.
async function paymentsFor(email) {
  const key = process.env.STRIPE_READ_KEY;
  if (!key) return null;
  const stripe = async (path) => {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`stripe ${r.status} ${path.split("?")[0]}`);
    return r.json();
  };
  try {
    // Payment links mint a fresh customer per checkout, so one family can
    // legitimately own several customer records.
    const search = await stripe(
      `customers/search?query=${encodeURIComponent(`email:'${email.replace(/'/g, "")}'`)}&limit=5`);
    const customers = search.data || [];
    const upcoming = [], history = [];
    // Invoice line descriptions ("Park Payment Plan - Classes") beat charge
    // descriptions ("Subscription creation") — cache per invoice id.
    // Product names carry internal bookkeeping ("Park Payment Plan -
    // Classes") and the suffixes aren't even reliable — the Park plan pays
    // for two classes AND a summer camp. A payoff plan is just "Payment
    // plan"; anything that isn't one (class memberships etc.) keeps its own
    // name (Jason, Aug 17).
    const pretty = (d) => (d && /payment plan/i.test(d) ? "Payment plan" : d);
    const invDesc = {};
    const descOf = async (invId) => {
      if (!invId) return null;
      if (!(invId in invDesc)) {
        try {
          const inv = await stripe(`invoices/${invId}`);
          invDesc[invId] = pretty((inv.lines?.data?.[0]?.description || "")
            .replace(/^1 × /, "").replace(/\s*\(at .*\)$/, "")) || null;
        } catch (e) { invDesc[invId] = null; }
      }
      return invDesc[invId];
    };
    for (const c of customers) {
      const subs = await stripe(`subscriptions?customer=${c.id}&status=active&limit=10`);
      for (const s of subs.data || []) {
        // invoices/upcoming is deprecated on current API versions, and the
        // period fields moved onto subscription items — compute the schedule
        // from the subscription itself.
        const itemList = s.items?.data || [];
        const nextTs = itemList[0]?.current_period_end || s.current_period_end;
        if (!nextTs) continue;
        if (s.cancel_at && s.cancel_at <= nextTs) continue; // final period billed
        const amount = itemList.reduce((n, x) => n + (x.price?.unit_amount || 0) * (x.quantity || 1), 0);
        const desc = (await descOf(s.latest_invoice)) || s.description || "Payment plan";
        // A plan with an end date shows EVERY remaining charge — a family
        // watching their list shrink month by month is what "how do I know
        // it stops" actually wants (Haemy Park, Aug 17). Open subscriptions
        // (class memberships) show the next charge marked as renewing.
        if (s.cancel_at) {
          let d = new Date(nextTs * 1000);
          for (let i = 0; d.getTime() < s.cancel_at * 1000 && i < 24; i++) {
            upcoming.push({ date: d.getTime(), amount_cents: amount, desc, ends: s.cancel_at * 1000 });
            d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()));
          }
        } else if (s.schedule) {
          // Schedule-run plans (migration finals, Aug 18): phases can change
          // the amount — the last one is the partial final payment. Enumerate
          // every remaining charge with its phase's own price so the family
          // sees "$125 ... $125 ... $56.50, then nothing".
          let listed = false;
          try {
            const sch = await stripe(`subscription_schedules/${s.schedule}`);
            const phases = (sch.phases || []).filter((p) => p.end_date);
            if (sch.end_behavior === "cancel" && phases.length) {
              const endAll = phases[phases.length - 1].end_date;
              // STRIPE_READ_KEY has no Prices read scope, so the two final-
              // installment prices are seeded by id (created 18 Aug 2026,
              // prod). A phase with any other price falls back to the plan's
              // monthly amount; add Prices:Read to the key to generalize.
              const amtCache = {
                price_1U6CmTGWP2ZbtaszBGFK2QN0: 5650,
                price_1U6CmTGWP2ZbtaszDlvrhumq: 20434,
                // Surla TC restructure (Aug 21): Sep 1 $201.85, Oct-Feb $201.83
                price_1U6zSwGWP2ZbtaszOukbSGyT: 20185,
                price_1U6zSwGWP2ZbtaszHBcqIreW: 20183,
              };
              let d = new Date(nextTs * 1000);
              // probe at tick + 12h: billing ticks and phase boundaries can
              // differ by seconds, and an exact comparison put the final tick
              // in the wrong phase and invented a charge at the cancel moment
              for (let i = 0; d.getTime() / 1000 + 43200 < endAll && i < 24; i++) {
                const t = d.getTime() / 1000, probe = t + 43200;
                const ph = phases.find((p) => probe >= p.start_date && probe < p.end_date) || phases[phases.length - 1];
                const pid = ph.items?.[0]?.price;
                if (pid && !(pid in amtCache)) {
                  try { amtCache[pid] = (await stripe(`prices/${pid}`)).unit_amount; } catch (e) { amtCache[pid] = amount; }
                }
                upcoming.push({ date: d.getTime(), amount_cents: (pid && amtCache[pid]) || amount, desc, ends: endAll * 1000 });
                listed = true;
                d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()));
              }
            }
          } catch (e) { /* schedule unreadable — fall through to the open row */ }
          if (!listed) upcoming.push({ date: nextTs * 1000, amount_cents: amount, desc, ends: null, renews: true });
        } else {
          upcoming.push({ date: nextTs * 1000, amount_cents: amount, desc, ends: null, renews: true });
        }
      }
      // Charges no longer carry an invoice reference on this API version (and
      // invoices no longer carry a charge), so history rows come from paid
      // invoices — the good descriptions live there — and card charges merge
      // in by amount + hour window, contributing their last4. One-off web
      // payments have no invoice and land as plain charge rows.
      const invoices = await stripe(`invoices?customer=${c.id}&status=paid&limit=10`);
      for (const inv of invoices.data || []) {
        invDesc[inv.id] = pretty((inv.lines?.data?.[0]?.description || "")
          .replace(/^1 × /, "").replace(/\s*\(at .*\)$/, "")) || null;
        history.push({
          date: (inv.status_transitions?.paid_at || inv.created) * 1000,
          amount_cents: inv.amount_paid,
          desc: invDesc[inv.id] || "Payment plan",
          last4: null,
          _inv: true,
        });
      }
      const charges = await stripe(`charges?customer=${c.id}&limit=10`);
      for (const ch of charges.data || []) {
        if (ch.status !== "succeeded" || ch.refunded) continue;
        const twin = history.find((h) =>
          h._inv && h.amount_cents === ch.amount && Math.abs(h.date - ch.created * 1000) < 3600000);
        if (twin) { twin.last4 = ch.payment_method_details?.card?.last4 || null; continue; }
        history.push({
          date: ch.created * 1000,
          amount_cents: ch.amount,
          desc: ch.description || ch.calculated_statement_descriptor || "Payment",
          last4: ch.payment_method_details?.card?.last4 || null,
        });
      }
    }
    for (const h of history) delete h._inv;
    upcoming.sort((a, b) => a.date - b.date);
    history.sort((a, b) => b.date - a.date);
    return { upcoming, history: history.slice(0, 12) };
  } catch (e) {
    console.error("reg-account payments", e.message);
    return null; // billing display must never break the portal
  }
}

// Referral tickets for this family: every earned reward where they are the
// referrer or the referred side, one entry per side they own.
async function rewardsFor(email) {
  const enc = encodeURIComponent(email);
  const rows = await svc(
    `referral_rewards?select=*&status=eq.earned&or=(referrer_email.ilike.${enc},referred_email.ilike.${enc})&order=created_at.desc`
  );
  const others = [...new Set(rows.map((r) =>
    r.referrer_email.toLowerCase() === email ? r.referred_email : r.referrer_email
  ))];
  const fams = others.length
    ? await svc(`families?select=email,parent_name&email=in.(${others.map(encodeURIComponent).join(",")})`)
    : [];
  const nameOf = Object.fromEntries(fams.map((f) => [f.email.toLowerCase(), f.parent_name]));
  return rows.map((r) => {
    const side = r.referrer_email.toLowerCase() === email ? "referrer" : "referred";
    const other = side === "referrer" ? r.referred_email : r.referrer_email;
    return {
      id: r.id,
      side,
      other_name: nameOf[other.toLowerCase()] || other,
      redeemed_at: side === "referrer" ? r.referrer_redeemed_at : r.referred_redeemed_at,
      created_at: r.created_at,
    };
  });
}

// Show tickets bought with this email (tix_orders is keyed by email, not
// family, because ticket buyers are often not registration families).
async function ticketsFor(email) {
  try {
    const orders = await svc(
      `tix_orders?select=id,code,total_cents,created_at,performance_id,` +
      `tix_performances(starts_at,label,tix_shows(title)),` +
      `tix_tickets(seat_id,tix_seats(section,row_label,seat_no))` +
      `&email=eq.${encodeURIComponent(email.toLowerCase())}&status=eq.paid&order=created_at.desc`);
    return (orders || []).map((o) => ({
      code: o.code,
      show: o.tix_performances?.tix_shows?.title || "Performance",
      starts_at: o.tix_performances?.starts_at || null,
      seats: (o.tix_tickets || []).map((t) =>
        `${t.tix_seats.section === "HL" ? "L" : "R"} ${t.tix_seats.row_label}${t.tix_seats.seat_no}`),
    }));
  } catch (e) { console.error("ticketsFor:", e.message); return []; }
}

const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MO[m - 1]} ${d}, ${y}`;
};

// Legacy `dates` strings are free text ("Wednesdays Sep 16 2026 - Jan 13 2027",
// "Mon, 7/13/2026, Tue, ..."). An item is "past" when the LATEST date we can
// find in the text is behind us; no parseable date = assume upcoming (safer).
const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
function isPast(text) {
  if (!text) return false;
  let max = null;
  for (const m of text.matchAll(/([A-Za-z]{3,9})\.?,? (\d{1,2}),? (\d{4})/g)) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo == null) continue;
    const d = new Date(Date.UTC(+m[3], mo, +m[2]));
    if (!max || d > max) max = d;
  }
  for (const m of text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)) {
    const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
    if (!max || d > max) max = d;
  }
  return max ? max < new Date() : false;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  // Two ways in: the family's private portal token (the link in their
  // emails — zero friction), or a Supabase session (OTP fallback).
  let email = "";
  let body = {};
  try { body = await req.json(); } catch {}

  // Unauthenticated probe for the email-first login card: which sign-in
  // options apply to this address? Returns only { known, password } — the
  // same information the checkout flow already reveals about an email.
  if (body.action === "probe") {
    const probeEmail = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(probeEmail))
      return Response.json({ error: "bad email" }, { status: 400 });
    try {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/auth_probe`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_email: probeEmail }),
      });
      if (!r.ok) throw new Error(`probe ${r.status}`);
      return Response.json(await r.json());
    } catch (e) {
      console.error("reg-account probe", e);
      return Response.json({ error: "server error" }, { status: 500 });
    }
  }
  if (body.portal_token && /^[0-9a-f-]{36}$/.test(body.portal_token)) {
    const fams = await svc(`families?select=email&portal_token=eq.${body.portal_token}&limit=1`);
    email = (fams[0]?.email || "").toLowerCase();
    if (!email) return Response.json({ error: "link not recognized" }, { status: 401 });
  } else {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return Response.json({ error: "sign in required" }, { status: 401 });
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!who.ok) return Response.json({ error: "sign in required" }, { status: 401 });
    email = ((await who.json()).email || "").toLowerCase();
    if (!email) return Response.json({ error: "sign in required" }, { status: 401 });
  }

  // Self-serve redemption: the parent taps Redeem at the box office. Only the
  // ── Self-serve card management ─────────────────────────────────────────
  // "billing_portal" opens a Stripe-hosted Billing Portal locked down to
  // updating the payment method and viewing invoices — a family can never
  // cancel or reschedule a plan from it. "billing_sync" repoints any pinned
  // billing at the family's chosen card and is called when they land back
  // from the portal.
  //
  // The pin problem this solves: checkout pins the card onto each
  // subscription/schedule (default_payment_method), so a card saved in the
  // portal would otherwise never be the one actually charged. The rule here:
  // a default the family set themselves always wins for future payments.
  if (body.action === "billing_portal" || body.action === "billing_sync") {
    const sk = process.env.STRIPE_SECRET_KEY;
    if (!sk) return Response.json({ error: "billing unavailable" }, { status: 503 });
    const sapi = async (path, params) => {
      const r = await fetch(`https://api.stripe.com/v1/${path}`, {
        method: params ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${sk}`,
          ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: params ? new URLSearchParams(params).toString() : undefined,
      });
      const j = await r.json();
      if (j.error) throw new Error(`${path}: ${j.error.message}`);
      return j;
    };

    try {
      // Every Stripe customer this email owns: our orders' stripe_customer
      // (authoritative for web checkouts) plus an email search (payment links
      // mint a fresh customer per checkout, so one family owns several).
      const ids = new Set();
      const ours = await svc(
        `orders?select=stripe_customer&email=ilike.${encodeURIComponent(email)}&stripe_customer=not.is.null&limit=100`);
      for (const o of ours) if (o.stripe_customer) ids.add(o.stripe_customer);
      const search = await sapi(
        `customers/search?query=${encodeURIComponent(`email:'${email.replace(/'/g, "")}'`)}&limit=10`);
      for (const c of search.data || []) ids.add(c.id);
      if (!ids.size) return Response.json({ error: "no billing on file" }, { status: 404 });

      // Find the customers that actually have money in motion, and sync pins
      // wherever the family has chosen a default card.
      const live = [];
      for (const id of ids) {
        const [cust, subs, scheds] = await Promise.all([
          sapi(`customers/${id}`),
          sapi(`subscriptions?customer=${id}&status=all&limit=20`),
          sapi(`subscription_schedules?customer=${id}&limit=20`),
        ]);
        const activeSubs = (subs.data || []).filter((x) =>
          ["active", "trialing", "past_due", "unpaid"].includes(x.status));
        const liveScheds = (scheds.data || []).filter((x) =>
          ["not_started", "active"].includes(x.status));
        if (activeSubs.length || liveScheds.length) live.push({ id, created: cust.created });

        const chosen = (cust.invoice_settings || {}).default_payment_method;
        if (!chosen) continue;
        for (const sub of activeSubs) {
          if (sub.default_payment_method && sub.default_payment_method !== chosen) {
            await sapi(`subscriptions/${sub.id}`, { default_payment_method: chosen });
            console.log(`billing sync: ${sub.id} -> customer default for ${email}`);
          }
        }
        for (const sc of liveScheds) {
          const pinned = (sc.default_settings || {}).default_payment_method;
          if (pinned && pinned !== chosen) {
            await sapi(`subscription_schedules/${sc.id}`, {
              "default_settings[default_payment_method]": chosen,
            });
            console.log(`billing sync: ${sc.id} -> customer default for ${email}`);
          }
        }
      }
      if (body.action === "billing_sync") return Response.json({ ok: true });

      // The portal is per-customer: open it on the one carrying live billing
      // (newest first when several), falling back to the newest customer so a
      // fully-paid family can still fix an expiring card.
      const all = [...ids];
      let target = live.sort((a, b) => b.created - a.created)[0]?.id || all[all.length - 1];

      // One locked-down configuration, created on first use and found by
      // metadata after that. Card update + invoice history only.
      let cfg = null;
      const cfgs = await sapi(`billing_portal/configurations?limit=100&active=true`);
      cfg = (cfgs.data || []).find((c) => (c.metadata || {}).novapa === "card-update");
      if (!cfg) {
        cfg = await sapi(`billing_portal/configurations`, {
          "business_profile[headline]": "NOVAPA — manage your payment method",
          "features[payment_method_update][enabled]": "true",
          "features[invoice_history][enabled]": "true",
          "features[subscription_cancel][enabled]": "false",
          "features[subscription_update][enabled]": "false",
          "default_return_url": "https://novapa.org/register/account.html?billing=updated",
          "metadata[novapa]": "card-update",
        });
      }
      const session = await sapi(`billing_portal/sessions`, {
        customer: target,
        configuration: cfg.id,
        return_url: "https://novapa.org/register/account.html?billing=updated",
      });
      return Response.json({ url: session.url });
    } catch (e) {
      console.error("reg-account billing_portal", e);
      return Response.json({ error: "billing portal unavailable" }, { status: 500 });
    }
  }

  // side belonging to the signed-in email can be stamped, only once — the
  // is.null filter makes a double-tap (or a race) a no-op, not a re-stamp.
  if (body.action === "redeem_referral") {
    const id = String(body.reward_id || "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "bad reward" }, { status: 400 });
    try {
      const rw = (await svc(`referral_rewards?select=*&id=eq.${id}&limit=1`))[0];
      if (!rw) return Response.json({ error: "reward not found" }, { status: 404 });
      const side = rw.referrer_email.toLowerCase() === email ? "referrer"
        : rw.referred_email.toLowerCase() === email ? "referred" : null;
      if (!side) return Response.json({ error: "not your reward" }, { status: 403 });
      const col = side === "referrer" ? "referrer_redeemed_at" : "referred_redeemed_at";
      if (rw[col]) return Response.json({ error: "already redeemed" }, { status: 409 });
      const upd = await svcPatch(
        `referral_rewards?id=eq.${id}&${col}=is.null`,
        { [col]: new Date().toISOString() }
      );
      if (!upd.length) return Response.json({ error: "already redeemed" }, { status: 409 });
      return Response.json({ ok: true, redeemed_at: upd[0][col] });
    } catch (e) {
      console.error("reg-account redeem", e);
      return Response.json({ error: "server error" }, { status: 500 });
    }
  }

  try {
    // A household can sign in from two addresses (families.cc_email — see
    // reg-pay.mjs). Some also carry TWO family rows cross-linked as aliases
    // (the Smiths, Aug 2026), so gather every row the address touches and
    // union their campers, orders, and history — both logins see one account.
    const enc = encodeURIComponent(email);
    const famRows = await svc(`families?select=id,parent_name,email,cc_email&or=(email.ilike.${enc},cc_email.ilike.${enc})`);
    const fam = famRows.find((f) => (f.email || "").toLowerCase() === email) || famRows[0] || null;
    const famEmails = [...new Set(
      famRows.flatMap((f) => [f.email, f.cc_email]).filter(Boolean).map((e) => e.toLowerCase()).concat([email])
    )];
    const emailList = famEmails.map(encodeURIComponent).join(",");
    let campers = [];
    if (famRows.length) {
      const all = await svc(`campers?select=name,day_camp_credits,snow_day_credits&family_id=in.(${famRows.map((f) => f.id).join(",")})&order=name`);
      const seen = new Set();
      for (const c of all) {
        const k = c.name.trim().toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k); campers.push(c);
      }
    }

    // Web orders (our checkout) — under any of the household's addresses
    const orders = await svc(`orders?select=id&email=in.(${emailList})&status=in.(paid,confirmed,complete,succeeded)`);
    let items = [];
    if (orders.length) {
      const ids = orders.map((o) => o.id).join(",");
      items = await svc(`order_items?select=show,band,camper_name,activity_id&order_id=in.(${ids})`);
    }
    const actIds = [...new Set(items.map((i) => i.activity_id).filter(Boolean))];
    const acts = actIds.length
      ? await svc(`activities?select=id,name&id=in.(${actIds.join(",")})`)
      : [];
    const actName = Object.fromEntries(acts.map((a) => [a.id, a.name]));

    // Imported enrollments (Sawyer / Regpack history and transfers)
    const names = campers.map((c) => `"${c.name.replace(/"/g, "")}"`);
    const orClauses = [`email.in.(${emailList})`];
    if (names.length) orClauses.push(`camper_name.in.(${names.join(",")})`);
    const legacy = await svc(`legacy_enrollments?select=camper_name,activity_text,dates&or=(${orClauses.join(",")})`);

    const byCamper = {};
    const add = (camper, title, dates) => {
      const key = camper || "Your family";
      byCamper[key] = byCamper[key] || [];
      if (!byCamper[key].some((x) => x.title === title))
        byCamper[key].push({ title, dates: dates || "", past: isPast(dates) });
    };
    for (const it of items) {
      if (it.show) {
        const title = `${SHOWS[it.show] || it.show}${it.band && it.band !== "tech" ? ` (Ages ${it.band})` : it.band === "tech" ? " (Tech Crew)" : ""}`;
        add(it.camper_name, title, CAMP_START[it.show] ? `Starts ${fmtDate(CAMP_START[it.show])}` : "");
      } else if (it.activity_id && actName[it.activity_id]) {
        add(it.camper_name, actName[it.activity_id], "");
      }
    }
    for (const le of legacy) add(le.camper_name, le.activity_text, le.dates);

    // Day Camp Pack credits. A family buys the 5-day pack up front and picks
    // their dates later, from here. Credits live on the camper row; the picker
    // hands off to the normal checkout with the chosen dates preselected, so
    // priceCart applies the credits and the order completes at $0 through the
    // same money path as everything else.
    const credits = campers
      .map((c) => ({ name: c.name, day: c.day_camp_credits || 0, snow: c.snow_day_credits || 0 }))
      .filter((c) => c.day > 0 || c.snow > 0);

    // Only fetch the date list when somebody can actually use it.
    let dayCamps = [];
    if (credits.length) {
      const rows = await svc(
        `activities?select=id,name,price_cents,capacity,sold,booked_offline` +
        `&active=is.true&bookable=is.true&hidden=is.false&name=ilike.*day camp*&order=name`);
      dayCamps = rows
        .map((a) => ({
          id: a.id,
          name: a.name,
          remaining: a.capacity == null ? null
            : Math.max(0, a.capacity - (a.sold || 0) - (a.booked_offline || 0)),
          // "Ages 5–9 Day Camp · Mar 22, 2027" -> the date half, for sorting
          when: (a.name.split("·")[1] || "").trim(),
        }))
        .filter((a) => a.remaining === null || a.remaining > 0)
        .sort((a, b) => (Date.parse(a.when) || 0) - (Date.parse(b.when) || 0));
    }

    return Response.json({
      family: fam ? { parent_name: fam.parent_name, email: fam.email } : { email },
      campers: Object.entries(byCamper).map(([name, its]) => ({ name, items: its })),
      rewards: await rewardsFor(email),
      tickets: await ticketsFor(email),
      credits,
      dayCamps,
      payments: await paymentsFor(email),
    });
  } catch (e) {
    console.error("reg-account", e);
    return Response.json({ error: "server error" }, { status: 500 });
  }
};

export const config = { path: "/api/reg-account" };
