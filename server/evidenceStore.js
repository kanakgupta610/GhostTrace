// Evidence persistence (server side). Two backends behind one interface:
//   supabase – table public.evidence_records via the service-role key (SUPABASE_SECRET_KEY). RLS keeps the
//              table closed to the publishable key; the key is only read here and never logged or returned.
//   file     – local JSON file (default server/data/evidence-store.json), used when no key is configured or
//              when Supabase is unreachable / the migration has not been applied (reported in status()).
// Records are deduplicated on `key`.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'

export const toRow = (r) => ({
  dedupe_key: r.key, origin: r.origin, case_ref: r.caseRef || null, wallet_address: r.address || null, source: r.source,
  source_name: r.sourceName || null, source_kind: r.sourceKind || null, source_type: r.sourceType || null, evidence_type: r.evidenceType || null,
  title: r.title, excerpt: r.excerpt || null, url: r.url || null, official_url: r.officialUrl || null, identifies: r.identifies || null,
  confidence: r.confidence || null, verification: r.verification || null,
  published_at: r.published ? new Date(r.published).toISOString() : null, first_retrieved_at: r.firstRetrievedAt ? new Date(r.firstRetrievedAt).toISOString() : null,
  retrieved_at: r.retrievedAt ? new Date(r.retrievedAt).toISOString() : null,
  // omitted when unknown so the column default (now()) applies; created_at is NOT NULL
  ...(r.createdAt ? { created_at: new Date(r.createdAt).toISOString() } : {}),
})
const ms = (v) => (v ? Date.parse(v) : null)
export const fromRow = (x) => ({
  key: x.dedupe_key, origin: x.origin, caseRef: x.case_ref, address: x.wallet_address, source: x.source, sourceName: x.source_name, sourceKind: x.source_kind,
  sourceType: x.source_type, evidenceType: x.evidence_type, title: x.title, excerpt: x.excerpt, url: x.url, officialUrl: x.official_url, identifies: x.identifies,
  confidence: x.confidence, verification: x.verification, published: ms(x.published_at), firstRetrievedAt: ms(x.first_retrieved_at), retrievedAt: ms(x.retrieved_at), createdAt: ms(x.created_at),
})
const matches = (r, { caseRef, addresses }) => (caseRef && r.origin === 'manual' && r.caseRef === caseRef) || (r.address && addresses?.has(r.address))

function fileStore(path, legacyPath) {
  let map = null
  const load = async () => {
    if (map) return map
    map = new Map()
    if (!path) return map
    try { for (const r of JSON.parse(await readFile(path, 'utf8'))) map.set(r.key, r) } catch {
      // first run: import records written by the earlier OSINT-only store, without deleting that file
      if (legacyPath) try { for (const r of JSON.parse(await readFile(legacyPath, 'utf8'))) map.set(r.key, { origin: 'external', ...r }) } catch { /* none */ }
    }
    return map
  }
  const save = async () => {
    if (!path) return
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify([...map.values()], null, 1))
  }
  return {
    kind: path ? 'file' : 'memory',
    async get(key) { return (await load()).get(key) || null },
    async upsert(records) { const m = await load(); for (const r of records) m.set(r.key, { ...(m.get(r.key) || {}), ...r }); await save(); return records },
    async insert(r) { const m = await load(); if (m.has(r.key)) return { duplicate: true, record: m.get(r.key) }; m.set(r.key, r); await save(); return { duplicate: false, record: r } },
    async query(q) { return [...(await load()).values()].filter((r) => matches(r, q)) },
    async remove(key) { const m = await load(); const r = m.get(key); if (!r || r.origin !== 'manual') return false; m.delete(key); await save(); return true },
  }
}

function supabaseStore(url, key) {
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).from('evidence_records')
  const fail = (error, what) => { const e = new Error(`Supabase ${what} failed: ${error.message}`); e.code = error.code; throw e }
  return {
    kind: 'supabase',
    async get(k) { const { data, error } = await db.select('*').eq('dedupe_key', k).maybeSingle(); if (error) fail(error, 'read'); return data ? fromRow(data) : null },
    async upsert(records) {
      if (!records.length) return records
      // defaultToNull: false — columns missing from some rows use their defaults instead of being sent as null
      const { error } = await db.upsert(records.map(toRow), { onConflict: 'dedupe_key', defaultToNull: false }); if (error) fail(error, 'upsert'); return records
    },
    async insert(r) {
      const { data, error } = await db.insert(toRow(r)).select('*').single()
      if (error?.code === '23505') { const prev = await this.get(r.key); return { duplicate: true, record: prev } }
      if (error) fail(error, 'insert')
      return { duplicate: false, record: fromRow(data) }
    },
    async remove(k) {
      const { data, error } = await db.delete().eq('dedupe_key', k).eq('origin', 'manual').select('dedupe_key')
      if (error) fail(error, 'delete'); return data.length > 0
    },
    async query({ caseRef, addresses }) {
      const out = []
      if (caseRef) { const { data, error } = await db.select('*').eq('origin', 'manual').eq('case_ref', caseRef); if (error) fail(error, 'read'); out.push(...data) }
      const list = [...(addresses || [])]
      for (let i = 0; i < list.length; i += 150) {
        const { data, error } = await db.select('*').in('wallet_address', list.slice(i, i + 150)); if (error) fail(error, 'read'); out.push(...data)
      }
      const seen = new Set()
      return out.map(fromRow).filter((r) => !seen.has(r.key) && seen.add(r.key))
    },
  }
}

export function createEvidenceStore(env = process.env) {
  const path = env.EVIDENCE_STORE_PATH === 'off' ? null : env.EVIDENCE_STORE_PATH || 'server/data/evidence-store.json'
  const local = fileStore(path, env.EVIDENCE_STORE_PATH ? null : 'server/data/osint-store.json')
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  const remote = url && key ? supabaseStore(url, key) : null
  let degraded = null // last Supabase error, if any
  const MISSING_TABLE = new Set(['PGRST205', '42P01'])
  const run = async (op, ...args) => {
    if (remote) {
      try { const r = await remote[op](...args); degraded = null; return r } catch (e) {
        degraded = MISSING_TABLE.has(e.code) ? 'table evidence_records not found: apply supabase/evidence-records.sql' : e.message
        console.warn(`[ghosttrace-evidence] ${degraded}; using the local ${local.kind} store`)
      }
    }
    return local[op](...args)
  }
  return {
    status: () => remote
      ? (degraded ? { backend: local.kind, persistent: local.kind === 'file', detail: `Supabase configured but unavailable (${degraded}); saving to the local ${local.kind} store.` } : { backend: 'supabase', persistent: true, detail: 'Supabase table evidence_records (server-side key; not readable with the publishable key).' })
      : { backend: local.kind, persistent: local.kind === 'file', detail: `SUPABASE_SECRET_KEY is not set on the server, so evidence is saved to ${path ? 'a local file' : 'memory only'}. Set it to persist evidence in Supabase.` },
    get: (k) => run('get', k), upsert: (rs) => run('upsert', rs), insert: (r) => run('insert', r), query: (q) => run('query', q),
    // deletes go to the active backend only (no silent fallback that would leave the Supabase row in place)
    remove: (k) => (remote ? remote.remove(k) : local.remove(k)),
  }
}
