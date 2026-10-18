// GhostTrace live-data backend (Node, no extra dependencies).
//
//   npm run server                     → http://localhost:8787
//   GET /api/health                    → provider status (never reveals keys)
//   GET /api/wallets/:address          → live Ethereum mainnet transfers in the GhostTrace case shape
//   GET /api/cases/:caseId?seed=0x…    → same, for the app's Settings → Data source → Refresh contract
//   GET /api/osint?addresses=0x…,0x…&deep=0x…  → public-source evidence (exact address matches only)
//   POST /api/evidence  (JSON)            → save manually entered evidence;  GET /api/evidence?case=…&addresses=…
//   GET /api/bridge-trace?tx=0x…          → match an Ethereum bridge deposit to its destination-chain credit
//
// Env (server side only; never prefix with VITE_): none required (Routescan works without a key).
// Optional: ETHERSCAN_API_KEY (Etherscan V2, tried first), BLOCKSCOUT_API_KEY (raises the fallback's quota), PORT,
// HOST, ALLOWED_ORIGINS (comma-separated, added to any localhost origin; ALLOW_LOCAL_ORIGINS=false disables those), MAX_RECORDS_PER_TYPE (1000), MAX_TOKEN_TRANSFERS (200), UPSTREAM_TIMEOUT_MS,
// RATE_LIMIT_PER_MIN, CACHE_TTL_MS. Evidence: SUPABASE_SECRET_KEY (server-only; persists evidence to Supabase), EVIDENCE_STORE_PATH,
// EVIDENCE_WRITE_TOKEN (required for POST/DELETE /api/evidence; without it evidence writes are disabled). OSINT: GITHUB_TOKEN (optional), OSINT_TIMEOUT_MS, OSINT_STORE_PATH ('off' disables).
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { providerChain, fetchWithFallback, mapToCase, isEthAddress, HttpError, DEFAULT_LIMITS } from './eth.js'
import { createOsintService } from './osint.js'
import { createPriceService } from './prices.js'
import { createEvidenceStore } from './evidenceStore.js'
import { validateManual, readJson, EVIDENCE_TYPES, VERIFICATION } from './evidence.js'
import { manualFinding, toFinding } from './osint.js'
import { chainAdapters, traceBridge } from './chains.js'
import { createWriteAuth } from './auth.js'

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)

export function createServer(env = process.env) {
  const providers = providerChain(env)
  const evidence = createEvidenceStore(env.OSINT_STORE_PATH && !env.EVIDENCE_STORE_PATH ? { ...env, EVIDENCE_STORE_PATH: env.OSINT_STORE_PATH } : env)
  const osint = createOsintService(env, { store: evidence })
  const adapters = chainAdapters(env, providers)
  const auth = createWriteAuth(env)
  const traces = new Map() // source hash -> { at, body }
  const prices = env.HISTORICAL_PRICES === 'off' ? null : createPriceService(env)
  const cap = (v, d) => Math.min(num(v, d), 10000)
  const limits = { normal: cap(env.MAX_RECORDS_PER_TYPE, DEFAULT_LIMITS.normal), internal: cap(env.MAX_RECORDS_PER_TYPE, DEFAULT_LIMITS.internal), token: cap(env.MAX_TOKEN_TRANSFERS, DEFAULT_LIMITS.token) }
  const timeoutMs = num(env.UPSTREAM_TIMEOUT_MS, 10000)
  const ratePerMin = num(env.RATE_LIMIT_PER_MIN, 20)
  const cacheTtl = num(env.CACHE_TTL_MS, 120000)
  // Any local dev origin (localhost / 127.0.0.1, any port) plus ALLOWED_ORIGINS (comma-separated) for deployments.
  // The deployed GhostTrace frontend is allowed by default; ALLOWED_ORIGINS adds more (comma-separated).
  const origins = new Set(['https://ghosttrace-sand.vercel.app', ...(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)])
  const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
  const allowed = (o) => origins.has(o) || (env.ALLOW_LOCAL_ORIGINS !== 'false' && LOCAL_ORIGIN.test(o))
  const cache = new Map() // address -> { at, body }
  const inflight = new Map() // address -> Promise (one upstream lookup per address at a time)
  const hits = new Map() // ip -> [timestamps]

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
    res.end(JSON.stringify(body))
  }
  const fail = (res, e, headers) => send(res, e.status || 500, { error: { code: e.code || 'internal_error', message: e.status ? e.message : 'Unexpected server error', ...(e.fields ? { fields: e.fields } : {}) } }, headers)

  function limited(ip) {
    const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 60000)
    list.push(now); hits.set(ip, list)
    return list.length > ratePerMin
  }

  async function lookup(address) {
    const key = address.toLowerCase()
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < cacheTtl) return { ...hit.body, cached: true }
    if (!inflight.has(key)) {
      inflight.set(key, (async () => {
        const fetchedAt = Date.now()
        const { raw, provider } = await fetchWithFallback(providers, key, { limits, timeoutMs })
        // daily historical ETH prices for the days these transfers happened (optional: falls back to labelled current price)
        let history = null
        if (prices) {
          const stamps = ['normal', 'token', 'internal'].flatMap((k) => (raw[k] || []).map((t) => Number(t.timeStamp) * 1000))
          history = await prices.forTimestamps(stamps).catch((e) => ({ priceAt: () => null, error: e.message, source: null }))
          if (history.error) raw.warnings.push(`Historical prices partly unavailable (${history.error}); affected ETH values use today's price and are labelled as such.`)
        }
        const body = mapToCase(raw, { address: key, provider, fetchedAt, limits, history })
        cache.set(key, { at: fetchedAt, body })
        return body
      })().finally(() => inflight.delete(key)))
    }
    try {
      return { ...(await inflight.get(key)), cached: false }
    } catch (e) {
      // Provider rate-limited or down: serve the last good result for this address (up to 24 h old), clearly marked.
      const old = cache.get(key)
      if (old && Date.now() - old.at < 24 * 3600000 && ['upstream_rate_limited', 'upstream_timeout', 'upstream_unreachable', 'upstream_error'].includes(e.code)) {
        const mins = Math.round((Date.now() - old.at) / 60000)
        return { ...old.body, cached: true, stale: true, fetched: { ...old.body.fetched, warnings: [`Live provider unavailable (${e.message}). Showing data fetched ${mins} min ago.`, ...old.body.fetched.warnings] } }
      }
      throw e
    }
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin
    const cors = origin && allowed(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}
    if (req.method === 'OPTIONS') { res.writeHead(origin && !cors['access-control-allow-origin'] ? 403 : 204, { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'accept, content-type, authorization', 'access-control-max-age': '600' }); return res.end() }
    if (origin && !cors['access-control-allow-origin']) {
      console.warn(`[ghosttrace-api] ${req.url} → 403 blocked origin ${origin} (add it to ALLOWED_ORIGINS)`)
      return fail(res, new HttpError(403, 'origin_not_allowed', `Origin ${origin} is not allowed. Add it to ALLOWED_ORIGINS.`))
    }
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '')
    if (req.method !== 'GET' && !((req.method === 'POST' || req.method === 'DELETE') && path === '/api/evidence')) return fail(res, new HttpError(405, 'method_not_allowed', 'Only GET is supported here (POST and DELETE only on /api/evidence)'), cors)
    try {
      if (path === '/api/evidence' && req.method === 'POST') {
        auth.check(req, req.socket.remoteAddress || 'unknown')
        if (limited(req.socket.remoteAddress || 'unknown')) throw new HttpError(429, 'rate_limited', `Too many requests: limit is ${ratePerMin} per minute.`)
        const rec = validateManual(await readJson(req))
        const { duplicate, record } = await evidence.insert(rec)
        if (duplicate) return send(res, 409, { error: { code: 'duplicate_evidence', message: 'This evidence has already been entered for this case and wallet.' }, record, finding: record && manualFinding(record) }, cors)
        console.log(`[ghosttrace-api] manual evidence saved for ${record.caseRef} (${evidence.status().backend})`)
        return send(res, 201, { record, finding: manualFinding(record), storage: evidence.status() }, cors)
      }
      if (path === '/api/evidence' && req.method === 'DELETE') {
        auth.check(req, req.socket.remoteAddress || 'unknown')
        const key = (url.searchParams.get('key') || '').trim()
        if (!/^manual\|[0-9a-f]{32}$/.test(key)) throw new HttpError(400, 'invalid_key', 'Pass ?key= the key of a manually entered evidence record. Only manual entries can be removed.')
        let removed
        try { removed = await evidence.remove(key) } catch (e) { throw new HttpError(502, 'storage_error', e.code === '42501' ? 'The evidence store refused the delete (permission denied). Grant DELETE on public.evidence_records to service_role.' : e.message) }
        if (!removed) throw new HttpError(404, 'not_found', 'No manual evidence with this key.')
        console.log(`[ghosttrace-api] manual evidence removed (${evidence.status().backend})`)
        return send(res, 200, { removed: true, key }, cors)
      }
      if (path === '/api/evidence') {
        const caseRef = (url.searchParams.get('case') || '').trim()
        const addresses = new Set((url.searchParams.get('addresses') || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))
        if (!caseRef && !addresses.size) throw new HttpError(400, 'missing_query', 'Pass ?case={case id} and/or &addresses=0x…')
        if (addresses.size > 300) throw new HttpError(400, 'too_many_addresses', 'At most 300 addresses per request.')
        const bad = [...addresses].find((a) => !isEthAddress(a)); if (bad) throw new HttpError(400, 'invalid_address', `Not an Ethereum address: "${bad.slice(0, 60)}"`)
        const records = await evidence.query({ caseRef, addresses })
        return send(res, 200, { storage: evidence.status(), records, findings: records.map((r, i) => (r.origin === 'manual' ? manualFinding(r) : toFinding(r, i))), options: { evidenceTypes: EVIDENCE_TYPES, verification: Object.keys(VERIFICATION) } }, cors)
      }
      if (path === '/api/bridge-trace') {
        const hash = (url.searchParams.get('tx') || '').trim().toLowerCase()
        if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new HttpError(400, 'invalid_tx', 'Pass ?tx= a 0x-prefixed 64-hex Ethereum transaction hash.')
        const hit = traces.get(hash)
        if (hit && Date.now() - hit.at < 600000) return send(res, 200, { ...hit.body, cached: true }, cors)
        if (limited(req.socket.remoteAddress || 'unknown')) throw new HttpError(429, 'rate_limited', `Too many lookups: limit is ${ratePerMin} per minute.`)
        const body = await traceBridge(hash, { adapters })
        traces.set(hash, { at: Date.now(), body })
        console.log(`[ghosttrace-api] bridge trace ${hash.slice(0, 12)}… → ${body.status}${body.destinationChain ? ` (${body.destinationChain})` : ''}`)
        return send(res, 200, body, cors)
      }
      if (path === '/api/health') {
        return send(res, 200, { ok: true, provider: providers[0].id, fallbacks: providers.slice(1).map((p) => p.id), network: 'ethereum-mainnet', apiKeyConfigured: providers.some((p) => p.secret), limits,
          evidenceStorage: evidence.status(), evidenceWrites: auth.status(), historicalPrices: !!prices, chains: Object.fromEntries(Object.entries(adapters).filter(([, a]) => a).map(([k, a]) => [k, a.available()])) }, cors)
      }
      if (path === '/api/osint') {
        const list = (k) => (url.searchParams.get(k) || '').split(',').map((x) => x.trim()).filter(Boolean)
        const addresses = list('addresses'), deep = list('deep')
        if (!addresses.length) throw new HttpError(400, 'missing_addresses', 'Pass ?addresses=0x…,0x… (up to 300) and optionally &deep=0x… (up to 3, also searched on GitHub).')
        if (addresses.length > 300 || deep.length > 3) throw new HttpError(400, 'too_many_addresses', 'At most 300 addresses and 3 deep-search addresses per request.')
        const bad = [...addresses, ...deep].find((a) => !isEthAddress(a))
        if (bad) throw new HttpError(400, 'invalid_address', `Not an Ethereum address: "${bad.slice(0, 60)}"`)
        if (limited(req.socket.remoteAddress || 'unknown')) throw new HttpError(429, 'rate_limited', `Too many lookups: limit is ${ratePerMin} per minute.`)
        const body = await osint.lookup(addresses, { deep })
        console.log(`[ghosttrace-api] /api/osint ${addresses.length} addresses → ${body.records.length} records (${body.sources.map((x) => `${x.id}:${x.status}`).join(', ')})`)
        return send(res, 200, body, cors)
      }
      let address
      const w = path.match(/^\/api\/wallets\/([^/]+)$/)
      const c = path.match(/^\/api\/cases\/([^/]+)$/)
      if (w) address = decodeURIComponent(w[1])
      else if (c) {
        address = url.searchParams.get('seed') || url.searchParams.get('address')
        if (!address) throw new HttpError(400, 'missing_seed', `Case ${decodeURIComponent(c[1])} needs a seed wallet: call /api/cases/{id}?seed=0x… (the app adds it for cases created from an address).`)
      } else throw new HttpError(404, 'not_found', 'Unknown endpoint. Use /api/health, /api/wallets/{address}, /api/cases/{id}?seed={address}, /api/osint, /api/evidence or /api/bridge-trace.')

      address = String(address).trim()
      if (!isEthAddress(address)) {
        const shown = address.length > 60 ? address.slice(0, 60) + '…' : address
        throw new HttpError(400, 'invalid_address', `Not an Ethereum address: "${shown}" (${address.length} characters). Expected 0x followed by exactly 40 hex characters, with nothing after it.`)
      }
      const chain = url.searchParams.get('chain')
      if (chain && !/^(ethereum|eth|mainnet|1)$/i.test(chain)) throw new HttpError(400, 'unsupported_chain', `Only Ethereum mainnet is supported (got "${chain}").`)
      if (limited(req.socket.remoteAddress || 'unknown')) throw new HttpError(429, 'rate_limited', `Too many lookups: limit is ${ratePerMin} per minute.`)

      const body = await lookup(address)
      console.log(`[ghosttrace-api] ${path} → ${body.txs.length} transfers via ${body.fetched.provider}${body.cached ? ' (cached)' : ''}`)
      return send(res, 200, body, cors)
    } catch (e) {
      if (!e.status) console.error('[ghosttrace-api] unexpected error:', e.message)
      else console.warn(`[ghosttrace-api] ${path} → ${e.status} ${e.code}: ${e.message}`)
      return fail(res, e, cors)
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dotenv.config({ path: '.env.local', quiet: true })
  dotenv.config({ path: '.env', quiet: true })
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('VITE_') && /etherscan|blockscout|explorer|secret|write_token|github_token/i.test(k) && v) {
    console.error(`✖ ${k} is set. VITE_ variables are shipped to the browser; use ETHERSCAN_API_KEY or BLOCKSCOUT_API_KEY (no VITE_ prefix) instead.`); process.exit(1)
  }
  // Hosted platforms (Render sets RENDER=true and PORT) need 0.0.0.0 so the platform can reach the server;
  // local development stays on 127.0.0.1. HOST overrides both.
  const hosted = !!process.env.RENDER || process.env.NODE_ENV === 'production'
  const port = num(process.env.PORT, 8787), host = process.env.HOST || (hosted ? '0.0.0.0' : '127.0.0.1')
  const chain = providerChain()
  createServer().listen(port, host, () => console.log(`GhostTrace API listening on ${host}:${port} (${host === '127.0.0.1' ? `http://localhost:${port}/api` : 'all interfaces, /api'})  (providers: ${chain.map((p) => p.name + (p.secret ? ' [key from server env]' : '')).join(' → ')})`))
}
