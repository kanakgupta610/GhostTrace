// One-time migration of locally stored evidence (server/data/*.json) into Supabase public.evidence_records.
//
//   node server/migrate-evidence.js                 dry run: shows what would be inserted, writes nothing
//   node server/migrate-evidence.js --apply         insert records whose key is not yet in Supabase
//   options: --skip-manual (external records only) · --file <path> (extra source file)
//
// Safe by design: inserts only missing keys (never updates or deletes Supabase rows), never modifies or
// deletes the local files, keeps original retrieval times. Requires SUPABASE_SECRET_KEY (server-side).
import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { toRow } from './evidenceStore.js'

export async function migrate({ files, apply = false, skipManual = false, url, key, log = console.log }) {
  if (!url || !key) throw new Error('SUPABASE_SECRET_KEY and the Supabase URL must be set on the server to migrate evidence.')
  const byKey = new Map(), seen = []
  for (const f of files) {
    let list
    try { list = JSON.parse(await readFile(f, 'utf8')) } catch (e) { if (e.code === 'ENOENT') { log(`  ${f}: not found, skipped`); continue } throw new Error(`${f}: ${e.message}`) }
    if (!Array.isArray(list)) throw new Error(`${f}: expected a JSON array`)
    let n = 0
    for (const r of list) {
      if (!r?.key || !r.title || !r.source) continue
      const rec = { origin: 'external', ...r }
      const prev = byKey.get(rec.key)
      // the same record in two files: merge, keeping the earliest first-retrieval time
      const first = [prev?.firstRetrievedAt, rec.firstRetrievedAt].filter(Number.isFinite)
      byKey.set(rec.key, { ...prev, ...rec, ...(first.length ? { firstRetrievedAt: Math.min(...first) } : {}) })
      n++
    }
    seen.push(`${f}: ${n} records`)
  }
  seen.forEach((x) => log('  ' + x))
  let records = [...byKey.values()]
  const manual = records.filter((r) => r.origin === 'manual')
  if (skipManual) records = records.filter((r) => r.origin !== 'manual')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).from('evidence_records')
  const existing = new Set()
  const keys = records.map((r) => r.key)
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await db.select('dedupe_key').in('dedupe_key', keys.slice(i, i + 100))
    if (error) throw new Error(`Supabase read failed: ${error.message}${error.code === 'PGRST205' ? ' (apply supabase/evidence-records.sql first)' : ''}`)
    data.forEach((x) => existing.add(x.dedupe_key))
  }
  const missing = records.filter((r) => !existing.has(r.key))
  log(`  unique records: ${byKey.size} (${manual.length} manual${skipManual ? ', skipped' : ''}) · already in Supabase: ${records.length - missing.length} · to insert: ${missing.length}`)
  if (!apply || !missing.length) return { unique: byKey.size, existing: records.length - missing.length, inserted: 0, toInsert: missing.length, manualSkipped: skipManual ? manual.length : 0 }
  let inserted = 0
  for (let i = 0; i < missing.length; i += 100) {
    const { error } = await db.insert(missing.slice(i, i + 100).map(toRow), { defaultToNull: false })
    if (error) throw new Error(`Supabase insert failed after ${inserted} records: ${error.message}`)
    inserted += Math.min(100, missing.length - i)
  }
  const { data: check, error: e2 } = await db.select('dedupe_key').in('dedupe_key', missing.map((r) => r.key).slice(0, 100))
  if (e2) throw new Error(`Verification read failed: ${e2.message}`)
  log(`  inserted ${inserted}; verified ${check.length} of the first ${Math.min(100, missing.length)} present in Supabase`)
  return { unique: byKey.size, existing: records.length - missing.length, inserted, verified: check.length, manualSkipped: skipManual ? manual.length : 0 }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config({ path: '.env.local', quiet: true }); dotenv.config({ path: '.env', quiet: true })
  const args = process.argv.slice(2)
  const extra = args.includes('--file') ? [args[args.indexOf('--file') + 1]] : []
  const files = ['server/data/evidence-store.json', 'server/data/osint-store.json', ...extra]
  console.log(`Evidence migration → Supabase${args.includes('--apply') ? '' : ' (dry run; add --apply to write)'}`)
  migrate({ files, apply: args.includes('--apply'), skipManual: args.includes('--skip-manual'), url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY })
    .then((r) => console.log('Done:', JSON.stringify(r)))
    .catch((e) => { console.error('✖', e.message); process.exit(1) })
}
