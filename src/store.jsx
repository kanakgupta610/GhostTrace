import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { SAMPLE_CASES } from './data/cases.js'
import { analyseCase, DUST_USD } from './lib/analysis.js'
import { store, isAddress } from './lib/util.js'
import { isSupabaseConfigured } from './lib/supabase.js'
import { loadCasesFromSupabase } from './lib/supabaseData.js'

const Ctx = createContext(null)

// Live Ethereum backend (server/index.js) used for cases created from a real address. In development it
// defaults to the local server; set VITE_LIVE_API_URL for a deployed one. Settings → Data source overrides it.
const DEFAULT_LIVE_API = import.meta.env.VITE_LIVE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787/api' : '')
const isLiveCapable = (c) => !!(c && c.userCreated && !c.sample && c.seed)
export const useApp = () => useContext(Ctx)

export const JOURNEY = [
  { id: 'opened', label: 'Open a prepared attack case' },
  { id: 'graph', label: 'View the transaction network' },
  { id: 'selected', label: 'Select a suspicious wallet' },
  { id: 'evidence', label: 'Review its transfers and OSINT evidence' },
  { id: 'risk', label: 'Explore the risk explanation' },
  { id: 'exported', label: 'Export the investigation report' },
]

const defaultFilters = (c) => {
  const times = c.txs.map((t) => t.ts)
  return {
    minUsd: 0, from: times.length ? Math.min(...times) : 0, to: times.length ? Math.max(...times) : 0,
    assets: [...new Set(c.txs.map((t) => t.asset))], hideDust: true, taintedOnly: false, showClusters: false, showAmounts: true,
  }
}

// Build a new case seeded from an address: if the address exists in a loaded case,
// import its 2-hop neighbourhood; otherwise start an empty case awaiting a data source.
function buildUserCase({ title, chain, seed, notes }, allCases) {
  const id = `GT-2026-${String(100 + Math.floor(Math.random() * 900))}`
  const now = Date.now()
  const base = { id, title: title || `Investigation of ${seed.slice(0, 10)}…`, chain: chain || 'Ethereum', status: 'Active', priority: 'Medium', owner: 'You',
    createdAt: now, updatedAt: now, sample: false, userCreated: true, summary: notes || 'Created from the Investigations section.',
    activity: [{ ts: now, text: 'Case created', kind: 'case' }], clusters: [], osint: [] }
  const src = allCases.find((c) => c.wallets.some((w) => w.address.toLowerCase() === seed.toLowerCase()))
  if (!src) {
    return { ...base, wallets: [{ address: seed, chain: base.chain, label: 'Seed wallet', category: 'unknown', tags: ['Seed'], externalInflowUsd: 0, firstSeen: null }],
      txs: [], seed, primarySuspect: seed, taintSources: [], attackStart: now, initialVisible: [seed], importedFrom: null }
  }
  const s = src.wallets.find((w) => w.address.toLowerCase() === seed.toLowerCase()).address
  const keep = new Set([s])
  for (let i = 0; i < 2; i++) for (const t of src.txs) { if (keep.has(t.from) || keep.has(t.to)) { keep.add(t.from); keep.add(t.to) } }
  const txs = src.txs.filter((t) => keep.has(t.from) && keep.has(t.to))
  const taintSources = src.taintSources.filter((a) => keep.has(a))
  return {
    ...base, sample: true, importedFrom: src.id,
    summary: (notes ? notes + ' ' : '') + `Seeded from ${src.id}: ${keep.size} wallets within two hops of the seed address were imported.`,
    wallets: src.wallets.filter((w) => keep.has(w.address)), txs,
    osint: src.osint.filter((o) => o.matches.some((m) => keep.has(m.address))),
    clusters: src.clusters.map((c) => ({ ...c, members: c.members.filter((m) => keep.has(m)) })).filter((c) => c.members.length > 1),
    seed: s, primarySuspect: keep.has(src.primarySuspect) ? src.primarySuspect : s,
    taintSources, attackStart: src.attackStart, initialVisible: [...keep],
    activity: [{ ts: now, text: `Case created and seeded from ${src.id}`, kind: 'case' }],
  }
}

export function AppProvider({ children }) {
  const [userCases, setUserCases] = useState(() => store.get('userCases', []))
  const [overrides, setOverrides] = useState(() => store.get('caseOverrides', {}))
  const [refreshed, setRefreshed] = useState({}) // case id -> case replaced by live source
  // Cases read from Supabase. A database copy of a bundled sample case replaces it (same id);
  // other database cases are appended. Until the load succeeds, the bundled cases are shown.
  const [dbCases, setDbCases] = useState([])
  const [db, setDb] = useState({ state: isSupabaseConfigured ? 'loading' : 'off', at: null, error: null, count: 0 })
  const baseCases = useMemo(() => {
    const byId = new Map(dbCases.map((c) => [c.id, c]))
    return [...SAMPLE_CASES.map((s) => byId.get(s.id) || s), ...dbCases.filter((c) => !SAMPLE_CASES.some((s) => s.id === c.id))]
  }, [dbCases])
  // manually entered evidence per case, loaded from the backend evidence store (server/evidenceStore.js)
  const [manual, setManual] = useState({}) // case id -> findings
  const cases = useMemo(() => [...baseCases, ...userCases].map((c) => {
    const r = refreshed[c.id] || c
    const o = overrides[c.id] || {}
    const extra = (manual[c.id] || []).filter((m) => !r.osint.some((x) => x.id === m.id))
    return { ...r, osint: extra.length ? [...r.osint, ...extra] : r.osint, status: o.status || r.status, notes: o.notes || [], activity: [...(o.activity || []), ...r.activity].sort((a, b) => b.ts - a.ts) }
  }), [baseCases, userCases, overrides, refreshed, manual])

  const [activeId, setActiveId] = useState(() => store.get('activeCase', SAMPLE_CASES[0].id))
  const active = cases.find((c) => c.id === activeId) || cases[0]

  const analysisCache = useRef(new Map())
  const analysisFor = useCallback((c) => {
    const key = c.id + ':' + c.txs.length + ':' + (c.dataVersion || '') + ':' + (refreshed[c.id] ? 'r' : '') + ':' + c.osint.length
    if (!analysisCache.current.has(key)) analysisCache.current.set(key, analyseCase(c))
    return analysisCache.current.get(key)
  }, [refreshed])
  const analysis = useMemo(() => analysisFor(active), [active, analysisFor])

  const [section, setSectionRaw] = useState(() => {
    const h = (typeof location !== 'undefined' && location.hash.slice(1)) || ''
    return ['hero', 'overview', 'investigations', 'graph', 'transactions', 'osint', 'risk', 'reports'].includes(h) ? h : 'hero'
  })
  const [focus, setFocus] = useState(null) // e.g. an OSINT finding id to open on arrival
  const [sub, setSub] = useState(null) // sub-page within a section (risk tab, evidence detail, case detail)
  const setSection = useCallback((s, f = null, sb = null) => { setSectionRaw(s); setFocus(f); setSub(sb); try { history.replaceState(null, '', '#' + s) } catch { /* sandboxed */ } }, [])

  const [selection, setSelection] = useState(null) // {type:'wallet'|'tx'|'cluster', id}
  const [graphState, setGraphState] = useState({}) // caseId -> {visible:[], filters, highlight}
  const gs = useMemo(() => graphState[active.id] || { visible: active.initialVisible, filters: defaultFilters(active), highlight: null }, [graphState, active])
  const updateGraph = useCallback((patch, caseId) => setGraphState((g) => {
    const cid = caseId || active.id
    const cc = cases.find((x) => x.id === cid) || active
    const cur = g[cid] || { visible: cc.initialVisible, filters: defaultFilters(cc), highlight: null }
    const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch }
    return { ...g, [cid]: next }
  }), [active, cases])

  const [replay, setReplay] = useState(null) // { i: index into time-sorted transfers, playing }
  const [reveal, setReveal] = useState(null) // { wallet, stage 0..3, auto }
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  useEffect(() => { setReplay(null); setReveal(null) }, [activeId])
  const [panelOpen, setPanelOpen] = useState(true)

  const [journey, setJourney] = useState(() => store.get('journey', {}))
  const tick = useCallback((id) => setJourney((j) => (j[id] ? j : { ...j, [id]: Date.now() })), [])
  useEffect(() => store.set('journey', journey), [journey])
  useEffect(() => store.set('activeCase', activeId), [activeId])
  useEffect(() => store.set('userCases', userCases), [userCases])
  useEffect(() => store.set('caseOverrides', overrides), [overrides])

  const [toast, setToast] = useState(null)
  const notify = useCallback((msg, tone = 'info') => { setToast({ msg, tone, at: Date.now() }) }, [])
  const [drawer, setDrawer] = useState(null)
  const [dataSource, setDataSource] = useState(() => store.get('dataSource', { url: '' }))
  useEffect(() => store.set('dataSource', dataSource), [dataSource])
  const [lastRefresh, setLastRefresh] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  // Load investigations from Supabase. On failure the bundled sample cases stay in place.
  const loadDb = useCallback(async () => {
    if (!isSupabaseConfigured) { setDb({ state: 'off', at: Date.now(), error: null, count: 0 }); return { ok: false, off: true } }
    setDb((d) => ({ ...d, state: 'loading' }))
    try {
      const { cases: loaded, skipped } = await loadCasesFromSupabase(SAMPLE_CASES)
      if (skipped.length) console.info('[GhostTrace] Supabase cases without wallets were not loaded:', skipped)
      analysisCache.current.clear()
      setDbCases(loaded)
      setDb({ state: 'ok', at: Date.now(), error: null, count: loaded.length })
      return { ok: true, count: loaded.length }
    } catch (e) {
      console.warn('[GhostTrace] Supabase load failed, using bundled sample cases:', e.message)
      setDb({ state: 'error', at: Date.now(), error: e.message, count: 0 })
      return { ok: false, error: e.message }
    }
  }, [])
  useEffect(() => { loadDb() }, [loadDb])

  const openCase = useCallback((id, goTo = 'graph', wallet = null) => {
    setActiveId(id); setSection(goTo)
    setSelection(wallet ? { type: 'wallet', id: wallet, tab: 'overview', focus: true } : null)
    if (wallet) updateGraph((g) => ({ ...g, visible: [...new Set([...g.visible, wallet])] }), id)
    const c = cases.find((x) => x.id === id)
    if (c && !c.userCreated) tick('opened')
    if (goTo === 'graph') tick('graph')
    if (c && wallet) { const r = analysisFor(c).risk.get(wallet); if (r?.score != null && r.score >= 40) tick('selected') }
  }, [cases, setSection, tick, updateGraph, analysisFor])

  const selectWallet = useCallback((address, opts = {}) => {
    setSelection({ type: 'wallet', id: address, tab: opts.tab || 'overview', focus: !!(opts.reveal || opts.focus) })
    const r = analysis.risk.get(address)
    if (r && r.score != null && r.score >= 40) tick('selected')
    if (opts.reveal) updateGraph((g) => ({ ...g, visible: [...new Set([...g.visible, address])] }))
  }, [analysis, tick, updateGraph])

  const addNote = useCallback((caseId, text) => setOverrides((o) => {
    const cur = o[caseId] || {}
    return { ...o, [caseId]: { ...cur, activity: [{ ts: Date.now(), text, kind: 'note' }, ...(cur.activity || [])] } }
  }), [])
  const setStatus = useCallback((caseId, status) => setOverrides((o) => {
    const cur = o[caseId] || {}
    return { ...o, [caseId]: { ...cur, status, activity: [{ ts: Date.now(), text: `Status changed to ${status}`, kind: 'case' }, ...(cur.activity || [])] } }
  }), [])

  const createCase = useCallback((form) => {
    const c = buildUserCase(form, cases)
    setUserCases((u) => [...u, c])
    setActiveId(c.id); setSelection({ type: 'wallet', id: c.seed, tab: 'overview' }); setSection('graph')
    notify(c.importedFrom ? `Created ${c.id} with ${c.wallets.length} wallets from ${c.importedFrom}`
      : (dataSource.url || DEFAULT_LIVE_API) ? `Created ${c.id}. Loading live Ethereum data for the seed wallet…` : `Created ${c.id}. No transfers yet; connect a data source and press Refresh.`, 'ok')
    return c
  }, [cases, notify, setSection, dataSource])
  const deleteCase = useCallback((id) => {
    setUserCases((u) => u.filter((c) => c.id !== id))
    if (activeId === id) setActiveId(SAMPLE_CASES[0].id)
  }, [activeId])

  // Public-source evidence for a live case (server/osint.js). Exact address matches only; the result is
  // merged into the case's evidence list and marked as externally sourced.
  const [osintStatus, setOsintStatus] = useState({}) // case id -> { state: loading|ok|partial|error, sources, at, error, found }
  const loadOsint = useCallback(async (caseId, url, data) => {
    const addrs = [data.seed, ...data.wallets.map((w) => w.address).filter((a) => a !== data.seed)].slice(0, 300)
    setOsintStatus((s) => ({ ...s, [caseId]: { state: 'loading' } }))
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/osint?addresses=${addrs.join(',')}&deep=${data.seed}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(45000) })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) throw new Error(body?.error?.message || `Evidence service answered ${res.status}`)
      const down = body.sources.filter((x) => x.status === 'unavailable' || x.status === 'rate_limited')
      setRefreshed((r) => (r[caseId] ? { ...r, [caseId]: { ...r[caseId], osint: body.findings } } : r))
      analysisCache.current.clear()
      setOsintStatus((s) => ({ ...s, [caseId]: { state: down.length ? 'partial' : 'ok', sources: body.sources, at: body.retrievedAt, found: body.findings.length, checked: addrs.length } }))
    } catch (e) {
      setOsintStatus((s) => ({ ...s, [caseId]: { state: 'error', error: e.name === 'TimeoutError' ? 'evidence service did not answer within 45 s' : e.message } }))
    }
  }, [])

  // Fetch one case from a live source (GET {url}/cases/{id}?seed=…) and show it in place of the stored case.
  const loadLive = useCallback(async (c, url, { auto = false } = {}) => {
    setRefreshing(true)
    try {
      const query = c.seed ? `?seed=${encodeURIComponent(c.seed)}&chain=${encodeURIComponent(c.chain || 'Ethereum')}` : ''
      let res
      try {
        res = await fetch(url.replace(/\/$/, '') + '/cases/' + encodeURIComponent(c.id) + query, { headers: { accept: 'application/json' } })
      } catch {
        throw new Error(`could not reach ${new URL(url).host}. Is the live backend running (npm run server)?`)
      }
      if (!res.ok) {
        const msg = await res.json().then((b) => b?.error?.message).catch(() => null)
        throw new Error(msg ? `Source answered ${res.status}: ${msg}` : `Source answered ${res.status}`)
      }
      const data = await res.json()
      if (!Array.isArray(data.wallets) || !Array.isArray(data.txs)) throw new Error('Response is missing wallets[] or txs[]')
      analysisCache.current.clear()
      setRefreshed((r) => ({ ...r, [c.id]: { ...c, ...data, sample: false, liveSource: url } }))
      // the graph's visible set and time filters were derived from the previous data
      setGraphState((g) => { const n = { ...g }; delete n[c.id]; return n })
      setSelection((s) => (s?.type === 'wallet' && !data.wallets.some((w) => w.address === s.id) ? null : s))
      setLastRefresh({ at: Date.now(), source: url, ok: true })
      notify(data.stale ? `${c.id}: live provider unavailable, showing data fetched earlier (${data.fetched?.warnings?.[0] || 'stale cache'})` : `${auto ? 'Loaded' : 'Updated'} ${c.id} from ${new URL(url).host}: ${data.txs.length} transfers${data.live ? ' (live Ethereum mainnet data)' : ''}`, data.stale ? 'warn' : 'ok')
      if (data.live) loadOsint(c.id, url, data)
      return true
    } catch (e) {
      setLastRefresh({ at: Date.now(), source: url, ok: false, error: e.message })
      const limited = /429|rate limit|quota/i.test(e.message)
      notify(`${auto ? 'Live data not loaded' : 'Refresh failed'}: ${e.message}${auto ? '' : ' Still showing the previous data.'}${limited ? ' Try again after the reset; the fictional Halcyon sample case is still available.' : ''}`, 'warn')
      return false
    } finally { setRefreshing(false) }
  }, [notify, loadOsint])

  // Manual evidence: load the active case's saved entries; save new ones through POST /api/evidence.
  const [evidenceState, setEvidenceState] = useState({}) // case id -> { state: loading|ok|error, storage, error }
  const evidenceApi = (dataSource.url || DEFAULT_LIVE_API).replace(/\/$/, '')
  const loadManual = useCallback(async (caseId) => {
    if (!evidenceApi) { setEvidenceState((s) => ({ ...s, [caseId]: { state: 'error', error: 'No evidence backend configured (set VITE_LIVE_API_URL or Settings → Data source).' } })); return }
    setEvidenceState((s) => ({ ...s, [caseId]: { ...(s[caseId] || {}), state: 'loading' } }))
    try {
      const res = await fetch(`${evidenceApi}/evidence?case=${encodeURIComponent(caseId)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) throw new Error(body?.error?.message || `Evidence service answered ${res.status}`)
      setManual((m) => ({ ...m, [caseId]: body.findings.filter((f) => f.origin === 'manual') }))
      analysisCache.current.clear()
      setEvidenceState((s) => ({ ...s, [caseId]: { state: 'ok', storage: body.storage, options: body.options } }))
    } catch (e) {
      setEvidenceState((s) => ({ ...s, [caseId]: { state: 'error', error: e.name === 'TimeoutError' ? 'evidence service did not answer within 15 s' : /fetch/i.test(e.message) ? `could not reach the evidence service at ${evidenceApi} (is npm run server running?)` : e.message } }))
    }
  }, [evidenceApi])
  const manualLoaded = useRef(new Set())
  useEffect(() => { if (!manualLoaded.current.has(active.id)) { manualLoaded.current.add(active.id); loadManual(active.id) } }, [active.id, loadManual])
  // Investigator write token (EVIDENCE_WRITE_TOKEN on the server). Typed in by the investigator and kept
  // only in this browser's storage; never part of the frontend bundle.
  const [writeToken, setWriteTokenRaw] = useState(() => store.get('writeToken', ''))
  const setWriteToken = useCallback((t) => { setWriteTokenRaw(t); store.set('writeToken', t) }, [])
  const authHeaders = useCallback((t) => (t ? { authorization: `Bearer ${t}` } : {}), [])
  const authFailed = (res) => res.status === 401 || res.status === 403
  const removeEvidence = useCallback(async (finding) => {
    if (!writeToken) return { ok: false, auth: true, error: 'enter the investigator write token in the Add Evidence form first' }
    try {
      const res = await fetch(`${evidenceApi}/evidence?key=${encodeURIComponent(finding.key)}`, { method: 'DELETE', headers: { accept: 'application/json', ...authHeaders(writeToken) }, signal: AbortSignal.timeout(15000) })
      const body = await res.json().catch(() => null)
      if (authFailed(res)) setWriteToken('')
      if (!res.ok) return { ok: false, auth: authFailed(res), error: body?.error?.message || `Evidence service answered ${res.status}` }
      setManual((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.filter((x) => x.key !== finding.key)])))
      setLastSaved((l) => (l?.id === finding.id ? null : l))
      analysisCache.current.clear()
      return { ok: true }
    } catch (e) { return { ok: false, error: e.name === 'TimeoutError' ? 'no answer within 15 s' : `could not reach ${evidenceApi}` } }
  }, [evidenceApi, writeToken, authHeaders, setWriteToken])
  const [evidenceForm, setEvidenceForm] = useState(null) // { caseRef, wallet } while the form is open
  const openEvidenceForm = useCallback((opts = {}) => setEvidenceForm({ caseRef: opts.caseRef, wallet: opts.wallet || '' }), [])
  const closeEvidenceForm = useCallback(() => setEvidenceForm(null), [])
  const [lastSaved, setLastSaved] = useState(null) // { id, caseRef, backend }
  const addEvidence = useCallback(async (form, token = writeToken) => {
    if (!evidenceApi) return { ok: false, error: 'No evidence backend configured.' }
    if (!token) return { ok: false, auth: true, error: 'An investigator write token is required.' }
    try {
      const res = await fetch(`${evidenceApi}/evidence`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...authHeaders(token) }, body: JSON.stringify(form), signal: AbortSignal.timeout(15000) })
      const body = await res.json().catch(() => null)
      if (authFailed(res) || res.status === 503) { if (authFailed(res)) setWriteToken(''); return { ok: false, auth: true, error: body?.error?.message || `Evidence service answered ${res.status}` } }
      if (token !== writeToken) setWriteToken(token)
      if (res.status === 409) return { ok: false, duplicate: true, error: body?.error?.message || 'This evidence already exists.' }
      if (!res.ok || !body) return { ok: false, error: body?.error?.message || `Evidence service answered ${res.status}`, fields: body?.error?.fields }
      setManual((m) => ({ ...m, [form.caseRef]: [...(m[form.caseRef] || []), body.finding] }))
      analysisCache.current.clear()
      setEvidenceState((s) => ({ ...s, [form.caseRef]: { ...(s[form.caseRef] || {}), state: 'ok', storage: body.storage } }))
      setLastSaved({ id: body.finding.id, caseRef: form.caseRef, backend: body.storage?.backend })
      return { ok: true, finding: body.finding, storage: body.storage }
    } catch (e) {
      return { ok: false, error: e.name === 'TimeoutError' ? 'The evidence service did not answer within 15 s.' : `Could not reach the evidence service at ${evidenceApi}. Is the backend running (npm run server)?` }
    }
  }, [evidenceApi, writeToken, authHeaders, setWriteToken])

  // Cases created from a real address load their live data when opened (live data is not persisted,
  // so this also restores it after a page reload). One automatic attempt per case per page load.
  const autoLoaded = useRef(new Set())
  useEffect(() => {
    const url = dataSource.url || DEFAULT_LIVE_API
    if (!url || !isLiveCapable(active) || refreshed[active.id] || autoLoaded.current.has(active.id)) return
    autoLoaded.current.add(active.id)
    loadLive(active, url, { auto: true })
  }, [active, refreshed, dataSource, loadLive])

  // Refresh: cases created from a real address are reloaded from the live source; with no custom
  // source configured, sample cases are reloaded from Supabase (or the bundled sample dataset).
  const refresh = useCallback(async (override) => {
    const custom = override ?? dataSource.url
    if (isLiveCapable(active) && (custom || DEFAULT_LIVE_API)) return loadLive(active, custom || DEFAULT_LIVE_API)
    const url = custom
    setRefreshing(true)
    try {
      if (!url) {
        analysisCache.current.clear()
        setRefreshed((r) => { const n = { ...r }; delete n[active.id]; return n })
        const res = await loadDb()
        if (res.ok) {
          setLastRefresh({ at: Date.now(), source: 'supabase', ok: true })
          notify(res.count ? `Reloaded ${res.count} sample case${res.count > 1 ? 's' : ''} from Supabase.` : 'Supabase has no sample cases yet. Showing the bundled sample dataset.', 'info')
        } else {
          setLastRefresh({ at: Date.now(), source: 'sample', ok: true })
          notify(res.off ? 'No live source connected. Sample dataset reloaded and re-analysed.' : `Supabase unavailable (${res.error}). Showing the bundled sample dataset.`, res.off ? 'info' : 'warn')
        }
        return
      }
      // Sample cases use fictional addresses: never mix them with live chain data.
      setLastRefresh({ at: Date.now(), source: url, ok: false, error: 'sample cases are not refreshed from a live source' })
      notify('Sample cases use fictional addresses and are not refreshed from a live source. Create a case from a real Ethereum address to load live data.', 'info')
    } finally { setRefreshing(false) }
  }, [active, dataSource, notify, loadDb, loadLive])

  // visible + filtered edges for the graph and ledger
  const filtered = useMemo(() => {
    const f = gs.filters
    const vis = new Set(gs.visible)
    const txs = active.txs.filter((t) =>
      vis.has(t.from) && vis.has(t.to) &&
      t.usd >= f.minUsd && t.ts >= f.from && t.ts <= f.to && f.assets.includes(t.asset) &&
      !(f.hideDust && t.usd < DUST_USD && t.method !== 'contract creation' && t.method !== 'message') &&
      !(f.taintedOnly && !(analysis.taint.edgeTaint.get(t.id) > 0)))
    return { txs, visible: vis }
  }, [active, gs, analysis])

  const value = {
    replay, setReplay, panelOpen, setPanelOpen, reveal, setReveal, evidenceOpen, setEvidenceOpen,
    cases, active, activeId: active.id, setActiveId, analysis, analysisFor, section, setSection, focus, setFocus, sub, setSub,
    selection, setSelection, selectWallet, gs, updateGraph, filtered, defaultFilters,
    journey, tick, resetJourney: () => setJourney({}), toast, notify, drawer, setDrawer,
    openCase, createCase, deleteCase, addNote, setStatus, dataSource, setDataSource, refresh, refreshing, lastRefresh, db, osintStatus, evidenceState, addEvidence, loadManual, evidenceApi, evidenceForm, openEvidenceForm, closeEvidenceForm, lastSaved, removeEvidence, writeToken, setWriteToken,
    isAddress,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
