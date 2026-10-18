import { useEffect, useMemo, useRef, useState } from 'react'
import { SlidersHorizontal, Tag, ZoomIn, ZoomOut, Maximize, LayoutGrid, Image as ImageIcon, Boxes, RotateCcw, Expand, X, ChevronDown, Route, PanelRightClose, PanelRightOpen, Play, Pause, SkipBack, History, ScanSearch, FileSearch } from 'lucide-react'
import { RevealDock, ClueDock } from '../components/Reveal.jsx'
import { useApp } from '../store.jsx'
import GraphCanvas from '../components/GraphCanvas.jsx'
import { WalletInspector, TxInspector, EmptyInspector } from '../components/Inspector.jsx'
import { CATS } from '../components/common.jsx'
import { fmtAmt, fmtUsdShort, tracePaths, downstream, short } from '../lib/analysis.js'
import { fmtTime, fmtUsd, saveFile } from '../lib/util.js'

export default function GraphWorkspace() {
  const app = useApp()
  const { active: c, analysis, gs, updateGraph, filtered, selection, setSelection, selectWallet, notify, defaultFilters, tick, replay, setReplay, panelOpen, setPanelOpen, reveal, setReveal, evidenceOpen, setEvidenceOpen, setSection } = app
  const [speed, setSpeed] = useState(1)
  const graph = useRef(null)
  const [showFilters, setShowFilters] = useState(false)
  const [showView, setShowView] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [xray, setXray] = useState(true)
  const f = gs.filters

  useEffect(() => { tick('graph') }, [tick])
  useEffect(() => { const t = setTimeout(() => graph.current?.cy()?.resize(), 360); return () => clearTimeout(t) }, [panelOpen])
  useEffect(() => { if (selection && !reveal) setPanelOpen(true) }, [selection, setPanelOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (reveal) { setReplay(null); setEvidenceOpen(false) } }, [reveal?.wallet]) // eslint-disable-line react-hooks/exhaustive-deps

  // timeline replay: steps through the visible transfers in time order
  const steps = useMemo(() => [...filtered.txs].sort((a, b) => a.ts - b.ts), [filtered])
  const playhead = replay && steps.length ? { t: steps[Math.min(replay.i, steps.length - 1)].ts, window: steps[Math.min(replay.i, steps.length - 1)].ts - (replay.i > 0 ? steps[replay.i - 1].ts : -Infinity) } : null
  useEffect(() => {
    if (!replay?.playing) return
    if (replay.i >= steps.length - 1) { setReplay((r) => r && { ...r, playing: false }); return }
    const id = setTimeout(() => setReplay((r) => r && { ...r, i: r.i + 1 }), 650 / speed)
    return () => clearTimeout(id)
  }, [replay, steps.length, setReplay, speed])

  // camera: frame a set of wallets smoothly (used by the reveal and the evidence beams)
  const focus = (ids, maxZoom = 1.2) => {
    const k = graph.current?.cy(); if (!k) return
    const eles = k.collection(ids.map((id) => k.getElementById(id)).filter((e) => e.nonempty()))
    if (!eles.length) return
    if (eles.length === 1) k.animate({ center: { eles }, zoom: Math.min(maxZoom, Math.max(k.zoom(), 0.9)) }, { duration: 750, easing: 'ease-in-out-cubic' })
    else k.animate({ fit: { eles, padding: 120 } }, { duration: 750, easing: 'ease-in-out-cubic', complete: () => { if (k.zoom() > maxZoom) k.animate({ zoom: { level: maxZoom, position: eles.boundingBox ? { x: (eles.boundingBox().x1 + eles.boundingBox().x2) / 2, y: (eles.boundingBox().y1 + eles.boundingBox().y2) / 2 } : undefined } }, { duration: 300 }) } })
  }
  const startReveal = (addr) => { setPanelOpen(false); setReveal({ wallet: addr, stage: 0, auto: true }) }

  const expand = (addr) => {
    const add = new Set(gs.visible)
    let n = 0
    for (const t of c.txs) {
      if (t.from === addr && !add.has(t.to)) { add.add(t.to); n++ }
      if (t.to === addr && !add.has(t.from)) { add.add(t.from); n++ }
    }
    updateGraph({ visible: [...add] })
    selectWallet(addr)
    notify(n ? `Added ${n} neighbouring wallet${n > 1 ? 's' : ''} to the graph` : 'All neighbours of this wallet are already shown', n ? 'ok' : 'info')
  }

  const tracePath = (addr) => {
    const origins = [...c.taintSources, c.primarySuspect].filter((o) => o && o !== addr)
    let paths = []
    let origin = null
    for (const o of origins) { paths = tracePaths(c, analysis.idx, o, addr); if (paths.length) { origin = o; break } }
    if (!paths.length) { notify('No time-ordered path from the incident reaches this wallet', 'warn'); return }
    const p = paths[0]
    const nodes = [origin, ...p.txs.map((t) => t.to)]
    updateGraph((g) => ({ ...g, visible: [...new Set([...g.visible, ...nodes])], highlight: { kind: 'path', edges: p.txs.map((t) => t.id), nodes, txs: p.txs, alt: paths.length - 1, origin, target: addr } }))
    selectWallet(addr)
  }
  const followFunds = (addr, since) => {
    const d = downstream(analysis.idx, addr, since)
    if (!d.edges.size) { notify('No onward transfers from this point', 'info'); return }
    updateGraph((g) => ({ ...g, visible: [...new Set([...g.visible, ...d.nodes])], highlight: { kind: 'downstream', edges: [...d.edges], nodes: [...d.nodes], origin: addr } }))
    notify(`Following ${d.edges.size} onward transfers across ${d.nodes.size - 1} wallets`, 'ok')
  }

  const setF = (patch) => updateGraph((g) => ({ ...g, filters: { ...g.filters, ...patch } }))
  const df = defaultFilters(c)
  const activeFilterCount = [f.minUsd > 0, f.from > df.from || f.to < df.to, f.assets.length < df.assets.length, !f.hideDust, f.taintedOnly].filter(Boolean).length
  const hiddenCount = c.wallets.length - gs.visible.length
  const hl = gs.highlight

  const exportPng = async () => {
    const blob = graph.current?.png({ output: 'blob' })
    if (!blob) return
    const r = await saveFile(`${c.id}-graph.png`, blob)
    notify(r.msg, r.ok ? 'ok' : 'warn')
  }

  return (
    <div className={`ws ws-noledger ${panelOpen ? '' : 'panel-min'}`}>
      <div className="ws-toolbar" style={{ position: 'relative' }}>
        <div className="ws-title"><b>{c.title}</b><span className="dim" style={{ fontSize: 12 }}>{gs.visible.length} wallets · {filtered.txs.length} transfers{c.sample ? ' · sample data' : ''}</span></div>
        <button className={`btn sm ${replay ? 'on' : ''}`} onClick={() => setReplay(replay ? null : { i: 0, playing: true })} data-tip="Replay every transfer in the order it happened"><History size={13} />{replay ? 'Exit replay' : 'Replay'}</button>
        <button className={`btn sm ${evidenceOpen ? 'on' : ''}`} onClick={() => setEvidenceOpen(!evidenceOpen)} aria-expanded={evidenceOpen} data-tip="Public evidence clues. Pick one to see which wallet it points to and how confident the link is."><FileSearch size={13} />Evidence</button>
        <button className="btn sm" onClick={() => setSection('osint')} data-tip="Open the OSINT Evidence page: public-source and manually entered evidence, and the Add Evidence form"><FileSearch size={13} />OSINT Evidence{c.osint.length ? ` · ${c.osint.length}` : ''}</button>
        <button className={`btn sm ${showFilters || activeFilterCount ? 'on' : ''}`} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}><SlidersHorizontal size={13} />Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}</button>
        <div className="menu-wrap">
          <button className={`btn sm ${showView ? 'on' : ''}`} onClick={() => setShowView((v) => !v)} aria-expanded={showView}><LayoutGrid size={13} />View<ChevronDown size={13} /></button>
          {showView && (
            <div className="menu-pop" role="menu" onMouseLeave={() => setShowView(false)}>
              <button role="menuitemcheckbox" aria-checked={f.showClusters} onClick={() => setF({ showClusters: !f.showClusters })} data-tip="Group wallets linked by a stated method. A cluster is a lead, not proof of common ownership."><Boxes size={14} />{f.showClusters ? 'Hide' : 'Show'} wallet clusters</button>
              <button role="menuitemcheckbox" aria-checked={showKey} onClick={() => setShowKey(!showKey)}><Tag size={14} />{showKey ? 'Hide' : 'Show'} colour key</button>
              <button role="menuitem" disabled={!hiddenCount} onClick={() => { updateGraph({ visible: c.wallets.map((w) => w.address) }); notify(`Revealed ${hiddenCount} hidden wallets`, 'ok'); setShowView(false) }}><Expand size={14} />Show all wallets{hiddenCount ? ` (+${hiddenCount})` : ''}</button>
              <button role="menuitem" onClick={() => { graph.current.relayout(); setShowView(false) }}><LayoutGrid size={14} />Tidy layout</button>
              <button role="menuitem" onClick={() => { exportPng(); setShowView(false) }}><ImageIcon size={14} />Export as image</button>
              <hr />
              <button role="menuitem" onClick={() => { updateGraph({ visible: c.initialVisible, filters: df, highlight: null }); setSelection(null); setReplay(null); setShowView(false) }}><RotateCcw size={14} />Reset view</button>
            </div>
          )}
        </div>
        <button className="btn sm ghost panel-toggle" onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen} aria-label={panelOpen ? 'Hide details panel' : 'Show details panel'}>{panelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}Details</button>
        {showFilters && <FiltersPop f={f} df={df} setF={setF} c={c} onClose={() => setShowFilters(false)} />}
      </div>

      <div className="ws-canvas">
        {c.txs.length === 0 && (
          <div className="empty-graph"><div style={{ maxWidth: 380 }}><h2>No transfers loaded</h2><p className="muted">This case has a seed wallet but no transaction data. Connect a data source and press Refresh, or open one of the prepared sample cases from Investigations.</p></div></div>
        )}
        <GraphCanvas ref={graph} c={c} analysis={analysis} txs={filtered.txs} visible={filtered.visible} selection={selection} highlight={hl}
          showClusters={f.showClusters} showAmounts={f.showAmounts} playhead={playhead} xray={xray && !reveal}
          onSelectNode={(id) => { if (reveal) { if (id !== reveal.wallet) setReveal({ wallet: id, stage: 0, auto: reveal.auto }); return } if (hl && !(hl.nodes || []).includes(id)) updateGraph({ highlight: null }); selectWallet(id) }}
          onSelectEdge={(id) => { if (reveal) return; if (hl && !(hl.edges || []).includes(id)) updateGraph({ highlight: null }); setSelection({ type: 'tx', id }) }}
          onClear={() => { if (reveal) return; setSelection(null); updateGraph({ highlight: null }) }} onExpand={expand} />
        <div className="canvas-tools">
          <button className={`btn icon ${xray ? 'on' : ''}`} data-tip={xray ? 'X-ray lens on: hover the graph to see how much of each transfer is stolen money and each wallet\'s risk score. Click to turn off.' : 'Turn on the X-ray lens'} aria-label="Toggle X-ray lens" aria-pressed={xray} onClick={() => setXray(!xray)}><ScanSearch size={16} /></button>
          <button className="btn icon" title="Zoom in" aria-label="Zoom in" onClick={() => graph.current.zoom(1.3)}><ZoomIn size={16} /></button>
          <button className="btn icon" title="Zoom out" aria-label="Zoom out" onClick={() => graph.current.zoom(1 / 1.3)}><ZoomOut size={16} /></button>
          <button className="btn icon" title="Fit to screen" aria-label="Fit to screen" onClick={() => graph.current.fit()}><Maximize size={16} /></button>
        </div>
        {hl && !reveal && ['path', 'downstream', 'evidence'].includes(hl.kind) && (
          <div className="path-banner">
            <Route size={16} color="var(--lilac)" style={{ flex: 'none', marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {hl.kind === 'path' ? (
                <>
                  <b>Strongest path from {analysis.idx.byAddr.get(hl.origin)?.label} to {analysis.idx.byAddr.get(hl.target)?.label}</b>
                  <span className="dim"> · {hl.txs.length} transfers, bottleneck {fmtUsdShort(Math.min(...hl.txs.map((t) => t.usd)))}{hl.alt ? ` · ${hl.alt} other path${hl.alt > 1 ? 's' : ''}` : ''}</span>
                  <div className="steps">
                    {hl.txs.map((t, i) => (
                      <span key={t.id} className="row" style={{ gap: 4 }}>
                        {i === 0 && <button className="ref" onClick={() => selectWallet(t.from)}>{analysis.idx.byAddr.get(t.from)?.label}</button>}
                        <button className="ref" style={{ borderColor: 'rgba(216,161,220,.5)' }} onClick={() => setSelection({ type: 'tx', id: t.id })}>→ {fmtAmt(t.amount)} {t.asset} · {fmtTime(t.ts).slice(-12, -7)}</button>
                        <button className="ref" onClick={() => selectWallet(t.to)}>{analysis.idx.byAddr.get(t.to)?.label}</button>
                      </span>
                    ))}
                  </div>
                </>
              ) : hl.kind === 'evidence' ? (
                <>{c.osint.filter((o) => hl.ids.includes(o.id)).map((o) => (
                  <div key={o.id}><b>{o.id} · {o.title}</b> <span className={`conf ${o.confidence}`}>{o.confidence}</span>
                    <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{o.matches.map((m) => `${analysis.idx.byAddr.get(m.address)?.label}: ${m.reason}`).join(' ')}</div></div>
                ))}</>
              ) : (
                <><b>Funds flowing onward from {analysis.idx.byAddr.get(hl.origin)?.label}</b><span className="dim"> · {hl.edges.length} transfers reach {hl.nodes.length - 1} wallets, in time order</span></>
              )}
            </div>
            <button className="btn ghost sm icon" onClick={() => updateGraph({ highlight: null })} aria-label="Clear highlight"><X size={14} /></button>
          </div>
        )}
        {steps.length > 0 && !reveal && replay && <Timeline steps={steps} replay={replay} setReplay={setReplay} analysis={analysis} speed={speed} setSpeed={setSpeed} />}
        {reveal && <RevealDock focus={focus} />}
        {evidenceOpen && !reveal && <ClueDock focus={focus} onClose={() => { setEvidenceOpen(false); if (hl?.kind === 'evidence') updateGraph({ highlight: null }) }} />}
        {showKey && <div className="legend">
          {['suspect', 'intermediary', 'mixer', 'exchange', 'bridge', 'victim'].filter((k) => c.wallets.some((w) => w.category === k)).map((k) => <span key={k}><i style={{ background: CATS[k].color }} />{CATS[k].label}</span>)}
          <span><i style={{ background: 'transparent', border: '3px double var(--text-2)' }} />Has hidden neighbours</span>
        </div>}
        {!selection && !hl && !replay && !reveal && !evidenceOpen && c.txs.length > 0 && (
          <div className="graph-hint"><b>Start here:</b> click a wallet to see why it matters, or press <b>Replay</b> to watch the money move.</div>
        )}
      </div>

      <aside className="inspector" aria-label="Investigation details" aria-hidden={!panelOpen}>
        <div className="insp-anim" key={selection ? selection.type + selection.id : 'empty'}>
        {selection?.type === 'wallet' ? <WalletInspector address={selection.id} tab={selection.tab} onReveal={startReveal} onExpand={expand} onTracePath={tracePath} onDownstream={followFunds} onClose={() => setSelection(null)} />
          : selection?.type === 'tx' ? <TxInspector id={selection.id} onDownstream={followFunds} onClose={() => setSelection(null)} />
            : <EmptyInspector />}
        </div>
      </aside>

    </div>
  )
}

function Timeline({ steps, replay, setReplay, analysis, speed, setSpeed }) {
  const max = Math.max(...steps.map((t) => t.usd))
  const i = replay ? Math.min(replay.i, steps.length - 1) : steps.length - 1
  const cur = steps[i]
  const name = (a) => analysis.idx.byAddr.get(a)?.label || short(a)
  const pct = steps.length > 1 ? (i / (steps.length - 1)) * 100 : 100
  return (
    <div className={`timeline-bar ${replay ? 'on' : ''}`}>
      <div className="tl-controls">
        <button className="btn sm icon" aria-label="Restart replay" onClick={() => setReplay({ i: 0, playing: true })}><SkipBack size={13} /></button>
        <button className="btn sm icon primary" aria-label={replay?.playing ? 'Pause replay' : 'Play replay'} onClick={() => setReplay(replay ? { ...replay, playing: !replay.playing, i: replay.i >= steps.length - 1 ? 0 : replay.i } : { i: 0, playing: true })}>{replay?.playing ? <Pause size={13} /> : <Play size={13} />}</button>
      </div>
      <div className="tl-track">
        <div className="tl-bars">
          {steps.map((t, k) => (
            <button key={t.id} className={`tl-tick ${k <= i ? 'past' : ''} ${k === i && replay ? 'now' : ''} ${(analysis.taint.edgeTaint.get(t.id) || 0) > 0.5 ? 'taint' : ''}`}
              style={{ height: `${18 + 82 * Math.max(0.05, Math.log10(t.usd + 1) / Math.log10(max + 1))}%` }}
              onClick={() => setReplay({ i: k, playing: false })} aria-label={`Jump to transfer ${k + 1}`} tabIndex={-1} />
          ))}
        </div>
        <div className="tl-head" style={{ left: `${pct}%` }} />
        <input className="tl-range" type="range" min={0} max={steps.length - 1} value={i} aria-label="Timeline position" onChange={(e) => setReplay({ i: +e.target.value, playing: false })} />
      </div>
      <div className="tl-speed" role="group" aria-label="Replay speed">{[0.5, 1, 2].map((v) => <button key={v} className={`chip ${speed === v ? 'on' : ''}`} onClick={() => setSpeed(v)}>{v}×</button>)}</div>
      <div className="tl-label">
        <span className="mono">{fmtTime(cur.ts).replace(' UTC', '').replace(/ \d{4},/, ',')}</span>
        <span className="tl-what">{replay ? <><b>{name(cur.from)}</b> → <b>{name(cur.to)}</b> · {fmtAmt(cur.amount)} {cur.asset}</> : `${steps.length} transfers · press play to replay the flow`}</span>
      </div>
    </div>
  )
}

function FiltersPop({ f, df, setF, c, onClose }) {
  const maxUsd = Math.max(...c.txs.map((t) => t.usd), 1)
  const steps = [0, 1, 100, 1000, 10000, 100000, 500000, 1000000, 2000000].filter((v) => v <= maxUsd)
  const span = df.to - df.from || 1
  return (
    <div className="filters-pop" role="dialog" aria-label="Graph filters">
      <div className="spread"><h3>Filter transfers</h3><button className="btn ghost sm icon" onClick={onClose} aria-label="Close filters"><X size={14} /></button></div>
      <div className="field">
        <label htmlFor="f-min">Minimum value <b className="num">{f.minUsd ? fmtUsd(f.minUsd) : 'Any'}</b></label>
        <input id="f-min" type="range" min={0} max={steps.length - 1} step={1} value={Math.max(0, steps.findIndex((s) => s >= f.minUsd))} onChange={(e) => setF({ minUsd: steps[+e.target.value] })} />
      </div>
      <div className="field">
        <label htmlFor="f-from">From <b className="mono">{fmtTime(f.from, false)}</b></label>
        <input id="f-from" type="range" min={0} max={1000} value={Math.round(((f.from - df.from) / span) * 1000)} onChange={(e) => setF({ from: Math.min(f.to, df.from + (span * +e.target.value) / 1000) })} />
        <label htmlFor="f-to">To <b className="mono">{fmtTime(f.to, false)}</b></label>
        <input id="f-to" type="range" min={0} max={1000} value={Math.round(((f.to - df.from) / span) * 1000)} onChange={(e) => setF({ to: Math.max(f.from, df.from + (span * +e.target.value) / 1000) })} />
        <div className="chips">
          <button className="chip" onClick={() => setF({ from: c.attackStart - 3600000, to: c.attackStart + 6 * 3600000 })}>First 6 h of incident</button>
          <button className="chip" onClick={() => setF({ from: c.attackStart, to: df.to })}>After incident</button>
          <button className="chip" onClick={() => setF({ from: df.from, to: df.to })}>All time</button>
        </div>
      </div>
      <div className="field"><span className="lbl">Assets</span>
        <div className="chips">{df.assets.map((a) => <button key={a} className={`chip ${f.assets.includes(a) ? 'on' : ''}`} onClick={() => setF({ assets: f.assets.includes(a) ? f.assets.filter((x) => x !== a) : [...f.assets, a] })}>{a}</button>)}</div>
      </div>
      <label className="check"><input type="checkbox" checked={f.showAmounts} onChange={(e) => setF({ showAmounts: e.target.checked })} />Show amounts on arrows</label>
      <label className="check"><input type="checkbox" checked={f.hideDust} onChange={(e) => setF({ hideDust: e.target.checked })} />Hide <span className="term" data-tip="Tiny transfers (under $1) often sent to plant look-alike addresses in a victim's history. They rarely move real value.">dust</span> transfers (under $1)</label>
      <label className="check"><input type="checkbox" checked={f.taintedOnly} onChange={(e) => setF({ taintedOnly: e.target.checked })} />Only transfers carrying <span className="term" data-tip="Value traced back to the stolen funds. Each wallet passes on the same share of stolen value it received (the haircut method).">incident funds</span></label>
      <button className="btn sm ghost" onClick={() => setF({ ...df, showClusters: f.showClusters, showAmounts: f.showAmounts })}><RotateCcw size={13} />Clear filters</button>
    </div>
  )
}
