// A DC Unifieds buyer gets a family row — and the student gets a camper row
// only when nobody of that name is on the books yet.
//
// Why this file exists: the first three DCU buyers with a new email address
// landed in orders with no family at all, and the obvious fix (the camp guest
// upsert) would have put Claire Sproule on the register a second time and
// pointed her seat at the empty copy. These pin the rule that avoids that.
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
const { mintDcuFamily } = await import("../netlify/functions/dcu-family.mjs");

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// A fake register: families by email, campers by name. Records every POST.
function fakeRegister({ families = [], campers = [] }) {
  const posts = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === "POST") posts.push({ table: u.pathname.split("/").pop(), body });
    if (u.pathname.endsWith("/families")) {
      if (method === "POST") return json([{ id: "fam-new", ...body }]);
      const m = decodeURIComponent(u.searchParams.get("or") || "").match(/email\.ilike\.([^,]+),/);
      const e = m ? m[1].toLowerCase() : "";
      return json(families.filter((f) => [f.email, f.cc_email].map((x) => String(x || "").toLowerCase()).includes(e)));
    }
    if (u.pathname.endsWith("/campers")) {
      if (method === "POST") return json([]);
      const name = decodeURIComponent(u.searchParams.get("name") || "").replace(/^ilike\./, "").toLowerCase();
      return json(campers.filter((c) => c.name.toLowerCase() === name));
    }
    return json([]);
  };
  return posts;
}
const json = (v) => ({ ok: true, json: async () => v });

const buyer = { email: "asproule23@gmail.com", parentName: "Adam Sproule", studentName: "Claire Sproule", phone: "703-555-0100" };

// ── Brand-new address, brand-new student: both rows ────────────────────────
{
  const posts = fakeRegister({});
  const r = await mintDcuFamily(buyer);
  eq("new family and new student: both created", r, { family: "created", camper: "created" });
  eq("the family row carries the address, parent, phone and a DCU source",
    posts[0], { table: "families", body: { email: "asproule23@gmail.com", parent_name: "Adam Sproule", phone: "703-555-0100", source: "dcunifieds" } });
  eq("the camper row hangs off that family", posts[1], { table: "campers", body: { family_id: "fam-new", name: "Claire Sproule", source: "dcunifieds" } });
}

// ── The Sproule case: Dad buys, Claire already exists under Mom ────────────
{
  const posts = fakeRegister({
    families: [{ id: "fam-colleen", email: "colleen.sproule@yahoo.com" }],
    campers: [{ id: "cam-claire", name: "Claire Sproule", family_id: "fam-colleen" }],
  });
  const r = await mintDcuFamily(buyer);
  eq("new family, student already on the books once: family only", r, { family: "created", camper: "elsewhere" });
  eq("no second Claire is minted", posts.map((p) => p.table), ["families"]);
}

// ── The Rodgers case: the name is already a duplicate ──────────────────────
{
  const posts = fakeRegister({
    campers: [
      { id: "a", name: "Ryan Rodgers", family_id: "fam-1" },
      { id: "b", name: "Ryan Rodgers", family_id: "fam-2" },
    ],
  });
  const r = await mintDcuFamily({ ...buyer, email: "rodgers.kelley@gmail.com", studentName: "Ryan Rodgers" });
  eq("an already-ambiguous name never gets a third row", r, { family: "created", camper: "ambiguous" });
  eq("still only the family was written", posts.map((p) => p.table), ["families"]);
}

// ── Same address again (webhook retry, second purchase): nothing new ───────
{
  const posts = fakeRegister({
    families: [{ id: "fam-adam", email: "asproule23@gmail.com" }],
    campers: [{ id: "cam-claire", name: "Claire Sproule", family_id: "fam-adam" }],
  });
  const r = await mintDcuFamily(buyer);
  eq("a retry finds both rows and writes nothing", r, { family: "existing", camper: "existing" });
  eq("no POSTs on a retry", posts, []);
}

// ── A cc_email counts as the family's address ──────────────────────────────
{
  fakeRegister({ families: [{ id: "fam-x", email: "other@example.com", cc_email: "asproule23@gmail.com" }] });
  const r = await mintDcuFamily(buyer);
  eq("an address on a family's cc_email is that family", r.family, "existing");
}

// ── Nothing to go on ───────────────────────────────────────────────────────
{
  const posts = fakeRegister({});
  eq("no email: nothing happens", await mintDcuFamily({ email: "" }), { family: "skipped", camper: "skipped" });
  eq("no student name: family only", await mintDcuFamily({ email: "x@example.com", studentName: "" }), { family: "created", camper: "skipped" });
  eq("…and only the family was written", posts.map((p) => p.table), ["families"]);
}

// ── The register being down must not fail a confirmed order ────────────────
{
  globalThis.fetch = async () => { throw new Error("connection refused"); };
  const r = await mintDcuFamily(buyer);
  eq("a register error is reported, not thrown", r, { family: "skipped", camper: "skipped" });
}

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log("\nall passing");
