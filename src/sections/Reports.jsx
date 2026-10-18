import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import { FileDown, FileJson, FileSpreadsheet, Loader2, FlaskConical } from 'lucide-react'
import { useApp } from '../store.jsx'
import { Decode } from '../components/Motion.jsx'
import { buildElements, graphStyle } from '../components/GraphCanvas.jsx'
import { SECTIONS, reportModel, buildPdf } from '../lib/report.js'
import { fmtAmt, fmtUsdShort, short } from '../lib/analysis.js'
import { fmtTime, saveFile, store } from '../lib/util.js'
import { fmtDelta } from '../lib/timing.js'

export default function Reports() {
  const { active: c, analysis, filtered, gs, notify, tick, cases, setActiveId } = useApp()
  const [sections, setSections] = useState(SECTIONS.map((s) => s.id))
  const [analyst, setAnalyst] = useState(() => store.get('analyst', ''))
  const [title, setTitle] = useState('')
  const [useFilters, setUseFilters] = useState(false)
  const [busy, setBusy] = useState(false)
  const cyEl = useRef(null), cyRef = useRef(null)
  useEffect(() => store.set('analyst', analyst), [analyst])
  useEffect(() => setTitle(''), [c.id])

  const opts = { sections, analyst, title: title || c.title, includeDust: false }
  const m = useMemo(() => reportModel(c, analysis, opts), [c, analysis, sections, analyst, title]) // eslint-disable-line react-hooks/exhaustive-deps
  const graphTxs = useFilters ? filtered.txs : c.txs.filter((t) => t.usd >= 1 || t.method === 'contract creation')
  const graphVis = useFilters ? filtered.visible : new Set(c.wallets.map((w) => w.address))

  useEffect(() => {
    if (!cyEl.current) return
    const k = cytoscape({ container: cyEl.current, style: graphStyle(true), userZoomingEnabled: false, userPanningEnabled: false, autoungrabify: true, boxSelectionEnabled: false })
    k.add(buildElements({ c, analysis, txs: graphTxs, visible: graphVis, selected: null, showClusters: false, showAmounts: false, light: true }))
    k.layout({ name: 'dagre', rankDir: 'LR', nodeSep: 26, rankSep: 90, fit: true, padding: 24 }).run()
    cyRef.current = k
    return () => k.destroy()
  }, [c, analysis, useFilters, filtered, sections.includes('graph')]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setSections((s) => (s.includes(id) ? s.filter((x) => x !== id) : SECTIONS.map((x) => x.id).filter((x) => s.includes(x) || x === id)))

  const pdf = async () => {
    setBusy(true)
    try {
      // JPEG capped at 2400 x 1600 px: sharp on A4 at ~250 dpi, a fraction of the size of a full-scale PNG
      const png = sections.includes('graph') && cyRef.current ? cyRef.current.jpg({ full: true, maxWidth: 2400, maxHeight: 1600, quality: 0.85, bg: '#ffffff', output: 'base64uri' }) : null
      const blob = await buildPdf(reportModel(c, analysis, opts), png)
      const r = await saveFile(`${c.id}-investigation-report.pdf`, blob)
      notify(r.msg, r.ok ? 'ok' : 'warn')
      if (r.ok) tick('exported')
    } catch (e) { notify(`Could not build the PDF: ${e.message}`, 'warn') } finally { setBusy(false) }
  }
  const json = async () => {
    const data = { generatedAt: new Date().toISOString(), sample: !!c.sample, case: { id: c.id, title: c.title, chain: c.chain, status: c.status, summary: c.summary },
      wallets: c.wallets.map((w) => ({ ...w, risk: analysis.risk.get(w.address) && { score: analysis.risk.get(w.address).score, band: analysis.risk.get(w.address).band, factors: analysis.risk.get(w.address).factors } })),
      transfers: c.txs.map((t) => ({ ...t, incidentShare: analysis.taint.edgeTaint.get(t.id) || 0 })), osint: c.osint, clusters: c.clusters,
      live: !!c.live, fetched: c.fetched || null,
      facts: m.extra && { observed: m.extra.observed, inferred: m.extra.inferred, hypotheses: m.extra.hypotheses }, timeline: m.extra?.timeline,
      timing: { stats: analysis.deltas.stats, issues: analysis.deltas.issues, chains: analysis.deltas.chains, cadences: analysis.deltas.cadences },
      inferredClusters: analysis.inferred.clusters, serviceEvents: analysis.services.events,
      identity: m.extra?.identity.map(({ w, m: im }) => ({ address: w.address, label: w.label, candidates: im.candidates, rejected: im.rejected, verdict: im.verdict })),
      methodology: m.methodology, limitations: m.limitations }
    const r = await saveFile(`${c.id}-case.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    notify(r.msg, r.ok ? 'ok' : 'warn')
  }
  const csv = async () => {
    const head = 'id,hash,timestamp_utc,from,to,asset,amount,usd,incident_share'
    const lines = c.txs.map((t) => [t.id, t.hash, new Date(t.ts).toISOString(), t.from, t.to, t.asset, t.amount, t.usd, (analysis.taint.edgeTaint.get(t.id) || 0).toFixed(4)].join(','))
    const r = await saveFile(`${c.id}-transfers.csv`, new Blob([[head, ...lines].join('\n')], { type: 'text/csv' }))
    notify(r.msg, r.ok ? 'ok' : 'warn')
  }

  const on = (id) => sections.includes(id)
  let n = 0
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Reports</div><h1>Investigation <em><Decode text="report" delay={0.25} /></em></h1><p>Choose what to include, check the preview, and export. The PDF is generated in your browser from the same case record shown in the preview.</p></div>
      </div>
      <div className="report">
        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <div className="card-b stack">
            <div className="field"><label htmlFor="rp-case">Case</label>
              <select id="rp-case" className="input" value={c.id} onChange={(e) => setActiveId(e.target.value)}>{cases.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.title}</option>)}</select></div>
            <div className="field"><label htmlFor="rp-title">Report title</label><input id="rp-title" className="input" placeholder={c.title} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="field"><label htmlFor="rp-analyst">Analyst name</label><input id="rp-analyst" className="input" placeholder="Shown on the cover" value={analyst} onChange={(e) => setAnalyst(e.target.value)} /></div>
            <div className="field"><span className="lbl">Sections</span>
              {SECTIONS.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={on(s.id)} onChange={() => toggle(s.id)} />{s.label}</label>)}
            </div>
            <label className="check"><input type="checkbox" checked={useFilters} onChange={(e) => setUseFilters(e.target.checked)} />Graph uses the workspace filters ({gs.visible.length} wallets)</label>
            <button className="btn primary" onClick={pdf} disabled={busy || !sections.length}>{busy ? <Loader2 size={15} className="spin" /> : <FileDown size={15} />}Export PDF</button>
            <div className="row"><button className="btn sm" onClick={csv}><FileSpreadsheet size={13} />Transfers CSV</button><button className="btn sm" onClick={json}><FileJson size={13} />Case JSON</button></div>
          </div>
        </div>

        <article className="paper" aria-label="Report preview">
          <div style={{ fontSize: 10.5, letterSpacing: '0.12em', color: '#a35d3d', fontWeight: 600 }}>GHOSTTRACE · INVESTIGATION REPORT</div>
          <h1 style={{ marginTop: 8 }}>{title || c.title}</h1>
          <p style={{ margin: '6px 0 0', color: '#6d5b74' }}>{c.id} · {c.chain} · Status: {c.status} · Generated {fmtTime(m.generated, false)}{analyst ? ` · Analyst: ${analyst}` : ''}</p>
          {c.sample && <div className="banner"><FlaskConical size={12} style={{ verticalAlign: -2 }} /> <b>Sample dataset.</b> Fictional protocols, addresses and sources used to demonstrate GhostTrace.</div>}

          {on('summary') && <><h2>{++n}. Case summary</h2><p>{c.summary}</p>
            <table className="t"><thead><tr><th>Stolen value</th><th>Wallets</th><th>Transfers</th><th>Flagged</th><th>OSINT</th><th>Incident start</th></tr></thead>
              <tbody><tr><td>{fmtUsdShort(m.stolen)}</td><td>{c.wallets.length}</td><td>{c.txs.length}</td><td>{m.flagged.length}</td><td>{c.osint.length}</td><td>{fmtTime(c.attackStart, false)}</td></tr></tbody></table></>}

          {m.extra && on('facts') && <><h2>{++n}. Facts, inferences and hypotheses</h2>
            <p><b>Observed facts</b> (recorded in the data or stated by a source)</p><ul style={{ paddingLeft: 18 }}>{m.extra.observed.map((x, i) => <li key={i}>{x}</li>)}</ul>
            <p><b>Algorithmic inferences</b> (computed by GhostTrace; leads, not conclusions)</p><ul style={{ paddingLeft: 18 }}>{m.extra.inferred.map((x, i) => <li key={i}>{x}</li>)}</ul>
            <p><b>Unverified hypotheses</b> (need confirmation)</p><ul style={{ paddingLeft: 18 }}>{(m.extra.hypotheses.length ? m.extra.hypotheses : ['None recorded.']).map((x, i) => <li key={i}>{x}</li>)}</ul></>}

          {m.extra && on('timeline') && <><h2>{++n}. Timeline and time-delta analysis</h2>
            <div className="table-wrap"><table className="t"><thead><tr><th>Time (UTC)</th><th>Event</th></tr></thead>
              <tbody>{m.extra.timeline.map((e, i) => <tr key={i}><td className="mono">{fmtTime(e.ts).replace(' UTC', '')}</td><td style={{ whiteSpace: 'normal' }}>{e.text}</td></tr>)}</tbody></table></div>
            <p style={{ color: '#6d5b74', fontSize: 11.5 }}>Receipt-to-forward delays: {analysis.deltas.stats.forwards}, median {analysis.deltas.stats.medianMs == null ? '—' : fmtDelta(analysis.deltas.stats.medianMs)}. A short delay does not show common ownership or wrongdoing.</p></>}

          <div style={{ display: on('graph') ? 'block' : 'none' }}>
            <h2>{on('graph') ? ++n : ''}. Transaction graph</h2>
            <div className="paper-graph"><div ref={cyEl} style={{ position: 'absolute', inset: 0 }} /></div>
            <p style={{ color: '#6d5b74', fontSize: 11.5 }}>Nodes are wallets (colour = category, ring = risk band). Arrows show the direction funds moved.</p>
          </div>

          {on('findings') && <><h2>{++n}. Key findings</h2>
            {m.flagged.slice(0, 8).map(({ w, r }) => (
              <div key={w.address} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><b style={{ color: '#281d30' }}>{w.label} · risk {r.score} ({r.band})</b><span className="mono" style={{ fontSize: 11 }}>{short(w.address, 10)}</span></div>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{r.factors.map((f) => <li key={f.id}><b>+{f.points} {f.label}:</b> {f.detail}</li>)}</ul>
              </div>
            ))}</>}

          {on('txs') && <><h2>{++n}. Transaction table</h2>
            <div className="table-wrap"><table className="t"><thead><tr><th>Time (UTC)</th><th>From</th><th>To</th><th className="r">Amount</th><th className="r">Value</th><th className="r">Incident</th><th>Hash</th></tr></thead>
              <tbody>{m.txs.map((t) => <tr key={t.id}><td className="mono">{fmtTime(t.ts).replace(' UTC', '')}</td><td>{m.name(t.from)}</td><td>{m.name(t.to)}</td><td className="r">{fmtAmt(t.amount)} {t.asset}</td><td className="r">{t.priceBasis === 'current' ? '≈' : ''}{fmtUsdShort(t.usd)}</td><td className="r">{(analysis.taint.edgeTaint.get(t.id) || 0) > 0 ? `${(analysis.taint.edgeTaint.get(t.id) * 100).toFixed(0)}%` : '—'}</td><td className="mono">{short(t.hash, 8)}</td></tr>)}</tbody></table></div></>}

          {on('evidence') && <><h2>{++n}. Evidence references</h2>
            {c.osint.map((o) => <div key={o.id} style={{ marginBottom: 10 }}><b style={{ color: '#281d30' }}>{o.id} · {o.title}</b> <span style={{ color: '#6d5b74', fontSize: 11.5 }}>({o.confidence}, {o.sourceType})</span>
              <p style={{ margin: '2px 0' }} className="mono">{o.url}</p>
              <p style={{ margin: 0 }}>Published {fmtTime(o.published, false)}, collected {fmtTime(o.collected, false)}. {o.matches.map((x) => `${m.name(x.address)}: ${x.reason}`).join(' ')}</p></div>)}</>}

          {on('clusters') && <><h2>{++n}. Wallet clusters</h2>
            {c.clusters.map((cl) => <p key={cl.id}><b>{cl.id} {cl.name}</b> ({cl.method}, {cl.confidence} confidence): {cl.members.map(m.name).join(', ')}. {cl.basis} <i>{cl.caveat}</i></p>)}</>}

          {m.extra && on('inferred') && <><h2>{++n}. Inferred clusters</h2>
            {analysis.inferred.clusters.map((cl) => <p key={cl.id}><b>{cl.id}</b> ({cl.confidence} confidence): {cl.members.map(m.name).join(', ')}. Links: {cl.links.map((l) => `${m.name(l.a)}–${m.name(l.b)} (${l.evidence.map((e) => e.kind).join(' + ')})`).join('; ')}.</p>)}
            {!analysis.inferred.clusters.length && <p>No wallets met the linking threshold.</p>}
            <p style={{ color: '#6d5b74', fontSize: 11.5 }}>Inferred from transaction relationships. Cluster membership does not prove common ownership.</p></>}

          {m.extra && on('services') && <><h2>{++n}. Bridges, mixers and trace stops</h2>
            {analysis.services.events.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Time (UTC)</th><th>Event</th><th>Wallet</th><th>Service</th><th className="r">Value</th><th>Basis</th><th>Tracing</th></tr></thead>
              <tbody>{analysis.services.events.map((e) => <tr key={e.txId + e.kind}><td className="mono">{fmtTime(e.ts).replace(' UTC', '')}</td><td>{e.kind}</td><td>{m.name(e.wallet)}</td><td>{e.serviceName}</td><td className="r">{fmtUsdShort(e.usd || 0)}</td><td>{e.basis}</td><td style={{ whiteSpace: 'normal' }}>{e.note}</td></tr>)}</tbody></table></div>
              : <p>No interactions with known bridges or mixers in the loaded transfers.</p>}</>}

          {m.extra && on('identity') && <><h2>{++n}. Candidate identity matches</h2>
            {m.extra.identity.map(({ w, m: im }) => <p key={w.address}><b>{w.label}</b>: {im.candidates.length ? im.candidates.map((cd) => `"${cd.identifier}" (${cd.band}, ${cd.score} pts; supporting ${cd.supporting.map((x) => `${x.id} ${x.publisher}`).join(', ')}; contradicting ${cd.contradicting.length ? cd.contradicting.map((x) => x.id).join(', ') : 'none'})`).join('; ') : `${m.extra.NO_MATCH}${im.rejected.length ? ` Rejected below threshold: ${im.rejected.map((r) => `"${r.identifier}" (${r.score} pts)`).join(', ')}.` : ''}`}</p>)}
            {!m.extra.identity.length && <p>{m.extra.NO_MATCH} No source in this case names its wallets.</p>}
            <p style={{ color: '#6d5b74', fontSize: 11.5 }}>Candidates are identifiers as published by a source that contains the exact address. They are not verified identities.</p></>}

          {on('methodology') && <><h2>{++n}. Methodology</h2><ul style={{ paddingLeft: 18 }}>{m.methodology.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          {on('limitations') && <><h2>{++n}. Limitations</h2><ul style={{ paddingLeft: 18 }}>{m.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          {on('appendix') && <><h2>Appendix: wallets</h2>
            <div className="table-wrap"><table className="t"><thead><tr><th>Label</th><th>Category</th><th>Full address</th><th>Risk</th></tr></thead>
              <tbody>{c.wallets.map((w) => { const r = analysis.risk.get(w.address); return <tr key={w.address}><td>{w.label}</td><td>{w.category}</td><td className="mono" style={{ fontSize: 10.5 }}>{w.address}</td><td>{r.score == null ? 'victim' : `${r.score} ${r.band}`}</td></tr> })}</tbody></table></div></>}
        </article>
      </div>
    </div>
  )
}
