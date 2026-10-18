import { supabase, isSupabaseConfigured } from './supabase.js'
import { rowsToCase } from './supabaseMapping.js'

const PAGE = 1000 // PostgREST returns at most 1000 rows per request by default
const TIMEOUT_MS = 10000

const isMissingTable = (e) => e && (e.code === 'PGRST205' || e.code === '42P01')

async function fetchAll(table, columns, caseIds, signal) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns)
      .in('case_id', caseIds).order('id').range(from, from + PAGE - 1).abortSignal(signal)
    if (error) throw Object.assign(new Error(`${table}: ${error.message}`), { code: error.code })
    out.push(...data)
    if (data.length < PAGE) return out
  }
}

// Loads every case flagged is_sample (the only rows the public RLS policies expose) with
// its wallets, transfers, OSINT evidence, clusters and cluster members, converted to the in-app case model.
// `samples` are the bundled sample cases, used to fill fields the schema does not store.
// Resolves to { cases, skipped } or throws; the caller keeps the bundled cases on failure.
export async function loadCasesFromSupabase(samples) {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing)')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const { data: caseRows, error } = await supabase.from('cases')
      .select('id, title, description, chain, status, priority, is_sample, created_at')
      .eq('is_sample', true).order('created_at').abortSignal(ctl.signal)
    if (error) throw new Error(`cases: ${error.message}`)
    if (!caseRows.length) return { cases: [], skipped: [] }

    const caseIds = caseRows.map((c) => c.id)
    const [wallets, transactions, osint, clusters, members] = await Promise.all([
      fetchAll('wallets', 'id, case_id, address, label, category, risk_score, created_at', caseIds, ctl.signal),
      fetchAll('transactions', 'id, case_id, chain, tx_hash, from_address, to_address, asset, amount, usd_value, block_timestamp, created_at', caseIds, ctl.signal),
      fetchAll('osint_evidence', 'id, case_id, wallet_id, title, source_url, publisher, published_at, collected_at, confidence, identifier, evidence_text', caseIds, ctl.signal),
      fetchAll('wallet_clusters', 'id, case_id, name, description, method, created_at', caseIds, ctl.signal),
      // until supabase/cluster-members.sql has been applied, membership falls back to the bundled sample record
      fetchAll('wallet_cluster_members', 'id, case_id, cluster_id, wallet_id', caseIds, ctl.signal).catch((e) => {
        if (!isMissingTable(e)) throw e
        console.info('[GhostTrace] wallet_cluster_members table not found; using bundled cluster membership for sample cases.')
        return null
      }),
    ])
    const by = (rows, id) => rows.filter((r) => r.case_id === id)
    const loadedAt = Date.now()
    const cases = [], skipped = []
    for (const caseRow of caseRows) {
      const c = rowsToCase({
        caseRow, wallets: by(wallets, caseRow.id), transactions: by(transactions, caseRow.id),
        osint: by(osint, caseRow.id), clusters: by(clusters, caseRow.id), members: members && by(members, caseRow.id),
      }, samples, loadedAt)
      if (c) cases.push(c); else skipped.push(caseRow.title || caseRow.id)
    }
    return { cases, skipped }
  } catch (e) {
    if (ctl.signal.aborted) throw new Error(`Supabase did not answer within ${TIMEOUT_MS / 1000}s`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}
