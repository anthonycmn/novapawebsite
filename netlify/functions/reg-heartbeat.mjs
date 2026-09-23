// Proof that a scheduled function ran, written where an agent can read it.
//
// A scheduled Netlify function that finds nothing to do returns 200 and says
// so only in the function log. The cloud agents cannot read that log, so
// "nothing to do" and "stopped firing" look identical to them. reg-send-watch
// sat in exactly that state through the week of 16 Sep 2026: its counters were
// honestly zero every hour and no run could prove it had run at all, which the
// email marketing agent had to report as a Data gap five days running.
//
// So every scheduled function stamps one row here on its way out. The row is
// the whole point: a heartbeat older than its own schedule is a real finding,
// and a fresh one turns a silent hour into a verified all clear.
//
// beat() never throws and never blocks. A telemetry write must not be able to
// break a send, so every failure here is swallowed on purpose. The worst case
// is a stale row, which reads as "could not confirm" rather than as a lie.
import { SUPABASE_URL } from "./reg-config.mjs";

export async function beat(fn, status = "ok", detail = "") {
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key || !fn) return;
    const now = new Date().toISOString();
    const row = {
      fn,
      last_run: now,
      last_ok: status === "ok" ? now : null,
      status: String(status).slice(0, 40),
      // One short line, and never a recipient address: this table is read by
      // every agent and quoted into reports.
      detail: String(detail || "").replace(/[^\x20-\x7E]+/g, " ").slice(0, 200),
    };
    await fetch(`${SUPABASE_URL}/rest/v1/function_heartbeats?on_conflict=fn`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // merge-duplicates is the upsert: one row per function, rewritten
        // each run. No counter is kept, so two overlapping runs cannot lose
        // each other's write; the stamp is the whole signal.
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(row),
    });
  } catch {
    // Deliberately silent. See the note above.
  }
}
