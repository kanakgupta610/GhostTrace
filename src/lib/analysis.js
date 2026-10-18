import { analyseTiming } from './timing.js'
import { inferClusters } from './clustering.js'
import { serviceExposure } from './services.js'

// GhostTrace analysis engine. Everything here is computed from the case record
// (wallets, transfers, OSINT, clusters) — nothing is hard-coded per wallet, so a
// case loaded from a live source is scored the same way as the sample case.

export const SERVICE_CATS = new Set(['mixer', 'dex', 'bridge', 'exchange', 'otc'])
export const DUST_USD = 1

const median = (arr) => {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function indexCase(c) {
  const byAddr = new Map(c.wallets.map((w) => [w.address, w]))
  const inTx = new Map(), outTx = new Map()
  for (const w of c.wallets) { inTx.set(w.address, []); outTx.set(w.address, []) }
  const sorted = [...c.txs].sort((a, b) => a.ts - b.ts)
  for (const t of sorted) {
    outTx.get(t.from)?.push(t)
    inTx.get(t.to)?.push(t)
  }
  return { byAddr, inTx, outTx, sorted }
}

// Haircut taint: each wallet's tainted share = tainted value received / total value received,
// processed in time order. Transfers out of a taint source after the incident start carry 100%.
export function computeTaint(c, idx) {
  const recv = new Map(), tainted = new Map()
  for (const w of c.wallets) { recv.set(w.address, w.externalInflowUsd || 0); tainted.set(w.address, 0) }
  const sources = new Set(c.taintSources)
  const edgeTaint = new Map()
  for (const t of idx.sorted) {
    let share
    const swapIn = t.method === 'swap' && idx.byAddr.get(t.from)?.category === 'dex'
      ? idx.sorted.find((x) => x.from === t.to && x.to === t.from && x.ts === t.ts && x.method === 'swap') : null
    if (sources.has(t.from)) share = t.ts >= c.attackStart ? 1 : 0
    else if (swapIn && edgeTaint.has(swapIn.id)) share = edgeTaint.get(swapIn.id) // swap output carries the taint of its input
    else { const r = recv.get(t.from) || 0; share = r > 0 ? (tainted.get(t.from) || 0) / r : 0 }
    share = Math.min(1, share)
    edgeTaint.set(t.id, share)
    recv.set(t.to, (recv.get(t.to) || 0) + t.usd)
    tainted.set(t.to, (tainted.get(t.to) || 0) + t.usd * share)
  }
  const walletTaint = new Map()
  for (const w of c.wallets) {
    const r = recv.get(w.address) || 0
    walletTaint.set(w.address, { share: r ? tainted.get(w.address) / r : 0, taintedUsd: tainted.get(w.address) || 0, receivedUsd: r })
  }
  return { edgeTaint, walletTaint }
}

// Hops from the primary suspect, following transfers forward in time.
export function computeHops(c, idx) {
  const hops = new Map([[c.primarySuspect, 0]])
  const arrival = new Map([[c.primarySuspect, -Infinity]])
  const queue = [c.primarySuspect]
  while (queue.length) {
    const a = queue.shift()
    for (const t of idx.outTx.get(a) || []) {
      if (t.usd < DUST_USD || t.ts < arrival.get(a)) continue
      if (!hops.has(t.to)) {
        hops.set(t.to, hops.get(a) + 1); arrival.set(t.to, t.ts); queue.push(t.to)
      }
    }
  }
  return hops
}

export function walletStats(addr, idx) {
  const ins = idx.inTx.get(addr) || [], outs = idx.outTx.get(addr) || []
  const inUsd = ins.reduce((s, t) => s + t.usd, 0)
  const outUsd = outs.reduce((s, t) => s + t.usd, 0)
  const sumAsset = (list) => list.reduce((m, t) => ((m[t.asset] = (m[t.asset] || 0) + t.amount), m), {})
  // dwell = time from each significant receipt to the next significant outgoing transfer
  const dwell = []
  for (const t of ins) {
    if (t.usd < DUST_USD) continue
    const next = outs.find((o) => o.ts >= t.ts && o.usd >= DUST_USD)
    if (next) dwell.push(next.ts - t.ts)
  }
  const counterparties = new Set([...ins.map((t) => t.from), ...outs.map((t) => t.to)])
  const all = [...ins, ...outs].sort((a, b) => a.ts - b.ts)
  return {
    inCount: ins.length, outCount: outs.length, inUsd, outUsd, inByAsset: sumAsset(ins), outByAsset: sumAsset(outs),
    medianDwellMs: median(dwell), dwell, counterparties: [...counterparties],
    first: all[0]?.ts, last: all[all.length - 1]?.ts,
  }
}

const CONF_POINTS = { Confirmed: 15, Strong: 10, Weak: 4 }

export function scoreWallet(c, idx, w, ctx) {
  const { taint, hops } = ctx
  const s = walletStats(w.address, idx)
  const outs = (idx.outTx.get(w.address) || []).filter((t) => t.usd >= DUST_USD)
  const ins = (idx.inTx.get(w.address) || []).filter((t) => t.usd >= DUST_USD)
  const cat = (a) => idx.byAddr.get(a)?.category
  const factors = []
  const add = (id, label, points, detail, refs = []) => factors.push({ id, label, points: Math.round(points), detail, refs })

  if (w.category === 'victim') {
    return { score: null, band: 'Victim', factors: [], note: 'Victim wallets are not risk-scored.', stats: s }
  }

  const tw = taint.walletTaint.get(w.address)
  if (tw && tw.taintedUsd > 0) {
    const tRefs = ins.filter((t) => taint.edgeTaint.get(t.id) > 0).map((t) => t.id)
    add('taint', 'Received incident proceeds', 30 * tw.share,
      `${(tw.share * 100).toFixed(1)}% of ${fmtUsdShort(tw.receivedUsd)} received traces back to the incident (haircut method${w.externalInflowUsd ? `, including ${fmtUsdShort(w.externalInflowUsd)} of unrelated service inflow` : ''}).`, tRefs)
  }
  if (hops.has(w.address)) {
    const h = hops.get(w.address)
    const pts = [15, 12, 8, 5][h] ?? 2
    add('proximity', h === 0 ? 'Primary suspect' : `${h} hop${h > 1 ? 's' : ''} from primary suspect`, pts,
      h === 0 ? 'This wallet received the swept proceeds and is the starting point of the trace.' : `Funds reach this wallet ${h} transfer${h > 1 ? 's' : ''} after leaving the primary suspect, following time order.`)
  }
  if (w.category === 'mixer') {
    add('category', 'Mixing service', 30, 'Mixing services break the visible link between deposits and withdrawals.')
  } else {
    const mix = [...ins, ...outs].filter((t) => cat(t.from) === 'mixer' || cat(t.to) === 'mixer')
    if (mix.length) {
      const dep = mix.filter((t) => cat(t.to) === 'mixer'), wd = mix.filter((t) => cat(t.from) === 'mixer')
      add('mixer', 'Mixer interaction', 15,
        [dep.length && `${dep.length} deposit${dep.length > 1 ? 's' : ''} into a mixer`, wd.length && `${wd.length} withdrawal${wd.length > 1 ? 's' : ''} from a mixer`].filter(Boolean).join(', ') + '.',
        mix.map((t) => t.id))
      const amounts = dep.map((t) => t.amount)
      if (dep.length >= 3 && new Set(amounts).size === 1) {
        add('denom', 'Fixed-denomination deposits', 8, `${dep.length} deposits of exactly ${amounts[0]} ${dep[0].asset}, matching the pool denomination.`, dep.map((t) => t.id))
      }
    }
  }
  if (!SERVICE_CATS.has(w.category) && s.medianDwellMs != null && s.medianDwellMs < 30 * 60000 && outs.length) {
    add('rapid', 'Rapid forwarding', 10, `Median ${fmtDuration(s.medianDwellMs)} between receiving funds and sending them on.`)
  }
  // fan-out: >=3 transfers to distinct recipients inside 60 minutes
  for (let i = 0; i < outs.length; i++) {
    const win = outs.filter((o) => o.ts >= outs[i].ts && o.ts - outs[i].ts <= 3600000 && cat(o.to) !== 'mixer')
    const recips = new Set(win.map((o) => o.to))
    if (recips.size >= 3 && !SERVICE_CATS.has(w.category)) {
      add('fanout', 'Fan-out splitting', 8, `Sent to ${recips.size} different wallets within ${fmtDuration(win[win.length - 1].ts - win[0].ts)}.`, win.map((o) => o.id))
      break
    }
  }
  // peel: one significant input, a large forward (>=85%) and a small side payment to an exchange
  if (ins.length >= 1 && outs.length === 2) {
    const total = outs.reduce((a, b) => a + b.usd, 0)
    const big = outs.find((o) => o.usd / total >= 0.85), small = outs.find((o) => o.usd / total <= 0.15)
    if (big && small && cat(small.to) === 'exchange') {
      add('peel', 'Peel-chain step', 8, `Forwarded ${(big.usd / total * 100).toFixed(0)}% onward and peeled ${small.amount} ${small.asset} to an exchange deposit.`, [big.id, small.id])
    }
  }
  if (!SERVICE_CATS.has(w.category) && w.firstSeen && w.firstSeen < c.attackStart + 86400000 && c.attackStart - w.firstSeen < 7 * 86400000) {
    add('fresh', 'Fresh wallet', 6, `First activity ${fmtDuration(Math.abs(c.attackStart - w.firstSeen))} ${w.firstSeen <= c.attackStart ? 'before' : 'after'} the incident.`)
  }
  if (w.category !== 'bridge') {
    const br = outs.filter((t) => cat(t.to) === 'bridge')
    if (br.length) add('bridge', 'Cross-chain exit', 6, `${br.map((t) => `${fmtAmt(t.amount)} ${t.asset}`).join(', ')} sent to a bridge; the destination chain is outside this case.`, br.map((t) => t.id))
  }
  if (w.category !== 'exchange') {
    const ex = outs.filter((t) => cat(t.to) === 'exchange')
    if (ex.length) add('cashout', 'Exchange cash-out', 4, `${ex.length} transfer${ex.length > 1 ? 's' : ''} to exchange deposit addresses.`, ex.map((t) => t.id))
  }
  const os = c.osint.filter((o) => o.matches.some((m) => m.address === w.address))
  if (os.length) {
    const best = os.reduce((a, b) => (CONF_POINTS[b.confidence] > CONF_POINTS[a.confidence] ? b : a))
    add('osint', `OSINT match (${best.confidence.toLowerCase()})`, CONF_POINTS[best.confidence],
      `${os.length} public-source finding${os.length > 1 ? 's' : ''} name this address. Strongest: ${best.id}, ${best.publisher}.`, os.map((o) => o.id))
  }
  const raw = factors.reduce((a, f) => a + f.points, 0)
  const score = Math.min(100, raw)
  const band = score >= 70 ? 'High' : score >= 40 ? 'Elevated' : score >= 15 ? 'Low' : 'Minimal'
  const note = SERVICE_CATS.has(w.category)
    ? 'Service wallet: the score measures exposure to incident funds, not culpability of the service.'
    : null
  return { score, raw, band, factors: factors.sort((a, b) => b.points - a.points), note, stats: s }
}

export function analyseCase(c) {
  const idx = indexCase(c)
  const taint = computeTaint(c, idx)
  const hops = computeHops(c, idx)
  const risk = new Map()
  for (const w of c.wallets) risk.set(w.address, scoreWallet(c, idx, w, { taint, hops }))
  const clusterOf = new Map()
  for (const cl of c.clusters) for (const m of cl.members) clusterOf.set(m, cl)
  const patterns = detectPatterns(c, idx, risk)
  return { idx, taint, hops, risk, clusterOf, patterns, timing: timing(c, idx),
    deltas: analyseTiming(c), inferred: inferClusters(c), services: serviceExposure(c) }
}

function detectPatterns(c, idx, risk) {
  const out = []
  const name = (a) => idx.byAddr.get(a)?.label || short(a)
  for (const w of c.wallets) {
    const r = risk.get(w.address)
    for (const f of r.factors) {
      if (['fanout', 'denom', 'peel', 'bridge'].includes(f.id)) {
        out.push({ id: `${f.id}:${w.address}`, kind: f.label, wallet: w.address, walletName: name(w.address), detail: f.detail, refs: f.refs, severity: f.id === 'denom' || f.id === 'fanout' ? 'High' : 'Elevated' })
      }
    }
  }
  return out
}

function timing(c, idx) {
  const txs = idx.sorted.filter((t) => t.usd >= DUST_USD)
  // gaps between a wallet receiving funds and its next outgoing transfer (all non-service wallets)
  const bins = [
    { label: '< 1 min', max: 60e3 }, { label: '1–5 min', max: 300e3 }, { label: '5–15 min', max: 900e3 },
    { label: '15–60 min', max: 3600e3 }, { label: '1–6 h', max: 6 * 3600e3 }, { label: '6–24 h', max: 86400e3 }, { label: '> 24 h', max: Infinity },
  ].map((b) => ({ ...b, count: 0, wallets: new Set() }))
  const gaps = []
  for (const w of c.wallets) {
    if (SERVICE_CATS.has(w.category) || w.category === 'victim') continue
    const s = walletStats(w.address, idx)
    for (const d of s.dwell) {
      gaps.push({ wallet: w.address, ms: d })
      const b = bins.find((b) => d < b.max); b.count++; b.wallets.add(w.label)
    }
  }
  // volume per hour across the case window (USD)
  const hourly = new Map()
  for (const t of txs) {
    const h = Math.floor(t.ts / 3600000) * 3600000
    hourly.set(h, (hourly.get(h) || 0) + t.usd)
  }
  const hours = [...hourly.keys()].sort((a, b) => a - b)
  const volume = []
  if (hours.length) {
    const start = Math.max(hours[0], c.attackStart - 6 * 3600000)
    const end = Math.min(hours[hours.length - 1], start + 72 * 3600000)
    for (let h = Math.floor(start / 3600000) * 3600000; h <= end; h += 3600000) volume.push({ hour: h, usd: hourly.get(h) || 0 })
  }
  // consecutive inter-transfer gaps across the whole case (sequence view)
  const seq = txs.map((t, i) => ({ id: t.id, ts: t.ts, gapMin: i ? (t.ts - txs[i - 1].ts) / 60000 : 0, usd: t.usd, from: t.from, to: t.to }))
  const hourOfDay = Array.from({ length: 24 }, (_, h) => ({ h, count: 0 }))
  for (const t of txs) hourOfDay[new Date(t.ts).getUTCHours()].count++
  return { bins: bins.map((b) => ({ label: b.label, count: b.count, wallets: [...b.wallets] })), gaps, volume, seq, hourOfDay }
}

// Time-respecting forward paths from `from` to `to` (max depth 8), ranked by bottleneck value.
export function tracePaths(c, idx, from, to, limit = 5) {
  const results = []
  const walk = (node, minTs, path, seen) => {
    if (results.length > 200 || path.length > 8) return
    if (node === to && path.length) { results.push([...path]); return }
    for (const t of idx.outTx.get(node) || []) {
      if (t.ts < minTs || t.usd < DUST_USD || seen.has(t.to)) continue
      seen.add(t.to); path.push(t)
      walk(t.to, t.ts, path, seen)
      path.pop(); seen.delete(t.to)
    }
  }
  walk(from, -Infinity, [], new Set([from]))
  return results
    .map((p) => ({ txs: p, bottleneck: Math.min(...p.map((t) => t.usd)) }))
    .sort((a, b) => b.bottleneck - a.bottleneck)
    .filter((p, i, arr) => arr.findIndex((q) => q.txs.map((t) => t.to).join() === p.txs.map((t) => t.to).join()) === i)
    .slice(0, limit)
}

export function downstream(idx, from, sinceTs = -Infinity) {
  const edges = new Set(), nodes = new Set([from])
  const best = new Map([[from, sinceTs]])
  const q = [from]
  while (q.length) {
    const a = q.shift()
    for (const t of idx.outTx.get(a) || []) {
      if (t.ts < best.get(a) || t.usd < DUST_USD) continue
      edges.add(t.id)
      if (!best.has(t.to) || best.get(t.to) > t.ts) { best.set(t.to, t.ts); nodes.add(t.to); q.push(t.to) }
    }
  }
  return { edges, nodes }
}

// ── formatting helpers shared by the engine and UI ──
export const short = (a, n = 6) => (a ? `${a.slice(0, n)}…${a.slice(-4)}` : '')
export function fmtUsdShort(v) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(v < 10 ? 2 : 0)}`
}
export function fmtAmt(v) {
  if (v === 0) return '0'
  if (v < 0.01) return v.toFixed(4)
  return v.toLocaleString('en-GB', { maximumFractionDigits: v < 100 ? 2 : 0 })
}
export function fmtDuration(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = ms / 3600000
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`
  return `${(h / 24).toFixed(1)} days`
}
