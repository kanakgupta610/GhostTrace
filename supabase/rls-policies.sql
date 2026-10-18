-- GhostTrace: row-level security for the public (publishable-key) frontend.
-- Safe to run more than once in the Supabase SQL editor.
--
-- Result:
--   * anon / authenticated can SELECT only rows that belong to a case with is_sample = true
--   * anon / authenticated get no INSERT / UPDATE / DELETE
--   * service_role (the secret key, used only by import-sample-data.js in Node) can write;
--     it bypasses RLS, but still needs table privileges

alter table public.cases           enable row level security;
alter table public.wallets         enable row level security;
alter table public.transactions    enable row level security;
alter table public.osint_evidence  enable row level security;
alter table public.wallet_clusters enable row level security;

-- privileges: read-only for public roles, full access for the server-side import
revoke insert, update, delete, truncate on public.cases, public.wallets, public.transactions, public.osint_evidence, public.wallet_clusters from anon, authenticated;
grant select on public.cases, public.wallets, public.transactions, public.osint_evidence, public.wallet_clusters to anon, authenticated;
grant select, insert, update, delete on public.cases, public.wallets, public.transactions, public.osint_evidence, public.wallet_clusters to service_role;

-- policies (dropped first so the script can be rerun)
drop policy if exists "Public read sample cases" on public.cases;
create policy "Public read sample cases" on public.cases
  for select to anon, authenticated
  using (is_sample = true);

drop policy if exists "Public read sample wallets" on public.wallets;
create policy "Public read sample wallets" on public.wallets
  for select to anon, authenticated
  using (exists (select 1 from public.cases c where c.id = wallets.case_id and c.is_sample = true));

drop policy if exists "Public read sample transactions" on public.transactions;
create policy "Public read sample transactions" on public.transactions
  for select to anon, authenticated
  using (exists (select 1 from public.cases c where c.id = transactions.case_id and c.is_sample = true));

drop policy if exists "Public read sample osint" on public.osint_evidence;
create policy "Public read sample osint" on public.osint_evidence
  for select to anon, authenticated
  using (exists (select 1 from public.cases c where c.id = osint_evidence.case_id and c.is_sample = true));

drop policy if exists "Public read sample clusters" on public.wallet_clusters;
create policy "Public read sample clusters" on public.wallet_clusters
  for select to anon, authenticated
  using (exists (select 1 from public.cases c where c.id = wallet_clusters.case_id and c.is_sample = true));

-- Inspect what is in place (run separately):
-- select tablename, policyname, roles, cmd, qual from pg_policies where schemaname = 'public' order by tablename;
