import { useEffect, useState } from 'react'
import { Copy, Check, X, Info, CircleCheck, TriangleAlert } from 'lucide-react'
import { useApp } from '../store.jsx'
import { short } from '../lib/analysis.js'
import { copyText } from '../lib/util.js'

export const CATS = {
  suspect: { label: 'Suspect', color: '#c47f59' },
  exploit: { label: 'Exploit / drainer contract', color: '#a35d3d' },
  victim: { label: 'Victim', color: '#faf0f7' },
  intermediary: { label: 'Intermediary', color: '#d8a1dc' },
  mixer: { label: 'Mixer', color: '#b07ab5' },
  exchange: { label: 'Exchange', color: '#78beb9' },
  bridge: { label: 'Bridge', color: '#5d9fb0' },
  dex: { label: 'DEX', color: '#8fb6a5' },
  otc: { label: 'OTC desk', color: '#9aa6c9' },
  unknown: { label: 'Unlabelled', color: '#8f7e97' },
}

export function CatDot({ cat, size = 9 }) {
  return <i style={{ width: size, height: size, borderRadius: '50%', display: 'inline-block', background: CATS[cat]?.color || '#888', flex: 'none' }} />
}

export function Addr({ a, n = 6, full = false }) {
  const [ok, setOk] = useState(false)
  if (!a) return null
  return (
    <span className="addr" title={a}>
      {full ? a : short(a, n)}
      <button type="button" aria-label="Copy address" onClick={async (e) => { e.stopPropagation(); if (await copyText(a)) { setOk(true); setTimeout(() => setOk(false), 1200) } }}>
        {ok ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  )
}

export function CopyBtn({ text, label = 'Copy' }) {
  const [ok, setOk] = useState(false)
  return (
    <span className="addr"><button type="button" aria-label={label} title={label} onClick={async (e) => { e.stopPropagation(); if (await copyText(text)) { setOk(true); setTimeout(() => setOk(false), 1200) } }}>
      {ok ? <Check size={13} /> : <Copy size={13} />}
    </button></span>
  )
}

export function Risk({ r, showBand = true }) {
  if (!r) return null
  if (r.score == null) return <span className="risk Victim"><span className="bar" />{showBand ? 'Victim' : '—'}</span>
  return <span className={`risk ${r.band}`}><span className="bar" />{r.score}{showBand && <span style={{ fontWeight: 500, opacity: 0.85 }}>{r.band}</span>}</span>
}

export function Toast() {
  const { toast } = useApp()
  const [shown, setShown] = useState(null)
  useEffect(() => {
    if (!toast) return
    setShown(toast)
    const t = setTimeout(() => setShown(null), 4200)
    return () => clearTimeout(t)
  }, [toast])
  if (!shown) return null
  const Icon = shown.tone === 'ok' ? CircleCheck : shown.tone === 'warn' ? TriangleAlert : Info
  return (
    <div className={`toast ${shown.tone}`} role="status">
      <Icon size={16} color={shown.tone === 'ok' ? 'var(--ok)' : shown.tone === 'warn' ? 'var(--risk-elev)' : 'var(--lilac)'} />
      <span>{shown.msg}</span>
      <button className="btn ghost sm icon" onClick={() => setShown(null)} aria-label="Dismiss"><X size={14} /></button>
    </div>
  )
}

export function Drawer({ title, sub, onClose, children, actions }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="drawer-h">
          <div><h2>{title}</h2>{sub && <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>{sub}</div>}</div>
          <div className="row">{actions}<button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        </div>
        <div className="drawer-b">{children}</div>
      </aside>
    </div>
  )
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-c" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="spread"><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        {children}
      </div>
    </div>
  )
}

export function useSort(rows, initial) {
  const [sort, setSort] = useState(initial)
  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key]
    const r = typeof av === 'string' ? av.localeCompare(bv) : (av ?? -Infinity) - (bv ?? -Infinity)
    return sort.dir === 'asc' ? r : -r
  })
  const th = (key, label, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )
  return { sorted, th }
}

// One tooltip layer for the whole app: any element with data-tip gets a tooltip on
// hover or keyboard focus. Fixed-positioned, so scrolling tables never clip it.
export function TipLayer() {
  const [tip, setTip] = useState(null)
  useEffect(() => {
    const show = (e) => {
      const el = e.target.closest?.('[data-tip]')
      if (!el) return
      const r = el.getBoundingClientRect()
      const below = r.top < 120
      setTip({ text: el.getAttribute('data-tip'), x: Math.min(window.innerWidth - 150, Math.max(150, r.left + r.width / 2)), y: below ? r.bottom + 10 : r.top - 10, below })
    }
    const hide = (e) => { if (e.target.closest?.('[data-tip]')) setTip(null) }
    document.addEventListener('mouseover', show); document.addEventListener('focusin', show)
    document.addEventListener('mouseout', hide); document.addEventListener('focusout', hide)
    window.addEventListener('scroll', () => setTip(null), true)
    return () => { document.removeEventListener('mouseover', show); document.removeEventListener('focusin', show); document.removeEventListener('mouseout', hide); document.removeEventListener('focusout', hide) }
  }, [])
  if (!tip) return null
  return <div className={`tip ${tip.below ? 'below' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>
}

export const TERMS = {
  hop: 'A hop is one transfer. "2 hops from suspect" means the funds passed through one other wallet on the way here.',
  haircut: 'Haircut method: each wallet passes on the same share of stolen value it received.',
  incident: 'Value traced back to the stolen funds, using the haircut method.',
  cluster: 'Wallets grouped by a stated method (shared gas funder, deposit sweep, peel pattern). A lead, not proof of common ownership.',
  peel: 'Peel chain: a wallet forwards most of its balance to a new wallet and "peels" a small amount off, often to an exchange.',
  mixer: 'A mixer pools many deposits so withdrawals cannot be linked to specific deposits. Tracing stops at the deposit.',
  osint: 'Open-source intelligence: public posts, notices and records that mention an address.',
  fanout: 'Fan-out: funds split to several new wallets within minutes, a common way to make tracing harder.',
  bridge: 'A bridge moves funds to another blockchain. The destination leg is outside this case.',
}
export function Term({ k, children }) {
  return <span className="term" tabIndex={0} data-tip={TERMS[k]}>{children}</span>
}
