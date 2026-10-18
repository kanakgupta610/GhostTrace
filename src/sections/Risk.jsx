import { useEffect, useState } from 'react'
import { Boxes, Waypoints, Info } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ScatterChart, Scatter, ZAxis } from 'recharts'
import { useApp } from '../store.jsx'
import { Decode, ScoreRing } from '../components/Motion.jsx'
import { Addr, CatDot, Risk, useSort, Term } from '../components/common.jsx'
import { fmtUsdShort, fmtDuration, SERVICE_CATS, short } from '../lib/analysis.js'
import { fmtTime, fmtDay, fmtClock } from '../lib/util.js'
import { fmtDelta } from '../lib/timing.js'
import { candidateMatches, IDENTITY_METHOD, NO_MATCH } from '../lib/identity.js'
import { knownService } from '../lib/services.js'

export const WEIGHTS = [
  ['Received incident proceeds', 'Up to 30', 'Share of received value traced to the incident, haircut method'],
  ['Proximity to primary suspect', '15 / 12 / 8 / 5 / 2', 'Hops 0, 1, 2, 3, 4+ following time order'],
  ['Mixing service (category)', '30', 'Wallet is itself a mixer'],
  ['Mixer interaction', '15', 'Any deposit to or withdrawal from a mixer'],
  ['Fixed-denomination deposits', '8', '3+ mixer deposits of identical size'],
  ['Rapid forwarding', '10', 'Median receipt-to-send under 30 minutes'],
  ['Fan-out splitting', '8', '3+ distinct recipients within 60 minutes'],
  ['Peel-chain step', '8', '≥85% forwarded, ≤15% peeled to an exchange'],
  ['Fresh wallet', '6', 'First activity within 7 days of the incident'],
  ['Cross-chain exit', '6', 'Sent funds to a bridge'],
  ['Exchange cash-out', '4', 'Sent funds to an exchange deposit'],
  ['OSINT match', '15 / 10 / 4', 'Confirmed / strong / weak public-source link'],
]

export default function RiskAnalytics() {
  const { active: c, analysis, openCase, updateGraph, tick, selection, sub, setSub, setSection } = useApp()
  const tab = ['scores', 'timing', 'clusters', 'identity', 'services', 'patterns'].includes(sub) ? sub : 'scores'
  const name = (a) => analysis.idx.byAddr.get(a)?.label || short(a)
  // open the graph with these transfers (and their wallets) highlighted
  const showTxs = (txIds) => {
    const txs = c.txs.filter((t) => txIds.includes(t.id)); const nodes = [...new Set(txs.flatMap((t) => [t.from, t.to]))]
    updateGraph((g) => ({ ...g, visible: [...new Set([...g.visible, ...nodes])], highlight: { kind: 'path', edges: txs.map((t) => t.id), nodes, txs } }), c.id)
    setSection('graph')
  }
  const showWallets = (nodes) => { updateGraph((g) => ({ ...g, visible: [...new Set([...g.visible, ...nodes])], highlight: { kind: 'cluster', edges: [], nodes } }), c.id); setSection('graph') }
  const scored = c.wallets.map((w) => ({ w, r: analysis.risk.get(w.address) })).filter((x) => x.r.score != null)
  const initial = selection?.type === 'wallet' && analysis.risk.get(selection.id)?.score != null ? selection.id : scored.sort((a, b) => b.r.score - a.r.score)[0]?.w.address
  const [focusW, setFocusW] = useState(initial)
  useEffect(() => { if (!analysis.idx.byAddr.has(focusW)) setFocusW(initial) }, [c, focusW, initial, analysis])
  useEffect(() => { tick('risk') }, [tick])

  const rows = scored.map(({ w, r }) => ({ w, r, label: w.label, score: r.score, cat: w.category, factors: r.factors.length, tainted: analysis.taint.walletTaint.get(w.address)?.share || 0 }))
  const { sorted, th } = useSort(rows, { key: 'score', dir: 'desc' })
  const fw = analysis.idx.byAddr.get(focusW)
  const fr = analysis.risk.get(focusW)
  const t = analysis.timing
  const seq = t.seq.filter((s) => s.gapMin > 0).map((s) => ({ ...s, x: s.ts, y: Math.max(0.05, s.gapMin), z: Math.max(40, Math.log10(s.usd + 1) * 40) }))

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Analyse · {c.id}</div><h1>Why wallets were <em><Decode text="flagged" delay={0.25} /></em></h1><p>Pick a view below. Every score is computed from the case's transfers, <Term k="cluster">clusters</Term> and <Term k="osint">public evidence</Term>.</p></div>
      </div>

      <div className="subtabs" role="tablist" aria-label="Risk views">
        {[['scores', 'Risk breakdown', 'Every wallet ranked, with the factors behind its score'], ['timing', 'Timing patterns', 'Time gaps between transfers and rapid-transfer findings'], ['clusters', 'Wallet clusters', 'Wallets grouped by a stated method or by transaction relationships'], ['identity', 'Identity matches', 'Candidate identities, only where a source names the address'], ['services', 'Cross-chain tracing', 'Bridges and mixers, confirmed Ethereum → Optimism matches, and where tracing stops'], ['patterns', 'Patterns', 'Laundering behaviours and how scoring works']].map(([id, l, tip]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`subtab ${tab === id ? 'on' : ''}`} onClick={() => setSub(id)} data-tip={tip}>{l}</button>
        ))}
      </div>

      <div className="subpage" key={tab}>
      {tab === 'scores' && <div className="note" style={{ marginBottom: 14 }}>Each wallet's risk score is the sum of the factor points listed for it (capped at 100); select a wallet to see its breakdown. Factors are heuristic indicators computed from this case's transfers, clusters and evidence. A score is a lead for investigation, not proof of wrongdoing; service wallets (exchanges, bridges, mixers) are scored for exposure, not culpability. The full weights table is under Patterns → Scoring method.</div>}
      {tab === 'scores' && (
      <div className="grid g-main">
        <div className="card">
          <div className="card-h"><h2>Wallet risk ranking</h2><span className="dim" style={{ fontSize: 12 }}>{rows.length} scored wallets</span></div>
          <div className="card-b table-wrap" style={{ maxHeight: 460 }}>
            <table className="t">
              <thead><tr>{th('label', 'Wallet')}{th('score', 'Score')}<th>Main reason</th></tr></thead>
              <tbody>
                {sorted.map(({ w, r }) => (
                  <tr key={w.address} className={w.address === focusW ? 'sel' : ''} onClick={() => setFocusW(w.address)}>
                    <td><span className="row" style={{ flexWrap: 'nowrap' }}><CatDot cat={w.category} /><b>{w.label}</b>{SERVICE_CATS.has(w.category) && <span className="pill">service</span>}</span></td>
                    <td><Risk r={r} /></td>
                    <td className="dim">{r.factors[0]?.label || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          {fw && fr && (
            <div className="card-b stack">
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div><div className="eyebrow">Risk explanation</div><h2 style={{ marginTop: 4 }}><Decode key={fw.address} text={fw.label} speed={1.4} /></h2><Addr a={fw.address} n={8} /></div>
                <div className="insp-score"><ScoreRing key={fw.address} score={fr.score} band={fr.band} size={78} stroke={7} /><span className="eyebrow">{fr.score == null ? 'Victim' : `${fr.band} risk`}</span></div>
              </div>
              {fr.note && <div className="note">{fr.note}</div>}
              <div style={{ height: Math.max(120, fr.factors.length * 30 + 20) }}>
                <ResponsiveContainer>
                  <BarChart data={fr.factors} layout="vertical" margin={{ left: 0, right: 24 }}>
                    <XAxis type="number" hide domain={[0, 30]} />
                    <YAxis type="category" dataKey="label" width={170} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(250,240,247,0.04)' }} content={({ active: a, payload }) => a && payload?.length ? <div className="tt" style={{ maxWidth: 280 }}><b>+{payload[0].value} {payload[0].payload.label}</b><br />{payload[0].payload.detail}</div> : null} />
                    <Bar dataKey="points" radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#c47f59', fontSize: 11, formatter: (v) => `+${v}` }}>
                      {fr.factors.map((f) => <Cell key={f.id} fill={f.id === 'osint' ? '#d8a1dc' : f.id === 'taint' || f.id === 'proximity' ? '#c47f59' : '#a7738f'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>{fr.factors.map((f) => <div className="factor" key={f.id}><span className="fl">{f.label}</span><span className="fp">+{f.points}</span><span className="fd">{f.detail}</span></div>)}</div>
              <div className="row"><button className="btn sm" onClick={() => openCase(c.id, 'graph', fw.address)}><Waypoints size={13} />Show in graph</button></div>
            </div>
          )}
        </div>
      </div>
      )}
      {tab === 'timing' && <TimingPatterns analysis={analysis} name={name} showTxs={showTxs} />}
      {tab === 'timing' && (
      <div className="grid g-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-h"><h2>Time held before forwarding</h2><span className="dim" style={{ fontSize: 12 }}>Receipt to next send, non-service wallets</span></div>
          <div className="card-b" style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={t.bins} margin={{ left: -16, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: 'rgba(250,240,247,0.04)' }} content={({ active: a, payload }) => a && payload?.length ? <div className="tt"><b>{payload[0].payload.label}: {payload[0].value} transfer{payload[0].value === 1 ? '' : 's'}</b><br /><span className="dim">{payload[0].payload.wallets.join(', ') || '—'}</span></div> : null} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>{t.bins.map((b, i) => <Cell key={i} fill={i < 3 ? '#c47f59' : i < 5 ? '#d8a1dc' : '#5d466a'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card-b" style={{ paddingTop: 0 }}><div className="dim" style={{ fontSize: 12.5 }}>{t.gaps.filter((g) => g.ms < 900000).length} of {t.gaps.length} forwards happened within 15 minutes of receipt. Fast forwarding is typical of automated laundering scripts.</div></div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Gap between consecutive transfers</h2><span className="dim" style={{ fontSize: 12 }}>Minutes, log scale · bubble size = value</span></div>
          <div className="card-b" style={{ height: 290 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ left: -8, right: 12, top: 8 }}>
                <CartesianGrid />
                <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => `${fmtDay(v)} ${fmtClock(v)}`} tickLine={false} axisLine={false} tickCount={5} />
                <YAxis dataKey="y" type="number" scale="log" domain={[0.05, 'auto']} allowDataOverflow tickFormatter={(v) => (v < 1 ? v.toFixed(1) : Math.round(v))} tickLine={false} axisLine={false} />
                <ZAxis dataKey="z" range={[30, 260]} />
                <Tooltip cursor={false} content={({ active: a, payload }) => a && payload?.length ? <div className="tt"><b>{payload[0].payload.id.replace(c.id + '-', '')} · {fmtTime(payload[0].payload.ts)}</b><br />{fmtDuration(payload[0].payload.gapMin * 60000)} after previous transfer<br />{fmtUsdShort(payload[0].payload.usd)}</div> : null} />
                <Scatter data={seq} fill="#c47f59" fillOpacity={0.75} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      )}
      {tab === 'clusters' && <div className="note" style={{ marginBottom: 14 }}><b>Stated clusters</b> come from the case record{c.sample ? ' (fictional sample data)' : ''}, each with the method an investigator used. <b>Inferred clusters</b> below are computed by GhostTrace from transaction relationships, and each wallet lists the links that put it there. Neither proves that the wallets share an owner.</div>}
      {tab === 'clusters' && (
      <div className="card">
        <div className="card-h"><h2>Stated clusters</h2><button className="btn sm" onClick={() => { updateGraph((g) => ({ ...g, filters: { ...g.filters, showClusters: true }, visible: [...new Set([...g.visible, ...c.clusters.flatMap((x) => x.members)])] })); openCase(c.id, 'graph') }}><Boxes size={13} />Show clusters in graph</button></div>
        <div className="card-b grid g-2">
          {c.clusters.map((cl) => {
            const vol = c.txs.filter((t) => cl.members.includes(t.from) || cl.members.includes(t.to)).reduce((s, t) => s + t.usd, 0)
            return (
              <div className="match" key={cl.id}>
                <div className="spread"><b>{cl.id} · {cl.name}</b><span className={`pill ${cl.confidence === 'High' ? 'teal' : 'lilac'}`}>{cl.confidence} confidence</span></div>
                <div style={{ fontSize: 12.5 }}><span className="dim">Method: </span><b>{cl.method}</b></div>
                <div className="muted" style={{ fontSize: 12.5 }}>{cl.basis}</div>
                <div className="row" style={{ gap: 6 }}>{cl.members.map((m) => <button key={m} className="pill linkish" onClick={() => openCase(c.id, 'graph', m)}><CatDot cat={analysis.idx.byAddr.get(m)?.category} size={7} />{analysis.idx.byAddr.get(m)?.label}</button>)}</div>
                <div className="spread dim" style={{ fontSize: 12 }}><span>{cl.members.length} wallets · {fmtUsdShort(vol)} transfer volume</span></div>
                <div className="note warn" style={{ fontSize: 12 }}><Info size={12} style={{ verticalAlign: -2 }} /> {cl.caveat}</div>
              </div>
            )
          })}
          {!c.clusters.length && <div className="empty">No clusters are stated for this case.</div>}
        </div>
      </div>
      )}
      {tab === 'clusters' && <InferredClusters c={c} analysis={analysis} name={name} showWallets={showWallets} showTxs={showTxs} />}
      {tab === 'identity' && <IdentityView c={c} openCase={openCase} />}
      {tab === 'services' && <ServicesView c={c} analysis={analysis} name={name} showTxs={showTxs} />}
      {tab === 'patterns' && (
      <div className="stack" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-h"><h2>Suspicious patterns</h2></div>
          <div className="card-b feed">
            {analysis.patterns.map((p) => (
              <div className="feed-item" key={p.id} style={{ gridTemplateColumns: '1fr auto' }}>
                <span><b>{p.kind}</b> · <button className="linkish" onClick={() => openCase(c.id, 'graph', p.wallet)}>{p.walletName}</button><div className="muted" style={{ fontSize: 12.5 }}>{p.detail}</div></span>
                <span className={`pill ${p.severity === 'High' ? 'copper' : 'lilac'}`}>{p.severity}</span>
              </div>
            ))}
            {!analysis.patterns.length && <div className="empty">No multi-transfer patterns detected.</div>}
          </div>
        </div>
        <details className="more card-more">
          <summary>Scoring method and weights</summary>
          <div className="dim" style={{ fontSize: 12, margin: '10px 0' }}>Bands: 70+ high · 40–69 elevated · 15–39 low. Each indicator is computed from the case data; the score is their sum, capped at 100.</div>
          <div className="table-wrap">
            <table className="t"><thead><tr><th>Indicator</th><th className="r">Points</th><th>Rule</th></tr></thead>
              <tbody>{WEIGHTS.map(([a, b, d]) => <tr key={a} style={{ cursor: 'default' }}><td>{a}</td><td className="r mono">{b}</td><td className="dim" style={{ whiteSpace: 'normal' }}>{d}</td></tr>)}</tbody></table>
          </div>
        </details>
      </div>
      )}
      </div>
    </div>
  )
}

const Method = ({ title = 'Method and limitations', method, limits }) => (
  <details className="more card-more">
    <summary>{title}</summary>
    <ul className="dim" style={{ fontSize: 12.5, paddingLeft: 18, margin: '10px 0' }}>{method.map((x, i) => <li key={i}>{x}</li>)}</ul>
    <div className="note warn" style={{ fontSize: 12 }}><Info size={12} style={{ verticalAlign: -2 }} /> {limits.join(' ')}</div>
  </details>
)

function TimingPatterns({ analysis, name, showTxs }) {
  const d = analysis.deltas
  const iss = d.issues
  const dataNote = [iss.missingTimestamp && `${iss.missingTimestamp} without a timestamp (excluded)`, iss.duplicates && `${iss.duplicates} duplicate${iss.duplicates > 1 ? 's' : ''} removed`, iss.outOfOrder && `${iss.outOfOrder} out of order (re-sorted)`].filter(Boolean)
  const fastest = [...d.forwards].sort((a, b) => a.ms - b.ms).slice(0, 12)
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <div className="card-h"><h2>Rapid-transfer findings</h2><span className="dim" style={{ fontSize: 12 }}>{d.stats.forwards} receipt-to-forward delays · median {d.stats.medianMs == null ? '—' : fmtDelta(d.stats.medianMs)} · 90th percentile {d.stats.p90Ms == null ? '—' : fmtDelta(d.stats.p90Ms)}</span></div>
        <div className="card-b feed">
          {d.chains.map((ch) => (
            <div className="feed-item" key={ch.wallets.join('>')} style={{ gridTemplateColumns: '1fr auto' }}>
              <span><b>Rapid sequence</b> · {ch.wallets.map(name).join(' → ')}
                <div className="muted" style={{ fontSize: 12.5 }}>Each hop left within {fmtDelta(d.thresholds.rapidMs)} of arriving: {ch.delays.map(fmtDelta).join(', ')} (total {fmtDelta(ch.totalMs)}){ch.occurrences > 1 ? `. The same path occurred ${ch.occurrences} times.` : '.'}</div></span>
              <button className="btn sm" onClick={() => showTxs(ch.occurrences > 1 ? ch.allTxIds : ch.txIds)}><Waypoints size={13} />Show transfers</button>
            </div>
          ))}
          {d.cadences.map((x) => (
            <div className="feed-item" key={x.wallet} style={{ gridTemplateColumns: '1fr auto' }}>
              <span><b>Repeated interval</b> · {name(x.wallet)}
                <div className="muted" style={{ fontSize: 12.5 }}>{x.txIds.length} outgoing transfers about {fmtDelta(x.avgMs)} apart (gaps {x.gaps.map(fmtDelta).join(', ')}). A steady rhythm is consistent with scripted sending.</div></span>
              <button className="btn sm" onClick={() => showTxs(x.txIds)}><Waypoints size={13} />Show transfers</button>
            </div>
          ))}
          {!d.chains.length && !d.cadences.length && <div className="empty">{d.events.length ? 'No rapid sequences or repeated intervals at the current thresholds.' : 'No timestamped transfers loaded for this case.'}</div>}
        </div>
        <div className="card-b" style={{ paddingTop: 0 }}>
          <div className="dim" style={{ fontSize: 12 }}>Data quality: {d.stats.transfers} timestamped transfers{dataNote.length ? `; ${dataNote.join('; ')}` : '; no missing, duplicate or out-of-order records'}. All times are UTC block timestamps.</div>
          <div className="note" style={{ fontSize: 12, marginTop: 8 }}>A short delay is a timing observation. It does not show that the wallets share an owner or that anything unlawful happened.</div>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h2>Shortest time gaps</h2><span className="dim" style={{ fontSize: 12 }}>Receipt → next outgoing transfer, fastest first · services excluded</span></div>
        <div className="card-b table-wrap" style={{ maxHeight: 340 }}>
          {fastest.length ? (
            <table className="t">
              <thead><tr><th>Wallet</th><th className="r">Time gap</th><th>Received</th><th>Forwarded</th><th></th></tr></thead>
              <tbody>{fastest.map((f) => (
                <tr key={f.inTx + f.outTx} onClick={() => showTxs([f.inTx, f.outTx])}>
                  <td>{name(f.wallet)}</td><td className="r num">{fmtDelta(f.ms)}</td>
                  <td className="mono dim">{fmtTime(d.events.find((t) => t.id === f.inTx)?.ts, true).replace(' UTC', '')}</td>
                  <td className="mono dim">{fmtTime(d.events.find((t) => t.id === f.outTx)?.ts, true).replace(' UTC', '')}</td>
                  <td><span className={`pill ${f.ms <= d.thresholds.rapidMs ? 'copper' : ''}`}>{f.ms <= d.thresholds.rapidMs ? 'rapid' : 'not rapid'}</span></td>
                </tr>))}</tbody>
            </table>
          ) : <div className="empty">No receipt-to-forward pairs in the loaded transfers.</div>}
        </div>
        <div className="card-b" style={{ paddingTop: 0 }}><div className="dim" style={{ fontSize: 12 }}>"Rapid" means under {fmtDelta(d.thresholds.rapidMs)}. Click a row to see both transfers in the graph. Transfers in the same block show 0 s.</div></div>
      </div>
      <Method method={d.method} limits={d.limitations} />
    </div>
  )
}

const KIND_LABEL = { direct: 'Direct transfer', passthrough: 'Pass-through', funder: 'Common funder', coordinated: 'Coordinated receipt', shared: 'Shared counterparties' }

function InferredClusters({ c, analysis, name, showWallets, showTxs }) {
  const r = analysis.inferred
  return (
    <div className="stack" style={{ gap: 16, marginTop: 16 }}>
      <div className="card">
        <div className="card-h"><h2>Inferred clusters</h2><span className="dim" style={{ fontSize: 12 }}>Algorithmic · from transaction relationships in this case</span></div>
        <div className="card-b grid g-2">
          {r.clusters.map((cl) => (
            <div className="match" key={cl.id}>
              <div className="spread"><b>{cl.id} · {cl.members.length} wallets</b><span className="pill lilac">{cl.confidence} confidence · inferred</span></div>
              <div className="stack" style={{ gap: 6 }}>
                {cl.members.map((m) => (
                  <div key={m} style={{ fontSize: 12.5 }}>
                    <span className="row" style={{ gap: 6 }}><CatDot cat={analysis.idx.byAddr.get(m)?.category} size={7} /><b>{name(m)}</b></span>
                    <div className="muted" style={{ paddingLeft: 14 }}>{cl.reasons[m].map((l) => `linked to ${name(l.with)} (${l.score} pts): ${l.evidence.map((e) => KIND_LABEL[e.kind]).join(' + ')}`).join('; ')}</div>
                  </div>
                ))}
              </div>
              {cl.touchpoints.length > 0 && <div className="dim" style={{ fontSize: 12 }}>Services and contracts touched (not members): {cl.touchpoints.slice(0, 6).map((t) => `${name(t.address)} (${t.category})`).join(', ')}{cl.touchpoints.length > 6 ? ` and ${cl.touchpoints.length - 6} more` : ''}</div>}
              <details className="more"><summary>Evidence behind each link</summary>
                <div className="stack" style={{ gap: 4, marginTop: 6 }}>{cl.links.map((l) => (
                  <div key={l.a + l.b} style={{ fontSize: 12 }}><b>{name(l.a)} ↔ {name(l.b)}</b> · {l.score} pts
                    {l.evidence.map((e) => <div key={e.kind} className="muted" style={{ paddingLeft: 10 }}>{KIND_LABEL[e.kind]} (+{e.points}): {e.detail.replace(/0x[0-9a-fA-F]{40}/g, (a) => name(a))}{e.txIds?.length ? <> · <button className="linkish" onClick={() => showTxs(e.txIds)}>show</button></> : null}</div>)}
                  </div>))}</div>
              </details>
              <div className="row"><button className="btn sm" onClick={() => showWallets(cl.members)}><Boxes size={13} />Show in graph</button></div>
              <div className="note warn" style={{ fontSize: 12 }}><Info size={12} style={{ verticalAlign: -2 }} /> Inferred from transaction relationships. Cluster membership does not prove common ownership.</div>
            </div>
          ))}
          {!r.clusters.length && <div className="empty">{c.txs.length ? 'No wallets met the linking threshold. This does not mean they are unrelated.' : 'No transfers loaded, so no relationships to analyse.'}</div>}
        </div>
      </div>
      <Method method={r.method} limits={r.limitations} />
    </div>
  )
}

const ORIGIN = { sample: 'Fictional sample source', external: 'External source', manual: 'Manually entered', case: 'Case data' }

function IdentityView({ c, openCase }) {
  const rows = c.wallets.map((w) => ({ w, m: candidateMatches(c, w.address) })).filter((x) => x.m.mentions > 0)
  const withMatch = rows.filter((x) => x.m.candidates.length)
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <div className="card-h"><h2>Candidate identity matches</h2><span className="dim" style={{ fontSize: 12 }}>{withMatch.length} of {c.wallets.length} wallets have an evidence-backed candidate</span></div>
        <div className="card-b stack" style={{ gap: 12 }}>
          {rows.map(({ w, m }) => (
            <div className="match" key={w.address}>
              <div className="spread"><span className="row" style={{ gap: 6 }}><CatDot cat={w.category} size={8} /><b>{w.label}</b><Addr a={w.address} n={6} /></span>
                <button className="btn sm" onClick={() => openCase(c.id, 'graph', w.address)}><Waypoints size={13} />Show in graph</button></div>
              {m.candidates.map((cand) => (
                <div key={cand.identifier} className="stack" style={{ gap: 4 }}>
                  <div className="spread"><b style={{ fontSize: 13 }}>{cand.identifier}</b><span className={`pill ${cand.band === 'High' ? 'teal' : 'lilac'}`}>{cand.band} · {cand.score} pts</span></div>
                  <div className="dim" style={{ fontSize: 12 }}>Method: {cand.method}. {cand.breakdown.join(' ')}</div>
                  <div style={{ fontSize: 12 }}>Supporting: {cand.supporting.map((x) => <span key={x.id}>{x.url && /^https?:/.test(x.url) && !/\.example\//.test(x.url) ? <a href={x.url} target="_blank" rel="noreferrer">{x.id} {x.publisher}</a> : <span>{x.id} {x.publisher}</span>} <span className="pill">{ORIGIN[x.origin] || x.origin}</span> </span>)}</div>
                  <div style={{ fontSize: 12 }} className="muted">Contradicting: {cand.contradicting.length ? cand.contradicting.map((x) => `${x.id} ${x.publisher} names "${x.names}"`).join('; ') : 'none found in the case evidence'}</div>
                </div>
              ))}
              {!m.candidates.length && <div className="muted" style={{ fontSize: 12.5 }}><b>{NO_MATCH}</b> {m.rejected.length ? `Rejected: ${m.rejected.map((x) => `"${x.identifier}" (${x.score} pts, ${x.supporting[0].publisher})`).join('; ')}, below the 35-point threshold.` : `${m.mentions} source${m.mentions > 1 ? 's mention' : ' mentions'} this wallet without naming an identifier.`}</div>}
            </div>
          ))}
          {!rows.length && <div className="empty">{NO_MATCH} No source in this case names any of its wallets.</div>}
          <div className="note" style={{ fontSize: 12 }}>Candidates are identifiers as published (entities, services or pseudonyms). A wallet address is not treated as a person, and behaviour or clustering never creates a match.</div>
        </div>
      </div>
      <Method title="Confidence method" method={IDENTITY_METHOD} limits={['Scores rank the evidence available in this case; they are not probabilities and do not establish identity.', c.sample ? 'This case uses fictional sources.' : 'External sources are matched on exact addresses but their content is not independently verified.']} />
    </div>
  )
}

// Cross-chain status of one bridge deposit, from the registry and any destination check run in this session.
function crossChainStatus(c, e, check) {
  const dest = knownService(e.service)?.destination || null
  if (c.sample) return e.trace === 'linked' ? { key: 'record', label: 'Linked by fictional record', tone: 'lilac', dest: `destination as recorded in ${e.linkedEvidence} (fictional)` } : { key: 'unconfirmed', label: 'Unconfirmed (sample)', tone: 'copper', dest: dest || 'not recorded' }
  if (check) {
    const m = { matched: ['confirmed', 'Confirmed match', 'teal'], ambiguous: ['ambiguous', 'Ambiguous', 'lilac'], unconfirmed: ['unconfirmed', 'Unconfirmed', 'copper'] }[check.status]
    return { key: m[0], label: m[1], tone: m[2], dest: check.destinationChain || dest, check }
  }
  if (dest === 'OP Mainnet') return { key: 'unchecked', label: 'Not checked yet', tone: '', dest }
  if (dest === 'Base') return { key: 'needs-key', label: 'Checkable with ETHERSCAN_API_KEY', tone: '', dest }
  return { key: 'unsupported', label: 'Unsupported: no matching rule', tone: 'copper', dest: dest || 'unknown' }
}

function CrossChainSummary({ c, deposits, checks, mixers, name }) {
  const rows = deposits.map((e) => ({ e, st: crossChainStatus(c, e, checks[e.txId]) }))
  const count = (k) => rows.filter((x) => x.st.key === k).length
  const live = !c.sample
  return (
    <div className="card">
      <div className="card-h"><h2>Cross-chain tracing</h2><span className="dim" style={{ fontSize: 12 }}>{rows.length} bridge deposit{rows.length === 1 ? '' : 's'} · {mixers} mixer deposit{mixers === 1 ? '' : 's'} (trace stops)</span></div>
      <div className="card-b stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          {live ? <>
            <span className="pill teal">Confirmed Ethereum → Optimism: {count('confirmed')}</span>
            <span className="pill">Not checked yet: {count('unchecked')}</span>
            <span className="pill lilac">Ambiguous: {count('ambiguous')}</span>
            <span className="pill copper">Unconfirmed: {count('unconfirmed')}</span>
            <span className="pill">Needs key (Base): {count('needs-key')}</span>
            <span className="pill copper">Unsupported bridges: {count('unsupported')}</span>
          </> : <>
            <span className="pill lilac">Linked by fictional record: {count('record')}</span>
            <span className="pill copper">Unconfirmed: {count('unconfirmed')}</span>
          </>}
        </div>
        {rows.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 300 }}>
            <table className="t">
              <thead><tr><th>Time (UTC)</th><th>Wallet</th><th>Source → destination</th><th>Status</th><th>Confidence</th><th>Transactions</th></tr></thead>
              <tbody>{rows.slice(0, 60).map(({ e, st }) => (
                <tr key={e.txId} style={{ cursor: 'default' }}>
                  <td className="mono">{fmtTime(e.ts).replace(' UTC', '')}</td><td>{name(e.wallet)}</td>
                  <td>Ethereum → {st.dest}</td><td><span className={`pill ${st.tone}`}>{st.label}</span></td>
                  <td>{st.check?.confidence || '—'}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{live && e.hash ? <a href={`https://etherscan.io/tx/${e.hash}`} target="_blank" rel="noreferrer noopener">{short(e.hash, 8)}</a> : short(e.hash || e.txId, 8)}
                    {st.check?.candidates?.length === 1 && <> → <a href={st.check.candidates[0].url} target="_blank" rel="noreferrer noopener">{short(st.check.candidates[0].hash, 8)}</a></>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
        {!rows.length && <div className="empty">{c.txs.length ? 'No bridge deposits in the loaded transfers.' : 'No transfers loaded.'}</div>}
        <div className="dim" style={{ fontSize: 12 }}>{live
          ? 'Only Ethereum → OP Mainnet ETH deposits through the Optimism standard bridge can be confirmed: exact amount, recipient and L2 standard-bridge sender within 60 minutes. Base uses the same rule but needs ETHERSCAN_API_KEY on the server. Other bridges have no matching rule, so their trails stay unconfirmed. Run a check with "Check destination chain" below.'
          : 'Sample case: the bridge leg is linked only by a fictional relay record; no destination chain is queried.'}</div>
      </div>
    </div>
  )
}

function ServicesView({ c, analysis, name, showTxs }) {
  const r = analysis.services
  const deposits = c.sample ? [] : r.events.filter((e) => e.kind === 'Bridge deposit' && /^0x[0-9a-f]{64}$/i.test(e.hash || ''))
  const allDeposits = r.events.filter((e) => e.kind === 'Bridge deposit')
  const [checks, setChecks] = useState({}) // txId -> bridge-trace result (this session)
  const TRACE = { stops: ['copper', 'Tracing stops'], uncertain: ['lilac', 'Uncertain'], linked: ['teal', 'Linked by record'] }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <CrossChainSummary c={c} deposits={allDeposits} checks={checks} mixers={r.events.filter((e) => e.kind === 'Mixer deposit').length} name={name} />
      <div className="card">
        <div className="card-h"><h2>All bridge and mixer interactions</h2><span className="dim" style={{ fontSize: 12 }}>{fmtUsdShort(r.totals.mixerInUsd)} into mixers · {fmtUsdShort(r.totals.bridgeOutUsd)} into bridges · {r.totals.stops} trace stop{r.totals.stops === 1 ? '' : 's'}</span></div>
        <div className="card-b table-wrap" style={{ maxHeight: 480 }}>
          {r.events.length ? (
            <table className="t">
              <thead><tr><th>Time (UTC)</th><th>Event</th><th>Wallet</th><th>Service</th><th className="r">Amount</th><th>Basis</th><th>Tracing</th></tr></thead>
              <tbody>{r.events.map((e) => (
                <tr key={e.txId + e.kind} onClick={() => showTxs([e.txId])} title={e.note}>
                  <td className="mono">{fmtTime(e.ts).replace(' UTC', '')}</td><td>{e.kind}</td><td>{name(e.wallet)}</td><td>{e.serviceName}</td>
                  <td className="r">{fmtUsdShort(e.usd || 0)}</td><td><span className="pill" title={e.basisDetail}>{e.basis}</span></td>
                  <td><span className={`pill ${TRACE[e.trace][0]}`}>{TRACE[e.trace][1]}</span><div className="dim" style={{ fontSize: 11.5, whiteSpace: 'normal' }}>{e.note}</div></td>
                </tr>))}</tbody>
            </table>
          ) : <div className="empty">{c.txs.length ? 'No interactions with known bridges or mixers in the loaded transfers.' : 'No transfers loaded.'}</div>}
        </div>
        {deposits.length > 0 && <div className="card-b stack" style={{ gap: 10, paddingTop: 0 }}>
          <div className="eyebrow">Destination-chain checks</div>
          {deposits.map((e) => <BridgeTrace key={e.txId} e={e} name={name} onResult={(res) => setChecks((m) => ({ ...m, [e.txId]: res }))} />)}
        </div>}
        {c.sample && r.events.some((e) => e.kind === 'Bridge deposit') && <div className="card-b" style={{ paddingTop: 0 }}><div className="note" style={{ fontSize: 12 }}>Sample case: the bridge leg is linked only by a fictional relay record. Live destination-chain checks run on live cases.</div></div>}
        <div className="card-b" style={{ paddingTop: 0 }}><div className="dim" style={{ fontSize: 12 }}>Basis: "registry" is a verified contract in GhostTrace's service registry; "case label" or "sample label" comes from the case data{c.sample ? ' (fictional)' : ''}. Click a row to see the transfer in the graph.</div></div>
      </div>
      <Method method={r.method} limits={r.limitations} />
    </div>
  )
}

const STATUS = { matched: ['teal', 'Destination matched'], ambiguous: ['lilac', 'Ambiguous'], unconfirmed: ['copper', 'Unconfirmed'] }
const fmtWei = (w) => { try { const b = BigInt(w); return `${(Number(b / 10n ** 12n) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH` } catch { return '—' } }

// Asks the backend to match one Ethereum bridge deposit to its destination-chain credit.
function BridgeTrace({ e, name, onResult }) {
  const { evidenceApi } = useApp()
  const [st, setSt] = useState({ state: 'idle' })
  const run = async () => {
    setSt({ state: 'loading' })
    try {
      const res = await fetch(`${evidenceApi}/bridge-trace?tx=${e.hash}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) throw new Error(body?.error?.message || `Bridge check answered ${res.status}`)
      setSt({ state: 'done', r: body }); onResult?.(body)
    } catch (err) { setSt({ state: 'error', error: err.name === 'TimeoutError' ? 'the check did not finish within 60 s' : err.message }) }
  }
  const r = st.r
  return (
    <div className="match">
      <div className="spread"><span style={{ fontSize: 12.5 }}><b>{name(e.wallet)}</b> → {e.serviceName} · {fmtUsdShort(e.usd || 0)} · <span className="mono">{short(e.hash, 10)}</span></span>
        {st.state !== 'done' && <button className="btn sm" onClick={run} disabled={st.state === 'loading' || !evidenceApi}>{st.state === 'loading' ? 'Checking…' : 'Check destination chain'}</button>}</div>
      {!evidenceApi && <div className="dim" style={{ fontSize: 12 }}>No backend configured for destination-chain checks.</div>}
      {st.state === 'error' && <div className="note warn" style={{ fontSize: 12 }}>Check failed: {String(st.error).replace(/\.+$/, '')}. The destination leg remains unconfirmed.</div>}
      {r && <>
        <div className="row" style={{ gap: 8 }}><span className={`pill ${STATUS[r.status][0]}`}>{STATUS[r.status][1]}</span>{r.confidence && <span className="pill">{r.confidence} confidence</span>}
          <span className="dim" style={{ fontSize: 12 }}>{r.sourceChain} → {r.destinationChain || 'unknown destination'}</span></div>
        <div style={{ fontSize: 12 }}>Source: <a href={r.sourceTx.url} target="_blank" rel="noreferrer noopener" className="mono">{short(r.sourceTx.hash, 10)}</a>{r.sourceTx.valueWei ? ` · ${fmtWei(r.sourceTx.valueWei)}` : ''}{r.recipient ? ` · recipient ${short(r.recipient, 8)}` : ''}</div>
        {r.candidates.map((x) => <div key={x.hash} style={{ fontSize: 12 }}>Destination: <a href={x.url} target="_blank" rel="noreferrer noopener" className="mono">{short(x.hash, 10)}</a> · {fmtWei(x.valueWei)} · {x.delaySec} s after the deposit</div>)}
        {r.method && <div className="dim" style={{ fontSize: 12 }}>Rule: {r.method}</div>}
        {r.checks.length > 0 && <ul className="dim" style={{ fontSize: 12, margin: 0, paddingLeft: 18 }}>{r.checks.map((x, i) => <li key={i}>{x.pass ? '✓' : '✗'} {x.check}: {x.detail}</li>)}</ul>}
        {r.notes.map((x, i) => <div key={i} className="note" style={{ fontSize: 12 }}>{x}</div>)}
      </>}
    </div>
  )
}
