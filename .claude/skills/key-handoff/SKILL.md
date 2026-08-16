---
name: key-handoff
description: How to receive any API key, token, or secret from Jason. Use this EVERY time a task needs a credential Claude doesn't have — Stripe keys, API tokens, service keys, OAuth secrets, SMTP passwords — and whenever Jason says he created or has a key ready. Never ask Jason to paste a secret into chat and never have him hand-create files; always hand him the one-line hidden-paste command this skill specifies.
---

# Key handoff: the hidden-paste command

Jason's chosen method for getting secrets from him to disk (his words: "I like
the version where you give me the command that lets me paste the key right
after in the password field"). The terminal prompt hides the paste like a
password field, the secret never appears in chat history or shell history, and
the file lands where every other credential already lives.

## The command to give him

One fenced `bash` block (the app puts a Run button on it), nothing else in the
block, one command per block:

```bash
IFS= read -rs "K?Paste the <human name> key, then press Enter: " ; printf '%s' "$K" > ~/.config/novapa/<file_name> ; chmod 600 ~/.config/novapa/<file_name> ; unset K ; echo ; echo "saved ($(wc -c < ~/.config/novapa/<file_name> | tr -d ' ') chars)"
```

Fill in `<human name>` (what he's pasting, e.g. "read-only Stripe") and
`<file_name>` (snake_case, no extension, e.g. `stripe_read_key`). Notes that
make this exact shape load-bearing:

- `IFS= read -rs` — zsh syntax (his shell). `-s` hides the paste; `-r` and
  bare `IFS` keep backslashes and leading/trailing content intact.
- Separators are `;` not `&&` — `read` can exit nonzero in edge cases and the
  write must still happen.
- `printf '%s'` — no trailing newline. Scripts read these files with
  `$(cat file)` and a newline breaks curl auth headers silently.
- The char count in the confirmation lets both of you see the paste took
  without revealing a single character.

## Conventions

- Files live in `~/.config/novapa/`, one secret per file. Existing names:
  `supabase_token`, `supabase_service_key`, `resend_key`, `stripe_rk`,
  `posthog_key`, `gemini_key`. Match the style.
- After he runs it, verify shape without exposing the secret: byte count, and
  at most a `head -c 8` prefix check (key prefixes like `rk_live_` are not
  secret). Never cat the whole file into output.
- Then wire it wherever the task needs it (e.g. Netlify env via API) and
  confirm the integration works with a live read-only call.
- If the count comes back 0 or obviously short, the paste missed — just give
  him the same block again.

## Never

- Never ask him to paste a secret into the chat.
- Never type a secret into a browser field or form for him (standing rule:
  Jason handles credentials himself).
- Never echo, log, or commit file contents; `~/.gitignore_global` covers
  `~/.config/novapa/` but don't rely on it — just never move secrets into
  repos.
