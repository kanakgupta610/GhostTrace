import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, FlaskConical, History, Menu, X } from 'lucide-react'
import { useApp } from '../store.jsx'
import { Decode } from '../components/Motion.jsx'
import { fmtUsdShort, fmtAmt, SERVICE_CATS } from '../lib/analysis.js'

// GhostTrace hero.
//  · Ethan Vale technique: every wallet of the case sits on a Fibonacci sphere ("network orb"),
//    transfers are arcs between them, drag rotates it with momentum, depth dims the far side,
//    and the headline lives at the orb's centre while near wallets pass in front of it.
//  · Lithos technique: a soft circular spotlight trails the cursor and reveals a second view
//    of the same orb, the "x-ray": only stolen-fund paths, with amounts and risk scores.
//  · Vesper technique: masked, staggered line reveals, a popping badge, liquid-metal nav pills
//    and glass buttons with a shine sweep.
// Every control here does something real in the app.

const COPPER = [196, 127, 89], LILAC = [216, 161, 220], IVORY = [250, 240, 247], TEAL = [120, 190, 185], ROSE = [236, 123, 134], AMBER = [227, 178, 106]
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

function buildOrb(c, analysis) {
  // order wallets by first appearance in the money flow so the sphere reads top → bottom in time
  const first = new Map()
  for (const t of [...c.txs].sort((a, b) => a.ts - b.ts)) { if (!first.has(t.from)) first.set(t.from, t.ts); if (!first.has(t.to)) first.set(t.to, t.ts) }
  const ws = [...c.wallets].sort((a, b) => (first.get(a.address) ?? Infinity) - (first.get(b.address) ?? Infinity))
  const N = ws.length, GA = Math.PI * (3 - Math.sqrt(5))
  const nodes = ws.map((w, i) => {
    const y = 1 - (i / Math.max(1, N - 1)) * 2, rad = Math.sqrt(Math.max(0, 1 - y * y)), th = i * GA
    const r = analysis.risk.get(w.address)
    const vol = c.txs.filter((t) => t.from === w.address || t.to === w.address).reduce((s, t) => s + t.usd, 0)
    return {
      w, u: [Math.cos(th) * rad, y, Math.sin(th) * rad], i,
      size: 3.5 + Math.min(8, Math.log10(vol + 10) * 1.05),
      color: w.category === 'suspect' || w.category === 'exploit' ? COPPER : w.category === 'exchange' || w.category === 'bridge' || w.category === 'dex' ? TEAL : w.category === 'victim' ? IVORY : LILAC,
      score: r?.score, band: r?.band, service: SERVICE_CATS.has(w.category),
      ring: r?.score == null ? IVORY : r.score >= 70 ? ROSE : r.score >= 40 ? AMBER : null,
      pulse: r?.score >= 70 && !SERVICE_CATS.has(w.category),
    }
  })
  const by = new Map(nodes.map((n) => [n.w.address, n]))
  const edges = [...c.txs].sort((a, b) => a.ts - b.ts).filter((t) => t.usd >= 1).map((t, k) => ({
    t, a: by.get(t.from), b: by.get(t.to), k, taint: analysis.taint.edgeTaint.get(t.id) || 0, w: Math.max(0.6, Math.log10(t.usd) - 3.3),
  }))
  return { nodes, edges }
}

export default function Hero() {
  const { cases, analysisFor, openCase, setReplay } = useApp()
  const c = cases[0]
  const a = analysisFor(c)
  const orb = useMemo(() => buildOrb(c, a), [c, a])
  const back = useRef(null), front = useRef(null), xray = useRef(null), zone = useRef(null), root = useRef(null), lens = useRef(null)
  const st = useRef({ spin: 0, tilt: -8, dragX: 0, dragY: 0, velX: 0, velY: 0, mx: -999, my: -999, sx: -999, sy: -999, exitAt: null, hover: null, proj: [] })
  const [leaving, setLeaving] = useState(false)
  const [menu, setMenu] = useState(false)
  const [hoverW, setHoverW] = useState(null)

  const stolen = c.txs.filter((t) => c.taintSources.includes(t.from) && t.ts >= c.attackStart).reduce((s, t) => s + t.usd, 0)
  const fan = c.txs.filter((t) => t.from === c.primarySuspect && t.usd > 1e6 && a.idx.byAddr.get(t.to)?.category === 'intermediary')
  const splitMins = fan.length ? Math.round((Math.max(...fan.map((t) => t.ts)) - Math.min(...fan.map((t) => t.ts))) / 60000) : null
  const flagged = c.wallets.filter((w) => { const r = a.risk.get(w.address); return r.score != null && r.score >= 40 && !SERVICE_CATS.has(w.category) }).length

  useEffect(() => {
    const still = reduced()
    const cvs = [back.current, front.current, xray.current]
    const ctxs = cvs.map((cv) => cv.getContext('2d'))
    let raf, W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 200
    const t0 = performance.now()
    const parts = []
    const layout = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = window.innerWidth; H = window.innerHeight
      cvs.forEach((cv) => { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px' })
      const z = zone.current.getBoundingClientRect()
      cx = z.left + z.width / 2; cy = z.top + z.height / 2
      R = Math.max(110, Math.min(z.height * 0.4, W * (W <= 640 ? 0.36 : 0.25), 360))
    }
    layout()
    const s = st.current
    // pointer: Lithos spotlight + Ethan Vale drag
    let drag = null
    const onMove = (e) => {
      s.mx = e.clientX; s.my = e.clientY; s.user = true
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) drag.moved = true
        s.velX = dx * 0.13; s.velY = -dy * 0.13
        s.dragX += s.velX; s.dragY = Math.max(-32 - s.tilt, Math.min(32 - s.tilt, s.dragY + s.velY))
        drag.x = e.clientX; drag.y = e.clientY
      } else {
        const hit = pick(e.clientX, e.clientY)
        if (hit !== s.hover) { s.hover = hit; setHoverW(hit ? hit.w : null) }
        if (root.current) root.current.style.cursor = hit ? 'pointer' : 'grab'
      }
    }
    const pick = (x, y) => {
      let best = null, bd = 1e9
      for (const p of s.proj) { if (p.zf < -0.25) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < p.r + 10 && d < bd) { bd = d; best = p.n } }
      return best
    }
    const onDown = (e) => {
      if (e.target.closest('button, a, [data-ui]')) return
      drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, hit: pick(e.clientX, e.clientY) }
      s.mx = e.clientX; s.my = e.clientY
      if (root.current) root.current.style.cursor = 'grabbing'
    }
    const touchOnly = typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches
    const onUp = () => {
      if (drag && !drag.moved && drag.hit) enterWith(drag.hit.w.address)
      drag = null
      if (touchOnly) { s.mx = -999; s.my = -999; s.sx = -999; s.sy = -999 } // on touch the light shows only while a finger is down
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('resize', layout)

    let alive = true
    const frame = (now) => {
      if (!alive || !xray.current || !back.current) return
      const t = still ? 60000 : now - t0
      const exitP = s.exitAt ? ease((now - s.exitAt) / 900) : 0
      if (!drag) {
        s.dragX += s.velX; s.dragY = Math.max(-32 - s.tilt, Math.min(32 - s.tilt, s.dragY + s.velY))
        s.velX *= 0.94; s.velY *= 0.94
        if (Math.abs(s.velX) < 0.002) s.velX = 0; if (Math.abs(s.velY) < 0.002) s.velY = 0
        if (!still) s.spin += 0.035 // slow idle drift so the orb is alive
      }
      // until the visitor moves, the light drifts across the orb so the reveal is discoverable
      if (!s.user && !still && !touchOnly && t > 2600) { s.mx = cx + Math.cos(t / 1900) * R * 0.6; s.my = cy + Math.sin(t / 1400) * R * 0.45 }
      // Lithos: eased spotlight
      if (s.mx < -900) { s.sx = -999; s.sy = -999 } else if (s.sx < -900) { s.sx = s.mx; s.sy = s.my } else { s.sx += (s.mx - s.sx) * (still ? 1 : 0.1); s.sy += (s.my - s.sy) * (still ? 1 : 0.1) }
      xray.current.style.setProperty('--lx', s.sx + 'px'); xray.current.style.setProperty('--ly', s.sy + 'px')
      if (lens.current) lens.current.style.transform = `translate3d(${s.sx}px, ${s.sy}px, 0)`

      const yaw = ((s.spin + s.dragX) * Math.PI) / 180, pitch = ((s.tilt + s.dragY) * Math.PI) / 180
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
      const persp = 1100, Rr = R * (1 + exitP * 2.6)
      const grow = still ? 1 : ease((t - 150) / 1400)
      const P = (u) => {
        const x1 = u[0] * cyw + u[2] * syw, z1 = -u[0] * syw + u[2] * cyw
        const y2 = u[1] * cp - z1 * sp, z2 = u[1] * sp + z1 * cp
        const f = persp / (persp - z2 * Rr)
        return { x: cx + x1 * Rr * f * grow, y: cy - y2 * Rr * f * grow, zf: z2, f }
      }
      const proj = orb.nodes.map((n) => ({ n, ...P(n.u) }))
      proj.forEach((p) => { p.r = p.n.size * p.f * (0.6 + 0.4 * grow) })
      s.proj = proj
      const pm = new Map(proj.map((p) => [p.n, p]))
      const shade = (zf) => 0.14 + 0.86 * Math.pow((zf + 1) / 2, 0.85)
      const fadeAll = 1 - exitP

      ctxs.forEach((ctx) => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H) })
      const [bctx, fctx, xctx] = ctxs
      // faint latitude rings give the orb its volume
      bctx.lineWidth = 1
      for (let k = -2; k <= 2; k++) {
        const yy = k / 3, rr = Math.sqrt(1 - yy * yy)
        bctx.beginPath()
        for (let j = 0; j <= 64; j++) { const th = (j / 64) * Math.PI * 2; const p = P([Math.cos(th) * rr, yy, Math.sin(th) * rr]); j ? bctx.lineTo(p.x, p.y) : bctx.moveTo(p.x, p.y) }
        bctx.strokeStyle = rgba(LILAC, 0.05 * fadeAll * grow); bctx.stroke()
      }
      // arcs: great-circle-ish curve bowed outward
      const arc = (e) => {
        const A = e.a.u, B = e.b.u
        let m = [A[0] + B[0], A[1] + B[1], A[2] + B[2]]; const ml = Math.hypot(...m) || 1
        m = m.map((v) => (v / ml) * 1.18)
        const pa = pm.get(e.a), pb = pm.get(e.b), mm = P(m)
        return { pa, pb, c: { x: 2 * mm.x - (pa.x + pb.x) / 2, y: 2 * mm.y - (pa.y + pb.y) / 2 }, zf: (pa.zf + pb.zf + mm.zf) / 3 }
      }
      const arcs = orb.edges.map((e) => ({ e, ...arc(e) }))
      for (const g of arcs) {
        const drawP = still ? 1 : ease((t - 700 - g.e.k * 40) / 700)
        if (drawP <= 0) continue
        const ctx = g.zf > 0.35 ? fctx : bctx
        const col = g.e.taint > 0.5 ? COPPER : LILAC
        const al = (g.e.taint > 0.5 ? 0.5 : 0.18) * shade(g.zf) * fadeAll
        ctx.strokeStyle = rgba(col, al); ctx.lineWidth = g.e.w * 0.9
        ctx.beginPath(); ctx.moveTo(g.pa.x, g.pa.y)
        // partial quadratic for the draw-in
        const steps = 18
        for (let j = 1; j <= steps * drawP; j++) { const u = j / steps, iu = 1 - u; ctx.lineTo(iu * iu * g.pa.x + 2 * iu * u * g.c.x + u * u * g.pb.x, iu * iu * g.pa.y + 2 * iu * u * g.c.y + u * u * g.pb.y) }
        ctx.stroke()
        if (!still && drawP >= 1 && Math.random() < 0.01 * g.e.w * (g.e.taint > 0.5 ? 1.6 : 0.6)) parts.push({ g: g.e, p: 0, v: 0.006 + Math.random() * 0.005 })
      }
      const arcOf = new Map(arcs.map((g) => [g.e, g]))
      for (let i = parts.length - 1; i >= 0; i--) {
        const pt = parts[i]; pt.p += pt.v
        if (pt.p >= 1) { parts.splice(i, 1); continue }
        const g = arcOf.get(pt.g), u = pt.p, iu = 1 - u
        const x = iu * iu * g.pa.x + 2 * iu * u * g.c.x + u * u * g.pb.x, y = iu * iu * g.pa.y + 2 * iu * u * g.c.y + u * u * g.pb.y
        const ctx = g.zf > 0.35 ? fctx : bctx, col = pt.g.taint > 0.5 ? COPPER : LILAC
        ctx.fillStyle = rgba(col, 0.95 * shade(g.zf) * fadeAll); ctx.shadowColor = rgba(col, 1); ctx.shadowBlur = 10
        ctx.beginPath(); ctx.arc(x, y, 1.8 * g.pa.f, 0, 7); ctx.fill(); ctx.shadowBlur = 0
      }
      const order = [...proj].sort((p, q) => p.zf - q.zf)
      for (const p of order) {
        const ctx = p.zf > 0.35 ? fctx : bctx
        const app = still ? 1 : ease((t - 200 - p.n.i * 45) / 600)
        if (app <= 0) continue
        const sh = shade(p.zf) * fadeAll * app
        const hov = s.hover === p.n
        const r = p.r * (hov ? 1.5 : 1)
        if (p.n.pulse && !still) {
          const ph = ((t / 1700) + p.n.i * 0.17) % 1
          ctx.strokeStyle = rgba(COPPER, (1 - ph) * 0.65 * sh); ctx.lineWidth = 1.4
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 3 + ph * 20 * p.f, 0, 7); ctx.stroke()
        }
        const gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.4)
        gl.addColorStop(0, rgba(p.n.color, 0.45 * sh)); gl.addColorStop(1, rgba(p.n.color, 0))
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.4, 0, 7); ctx.fill()
        ctx.fillStyle = rgba(p.n.color, sh); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill()
        if (hov) { ctx.strokeStyle = rgba(LILAC, 0.95); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, 7); ctx.stroke() }
      }

      // Lithos x-ray layer: stolen-fund paths with amounts, wallets with risk scores
      if (s.sx > -500 && s.mx > -500) {
        xctx.fillStyle = 'rgba(20,12,24,0.55)'; xctx.fillRect(0, 0, W, H)
        for (const g of arcs) {
          if (g.zf < -0.6) continue
          const hot = g.e.taint > 0.5
          xctx.strokeStyle = hot ? rgba(COPPER, 0.95 * fadeAll) : rgba(IVORY, 0.08 * fadeAll)
          xctx.lineWidth = hot ? Math.max(1.5, g.e.w * 1.6) : 0.8
          xctx.shadowColor = rgba(COPPER, 1); xctx.shadowBlur = hot ? 14 : 0
          xctx.beginPath(); xctx.moveTo(g.pa.x, g.pa.y); xctx.quadraticCurveTo(g.c.x, g.c.y, g.pb.x, g.pb.y); xctx.stroke()
          xctx.shadowBlur = 0
          if (hot && g.zf > -0.2 && g.e.t.usd > 5e5) {
            const mx = 0.25 * g.pa.x + 0.5 * g.c.x + 0.25 * g.pb.x, my = 0.25 * g.pa.y + 0.5 * g.c.y + 0.25 * g.pb.y
            xctx.font = '500 10.5px "JetBrains Mono", ui-monospace, monospace'; xctx.fillStyle = rgba(IVORY, 0.9 * fadeAll)
            xctx.fillText(`${fmtAmt(g.e.t.amount)} ${g.e.t.asset}`, mx + 4, my - 4)
          }
        }
        for (const p of order) {
          if (p.zf < -0.6) continue
          const col = p.n.score == null ? IVORY : p.n.score >= 70 ? ROSE : p.n.score >= 40 ? AMBER : TEAL
          const r = p.r * 1.25
          xctx.fillStyle = rgba(col, 0.95 * fadeAll); xctx.beginPath(); xctx.arc(p.x, p.y, r, 0, 7); xctx.fill()
          xctx.strokeStyle = rgba(IVORY, 0.9 * fadeAll); xctx.lineWidth = 1; xctx.beginPath(); xctx.arc(p.x, p.y, r + 3, 0, 7); xctx.stroke()
          xctx.font = '600 11px "IBM Plex Sans", system-ui, sans-serif'; xctx.fillStyle = rgba(IVORY, 0.95 * fadeAll)
          const label = p.n.score == null ? `${p.n.w.label} · victim` : `${p.n.w.label} · ${p.n.score}`
          xctx.fillText(label, p.x + r + 7, p.y + 4)
        }
      }
      if (!still || s.exitAt || drag || s.velX || s.velY) raf = requestAnimationFrame(frame)
      else raf = requestAnimationFrame(frame) // keep spotlight live even with reduced motion (user-driven)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp); window.removeEventListener('resize', layout)
    }
  }, [orb]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (fn) => {
    if (leaving) return
    setLeaving(true); setMenu(false)
    st.current.exitAt = performance.now()
    setTimeout(fn, reduced() ? 0 : 820)
  }
  const enter = () => go(() => openCase(c.id, 'graph'))
  const enterWith = (address) => go(() => openCase(c.id, 'graph', address))
  const replay = () => go(() => { openCase(c.id, 'graph'); setTimeout(() => setReplay({ i: 0, playing: true }), 60) })
  const goSection = (s) => go(() => openCase(c.id, s))

  // Vesper: each .appear marks itself done on its own animationend; if animations never run
  // (blocked, or reduced motion), everything is forced visible so the page is never blank.
  useEffect(() => {
    const els = [...root.current.querySelectorAll('.appear')]
    const done = (e) => e.currentTarget.classList.add('is-in')
    els.forEach((el) => el.addEventListener('animationend', done, { once: true }))
    let r1, r2
    r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => {
      const running = els.some((el) => el.getAnimations?.().some((an) => an.playState === 'running' || an.playState === 'finished'))
      if (!running) els.forEach((el) => el.classList.add('is-in'))
    }) })
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); els.forEach((el) => el.removeEventListener('animationend', done)) }
  }, [])

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') setMenu(false) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  const NAV = [['graph', 'Graph'], ['osint', 'Evidence'], ['risk', 'Risk'], ['reports', 'Reports']]

  return (
    <div ref={root} className={`hero3 ${leaving ? 'leaving' : ''} ${menu ? 'menu-open' : ''}`}>
      <div className="h3-atmo" aria-hidden="true" />
      <canvas ref={back} className="h3-canvas" aria-hidden="true" />
      <div className="h3-grain" aria-hidden="true" />

      <header className="h3-header" data-ui>
        <button className="h3-logo appear a-scale" style={{ '--d': '0.08s' }} onClick={enter} aria-label="GhostTrace, enter the investigation">
          <span className="brand-mark"><span className="ghost-dot" /></span><span>Ghost<span className="h3-logo-suffix">Trace</span></span>
        </button>
        <nav id="h3-nav" className="h3-nav" aria-label="Sections">
          {NAV.map(([id, label], i) => (
            <button key={id} className={`h3-pill appear ${i % 2 ? 'a-soft' : 'a-scale'}`} style={{ '--d': `${0.16 + i * 0.12}s` }} onClick={() => goSection(id)}>{label}</button>
          ))}
        </nav>
        <div className="h3-right">
          <span className="h3-sample appear a-scale" style={{ '--d': '0.34s' }}><FlaskConical size={12} />Sample case</span>
          <button className="h3-burger" aria-controls="h3-nav" aria-expanded={menu} aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu(!menu)}>{menu ? <X size={18} /> : <Menu size={18} />}</button>
        </div>
      </header>

      <main className="h3-main">
        <div className="h3-badge appear a-pop" style={{ '--d': '0.22s' }}>
          <svg className="h3-star" width="16" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.6c.55 0 .88.55 1.08 2.1.62 4.7 1.52 5.6 6.22 6.22 1.55.2 2.1.53 2.1 1.08s-.55.88-2.1 1.08c-4.7.62-5.6 1.52-6.22 6.22-.2 1.55-.53 2.1-1.08 2.1s-.88-.55-1.08-2.1c-.62-4.7-1.52-5.6-6.22-6.22C3.15 12.88 2.6 12.55 2.6 12s.55-.88 2.1-1.08c4.7-.62 5.6-1.52 6.22-6.22C11.12 3.15 11.45 2.6 12 2.6Z" /></svg>
          Case {c.id} · The {fmtUsdShort(stolen).replace('.00', '')} Ghost Attacks
        </div>
        <div ref={zone} className="h3-zone">
          <h1 className="h3-h1">
            <span className="h3-line"><span className="appear a-mask" style={{ '--d': '0.42s' }}>Money <em>hides.</em></span></span>
            <span className="h3-line"><span className="appear a-mask" style={{ '--d': '0.62s' }}>Ghosts leave <em><Decode text="traces." delay={1.05} speed={0.7} /></em></span></span>
          </h1>
        </div>
        <p className="h3-lede appear a-soft" style={{ '--d': '0.82s' }}>Every transfer leaves a mark. GhostTrace follows stolen funds across wallets, transactions and public intelligence.</p>
        <div className="h3-actions" data-ui>
          <button className="gbtn gbtn-solid appear a-btn" style={{ '--d': '0.96s' }} onClick={enter} autoFocus>ENTER INVESTIGATION <ArrowRight size={16} /></button>
          <button className="gbtn gbtn-ghost appear a-side" style={{ '--d': '1.1s' }} onClick={replay}><History size={15} />Replay the theft</button>
        </div>
        <div className="h3-cue appear a-soft" style={{ '--d': '1.9s' }} aria-hidden="true"><s />Drag to rotate · move the light to reveal stolen-fund paths · click a wallet to open it</div>
      </main>

      <canvas ref={front} className="h3-canvas h3-front" aria-hidden="true" />
      <canvas ref={xray} className="h3-canvas h3-xray" aria-hidden="true" />
      <div ref={lens} className="h3-lens" aria-hidden="true"><span>X-ray · stolen funds</span></div>

      <div className={`h3-hover ${hoverW ? 'on' : ''}`} aria-live="polite">{hoverW ? <>Open <b>{hoverW.label}</b> in the graph</> : ''}</div>

      <footer className="h3-stats" data-ui>
        <div className="h3-stat appear a-stat" style={{ '--d': '1.12s' }}><i className="si si-copper" /><b>{fmtUsdShort(stolen)}</b> drained from the Halcyon Bridge vault</div>
        <div className="h3-stat appear a-stat" style={{ '--d': '1.28s' }}><i className="si si-lilac" /><b>{c.wallets.length} wallets</b> traced · {flagged} flagged</div>
        {splitMins != null && <div className="h3-stat appear a-stat" style={{ '--d': '1.44s' }}><i className="si si-teal" /><b>{splitMins} min</b> to split funds across {fan.length} fresh wallets</div>}
      </footer>
    </div>
  )
}
