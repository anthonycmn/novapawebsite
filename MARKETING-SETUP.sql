-- One-time setup for the retargeting drip system + admin Marketing tab.
-- Paste this whole file into the Supabase SQL editor (Registration project) and Run.
-- Safe to re-run: creates are IF NOT EXISTS, seeds skip existing rows.

create table if not exists email_sequences (
  id serial primary key,
  seq text not null,
  step int not null,
  delay_minutes int not null,
  subject text not null,
  body text not null,
  enabled boolean not null default true,
  unique (seq, step)
);
alter table email_sequences enable row level security;

create table if not exists retarget_state (
  email text primary key,
  seq text not null default 'abandoned',
  stage int not null default 0,
  status text not null default 'active',  -- active | purchased | stopped | done
  anchor_at timestamptz not null default now(),
  last_sent_at timestamptz,
  msg_refs jsonb default '[]'::jsonb,
  ctx jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table retarget_state enable row level security;

insert into email_sequences (seq, step, delay_minutes, subject, body) values
('abandoned', 1, 30, 'Your {camp} registration expired.',
'Hey {parentName},

Just letting you know your saved {camp} registration spot has expired.

If you''d like to grab them again, we still have some spots available here:

<a href="{link}">Click here to save your spot</a> 👈

Best,
The Broadway Bound Team'),
('abandoned', 2, 1440, 'Checking in on {camperNames}',
'Hi {parentName},

I noticed you were trying to sign up {camperNames} for {camps} yesterday.

Just wanted to reach out personally in case you had any issues with the registration process!

All the best,
Jason from Broadway Bound

P.S. you can jump back in anytime here: <a href="{link}">registration link</a>'),
('abandoned', 3, 2880, 'Checking in on {camperNames}',
'Hey {parentName}! Just following up on this.

If you need help getting {camperNames} registered just let me know!

Best,
Jason from Broadway Bound'),
('linkexpired', 1, 120, 'Your NOVAPA sign-in link',
'Hi{parentComma},

Looks like the sign-in link we emailed you earlier expired before you could use it — they only last a little while for security.

No problem: <a href="{link}">head back here</a>, enter this same email, and a fresh link will be in your inbox in seconds.

If anything is giving you trouble, just reply to this email and I''ll sort it out.

Best,
Jason from Broadway Bound')
on conflict (seq, step) do nothing;

create or replace function public.marketing_get()
returns jsonb language sql stable security definer set search_path=public as $fn$
  select case when not is_admin() then null else jsonb_build_object(
    'sequences', (select jsonb_agg(to_jsonb(s) order by s.seq, s.step) from email_sequences s),
    'pipeline', (select jsonb_agg(jsonb_build_object('seq', seq, 'stage', stage, 'status', status, 'n', n) order by seq, stage)
      from (select seq, stage, status, count(*) n from retarget_state group by 1,2,3) t),
    'recent', (select jsonb_agg(jsonb_build_object('email', r.email, 'seq', r.seq, 'stage', r.stage, 'status', r.status,
        'anchor', r.anchor_at, 'sent', r.last_sent_at, 'ctx', r.ctx) order by r.updated_at desc)
      from (select * from retarget_state order by updated_at desc limit 60) r)
  ) end;
$fn$;
grant execute on function public.marketing_get() to authenticated;

create or replace function public.marketing_save_step(p_id int, p_delay int, p_subject text, p_body text, p_enabled boolean)
returns void language sql volatile security definer set search_path=public as $fn$
  update email_sequences set delay_minutes = p_delay, subject = p_subject, body = p_body, enabled = p_enabled
  where id = p_id and is_admin();
$fn$;
grant execute on function public.marketing_save_step(int, int, text, text, boolean) to authenticated;

create or replace function public.marketing_stop(p_email text)
returns void language sql volatile security definer set search_path=public as $fn$
  update retarget_state set status = 'stopped', updated_at = now() where email = p_email and is_admin();
$fn$;
grant execute on function public.marketing_stop(text) to authenticated;

select seq, step, delay_minutes, enabled from email_sequences order by seq, step;
