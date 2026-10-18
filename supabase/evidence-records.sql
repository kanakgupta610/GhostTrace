-- GhostTrace: evidence_records — persistent store for externally sourced and manually entered evidence.
-- Additive and safe to run more than once in the Supabase SQL Editor:
--   * no DROP, TRUNCATE or DELETE statements; creates only new objects and skips any that exist
--   * does not modify any existing table, row or policy
-- Access: RLS is enabled with NO policies for anon/authenticated, so the publishable key can neither read
-- nor write this table. Only the GhostTrace backend, using SUPABASE_SECRET_KEY (service role), accesses it.
-- Investigators' manual notes and stored evidence therefore never become publicly readable.

create table if not exists public.evidence_records (
  id                 uuid primary key default gen_random_uuid(),
  dedupe_key         text not null,
  origin             text not null check (origin in ('external', 'manual')),
  case_ref           text,                      -- GhostTrace case id (for example GT-2026-530); manual entries
  wallet_address     text check (wallet_address is null or wallet_address ~ '^0x[0-9a-f]{40}$'),
  source             text not null,             -- adapter id (ofac, scamsniffer, github) or 'manual'
  source_name        text,
  source_kind        text,
  source_type        text,
  evidence_type      text,
  title              text not null,
  excerpt            text,
  url                text,
  official_url       text,
  identifies         text,                      -- identifier explicitly published by the source, if any
  confidence         text check (confidence is null or confidence in ('Confirmed', 'Strong', 'Weak')),
  verification       text,
  published_at       timestamptz,
  first_retrieved_at timestamptz,
  retrieved_at       timestamptz,
  created_at         timestamptz not null default now(),
  constraint evidence_records_dedupe_key_key unique (dedupe_key)
);
create index if not exists evidence_records_wallet_idx on public.evidence_records (wallet_address);
create index if not exists evidence_records_case_idx on public.evidence_records (case_ref);

alter table public.evidence_records enable row level security;
-- (revoking privileges on this new table removes no data)
revoke all on public.evidence_records from anon, authenticated;
grant select, insert, update, delete on public.evidence_records to service_role; -- delete: removing manual entries from the app
