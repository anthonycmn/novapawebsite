#!/usr/bin/env node
// Pre-deploy checks for the registration system.
//
//   npm run check            static checks (runs on every push and every deploy)
//   npm run check:live       static + probe production
//   node tests/preflight.mjs --live --base https://staging-...netlify.app
//
// Why this exists: on Aug 13 2026 a one-word rename shipped an identifier that
// was never declared (`inRange`). It threw ReferenceError inside
// renderShowKids(), which killed every fall-show registration for about four
// hours — while four campaigns drove 554 families at that exact page.
//
// Nothing caught it. The syntax was valid, the page returned 200, every
// Netlify function was healthy, and the fault only surfaced for a signed-in
// user with a camper selected. Families reported it; our tooling never did.
// Check 1 is deliberately the check that would have caught it.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.argv.includes("--live");
const BASE = (() => {
  const i = process.argv.indexOf("--base");
  // Must be the primary domain: the old domain 301s, and a 301 rewrites POST
  // probes into GETs — every function probe then reads 405 instead of 401.
  return i > -1 ? process.argv[i + 1] : "https://novapa.org";
})();

const problems = [];
const notes = [];
const fail = (check, msg) => problems.push({ check, msg });
const ok = (msg) => notes.push(msg);

// ---------------------------------------------------------------------------
// Check 1 — identifiers referenced but never declared anywhere in the script.
//
// This is not full scope resolution; it asks the narrower question "does this
// name exist at all?" That is what catches a typo or a half-finished rename,
// and because it accepts a declaration in ANY scope it produces no noise from
// legitimate shadowing. Parsing with acorn (rather than regex) is what makes
// it trustworthy: strings, comments, object keys and `obj.prop` can no longer
// masquerade as references.

const GLOBALS = new Set(`window document console navigator location history screen performance
JSON Math Date Object Array String Number Boolean Function Symbol BigInt Promise RegExp Error
TypeError RangeError SyntaxError EvalError URIError Map Set WeakMap WeakSet Proxy Reflect Intl
ArrayBuffer SharedArrayBuffer DataView Uint8Array Uint16Array Uint32Array Int8Array Int16Array
Int32Array Float32Array Float64Array BigInt64Array globalThis undefined NaN Infinity arguments
eval isNaN isFinite parseInt parseFloat encodeURIComponent decodeURIComponent encodeURI decodeURI
escape unescape setTimeout clearTimeout setInterval clearInterval setImmediate requestAnimationFrame
cancelAnimationFrame requestIdleCallback queueMicrotask structuredClone reportError
fetch Headers Request Response AbortController AbortSignal FormData URL URLSearchParams
Blob File FileReader FileList Image Audio Video WebSocket EventSource XMLHttpRequest
localStorage sessionStorage indexedDB caches crypto atob btoa alert confirm prompt print
open close stop focus blur scroll scrollTo scrollBy scrollX scrollY innerWidth innerHeight
outerWidth outerHeight devicePixelRatio pageXOffset pageYOffset visualViewport
addEventListener removeEventListener dispatchEvent CustomEvent Event MouseEvent KeyboardEvent
TouchEvent PointerEvent FocusEvent InputEvent SubmitEvent MessageEvent ErrorEvent CloseEvent
Element HTMLElement SVGElement Node NodeList HTMLCollection DocumentFragment DOMParser
XMLSerializer Range Selection MutationObserver IntersectionObserver ResizeObserver
PerformanceObserver getComputedStyle matchMedia postMessage TextEncoder TextDecoder
self top parent frames opener frameElement CSS customElements getSelection
Notification Worker SharedWorker ServiceWorker BroadcastChannel MessageChannel
Option Text Comment Attr StyleSheet CSSStyleSheet CanvasRenderingContext2D Path2D
IdleDeadline ReadableStream WritableStream TransformStream CompressionStream`.split(/\s+/));

// Third-party globals injected by <script> tags on these pages.
const PAGE_GLOBALS = new Set(`Stripe fbq _fbq gtag dataLayer ga posthog supabase NOVAREG
google grecaptcha plausible clarity Sentry hj _hsq`.split(/\s+/));

function patternNames(node, out) {
  if (!node) return out;
  switch (node.type) {
    case "Identifier": out.add(node.name); break;
    case "ObjectPattern": node.properties.forEach((p) =>
      patternNames(p.type === "RestElement" ? p.argument : p.value, out)); break;
    case "ArrayPattern": node.elements.forEach((e) => patternNames(e, out)); break;
    case "AssignmentPattern": patternNames(node.left, out); break;
    case "RestElement": patternNames(node.argument, out); break;
    case "Property": patternNames(node.value, out); break;
  }
  return out;
}

function declaredNames(ast) {
  const names = new Set();
  walk.full(ast, (node) => {
    switch (node.type) {
      case "VariableDeclarator": patternNames(node.id, names); break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.id) names.add(node.id.name);
        node.params.forEach((p) => patternNames(p, names));
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) names.add(node.id.name); break;
      case "CatchClause": patternNames(node.param, names); break;
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
      case "ImportSpecifier": names.add(node.local.name); break;
      case "LabeledStatement": names.add(node.label.name); break;
    }
  });
  return names;
}

function isReference(node, ancestors) {
  const parent = ancestors[ancestors.length - 2];
  if (!parent) return true;
  switch (parent.type) {
    // obj.prop — `prop` is not a variable
    case "MemberExpression": return parent.computed || parent.object === node;
    // { key: value } — `key` is not a variable
    case "Property": return parent.computed || parent.value === node;
    case "MethodDefinition":
    case "PropertyDefinition": return parent.computed || parent.value === node;
    // declaration positions are handled by declaredNames()
    case "VariableDeclarator": return parent.init === node;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression": return false;
    case "CatchClause": return parent.body === node;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement": return parent.label !== node;
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ExportSpecifier": return false;
    case "AssignmentPattern": return parent.right === node;
    case "RestElement": return false;
    case "ObjectPattern":
    case "ArrayPattern": return false;
    default: return true;
  }
}

function inlineScripts(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;                       // external file
    const type = /type\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (type && !/javascript|module/i.test(type[1])) continue;    // ld+json, templates
    blocks.push({ code: m[2], line: html.slice(0, m.index).split("\n").length, module: /module/i.test(type?.[1] || "") });
  }
  return blocks;
}

function checkUndeclared() {
  const targets = ["register", "tickets"].flatMap((dir) =>
    existsSync(join(ROOT, dir))
      ? readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".html")).map((f) => join(dir, f))
      : []);

  for (const rel of targets) {
    const html = readFileSync(join(ROOT, rel), "utf8");
    let found = 0;
    for (const blk of inlineScripts(html)) {
      let ast;
      try {
        ast = acorn.parse(blk.code, {
          ecmaVersion: "latest",
          sourceType: blk.module ? "module" : "script",
          locations: true,
          allowReturnOutsideFunction: true,
        });
      } catch (e) {
        fail("syntax", `${rel}:${blk.line + (e.loc?.line || 1) - 1}  ${e.message}`);
        found++;
        continue;
      }
      const declared = declaredNames(ast);
      const seen = new Set();
      walk.ancestor(ast, {
        Identifier(node, _state, ancestors) {
          const name = node.name;
          if (seen.has(name)) return;
          if (!isReference(node, ancestors)) return;
          if (declared.has(name) || GLOBALS.has(name) || PAGE_GLOBALS.has(name)) return;
          seen.add(name);
          fail("undeclared-identifier",
            `${rel}:${blk.line + node.loc.start.line - 1}  '${name}' is referenced but never declared`);
          found++;
        },
      });
    }
    if (!found) ok(`${rel}: parses, no undeclared identifiers`);
  }
}

// ---------------------------------------------------------------------------
// Check 2 — every Netlify function must parse. reg-pay imports reg-email, so a
// syntax error in one takes the whole checkout down with it.

function checkFunctions() {
  const dir = join(ROOT, "netlify/functions");
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
  let bad = 0;
  for (const f of files) {
    try { execFileSync(process.execPath, ["--check", join(dir, f)], { stdio: "pipe" }); }
    catch (e) {
      fail("function-syntax", `${f}: ${String(e.stderr || e).split("\n").filter(Boolean)[0]}`);
      bad++;
    }
  }
  if (!bad) ok(`${files.length} netlify functions parse`);
}

// ---------------------------------------------------------------------------
// Check 3 — live probes. An auth error is the healthy answer: a 500 is what a
// broken shared import looks like from outside.

async function probe(path, opts = {}) {
  // Retry network-level failures once after a pause. An HTTP error (500, 404)
  // comes back on attempt one and is real signal; "fetch failed" is usually
  // the MONITOR's network blinking, not the site — on Aug 16 2026 one DNS
  // blip failed all six probes at once, static pages included, and paged
  // Jason for a site that was up the whole time.
  // Three attempts with escalating backoff, not two at a fixed 15s. Between
  // Aug 15 and Aug 28 2026 this alerted five times on "fetch failed" or
  // "aborted" against endpoints that were healthy seconds later — and every
  // single-endpoint case hit probe #1, #2 or #3, never the static pages that
  // run afterwards. That shape is the monitor's own DNS/TLS warming up, not
  // the site. An HTTP status error still fails on attempt one, which is how
  // the real 500s (Aug 21) and the sells_now bug (Aug 18) were caught.
  const backoff = [10000, 30000];
  for (let attempt = 1; ; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try { return await fetch(BASE + path, { ...opts, signal: ctl.signal }); }
    catch (e) {
      if (attempt > backoff.length) throw e;
      await new Promise((res) => setTimeout(res, backoff[attempt - 1]));
    }
    finally { clearTimeout(t); }
  }
}

async function checkLive() {
  // Pay the DNS + TLS + cold-start cost on a throwaway request whose result is
  // ignored, so probe #1 is not the one that absorbs it. Failures here are
  // deliberately swallowed: this is a warm-up, not a check.
  try { await fetch(BASE + "/register/config.js", { signal: AbortSignal.timeout(20000) }); } catch {}

  const expectations = [
    // 400 became a healthy answer with guest checkout (Aug 18): an empty
    // body hits bad_request before the identity check. A broken shared
    // import still shows as 500/502 — that's what this probe exists to catch.
    { path: "/api/reg-pay", method: "POST", want: [400, 401], label: "checkout function loads" },
    { path: "/api/reg-account", method: "POST", want: [401], label: "account function loads" },
    { path: "/api/dcu-pay?activity_id=970601", method: "GET", want: [200], label: "DC Unifieds quote" },
    { path: "/register/", method: "GET", want: [200], label: "registration page" },
    { path: "/register/config.js", method: "GET", want: [200], label: "registration config" },
  ];
  for (const e of expectations) {
    try {
      const r = await probe(e.path, {
        method: e.method,
        headers: e.method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: e.method === "POST" ? "{}" : undefined,
      });
      if (!e.want.includes(r.status)) fail("live", `${e.label} (${e.path}) -> HTTP ${r.status}, expected ${e.want.join("/")}`);
      else ok(`${e.label}: HTTP ${r.status}`);
    } catch (err) { fail("live", `${e.label} (${e.path}) -> ${err.message}`); }
  }

  // The four listings that are hidden AND bookable on purpose — Sweeney Todd,
  // Hadestown, the DEH intensive, the Day Camp Credit Pack — are sold by
  // direct /register/?activity= link, and reg-pay refuses anything whose
  // sells_now is false. A version of activity_facts that folds `hidden` into
  // sells_now (the exact near-miss caught by hand on 17 Aug 2026) would kill
  // all four sales paths while every page still answers 200. So ask the
  // function itself, every run.
  try {
    const SB = "https://tlkuqwsqicxcjdmumkje.supabase.co";
    const AK = "sb_publishable_8ar97CkK-C0YlWuOGtI_tA_mwTDVE6H";
    // DEH (1805731) left this list 17 Aug: its show runs that week and
    // registration was closed on purpose (bookable=false, audit trail
    // confirms). Only listings that SHOULD currently sell belong here.
    // Sweeney Todd (1960809) left 2 Sep: rehearsals underway, registration
    // closed on purpose per Jason (bookable=false, updated_by stamped).
    const DIRECT_LINK_IDS = [1960811, 990010];
    const r = await fetch(`${SB}/rest/v1/rpc/activity_facts`, {
      method: "POST",
      headers: { apikey: AK, Authorization: `Bearer ${AK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_ids: DIRECT_LINK_IDS }),
    });
    if (r.status === 404) {
      ok("activity_facts not deployed yet — reg-pay falls back to activity_prices");
    } else if (!r.ok) {
      fail("live", `activity_facts -> HTTP ${r.status}`);
    } else {
      const rows = await r.json();
      const dead = rows.filter((a) => a.sells_now === false).map((a) => a.name);
      const missing = DIRECT_LINK_IDS.length - rows.length;
      if (dead.length) fail("live", `direct-link listings refuse to sell (sells_now=false): ${dead.join(", ")}`);
      else if (missing) fail("live", `activity_facts returned ${rows.length}/${DIRECT_LINK_IDS.length} direct-link listings`);
      else ok(`direct-link listings all sell (Hadestown, credit pack)`);
    }
  } catch (err) { fail("live", `activity_facts probe -> ${err.message}`); }

  // A half-deployed or truncated page still answers 200.
  try {
    const html = await (await probe("/register/")).text();
    for (const [label, needle] of [
      ["Stripe.js", "js.stripe.com"], ["checkout call", "reg-pay"],
      ["client config", "register/config.js"], ["sign-in loading step", "st-loading"],
    ]) {
      if (html.includes(needle)) ok(`registration page has ${label}`);
      else fail("live", `registration page is missing ${label} ('${needle}')`);
    }
    if (html.length < 100000) fail("live", `registration page is only ${html.length} bytes — likely truncated`);
    else ok(`registration page is ${html.length} bytes`);
  } catch (err) { fail("live", `could not read registration page: ${err.message}`); }
}

// ---------------------------------------------------------------------------

checkUndeclared();
checkFunctions();
if (LIVE) await checkLive();

// --alert emails on failure, for unattended runs. Silent when healthy, so a
// message in the inbox always means something is actually wrong.
async function alertByEmail() {
  let key;
  try { key = readFileSync(join(process.env.HOME, ".config/novapa/resend_key"), "utf8").trim(); }
  catch { console.error("  (--alert: no resend key, skipping email)"); return; }
  const body = problems.map((p) => `[${p.check}] ${p.msg}`).join("\n");
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "NOVAPA Alerts <alerts@mail.novapa.org>",
        to: ["jason@novapa.org"],
        subject: `Registration preflight FAILED — ${problems.length} problem(s)`,
        text: `Automated check of ${BASE} failed.\n\n${body}\n\n` +
              `This runs unattended and only emails on failure.\n` +
              `Reproduce with:  npm run check:live\n`,
      }),
    });
    console.error(r.ok ? "  (--alert: emailed jason@novapa.org)" : `  (--alert: send failed ${r.status})`);
  } catch (e) { console.error(`  (--alert: send failed ${e.message})`); }
}

const RULE = "─".repeat(72);
console.log("\n" + RULE);
console.log(`  preflight — ${LIVE ? "static + live (" + BASE + ")" : "static"}`);
console.log(RULE);
for (const n of notes) console.log(`  ok    ${n}`);
if (problems.length) {
  console.log();
  for (const p of problems) console.log(`  FAIL  [${p.check}] ${p.msg}`);
  console.log("\n" + RULE);
  console.log(`  ${problems.length} problem(s) — deploy blocked`);
  console.log(RULE + "\n");
  if (process.argv.includes("--alert")) await alertByEmail();
  process.exit(1);
}
console.log("\n" + RULE);
console.log("  all checks passed");
console.log(RULE + "\n");
