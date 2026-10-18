import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { CATS } from './common.jsx'
import { short, fmtAmt, SERVICE_CATS } from '../lib/analysis.js'

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

cytoscape.use(dagre)

const RING = { High: '#ec7b86', Elevated: '#e3b26a', Low: '#78beb9', Minimal: '#6f5e78', Victim: '#faf0f7' }

export function buildElements({ c, analysis, txs, visible, selected, showClusters, showAmounts }) {
  const used = new Set()
  for (const t of txs) { used.add(t.from); used.add(t.to) }
  if (selected && visible.has(selected)) used.add(selected)
  if (c.seed && visible.has(c.seed)) used.add(c.seed)
  const allCounter = new Map()
  for (const t of c.txs) {
    if (!allCounter.has(t.from)) allCounter.set(t.from, new Set())
    if (!allCounter.has(t.to)) allCounter.set(t.to, new Set())
    allCounter.get(t.from).add(t.to); allCounter.get(t.to).add(t.from)
  }
  const vol = new Map()
  for (const t of txs) { vol.set(t.from, (vol.get(t.from) || 0) + t.usd); vol.set(t.to, (vol.get(t.to) || 0) + t.usd) }
  const els = []
  const parents = new Set()
  for (const w of c.wallets) {
    if (!used.has(w.address)) continue
    const r = analysis.risk.get(w.address)
    const hidden = [...(allCounter.get(w.address) || [])].filter((a) => !visible.has(a)).length
    const v = vol.get(w.address) || 0
    const size = Math.max(26, Math.min(64, 20 + Math.log10(v + 10) * 5.2))
    const cl = showClusters ? analysis.clusterOf.get(w.address) : null
    if (cl) parents.add(cl.id)
    els.push({
      group: 'nodes',
      data: {
        id: w.address, parent: cl ? 'cl:' + cl.id : undefined,
        label: `${w.label}\n${short(w.address, 6)}${hidden ? `   +${hidden}` : ''}`,
        cat: w.category, color: CATS[w.category]?.color || '#888',
        ring: r?.score == null ? RING.Victim : SERVICE_CATS.has(w.category) ? '#3c2d45' : RING[r.band],
        ringW: r?.score != null && r.score >= 40 && !SERVICE_CATS.has(w.category) ? 4 : 2,
        size, hidden, name: w.label, score: r?.score ?? null,
      },
      classes: [hidden ? 'expandable' : '', w.address === c.primarySuspect ? 'suspect' : '',
        r?.score != null && !SERVICE_CATS.has(w.category) ? (r.score >= 70 ? 'pulse glow' : r.score >= 40 ? 'glow' : '') : ''].join(' '),
    })
  }
  for (const id of parents) {
    const cl = c.clusters.find((x) => x.id === id)
    els.push({ group: 'nodes', data: { id: 'cl:' + id, label: `${cl.name} · ${cl.method}` }, classes: 'cluster' })
  }
  for (const t of txs) {
    const taint = analysis.taint.edgeTaint.get(t.id) || 0
    els.push({
      group: 'edges',
      data: {
        id: t.id, source: t.from, target: t.to,
        label: showAmounts ? `${fmtAmt(t.amount)} ${t.asset}` : '',
        w: Math.max(1.2, Math.min(9, Math.log10(t.usd + 1) - 1.6)), taint, ts: t.ts, amt: `${fmtAmt(t.amount)} ${t.asset}`,
      },
      classes: taint > 0.5 ? 'tainted' : '',
    })
  }
  return els
}

export const graphStyle = (light) => [
  { selector: 'node', style: {
    'background-color': 'data(color)', 'border-color': 'data(ring)', 'border-width': 'data(ringW)',
    width: 'data(size)', height: 'data(size)', label: 'data(label)', 'text-wrap': 'wrap',
    'text-valign': 'bottom', 'text-margin-y': 7, color: light ? '#2a1f30' : '#faf0f7', 'font-size': 10.5,
    'font-family': 'IBM Plex Sans, system-ui, sans-serif', 'text-outline-color': light ? '#f7eef4' : '#1c1422', 'text-outline-width': 2.5,
    'overlay-opacity': 0, 'transition-property': 'opacity, border-width, border-color, underlay-padding, underlay-opacity', 'transition-duration': '260ms', 'transition-timing-function': 'ease-out', 'min-zoomed-font-size': 7,
  } },
  { selector: 'node.expandable', style: { 'border-style': 'double', 'border-width': 5 } },
  { selector: 'node.glow', style: { 'underlay-color': '#e3b26a', 'underlay-padding': 7, 'underlay-opacity': 0.16, 'underlay-shape': 'ellipse' } },
  { selector: 'node.pulse', style: { 'underlay-color': '#c47f59', 'underlay-opacity': 0.3 } },
  { selector: '.future', style: { opacity: 0.05, 'text-opacity': 0, events: 'no' } },
  { selector: 'edge.fresh', style: { 'line-color': '#faf0f7', 'target-arrow-color': '#faf0f7', 'underlay-color': '#c47f59', 'underlay-padding': 6, 'underlay-opacity': 0.5, 'z-index': 30, opacity: 1 } },
  { selector: 'node.suspect', style: { shape: 'round-diamond' } },
  { selector: 'node[cat = "exploit"]', style: { shape: 'round-hexagon' } },
  { selector: 'node[cat = "mixer"], node[cat = "exchange"], node[cat = "bridge"], node[cat = "dex"], node[cat = "otc"]', style: { shape: 'round-rectangle' } },
  { selector: 'node[cat = "victim"]', style: { 'background-color': light ? '#e8dbe4' : '#4a3655', 'border-color': '#faf0f7', 'border-width': 2 } },
  { selector: 'node.cluster', style: {
    'background-color': '#d8a1dc', 'background-opacity': 0.06, 'border-color': '#d8a1dc', 'border-style': 'dashed', 'border-width': 1.5, 'border-opacity': 0.6,
    shape: 'round-rectangle', label: 'data(label)', 'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': -4, color: '#d8a1dc', 'font-size': 10, padding: 18,
  } },
  { selector: 'edge', style: {
    width: 'data(w)', 'curve-style': 'bezier', 'control-point-step-size': 14,
    'line-color': light ? '#b7a3bd' : 'rgba(250,240,247,0.28)', 'target-arrow-color': light ? '#b7a3bd' : 'rgba(250,240,247,0.4)',
    'target-arrow-shape': 'triangle', 'arrow-scale': 0.9, label: 'data(label)', 'font-size': 9, color: light ? '#5d466a' : '#cdbcd2',
    'font-family': 'JetBrains Mono, monospace', 'text-rotation': 'autorotate', 'text-margin-y': -7,
    'text-outline-color': light ? '#f7eef4' : '#1c1422', 'text-outline-width': 2, 'overlay-opacity': 0, 'min-zoomed-font-size': 8,
    'transition-property': 'opacity, line-color, width', 'transition-duration': '260ms',
  } },
  { selector: 'edge.tainted', style: { 'line-color': 'rgba(196,127,89,0.6)', 'target-arrow-color': 'rgba(196,127,89,0.8)' } },
  { selector: '.faded', style: { opacity: 0.14 } },
  { selector: 'edge.hl', style: { 'line-color': '#c47f59', 'target-arrow-color': '#c47f59', opacity: 1, 'z-index': 10, color: '#faf0f7', 'underlay-color': '#c47f59', 'underlay-padding': 4, 'underlay-opacity': 0.22 } },
  { selector: 'edge.path', style: { 'line-color': '#d8a1dc', 'target-arrow-color': '#d8a1dc', opacity: 1, 'z-index': 12, width: 'mapData(w, 1, 9, 3, 10)', 'line-style': 'solid', 'underlay-color': '#d8a1dc', 'underlay-padding': 5, 'underlay-opacity': 0.25 } },
  { selector: 'edge:selected', style: { 'line-color': '#faf0f7', 'target-arrow-color': '#faf0f7', 'z-index': 20, opacity: 1 } },
  { selector: 'node.hl', style: { opacity: 1 } },
  { selector: 'node:selected', style: { 'border-color': '#d8a1dc', 'border-width': 6, 'underlay-color': '#d8a1dc', 'underlay-padding': 14, 'underlay-opacity': 0.3, 'underlay-shape': 'ellipse' } },
  { selector: 'node.path', style: { 'border-color': '#d8a1dc', 'border-width': 4 } },
]

const GraphCanvas = forwardRef(function GraphCanvas({ c, analysis, txs, visible, selection, highlight, showClusters, showAmounts, playhead, xray = false, onSelectNode, onSelectEdge, onClear, onExpand }, ref) {
  const el = useRef(null)
  const fx = useRef(null)
  const xr = useRef(null)
  const lensEl = useRef(null)
  const xrayOn = useRef(xray)
  xrayOn.current = xray
  const selFx = useRef({ sel: null, t0: 0 })
  const hlFx = useRef({ hl: null, t0: 0 })
  useEffect(() => { selFx.current = { sel: selection, t0: performance.now() } }, [selection?.type, selection?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { hlFx.current = { hl: highlight, t0: performance.now() } }, [highlight])
  const lastCase = useRef(null)
  const playRef = useRef(playhead)
  playRef.current = playhead
  const cy = useRef(null)
  const handlers = useRef({})
  handlers.current = { onSelectNode, onSelectEdge, onClear, onExpand }

  const selectedWallet = selection?.type === 'wallet' ? selection.id : null
  const elements = useMemo(
    () => buildElements({ c, analysis, txs, visible, selected: selectedWallet, showClusters, showAmounts }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, analysis, txs, visible, showClusters, showAmounts, selectedWallet && !txs.some((t) => t.from === selectedWallet || t.to === selectedWallet) ? selectedWallet : null],
  )

  useImperativeHandle(ref, () => ({
    cy: () => cy.current,
    fit: () => cy.current?.animate({ fit: { padding: 50 } }, { duration: 300 }),
    zoom: (f) => { const k = cy.current; if (k) k.animate({ zoom: { level: k.zoom() * f, renderedPosition: { x: k.width() / 2, y: k.height() / 2 } } }, { duration: 200 }) },
    relayout: () => runLayout(true),
    png: (opts) => cy.current?.png({ full: true, scale: 2, bg: '#1c1422', ...opts }),
  }))

  const runLayout = (animate) => {
    const k = cy.current; if (!k) return
    k.layout({ name: 'dagre', rankDir: 'LR', nodeSep: 34, rankSep: 110, edgeSep: 12, animate, animationDuration: 350, fit: true, padding: 50 }).run()
    if (k.nodes().length <= 3) { k.zoom(1.1); k.center() }
  }

  useEffect(() => {
    const k = cytoscape({ container: el.current, style: graphStyle(false), wheelSensitivity: 0.25, minZoom: 0.15, maxZoom: 3.5, boxSelectionEnabled: false, selectionType: 'single' })
    cy.current = k
    k.on('tap', 'node', (e) => { if (!e.target.hasClass('cluster')) handlers.current.onSelectNode(e.target.id()) })
    k.on('tap', 'edge', (e) => handlers.current.onSelectEdge(e.target.id()))
    k.on('tap', (e) => { if (e.target === k) handlers.current.onClear() })
    k.on('dbltap', 'node', (e) => { if (!e.target.hasClass('cluster')) handlers.current.onExpand(e.target.id()) })
    k.on('mouseover', 'node, edge', () => { el.current.style.cursor = 'pointer' })
    k.on('mouseout', 'node, edge', () => { el.current.style.cursor = 'default' })
    return () => k.destroy()
  }, [])

  useEffect(() => {
    const k = cy.current; if (!k) return
    k.batch(() => { k.elements().remove(); k.add(elements) })
    runLayout(false)
    applyHighlight()
    applyPlayhead()
    if (lastCase.current !== c.id && !reducedMotion()) {
      // staggered entrance: nodes rise in left-to-right, then transfers draw in
      const ns = k.nodes().not('.cluster').sort((a, b) => a.position('x') - b.position('x'))
      ns.forEach((n, i) => { n.style({ opacity: 0 }); n.delay(120 + i * 45).animate({ style: { opacity: 1 } }, { duration: 420, complete: () => n.removeStyle('opacity') }) })
      k.edges().forEach((e, i) => { e.style({ opacity: 0 }); e.delay(500 + i * 18).animate({ style: { opacity: 1 } }, { duration: 380, complete: () => e.removeStyle('opacity') }) })
    }
    lastCase.current = c.id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements])

  const applyPlayhead = () => {
    const k = cy.current; if (!k) return
    const ph = playRef.current
    k.batch(() => {
      k.elements().removeClass('future fresh')
      if (ph == null) return
      const fut = k.edges().filter((e) => e.data('ts') > ph.t)
      fut.addClass('future')
      k.edges().filter((e) => e.data('ts') <= ph.t && e.data('ts') > ph.t - ph.window).addClass('fresh')
      k.nodes().not('.cluster').forEach((n) => { const live = n.connectedEdges().filter((e) => !e.hasClass('future')); if (!live.length) n.addClass('future') })
    })
  }
  useEffect(() => { applyPlayhead() }, [playhead]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyHighlight = () => {
    const k = cy.current; if (!k) return
    k.batch(() => {
      k.elements().removeClass('faded hl path').unselect()
      if (highlight?.edges?.length || highlight?.nodes?.length) {
        const ids = new Set(highlight.edges || [])
        k.elements().addClass('faded')
        k.edges().filter((e) => ids.has(e.id())).removeClass('faded').addClass('path')
        k.nodes().filter((n) => (highlight.nodes || []).includes(n.id())).removeClass('faded').addClass('path')
        k.nodes('.cluster').removeClass('faded')
      }
      if (selection?.type === 'wallet') {
        const n = k.getElementById(selection.id)
        if (n.nonempty()) {
          n.select()
          if (!highlight?.edges?.length && !highlight?.nodes?.length) {
            const hood = n.connectedEdges()
            k.elements().not('.cluster').addClass('faded')
            n.removeClass('faded'); hood.removeClass('faded').addClass('hl'); hood.connectedNodes().removeClass('faded')
          }
        }
      } else if (selection?.type === 'tx') {
        const e = k.getElementById(selection.id)
        if (e.nonempty()) {
          e.select()
          if (!highlight?.edges?.length && !highlight?.nodes?.length) { k.elements().not('.cluster').addClass('faded'); e.removeClass('faded'); e.connectedNodes().removeClass('faded') }
        }
      }
    })
  }

  useEffect(() => {
    applyHighlight()
    const k = cy.current; if (!k) return
    const target = selection && k.getElementById(selection.id)
    if (target && target.nonempty() && selection.focus) {
      k.animate({ center: { eles: target }, zoom: Math.max(k.zoom(), 0.9) }, { duration: 520, easing: 'ease-in-out-cubic' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, highlight, elements])

  // Motion layer: particles travel each visible transfer in the direction funds moved
  // (copper = carries incident funds), and high-risk wallets pulse. Drawn on a canvas
  // over the graph so the graph itself stays fully interactive.
  useEffect(() => {
    const still = reducedMotion()
    const cv = fx.current, ctx = cv.getContext('2d')
    let raf, last = 0, W = 0, H = 0
    const parts = new Map()
    const loop = (now) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 16) return
      last = now
      const k = cy.current; if (!k) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (cv.clientWidth !== W || cv.clientHeight !== H) { W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
      const z = k.zoom(), pan = k.pan()
      const R = (p) => ({ x: p.x * z + pan.x, y: p.y * z + pan.y })
      if (!still) {
      // pulse high-risk wallets
      const ph = (now % 1800) / 1800
      k.nodes('.pulse').not('.faded, .future').forEach((n) => {
        const p = R(n.position()), r = (n.width() / 2) * z
        ctx.strokeStyle = `rgba(196,127,89,${0.75 * (1 - ph)})`; ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 4 + ph * 22 * Math.max(0.6, z), 0, 7); ctx.stroke()
      })
      const live = new Set()
      k.edges().forEach((e) => {
        if (e.hasClass('faded') || e.hasClass('future') || e.style('opacity') < 0.5) return
        const id = e.id(); live.add(id)
        let list = parts.get(id)
        if (!list) { list = []; parts.set(id, list) }
        const wgt = e.data('w')
        if (list.length < 1 + Math.round(wgt / 3) && Math.random() < 0.05 + wgt * 0.01) list.push(Math.random() * 0.15)
        const s = R(e.sourceEndpoint()), t = R(e.targetEndpoint()), m = R(e.midpoint())
        const c1 = { x: 2 * m.x - (s.x + t.x) / 2, y: 2 * m.y - (s.y + t.y) / 2 }
        const hot = e.hasClass('path') ? '216,161,220' : e.hasClass('fresh') ? '250,240,247' : e.data('taint') > 0.5 ? '232,160,118' : '250,240,247'
        const alpha = e.data('taint') > 0.5 || e.hasClass('path') || e.hasClass('hl') || e.hasClass('fresh') ? 0.95 : 0.35
        for (let i = list.length - 1; i >= 0; i--) {
          list[i] += 0.012 + 0.004 * Math.min(3, z)
          if (list[i] >= 1) { list.splice(i, 1); continue }
          const u = list[i], iu = 1 - u
          const x = iu * iu * s.x + 2 * iu * u * c1.x + u * u * t.x, y = iu * iu * s.y + 2 * iu * u * c1.y + u * u * t.y
          const rad = Math.max(1.4, Math.min(3.4, 1 + wgt * 0.28)) * Math.max(0.7, Math.min(1.4, z))
          ctx.fillStyle = `rgba(${hot},${alpha})`; ctx.shadowColor = `rgba(${hot},1)`; ctx.shadowBlur = alpha > 0.5 ? 10 : 0
          ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill()
        }
        ctx.shadowBlur = 0
      })
      for (const id of parts.keys()) if (!live.has(id)) parts.delete(id)
      }

      // ── investigative motion ──
      const chip = (e, text, rgb, alpha = 1, sub = '') => {
        if (!e || e.empty() || alpha <= 0) return
        const a = R(e.sourceEndpoint()), b = R(e.targetEndpoint()), m = R(e.midpoint())
        const c1 = { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 }
        const x = 0.25 * a.x + 0.5 * c1.x + 0.25 * b.x, y = 0.25 * a.y + 0.5 * c1.y + 0.25 * b.y - 14
        ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace'
        const w1 = ctx.measureText(text).width
        ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace'
        const w2 = sub ? ctx.measureText(sub).width : 0
        const w = Math.max(w1, w2) + 14, h = sub ? 32 : 19
        ctx.globalAlpha = alpha
        ctx.fillStyle = 'rgba(20,13,25,0.92)'; ctx.strokeStyle = `rgba(${rgb},0.9)`; ctx.lineWidth = 1
        ctx.shadowColor = `rgba(${rgb},0.6)`; ctx.shadowBlur = 12
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - h / 2, w, h, 6) : ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill(); ctx.shadowBlur = 0; ctx.stroke()
        ctx.textAlign = 'center'; ctx.fillStyle = '#faf0f7'; ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace'
        ctx.fillText(text, x, y + (sub ? -2 : 4))
        if (sub) { ctx.fillStyle = `rgba(${rgb},1)`; ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace'; ctx.fillText(sub, x, y + 11) }
        ctx.textAlign = 'left'; ctx.globalAlpha = 1
      }
      const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
      const glowEdge = (e, rgb, width, alpha = 1) => {
        if (!e || e.empty()) return
        const a = R(e.sourceEndpoint()), b = R(e.targetEndpoint()), m = R(e.midpoint())
        const c1 = { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 }
        ctx.strokeStyle = `rgba(${rgb},${0.85 * alpha})`; ctx.lineWidth = width; ctx.shadowColor = `rgba(${rgb},1)`; ctx.shadowBlur = 16
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c1.x, c1.y, b.x, b.y); ctx.stroke(); ctx.shadowBlur = 0
      }
      const comet = (e, u, rgb, size = 3.2) => {
        if (still || !e || e.empty() || u < 0 || u > 1) return
        const a = R(e.sourceEndpoint()), b = R(e.targetEndpoint()), m = R(e.midpoint())
        const c1 = { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 }
        for (let j = 7; j >= 0; j--) {
          const uu = Math.max(0, u - j * 0.025), iu = 1 - uu
          const x = iu * iu * a.x + 2 * iu * uu * c1.x + uu * uu * b.x, y = iu * iu * a.y + 2 * iu * uu * c1.y + uu * uu * b.y
          ctx.fillStyle = `rgba(${rgb},${j === 0 ? 1 : 0.5 * (1 - j / 8)})`
          ctx.shadowColor = `rgba(${rgb},1)`; ctx.shadowBlur = j === 0 ? 18 : 0
          ctx.beginPath(); ctx.arc(x, y, (size - j * 0.3) * Math.max(0.8, Math.min(1.4, z)), 0, 7); ctx.fill()
        }
        ctx.shadowBlur = 0
      }
      const { sel, t0 } = selFx.current
      const since = now - t0
      if (sel?.type === 'wallet') {
        const n = k.getElementById(sel.id)
        if (n.nonempty()) {
          const p = R(n.position()), r = (n.width() / 2) * z
          // shockwave: two rings expand from the wallet when it is opened
          for (const off of [0, 220]) {
            const q = (since - off) / 1100
            if (q > 0 && q < 1) { ctx.strokeStyle = `rgba(216,161,220,${0.8 * (1 - q)})`; ctx.lineWidth = 2.5 * (1 - q) + 0.5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6 + q * 140 * Math.max(0.7, z), 0, 7); ctx.stroke() }
          }
          // money in, then money out: comets ride each connected transfer in time order, every 3.2 s
          if (!hlFx.current.hl) {
            const ins = n.incomers('edge').filter((e) => !e.hasClass('future')).sort((a, b) => a.data('ts') - b.data('ts'))
            const outs = n.outgoers('edge').filter((e) => !e.hasClass('future')).sort((a, b) => a.data('ts') - b.data('ts'))
            const cyc = (since % 3200)
            ins.forEach((e, i) => comet(e, (cyc - i * 70) / 700, '120,190,185'))
            outs.forEach((e, i) => comet(e, (cyc - 750 - i * 70) / 700, e.data('taint') > 0.5 ? '240,170,130' : '250,240,247'))
          }
        }
      } else if (sel?.type === 'tx') {
        comet(k.getElementById(sel.id), (since % 1600) / 1100, '250,240,247', 3.6)
      }
      const HL = hlFx.current
      const hl = HL.hl
      const hs = now - HL.t0
      if (hl?.kind === 'path' && hl.txs) {
        // Trace funds: each hop lights up in sequence and keeps its amount + time label
        const hop = still ? 0 : 800, total = hl.txs.length * hop + 2600
        const cyc = still ? Infinity : hs < total ? hs : (hs - total) % total + 0
        hl.txs.forEach((t, i) => {
          const e = k.getElementById(t.id)
          const reached = (cyc - i * hop) / hop
          if (reached > 0) glowEdge(e, '216,161,220', 3 + Math.min(1, reached) * 2, Math.min(1, reached))
          comet(e, reached, '250,240,247', 4)
          if (reached >= 0.85) chip(e, `${fmtAmt(t.amount)} ${t.asset}`, '216,161,220', Math.min(1, (reached - 0.85) * 4), hhmm(t.ts) + ' UTC')
        })
      } else if (hl?.kind === 'downstream') {
        const es = hl.edges.map((id) => k.getElementById(id)).filter((e) => e.nonempty()).sort((a, b) => a.data('ts') - b.data('ts'))
        const cyc = hs % (es.length * 90 + 1600)
        es.forEach((e, i) => comet(e, (cyc - i * 90) / 900, '240,170,130'))
      } else if (hl?.kind === 'reveal-timeline') {
        // the wallet's transfers appear one by one; the newest gets a comet and a bright label
        hl.edges.forEach((id) => {
          const e = k.getElementById(id); if (e.empty()) return
          const cur = id === hl.current
          if (cur) { glowEdge(e, '240,179,141', 5); comet(e, Math.min(1, hs / 750), '250,240,247', 4.2) }
          chip(e, e.data('amt'), cur ? '240,179,141' : '216,161,220', cur ? Math.min(1, hs / 300) : 0.55, cur ? hhmm(e.data('ts')) + ' UTC' : '')
        })
      } else if (hl?.kind === 'verdict') {
        const es = hl.edges.map((id) => k.getElementById(id)).filter((e) => e.nonempty())
        es.forEach((e, i) => { glowEdge(e, '240,170,130', 3, 0.7); comet(e, ((hs + i * 260) % 1800) / 1200, '240,170,130') })
      }
      if (hl?.kind === 'evidence' && hl.clues) {
        // evidence-to-wallet: a beam from each clue card to the wallet it names, coloured by confidence
        const host = el.current.parentElement.getBoundingClientRect()
        const CONF = { Confirmed: '143,208,162', Strong: '120,190,185', Weak: '227,178,106' }
        hl.edges.forEach((id) => glowEdge(k.getElementById(id), '216,161,220', 2.5, 0.6))
        hl.clues.forEach((cl, i) => {
          const n = k.getElementById(cl.node); if (n.empty()) return
          const cards = [...document.querySelectorAll(`[data-clue="${cl.id}"]`)].filter((d) => d.offsetParent)
          const p = R(n.position()), r = (n.width() / 2) * z, rgb = CONF[cl.conf] || '216,161,220'
          const grow = still ? 1 : Math.min(1, Math.max(0, (hs - i * 160) / 650))
          cards.forEach((card) => {
            const cr = card.getBoundingClientRect()
            const cands = [{ x: cr.left + cr.width / 2, y: cr.top }, { x: cr.right, y: cr.top + cr.height / 2 }, { x: cr.left, y: cr.top + cr.height / 2 }, { x: cr.left + cr.width / 2, y: cr.bottom }]
              .map((q) => ({ x: q.x - host.left, y: q.y - host.top }))
            const a = cands.reduce((best, q) => (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? q : best))
            const mx = (a.x + p.x) / 2, my = Math.min(a.y, p.y) - 40
            const ex = a.x + (p.x - a.x) * grow, ey = a.y + (p.y - a.y) * grow
            ctx.save()
            ctx.setLineDash([7, 6]); ctx.lineDashOffset = still ? 0 : -now / 28
            ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.lineWidth = 2; ctx.shadowColor = `rgba(${rgb},1)`; ctx.shadowBlur = 14
            ctx.beginPath(); ctx.moveTo(a.x, a.y)
            if (grow >= 1) ctx.quadraticCurveTo(mx, my, p.x, p.y); else ctx.lineTo(ex, ey)
            ctx.stroke(); ctx.restore()
            ctx.fillStyle = `rgba(${rgb},1)`; ctx.beginPath(); ctx.arc(a.x, a.y, 3.5, 0, 7); ctx.fill()
          })
          if (grow >= 1) {
            const q = still ? 0 : ((now / 1400) + i * 0.2) % 1
            ctx.strokeStyle = `rgba(${rgb},${0.9 - q * 0.8})`; ctx.lineWidth = 3
            ctx.beginPath(); ctx.arc(p.x, p.y, r + 6 + q * 18, 0, 7); ctx.stroke()
            ctx.font = '600 11px "IBM Plex Sans", system-ui, sans-serif'
            const txt = `${cl.id} · ${cl.conf} link`
            const w = ctx.measureText(txt).width + 14
            ctx.fillStyle = 'rgba(20,13,25,0.92)'; ctx.strokeStyle = `rgba(${rgb},0.9)`; ctx.lineWidth = 1
            const bx = p.x - w / 2, by = p.y - r - 34 - i * 22
            ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, 20, 10) : ctx.rect(bx, by, w, 20); ctx.fill(); ctx.stroke()
            ctx.fillStyle = `rgba(${rgb},1)`; ctx.textAlign = 'center'; ctx.fillText(txt, p.x, by + 14); ctx.textAlign = 'left'
          }
        })
      }
      // timeline replay: label the transfer that just happened
      if (playRef.current) k.edges('.fresh').forEach((e) => chip(e, e.data('amt'), '250,240,247', 1, hhmm(e.data('ts')) + ' UTC'))
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Lithos-style x-ray lens: a soft circle that follows the pointer over the graph and
  // reveals a second view of the same graph: how much of each transfer is stolen money,
  // and each wallet's risk score. Pointer events pass straight through to the graph.
  useEffect(() => {
    const host = el.current.parentElement, cv = xr.current, ctx = cv.getContext('2d')
    const still = reducedMotion()
    const s = { mx: -999, my: -999, x: -999, y: -999, inside: false }
    let raf, W = 0, H = 0
    const move = (e) => { const r = host.getBoundingClientRect(); s.mx = e.clientX - r.left; s.my = e.clientY - r.top; s.inside = true }
    const leave = () => { s.inside = false }
    host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave)
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!xr.current) return
      const k = cy.current
      const on = xrayOn.current && s.inside && k
      host.classList.toggle('xray-live', !!on)
      if (!on) { if (W) { ctx.clearRect(0, 0, cv.width, cv.height) } return }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (cv.clientWidth !== W || cv.clientHeight !== H) { W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr }
      if (s.x < -900 || still) { s.x = s.mx; s.y = s.my } else { s.x += (s.mx - s.x) * 0.18; s.y += (s.my - s.y) * 0.18 }
      cv.style.setProperty('--lx', s.x + 'px'); cv.style.setProperty('--ly', s.y + 'px')
      if (lensEl.current) lensEl.current.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(16,10,20,0.78)'; ctx.fillRect(0, 0, W, H)
      const z = k.zoom(), pan = k.pan()
      const R = (p) => ({ x: p.x * z + pan.x, y: p.y * z + pan.y })
      const near = (p) => Math.hypot(p.x - s.x, p.y - s.y) < 200
      k.edges().forEach((e) => {
        if (e.hasClass('future')) return
        const a = R(e.sourceEndpoint()), b = R(e.targetEndpoint()), m = R(e.midpoint())
        const c1 = { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 }
        const tnt = e.data('taint') || 0
        ctx.strokeStyle = tnt > 0 ? `rgba(232,150,108,${0.25 + 0.75 * tnt})` : 'rgba(250,240,247,0.12)'
        ctx.lineWidth = tnt > 0 ? 1.5 + 4 * tnt : 1
        ctx.shadowColor = 'rgba(196,127,89,1)'; ctx.shadowBlur = tnt > 0.5 ? 12 : 0
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c1.x, c1.y, b.x, b.y); ctx.stroke(); ctx.shadowBlur = 0
        if (near(m)) {
          const lx = 0.25 * a.x + 0.5 * c1.x + 0.25 * b.x, ly = 0.25 * a.y + 0.5 * c1.y + 0.25 * b.y
          const txt = tnt > 0 ? `${Math.round(tnt * 100)}% stolen` : 'clean'
          ctx.font = '600 10.5px "JetBrains Mono", ui-monospace, monospace'
          const w = ctx.measureText(txt).width + 10
          ctx.fillStyle = tnt > 0 ? 'rgba(196,127,89,0.92)' : 'rgba(57,41,66,0.92)'; ctx.fillRect(lx - w / 2, ly - 8, w, 16)
          ctx.fillStyle = tnt > 0 ? '#1c1422' : '#cdbcd2'; ctx.textAlign = 'center'; ctx.fillText(txt, lx, ly + 4); ctx.textAlign = 'left'
        }
      })
      k.nodes().not('.cluster').forEach((n) => {
        if (n.hasClass('future')) return
        const p = R(n.position()), r = (n.width() / 2) * z, sc = n.data('score')
        const col = sc == null ? '#faf0f7' : sc >= 70 ? '#ec7b86' : sc >= 40 ? '#e3b26a' : sc >= 15 ? '#78beb9' : '#8f7e97'
        ctx.fillStyle = col; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(6, r), 0, 7); ctx.fill(); ctx.globalAlpha = 1
        ctx.fillStyle = '#1c1422'; ctx.font = `700 ${Math.max(10, Math.min(16, r * 0.8))}px "IBM Plex Sans", system-ui, sans-serif`; ctx.textAlign = 'center'
        ctx.fillText(sc == null ? 'V' : String(sc), p.x, p.y + Math.max(10, Math.min(16, r * 0.8)) * 0.36)
        if (near(p)) { ctx.fillStyle = '#faf0f7'; ctx.font = '600 11px "IBM Plex Sans", system-ui, sans-serif'; ctx.fillText(n.data('name'), p.x, p.y - Math.max(6, r) - 8) }
        ctx.textAlign = 'left'
      })
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave) }
  }, [])

  return (
    <>
      <div ref={el} className="cy" aria-label="Transaction graph. Wallets are nodes, transfers are arrows." />
      <canvas ref={fx} className="cy-fx" aria-hidden="true" />
      <canvas ref={xr} className="cy-xray" aria-hidden="true" />
      <div ref={lensEl} className="cy-lens" aria-hidden="true"><span>X-ray · % stolen · risk score</span></div>
    </>
  )
})

export default GraphCanvas
