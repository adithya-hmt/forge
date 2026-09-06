-- Durable background-job leasing (P10).
--
-- The research worker claims jobs through forge_job_claim(), which uses
-- FOR UPDATE SKIP LOCKED so that two concurrent workers can NEVER be handed the same
-- job. A leased job whose lease_expires_at has passed (crashed worker) is reclaimed.
-- These run as SECURITY DEFINER + service_role only; the browser never calls them.

-- ── claim: atomically hand out one due job ──────────────────────────────────
create or replace function public.forge_job_claim(p_worker text)
returns public.research_jobs
language plpgsql security definer set search_path = public
as $$
declare
  v_job public.research_jobs;
begin
  select * into v_job
  from public.research_jobs
  where state = 'queued'
    and (next_retry_at is null or next_retry_at <= now())
    and attempts < max_attempts
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    -- No queued job; try to reclaim an expired lease (crashed worker).
    select * into v_job
    from public.research_jobs
    where state = 'leased'
      and lease_expires_at is not null
      and lease_expires_at < now()
      and attempts < max_attempts
    order by lease_expires_at asc
    for update skip locked
    limit 1;
  end if;

  if not found then
    return null;
  end if;

  update public.research_jobs
  set state = 'leased',
      lease_owner = p_worker,
      lease_expires_at = now() + interval '5 minutes',
      attempts = attempts + 1
  where id = v_job.id;

  v_job.state := 'leased';
  v_job.attempts := v_job.attempts + 1;
  return v_job;
end;
$$;

-- ── complete: mark done + store result ──────────────────────────────────────
create or replace function public.forge_job_complete(p_job_id text, p_result jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.research_jobs
  set state = 'completed',
      result = p_result,
      lease_owner = null,
      lease_expires_at = null,
      last_error = null
  where id = p_job_id and state = 'leased';
end;
$$;

-- ── fail: record error; leave queued for retry until max_attempts ──────────
create or replace function public.forge_job_fail(p_job_id text, p_error text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v record;
begin
  select attempts, max_attempts into v
  from public.research_jobs where id = p_job_id for update;

  if not found then return; end if;

  if v.attempts >= v.max_attempts then
    update public.research_jobs
    set state = 'failed', last_error = p_error, lease_owner = null, lease_expires_at = null
    where id = p_job_id;
  else
    update public.research_jobs
    set state = 'queued',
        last_error = p_error,
        lease_owner = null,
        lease_expires_at = null,
        next_retry_at = now() + (interval '1 second' * power(2, v.attempts))  -- exp backoff
    where id = p_job_id;
  end if;
end;
$$;

-- Service-role only. Never executable by anon/authenticated.
revoke all on function public.forge_job_claim(text)        from public, anon, authenticated;
revoke all on function public.forge_job_complete(text, jsonb) from public, anon, authenticated;
revoke all on function public.forge_job_fail(text, text)   from public, anon, authenticated;
grant execute on function public.forge_job_claim(text)        to service_role;
grant execute on function public.forge_job_complete(text, jsonb) to service_role;
grant execute on function public.forge_job_fail(text, text)   to service_role;
