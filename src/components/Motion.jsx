import { useEffect, useRef, useState } from 'react'

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
const GLYPHS = '0123456789abcdef'

// Decode: text resolves out of scrambled hex, left to right, like an address being read off-chain.
// Re-runs whenever `text` changes. Screen readers get the final text immediately.
export function Decode({ text, delay = 0, speed = 1, className, as: Tag = 'span', style }) {
  const final = String(text ?? '')
  const [out, setOut] = useState(reduced() ? final : final.replace(/[^\s.,·:/$%-]/g, ' '))
  useEffect(() => {
    if (reduced()) { setOut(final); return }
    let raf
    const start = performance.now() + delay * 1000
    const dur = Math.min(1400, 260 + final.length * 32) / speed
    const step = (now) => {
      const p = Math.max(0, (now - start) / dur)
      const fixed = Math.floor(p * final.length)
      let s = ''
      for (let i = 0; i < final.length; i++) {
        const ch = final[i]
        if (i < fixed || /[\s.,·:/$%-]/.test(ch)) s += ch
        else if (now < start) s += ' '
        else s += GLYPHS[(Math.random() * 16) | 0]
      }
      setOut(s)
      if (p < 1) raf = requestAnimationFrame(step)
      else setOut(final)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [final, delay, speed])
  return <Tag className={`decode ${className || ''}`} style={style} aria-label={final}><span aria-hidden="true">{out}</span></Tag>
}

// ScoreRing: the risk score drawn as a gauge that sweeps to its value in the band's colour.
export function ScoreRing({ score, band, size = 64, stroke = 6, label = true }) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r
  const [v, setV] = useState(reduced() ? score ?? 0 : 0)
  useEffect(() => {
    if (score == null) return
    if (reduced()) { setV(score); return }
    let raf; const s = performance.now()
    const step = (now) => { const p = Math.min(1, (now - s) / 900); const e = 1 - Math.pow(1 - p, 3); setV(Math.round(score * e)); if (p < 1) raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf)
  }, [score])
  const col = score == null ? 'var(--text-3)' : band === 'High' ? 'var(--risk-high)' : band === 'Elevated' ? 'var(--risk-elev)' : band === 'Low' ? 'var(--risk-low)' : 'var(--risk-min)'
  return (
    <span className="score-ring" style={{ width: size, height: size }} role="img" aria-label={score == null ? 'Victim, not scored' : `Risk score ${score} of 100, ${band}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(250,240,247,0.08)" strokeWidth={stroke} />
        {score != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ filter: `drop-shadow(0 0 6px ${col})` }} />}
      </svg>
      {label && <b style={{ color: col, fontSize: size * 0.3 }}>{score == null ? '—' : v}</b>}
    </span>
  )
}

// Spotlight: cards light up under the cursor (one delegated listener for the whole app).
export function useCardSpotlight() {
  useEffect(() => {
    if (reduced() || (typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches)) return
    const sel = '.card, .metric, .match, .finding, .why, details.card-more'
    let last = null
    const move = (e) => {
      const el = e.target.closest?.(sel)
      if (last && last !== el) last.style.removeProperty('--spot')
      if (!el) { last = null; return }
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`); el.style.setProperty('--my', `${e.clientY - r.top}px`); el.style.setProperty('--spot', '1')
      // gentle 3D tilt toward the pointer (max 4°)
      el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 6}deg`); el.style.setProperty('--rx', `${(0.5 - (e.clientY - r.top) / r.height) * 6}deg`)
      last = el
    }
    document.addEventListener('pointermove', move, { passive: true })
    return () => document.removeEventListener('pointermove', move)
  }, [])
}

// ScanBeam: a copper scan line sweeps the content area whenever the section changes.
export function ScanBeam({ trigger }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current; if (!el || reduced()) return
    el.classList.remove('run'); void el.offsetWidth; el.classList.add('run')
  }, [trigger])
  return <div ref={ref} className="scan-beam" aria-hidden="true" />
}
