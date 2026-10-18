import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutDashboard, FolderSearch, Waypoints, FileSearch, ShieldAlert, FileText, Search, RefreshCw, Settings, Ghost, Plus, Wallet, ArrowLeftRight, FlaskConical } from 'lucide-react'
import { useApp, JOURNEY } from './store.jsx'
import { Toast, Modal, CatDot, Risk, TipLayer } from './components/common.jsx'
import Hero from './sections/Hero.jsx'
import { ScanBeam, useCardSpotlight } from './components/Motion.jsx'
import Overview from './sections/Overview.jsx'
import Investigations, { CreateCase } from './sections/Investigations.jsx'
import GraphWorkspace from './sections/GraphWorkspace.jsx'
import Osint from './sections/Osint.jsx'
import RiskAnalytics from './sections/Risk.jsx'
import Reports from './sections/Reports.jsx'
import Transactions from './sections/Transactions.jsx'
import EvidenceForm from './components/EvidenceForm.jsx'
import { short, fmtAmt } from './lib/analysis.js'
import { fmtTime, isAddress, isTxHash } from './lib/util.js'

const NAV_GROUPS = [
  { label: 'Investigate', items: [
    { id: 'graph', label: 'Graph', tip: 'Follow funds between wallets', icon: Waypoints },
    { id: 'transactions', label: 'Transactions', tip: 'Every transfer in time order', icon: ArrowLeftRight },
    { id: 'osint', label: 'OSINT Evidence', tip: 'Public-source (OSINT) and manually entered evidence linked to wallets', icon: FileSearch },
  ] },
  { label: 'Analyse', items: [
    { id: 'risk', label: 'Risk', tip: 'Why wallets were flagged', icon: ShieldAlert },
  ] },
  { label: 'Case', items: [
    { id: 'overview', label: 'Overview', tip: 'Headline numbers and walkthrough', icon: LayoutDashboard },
    { id: 'investigations', label: 'Cases', tip: 'Open or create a case', icon: FolderSearch },
    { id: 'reports', label: 'Reports', tip: 'Export a case report', icon: FileText },
  ] },
]
const NAV = NAV_GROUPS.flatMap((g) => g.items)

export default function App() {
  const { section, setSection, active, cases, setActiveId, refresh, refreshing, dataSource, lastRefresh, db, journey, setSelection, evidenceForm, closeEvidenceForm } = useApp()
  const liveHost = active.live && active.liveSource ? new URL(active.liveSource).host : null
  const fromDb = !liveHost && !dataSource.url && db.state === 'ok' && db.count > 0
  const [settings, setSettings] = useState(false)
  const [createFor, setCreateFor] = useState(null)
  useCardSpotlight()
  const done = JOURNEY.filter((j) => journey[j.id]).length
  const Section = { overview: Overview, investigations: Investigations, graph: GraphWorkspace, transactions: Transactions, osint: Osint, risk: RiskAnalytics, reports: Reports }[section]

  if (section === 'hero') return <><Hero /><Toast /></>

  return (
    <div className="app app-enter">
      <div className="atmo" aria-hidden="true" />
      <nav className="rail" aria-label="Sections">
        <button className="brand linkish" onClick={() => setSection('hero')} data-tip="Replay the intro"><div className="brand-mark"><Ghost size={17} /></div><div><div className="brand-name">GHOSTTRACE</div><div className="brand-sub">Investigation platform</div></div></button>
        {NAV_GROUPS.map((g) => (
          <div className="nav-group" key={g.label}>
            <div className="nav-group-label">{g.label}</div>
            {g.items.map((n) => (
              <button key={n.id} className={`nav-item ${section === n.id ? 'on' : ''}`} onClick={() => setSection(n.id)} aria-current={section === n.id ? 'page' : undefined} data-tip={n.tip}>
                <n.icon size={17} /><span>{n.label}</span>{n.id === 'osint' && active.osint.length > 0 && <span className="n" style={{ marginLeft: 'auto', width: 'auto' }}>{active.osint.length}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="rail-foot">
          <div className="stack" style={{ gap: 6, padding: '0 4px' }}>
            <div className="spread" style={{ fontSize: 12 }}><span className="dim">Investigation journey</span><span className="num">{done}/6</span></div>
            <div className="j-progress"><div style={{ width: `${(done / 6) * 100}%` }} /></div>
          </div>
          {active.sample && <div className="sample-flag" data-tip={active.source === 'supabase' ? 'Loaded from Supabase. These cases use fictional protocols, addresses and sources; they are not live blockchain data.' : 'Cases use fictional protocols, addresses and sources so the full workflow runs before a backend is connected.'}><FlaskConical size={12} style={{ verticalAlign: -2 }} /> <b>Sample dataset</b></div>}
        </div>
      </nav>

      <header className="topbar">
        <div className="case-chip">
          <span className="eyebrow" style={{ fontSize: 10 }}>Case</span>
          <select aria-label="Active case" value={active.id} onChange={(e) => { setActiveId(e.target.value); setSelection(null) }}>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.title}</option>)}
          </select>
        </div>
        <GlobalSearch onCreate={(a) => setCreateFor(a)} />
        <div className="top-actions">
          <button className={`source-pill ${liveHost || (dataSource.url && lastRefresh?.ok) || fromDb ? 'live' : ''}`} onClick={() => setSettings(true)} title={lastRefresh ? `Last refresh ${fmtTime(lastRefresh.at)}` : db.at ? `Loaded ${fmtTime(db.at)}` : 'No refresh yet'}>
            <span className="dot" />{liveHost ? `${liveHost} · live Ethereum` : dataSource.url ? new URL(dataSource.url).host : fromDb ? 'Supabase · sample data' : 'Sample dataset'}
          </button>
          <button className="btn sm" onClick={() => refresh()} disabled={refreshing} title="Update the active case from the connected source"><RefreshCw size={13} className={refreshing ? 'spin' : ''} />Refresh</button>
          <button className="btn sm icon" onClick={() => setSettings(true)} aria-label="Data source settings"><Settings size={14} /></button>
        </div>
      </header>

      <nav className="mobile-nav" aria-label="Sections">
        {NAV.map((n) => <button key={n.id} className={`nav-item ${section === n.id ? 'on' : ''}`} onClick={() => setSection(n.id)}><n.icon size={15} />{n.label}</button>)}
      </nav>

      <main className="main" id="main"><ScanBeam trigger={section + active.id} />{Section && <Section key={section} />}</main>
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      {createFor != null && <CreateCase initialAddress={createFor} onClose={() => setCreateFor(null)} />}
      {evidenceForm && <EvidenceForm initialCase={evidenceForm.caseRef} initialWallet={evidenceForm.wallet} onClose={closeEvidenceForm} />}
      <Toast />
      <TipLayer />
    </div>
  )
}

function GlobalSearch({ onCreate }) {
  const { cases, analysisFor, openCase, setSection, setSelection } = useApp()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)
  const input = useRef(null)
  useEffect(() => {
    const k = (e) => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); input.current?.focus() } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    const out = []
    for (const c of cases) {
      if (c.id.toLowerCase().includes(s) || c.title.toLowerCase().includes(s)) out.push({ kind: 'Cases', key: 'c' + c.id, title: c.title, sub: `${c.id} · ${c.status}`, icon: FolderSearch, go: () => openCase(c.id, 'graph') })
    }
    for (const c of cases) {
      const a = analysisFor(c)
      for (const w of c.wallets) {
        if (w.address.toLowerCase().includes(s) || w.label.toLowerCase().includes(s)) out.push({ kind: 'Wallets', key: c.id + w.address, title: w.label, sub: `${short(w.address, 8)} · ${c.id}`, cat: w.category, r: a.risk.get(w.address), go: () => openCase(c.id, 'graph', w.address) })
      }
      for (const t of c.txs) if (s.length >= 6 && t.hash.toLowerCase().startsWith(s)) out.push({ kind: 'Transfers', key: t.id, title: `${fmtAmt(t.amount)} ${t.asset}`, sub: `${short(t.hash, 10)} · ${c.id}`, icon: ArrowLeftRight, go: () => { openCase(c.id, 'graph'); setTimeout(() => setSelection({ type: 'tx', id: t.id, focus: true }), 0) } })
      for (const o of c.osint) if (o.id.toLowerCase().includes(s) || o.title.toLowerCase().includes(s)) out.push({ kind: 'OSINT', key: c.id + o.id, title: o.title, sub: `${o.id} · ${o.sourceType}`, icon: FileSearch, go: () => { openCase(c.id, 'osint'); setTimeout(() => setSection('osint', o.id), 0) } })
    }
    if (isAddress(q) && !out.some((r) => r.kind === 'Wallets')) out.push({ kind: 'Not in loaded data', key: 'new', title: 'Start an investigation for this address', sub: short(q.trim(), 10), icon: Plus, go: () => onCreate(q.trim()) })
    if (isTxHash(q) && !out.length) out.push({ kind: 'Not in loaded data', key: 'nt', title: 'Transaction not found in loaded cases', sub: 'Connect a data source to look up live transactions', icon: ArrowLeftRight, go: () => {} })
    return out.slice(0, 14)
  }, [q, cases, analysisFor, openCase, setSection, setSelection, onCreate])

  const pick = (r) => { r.go(); setQ(''); setOpen(false); input.current?.blur() }
  let lastKind = null
  return (
    <div className="search">
      <Search size={15} />
      <input ref={input} id="global-search" value={q} placeholder="Search a wallet address, label, case, tx hash or finding   ( / )" aria-label="Search"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHl(0) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, results.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)) }
          if (e.key === 'Enter' && results[hl]) pick(results[hl])
          if (e.key === 'Escape') { setOpen(false); input.current?.blur() }
        }} />
      {open && q.trim() && (
        <div className="search-results" role="listbox">
          {!results.length && <div className="empty" style={{ padding: 14 }}>No matches. Paste a full 0x address to start a new investigation.</div>}
          {results.map((r, i) => {
            const head = r.kind !== lastKind ? <div className="sr-group eyebrow">{r.kind}</div> : null
            lastKind = r.kind
            return (
              <div key={r.key}>{head}
                <button className={`sr-item ${i === hl ? 'hl' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)} onMouseEnter={() => setHl(i)}>
                  {r.cat ? <CatDot cat={r.cat} /> : r.icon ? <r.icon size={14} color="var(--copper)" /> : <Wallet size={14} />}
                  <span style={{ flex: 1, minWidth: 0 }}><div>{r.title}</div><div className="mono">{r.sub}</div></span>
                  {r.r && <Risk r={r.r} showBand={false} />}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SettingsModal({ onClose }) {
  const { dataSource, setDataSource, refresh, lastRefresh, db } = useApp()
  const dbNote = {
    off: 'Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY). Using the bundled sample dataset.',
    loading: 'Loading sample cases from Supabase…',
    ok: db.count ? `Supabase: ${db.count} sample case${db.count > 1 ? 's' : ''} loaded${db.at ? ' ' + fmtTime(db.at) : ''}. Records are fictional demo data, not live blockchain data.` : 'Supabase connected, but it has no sample cases with wallets yet. Using the bundled sample dataset.',
    error: `Supabase unavailable (${db.error}). Using the bundled sample dataset.`,
  }[db.state]
  const [url, setUrl] = useState(dataSource.url)
  const valid = !url || /^https?:\/\/.+/.test(url)
  return (
    <Modal title="Data source" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>GhostTrace runs on the bundled sample dataset until a backend is connected. Refresh requests <span className="mono">GET {'{base URL}'}/cases/{'{case id}'}</span> and expects JSON with <span className="mono">wallets[]</span>, <span className="mono">txs[]</span> and optionally <span className="mono">osint[]</span> and <span className="mono">clusters[]</span> in the sample schema.</p>
      <div className="field"><label htmlFor="ds-url">Backend base URL</label><input id="ds-url" className="input mono" placeholder="https://api.your-backend.com" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
      <div className={`note ${db.state === 'error' ? 'warn' : ''}`}>{dbNote}</div>
      {lastRefresh && <div className={`note ${lastRefresh.ok ? '' : 'warn'}`}>Last refresh {fmtTime(lastRefresh.at)}: {lastRefresh.ok ? (lastRefresh.source === 'sample' ? 'sample dataset reloaded' : lastRefresh.source === 'supabase' ? 'reloaded from Supabase' : 'updated from ' + lastRefresh.source) : lastRefresh.error}</div>}
      <div className="note">When GhostTrace runs as a hosted artifact, the browser sandbox may block requests to outside servers. Deploy the project (for example to Vercel) to use a live backend.</div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {dataSource.url && <button className="btn ghost" onClick={() => { setDataSource({ url: '' }); setUrl(''); onClose() }}>Use sample dataset</button>}
        <button className="btn primary" disabled={!valid} onClick={() => { setDataSource({ url: url.trim() }); onClose(); refresh(url.trim()) }}>Save and refresh</button>
      </div>
    </Modal>
  )
}
