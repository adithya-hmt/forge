-- Forge core schema. Every user-owned table: RLS enabled, policies scoped to auth.uid().
-- Applies cleanly to an empty Supabase project:  psql/supabase db push, or SQL editor, in order.

create extension if not exists pgcrypto;

-- ── helper: updated_at ──────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  level text not null default 'student',
  location text not null default '',
  remote_only boolean not null default true,
  hours_per_week int not null default 12,
  window_days int not null default 60,
  categories jsonb not null default '[]'::jsonb,
  weights jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── integrations + encrypted oauth credentials ──────────────────────────────
create table public.integrations (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,               -- github | google
  status text not null default 'disconnected',
  scope text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
create trigger integrations_updated before update on public.integrations
  for each row execute function public.set_updated_at();

-- Tokens are encrypted AT REST with AES-256-GCM INSIDE the Edge Function, using the
-- OAUTH_ENCRYPTION_KEY function secret (see supabase/functions/_shared/token-crypto.ts).
-- The stored value is a base64 text blob (version||nonce||ciphertext) — NOT bytea and
-- NOT Supabase Vault. Only service_role can read this table; the browser never does.
create table public.oauth_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  access_token_enc text not null,          -- JSON StoredSecret {data,alg,v}, base64 payload
  refresh_token_enc text,                  -- JSON StoredSecret or null
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
create trigger oauth_credentials_updated before update on public.oauth_credentials
  for each row execute function public.set_updated_at();

-- OAuth CSRF state: written by the server-side callback function only.
create table public.oauth_states (
  state text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null,
  pkce_verifier text,
  redirect_to text not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── research artifacts ──────────────────────────────────────────────────────
create table public.research_jobs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  goal text not null,
  mode text not null default 'live',
  state text not null default 'queued',   -- queued | leased | completed | failed
  attempts int not null default 0,
  max_attempts int not null default 3,
  -- Durable leasing (P10). lease_owner + lease_expires_at let a crashed worker's job
  -- be reclaimed; next_retry_at spaces retries; seeds are the allowlisted provider URLs.
  lease_owner text,
  lease_expires_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  cost_usd numeric not null default 0,
  seeds jsonb not null default '[]'::jsonb,
  result jsonb,
  result_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create trigger research_jobs_updated before update on public.research_jobs
  for each row execute function public.set_updated_at();
create index research_jobs_claimable
  on public.research_jobs (state, next_retry_at)
  where state in ('queued', 'leased');

create table public.research_job_steps (
  id bigserial primary key,
  job_id text not null references public.research_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stage text not null,
  kind text not null default 'info',
  detail text not null,
  ms int not null default 0,
  created_at timestamptz not null default now()
);

create table public.opportunity_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  opp_id text not null,
  data jsonb not null,                    -- full normalized Opportunity record
  status text not null default 'unverified',
  canonical_url text,
  content_hash text,
  first_seen_epoch int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, opp_id)
);
create trigger snapshots_updated before update on public.opportunity_snapshots
  for each row execute function public.set_updated_at();

-- ── user execution data ─────────────────────────────────────────────────────
create table public.applications (
  user_id uuid not null references auth.users(id) on delete cascade,
  opp_id text not null,
  status text not null default 'saved',
  drafts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, opp_id)
);

create table public.execution_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  opp_id text not null,
  deadline timestamptz,
  plan jsonb not null,                    -- milestones, tasks, docs, contacts, checklist
  calendar_synced boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, opp_id)
);

create table public.calendar_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  opp_id text not null,
  block_id text not null,
  external_id text not null,              -- real Google event ID, returned by the API
  start_at timestamptz not null,
  summary text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, block_id),
  unique (user_id, external_id)
);

create table public.email_links (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  opp_id text,
  external_message_id text not null,      -- real Gmail message ID
  subject text not null default '',
  direction text not null default 'inbound',
  created_at timestamptz not null default now(),
  unique (user_id, external_message_id)
);

create table public.learned_adjustments (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  label text not null,
  delta int not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table public.evidence_corrections (
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id text not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);

create table public.notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'system',
  msg text not null,
  opp_id text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── RLS: enabled + forced on EVERY user-owned table ────────────────────────
--
-- ACCESS MODEL (P6). RLS and PostgreSQL privileges BOTH enforce this:
--
--   table                  | anon | authenticated (browser)        | service_role (Edge Fn)
--   -----------------------+------+--------------------------------+---------------------
--   profiles               | no   | own rows (RLS)                 | bypass
--   integrations           | no   | own rows (RLS)                 | bypass
--   oauth_credentials      | no   | NO ACCESS (RLS, no policy)     | bypass (only writer/reader)
--   oauth_states           | no   | NO ACCESS (RLS, no policy)     | bypass (only writer/reader)
--   research_jobs          | no   | own rows (RLS)                 | bypass
--   research_job_steps     | no   | own rows (RLS)                 | bypass
--   opportunity_snapshots  | no   | own rows (RLS)                 | bypass
--   applications           | no   | own rows (RLS)                 | bypass
--   execution_plans        | no   | own rows (RLS)                 | bypass
--   calendar_links         | no   | own rows (RLS)                 | bypass
--   email_links            | no   | own rows (RLS)                 | bypass
--   learned_adjustments    | no   | own rows (RLS)                 | bypass
--   evidence_corrections   | no   | own rows (RLS)                 | bypass
--   notifications          | no   | own rows (RLS)                 | bypass
--
-- "NO ACCESS" means RLS is enabled and forced but NO permissive policy exists, so
-- anon/authenticated always see zero rows. service_role bypasses RLS entirely, which
-- is exactly how the Edge Functions manage tokens/states.

-- User-facing tables: owner-scoped policy.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','integrations',
    'research_jobs','research_job_steps','opportunity_snapshots',
    'applications','execution_plans','calendar_links','email_links',
    'learned_adjustments','evidence_corrections','notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy %I on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t);
  end loop;
end $$;

-- Sensitive tables: RLS on + forced, NO policy → authenticated clients get nothing.
do $$
declare t text;
begin
  foreach t in array array['oauth_credentials','oauth_states'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ── Least-privilege grants (P6) ─────────────────────────────────────────────
-- Modern Supabase does not auto-expose new public tables. Grant only what the
-- authenticated browser client needs; deny the sensitive tables outright.

-- Revoke any blanket defaults, then grant per-table.
revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on public.profiles            to authenticated;
grant select, insert, update, delete on public.integrations        to authenticated;
grant select, insert, update, delete on public.research_jobs       to authenticated;
grant select, insert                 on public.research_job_steps  to authenticated;
grant select, insert, update, delete on public.opportunity_snapshots to authenticated;
grant select, insert, update, delete on public.applications        to authenticated;
grant select, insert, update, delete on public.execution_plans     to authenticated;
grant select, insert, update, delete on public.calendar_links      to authenticated;
grant select, insert, update, delete on public.email_links         to authenticated;
grant select, insert, update, delete on public.learned_adjustments to authenticated;
grant select, insert, update, delete on public.evidence_corrections to authenticated;
grant select, insert, update, delete on public.notifications       to authenticated;

-- Explicitly ensure the token/state tables are NOT granted to anon/authenticated.
revoke all on public.oauth_credentials from anon, authenticated;
revoke all on public.oauth_states      from anon, authenticated;

-- Sequences needed for inserts on serial-PK tables.
grant usage on sequence public.research_job_steps_id_seq to authenticated;
grant usage on sequence public.email_links_id_seq        to authenticated;
grant usage on sequence public.notifications_id_seq      to authenticated;

-- ── NOTE on token encryption (P4) ──────────────────────────────────────────
-- There are NO SQL encryption helpers and NO Supabase Vault usage. AES-256-GCM is
-- performed inside the Edge Functions (supabase/functions/_shared/token-crypto.ts)
-- with the OAUTH_ENCRYPTION_KEY function secret. Exactly one secret store.

create index research_jobs_user_state on public.research_jobs (user_id, state);
create index snapshots_user_status on public.opportunity_snapshots (user_id, status);
create index notifications_user_read on public.notifications (user_id, read);
