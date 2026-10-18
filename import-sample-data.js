// Imports the bundled fictional sample investigations (src/data/cases.js) into Supabase.
//
//   node import-sample-data.js --dry-run   build + validate rows, compare with the database, write nothing
//   node import-sample-data.js             upsert all rows (needs SUPABASE_SECRET_KEY)
//   node import-sample-data.js --prune     also delete rows inside the sample cases that are no longer in the dataset
//   node import-sample-data.js --sql FILE  write the same upserts as SQL (no key needed); run FILE in the Supabase SQL Editor
//
// Rerunnable: every row id is a deterministic UUID (src/lib/supabaseMapping.js), so a second
// run updates the same rows instead of inserting duplicates. Only the sample cases' own rows
// are touched; other cases in the database are never read for writing, updated or deleted.
//
// Writes need a secret key because RLS only allows public reads. Put it in .env.local (ignored
// by git via *.local) or pass it inline. Never give it a VITE_ prefix: Vite ships VITE_ vars to the browser.
import { writeFileSync } from 'node:fs'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { SAMPLE_CASES } from './src/data/cases.js'
import { analyseCase } from './src/lib/analysis.js'
import { caseToRows, ids } from './src/lib/supabaseMapping.js'

dotenv.config({ path: './.env.local', quiet: true })
dotenv.config({ path: './.env', quiet: true })

const argv = process.argv.slice(2)
const args = new Set(argv)
const SQL_OUT = args.has('--sql') ? argv[argv.indexOf('--sql') + 1] || 'supabase/seed-sample-data.sql' : null
const DRY = args.has('--dry-run') || !!SQL_OUT
const PRUNE = args.has('--prune')
const TABLES = ['cases', 'wallets', 'transactions', 'wallet_clusters', 'wallet_cluster_members', 'osint_evidence'] // parent tables first
const MISSING_TABLE = new Set(['PGRST205', '42P01'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

function fail(msg) { console.error(`\n✖ ${msg}`); process.exit(1) }
const looksSecret = (k) => {
  if (!k) return false
  if (k.startsWith('sb_secret_')) return true
  try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role === 'service_role' } catch { return false }
}

// ── safety checks ──
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('VITE_') && looksSecret(value)) fail(`${name} holds a secret/service-role key. VITE_ variables are bundled into the frontend. Remove it and rotate that key in the Supabase dashboard.`)
}
if (!url) fail('VITE_SUPABASE_URL is not set (.env).')
if (!DRY && !secretKey) {
  fail([
    'SUPABASE_SECRET_KEY is not set, so nothing was imported.',
    '  RLS lets the publishable key read sample data only, so writes need a secret key, used here in Node only.',
    '  Get it from Supabase dashboard → Project Settings → API Keys → Secret keys, then either:',
    '    echo "SUPABASE_SECRET_KEY=sb_secret_..." >> .env.local   (ignored by git via *.local)',
    '  or run:  SUPABASE_SECRET_KEY=sb_secret_... node import-sample-data.js',
    '  Use --dry-run to validate the rows without a secret key.',
  ].join('\n'))
}
if (secretKey && !looksSecret(secretKey)) console.warn('⚠ SUPABASE_SECRET_KEY does not look like a secret key (sb_secret_… or a service_role JWT). Writes may be rejected.')

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const reader = createClient(url, secretKey || publishableKey, opts) // secret key reads everything; publishable key sees only what RLS exposes
const writer = secretKey ? createClient(url, secretKey, opts) : null
const publicClient = publishableKey ? createClient(url, publishableKey, opts) : null

// ── build and validate rows ──
function buildRows() {
  const rows = Object.fromEntries(TABLES.map((t) => [t, []]))
  for (const c of SAMPLE_CASES) {
    const risk = analyseCase(c).risk
    const scores = new Map(c.wallets.map((w) => {
      const s = risk.get(w.address)?.score
      return [w.address, s == null ? null : Math.round(s)]
    }))
    const r = caseToRows(c, scores)
    for (const t of TABLES) rows[t].push(...r[t])
  }
  return rows
}

function validate(rows) {
  const problems = []
  const seen = new Set()
  for (const t of TABLES) for (const r of rows[t]) {
    if (!UUID.test(r.id)) problems.push(`${t}: invalid id ${r.id}`)
    if (seen.has(r.id)) problems.push(`${t}: duplicate id ${r.id}`)
    seen.add(r.id)
  }
  const caseIds = new Set(rows.cases.map((r) => r.id))
  const walletIds = new Set(rows.wallets.map((r) => r.id))
  const walletAddr = new Set(rows.wallets.map((r) => `${r.case_id}:${r.address.toLowerCase()}`))
  for (const t of TABLES.slice(1)) for (const r of rows[t]) if (!caseIds.has(r.case_id)) problems.push(`${t} ${r.id}: unknown case_id`)
  for (const r of rows.transactions) {
    for (const a of [r.from_address, r.to_address]) if (!walletAddr.has(`${r.case_id}:${a.toLowerCase()}`)) problems.push(`transaction ${r.tx_hash}: address ${a} has no wallet row`)
    if (!Number.isFinite(r.amount) || !Number.isFinite(r.usd_value)) problems.push(`transaction ${r.tx_hash}: non-numeric amount`)
    if (!r.block_timestamp) problems.push(`transaction ${r.tx_hash}: missing timestamp`)
  }
  for (const r of rows.osint_evidence) if (!walletIds.has(r.wallet_id)) problems.push(`osint_evidence ${r.title}: wallet_id not found`)
  const clusterCase = new Map(rows.wallet_clusters.map((r) => [r.id, r.case_id]))
  const walletCase = new Map(rows.wallets.map((r) => [r.id, r.case_id]))
  const pairs = new Set()
  for (const r of rows.wallet_cluster_members) {
    if (clusterCase.get(r.cluster_id) !== r.case_id) problems.push(`wallet_cluster_members ${r.id}: cluster not in the same case`)
    if (walletCase.get(r.wallet_id) !== r.case_id) problems.push(`wallet_cluster_members ${r.id}: wallet not in the same case`)
    if (pairs.has(r.cluster_id + r.wallet_id)) problems.push(`wallet_cluster_members ${r.id}: duplicate cluster/wallet pair`)
    pairs.add(r.cluster_id + r.wallet_id)
  }
  const hashes = rows.transactions.map((r) => r.tx_hash)
  if (new Set(hashes).size !== hashes.length) problems.push('transactions: duplicate tx_hash values')
  for (const r of rows.wallets) if (r.risk_score != null && !Number.isInteger(r.risk_score)) problems.push(`wallet ${r.address}: risk_score not an integer`)
  return problems
}

// Idempotent SQL equivalent of the upserts: INSERT ... ON CONFLICT (id) DO UPDATE, in one transaction.
// Touches only the rows listed (the sample cases' own rows); deletes nothing.
function toSql(rows) {
  const lit = (v) => v == null ? 'null' : typeof v === 'boolean' ? String(v) : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
  const out = [
    '-- GhostTrace fictional sample investigations (generated by `node import-sample-data.js --sql`; do not edit by hand).',
    '-- Not live blockchain data. Rerunnable: rows have fixed ids and are upserted; nothing is deleted.',
    'begin;',
  ]
  for (const t of TABLES) {
    if (!rows[t].length) continue
    const cols = Object.keys(rows[t][0])
    out.push('', `insert into public.${t} (${cols.join(', ')}) values`)
    out.push(rows[t].map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n'))
    out.push(`on conflict (id) do update set ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')};`)
  }
  out.push('', 'commit;', '')
  return out.join('\n')
}

async function existingIds(client, table, caseIds) {
  const col = table === 'cases' ? 'id' : 'case_id'
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select('id').in(col, caseIds).order('id').range(from, from + 999)
    if (error) throw Object.assign(new Error(`${table}: ${error.message}`), { code: error.code })
    out.push(...data.map((r) => r.id))
    if (data.length < 1000) return new Set(out)
  }
}

async function plan(client, rows) {
  const caseIds = rows.cases.map((r) => r.id)
  const result = {}
  for (const t of TABLES) {
    let have
    try { have = await existingIds(client, t, caseIds) } catch (e) {
      if (!MISSING_TABLE.has(e.code)) throw e
      result[t] = { missing: true, insert: rows[t].length, update: 0, stale: [] }
      continue
    }
    const want = new Set(rows[t].map((r) => r.id))
    result[t] = {
      insert: rows[t].filter((r) => !have.has(r.id)).length,
      update: rows[t].filter((r) => have.has(r.id)).length,
      stale: [...have].filter((id) => !want.has(id)),
    }
  }
  return result
}

function printPlan(p, heading) {
  console.log(`\n${heading}`)
  for (const t of TABLES) console.log(`  ${t.padEnd(23)} insert ${String(p[t].insert).padStart(3)}   update ${String(p[t].update).padStart(3)}   stale ${String(p[t].stale.length).padStart(3)}${p[t].missing ? '   (table does not exist yet: run supabase/cluster-members.sql)' : ''}`)
}

async function main() {
  console.log(`GhostTrace sample import → ${new URL(url).host}${DRY ? '  (dry run, no writes)' : ''}`)
  console.log('Data: bundled FICTIONAL sample investigations (not live blockchain data):')
  for (const c of SAMPLE_CASES) console.log(`  ${c.id}  ${c.title}  →  case uuid ${ids.case(c.id)}`)

  const rows = buildRows()
  const problems = validate(rows)
  if (problems.length) fail('Row validation failed:\n  ' + problems.join('\n  '))
  console.log('\nRows built and validated: ' + TABLES.map((t) => `${t} ${rows[t].length}`).join(', '))
  if (SQL_OUT) {
    writeFileSync(SQL_OUT, toSql(rows))
    console.log(`\nWrote ${SQL_OUT}. Paste it into Supabase → SQL Editor and run it, then check with: node import-sample-data.js --dry-run`)
    return
  }

  // Warn about sample cases with the same title under a different id (for example a manual earlier import).
  const { data: sameTitle, error: e1 } = await reader.from('cases').select('id, title').eq('is_sample', true).in('title', rows.cases.map((r) => r.title))
  if (e1) fail(`Could not read the cases table: ${e1.message}`)
  const ours = new Set(rows.cases.map((r) => r.id))
  for (const r of sameTitle.filter((x) => !ours.has(x.id))) console.warn(`⚠ Existing case "${r.title}" (${r.id}) has the same title but a different id. It is left untouched; delete it manually if it is an old duplicate.`)

  const before = await plan(reader, rows)
  printPlan(before, DRY && !secretKey ? 'Plan (existing rows as visible to the publishable key / RLS):' : 'Plan:')
  if (DRY) { console.log('\nDry run complete. Nothing was written.'); return }
  const missingTables = TABLES.filter((t) => before[t].missing)
  if (missingTables.length) fail(`Table(s) ${missingTables.join(', ')} do not exist. Run supabase/cluster-members.sql in the Supabase SQL Editor first. Nothing was written.`)

  for (const t of TABLES) {
    for (let i = 0; i < rows[t].length; i += 500) {
      const { error } = await writer.from(t).upsert(rows[t].slice(i, i + 500), { onConflict: 'id' })
      if (error) fail(`Upsert into ${t} failed: ${error.message}${error.hint ? `\n  hint: ${error.hint}` : ''}${error.code === '42501' ? '\n  The secret key role lacks table privileges; see supabase/rls-policies.sql (GRANT ... TO service_role).' : ''}`)
    }
    console.log(`  ✓ upserted ${rows[t].length} ${t}`)
  }

  if (PRUNE) {
    for (const t of [...TABLES].reverse()) {
      const stale = before[t].stale
      if (!stale.length) continue
      const { error } = await writer.from(t).delete().in('id', stale)
      if (error) fail(`Prune of ${t} failed: ${error.message}`)
      console.log(`  ✓ pruned ${stale.length} stale ${t} rows`)
    }
  } else if (TABLES.some((t) => before[t].stale.length)) {
    console.log('  ℹ Some rows in the sample cases are not part of the dataset (listed as stale). Rerun with --prune to delete them.')
  }

  // ── verify ──
  const after = await plan(reader, rows)
  const missing = TABLES.filter((t) => after[t].insert > 0)
  if (missing.length) fail(`Verification failed: rows still missing in ${missing.join(', ')}`)
  console.log('\nVerified with the secret key: every sample row is present.')

  if (publicClient) {
    const pub = await plan(publicClient, rows)
    const hidden = TABLES.filter((t) => pub[t].insert > 0).map((t) => `${t} (${pub[t].insert} hidden)`)
    if (hidden.length) {
      console.warn(`⚠ The publishable key cannot read all sample rows: ${hidden.join(', ')}.\n  The frontend will fall back to bundled data for those. Apply supabase/rls-policies.sql in the SQL editor.`)
      process.exitCode = 2
    } else {
      console.log('Verified with the publishable key: RLS exposes every sample row to the frontend.')
    }
  }
}

main().catch((e) => fail(e.message))
