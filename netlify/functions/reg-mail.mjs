// One transport for every transactional sender on the site (registration
// confirmations, ticket receipts, free-class notes, careers and admin
// heads-ups, rehearsal reports, the retargeting drip).
//
// Why this exists (Sep 16 2026): every one of those senders built its own
// nodemailer transport against smtp.gmail.com with Jason's Workspace app
// password. That password was retired with his account, so from the 1:24 PM
// ET deploy on, each of them threw inside its try/catch or returned early on
// the SMTP_PASS guard, and families paid and heard nothing.
//
// The rule:
//   SMTP_PASS set                  -> SMTP, host SMTP_HOST || smtp.gmail.com,
//                                     from FROM_ADDR || SMTP_USER (unchanged)
//   SMTP_PASS unset, RESEND_API_KEY -> the Resend HTTP API, the same call the
//                                     lead alerts and the balance audit make,
//                                     from hello@mail.novapa.org (the one
//                                     domain verified in Resend, the address
//                                     NOVAPA Mail sends from), reply-to
//                                     info@novapa.org unless the caller says
//                                     otherwise
//   neither                        -> sendMail throws; mailConfigured() is
//                                     false so callers can return early
//
// A caller passes a display name, never an address: { fromName: "NOVAPA Box
// Office", to, subject, html }. The helper picks the address for the transport
// in use, so no sender ever hard-codes a mailbox again.

export const RESEND_REPLY_TO = "info@novapa.org";

// The same mailbox reg-campaign.mjs sends NOVAPA Mail from. RESEND_FROM_ADDR
// is only for the day another domain is verified in Resend; leave it unset.
export function resendFromAddr() {
  return process.env.RESEND_FROM_ADDR || "hello@mail.novapa.org";
}

export function smtpFromAddr() {
  return process.env.FROM_ADDR || process.env.SMTP_USER;
}

// Which transport a send would take right now, or null when nothing is set.
export function mailTransport() {
  if (process.env.SMTP_PASS && process.env.SMTP_USER) return "smtp";
  if (process.env.RESEND_API_KEY) return "resend";
  return null;
}

export function mailConfigured() {
  return mailTransport() !== null;
}

// The address mail goes out from on the current transport. Callers that show
// it in copy ("reply to this address") read it here rather than the env.
export function fromAddr() {
  return mailTransport() === "smtp" ? smtpFromAddr() : resendFromAddr();
}

function displayFrom(msg, addr) {
  if (msg.fromName) return `${msg.fromName} <${addr}>`;
  // A caller that still hands over a full "Name <addr>" keeps its name and
  // takes the transport's address; a bare name is treated as a name.
  const m = /^\s*(.*?)\s*<[^>]*>\s*$/.exec(msg.from || "");
  const name = m ? m[1] : (msg.from || "").trim();
  return name ? `${name} <${addr}>` : addr;
}

function list(v) {
  if (v == null || v === "") return [];
  return (Array.isArray(v) ? v : String(v).split(",")).map((s) => String(s).trim()).filter(Boolean);
}

// msg: { fromName, to, cc, bcc, replyTo, subject, text, html, headers }
// Returns { transport, id, messageId }. messageId is the RFC Message-ID when
// the transport reports one (SMTP does; Resend returns its own id instead).
export async function sendMail(msg) {
  const transport = mailTransport();
  if (transport === "smtp") {
    const { default: nodemailer } = await import("nodemailer");
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com", port: 465, secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const info = await t.sendMail({
      from: displayFrom(msg, smtpFromAddr()),
      to: msg.to,
      ...(msg.cc ? { cc: msg.cc } : {}),
      ...(msg.bcc ? { bcc: msg.bcc } : {}),
      replyTo: msg.replyTo || RESEND_REPLY_TO,
      subject: msg.subject,
      ...(msg.text ? { text: msg.text } : {}),
      ...(msg.html ? { html: msg.html } : {}),
      ...(msg.headers && Object.keys(msg.headers).length ? { headers: msg.headers } : {}),
    });
    return { transport, id: info.messageId, messageId: info.messageId };
  }
  if (transport === "resend") {
    const body = {
      from: displayFrom(msg, resendFromAddr()),
      to: list(msg.to),
      reply_to: msg.replyTo || RESEND_REPLY_TO,
      subject: msg.subject,
    };
    const cc = list(msg.cc), bcc = list(msg.bcc);
    if (cc.length) body.cc = cc;
    if (bcc.length) body.bcc = bcc;
    if (msg.text) body.text = msg.text;
    if (msg.html) body.html = msg.html;
    if (msg.headers && Object.keys(msg.headers).length) body.headers = msg.headers;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const detail = (await r.text().catch(() => "")).slice(0, 300);
      throw new Error(`resend ${r.status}: ${detail}`);
    }
    const out = await r.json().catch(() => ({}));
    return { transport, id: out.id || null, messageId: null };
  }
  throw new Error("mail not configured: set SMTP_USER and SMTP_PASS, or RESEND_API_KEY");
}
