// Tests for timing.js, clustering.js, services.js and identity.js with deterministic synthetic data.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyseTiming, normaliseEvents } from './timing.js'
import { inferClusters } from './clustering.js'
import { serviceExposure, knownService } from './services.js'
import { candidateMatches, NO_MATCH } from './identity.js'
import { SAMPLE_CASES } from '../data/cases.js'

const T0 = Date.UTC(2026, 0, 1, 12)
const min = 60000
const A = (n) => '0x' + String(n).padStart(40, '0')
let seq = 0
const tx = (from, to, atMin, usd, extra = {}) => ({ id: `t${++seq}`, hash: '0x' + String(seq).padStart(64, '0'), from: A(from), to: A(to), ts: T0 + atMin * min, usd, amount: usd, asset: 'ETH', ...extra })
const wallets = (ids, cats = {}) => ids.map((i) => ({ address: A(i), label: `W${i}`, category: cats[i] || 'unknown' }))

test('normaliseEvents drops missing timestamps, removes duplicates and sorts out-of-order records', () => {
  const a = tx(1, 2, 10, 100), b = tx(2, 3, 5, 100)
  const { events, issues } = normaliseEvents([a, b, { ...a }, { ...tx(3, 4, 0, 1), ts: null }, { ...tx(3, 4, 0, 1), ts: 'not a date' }])
  assert.deepEqual(events.map((e) => e.id), [b.id, a.id])
  assert.deepEqual(issues, { missingTimestamp: 2, duplicates: 1, outOfOrder: 1 })
})

test('rapid chain: 1→2→3→4 with 2-minute hops is detected; a 3-hour hop breaks it', () => {
  seq = 0
  const c = { wallets: wallets([1, 2, 3, 4, 5]), txs: [tx(1, 2, 0, 1000), tx(2, 3, 2, 990), tx(3, 4, 4, 980), tx(4, 5, 184, 970)] }
  const r = analyseTiming(c)
  assert.equal(r.chains.length, 1)
  assert.deepEqual(r.chains[0].wallets, [A(1), A(2), A(3), A(4)])
  assert.deepEqual(r.chains[0].delays, [2 * min, 2 * min])
  assert.equal(r.forwards.length, 3)
  assert.equal(r.stats.rapidForwards, 2)
})

test('regular cadence: four sends exactly 20 minutes apart', () => {
  seq = 0
  const c = { wallets: wallets([1, 2, 3, 4, 5, 6]), txs: [tx(1, 2, 0, 50), tx(1, 3, 20, 50), tx(1, 4, 40, 50), tx(1, 5, 60, 50), tx(1, 6, 200, 50)] }
  const r = analyseTiming(c)
  assert.equal(r.cadences.length, 1)
  assert.equal(r.cadences[0].wallet, A(1)); assert.equal(r.cadences[0].avgMs, 20 * min); assert.equal(r.cadences[0].txIds.length, 4)
})

test('timing ignores services and dust and states its limits', () => {
  seq = 0
  const c = { wallets: wallets([1, 2, 3], { 2: 'exchange' }), txs: [tx(1, 2, 0, 1000), tx(2, 3, 1, 1000), tx(1, 3, 2, 0.5)] }
  const r = analyseTiming(c)
  assert.equal(r.forwards.length, 0, 'exchange forwarding says nothing about this flow')
  assert.ok(r.limitations.some((l) => /do not show common ownership or wrongdoing/.test(l)))
})

test('clustering: common funder + coordinated receipt links siblings; a single payment does not', () => {
  seq = 0
  // 1 funds 2,3,4 within 5 minutes (gas-funding pattern); 5 pays 6 once (ordinary payment)
  const c = { wallets: wallets([1, 2, 3, 4, 5, 6]), txs: [tx(1, 2, 0, 120), tx(1, 3, 2, 120), tx(1, 4, 4, 120), tx(5, 6, 10, 5000)] }
  const r = inferClusters(c)
  assert.equal(r.clusters.length, 1)
  assert.deepEqual(r.clusters[0].members, [A(2), A(3), A(4)])
  assert.equal(r.clusters[0].confidence, 'Medium', 'funder and coordinated evidence are independent')
  const why = r.clusters[0].reasons[A(2)]
  assert.ok(why.every((l) => l.evidence.some((e) => e.kind === 'funder')))
  assert.ok(!r.clusters.some((cl) => cl.members.includes(A(5))), 'one payment alone does not create a cluster')
})

test('clustering: services are never members and appear as touchpoints', () => {
  seq = 0
  // 2 and 3 both deposit to exchange 9 and both get funded by 1; 4 and 5 only share the exchange
  const c = { wallets: wallets([1, 2, 3, 4, 5, 9], { 9: 'exchange' }), txs: [tx(1, 2, 0, 100), tx(1, 3, 1, 100), tx(2, 9, 5, 90), tx(3, 9, 6, 90), tx(4, 9, 7, 90), tx(5, 9, 8, 90)] }
  const r = inferClusters(c)
  assert.equal(r.clusters.length, 1)
  assert.deepEqual(r.clusters[0].members, [A(2), A(3)])
  assert.ok(r.clusters[0].touchpoints.some((t) => t.address === A(9) && t.category === 'exchange'))
  assert.ok(!r.clusters.flatMap((x) => x.members).includes(A(9)))
})

test('clustering: pass-through hops on one path are linked', () => {
  seq = 0
  const c = { wallets: wallets([1, 2, 3, 4]), txs: [tx(1, 2, 0, 1000), tx(2, 3, 10, 950), tx(3, 4, 25, 900)] }
  const r = inferClusters(c)
  assert.deepEqual(r.clusters.map((x) => x.members), [[A(1), A(2), A(3)]])
  assert.ok(r.clusters[0].links.every((l) => l.evidence.some((e) => e.kind === 'passthrough')))
})

test('clustering is deterministic', () => {
  const c = SAMPLE_CASES[0]
  assert.equal(JSON.stringify(inferClusters(c)), JSON.stringify(inferClusters(c)))
})

test('fictional Halcyon case: hop wallets cluster; exploit contract, mixer, bridge and exchanges do not', () => {
  const c = SAMPLE_CASES[0]
  const k = (key) => c.wallets.find((w) => w.key === key).address
  const r = inferClusters(c)
  const all = r.clusters.flatMap((x) => x.members)
  for (const key of ['H1', 'H2', 'H3', 'H4']) assert.ok(all.includes(k(key)), `${key} clustered`)
  for (const key of ['EC', 'M', 'BR', 'X1', 'NH', 'D', 'V']) assert.ok(!all.includes(k(key)), `${key} is never a member`)
  const t = analyseTiming(c)
  assert.ok(t.chains.length >= 1); assert.ok(t.cadences.length === 0 || t.cadences.every((x) => x.wallet))
})

test('known-service registry is exact and case-insensitive', () => {
  assert.equal(knownService('0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF').name, 'Tornado Cash 10 ETH pool')
  assert.equal(knownService('0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1').destination, 'OP Mainnet')
  assert.equal(knownService('0x0000000000000000000000000000000000000001'), null)
})

test('service exposure: mixer deposits stop the trace; bridge deposits link only with an operator record', () => {
  const halcyon = SAMPLE_CASES[0]
  const r = serviceExposure(halcyon)
  const mixer = r.events.filter((e) => e.kind === 'Mixer deposit')
  assert.equal(mixer.length, 9); assert.ok(mixer.every((e) => e.trace === 'stops' && e.basis === 'sample label'))
  const bridge = r.events.filter((e) => e.kind === 'Bridge deposit')
  assert.equal(bridge.length, 1); assert.equal(bridge[0].trace, 'linked'); assert.equal(bridge[0].linkedEvidence, 'OS-07')
  // same deposit without the relay record: tracing stops
  const noRelay = serviceExposure({ ...halcyon, osint: halcyon.osint.filter((o) => o.id !== 'OS-07') })
  assert.equal(noRelay.events.find((e) => e.kind === 'Bridge deposit').trace, 'stops')
  // live-style case: registry match on a real bridge address, no case label
  seq = 0
  const live = { sample: false, wallets: wallets([1]).concat([{ address: '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', category: 'unknown', label: 'x' }]), osint: [],
    txs: [{ ...tx(1, 2, 0, 500), to: '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1' }] }
  const e = serviceExposure(live).events[0]
  assert.equal(e.basis, 'registry'); assert.equal(e.trace, 'stops'); assert.match(e.note, /towards OP Mainnet/)
})

test('identity: published identifiers become candidates; anonymous claims are rejected', () => {
  const c = SAMPLE_CASES[0]
  const k = (key) => c.wallets.find((w) => w.key === key).address
  const e1 = candidateMatches(c, k('E1'))
  assert.equal(e1.candidates.length, 1)
  assert.match(e1.candidates[0].identifier, /pseudonymous/)
  assert.ok(e1.candidates[0].score >= 35 && e1.candidates[0].supporting[0].origin === 'sample')
  const g1 = candidateMatches(c, k('G1'))
  assert.equal(g1.verdict, NO_MATCH); assert.equal(g1.rejected.length, 1); assert.equal(g1.rejected[0].score, 5)
  const h2 = candidateMatches(c, k('H2'))
  assert.equal(h2.verdict, NO_MATCH); assert.equal(h2.rejected.length, 0, 'a mention without a named identifier is not a candidate')
})

test('identity: corroboration raises and contradiction lowers the score deterministically', () => {
  const addr = A(7)
  const f = (id, publisher, sourceKind, identifies) => ({ id, publisher, sourceKind, title: id, url: `https://x.example/${id}`, excerpt: `wallet ${addr}`, matches: [{ address: addr, identifies }] })
  const one = candidateMatches({ osint: [f('a', 'P1', 'sanctions', 'Group X')] }, addr)
  assert.equal(one.candidates[0].score, 45); assert.equal(one.candidates[0].band, 'Medium')
  const two = candidateMatches({ osint: [f('a', 'P1', 'sanctions', 'Group X'), f('b', 'P2', 'researcher', 'Group X')] }, addr)
  assert.equal(two.candidates[0].score, 60); assert.equal(two.candidates[0].band, 'High')
  const contra = candidateMatches({ osint: [f('a', 'P1', 'sanctions', 'Group X'), f('b', 'P2', 'researcher', 'Group Y')] }, addr)
  assert.equal(contra.verdict, NO_MATCH, 'a contradicted sanctions-list name falls below the threshold')
  const x = contra.rejected.find((r) => r.identifier === 'Group X')
  assert.equal(x.score, 20); assert.equal(x.contradicting[0].names, 'Group Y')
  const noAddr = candidateMatches({ osint: [{ ...f('a', 'P1', 'sanctions', 'Group X'), excerpt: 'no address here' }] }, addr)
  assert.equal(noAddr.verdict, NO_MATCH, 'no exact address in the source means no match')
})
