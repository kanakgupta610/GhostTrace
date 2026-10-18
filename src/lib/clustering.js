// Graph-based wallet clustering from observed transaction relationships. Pure functions; no UI code.
//
// Two ordinary wallets are linked when the evidence between them reaches LINK_THRESHOLD points:
//   direct      – they transferred non-dust value to each other              (1 point)
//   passthrough – the recipient forwarded ≥80% of that value to ordinary wallets within `windowMs` (1 point)
//   funder      – the same wallet made the first non-dust transfer to both     (2 points)
//   coordinated – both received from the same sender within `windowMs`         (1 point)
//   shared      – ≥2 shared ordinary counterparties and Jaccard overlap ≥ 0.5   (1 point)
// Linked wallets are grouped with union-find. Exchanges, bridges, mixers, DEXs, OTC desks, contracts and
// victims are never members (a busy service would otherwise chain unrelated users together); they are
// reported as touchpoints instead. A cluster is an investigative lead, not proof of common ownership.

export const CLUSTER_DEFAULTS = { windowMs: 30 * 60000, dustUsd: 1, linkThreshold: 2, passShare: 0.8 }
export const NON_MEMBER = new Set(['mixer', 'dex', 'bridge', 'exchange', 'otc', 'exploit', 'victim'])

export const CLUSTER_METHOD = [
  'Only ordinary wallets can be cluster members. Exchanges, bridges, mixers, DEXs, OTC desks, contracts and victims are excluded and listed as touchpoints.',
  'Direct link (1 point): the two wallets sent non-dust value to each other. A payment alone does not link wallets.',
  'Pass-through (1 point): the recipient forwarded at least 80% of the value it received from the other wallet to other ordinary wallets within 30 minutes, so both sit on the same transaction path. Deposits straight into a service do not count.',
  'Common funder (2 points): the same wallet made the first non-dust transfer into both.',
  'Coordinated receipt (1 point): both received from the same sender within 30 minutes.',
  'Shared counterparties (1 point): at least two ordinary counterparties in common and an overlap (Jaccard) of at least 0.5.',
  'Two wallets are linked at 2 points or more; linked wallets are grouped transitively. Confidence: Medium if any link has two or more independent kinds of evidence, otherwise Low.',
]
export const CLUSTER_LIMITS = [
  'Clusters describe transaction relationships. They do not prove that one person or group controls the wallets.',
  'Gas-funding services, payroll and airdrop senders can fund many unrelated wallets; a common funder is a heuristic.',
  'Only transfers present in the case are used. Live cases contain only the most recent records from the provider.',
]

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function inferClusters(c, opts = {}) {
  const o = { ...CLUSTER_DEFAULTS, ...opts }
  const cat = new Map((c.wallets || []).map((w) => [w.address, w.category || 'unknown']))
  const member = (a) => !NON_MEMBER.has(cat.get(a) || 'unknown')
  const txs = (c.txs || []).filter((t) => Number.isFinite(t.ts) && t.usd >= o.dustUsd && t.from !== t.to).sort((a, b) => a.ts - b.ts)

  const links = new Map() // pairKey -> { a, b, evidence: [{kind, points, detail, txIds}] }
  const addEv = (a, b, ev) => {
    const k = pairKey(a, b)
    if (!links.has(k)) links.set(k, { a: a < b ? a : b, b: a < b ? b : a, evidence: [] })
    const l = links.get(k)
    if (!l.evidence.some((e) => e.kind === ev.kind)) l.evidence.push(ev)
  }

  // direct transfers
  const direct = new Map()
  for (const t of txs) {
    if (!member(t.from) || !member(t.to)) continue
    const k = pairKey(t.from, t.to)
    if (!direct.has(k)) direct.set(k, { a: t.from, b: t.to, n: 0, usd: 0, txIds: [] })
    const d = direct.get(k); d.n++; d.usd += t.usd; d.txIds.push(t.id)
  }
  for (const d of direct.values()) {
    addEv(d.a, d.b, { kind: 'direct', points: 1, detail: `${d.n} direct transfer${d.n > 1 ? 's' : ''} worth $${Math.round(d.usd).toLocaleString('en-US')}`, txIds: d.txIds })
  }

  // pass-through: B received from A and forwarded most of that value onward within the window
  const outsOf = new Map()
  for (const t of txs) { if (!outsOf.has(t.from)) outsOf.set(t.from, []); outsOf.get(t.from).push(t) }
  for (const t of txs) {
    if (!member(t.from) || !member(t.to)) continue
    // onward transfers to ordinary wallets only: paying straight into an exchange is normal user behaviour
    const fwd = (outsOf.get(t.to) || []).filter((x) => x.ts >= t.ts && x.ts - t.ts <= o.windowMs && x.id !== t.id && member(x.to))
    const fwdUsd = fwd.reduce((s, x) => s + x.usd, 0)
    if (fwd.length && fwdUsd >= t.usd * o.passShare) {
      addEv(t.from, t.to, { kind: 'passthrough', points: 1, detail: `${Math.round(Math.min(1, fwdUsd / t.usd) * 100)}% of a transfer forwarded within ${Math.max(1, Math.round((fwd.at(-1).ts - t.ts) / 60000))} min`, txIds: [t.id, ...fwd.map((x) => x.id)] })
    }
  }

  // common first funder
  const firstIn = new Map()
  for (const t of txs) if (!firstIn.has(t.to)) firstIn.set(t.to, t)
  const fundedBy = new Map()
  for (const [w, t] of firstIn) {
    if (!member(w)) continue
    if (!fundedBy.has(t.from)) fundedBy.set(t.from, [])
    fundedBy.get(t.from).push(t)
  }
  for (const [funder, list] of fundedBy) {
    if (list.length < 2 || list.length > 25) continue // >25: likely a faucet, payroll or service
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      addEv(list[i].to, list[j].to, { kind: 'funder', points: 2, detail: `both first funded by ${funder}`, funder, txIds: [list[i].id, list[j].id] })
    }
  }

  // coordinated receipt from the same sender
  const bySender = new Map()
  for (const t of txs) { if (!member(t.to)) continue; if (!bySender.has(t.from)) bySender.set(t.from, []); bySender.get(t.from).push(t) }
  for (const [sender, list] of bySender) {
    if (list.length > 50) continue
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].ts - list[i].ts <= o.windowMs; j++) {
      if (list[i].to === list[j].to) continue
      addEv(list[i].to, list[j].to, { kind: 'coordinated', points: 1, detail: `both received from ${sender} within ${Math.round((list[j].ts - list[i].ts) / 60000)} min`, sender, txIds: [list[i].id, list[j].id] })
    }
  }

  // shared ordinary counterparties
  const nbrs = new Map()
  const addN = (a, b) => { if (!nbrs.has(a)) nbrs.set(a, new Set()); nbrs.get(a).add(b) }
  for (const t of txs) if (member(t.from) && member(t.to)) { addN(t.from, t.to); addN(t.to, t.from) }
  const ws = [...nbrs.keys()]
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
    const A = nbrs.get(ws[i]), B = nbrs.get(ws[j])
    const shared = [...A].filter((x) => B.has(x) && x !== ws[i] && x !== ws[j])
    const union = new Set([...A, ...B]); union.delete(ws[i]); union.delete(ws[j])
    if (shared.length >= 2 && shared.length / union.size >= 0.5) addEv(ws[i], ws[j], { kind: 'shared', points: 1, detail: `${shared.length} shared counterparties (overlap ${(shared.length / union.size).toFixed(2)})`, txIds: [] })
  }

  // keep links at or above the threshold, group with union-find
  const kept = [...links.values()].map((l) => ({ ...l, score: l.evidence.reduce((s, e) => s + e.points, 0) })).filter((l) => l.score >= o.linkThreshold)
  const parent = new Map()
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  for (const l of kept) for (const x of [l.a, l.b]) if (!parent.has(x)) parent.set(x, x)
  for (const l of kept) { const ra = find(l.a), rb = find(l.b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb) }
  const groups = new Map()
  for (const x of parent.keys()) { const r = find(x); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x) }

  const clusters = [...groups.values()].filter((m) => m.length >= 2).map((members) => {
    const set = new Set(members)
    const inner = kept.filter((l) => set.has(l.a) && set.has(l.b))
    const reasons = Object.fromEntries(members.map((m) => [m, inner.filter((l) => l.a === m || l.b === m).map((l) => ({ with: l.a === m ? l.b : l.a, score: l.score, evidence: l.evidence }))]))
    const touch = new Map()
    for (const t of txs) for (const [w, other] of [[t.from, t.to], [t.to, t.from]]) {
      if (set.has(w) && !member(other)) touch.set(other, { address: other, category: cat.get(other) || 'unknown', transfers: (touch.get(other)?.transfers || 0) + 1 })
    }
    const multi = inner.some((l) => l.evidence.length >= 2)
    return { members: members.sort(), links: inner, reasons, touchpoints: [...touch.values()].sort((a, b) => b.transfers - a.transfers), confidence: multi ? 'Medium' : 'Low' }
  }).sort((a, b) => b.members.length - a.members.length || a.members[0].localeCompare(b.members[0]))
  clusters.forEach((cl, i) => { cl.id = `IC-${i + 1}` })
  return { clusters, method: CLUSTER_METHOD, limitations: CLUSTER_LIMITS, params: o }
}
