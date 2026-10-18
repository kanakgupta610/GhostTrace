// Time-delta and latency analysis. Pure functions over a case's transfers; no UI code.
//
// What is measured (all from block timestamps, which are UTC seconds on Ethereum):
//   forward delay  – time between a wallet receiving value and its next outgoing transfer
//   rapid chain    – a path of transfers where each hop leaves within `rapidMs` of the previous one arriving
//   regular cadence – 3+ consecutive outgoing gaps from one wallet that are near-identical
// Short delays are consistent with automation or pre-planned movement. They do not by themselves show
// common ownership or wrongdoing: exchanges, bots and ordinary users can also move funds quickly.

export const TIMING_DEFAULTS = { rapidMs: 10 * 60000, minChain: 3, cadenceTolerance: 0.1, minCadenceGaps: 3, dustUsd: 1 }

export const TIMING_METHOD = [
  'Times are block timestamps (UTC). Transfers in the same block share one timestamp, so delays under ~12 seconds cannot be resolved and are shown as 0 s.',
  'Forward delay: for each incoming transfer, the time until the receiving wallet next sends a non-dust transfer. Only later transfers count.',
  'Rapid chain: a sequence of at least 3 transfers where each one leaves the receiving wallet within the rapid threshold (default 10 minutes).',
  'Regular cadence: at least 3 consecutive gaps between one wallet\'s outgoing transfers that differ from their average by no more than 10%.',
  'Records without a valid timestamp are excluded; exact duplicates are removed; records are sorted by time, not by the order a source returned them.',
]
export const TIMING_LIMITS = [
  'A short delay is consistent with automation or a pre-planned route, but exchanges, market makers and ordinary users also move funds quickly. Delays alone do not show common ownership or wrongdoing.',
  'Block timestamps are set by block producers and are only accurate to a few seconds.',
  'Live data is limited to the most recent records returned by the provider, so gaps involving older activity may be missing.',
  'Value moved through contracts without a recorded internal transfer is not visible here.',
]

const fmtDelta = (ms) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 172800) return `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h`
  return `${(s / 86400).toFixed(1)} days`
}
export { fmtDelta }

// Clean the transfer list: drop missing/invalid timestamps, remove exact duplicates, sort by time.
export function normaliseEvents(txs) {
  const issues = { missingTimestamp: 0, duplicates: 0, outOfOrder: 0 }
  const seen = new Set()
  const out = []
  let last = -Infinity
  for (const t of txs || []) {
    const ts = typeof t.ts === 'number' ? t.ts : Date.parse(t.ts)
    if (!Number.isFinite(ts) || ts <= 0) { issues.missingTimestamp++; continue }
    const key = t.id ? `id:${t.id}` : `${t.hash}|${t.from}|${t.to}|${t.asset}|${t.amount}`
    if (seen.has(key)) { issues.duplicates++; continue }
    seen.add(key)
    if (ts < last) issues.outOfOrder++
    last = Math.max(last, ts)
    out.push({ ...t, ts })
  }
  out.sort((a, b) => a.ts - b.ts || String(a.id).localeCompare(String(b.id)))
  return { events: out, issues }
}

export function analyseTiming(c, opts = {}) {
  const o = { ...TIMING_DEFAULTS, ...opts }
  const { events, issues } = normaliseEvents(c.txs)
  const svc = new Set(['mixer', 'dex', 'bridge', 'exchange', 'otc'])
  const cat = new Map((c.wallets || []).map((w) => [w.address, w.category]))
  const sig = events.filter((t) => t.usd >= o.dustUsd)
  const outBy = new Map()
  for (const t of sig) { if (!outBy.has(t.from)) outBy.set(t.from, []); outBy.get(t.from).push(t) }

  // forward delays: incoming transfer -> receiver's next significant outgoing transfer
  const forwards = []
  for (const t of sig) {
    if (svc.has(cat.get(t.to))) continue // services pool funds; their timing says nothing about this flow
    const next = (outBy.get(t.to) || []).find((x) => x.ts >= t.ts && x.id !== t.id)
    if (next) forwards.push({ wallet: t.to, inTx: t.id, outTx: next.id, ms: next.ts - t.ts })
  }

  // rapid chains: follow forwards whose delay is under the threshold
  const nextOf = new Map()
  for (const f of forwards) if (f.ms <= o.rapidMs && !nextOf.has(f.inTx)) nextOf.set(f.inTx, f)
  const hasPrev = new Set([...nextOf.values()].map((f) => f.outTx))
  const chains = []
  for (const start of nextOf.keys()) {
    if (hasPrev.has(start)) continue // only start at the head of a chain
    const txIds = [start], delays = [], seen = new Set([start])
    let cur = start
    while (nextOf.has(cur)) {
      const f = nextOf.get(cur)
      if (seen.has(f.outTx)) break
      txIds.push(f.outTx); delays.push(f.ms); seen.add(f.outTx); cur = f.outTx
    }
    if (txIds.length >= o.minChain) {
      const byId = new Map(sig.map((t) => [t.id, t]))
      const wallets = [byId.get(txIds[0]).from, ...txIds.map((id) => byId.get(id).to)]
      chains.push({ txIds, wallets, delays, totalMs: byId.get(txIds.at(-1)).ts - byId.get(txIds[0]).ts, maxDelayMs: Math.max(...delays) })
    }
  }
  // the same wallet path repeated (for example three drain calls swept the same way) is one pattern
  const byPath = new Map()
  for (const ch of chains) {
    const k = ch.wallets.join('>')
    if (!byPath.has(k)) byPath.set(k, { ...ch, occurrences: 1, allTxIds: [...ch.txIds] })
    else { const p = byPath.get(k); p.occurrences++; p.allTxIds.push(...ch.txIds); if (ch.totalMs < p.totalMs) Object.assign(p, { txIds: ch.txIds, delays: ch.delays, totalMs: ch.totalMs, maxDelayMs: ch.maxDelayMs }) }
  }
  chains.length = 0
  chains.push(...byPath.values())
  chains.sort((a, b) => b.txIds.length - a.txIds.length || a.totalMs - b.totalMs)

  // regular cadence: near-constant gaps between one wallet's outgoing transfers
  const cadences = []
  for (const [wallet, outs] of outBy) {
    if (svc.has(cat.get(wallet)) || outs.length < o.minCadenceGaps + 1) continue
    const gaps = outs.slice(1).map((t, i) => t.ts - outs[i].ts)
    let best = null
    for (let i = 0; i < gaps.length; i++) {
      for (let j = i + o.minCadenceGaps; j <= gaps.length; j++) {
        const run = gaps.slice(i, j)
        const avg = run.reduce((a, b) => a + b, 0) / run.length
        if (avg < 60000) break // sub-minute bursts are same-block batching, not cadence
        if (run.every((g) => Math.abs(g - avg) <= avg * o.cadenceTolerance)) { if (!best || run.length > best.gaps.length) best = { start: i, gaps: run, avg } } else break
      }
    }
    if (best) cadences.push({ wallet, txIds: outs.slice(best.start, best.start + best.gaps.length + 1).map((t) => t.id), gaps: best.gaps, avgMs: best.avg })
  }

  const delays = forwards.map((f) => f.ms).sort((a, b) => a - b)
  const pct = (p) => (delays.length ? delays[Math.min(delays.length - 1, Math.floor(p * delays.length))] : null)
  return {
    events, issues, forwards, chains, cadences,
    stats: { transfers: events.length, significant: sig.length, forwards: forwards.length, rapidForwards: forwards.filter((f) => f.ms <= o.rapidMs).length, medianMs: pct(0.5), p90Ms: pct(0.9) },
    thresholds: o, method: TIMING_METHOD, limitations: TIMING_LIMITS,
  }
}
