import { useEffect, useState } from 'react'
import { Sparkles, ArrowDownLeft, ArrowUpRight, Expand, Route, GitFork, FileSearch, ShieldAlert, X, ExternalLink, MousePointerClick, Layers, Plus } from 'lucide-react'
import { useApp } from '../store.jsx'
import { CopyBtn, CatDot, CATS, Risk, Term } from './common.jsx'
import { Decode, ScoreRing } from './Motion.jsx'
import { fmtAmt, fmtUsdShort, short, SERVICE_CATS } from '../lib/analysis.js'
import { fmtTime, fmtUsd } from '../lib/util.js'

export function WalletInspector({ address, tab: initialTab, onReveal, onExpand, onTracePath, onDownstream, onClose }) {
  const { active: c, analysis, selectWallet, setSelection, setSection, tick, openEvidenceForm } = useApp()
  const [tab, setTab] = useState(initialTab || 'overview')
  useEffect(() => setTab(initialTab || 'overview'), [address, initialTab])
  const w = analysis.idx.byAddr.get(address)
  const rr = analysis.risk.get(address)
  useEffect(() => {
    if (tab === 'evidence' || tab === 'transfers') tick('evidence')
    if (tab === 'risk' && rr && rr.score != null) tick('risk')
  }, [tab, rr, tick])
  if (!w) return null
  const r = rr
  const s = r.stats
  const ins = analysis.idx.inTx.get(address) || [], outs = analysis.idx.outTx.get(address) || []
  const txs = [...ins, ...outs].sort((a, b) => b.ts - a.ts)
  const osint = c.osint.filter((o) => o.matches.some((m) => m.address === address))
  const cl = analysis.clusterOf.get(address)
  const tw = analysis.taint.walletTaint.get(address)
  const hop = analysis.hops.get(address)
  const assets = [...new Set([...Object.keys(s.inByAsset), ...Object.keys(s.outByAsset)])]


  return (
    <>
      <div className="insp-head">
        <div className="spread">
          <div className="row" style={{ gap: 8 }}><CatDot cat={w.category} size={11} /><span className="eyebrow">{CATS[w.category]?.label} wallet</span></div>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Close inspector"><X size={15} /></button>
        </div>
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 22 }}><Decode text={w.label} speed={1.4} /></h2>
            <div className="dim" style={{ fontSize: 12.5, marginTop: 2 }}>{w.chain}{cl ? <> · <Term k="cluster">Cluster {cl.id}</Term></> : ''}{hop != null ? <> · <Term k="hop">{hop} hop{hop === 1 ? '' : 's'}</Term> from suspect</> : ''}</div>
          </div>
          <div className="insp-score"><ScoreRing score={r.score} band={r.band} size={62} /><span className="eyebrow">{r.score == null ? 'Victim' : `${r.band} risk`}</span></div>
        </div>
        {r.score != null && <button className="btn primary reveal-cta" onClick={() => onReveal(address)}><Sparkles size={14} />Reveal the evidence<span className="dim-cta">wallet → timeline → evidence → verdict</span></button>}
        <div className="row">
          <button className="btn sm" onClick={() => onExpand(address)}><Expand size={13} />Expand neighbours</button>
          <button className="btn sm" onClick={() => onTracePath(address)}><Route size={13} />Trace funds</button>
          <button className="btn sm" onClick={() => onDownstream(address)}><GitFork size={13} />Follow funds</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {[['overview', 'Summary'], ['transfers', 'Transfers', txs.length], ['evidence', 'Evidence', osint.length], ['risk', 'Risk', r.factors.length], ['links', 'Links']].map(([id, l, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{l}{n != null && <span className="ct">{n}</span>}</button>
        ))}
      </div>
      <div className="insp-body">
        {tab === 'overview' && (
          <>
            {r.score != null && r.factors.length > 0 && (
              <div className="why">
                <div className="spread"><span className="eyebrow">Why this wallet is flagged</span><button className="linkish" style={{ fontSize: 12, color: 'var(--lilac)' }} onClick={() => setTab('risk')}>Full breakdown →</button></div>
                {r.factors.slice(0, 3).map((f, i) => (
                  <div className="why-row" key={f.id} style={{ animationDelay: `${0.08 + i * 0.07}s` }}><span className="fp">+{f.points}</span><span>{f.label}</span></div>
                ))}
              </div>
            )}
            <div className="flow-io">
              <div><span className="eyebrow">Money in</span><b style={{ color: 'var(--teal)' }}>{fmtUsdShort(s.inUsd)}</b><span className="dim mono">{Object.entries(s.inByAsset).map(([a, v]) => `${fmtAmt(v)} ${a}`).join(' · ') || '—'}</span></div>
              <div className="flow-arrow" aria-hidden="true"><span /></div>
              <div><span className="eyebrow">Money out</span><b style={{ color: 'var(--copper)' }}>{fmtUsdShort(s.outUsd)}</b><span className="dim mono">{Object.entries(s.outByAsset).map(([a, v]) => `${fmtAmt(v)} ${a}`).join(' · ') || '—'}</span></div>
            </div>
            <div className="field"><span className="lbl">Full address</span><div className="full-addr"><Decode text={w.address} speed={1.8} delay={0.15} /><CopyBtn text={w.address} label="Copy address" /></div></div>
            {assets.length === 0 && <div className="note warn">No transfers are loaded for this wallet yet. Connect a data source under Settings and press Refresh, or open a prepared case.</div>}
            <button className="linkish more-link" onClick={() => setTab('links')}>Labels, cluster and {s.counterparties.length} connected wallets →</button>
          </>
        )}
        {tab === 'links' && (
          <>
            <div className="field"><span className="lbl">Wallet facts</span>
              <div className="kv">
                <div><div className="k">Chain</div><div className="v">{w.chain}</div></div>
                <div><div className="k">Balance</div><div className="v">{w.balanceEth != null ? `${fmtAmt(w.balanceEth)} ETH` : 'Not available'}</div></div>
                <div><div className="k">Transfers</div><div className="v">{s.inCount} in · {s.outCount} out</div></div>
                <div><div className="k">Connected wallets</div><div className="v">{s.counterparties.length}</div></div>
                <div><div className="k">First seen</div><div className="v" style={{ fontSize: 12.5 }}>{fmtTime(w.firstSeen ?? s.first, false)}</div></div>
                <div><div className="k"><Term k="incident">Incident funds</Term></div><div className="v">{tw && tw.taintedUsd > 0 ? `${(tw.share * 100).toFixed(1)}%` : 'None traced'}</div><div className="dim" style={{ fontSize: 11.5 }}>{tw && tw.taintedUsd > 0 ? fmtUsdShort(tw.taintedUsd) + ' traced' : ''}</div></div>
              </div>
            </div>
            <div className="field"><span className="lbl">Known labels</span><div className="tags">{w.tags.length ? w.tags.map((t) => <span key={t} className="pill">{t}</span>) : <span className="dim">None</span>}</div></div>
            {cl && (
              <div className="note"><b style={{ color: 'var(--lilac)' }}>{cl.id} · {cl.name}</b> ({cl.confidence} confidence)<br />Method: {cl.method}. {cl.caveat}</div>
            )}
            <div className="field">
              <span className="lbl">Connected wallets</span>
              <div className="mini-list">
                {s.counterparties.map((a) => {
                  const cw = analysis.idx.byAddr.get(a); const cr = analysis.risk.get(a)
                  const n = txs.filter((t) => t.from === a || t.to === a).length
                  return (
                    <div className="mini-row" key={a}>
                      <CatDot cat={cw?.category} />
                      <button className="linkish grow" onClick={() => selectWallet(a, { reveal: true })}>{cw?.label || short(a)}</button>
                      <span className="dim mono">{n} tx</span>
                      <Risk r={cr} showBand={false} />
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
        {tab === 'transfers' && (
          <div className="mini-list">
            {txs.length === 0 && <div className="empty">No transfers loaded.</div>}
            {txs.map((t) => {
              const out = t.from === address
              const other = out ? t.to : t.from
              return (
                <button className="mini-row linkish" key={t.id} onClick={() => setSelection({ type: 'tx', id: t.id, focus: true })} style={{ width: '100%' }}>
                  <span className={`dir ${out ? 'out' : 'in'}`}>{out ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}</span>
                  <span className="grow"><b className="num">{fmtAmt(t.amount)} {t.asset}</b> <span className="dim">{out ? 'to' : 'from'} {analysis.idx.byAddr.get(other)?.label || short(other)}</span><br /><span className="dim mono" style={{ fontSize: 11 }}>{fmtTime(t.ts)}</span></span>
                  {analysis.taint.edgeTaint.get(t.id) > 0.5 && <span className="pill copper">tainted</span>}
                </button>
              )
            })}
          </div>
        )}
        {tab === 'evidence' && (
          <div className="stack">
            {osint.length === 0 && <div className="empty">No OSINT or manually entered evidence references this address.</div>}
            <div className="row"><button className="btn sm" onClick={() => openEvidenceForm({ caseRef: c.id, wallet: address })}><Plus size={13} />Add evidence for this wallet</button>
              <button className="btn sm ghost" onClick={() => setSection('osint')}><FileSearch size={13} />OSINT Evidence page</button></div>
            {osint.map((o) => (
              <div className="match" key={o.id}>
                <div className="spread"><b>{o.title}</b><span className={`conf ${o.confidence}`}>{o.confidence}</span></div>
                <div className="dim" style={{ fontSize: 12 }}>{o.id} · {o.sourceType} · collected {fmtTime(o.collected, false)}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}><b style={{ color: 'var(--text)' }}>Why it matches: </b>{o.matches.find((m) => m.address === address)?.reason}</div>
                <div className="row"><button className="btn sm" onClick={() => setSection('osint', o.id)} data-osint={o.id}><FileSearch size={13} />Open source capture</button></div>
              </div>
            ))}
          </div>
        )}
        {tab === 'risk' && (
          <div className="stack">
            {r.score == null ? <div className="note">{r.note}</div> : (
              <>
                <div className="score-dial"><span className={`big risk ${r.band}`}>{r.score}</span><div><div className={`risk ${r.band}`}>{r.band} risk</div><div className="dim" style={{ fontSize: 12 }}>Sum of {r.factors.length} weighted indicators{r.raw > 100 ? `, capped at 100 (raw ${r.raw})` : ''}</div></div></div>
                {r.note && <div className="note">{r.note}</div>}
                <div>
                  {r.factors.map((f) => (
                    <div className="factor" key={f.id}>
                      <span className="fl">{f.label}</span><span className="fp">+{f.points}</span>
                      <div className="fbar"><div style={{ width: `${Math.min(100, (f.points / 30) * 100)}%` }} /></div>
                      <span className="fd">{f.detail}</span>
                      {f.refs.length > 0 && <div className="refs">{f.refs.slice(0, 10).map((id) => <button key={id} className="ref" onClick={() => c.osint.some((o) => o.id === id) ? setSection('osint', id) : setSelection({ type: 'tx', id, focus: true })}>{id.replace(c.id + '-', '')}</button>)}{f.refs.length > 10 && <span className="dim" style={{ fontSize: 11 }}>+{f.refs.length - 10}</span>}</div>}
                    </div>
                  ))}
                  {r.factors.length === 0 && <div className="dim">No risk indicators triggered.</div>}
                </div>
                <button className="btn sm" onClick={() => setSection('risk')}><ShieldAlert size={13} />Open in Risk Analytics</button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

export function TxInspector({ id, onDownstream, onClose }) {
  const { active: c, analysis, selectWallet, setSection } = useApp()
  const t = c.txs.find((x) => x.id === id)
  if (!t) return null
  const from = analysis.idx.byAddr.get(t.from), to = analysis.idx.byAddr.get(t.to)
  const taint = analysis.taint.edgeTaint.get(t.id) || 0
  const osint = c.osint.filter((o) => o.relatedTx.includes(t.id))
  return (
    <>
      <div className="insp-head">
        <div className="spread"><span className="eyebrow">Transfer · {t.id}</span><button className="btn ghost sm icon" onClick={onClose} aria-label="Close inspector"><X size={15} /></button></div>
        <h2 style={{ fontSize: 24 }} className="num"><Decode text={`${fmtAmt(t.amount)} ${t.asset}`} /></h2>
        <div className="dim">{fmtUsd(t.usd)} at sample reference price · {t.method}</div>
        <div className="row"><button className="btn sm" onClick={() => onDownstream(t.to, t.ts)}><GitFork size={13} />Follow funds from here</button></div>
      </div>
      <div className="insp-body">
        <div className="stack">
          {[['From', from, t.from], ['To', to, t.to]].map(([k, w, a]) => (
            <div key={k} className="match" style={{ gap: 6 }}>
              <div className="spread"><span className="eyebrow">{k}</span><Risk r={analysis.risk.get(a)} /></div>
              <button className="linkish row" onClick={() => selectWallet(a, { reveal: true })}><CatDot cat={w?.category} /><b>{w?.label}</b></button>
              <div className="full-addr" style={{ fontSize: 11 }}><span>{a}</span><CopyBtn text={a} label="Copy address" /></div>
            </div>
          ))}
        </div>
        <div className="kv">
          <div><div className="k">Amount</div><div className="v">{fmtAmt(t.amount)} {t.asset}</div></div>
          <div><div className="k">Value</div><div className="v">{fmtUsd(t.usd)}</div></div>
          <div><div className="k">Timestamp</div><div className="v" style={{ fontSize: 12.5 }}>{fmtTime(t.ts)}</div></div>
          <div><div className="k">Block</div><div className="v mono">{t.block != null ? t.block.toLocaleString('en-US') : 'Not available'}</div></div>
          <div><div className="k">Function</div><div className="v mono">{t.method}</div></div>
          <div><div className="k">Incident funds</div><div className="v" style={{ color: taint > 0 ? 'var(--copper)' : undefined }}>{taint > 0 ? `${(taint * 100).toFixed(1)}%` : 'None'}</div></div>
        </div>
        <div className="field"><span className="lbl">Transaction hash</span><div className="full-addr"><span>{t.hash}</span><CopyBtn text={t.hash} label="Copy hash" /></div></div>
        {t.note && <div className="note">{t.note}</div>}
        <div className="field"><span className="lbl">Source</span><div className="muted" style={{ fontSize: 12.5 }}>{t.source}. Block-explorer links appear when a live chain source is connected.</div></div>
        {osint.length > 0 && (
          <div className="field"><span className="lbl">Referenced in OSINT</span>
            {osint.map((o) => <button key={o.id} className="mini-row linkish" onClick={() => setSection('osint', o.id)} style={{ width: '100%' }}><FileSearch size={14} color="var(--lilac)" /><span className="grow">{o.id} · {o.title}</span><ExternalLink size={13} className="dim" /></button>)}
          </div>
        )}
      </div>
    </>
  )
}

export function EmptyInspector() {
  const { active: c, analysis, selectWallet } = useApp()
  const top = c.wallets.map((w) => ({ w, r: analysis.risk.get(w.address) })).filter((x) => x.r.score != null && !SERVICE_CATS.has(x.w.category)).sort((a, b) => b.r.score - a.r.score).slice(0, 6)
  return (
    <div className="insp-body">
      <div className="stack">
        <div className="row"><MousePointerClick size={16} color="var(--lilac)" /><h3>Select a wallet or transfer</h3></div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Click a node to open its details and highlight its transfers. Click an arrow to inspect a single transfer. Double-click a node with a double ring to reveal hidden neighbours.</p>
      </div>
      <div className="field">
        <span className="lbl">Highest-risk wallets in this case</span>
        <div className="mini-list">
          {top.map(({ w, r }) => (
            <div className="mini-row" key={w.address}>
              <CatDot cat={w.category} />
              <button className="linkish grow" onClick={() => selectWallet(w.address, { reveal: true, tab: 'overview' })}>{w.label}</button>
              <span className="dim mono">{short(w.address, 4)}</span>
              <Risk r={r} showBand={false} />
            </div>
          ))}
        </div>
      </div>
      <div className="note"><Layers size={13} style={{ verticalAlign: -2 }} /> Node colour shows the wallet category. The outer ring shows risk: <span style={{ color: 'var(--risk-high)' }}>high</span>, <span style={{ color: 'var(--risk-elev)' }}>elevated</span>, <span style={{ color: 'var(--risk-low)' }}>low</span>. Copper arrows carry traced incident funds.</div>
    </div>
  )
}

