# Registration DB functions — export of record

One file per function in the `public` schema of the Registration Supabase
project (tlkuqwsqicxcjdmumkje). **The live database is the source of truth**;
this directory is the version-controlled export so definitions are
recoverable and diffable. Re-export after any function change:
the session tooling dumps `pg_get_functiondef` for every `public` function.

Exported 2026-08-11 (62 functions). Notable:
- `admin_*` / `marketing_*` self-gate on `is_admin()` (admin_emails table).
- `deh_*` are service-role only as of 2026-08-11 (REVOKEd from PUBLIC/anon).
- `my_*` / `get_my_*` / `ensure_my_family` resolve the caller's family by
  exact email first, then `cc_email` alias (see backups/dedupe_20260811.sql).
- `acquire_hold` v1/v2 are dead generations; only v3 is called by code.
