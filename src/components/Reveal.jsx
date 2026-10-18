import { useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play, X, FileSearch, FileText, ShieldAlert, Sparkles, Fingerprint } from 'lucide-react'
import { useApp } from '../store.jsx'
import { CatDot, CATS } from './common.jsx'
import { Decode, ScoreRing } from './Motion.jsx'
import { fmtAmt, fmtUsdShort, short, DUST_USD } from '../lib/analysis.js'
import { fmtTime, fmtClock, fmtDay } from '../lib/util.js'
import { evidenceHighlight } from '../lib/evidence.js'

const STAGES = [
  { label: 'Wallet', icon: Fingerprint },
  { label: 'Timeline', icon: Play },
  { label: 'Evidence', icon: FileSearch },
  { label: 'Verdict', icon: ShieldAlert },
]
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

// The evidence reveal: one wallet, four animated stages, all driving the real graph.
export function RevealDock({ focus }) {
  const { active: c, analysis, reveal, setReveal, updateGraph, setSection, setSelection, tick } = useApp()
  const addr = reveal.wallet, stage = reveal.stage
  const w = analysis.idx.byAddr.get(addr)
  const r = analysis.risk.get(addr)
  const txs = useMemo(() => [...(analysis.idx.inTx.get(addr) || []), ...(analysis.idx.outTx.get(addr) || [])].filter((t) => t.usd >= DUST_USD).sort((a, b) => a.ts - b.ts), [analysis, addr])
  const osint = c.osint.filter((o) => o.matches.some((m) => m.address === addr))
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const name = (a) => analysis.idx.byAddr.get(a)?.label || short(a)
  const go = (s) => setReveal((v) => v && { ...v, stage: Math.max(0, Math.min(3, s)) })

  // stage effects on the graph
  useEffect(() => {
    setSelection({ type: 'wallet', id: addr, tab: 'overview' })
    if (stage === 0) { updateGraph({ highlight: { kind: 'reveal-wallet', nodes: [addr], edges: [] } }); focus([addr], 1.25) }
    if (stage === 1) { setStep(0); setPlaying(true) }
    if (stage === 2) {
      if (osint.length) updateGraph((g) => { const h = evidenceHighlight(c, osint); return { ...g, visible: [...new Set([...g.visible, ...h.nodes])], highlight: h } })
      else updateGraph({ highlight: { kind: 'reveal-wallet', nodes: [addr], edges: [] } })
      focus([addr], 1.1); tick('evidence')
    }
    if (stage === 3) {
      const refs = r.factors.flatMap((f) => f.refs).filter((id) => c.txs.some((t) => t.id === id))
      const nodes = new Set([addr]); refs.forEach((id) => { const t = c.txs.find((x) => x.id === id); nodes.add(t.from); nodes.add(t.to) })
      updateGraph((g) => ({ ...g, visible: [...new Set([...g.visible, ...nodes])], highlight: { kind: 'verdict', nodes: [...nodes], edges: refs } }))
      focus([...nodes], 1.1); tick('risk')
    }
  }, [stage, addr]) // eslint-disable-line react-hooks/exhaustive-deps

  // stage 1: replay this wallet's transfers one by one
  useEffect(() => {
    if (stage !== 1 || !txs.length) return
    const shown = txs.slice(0, step + 1)
    const nodes = new Set([addr]); shown.forEach((t) => { nodes.add(t.from); nodes.add(t.to) })
    updateGraph((g) => ({ ...g, visible: [...new Set([...g.visible, ...nodes])], highlight: { kind: 'reveal-timeline', edges: shown.map((t) => t.id), nodes: [...nodes], current: txs[step].id } }))
    if (step === 0) focus([addr, ...txs.flatMap((t) => [t.from, t.to])], 1.0)
    tick('evidence')
  }, [stage, step, txs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (stage !== 1 || !playing) return
    if (step >= txs.length - 1) {
      setPlaying(false)
      if (reveal.auto) { const id = setTimeout(() => go(2), 1400); return () => clearTimeout(id) }
      return
    }
    const id = setTimeout(() => setStep((s) => s + 1), reduced() ? 300 : 900)
    return () => clearTimeout(id)
  }, [stage, step, playing, txs.length, reveal.auto]) // eslint-disable-line react-hooks/exhaustive-deps
  // auto-advance the other stages
  useEffect(() => {
    if (!reveal.auto || stage === 1 || stage === 3) return
    const id = setTimeout(() => go(stage + 1), stage === 0 ? 2800 : 4600)
    return () => clearTimeout(id)
  }, [stage, reveal.auto]) // eslint-disable-line react-hooks/exhaustive-deps
  // keyboard
  useEffect(() => {
    const k = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      if (e.key === 'ArrowRight') go(stage + 1)
      if (e.key === 'ArrowLeft') go(stage - 1)
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setReveal(null); updateGraph({ highlight: null }) }
  if (!w) return null
  const s = r.stats
  const top = r.factors.slice(0, 3)
  const verdict = r.score == null ? `${w.label} is a victim wallet and is not risk-scored.`
    : `${w.label} scores ${r.score} (${r.band}) mainly because of ${top.map((f) => f.label.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1')}.`

  return (
    <section className="reveal" aria-label={`Evidence reveal for ${w.label}`}>
      <header className="rv-head">
        <div className="rv-title"><Sparkles size={14} color="var(--copper)" /><span className="eyebrow">Evidence reveal</span><b>{w.label}</b></div>
        <ol className="rv-steps">
          {STAGES.map((st, i) => (
            <li key={st.label}><button className={`rv-step ${i === stage ? 'on' : ''} ${i < stage ? 'done' : ''}`} onClick={() => go(i)} aria-current={i === stage ? 'step' : undefined}>
              <span className="rv-dot"><st.icon size={12} /></span><span>{st.label}</span></button></li>
          ))}
        </ol>
        <div className="rv-ctrl">
          <button className={`btn sm ${reveal.auto ? 'on' : ''}`} onClick={() => setReveal((v) => ({ ...v, auto: !v.auto }))} data-tip="Advance through the stages automatically">{reveal.auto ? <Pause size={13} /> : <Play size={13} />}Auto</button>
          <button className="btn sm icon" onClick={() => go(stage - 1)} disabled={stage === 0} aria-label="Previous stage"><ChevronLeft size={14} /></button>
          <button className="btn sm primary" onClick={() => stage === 3 ? close() : go(stage + 1)}>{stage === 3 ? 'Finish' : 'Next'}<ChevronRight size={14} /></button>
          <button className="btn sm ghost icon" onClick={close} aria-label="Close evidence reveal"><X size={14} /></button>
        </div>
        <div className="rv-progress"><div style={{ width: `${((stage + (stage === 1 && txs.length ? (step + 1) / txs.length : 1)) / 4) * 100}%` }} /></div>
      </header>

      <div className="rv-body" key={stage}>
        {stage === 0 && (
          <div className="rv-wallet">
            <ScoreRing score={r.score} band={r.band} size={92} stroke={8} />
            <div className="rv-col">
              <span className="eyebrow"><CatDot cat={w.category} /> {CATS[w.category]?.label} wallet · {w.chain}</span>
              <h2 className="rv-name"><Decode text={w.label} /></h2>
              <div className="mono dim rv-addr"><Decode text={w.address} speed={1.8} delay={0.2} /></div>
              <p className="rv-lede">Received <b className="tq">{fmtUsdShort(s.inUsd)}</b> and sent <b className="cu">{fmtUsdShort(s.outUsd)}</b> across {txs.length} transfers{txs.length ? <> between {fmtDay(txs[0].ts)} {fmtClock(txs[0].ts)} and {fmtDay(txs[txs.length - 1].ts)} {fmtClock(txs[txs.length - 1].ts)} UTC</> : ''}.</p>
              <div className="tags">{w.tags.map((t, i) => <span key={t} className="pill rv-pop" style={{ animationDelay: `${0.35 + i * 0.08}s` }}>{t}</span>)}</div>
            </div>
          </div>
        )}

        {stage === 1 && (
          <div className="rv-timeline">
            <div className="rv-tl-head">
              <button className="btn sm icon primary" onClick={() => { if (step >= txs.length - 1) setStep(0); setPlaying(!playing) }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
              <input type="range" min={0} max={Math.max(0, txs.length - 1)} value={step} onChange={(e) => { setPlaying(false); setStep(+e.target.value) }} aria-label="Transfer timeline" className="rv-range" />
              <span className="mono dim">{txs.length ? `${step + 1} / ${txs.length}` : '0 / 0'}</span>
            </div>
            <div className="rv-rows">
              {txs.slice(0, step + 1).map((t, i) => {
                const out = t.from === addr
                return (
                  <div key={t.id} className={`rv-row ${i === step ? 'now' : ''}`}>
                    <span className={`dir ${out ? 'out' : 'in'}`}>{out ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}</span>
                    <span className="mono rv-time">{fmtTime(t.ts).replace(' UTC', '').replace(/ \d{4},/, ',')}</span>
                    <b className="num">{fmtAmt(t.amount)} {t.asset}</b>
                    <span className="dim">{out ? 'to' : 'from'} {name(out ? t.to : t.from)}</span>
                    {(analysis.taint.edgeTaint.get(t.id) || 0) > 0.5 && <span className="pill copper">stolen funds</span>}
                  </div>
                )
              }).reverse()}
              {!txs.length && <div className="dim">No transfers loaded for this wallet.</div>}
            </div>
          </div>
        )}

        {stage === 2 && (
          <div className="rv-evidence">
            {osint.length ? osint.map((o, i) => {
              const m = o.matches.find((x) => x.address === addr)
              return (
                <article key={o.id} className="rv-clue" data-clue={o.id} style={{ animationDelay: `${0.1 + i * 0.18}s` }}>
                  <div className="spread"><span className="mono dim">{o.id} · {o.sourceType}</span><span className={`conf ${o.confidence}`}>{o.confidence}</span></div>
                  <b>{o.title}</b>
                  <p>{m.reason}</p>
                  <button className="linkish rv-link" onClick={() => setSection('osint', o.id)}>Open source capture →</button>
                </article>
              )
            }) : <div className="rv-empty">No public-source finding names this wallet. It was flagged on transaction behaviour alone, so the verdict rests on the chain data.</div>}
          </div>
        )}

        {stage === 3 && (
          <div className="rv-verdict">
            <ScoreRing score={r.score} band={r.band} size={84} stroke={8} />
            <div className="rv-col">
              <p className="rv-sentence">{verdict}</p>
              <div className="rv-factors">
                {r.factors.map((f, i) => (
                  <div key={f.id} className="rv-factor" style={{ animationDelay: `${0.1 + i * 0.09}s` }}>
                    <span>{f.label}</span><span className="rv-bar"><i style={{ width: `${Math.min(100, (f.points / 30) * 100)}%`, animationDelay: `${0.2 + i * 0.09}s` }} /></span><b>+{f.points}</b>
                  </div>
                ))}
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => setSection('risk')}><ShieldAlert size={13} />Full risk analysis</button>
                <button className="btn sm" onClick={() => setSection('reports')}><FileText size={13} />Build report</button>
              </div>
              {r.note && <div className="dim" style={{ fontSize: 12 }}>{r.note}</div>}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// Clue dock: every OSINT finding of the case as a card; selecting one beams to the wallet(s) it names.
export function ClueDock({ onClose, focus }) {
  const { active: c, analysis, gs, updateGraph } = useApp()
  const activeIds = gs.highlight?.kind === 'evidence' ? gs.highlight.ids : []
  const pick = (o) => {
    if (activeIds.length === 1 && activeIds[0] === o.id) { updateGraph({ highlight: null }); return }
    const h = evidenceHighlight(c, o)
    updateGraph((g) => ({ ...g, visible: [...new Set([...g.visible, ...h.nodes])], highlight: h }))
    focus(o.matches.map((m) => m.address), 1.15)
  }
  return (
    <aside className="clue-dock" aria-label="Public evidence clues">
      <div className="spread"><span className="eyebrow">Public evidence · {c.osint.length}</span><button className="btn ghost sm icon" onClick={onClose} aria-label="Close evidence clues"><X size={13} /></button></div>
      <div className="clue-list">
        {c.osint.map((o, i) => (
          <button key={o.id} data-clue={o.id} className={`clue ${activeIds.includes(o.id) ? 'on' : ''}`} style={{ animationDelay: `${i * 0.05}s` }} onClick={() => pick(o)}>
            <span className="spread"><span className="mono">{o.id}</span><span className={`conf ${o.confidence}`}>{o.confidence}</span></span>
            <b>{o.title}</b>
            <span className="dim">{o.matches.map((m) => analysis.idx.byAddr.get(m.address)?.label).join(', ')}</span>
          </button>
        ))}
        {!c.osint.length && <div className="dim">No OSINT findings in this case.</div>}
      </div>
    </aside>
  )
}
