// Proof of life for every scheduled function, written to
// public.function_heartbeats.
//
// Why this exists (Sep 24 2026): the website sent no email for 33 hours and
// nothing noticed. reg-balance-audit always mails at 11:00 UTC, so its silence
// was the signal, but "nothing to do" and "stopped firing" looked the same
// from outside: the only way to tell them apart was a Netlify function log
// that no cloud agent can read. Each scheduled handler is now wrapped:
//
//   const run = async () => { ... };
//   export default withHeartbeat("reg-send-watch", run);
//
// Every run upserts one row per function: when it last ran, whether it
// returned or threw, and the first 300 characters of what it said. A stamp
// older than twice the function's schedule means it stopped firing.
//
// The write is best effort and bounded to three seconds. A heartbeat must
// never be the reason a scheduled job fails, so errors here are logged and
// swallowed, and the handler's own result or throw passes through untouched.
import { SUPABASE_URL } from "./reg-config.mjs";

const DETAIL_MAX = 300;

export async function heartbeat(fn, status, detail) {
  if (process.env.CONTEXT && process.env.CONTEXT !== "production") return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return;
  const now = new Date().toISOString();
  const row = { fn, last_run: now, status, detail: String(detail ?? "").slice(0, DETAIL_MAX) };
  // last_ok only moves on a good run, so a function that fires but fails
  // every time shows a fresh last_run beside a stale last_ok.
  if (status === "ok") row.last_ok = now;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/function_heartbeats?on_conflict=fn`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) console.error(`heartbeat ${fn} not written: ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.error(`heartbeat ${fn} not written:`, e.message);
  }
}

export function withHeartbeat(fn, handler) {
  return async (...args) => {
    let res;
    try {
      res = await handler(...args);
    } catch (e) {
      await heartbeat(fn, "error", e && e.message);
      throw e;
    }
    let detail = "";
    let status = "ok";
    if (res instanceof Response) {
      if (res.status >= 500) status = "error";
      try { detail = await res.clone().text(); } catch {}
    }
    await heartbeat(fn, status, detail);
    return res;
  };
}
