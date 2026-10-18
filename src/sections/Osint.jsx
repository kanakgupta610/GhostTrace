import { useEffect, useMemo, useState } from 'react'
import { Globe, Search, Waypoints, Lock, Hash, Link2, ShieldCheck, ExternalLink, ArrowLeft, ArrowRight, Plus, Loader2 } from 'lucide-react'
import { useApp } from '../store.jsx'
import { Decode } from '../components/Motion.jsx'
import { evidenceHighlight } from '../lib/evidence.js'
import { Addr, CatDot, Risk } from '../components/common.jsx'
import { short, fmtAmt } from '../lib/analysis.js'
import { fmtTime, sha256, copyText } from '../lib/util.js'

// Where a finding came from: fictional sample data, an external public source fetched by the backend,
// an investigator's own entry, or the case's data source.
const ORIGIN = { sample: ['Fictional sample source', 'lilac'], external: ['External source', 'teal'], manual: ['Manually entered', 'copper'], case: ['Case data', ''] }
const originOf = (o, c) => ORIGIN[o.origin || (c.sample ? 'sample' : 'case')] || ORIGIN.case
// Short verification statement for a finding card, from the finding's own fields.
const verificationOf = (o, c) => {
  if (o.origin === 'manual') return `${o.reliability || 'Not stated'} (entered manually)`
  if (o.origin === 'external') return o.sourceKind === 'sanctions' ? 'Mirror of the OFAC list; confirm on the official OFAC search' : o.sourceKind === 'threat-list' ? 'Community scam list; not independently verified' : 'Public mention; context not verified'
  if (c.sample) return `Fictional sample source · ${o.reliability || 'reliability not stated'}`
  return o.reliability || 'Not stated'
}
// Link to the original source when it is a real, reachable URL; otherwise say why there is none.
const sourceLink = (o, c) => {
  const u = o.url || ''
  if (!u) return 'No source URL recorded'
  if (/\.example([/:]|$)/.test(u) || c.sample) return 'Fictional source (reserved .example domain), no live link'
  if (!/^https?:\/\//.test(u)) return 'Source reference: ' + u
  return <a href={u} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}><ExternalLink size={12} style={{ verticalAlign: -2 }} /> Original source ({(() => { try { return new URL(u).host } catch { return 'link' } })()})</a>
}
const SRC_NAME = { ofac: 'OFAC list mirror', scamsniffer: 'ScamSniffer', github: 'GitHub search' }

function ExternalStatus({ st }) {
  if (!st) return null
  if (st.state === 'loading') return <div className="note">Checking public sources (OFAC list mirror, ScamSniffer, GitHub) for exact address matches…</div>
  if (st.state === 'error') return <div className="note warn">Public-source check failed: {st.error}. No external evidence is shown; this is not a finding that none exists.</div>
  const down = (st.sources || []).filter((x) => x.status === 'unavailable' || x.status === 'rate_limited')
  return (
    <div className={`note ${down.length ? 'warn' : ''}`}>
      Public sources checked {fmtTime(st.at, false)} for {st.checked} addresses: {(st.sources || []).map((x) => `${SRC_NAME[x.id] || x.id} ${x.status === 'ok' ? `${x.found} match${x.found === 1 ? '' : 'es'}` : x.status === 'skipped' ? 'skipped' : x.status.replace('_', ' ')}`).join(' · ')}.
      {down.length ? ` Partial result: ${down.map((x) => x.message).join('; ')}.` : ''}{st.found === 0 ? ' No source contained these addresses, so no external evidence was added.' : ''}
    </div>
  )
}

export default function Osint() {
  const { active: c, analysis, focus, setFocus, openCase, setSelection, setSection, tick, osintStatus, evidenceState, openEvidenceForm, lastSaved } = useApp()
  const [origin, setOrigin] = useState('')
  const [sel, setSel] = useState(focus && c.osint.some((o) => o.id === focus) ? focus : null)
  const [q, setQ] = useState('')
  const [types, setTypes] = useState([])
  const [conf, setConf] = useState([])
  useEffect(() => { if (focus && c.osint.some((o) => o.id === focus)) { setSel(focus); setFocus(null) } }, [focus, c, setFocus])
  useEffect(() => { if (sel && !c.osint.some((o) => o.id === sel)) setSel(null) }, [c, sel])
  useEffect(() => { if (sel) tick('evidence') }, [sel, tick])

  const allTypes = [...new Set(c.osint.map((o) => o.sourceType))]
  const list = c.osint.filter((o) =>
    (!types.length || types.includes(o.sourceType)) && (!conf.length || conf.includes(o.confidence)) && (!origin || (o.origin || (c.sample ? 'sample' : 'case')) === origin) &&
    (!q || [o.title, o.excerpt, o.publisher, o.id, ...o.matches.map((m) => m.address)].some((s) => s.toLowerCase().includes(q.toLowerCase()))))
  const o = c.osint.find((x) => x.id === sel)
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  if (o) return (
    <div className="page page-narrow">
      <button className="back" onClick={() => setSel(null)}><ArrowLeft size={15} />All evidence</button>
      <FindingDetail o={o} c={c} analysis={analysis} openCase={openCase} setSelection={setSelection} setSection={setSection} />
    </div>
  )

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div><div className="eyebrow">Investigate · {c.id}</div><h1>OSINT <em><Decode text="evidence" delay={0.25} /></em></h1><p>What public sources say about the wallets in this case. Open a finding to read the source and see why it is linked.</p></div>
        <button className="btn primary" onClick={() => openEvidenceForm()}><Plus size={14} />Add Evidence</button>
      </div>
      {c.live && <ExternalStatus st={osintStatus[c.id]} />}
      {evidenceState[c.id]?.state === 'error' && <div className="note warn">Manually entered evidence could not be loaded: {evidenceState[c.id].error}. Findings below do not include manual entries.</div>}
      {evidenceState[c.id]?.state === 'loading' && <div className="note"><Loader2 size={12} className="spin" style={{ verticalAlign: -2 }} /> Loading saved evidence for this case…</div>}
      {lastSaved?.caseRef === c.id && <div className="note">Saved {lastSaved.id} to {lastSaved.backend === 'supabase' ? 'Supabase' : 'the server\'s local store'}. <button className="linkish" onClick={() => setSel(lastSaved.id)}>Open it</button></div>}
      {c.osint.length === 0 ? <div className="card empty stack" style={{ alignItems: 'center', gap: 10 }}><span>{c.live ? 'No OSINT evidence for this case yet: no public source matched its addresses and nothing has been entered manually.' : 'No OSINT evidence is attached to this case yet.'}</span><button className="btn primary sm" onClick={() => openEvidenceForm()}><Plus size={13} />Add Evidence</button></div> : (
        <>
          <div className="filterbar">
            <div className="search" style={{ maxWidth: 320 }}><Search size={15} /><input id="osint-q" placeholder="Search findings or addresses" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="chips">{['Confirmed', 'Strong', 'Weak'].map((t) => <button key={t} className={`chip ${conf.includes(t) ? 'on' : ''}`} onClick={() => toggle(conf, setConf, t)}>{t}</button>)}</div>
            <select className="input" style={{ width: 170 }} value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Evidence origin">
              <option value="">All origins</option><option value="manual">Manually entered</option><option value="external">External source</option>{c.sample && <option value="sample">Fictional sample</option>}
            </select>
            <select className="input" style={{ width: 190 }} value={types[0] || ''} onChange={(e) => setTypes(e.target.value ? [e.target.value] : [])} aria-label="Source type">
              <option value="">All source types</option>
              {allTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="finding-grid">
            {list.map((x, i) => (
              <div key={x.id} className="finding" role="button" tabIndex={0} onClick={() => setSel(x.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(x.id) } }} style={{ animationDelay: `${i * 0.04}s`, cursor: 'pointer' }}>
                <div className="spread"><span className="mono dim">{x.id} · {x.sourceType}</span><span className={`conf ${x.confidence}`}>{x.confidence}</span></div>
                <b className="finding-title">{x.title}</b>
                <div className="row" style={{ gap: 6 }}><span className={`pill ${originOf(x, c)[1]}`}>{originOf(x, c)[0]}</span><span className="dim" style={{ fontSize: 12 }}>{x.publisher}</span></div>
                <div style={{ fontSize: 12 }}><span className="dim">Matched address: </span>{x.matches.length ? x.matches.map((m) => <span key={m.address} className="pill" style={{ marginRight: 4 }}><CatDot cat={analysis.idx.byAddr.get(m.address)?.category} size={7} /><span className="mono">{short(m.address)}</span>{analysis.idx.byAddr.get(m.address)?.label ? ` · ${analysis.idx.byAddr.get(m.address).label}` : ''}</span>) : <span className="dim">not linked to a specific wallet</span>}</div>
                <div className="dim" style={{ fontSize: 12 }}><span>Verification: </span>{verificationOf(x, c)}</div>
                <div className="spread finding-foot">
                  <span className="dim" style={{ fontSize: 12 }}>{sourceLink(x, c)}</span>
                  <span className="dim">{fmtTime(x.published, false)}<ArrowRight size={14} style={{ verticalAlign: -3 }} /></span>
                </div>
              </div>
            ))}
            {!list.length && <div className="empty">No findings match.</div>}
          </div>
        </>
      )}
    </div>
  )
}

function FindingDetail({ o, c, analysis, openCase, setSelection }) {
  const { updateGraph, setEvidenceOpen, setReveal } = useApp()
  // jump to the graph with this finding's beam drawn to the wallet it names
  const showLink = (address) => {
    setReveal(null)
    openCase(c.id, 'graph', address)
    setEvidenceOpen(true)
    const h = evidenceHighlight(c, o)
    updateGraph((g) => ({ ...g, visible: [...new Set([...g.visible, ...h.nodes])], highlight: h }), c.id)
  }
  const [hash, setHash] = useState(null)
  useEffect(() => { let on = true; sha256(o.url + '\n' + o.excerpt).then((h) => on && setHash(h)); return () => { on = false } }, [o])
  const name = (a) => analysis.idx.byAddr.get(a)?.label
  const parts = useMemo(() => highlight(o.excerpt, c, analysis), [o, c, analysis])
  const related = o.relatedTx.map((id) => c.txs.find((t) => t.id === id)).filter(Boolean)
  const events = [
    ...related.map((t) => ({ ts: t.ts, text: `${name(t.from)} → ${name(t.to)}: ${fmtAmt(t.amount)} ${t.asset}`, kind: 'tx', id: t.id })),
    { ts: o.published, text: `Published by ${o.publisher}`, kind: 'pub' },
    { ts: o.collected, text: o.origin === 'external' ? 'Retrieved by the GhostTrace evidence service' : 'Captured into GhostTrace', kind: 'col' },
  ].filter((e) => e.ts != null).sort((a, b) => a.ts - b.ts)
  return (
    <div className="stack" style={{ gap: 16, minWidth: 0 }}>
      <div className="card"><div className="card-b stack">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div><div className="eyebrow">{o.id} · {o.sourceType}</div><h2 style={{ marginTop: 4, fontSize: 20 }}>{o.title}</h2><div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>{o.publisher} · <span className={`pill ${originOf(o, c)[1]}`}>{originOf(o, c)[0]}</span></div></div>
          <span className={`conf ${o.confidence}`}>{o.confidence}</span>
        </div>
        <div className="capture">
          <div className="capture-bar"><Lock size={12} /><span className="u">{o.url}</span><a className="btn ghost sm" href={o.url} target="_blank" rel="noreferrer noopener" title="Open the original URL in a new tab"><ExternalLink size={13} />Original</a></div>
          <div className="capture-body">{parts.map((p, i) => p.addr ? <mark key={i} className="btnmark" title={`${p.label || 'Address'} · click to open in graph`} onClick={() => openCase(c.id, 'graph', p.addr)} role="button" tabIndex={0}>{p.text}</mark> : p.tx ? <mark key={i} className="btnmark" onClick={() => { openCase(c.id, 'graph'); setTimeout(() => setSelection({ type: 'tx', id: p.tx, focus: true }), 0) }} role="button" tabIndex={0}>{p.text}</mark> : <span key={i}>{p.text}</span>)}</div>
          <div className="capture-bar" style={{ borderTop: '1px solid var(--line)', borderBottom: 0 }}><ShieldCheck size={12} /><span className="u">SHA-256 of capture {hash ? short(hash, 12) : '…'}</span><span className="dim">Collected {fmtTime(o.collected, false)}</span></div>
        </div>
        {c.sample && <div className="dim" style={{ fontSize: 12 }}>Sample source: the URL uses the reserved .example domain, so the captured text above is the record of this finding.</div>}
        {o.origin === 'manual' && <div className="note" style={{ fontSize: 12 }}>Verification status: {o.reliability}. Entered manually by an investigator; not independently sourced by GhostTrace.</div>}
        {o.origin === 'manual' && o.key && <RemoveManual o={o} />}
        {o.origin === 'external' && <div className="note" style={{ fontSize: 12 }}>Verification status: {o.reliability}{o.officialUrl ? <> Official source: <a href={o.officialUrl} target="_blank" rel="noreferrer noopener">{new URL(o.officialUrl).host}</a>.</> : null}</div>}
        <details className="more">
          <summary>Source details and extracted identifiers</summary>
          <div className="stack" style={{ marginTop: 10 }}>
        <div className="kv">
          <div><div className="k">Published</div><div className="v" style={{ fontSize: 12.5 }}>{fmtTime(o.published, false)}</div></div>
          <div><div className="k">Collected</div><div className="v" style={{ fontSize: 12.5 }}>{fmtTime(o.collected, false)}</div></div>
          <div style={{ gridColumn: '1 / 3' }}><div className="k">Source reliability</div><div className="v" style={{ fontWeight: 400 }}>{o.reliability}</div></div>
        </div>
        <div className="field"><span className="lbl">Extracted identifiers</span>
          <div className="chips">{o.identifiers.map((x, i) => (
            <button key={i} className="chip" onClick={() => copyText(x.value)} title="Copy">
              {x.type === 'address' ? <Hash size={11} style={{ verticalAlign: -1 }} /> : x.type === 'tx' ? <Link2 size={11} style={{ verticalAlign: -1 }} /> : <Globe size={11} style={{ verticalAlign: -1 }} />} {x.type}: <span className="mono">{x.value.startsWith('0x') && x.value.length > 20 ? short(x.value, 8) : x.value}</span>
            </button>))}
          </div>
        </div>
          </div>
        </details>
      </div></div>

      <div className="grid g-2">
        <div className="card">
          <div className="card-h"><h2>Linked wallets</h2></div>
          <div className="card-b stack">
            {o.matches.map((m) => {
              const w = analysis.idx.byAddr.get(m.address)
              return (
                <div className="match" key={m.address}>
                  <div className="spread"><span className="row"><CatDot cat={w?.category} /><b>{w?.label}</b></span><Risk r={analysis.risk.get(m.address)} /></div>
                  <Addr a={m.address} n={10} />
                  <div style={{ fontSize: 12.5 }}><b>Reason for match: </b><span className="muted">{m.reason}</span></div>
                  <div className="row"><button className="btn sm primary" onClick={() => showLink(m.address)}><Waypoints size={13} />Show the link in the graph</button></div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Evidence timeline</h2></div>
          <div className="card-b">
            <div className="timeline">
              {events.map((e, i) => (
                <div key={i} className={`tl-item ${e.kind === 'tx' ? 'copper' : ''}`}>
                  {e.kind === 'tx' ? <button className="linkish" onClick={() => { openCase(c.id, 'graph'); setTimeout(() => setSelection({ type: 'tx', id: e.id, focus: true }), 0) }}>{e.text}</button> : <div>{e.text}</div>}
                  <div className="dim mono" style={{ fontSize: 11 }}>{fmtTime(e.ts)}{e.kind === 'tx' ? ` · ${e.id.replace(c.id + '-', '')}` : ''}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function highlight(text, c, analysis) {
  const tokens = []
  for (const w of c.wallets) tokens.push({ v: w.address, addr: w.address, label: w.label })
  for (const t of c.txs) tokens.push({ v: t.hash, tx: t.id })
  const re = /0x[0-9a-fA-F]{40,64}/g
  const out = []
  let last = 0, m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    const tok = tokens.find((t) => t.v.toLowerCase() === m[0].toLowerCase())
    out.push({ text: m[0], addr: tok?.addr, tx: tok?.tx, label: tok?.label || analysis.idx.byAddr.get(m[0])?.label })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}


function RemoveManual({ o }) {
  const { removeEvidence, notify } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  return (
    <div className="row" style={{ gap: 8 }}>
      <button className="btn sm ghost" disabled={busy} onClick={async () => {
        if (!window.confirm(`Remove manual entry ${o.id}? This deletes it from the evidence store.`)) return
        setBusy(true); setErr(null)
        const r = await removeEvidence(o)
        setBusy(false)
        if (r.ok) notify(`Removed ${o.id}.`, 'ok'); else setErr(r.error)
      }}>{busy ? 'Removing…' : 'Remove this manual entry'}</button>
      {err && <span className="dim" style={{ fontSize: 12, color: 'var(--copper)' }}>Not removed: {err}</span>}
    </div>
  )
}
