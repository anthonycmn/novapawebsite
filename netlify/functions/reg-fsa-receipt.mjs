// Standalone dependent-care (FSA) receipt, linked from confirmation emails so
// parents can reprint it after the checkout tab is gone. Keyed by the Stripe
// PaymentIntent id — high-entropy, known only from the parent's own email.
// Mirrors the checkout's fsaReceipt() exactly: IRS Pub. 503 gating (daytime
// day camps only, camper under 13 when care starts, missing birthday fails
// closed) and the same document text Todd approved.
import { SUPABASE_URL, PRICE_CENTS, DAY_CAMP_MAX_CENTS } from "./reg-config.mjs";

const CAMP_STARTS = { httyd: "2027-07-05", charlie: "2027-07-19", trolls: "2027-08-02" };
const CAMP_ENDS = { httyd: "2027-07-16", charlie: "2027-07-30", trolls: "2027-08-13" };
const SHOW_NAMES = {
  httyd: "How to Train Your Dragon JR.",
  charlie: "Charlie and the Chocolate Factory JR.",
  trolls: "Trolls The Musical JR.",
};

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}
async function db(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svcHeaders() });
  if (!r.ok) throw new Error(`db ${r.status}`);
  return r.json();
}
function under13(bday, startISO) {
  if (!bday) return false;
  const b = new Date(bday + "T00:00:00"), s = startISO ? new Date(startISO + "T00:00:00") : new Date();
  let age = s.getFullYear() - b.getFullYear();
  if (s.getMonth() < b.getMonth() || (s.getMonth() === b.getMonth() && s.getDate() < b.getDate())) age--;
  return age < 13;
}
function fmtLong(iso) {
  const m = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const d = new Date(iso + "T00:00:00");
  return `${m[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function money(c) { return "$" + (c / 100).toFixed(2); }
function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function row(l, v) { return `<p style="margin:3px 0"><b>${l}:</b> ${v}</p>`; }

export default async (req) => {
  const pi = new URL(req.url).searchParams.get("pi") || "";
  if (!/^pi_[A-Za-z0-9]{8,}$/.test(pi)) return new Response("Not found", { status: 404 });

  let order, items;
  try {
    const orders = await db(`orders?stripe_payment_intent=eq.${encodeURIComponent(pi)}&status=eq.paid&select=id,email,plan,amount_today_cents,created_at`);
    if (!orders.length) return new Response("Receipt not found", { status: 404 });
    order = orders[0];
    items = await db(`order_items?order_id=eq.${order.id}&select=camper_name,show,activity_id,unit_price_cents`);
  } catch (e) {
    return new Response("Temporarily unavailable", { status: 503 });
  }

  // birthdays for the under-13 test
  const bdayByName = {};
  try {
    const fams = await db(`families?email=ilike.${encodeURIComponent(order.email)}&select=id`);
    if (fams.length) {
      const kids = await db(`campers?family_id=eq.${fams[0].id}&select=name,birthdate`);
      for (const k of kids) bdayByName[String(k.name || "").trim().toLowerCase()] = k.birthdate || null;
    }
  } catch (e) { /* no birthdays -> nothing qualifies (fail closed) */ }

  // resolve day-camp activities for non-show items
  const actIds = [...new Set(items.filter((it) => !it.show && it.activity_id).map((it) => it.activity_id))];
  let actById = {};
  if (actIds.length) {
    try {
      const acts = await db(`activities?id=in.(${actIds.join(",")})&select=id,name,category,price_cents,schedule_name`);
      for (const a of acts) actById[a.id] = a;
    } catch (e) { /* unresolved activities simply don't qualify */ }
  }

  const eligible = items.filter((it) => {
    const bday = bdayByName[String(it.camper_name || "").trim().toLowerCase()];
    if (it.show) return CAMP_STARTS[it.show] && under13(bday, CAMP_STARTS[it.show]);
    const a = actById[it.activity_id];
    return a && a.category === "camp" && (a.price_cents || 0) <= DAY_CAMP_MAX_CENTS && under13(bday, null);
  });

  if (!eligible.length) {
    return new Response("<html><body style=\"font-family:Georgia,serif;max-width:660px;margin:40px auto\"><h3>No FSA-eligible items on this order</h3><p>Dependent-care receipts cover daytime day camps for campers under age 13. Questions? Email <a href=\"mailto:info@novapa.org\">info@novapa.org</a>.</p></body></html>", { status: 200, headers: { "Content-Type": "text/html" } });
  }

  const status = order.plan === "deposit"
    ? "Partially Paid (remaining balance on automatic monthly installments)"
    : "Paid";
  const payDate = new Date(order.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

  const blocks = eligible.map((it) => {
    let name, dates, sched, listPrice;
    if (it.show) {
      name = `${SHOW_NAMES[it.show]} — Broadway Bound Summer Camp`;
      dates = `${fmtLong(CAMP_STARTS[it.show])} through ${fmtLong(CAMP_ENDS[it.show])}`;
      sched = "Monday through Friday, 8:30 AM–4:00 PM";
      listPrice = PRICE_CENTS;
    } else {
      const a = actById[it.activity_id];
      name = (a.name || "Day Camp").trim();
      dates = (a.schedule_name || "").replace(/^.*\|\s*/, "") || "See program schedule";
      sched = "Daytime camp hours";
      listPrice = a.price_cents || 0;
    }
    const unit = it.unit_price_cents != null ? it.unit_price_cents : listPrice;
    const disc = Math.max(0, listPrice - unit);
    return `<div style="border:1px solid #ccc;padding:14px 16px;margin:12px 0">` +
      row("Participant/Dependent", esc(it.camper_name)) +
      row("Program", esc(name)) +
      row("Type of Service", "Summer Day Camp and Dependent Care Services") +
      row("Dates Care Was Provided", esc(dates)) +
      row("Camp Schedule", sched) +
      row("Amount Charged for Eligible Care", money(listPrice)) +
      (disc ? row("Discounts or Credits", "−" + money(disc)) : "") +
      row("Amount for Eligible Care After Discounts", money(unit)) +
      `</div>`;
  }).join("");

  const html = `<html><head><title>NOVAPA Dependent Care Receipt</title></head>` +
    `<body style="font-family:Georgia,serif;max-width:660px;margin:40px auto;color:#111;font-size:14px;line-height:1.5">` +
    `<h2 style="margin-bottom:2px">DEPENDENT CARE / FSA RECEIPT INFORMATION</h2>` +
    row("Dependent Care Provider", "CJ Creative LLC dba Northern Virginia Performing Arts") +
    row("Provider Address", "18665 Conference Center Drive, Leesburg, VA 20176") +
    row("Federal Tax Identification Number / EIN", "99-1421341") +
    blocks +
    row("Payment Date", payDate) +
    row("Amount Paid", money(order.amount_today_cents || 0)) +
    row("Payment Status", status) +
    `<p style="margin-top:14px">This program was a daytime summer camp and did not include overnight care. The program provided supervision and care for the participant during the dates and hours listed above.</p>` +
    `<p>The services were provided to enable the participant’s parent or legal guardian to work, actively seek employment, or attend work-related responsibilities.</p>` +
    `<p>The parent or legal guardian is responsible for confirming that the participant was under age 13 when the care was provided, or otherwise met the applicable IRS dependent-care eligibility requirements.</p>` +
    `<p>Only charges attributable to eligible dependent-care services should be submitted for reimbursement. Credit card processing fees, merchandise, performance tickets, costumes, meals, transportation, and other non-care charges may not qualify for reimbursement.</p>` +
    `<p>This receipt reflects payment information maintained by CJ Creative LLC dba Northern Virginia Performing Arts. Eligibility for reimbursement is determined by the participant’s dependent-care plan administrator and applicable IRS rules.</p>` +
    `<p><b>Provider Certification:</b> CJ Creative LLC dba Northern Virginia Performing Arts certifies that the information shown above accurately reflects the dependent-care services provided and the payments received.</p>` +
    `<p style="margin-top:20px"><a href="javascript:window.print()" style="color:#996f1f">Print this receipt</a></p>` +
    `</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
};

export const config = { path: "/api/fsa-receipt" };
