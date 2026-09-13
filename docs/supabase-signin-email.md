# The sign-in email: sender, code length, and the guard that has to go with it

## Why this file exists

On 27 August 2026 a NOVAPA parent forwarded "Your NOVAPA sign-in link" to the
office and asked whether it was a scam or spam. She had never met Jason, whose
address was on it, and she did not click the link. Jen answered her the same
afternoon. The cause, in Jason's words in that thread: a database update
triggered the automatic sign-in link email for about 400 people who were
already registered and had asked for nothing.

That email is the gate every returning family passes through. An email that
reads as phishing sitting in front of a checkout is a revenue problem, not only
a support one.

The template is not in this repo because the email is sent by Supabase Auth
(`signInWithOtp` in `register/index.html`) and rendered from the Magic Link
template in the Supabase dashboard. What that template already says, and what
still needs changing, is written down here so the next person does not have to
guess from the outside.

## What the live email already does (verified 13 Sep 2026)

Read from real sends sitting in CJ's mailbox, dated 15 Aug, 18 Aug and 25 Aug
2026. **Do not "fix" these. They are already right.**

- Subject: `Your NOVAPA sign-in link`
- Branded NOVAPA, not Supabase
- Carries both the button and the code: "Click the button, or enter the code
  below on the sign-in page. Both work once and expire in an hour."
- Ends with "Didn't request this? You can safely ignore this email."

So the template is already customised and already renders `{{ .Token }}`. If a
future change description says the code needs adding, that change description
is out of date.

## The code is EIGHT digits

Observed codes: `95720364`, `99883414`, `85855292`, `69872923`. Supabase's OTP
length is a project setting and the default is six; this project is set to
eight.

**Anything that accepts this code must not hardcode a length.** On 11 September
2026 the parent portal reset page accepted only six digits while the email sent
eight, so it rejected correct codes. Shara Lessley, Gretchen Westover and Blair
Winter all hit it, and CJ wrote to them on 13 September to apologise: "That was
our bug, not yours. The reset page was only accepting six-digit codes and the
email actually sends eight, so a correct code was rejected."

`register/index.html` takes 6 to 10 digits and lets the server decide, which is
correct whatever the setting is later changed to. Keep it that way.

## What still needs changing: the sender

This is the one thing the August incident exposed that is still not fixed.

Dashboard: Authentication, then Emails, then SMTP Settings.

- Sender email: currently `jason@novapa.org`. It should be `info@novapa.org`.
  A parent who has never met the CTO receives a login link from his personal
  work address; that is precisely what Sam Hammond flagged.
- Sender name: `NOVAPA`. Never a staff member's name, never "Supabase".
- Custom SMTP through the existing Resend domain, so the message is signed by a
  domain families already receive mail from.

Optionally, put the expiry in the subject. Saying when a link dies is part of
what separates a real transactional email from a phishing attempt in a parent's
head:

```
Your NOVAPA sign-in link (expires in 60 minutes)
```

## The guard that matters more than the wording

A better sender does not stop the actual incident. Four hundred people got a
sign-in link because a migration touched auth rows.

Whatever job, backfill or migration can cause Supabase to emit an auth email
must not be able to do it in bulk. Before any future migration that touches
`auth.users`, confirm it cannot trigger an email send, and if it can, run it
with sending disabled. A sign-in link should only ever exist because a person
typed their email into the registration page thirty seconds earlier.

## What the page does

`register/index.html`, on the "check your inbox" step:

- a code field wired to `sb.auth.verifyOtp`, accepting 6 to 10 digits, so
  nobody has to leave the tab. The magic link round trip frequently does not
  survive the Instagram and Facebook in-app browsers.
- the line "The email comes from NOVAPA. We will never ask for a password or
  payment details by email", with the office number.

That second line is a promise the sender setting above has to keep. Until the
sender is `info@novapa.org`, the page says the email comes from NOVAPA and the
email says it comes from Jason.
