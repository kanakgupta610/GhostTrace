import { useMemo } from 'react'
import { FolderSearch, Wallet, ShieldAlert, ArrowUpRight, Play, RotateCcw, Waypoints, FileSearch } from 'lucide-react'
import { useApp, JOURNEY } from '../store.jsx'
import { Decode } from '../components/Motion.jsx'
import { Addr, CatDot, Risk, Drawer, useSort } from '../components/common.jsx'
import { fmtAmt, fmtUsdShort, SERVICE_CATS } from '../lib/analysis.js'
import { fmtTime } from '../lib/util.js'

export default function Overview() {
  const { cases, analysisFor, openCase, setDrawer, drawer, journey, resetJourney, setSection, active } = useApp()
  const live = cases.filter((c) => c.status !== 'Closed')
  const all = useMemo(() => cases.map((c) => ({ c, a: analysisFor(c) })), [cases, analysisFor])

  const flagged = all.flatMap(({ c, a }) => c.wallets.filter((w) => { const r = a.risk.get(w.address); return r.score != null && r.score >= 40 && !SERVICE_CATS.has(w.category) }).map((w) => ({ c, w, r: a.risk.get(w.address) })))
  const funds = all.reduce((s, { c }) => s + c.txs.filter((t) => c.taintSources.includes(t.from) && t.ts >= c.attackStart).reduce((x, t) => x + t.usd, 0), 0)
  const txCount = all.reduce((s, { c }) => s + c.txs.length, 0)
  const osintCount = all.reduce((s, { c }) => s + c.osint.length, 0)
  const patterns = all.flatMap(({ c, a }) => a.patterns.map((p) => ({ ...p, c })))

  const metrics = [
    { k: 'funds', icon: Wallet, label: 'Funds under analysis', v: fmtUsdShort(funds), sub: `Stolen value across ${cases.length} cases` },
    { k: 'flagged', icon: ShieldAlert, label: 'Flagged wallets', v: flagged.length, sub: `${patterns.length} suspicious patterns detected` },
    { k: 'cases', icon: FolderSearch, label: 'Active investigations', v: live.length, sub: `${txCount} transfers · ${osintCount} OSINT findings` },
  ]

  const done = JOURNEY.filter((j) => journey[j.id]).length
  const nextStep = JOURNEY.find((j) => !journey[j.id])
  const go = () => {
    const halcyon = cases[0]
    if (!journey.opened || !journey.graph) return openCase(halcyon.id, 'graph')
    if (nextStep?.id === 'selected' || nextStep?.id === 'evidence') return openCase(active.id, 'graph')
    if (nextStep?.id === 'risk') return setSection('risk')
    if (nextStep?.id === 'exported') return setSection('reports')
    openCase(halcyon.id, 'graph')
  }


  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Overview</div><h1>Investigation <em><Decode text="dashboard" delay={0.25} /></em></h1><p>Three numbers that sum up the case. Click one to see the records behind it.</p></div>
      </div>

      <div className="metrics metrics-3">
        {metrics.map((m) => (
          <button key={m.k} className="metric" onClick={() => setDrawer({ kind: m.k })}>
            <span className="l"><m.icon size={15} color="var(--copper)" />{m.label}</span>
            <span className="v"><Decode text={String(m.v)} delay={0.2} /></span>
            <span className="s">{m.sub}<ArrowUpRight size={14} className="go" /></span>
          </button>
        ))}
      </div>

      <div className="grid g-main overview-lower">
        <div className="card">
          <div className="card-h"><h2>Guided walkthrough</h2><span className="dim num">{done} of 6 done</span></div>
          <div className="card-b stack">
            <p className="muted" style={{ margin: 0 }}>Six steps that show the whole investigation, from the theft to the report.</p>
            <div className="j-progress"><div style={{ width: `${(done / 6) * 100}%` }} /></div>
            <div className="journey">
              {JOURNEY.map((j, i) => <div key={j.id} className={`j-step ${journey[j.id] ? 'done' : nextStep?.id === j.id ? 'next' : ''}`}><span className="c">{journey[j.id] ? '✓' : i + 1}</span>{j.label}</div>)}
            </div>
            <div className="row">
              {done < 6 ? <button className="btn primary" onClick={go}><Play size={14} />{done ? 'Continue' : 'Start the walkthrough'}</button> : <span className="pill copper">Walkthrough complete</span>}
              {done > 0 && <button className="btn ghost sm" onClick={resetJourney}><RotateCcw size={13} />Reset</button>}
            </div>
          </div>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          {[
            { id: 'graph', icon: Waypoints, t: 'Follow the money', d: 'The interactive graph of every wallet and transfer.' },
            { id: 'osint', icon: FileSearch, t: 'Check the evidence', d: `${osintCount} public findings linked to wallets.` },
            { id: 'risk', icon: ShieldAlert, t: 'See why wallets were flagged', d: `${flagged.length} wallets scored 40 or above.` },
          ].map((x) => (
            <button key={x.id} className="card goto" onClick={() => (x.id === 'graph' ? openCase(active.id, 'graph') : setSection(x.id))}>
              <x.icon size={20} color="var(--copper)" /><span><b>{x.t}</b><span className="dim">{x.d}</span></span><ArrowUpRight size={16} className="go" />
            </button>
          ))}
        </div>
      </div>

      {drawer && <MetricDrawer kind={drawer.kind} all={all} flagged={flagged} patterns={patterns} onClose={() => setDrawer(null)} />}
    </div>
  )
}

function MetricDrawer({ kind, all, flagged, onClose }) {
  const { openCase, setSection, setDrawer } = useApp()
  const goWallet = (c, a) => { setDrawer(null); openCase(c.id, 'graph', a) }
  if (kind === 'cases') {
    return <Drawer title="Investigations" sub="All cases, newest activity first" onClose={onClose}>
      <table className="t"><thead><tr><th>Case</th><th>Status</th><th>Chain</th><th className="r">Wallets</th><th className="r">Transfers</th><th>Owner</th></tr></thead>
        <tbody>{all.map(({ c }) => <tr key={c.id} onClick={() => { setDrawer(null); openCase(c.id) }}><td><b>{c.title}</b><div className="dim mono">{c.id}</div></td><td>{c.status}</td><td>{c.chain}</td><td className="r num">{c.wallets.length}</td><td className="r num">{c.txs.length}</td><td>{c.owner}</td></tr>)}</tbody></table>
    </Drawer>
  }
  if (kind === 'funds') {
    const rows = all.flatMap(({ c, a }) => c.txs.filter((t) => c.taintSources.includes(t.from) && t.ts >= c.attackStart).map((t) => ({ c, t, a })))
    return <Drawer title="Funds under analysis" sub="Transfers out of victim wallets after each incident started. These define the stolen amount." onClose={onClose}>
      <table className="t"><thead><tr><th>Case</th><th>Time (UTC)</th><th>From</th><th>To</th><th className="r">Amount</th><th className="r">Value</th></tr></thead>
        <tbody>{rows.map(({ c, t, a }) => <tr key={t.id} onClick={() => goWallet(c, t.to)}><td className="mono">{c.id}</td><td className="mono">{fmtTime(t.ts)}</td><td>{a.idx.byAddr.get(t.from)?.label}</td><td>{a.idx.byAddr.get(t.to)?.label}</td><td className="r num">{fmtAmt(t.amount)} {t.asset}</td><td className="r num">{fmtUsdShort(t.usd)}</td></tr>)}</tbody></table>
    </Drawer>
  }
  if (kind === 'flagged') return <FlaggedDrawer flagged={flagged} onClose={onClose} goWallet={goWallet} />
  if (kind === 'txs') return <TxDrawer all={all} onClose={onClose} goWallet={goWallet} />
  if (kind === 'osint') {
    const rows = all.flatMap(({ c }) => c.osint.map((o) => ({ c, o })))
    return <Drawer title="OSINT findings" sub="Public-source records linked to wallets in each case" onClose={onClose}>
      <table className="t"><thead><tr><th>ID</th><th>Finding</th><th>Source type</th><th>Confidence</th><th>Matches</th></tr></thead>
        <tbody>{rows.map(({ c, o }) => <tr key={o.id} onClick={() => { setDrawer(null); openCase(c.id, 'osint'); setTimeout(() => setSection('osint', o.id), 0) }}><td className="mono">{o.id}</td><td><b>{o.title}</b><div className="dim">{c.id}</div></td><td>{o.sourceType}</td><td><span className={`conf ${o.confidence}`}>{o.confidence}</span></td><td className="num">{o.matches.length}</td></tr>)}</tbody></table>
    </Drawer>
  }
  return null
}

function FlaggedDrawer({ flagged, onClose, goWallet }) {
  const rows = flagged.map(({ c, w, r }) => ({ c, w, r, score: r.score, label: w.label, case: c.id }))
  const { sorted, th } = useSort(rows, { key: 'score', dir: 'desc' })
  return <Drawer title="Flagged wallets" sub="Non-service wallets with a risk score of 40 or above. Click a row to open it in the graph." onClose={onClose}>
    <table className="t"><thead><tr>{th('label', 'Wallet')}<th>Address</th>{th('case', 'Case')}{th('score', 'Risk')}<th>Top factor</th></tr></thead>
      <tbody>{sorted.map(({ c, w, r }) => <tr key={c.id + w.address} onClick={() => goWallet(c, w.address)}><td><span className="row"><CatDot cat={w.category} /><b>{w.label}</b></span></td><td><Addr a={w.address} /></td><td className="mono">{c.id}</td><td><Risk r={r} /></td><td className="dim">{r.factors[0]?.label}</td></tr>)}</tbody></table>
  </Drawer>
}

function TxDrawer({ all, onClose, goWallet }) {
  const rows = all.flatMap(({ c, a }) => c.txs.map((t) => ({ ...t, c, case: c.id, fromName: a.idx.byAddr.get(t.from)?.label, toName: a.idx.byAddr.get(t.to)?.label })))
  const { sorted, th } = useSort(rows, { key: 'ts', dir: 'desc' })
  return <Drawer title="Transfers traced" sub={`${rows.length} transfers across all cases`} onClose={onClose}>
    <table className="t"><thead><tr>{th('ts', 'Time (UTC)')}{th('case', 'Case')}{th('fromName', 'From')}{th('toName', 'To')}{th('usd', 'Value', 'r')}</tr></thead>
      <tbody>{sorted.map((t) => <tr key={t.id} onClick={() => goWallet(t.c, t.to)}><td className="mono">{fmtTime(t.ts)}</td><td className="mono">{t.case}</td><td>{t.fromName}</td><td>{t.toName}</td><td className="r num">{fmtAmt(t.amount)} {t.asset}</td></tr>)}</tbody></table>
  </Drawer>
}

