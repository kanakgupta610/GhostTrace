// Mapping between the in-app case model (src/data/cases.js) and the Supabase tables
// `cases`, `wallets`, `transactions`, `osint_evidence`, `wallet_clusters`.
// Shared by the import script (Node) and the frontend loader, so both sides agree on ids.
//
// Row ids for the bundled sample cases are deterministic UUIDs derived from stable keys
// (case code, wallet address, transfer id …). Re-running the import therefore upserts the
// same rows instead of creating duplicates, and the loader can recognise which database
// row belongs to which sample record without an extra "external id" column.
//
// The database schema stores a subset of the case model. Fields it has no column for
// (case owner/activity/seed, wallet tags/balances, transfer method/block, OSINT source
// type/reliability/related transfers, cluster confidence/caveat) are taken from
// the bundled sample record when the row belongs to a sample case.

// cyrb128: small, fast 128-bit string hash (pure JS, synchronous, same result in Node and browsers)
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('')
}

// Deterministic UUID (version 8 "custom" layout, RFC 9562) for a stable key.
export function stableUuid(key) {
  const h = cyrb128('ghosttrace:' + key).split('')
  h[12] = '8'
  h[16] = '89ab'[parseInt(h[16], 16) & 3]
  const s = h.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

const lc = (a) => (a || '').toLowerCase()
export const ids = {
  case: (code) => stableUuid(`case:${code}`),
  wallet: (code, address) => stableUuid(`wallet:${code}:${lc(address)}`),
  tx: (code, txId) => stableUuid(`tx:${code}:${txId}`),
  osint: (code, findingId, address) => stableUuid(`osint:${code}:${findingId}:${lc(address)}`),
  cluster: (code, clusterId) => stableUuid(`cluster:${code}:${clusterId}`),
  member: (code, clusterId, address) => stableUuid(`cluster_member:${code}:${clusterId}:${lc(address)}`),
}

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString())
const clean = (n) => Number(n.toPrecision(15)) // drop float noise such as 0.0001 * 2400 = 0.24000000000000002

// ── app case → table rows (used by import-sample-data.js) ──
// `riskScores` is an optional Map(address -> integer score | null).
export function caseToRows(c, riskScores = new Map()) {
  const caseId = ids.case(c.id)
  const walletId = new Map(c.wallets.map((w) => [lc(w.address), ids.wallet(c.id, w.address)]))
  const cases = [{
    id: caseId, title: c.title, description: c.summary, chain: c.chain,
    status: c.status, priority: c.priority, is_sample: true, created_at: iso(c.createdAt),
  }]
  const wallets = c.wallets.map((w) => ({
    id: walletId.get(lc(w.address)), case_id: caseId, address: w.address, label: w.label,
    category: w.category, risk_score: riskScores.get(w.address) ?? null,
  }))
  const transactions = c.txs.map((t) => ({
    id: ids.tx(c.id, t.id), case_id: caseId, chain: c.chain, tx_hash: t.hash,
    from_address: t.from, to_address: t.to, asset: t.asset, amount: clean(t.amount), usd_value: clean(t.usd),
    block_timestamp: iso(t.ts),
  }))
  // osint_evidence links one finding to one wallet (wallet_id), so a finding that names
  // several wallets becomes one row per matched wallet. `identifier` holds that wallet's address.
  const osint_evidence = c.osint.flatMap((o) => o.matches.map((m) => ({
    id: ids.osint(c.id, o.id, m.address), case_id: caseId, wallet_id: walletId.get(lc(m.address)) ?? null,
    title: o.title, source_url: o.url, publisher: o.publisher, published_at: iso(o.published),
    collected_at: iso(o.collected), confidence: o.confidence, identifier: m.address, evidence_text: o.excerpt,
  })))
  const wallet_clusters = c.clusters.map((cl) => ({
    id: ids.cluster(c.id, cl.id), case_id: caseId, name: cl.name, description: cl.basis, method: cl.method,
  }))
  const wallet_cluster_members = c.clusters.flatMap((cl) => cl.members.map((a) => ({
    id: ids.member(c.id, cl.id, a), case_id: caseId, cluster_id: ids.cluster(c.id, cl.id), wallet_id: walletId.get(lc(a)),
  })))
  return { cases, wallets, transactions, osint_evidence, wallet_clusters, wallet_cluster_members }
}

// ── table rows → app case (used by the frontend loader) ──
const CONFIDENCE = { confirmed: 'Confirmed', high: 'Strong', strong: 'Strong', medium: 'Strong', moderate: 'Strong', weak: 'Weak', low: 'Weak' }
const normConfidence = (v) => CONFIDENCE[lc(v).trim()] || 'Weak'
const ms = (v) => (v == null ? null : Date.parse(v))
const num = (v) => (v == null || v === '' ? 0 : Number(v))
const guessIdType = (v) => (/^0x[0-9a-f]{64}$/i.test(v) ? 'tx' : /^0x[0-9a-f]{40}$/i.test(v) ? 'address' : 'text')

// rows: { caseRow, wallets, transactions, osint, clusters, members } — all rows for one case
// (members = wallet_cluster_members rows, or null when that table is not available).
// samples: the bundled sample cases, used to fill fields the schema has no column for.
// Returns null when the database case has no wallets (nothing to investigate).
export function rowsToCase(rows, samples, loadedAt = Date.now()) {
  const { caseRow } = rows
  const sample = samples.find((s) => ids.case(s.id) === caseRow.id) || null
  const code = sample ? sample.id : caseRow.id
  const chain = caseRow.chain || sample?.chain || 'Ethereum'

  // wallets
  const sampleWallet = new Map((sample?.wallets || []).map((w) => [lc(w.address), w]))
  const wallets = rows.wallets.map((r) => {
    const s = sampleWallet.get(lc(r.address))
    return {
      ...(s || { chain, tags: [], externalInflowUsd: 0, balanceEth: null, firstSeen: null }),
      address: r.address, label: r.label || s?.label || 'Unlabelled wallet', category: r.category || s?.category || 'unknown', dbId: r.id,
    }
  })
  // canonical address spelling per lower-cased address
  const canon = new Map(wallets.map((w) => [lc(w.address), w.address]))
  const addrOf = (a) => canon.get(lc(a))

  // transfers
  const sampleTx = new Map((sample?.txs || []).map((t) => [ids.tx(sample.id, t.id), t]))
  const txs = rows.transactions.map((r) => {
    const s = sampleTx.get(r.id)
    for (const a of [r.from_address, r.to_address]) {
      if (a && !addrOf(a)) { // referenced but not in wallets: add a stub so the graph and analysis stay consistent
        const w = { address: a, chain, label: 'Unlabelled wallet', category: 'unknown', tags: [], externalInflowUsd: 0, balanceEth: null, firstSeen: null }
        wallets.push(w); canon.set(lc(a), a)
      }
    }
    return {
      id: s?.id || `${code}-${r.id.slice(0, 8)}`, dbId: r.id,
      hash: r.tx_hash, from: addrOf(r.from_address), to: addrOf(r.to_address), asset: r.asset || 'ETH',
      amount: num(r.amount), usd: num(r.usd_value), ts: ms(r.block_timestamp) ?? ms(r.created_at),
      block: s?.block ?? null, method: s?.method || 'transfer', note: s?.note || '', status: s?.status || 'success',
      source: s ? `${s.source} · stored in Supabase` : 'Supabase transactions table',
    }
  }).filter((t) => t.from && t.to && Number.isFinite(t.ts))
  // Database rows come back in arbitrary order. The analysis processes transfers in time order and
  // same-timestamp transfers (swap legs, same-block splits) in list order, so restore the dataset order.
  const txOrder = new Map((sample?.txs || []).map((t, i) => [t.id, i]))
  const rank = (m, k) => m.get(k) ?? Infinity
  txs.sort((a, b) => a.ts - b.ts || rank(txOrder, a.id) - rank(txOrder, b.id) || a.dbId.localeCompare(b.dbId))
  const walletOrder = new Map((sample?.wallets || []).map((w, i) => [lc(w.address), i]))
  wallets.sort((a, b) => rank(walletOrder, lc(a.address)) - rank(walletOrder, lc(b.address)))
  const txIds = new Set(txs.map((t) => t.id))

  // OSINT: group rows that belong to the same sample finding back into one finding
  const walletById = new Map(rows.wallets.map((r) => [r.id, addrOf(r.address)]))
  const sampleOsint = new Map()
  for (const o of sample?.osint || []) for (const m of o.matches) sampleOsint.set(ids.osint(sample.id, o.id, m.address), { o, m })
  const findings = new Map()
  for (const r of rows.osint) {
    const hit = sampleOsint.get(r.id)
    const address = walletById.get(r.wallet_id) || addrOf(r.identifier)
    const key = hit ? hit.o.id : r.id
    if (!findings.has(key)) {
      const base = hit ? hit.o : {
        id: `OS-${r.id.slice(0, 6).toUpperCase()}`, sourceType: 'Public source', reliability: 'Not recorded in the database',
        identifiers: r.identifier ? [{ type: guessIdType(r.identifier), value: r.identifier }] : [], relatedTx: [],
      }
      findings.set(key, {
        ...base, title: r.title || base.title || 'Untitled finding', url: r.source_url || base.url || '', publisher: r.publisher || base.publisher || 'Unknown publisher',
        published: ms(r.published_at) ?? base.published ?? null, collected: ms(r.collected_at) ?? base.collected ?? null,
        confidence: normConfidence(r.confidence), excerpt: r.evidence_text ?? base.excerpt ?? '',
        relatedTx: (base.relatedTx || []).filter((id) => txIds.has(id)), matches: [], dbIds: [],
      })
    }
    const f = findings.get(key)
    f.dbIds.push(r.id)
    if (address && !f.matches.some((m) => m.address === address)) {
      f.matches.push({ ...(hit?.m || { reason: 'Linked to this wallet in the evidence record.' }), address })
    }
  }
  const osint = [...findings.values()]
  if (sample) {
    const order = sample.osint.map((o) => o.id)
    osint.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    for (const f of osint) {
      const matchOrder = new Map((sample.osint.find((o) => o.id === f.id)?.matches || []).map((x, i) => [lc(x.address), i]))
      f.matches.sort((a, b) => rank(matchOrder, lc(a.address)) - rank(matchOrder, lc(b.address)))
    }
  }

  // clusters: membership comes from wallet_cluster_members. `rows.members` is null only when that
  // table does not exist yet; then the bundled sample record supplies membership for sample cases.
  const sampleCluster = new Map((sample?.clusters || []).map((cl) => [ids.cluster(sample.id, cl.id), cl]))
  const clusters = rows.clusters.map((r) => {
    const s = sampleCluster.get(r.id)
    let members
    if (rows.members) {
      const memberOrder = new Map((s?.members || []).map((a, i) => [lc(a), i]))
      members = rows.members.filter((m) => m.cluster_id === r.id).map((m) => walletById.get(m.wallet_id)).filter(Boolean)
      members = [...new Set(members)].sort((a, b) => rank(memberOrder, lc(a)) - rank(memberOrder, lc(b)))
    } else {
      members = (s?.members || []).map(addrOf).filter(Boolean)
    }
    return {
      id: s?.id || `CL-${r.id.slice(0, 6).toUpperCase()}`, dbId: r.id, name: r.name || s?.name || 'Cluster',
      method: r.method || s?.method || '', basis: r.description ?? s?.basis ?? '', confidence: s?.confidence || 'Low',
      caveat: s?.caveat || 'No caveat recorded in the database.',
      members,
    }
  }).filter((cl) => cl.members.length > 0)
  if (sample) { const order = sample.clusters.map((cl) => cl.id); clusters.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) }

  if (!wallets.length) return null
  const have = (a) => a && addrOf(a)
  const firstTs = txs.length ? Math.min(...txs.map((t) => t.ts)) : null
  const createdAt = ms(caseRow.created_at) ?? sample?.createdAt ?? loadedAt
  const fallbackSuspect = (wallets.find((w) => w.category === 'suspect') || wallets[0]).address
  return {
    ...(sample || {}),
    id: code, dbId: caseRow.id, title: caseRow.title || sample?.title || 'Untitled case',
    summary: caseRow.description ?? sample?.summary ?? '', chain, status: caseRow.status || sample?.status || 'Active',
    priority: caseRow.priority || sample?.priority || 'Medium', owner: sample?.owner || '—',
    createdAt, updatedAt: sample?.updatedAt ?? createdAt,
    sample: !!caseRow.is_sample, source: 'supabase', dataVersion: `db:${loadedAt}`,
    wallets, txs, osint, clusters,
    seed: have(sample?.seed) ? addrOf(sample.seed) : fallbackSuspect,
    primarySuspect: have(sample?.primarySuspect) ? addrOf(sample.primarySuspect) : fallbackSuspect,
    taintSources: sample ? sample.taintSources.map(addrOf).filter(Boolean) : wallets.filter((w) => w.category === 'victim').map((w) => w.address),
    attackStart: sample?.attackStart ?? firstTs ?? createdAt,
    initialVisible: sample ? sample.initialVisible.map(addrOf).filter(Boolean) : wallets.map((w) => w.address),
    activity: sample?.activity || [{ ts: createdAt, text: 'Case loaded from Supabase', kind: 'case' }],
  }
}
