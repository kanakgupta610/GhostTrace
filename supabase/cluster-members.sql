-- GhostTrace: wallet_cluster_members (which wallets belong to which cluster).
-- Additive and safe to run more than once in the Supabase SQL Editor:
--   * no DROP, TRUNCATE or DELETE statements, no cascading deletes
--   * creates only new objects (table, indexes, trigger, function, policy) and skips any that already exist
--   * does not modify any existing table, row or policy
-- Run supabase/seed-sample-data.sql afterwards to fill the table.

create table if not exists public.wallet_cluster_members (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases(id),
  cluster_id uuid not null references public.wallet_clusters(id),
  wallet_id  uuid not null references public.wallets(id),
  created_at timestamptz not null default now(),
  constraint wallet_cluster_members_cluster_wallet_key unique (cluster_id, wallet_id)
);
create index if not exists wallet_cluster_members_case_id_idx on public.wallet_cluster_members (case_id);
create index if not exists wallet_cluster_members_wallet_id_idx on public.wallet_cluster_members (wallet_id);

-- The cluster and the wallet must belong to the row's case (keeps RLS on case_id sound).
create or replace function public.wallet_cluster_members_same_case()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.wallet_clusters where id = new.cluster_id and case_id = new.case_id) then
    raise exception 'wallet_cluster_members: cluster % does not belong to case %', new.cluster_id, new.case_id;
  end if;
  if not exists (select 1 from public.wallets where id = new.wallet_id and case_id = new.case_id) then
    raise exception 'wallet_cluster_members: wallet % does not belong to case %', new.wallet_id, new.case_id;
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'wallet_cluster_members_same_case'
                   and tgrelid = 'public.wallet_cluster_members'::regclass) then
    create trigger wallet_cluster_members_same_case
      before insert or update on public.wallet_cluster_members
      for each row execute function public.wallet_cluster_members_same_case();
  end if;
end $$;

-- RLS: same rule as the other tables. Public roles may only read rows of sample cases; no public writes.
alter table public.wallet_cluster_members enable row level security;
-- Supabase's default privileges give new tables full access for anon/authenticated; keep them read-only.
-- (revoking privileges on this new table removes no data)
revoke all on public.wallet_cluster_members from anon, authenticated;
grant select on public.wallet_cluster_members to anon, authenticated;
grant select, insert, update on public.wallet_cluster_members to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wallet_cluster_members'
                   and policyname = 'Public read sample cluster members') then
    create policy "Public read sample cluster members" on public.wallet_cluster_members
      for select to anon, authenticated
      using (exists (select 1 from public.cases c where c.id = wallet_cluster_members.case_id and c.is_sample = true));
  end if;
end $$;
