// A DC Unifieds buyer gets a family row in the register.
//
// dcu-pay.mjs was built on the premise that a DC Unifieds buyer "will never
// log in again", so it minted no family and no camper — and every buyer through
// Sep 2026 happened to already have a sawyer family under the same address, so
// nobody noticed. The first three who did not (two of them on $0 coaching
// codes) landed in public.orders with no family at all: nothing for the office
// to look up, no priors for a second purchase, and a seat the staff portal's
// roster could not place. CJ's word, Sep 16 2026: a DCU buyer with a brand-new
// email gets a family row, on both the paid and the free path.
//
// It is NOT the camp guest upsert (reg-webhook.mjs, `guest === "1"`), on one
// point that matters. That upsert adds a camper to the buyer's family whenever
// the family lacks one of that name. For DCU that is wrong more often than
// right: the student is a high-school senior who is usually ALREADY on the
// books under the other parent's address (Claire Sproule under Colleen's,
// Ryan Rodgers under his own). Adding "Claire Sproule" a second time makes her
// name ambiguous to staff_portal.v_reg_participants_live, and the seat then
// resolves to the new, empty row instead of the one the parent portal's
// student links to. So: the family row is always created; the camper row is
// created only when nobody of that name exists anywhere in the register.
// A name that exists once elsewhere resolves by itself (exact-name); a name
// that exists twice is a dedupe for a person, not a third row.
//
// Idempotent by lookup, like the camp upsert: the webhook retries, and a
// second DCU purchase from the same address reuses the family.
import { SUPABASE_URL } from "./reg-config.mjs";

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// Never throws: this runs after the order is confirmed, and a failure here
// must not make a paid seat look unpaid. It reports what it did instead.
export async function mintDcuFamily({ email, parentName, studentName, phone }) {
  const out = { family: "skipped", camper: "skipped" };
  const e = String(email || "").trim().toLowerCase();
  if (!e) return out;
  const hdrs = svcHeaders();
  try {
    const enc = encodeURIComponent(e);
    let fam = (await (await fetch(
      `${SUPABASE_URL}/rest/v1/families?or=(email.ilike.${enc},cc_email.ilike.${enc})&select=id&limit=1`,
      { headers: hdrs })).json())?.[0];
    if (fam) {
      out.family = "existing";
    } else {
      const made = await (await fetch(`${SUPABASE_URL}/rest/v1/families`, {
        method: "POST", headers: { ...hdrs, Prefer: "return=representation" },
        body: JSON.stringify({
          email: e, parent_name: parentName || null, phone: phone || null, source: "dcunifieds",
        }),
      })).json();
      fam = Array.isArray(made) ? made[0] : null;
      out.family = fam ? "created" : "failed";
    }
    if (!fam) return out;

    const name = String(studentName || "").trim();
    if (!name) return out;
    // Anywhere in the register, not just this family — see the header.
    const same = await (await fetch(
      `${SUPABASE_URL}/rest/v1/campers?name=ilike.${encodeURIComponent(name)}&select=id,family_id`,
      { headers: hdrs })).json();
    const n = Array.isArray(same) ? same.length : 0;
    if (n === 0) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/campers`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ family_id: fam.id, name, source: "dcunifieds" }),
      });
      out.camper = r.ok ? "created" : "failed";
    } else if (same.some((c) => c.family_id === fam.id)) {
      out.camper = "existing";
    } else {
      out.camper = n === 1 ? "elsewhere" : "ambiguous";
      console.log(`dcu family: "${name}" already on the books ${n}x under another address; not adding a row`);
    }
  } catch (err) {
    console.error("dcu family mint failed:", err.message);
  }
  return out;
}
