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

-- Tokens are encrypted AT REST via pgp_sym_encrypt (key held server-side as a
-- Supabase secret, never in a client bundle). The client can only ever see ciphertext.
create table public.oauth_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  access_token_enc bytea not null,
  refresh_token_enc bytea,
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
  state text not null default 'queued',   -- queued | leased | done | failed
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  cost_usd numeric not null default 0,
  result_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create trigger research_jobs_updated before update on public.research_jobs
  for each row execute function public.set_updated_at();

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

-- ── RLS: enabled on EVERY user-owned table ──────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','integrations','oauth_credentials','oauth_states',
    'research_jobs','research_job_steps','opportunity_snapshots',
    'applications','execution_plans','calendar_links','email_links',
    'learned_adjustments','evidence_corrections','notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- one strict policy per table: user may only touch their own rows
    execute format(
      'create policy %I on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t);
  end loop;
end $$;

-- ── token encryption helpers (called by Edge Functions via rpc) ─────────────
-- Key lives in Supabase Vault (supabase secrets set OAUTH_ENCRYPTION_KEY=...).
-- SECURITY DEFINER is required because vault is not readable by anon/authenticated.
create or replace function public.forge_encrypt(plaintext text)
returns bytea language sql security definer set search_path = public as $$
  select pgp_sym_encrypt(
    plaintext,
    (select decrypted_secret from vault.decrypted_secrets where name = 'OAUTH_ENCRYPTION_KEY' limit 1)
  );
$$;

create or replace function public.forge_decrypt(ciphertext bytea)
returns text language sql security definer set search_path = public as $$
  select pgp_sym_decrypt(
    ciphertext,
    (select decrypted_secret from vault.decrypted_secrets where name = 'OAUTH_ENCRYPTION_KEY' limit 1)
  );
$$;
-- Only the service role invokes these; never grant to anon.
revoke all on function public.forge_encrypt(text) from public, anon, authenticated;
revoke all on function public.forge_decrypt(bytea) from public, anon, authenticated;
grant execute on function public.forge_encrypt(text) to service_role;
grant execute on function public.forge_decrypt(bytea) to service_role;

create index research_jobs_user_state on public.research_jobs (user_id, state);
create index snapshots_user_status on public.opportunity_snapshots (user_id, status);
create index notifications_user_read on public.notifications (user_id, read);
