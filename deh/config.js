// Dear Evan Hansen staff dashboard — its own Supabase project.
//
// WHY THIS FILE EXISTS
//   The dashboard used to borrow /register/config.js, which meant this page
//   also carried the registration project's credentials and the live Stripe
//   publishable key. This page sits behind a shared word rather than a login,
//   so it should not be able to reach the database that holds registrations
//   and payment records at all. Its own project, its own key, nothing shared.
//
// HOW TO FILL THIS IN  (two values, both safe to publish)
//   1. https://supabase.com/dashboard  ->  New project
//        Name:   novapa-deh
//        Region: East US (North Virginia)
//        Save the database password somewhere; you will not need it here.
//   2. Wait for it to finish provisioning (about two minutes).
//   3. SQL Editor -> New query -> paste db/deh-standalone.sql -> Run.
//        The last table it prints should read OK on every row.
//   4. Project Settings -> API. Copy:
//        Project URL          ->  SUPABASE_URL below
//        anon / public key    ->  SUPABASE_ANON_KEY below
//   5. Commit this file. Netlify redeploys and the team is sharing.
//
//   Until both values are filled in the dashboard still works — it just keeps
//   everything on the phone that entered it, and the header says so.
//
// IS THE ANON KEY SAFE TO COMMIT?
//   Yes, and only because of how the schema is built. Every table has RLS on
//   with no policies, so the key cannot read or write a single row directly.
//   All access goes through SECURITY DEFINER functions that expose exactly
//   the rehearsal data and nothing else. Verified against a real Postgres:
//   as the anon role, direct SELECT and INSERT on these tables are refused.
window.DEHDB = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
};
