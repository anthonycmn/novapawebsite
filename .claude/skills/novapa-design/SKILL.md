---
name: novapa-design
description: NOVAPA's design and copy conventions for every customer-facing surface — web pages, emails, the registration app, My NOVAPA, the box office, and campaign copy. Read this BEFORE writing any UI markup, email template, or customer-facing copy, and before adding icons, emojis, or decorative elements to anything a family will see.
---

# NOVAPA design conventions

The brand is a premium performing-arts company. Every surface should read
like a playbill, not a group chat.

## Hard rules (Jason, explicit)

- **No emojis. Anywhere. Ever.** Not in UI, not in emails, not in section
  headings, not in buttons, not in chat copy. "Emojis are not premium"
  (Aug 14 2026, after they crept into the credits banner, the My NOVAPA
  cards, and a checkout trust line). Decoration comes from typography,
  spacing, and the gold palette — not from Unicode. If an element feels
  bare without an emoji, the layout is wrong, not the character set.
- **No dashes in email copy.** Jason's standing rule for emails: keep
  sentences simple, no em/en dashes as connectors. Plain sentences.
- **Never quote seat counts or scarcity numbers** without checking the
  seat-counting skill first.

## Palette and type (the register/portal family)

- Navy ground: `#08111F` -> `#0F1E36` radial; card `rgba(22,43,82,0.45)`;
  hairlines `rgba(255,255,255,0.14)`.
- Gold accents: `#C8892A` -> `#E8B84B` gradient for primary actions; gold
  text `#E8B84B` on navy.
- Type: Cormorant Garamond (serif, headings and camper names), DM Sans
  (body), uppercase letter-spaced labels at ~11.5px for section headers.
- Section labels are typographic (`REGISTRATIONS`, `DAY CAMP PACK`) —
  small caps style, letterspaced, dim. Never an icon or emoji prefix.

## Email templates

- Camp confirmations: Georgia serif on `#f5f2ec`, navy header block, gold
  accent line. Table-based HTML, email-safe.
- DC Unifieds is a SEPARATE brand: black/pink (`#0d0d0d` / `#ff2d8f`),
  Bricolage Grotesque + Inter. Never mix the two brands in one surface.
- From-names: NOVAPA mail signs as Jason (drip/referral) or "NOVAPA Box
  Office" (tickets); body signature must match the from-name identity.

## Buttons and actions

- One primary action per card, full-width, gold gradient, uppercase
  letterspaced label. Secondary actions are outlined gold, beneath, never
  side-by-side with the name they act on (collision lesson from the
  My NOVAPA credits card).
- Names and context on their own lines; actions below them.

## Copy length

UI copy is terse. One line where one line works. "You have 2 free tickets",
not a sentence with the account email, the source of the credit, and a
question mark (Jason, Aug 14: "you always put too much text in our UI, no
need to overexplain"). Mechanics the buyer does not need to act on stay out
of the interface. Policy text is the exception — policies are stated in full.

## Voice

- Confident, warm, specific. "Reserved seating from $20", not
  "Tickets on sale soon!!". No exclamation stacking, no hype filler.
- Scarcity claims only from verified counts (seat-counting skill).
