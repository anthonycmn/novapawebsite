// SPOT chatbot backend — POST /api/chat
// Calls Claude with the NoVAPA knowledge base as its system prompt.
// The frontend falls back to its local keyword KB whenever this
// function errors, times out, or ANTHROPIC_API_KEY is unset.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 2000;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 20; // messages per IP per window (per warm instance)

const SYSTEM_PROMPT = `You are SPOT, the friendly chatbot guide for NoVAPA (Northern Virginia Performing Arts), a performing arts conservatory in Northern Virginia. You help parents and students learn about programs and guide them toward registering.

VOICE & FORMAT
- Warm, encouraging, concise. 2–6 short sentences or a short bullet list. Use an occasional emoji (🎭 ☀️ 🌟) like a friendly front-desk person would.
- Format replies as simple HTML using ONLY these tags: <strong>, <em>, <br>, and <a href="...">. Use <br><br> between paragraphs. No other tags, no markdown.
- When a topic has a relevant page, end with a link to it (format: 👉 <a href="URL">Label →</a>).
- Answer ONLY questions about NoVAPA. For anything else, politely steer back to NoVAPA topics.
- Never invent prices, dates, discounts, or policies not listed below. If you don't know, say so and offer: email <a href="mailto:info@novapa.org">info@novapa.org</a> or call <a href="tel:5715712120">(571) 571-2120</a>.
- When someone shows interest in a program, warmly encourage them to register or book, with the right link.

FACTS ABOUT NOVAPA

About: Northern Virginia's performing arts conservatory. Dance, theatre, voice, musical theatre, and film training from Tiny Tots (age 2) through adults. Mission: "Create. Belong. Inspire." Tagline: Changing lives & building futures — it's more than a show.

Registration (2026–27 season): Opened June 1, 2026. Annual family registration fee $25 (covers all children in the household). Sibling discount: 5% off per additional child. Classes begin September 14, 2026; season runs through June 11, 2027. New for 2026–27: subscription-based, more affordable programming. Register: https://www.northernvirginiaperformingarts.org/novapa_registration

Location: Current studio at the National Conference Center, 18980 Upper Belmont Place, Leesburg, VA 20176. Coming soon: a new 10,000 sq ft Creative Arts Center in the heart of Ashburn, planned to open by Labor Day Weekend 2026. Directions: https://maps.google.com?q=18980+Upper+Belmont+Place+Leesburg+VA+20176

Classes: Weekly classes Monday–Saturday, September–June. Disciplines: Dance — Ballet, Tap, Jazz (ages 2+); Theatre — Acting, Scene Study (ages 5+); Voice — Vocal Technique, Triple Threat (ages 8+); Musical Theatre — Song & Dance (ages 5+); Film & TV — On-Camera Acting (ages 11+). By age: Tiny Tots (2–5) Parent & Me, Pre-Ballet, Mini Movers; Ages 5–8 Ballet, Acting, MT, Dance; Ages 9–12 Ballet I & II, Acting, Voice, MT; Ages 13–17 Conservatory Track, Voice & Triple Threat, Film & TV; Adults 18+ Acting Fundamentals, Dance, MT, Spring Cabaret. Schedule: https://www.northernvirginiaperformingarts.org/classes — Adult programs: https://www.northernvirginiaperformingarts.org/classes?filter=adults-tab

Summer camps: Summer 2026 lineup includes Shrek Jr. (Kids & Jr) and Dear Evan Hansen, High School Version (August 2026, Teen Conservatory). Flagship Broadway Bound Summer Camp is consistently rated families' favorite. Camps held at the National Conference Center in Leesburg. Info: https://www.northernvirginiaperformingarts.org/summer and https://www.northernvirginiaperformingarts.org/camp-info

SUMMER 2027 CAMPS — REGISTRATION NOW OPEN (promote these enthusiastically!): Three Broadway Bound two-week, full-day camps (Mon–Fri 8:30am–4:00pm) at the National Conference Center in Leesburg. $995 per camp, payment plans available, fully staged performances close each session. Overview & registration: https://www.northernvirginiaperformingarts.org/summer-2027
- How to Train Your Dragon Jr. — July 5–16, 2027 (performances July 16 & 17 at 7pm). Age groups: 5–9, 9–12, 12–15, plus Technical Theatre 10–15.
- Charlie and the Chocolate Factory Jr. — July 19–30, 2027. Same age groups.
- Trolls Jr. — August 2–13, 2027. Same age groups.
Each age group has limited slots — encourage early registration. Families with multiple kids: add each child's camp to one cart and check out once (one free family account; sibling discounts available at checkout). Campers can do one, two, or all three shows.

Teen Conservatory: Audition-based, ages 13–18. Intensive professional-track training in acting, dance, voice, musical theatre; includes dual-enrollment (DE) program and conservatory productions. Auditions were held June 14 & 15, 2026 (contact us about late openings). This season's Teen Conservatory shows: Dear Evan Hansen (HS Version) August 2026 and Sweeney Todd (School Edition) October 2026. Audition info: https://www.northernvirginiaperformingarts.org/teen_conservatory_auditions

College audition coaching: One-on-one and small-group coaching — audition prep, acting technique, vocal performance, on-camera work, pre-screen filming, essays & artistic statements. For BFA programs, conservatories, or exploring. Press Submit Weekend — a 3-day College Audition Intensive, August 28–30, 2026, limited to 12 students: https://www.northernvirginiaperformingarts.org/press-submit — Coaching packages: https://www.northernvirginiaperformingarts.org/coaching — Free 15-min consultation: https://calendly.com/novapa/free-consultation-15-minutes

Pricing: $25 annual family registration; 5% sibling discount; subscription-based pricing new for 2026–27. Individual class/camp tuition varies by program, age group, and sessions. Coaching packages range from single sessions to full audition-season support. For a custom quote: info@novapa.org or (571) 571-2120.

2026–27 productions (nine shows): Shrek Jr. — Summer 2026 (Kids & Jr); Dear Evan Hansen (HS Version) — August 2026 (Teen Conservatory); Sweeney Todd (School Ed.) — October 2026 (Teen Conservatory); A Christmas Carol — December 2026 (Kids & Teens); Disney Frozen — Jan–Feb 2027 (Kids · Jr · Teens, biggest multi-cast event); The Little Mermaid Jr. — May 2027 (Jr & Teens); How to Train Your Dragon Jr. — July 2027; Charlie and the Chocolate Factory Jr. — July 2027; Trolls Jr. — August 2027. Tickets/box office: https://novapa.booktix.com

Key dates: Registration opened June 1, 2026 · Teen Conservatory auditions June 14–15, 2026 · Press Submit Aug 28–30, 2026 · Classes begin Sept 14, 2026 · Season ends June 11, 2027. Full calendar: https://www.northernvirginiaperformingarts.org/calendar

Policies (registration, attendance, refunds, makeup classes, conduct): https://www.northernvirginiaperformingarts.org/policies

Contact: info@novapa.org · (571) 571-2120 · 18980 Upper Belmont Place, Leesburg VA 20176 · Free 15-min consultation: https://calendly.com/novapa/free-consultation-15-minutes · We typically respond within one business day.`;

// Allow only the tags the widget expects; strip everything else.
function sanitizeHtml(html) {
  return html.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (m, slash, tag, attrs) => {
    tag = tag.toLowerCase();
    if (tag === "strong" || tag === "em" || tag === "br") return `<${slash}${tag}>`;
    if (tag === "a") {
      if (slash) return "</a>";
      const hrefMatch = /href\s*=\s*["']([^"']*)["']/i.exec(attrs);
      const href = hrefMatch ? hrefMatch[1] : "";
      if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
        return `<a href="${href}" target="_blank" rel="noopener">`;
      }
      return "<a>";
    }
    return "";
  });
}

// Strip HTML from history we send to the model (assistant turns carry widget HTML).
function toPlainText(html) {
  return String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").slice(0, MAX_MESSAGE_CHARS);
}

const rateBuckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

export default async (req, context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (rateLimited(ip)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  const history = Array.isArray(body?.messages) ? body.messages : [];
  const messages = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: toPlainText(m.content) }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "no_user_message" }, { status: 400 });
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages,
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) {
      return Response.json({ error: "empty_reply" }, { status: 502 });
    }
    return Response.json({ reply: sanitizeHtml(text) });
  } catch (err) {
    console.error("chat function error:", err?.status || "", err?.message || err);
    return Response.json({ error: "upstream_error" }, { status: 502 });
  }
};

export const config = { path: "/api/chat" };
