// Automated OSINT ingestion (server side). Each adapter queries one permitted public source and returns
// records only for an exact, case-insensitive match of a full 40-hex address. No result means no record:
// nothing is inferred or generated.
//
// Sources (all usable without paid keys):
//   ofac        community mirror of the OFAC SDN Ethereum addresses (address + sanctioned name)
//   scamsniffer ScamSniffer scam-database blacklist (addresses only)
//   github      GitHub issue / pull request search (mentions). Optional GITHUB_TOKEN raises the rate limit.
// Records are deduplicated (source + url + address) and kept in a local JSON store with retrieval times.

import { HttpError } from './eth.js'
import { createEvidenceStore } from './evidenceStore.js'

const ADDR = /0x[0-9a-fA-F]{40}/g
const lc = (s) => String(s || '').toLowerCase()
const LIST_TTL_MS = 6 * 3600000

async function getText(url, { timeoutMs = 10000, headers = {}, name }) {
  let res
  try { res = await fetch(url, { headers: { 'user-agent': 'GhostTrace-OSINT', ...headers }, signal: AbortSignal.timeout(timeoutMs) }) } catch (e) {
    throw e.name === 'TimeoutError' || e.name === 'AbortError' ? new HttpError(504, 'source_timeout', `${name} did not answer within ${timeoutMs / 1000}s`) : new HttpError(502, 'source_unreachable', `Could not reach ${name}`)
  }
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    throw new HttpError(429, 'source_rate_limited', `${name} rate limit reached${reset ? `; resets ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC` : ''}`)
  }
  if (!res.ok) throw new HttpError(502, 'source_error', `${name} answered HTTP ${res.status}`)
  return res.text()
}

const excerptAround = (text, address, span = 140) => {
  const i = lc(text).indexOf(lc(address))
  if (i < 0) return null
  const s = Math.max(0, i - span), e = Math.min(text.length, i + address.length + span)
  return (s ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '')
}

export function createOsintService(env = process.env, { now = () => Date.now(), store: injected = null } = {}) {
  const urls = {
    ofac: env.OSINT_OFAC_URL || 'https://raw.githubusercontent.com/ultrasoundmoney/ofac-ethereum-addresses/main/data.csv',
    ofacPage: 'https://github.com/ultrasoundmoney/ofac-ethereum-addresses/blob/main/data.csv',
    scamsniffer: env.OSINT_SCAMSNIFFER_URL || 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json',
    scamsnifferPage: 'https://github.com/scamsniffer/scam-database/blob/main/blacklist/address.json',
    github: env.OSINT_GITHUB_API || 'https://api.github.com',
  }
  const timeoutMs = Number(env.OSINT_TIMEOUT_MS) > 0 ? Number(env.OSINT_TIMEOUT_MS) : 10000
  const ghHeaders = { accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) }
  // shared evidence store (Supabase when the server-side key is set, otherwise a local file)
  const store = injected || createEvidenceStore(env.OSINT_STORE_PATH ? { ...env, EVIDENCE_STORE_PATH: env.OSINT_STORE_PATH } : env)
  const lists = {} // id -> { at, data }
  async function cachedList(id, loader) {
    if (lists[id] && now() - lists[id].at < LIST_TTL_MS) return lists[id].data
    const data = await loader(); lists[id] = { at: now(), data }; return data
  }

  const adapters = {
    async ofac(addresses) {
      const map = await cachedList('ofac', async () => {
        const csv = await getText(urls.ofac, { timeoutMs, name: 'OFAC list mirror' })
        const m = new Map()
        for (const line of csv.split(/\r?\n/).slice(1)) {
          const k = line.indexOf(',')
          if (k < 0) continue
          const a = lc(line.slice(0, k).trim()); const name = line.slice(k + 1).trim().replace(/^"|"$/g, '')
          if (/^0x[0-9a-f]{40}$/.test(a)) m.set(a, { line: line.trim(), name })
        }
        if (!m.size) throw new HttpError(502, 'source_error', 'OFAC list mirror returned no addresses')
        return m
      })
      return addresses.filter((a) => map.has(a)).map((a) => ({
        source: 'ofac', sourceName: 'OFAC SDN Ethereum addresses (community mirror)', sourceKind: 'sanctions', sourceType: 'Sanctions list (mirror)',
        url: urls.ofacPage, officialUrl: 'https://sanctionssearch.ofac.treas.gov/', address: a, published: null, title: `Sanctions list entry: ${map.get(a).name}`,
        excerpt: map.get(a).line, identifies: map.get(a).name, confidence: 'Strong',
        verification: 'Listed in a community-maintained mirror of the US Treasury OFAC SDN list. Not verified against the official list by GhostTrace: confirm on the official OFAC sanctions search before relying on it.',
      }))
    },
    async scamsniffer(addresses) {
      const set = await cachedList('scamsniffer', async () => {
        const list = JSON.parse(await getText(urls.scamsniffer, { timeoutMs, name: 'ScamSniffer scam-database' }))
        if (!Array.isArray(list)) throw new HttpError(502, 'source_error', 'ScamSniffer scam-database returned an unexpected format')
        return new Set(list.map(lc))
      })
      return addresses.filter((a) => set.has(a)).map((a) => ({
        source: 'scamsniffer', sourceName: 'ScamSniffer scam-database', sourceKind: 'threat-list', sourceType: 'Threat list',
        url: urls.scamsnifferPage, address: a, published: null, title: 'Listed in the ScamSniffer scam-address list',
        excerpt: `"${a}" appears in blacklist/address.json of the public ScamSniffer scam-database repository.`, identifies: null, confidence: 'Weak',
        verification: 'Community-curated scam list. The list gives no reason or attribution per address; not independently verified.',
      }))
    },
    async github(addresses) {
      const out = []
      for (const a of addresses) {
        const body = JSON.parse(await getText(`${urls.github}/search/issues?q=${a}&per_page=10`, { timeoutMs, headers: ghHeaders, name: 'GitHub search' }))
        for (const it of body.items || []) {
          const text = `${it.title || ''}\n${it.body || ''}`
          const found = (text.match(ADDR) || []).map(lc)
          if (!found.includes(a)) continue // search is fuzzy: keep only exact full-address mentions
          out.push({
            source: 'github', sourceName: 'GitHub issues and pull requests', sourceKind: 'developer', sourceType: it.pull_request ? 'GitHub pull request' : 'GitHub issue',
            url: it.html_url, address: a, published: it.created_at ? Date.parse(it.created_at) : null, title: String(it.title || '').slice(0, 140),
            excerpt: excerptAround(text, a) || it.title, identifies: null, confidence: 'Weak',
            verification: 'Mention of the exact address in a public GitHub issue or pull request. Context is not verified and a mention is not an attribution.',
          })
        }
      }
      return out
    },
  }

  // addresses: wallets to check against list sources; deep: subset also searched on GitHub (rate-limited)
  async function lookup(addresses, { deep = [] } = {}) {
    const all = [...new Set(addresses.map(lc))], deepSet = [...new Set(deep.map(lc))].filter((a) => all.includes(a))
    const retrievedAt = now()
    const sources = [], records = []
    for (const [id, targets] of [['ofac', all], ['scamsniffer', all], ['github', deepSet]]) {
      if (!targets.length) { sources.push({ id, status: 'skipped', checked: 0, found: 0, message: 'No addresses requested for this source' }); continue }
      try {
        const found = await adapters[id](targets)
        sources.push({ id, status: 'ok', checked: targets.length, found: found.length })
        records.push(...found)
      } catch (e) {
        sources.push({ id, status: e.code === 'source_rate_limited' ? 'rate_limited' : 'unavailable', checked: targets.length, found: 0, message: e.message })
      }
    }
    // dedupe within this lookup and against the store; keep the first retrieval time
    const seen = new Set(), unique = []
    for (const r of records) {
      const key = `${r.source}|${r.url}|${r.address}`
      if (seen.has(key)) continue
      seen.add(key)
      const prev = await store.get(key).catch(() => null)
      unique.push({ ...r, key, firstRetrievedAt: prev?.firstRetrievedAt || retrievedAt, retrievedAt, origin: 'external' })
    }
    let stored = true
    if (unique.length) await store.upsert(unique).catch((e) => { stored = false; console.warn('[ghosttrace-osint] could not store evidence:', e.message) })
    return { retrievedAt, sources, records: unique, findings: unique.map(toFinding), stored, storage: store.status() }
  }
  return { lookup, adapters, store }
}

// GhostTrace evidence shape (same as case.osint entries), marked as externally sourced.
export function toFinding(r, i) {
  if (r.origin === 'manual') return manualFinding(r)
  return {
    id: `EX-${String(i + 1).padStart(2, '0')}`, origin: 'external', sourceKind: r.sourceKind, sourceType: r.sourceType, publisher: r.sourceName,
    title: r.title, url: r.url, published: r.published, collected: r.retrievedAt, confidence: r.confidence, reliability: r.verification,
    excerpt: r.excerpt, identifiers: [{ type: 'address', value: r.address }],
    matches: [{ address: r.address, reason: 'Exact full-address match in the source.', ...(r.identifies ? { identifies: r.identifies } : {}) }],
    relatedTx: [], officialUrl: r.officialUrl || null,
  }
}

// Manually entered evidence in the same finding shape, clearly marked as the investigator's own entry.
export function manualFinding(r) {
  return {
    id: `MN-${r.key.split('|').pop().slice(0, 6).toUpperCase()}`, origin: 'manual', sourceKind: 'manual', sourceType: r.evidenceType || 'Investigator note', publisher: 'Entered manually by an investigator',
    title: r.title, url: r.url || '', published: r.published || null, collected: r.createdAt, confidence: r.confidence, reliability: r.verification,
    excerpt: r.excerpt, identifiers: r.address ? [{ type: 'address', value: r.address }] : [], relatedTx: [], caseRef: r.caseRef, key: r.key,
    matches: r.address ? [{ address: r.address, reason: 'Linked to this wallet by the investigator who entered this evidence (manual entry, not independently sourced).' }] : [],
  }
}
