// Run with: npm test   (Node's built-in test runner; no network access needed)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { units, mapToCase, isEthAddress, providerConfig, providerChain } from './eth.js'
import { createServer } from './index.js'
import { analyseCase } from '../src/lib/analysis.js'

const SEED = '0x1111111111111111111111111111111111111111'
const A = '0x2222222222222222222222222222222222222222'
const B = '0x3333333333333333333333333333333333333333'
const QUOTA = '0x5555555555555555555555555555555555555555'
const FALLBACK = '0x6666666666666666666666666666666666666666'
const TOKEN503 = '0x7777777777777777777777777777777777777777'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const FAKE_USDC = '0x9999999999999999999999999999999999999999'
const h = (n) => '0x' + String(n).padStart(64, '0')
const raw = {
  balance: '1500000000000000000', // 1.5 ETH
  price: { ethusd: '2000' },
  normal: [
    { hash: h(1), from: A, to: SEED, value: '2000000000000000000', timeStamp: '1700000000', blockNumber: '18000000', isError: '0', txreceipt_status: '1', input: '0x', functionName: '', methodId: '' },
    { hash: h(2), from: SEED, to: B, value: '500000000000000000', timeStamp: '1700000600', blockNumber: '18000050', isError: '0', txreceipt_status: '1', input: '0xa9059cbb', functionName: 'transfer(address _to, uint256 _value)', methodId: '0xa9059cbb' },
    { hash: h(3), from: SEED, to: B, value: '9000000000000000000', timeStamp: '1700000700', blockNumber: '18000060', isError: '1', txreceipt_status: '0', input: '0x' }, // failed: skipped
    { hash: h(4), from: SEED, to: '', contractAddress: '0x4444444444444444444444444444444444444444', value: '0', timeStamp: '1700000800', blockNumber: '18000070', isError: '0', txreceipt_status: '1', input: '0x6080' },
  ],
  token: [
    { hash: h(5), from: A, to: SEED, value: '250000000', tokenDecimal: '6', tokenSymbol: 'USDC', tokenName: 'USD Coin', contractAddress: USDC, timeStamp: '1700001000', blockNumber: '18000100' },
    { hash: h(6), from: A, to: SEED, value: '1000000000', tokenDecimal: '6', tokenSymbol: 'USDC', tokenName: 'Visit claim-usdc.example', contractAddress: FAKE_USDC, timeStamp: '1700001100', blockNumber: '18000110' },
  ],
  internal: [
    { transactionHash: h(7), from: B, to: SEED, value: '100000000000000000', timeStamp: '1700002000', blockNumber: '18000200', isError: '0', index: '0' },
    { transactionHash: h(8), from: B, to: SEED, value: '0', timeStamp: '1700002100', blockNumber: '18000210', isError: '0', index: '0' }, // zero-value: skipped
  ],
  warnings: [],
}
const provider = { id: 'blockscout', name: 'Blockscout' }

test('address validation', () => {
  assert.equal(isEthAddress(SEED), true)
  assert.equal(isEthAddress('0xAbCdEf0123456789abcdef0123456789ABCDEF01'), true)
  for (const bad of ['', '0x123', SEED + '0', 'vitalik.eth', '1111111111111111111111111111111111111111', '0xZZ11111111111111111111111111111111111111', null]) assert.equal(isEthAddress(bad), false, String(bad))
})

test('units converts integer strings exactly', () => {
  assert.equal(units('1500000000000000000', 18), 1.5)
  assert.equal(units('250000000', 6), 250)
  assert.equal(units('1', 18), 1e-18)
  assert.equal(units('12.5', 18), null)
  assert.equal(units('100', 99), null)
})

test('mapToCase produces the GhostTrace case shape', () => {
  const c = mapToCase(raw, { address: SEED.toUpperCase().replace('0X', '0x'), provider, fetchedAt: Date.UTC(2026, 9, 18, 12) })
  assert.equal(c.live, true); assert.equal(c.sample, false); assert.equal(c.seed, SEED)
  assert.deepEqual(c.osint, []); assert.deepEqual(c.clusters, []); assert.deepEqual(c.taintSources, [])
  assert.equal(c.txs.length, 6) // 3 normal (1 failed skipped) + 2 token + 1 internal (zero-value skipped)
  assert.deepEqual(c.fetched.skipped, { failed: 1, zeroInternal: 1, unparseable: 0 })
  const byHash = Object.fromEntries(c.txs.map((t) => [t.hash, t]))
  assert.equal(byHash[h(1)].amount, 2); assert.equal(byHash[h(1)].usd, 4000); assert.equal(byHash[h(1)].asset, 'ETH')
  assert.equal(byHash[h(2)].method, 'transfer')
  assert.equal(byHash[h(4)].method, 'contract creation'); assert.equal(byHash[h(4)].to, '0x4444444444444444444444444444444444444444')
  assert.equal(byHash[h(5)].asset, 'USDC'); assert.equal(byHash[h(5)].usd, 250)
  assert.equal(byHash[h(6)].asset, 'USDC?', 'look-alike token must not be shown as USDC'); assert.equal(byHash[h(6)].usd, 0)
  assert.equal(byHash[h(7)].method, 'internal transfer'); assert.equal(byHash[h(7)].amount, 0.1)
  for (const t of c.txs) {
    assert.match(t.source, /^Live Ethereum mainnet record via Blockscout/)
    if (t.asset === 'ETH') { assert.equal(t.priceBasis, 'current'); assert.match(t.source, /TODAY'S ETH price \(\$2,000\), not the price on 2023-11-1\d/) }
    if (t.asset === 'USDC') { assert.equal(t.priceBasis, 'stablecoin'); assert.match(t.source, /stablecoin traded at \$1/) }
    if (t.asset === 'USDC?') assert.equal(t.priceBasis, 'unpriced')
    assert.ok(c.wallets.some((w) => w.address === t.from) && c.wallets.some((w) => w.address === t.to))
  }
  assert.equal(new Set(c.txs.map((t) => t.id)).size, c.txs.length, 'tx ids are unique')
  const seed = c.wallets.find((w) => w.address === SEED)
  assert.equal(seed.balanceEth, 1.5); assert.equal(seed.firstSeen, 1700000000000)
  assert.ok(c.wallets.every((w) => w.category === 'unknown'), 'no attribution is invented')
  assert.equal(c.initialVisible[0], SEED)
  assert.match(c.summary, /not attributed/)
  analyseCase(c) // the existing analysis engine accepts the mapped case
})

test('truncated history is reported and firstSeen is not claimed', () => {
  const many = Array.from({ length: 3 }, (_, i) => ({ ...raw.normal[0], hash: h(100 + i) }))
  const c = mapToCase({ ...raw, normal: many }, { address: SEED, provider, limits: { normal: 3, token: 200, internal: 1000 } })
  assert.deepEqual(c.fetched.truncated, ['normal'])
  assert.equal(c.wallets.find((w) => w.address === SEED).firstSeen, null)
  assert.ok(c.fetched.warnings.some((w) => /most recent 3 transactions/.test(w)))
})

test('missing token transfers are reported, not hidden', () => {
  const c = mapToCase({ ...raw, token: null, unavailable: ['token'], warnings: ['ERC-20 token transfers are not included: Routescan: HTTP 503'] }, { address: SEED, provider })
  assert.equal(c.txs.filter((t) => t.kind === 'token').length, 0)
  assert.deepEqual(c.fetched.unavailable, ['token'])
  assert.match(c.summary, /ERC-20 token transfers could not be retrieved/)
  assert.equal(c.wallets.find((w) => w.address === SEED).firstSeen, null)
})

test('no price: ETH transfers carry no USD value and say so', () => {
  const c = mapToCase({ ...raw, price: null }, { address: SEED, provider })
  assert.ok(c.txs.filter((t) => t.asset === 'ETH').every((t) => t.usd === 0))
  assert.match(c.txs[0].source, /No ETH price was available/); assert.equal(c.txs[0].priceBasis, 'unpriced')
})

test('historical prices: ETH valued at the daily price of the transfer day; missing days fall back to labelled current price', () => {
  const day = Date.UTC(2023, 10, 14) // 1700000000 s falls on 2023-11-14
  const history = { source: 'test daily series', priceAt: (ms) => (Math.floor(ms / 86400000) * 86400000 === day ? 1500 : null) }
  const c = mapToCase(raw, { address: SEED, provider, history })
  const first = c.txs.find((t) => t.hash === h(1)) // 2023-11-14
  assert.equal(first.priceBasis, 'historical'); assert.equal(first.usd, 3000); assert.match(first.source, /daily ETH price on 2023-11-14 \(\$1,500, test daily series\)/)
  const later = c.txs.find((t) => t.kind === 'internal') // 1700002000 s is still 2023-11-14
  assert.equal(later.priceBasis, 'historical')
  const c2 = mapToCase(raw, { address: SEED, provider, history: { source: 'x', priceAt: () => null } })
  assert.ok(c2.txs.filter((t) => t.asset === 'ETH').every((t) => t.priceBasis === 'current'))
  assert.match(c2.summary, /valued at TODAY'S ETH price because no historical price was available/)
  assert.equal(c.fetched.pricing.basis.historical, 4)
})

test('provider order: Etherscan only with a server-side key, then Routescan, then Blockscout', () => {
  assert.deepEqual(providerChain({}).map((p) => p.id), ['routescan', 'blockscout'])
  assert.deepEqual(providerChain({ ETHERSCAN_API_KEY: 'k' }).map((p) => p.id), ['etherscan', 'routescan', 'blockscout'])
  const e = providerConfig({ ETHERSCAN_API_KEY: 'k' })
  assert.equal(e.id, 'etherscan'); assert.equal(e.params.chainid, '1')
})

// ── endpoint tests against a local mock of the explorer API ──
let upstream, upstreamUrl, api, apiUrl, keyed, keyedUrl, fb, fbUrl
const calls = []
let rateLimitOnce = true
before(async () => {
  upstream = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const p = Object.fromEntries(u.searchParams); calls.push(p)
    const json = (b) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
    if (p.address === FALLBACK && p.apikey !== 'bs') { res.writeHead(429, { 'content-type': 'application/json', 'x-ratelimit-reset': '600000' }); return res.end('{"status":"0","message":"NOTOK","result":"Too many requests"}') }
    if (p.address === QUOTA) { res.writeHead(429, { 'content-type': 'application/json', 'x-ratelimit-limit': '10', 'x-ratelimit-reset': '600000' }); return res.end(JSON.stringify({ message: 'Too many requests. Increase limits now at https://dev.blockscout.com', result: null, status: '0' })) }
    if (p.address === B) return setTimeout(() => json({ status: '1', message: 'OK', result: [] }), 2000) // slow upstream
    if (p.apikey === 'test-secret-123') return json({ status: '0', message: 'NOTOK', result: `Invalid API Key test-secret-123` })
    if (p.action === 'txlist' && rateLimitOnce) { rateLimitOnce = false; return json({ status: '0', message: 'NOTOK', result: 'Max calls per sec rate limit reached (5/sec)' }) }
    if (p.action === 'balance') return json({ status: '1', message: 'OK', result: raw.balance })
    if (p.action === 'ethprice') return json({ status: '1', message: 'OK', result: raw.price })
    if (p.action === 'txlist') return json({ status: '1', message: 'OK', result: raw.normal })
    if (p.action === 'tokentx' && p.address === TOKEN503) { res.writeHead(503); return res.end('Service Unavailable') }
    if (p.action === 'tokentx') return json({ status: '0', message: 'No token transfers found', result: [] })
    if (p.action === 'txlistinternal') return json({ status: '2', message: 'Some internal transactions within this block range have not yet been processed', result: raw.internal })
    json({ status: '0', message: 'NOTOK', result: 'unknown action' })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r)); upstreamUrl = `http://127.0.0.1:${upstream.address().port}/api`
  api = createServer({ HISTORICAL_PRICES: 'off', EXPLORER_API_BASE: upstreamUrl, UPSTREAM_TIMEOUT_MS: '500', RATE_LIMIT_PER_MIN: '6', ALLOWED_ORIGINS: 'http://localhost:5174' })
  await new Promise((r) => api.listen(0, '127.0.0.1', r)); apiUrl = `http://127.0.0.1:${api.address().port}`
  keyed = createServer({ HISTORICAL_PRICES: 'off', EXPLORER_API_BASE: upstreamUrl, ETHERSCAN_API_KEY: 'test-secret-123' })
  fb = createServer({ HISTORICAL_PRICES: 'off', EXPLORER_API_BASE: upstreamUrl, BLOCKSCOUT_API_KEY: 'bs' })
  await new Promise((r) => fb.listen(0, '127.0.0.1', r)); fbUrl = `http://127.0.0.1:${fb.address().port}`
  await new Promise((r) => keyed.listen(0, '127.0.0.1', r)); keyedUrl = `http://127.0.0.1:${keyed.address().port}`
})
after(() => { upstream.close(); api.close(); keyed.close(); fb.close() })
const get = async (base, path, headers = {}) => { const r = await fetch(base + path, { headers }); return { status: r.status, headers: r.headers, body: await r.json() } }

test('GET /api/health', async () => {
  const r = await get(apiUrl, '/api/health')
  assert.equal(r.status, 200); assert.equal(r.body.provider, 'routescan'); assert.deepEqual(r.body.fallbacks, ['blockscout']); assert.equal(r.body.apiKeyConfigured, false)
})

test('GET /api/cases/:id?seed= returns live data (retries one upstream rate limit)', async () => {
  const r = await get(apiUrl, `/api/cases/GT-2026-500?seed=${SEED}&chain=Ethereum`, { origin: 'http://localhost:5174' })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5174')
  assert.equal(r.body.live, true); assert.equal(r.body.txs.length, 4) // 3 normal + 1 internal
  assert.ok(r.body.fetched.warnings.some((w) => /internal/.test(w)))
  assert.equal(calls.filter((c) => c.action === 'txlist').length, 2, 'rate-limited call was retried')
  const again = await get(apiUrl, `/api/wallets/${SEED}`)
  assert.equal(again.body.cached, true)
})

test('validation and error responses', async () => {
  let r = await get(apiUrl, '/api/wallets/0x123')
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'invalid_address')
  r = await get(apiUrl, '/api/cases/GT-2026-014')
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'missing_seed')
  r = await get(apiUrl, `/api/cases/X?seed=${SEED}&chain=Arbitrum`)
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'unsupported_chain')
  r = await get(apiUrl, '/api/nope')
  assert.equal(r.status, 404)
  r = await get(apiUrl, '/api/health', { origin: 'https://evil.example' })
  assert.equal(r.status, 403); assert.equal(r.headers.get('access-control-allow-origin'), null)
  r = await get(apiUrl, '/api/health', { origin: 'http://127.0.0.1:4173' })
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173', 'any local dev port is allowed')
  r = await get(apiUrl, `/api/wallets/${SEED}.`)
  assert.equal(r.status, 400); assert.match(r.body.error.message, /43 characters.*nothing after it/)
})

test('upstream timeout gives a 504 with a clear message', async () => {
  const r = await get(apiUrl, `/api/wallets/${B}`)
  assert.equal(r.status, 504); assert.equal(r.body.error.code, 'upstream_timeout'); assert.match(r.body.error.message, /did not answer within 0.5s/)
})

test('exhausted provider quota fails fast with the reset time and a key hint', async () => {
  const t0 = Date.now()
  const r = await get(apiUrl, `/api/wallets/${QUOTA}`)
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'upstream_rate_limited')
  assert.match(r.body.error.message, /resets in about 10 minutes/); assert.match(r.body.error.message, /ETHERSCAN_API_KEY/)
  assert.ok(Date.now() - t0 < 3000, 'no long retry loop')
})

test('keyless Blockscout skips the balance call; with a key it requests it', () => {
  const bs = (env) => providerChain(env).find((p) => p.id === 'blockscout')
  assert.equal(bs({}).lean, true); assert.equal(bs({ BLOCKSCOUT_API_KEY: 'b' }).lean, false); assert.equal(bs({ BLOCKSCOUT_API_KEY: 'b' }).params.apikey, 'b')
  assert.equal(providerConfig({}).lean, false, 'Routescan requests the balance')
})

test('falls back to the next provider when the first is out of quota', async () => {
  const r = await get(fbUrl, `/api/wallets/${FALLBACK}`)
  assert.equal(r.status, 200); assert.equal(r.body.fetched.provider, 'blockscout')
  assert.ok(r.body.fetched.warnings.some((w) => /^Routescan unavailable .*served by Blockscout instead/.test(w)))
  assert.ok(r.body.txs.every((t) => /via Blockscout/.test(t.source)), 'records name the provider that actually served them')
})

test('a failing token query does not abort the lookup', async () => {
  const r = await get(fbUrl, `/api/wallets/${TOKEN503}`)
  assert.equal(r.status, 200); assert.equal(r.body.fetched.provider, 'routescan')
  assert.deepEqual(r.body.fetched.unavailable, ['token'])
  assert.ok(r.body.txs.length > 0)
})

test('provider outage after a successful lookup serves the cached result, marked stale', async () => {
  const srv = createServer({ HISTORICAL_PRICES: 'off', EXPLORER_API_BASE: upstreamUrl, CACHE_TTL_MS: '1', RATE_LIMIT_PER_MIN: '100' })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const u = `http://127.0.0.1:${srv.address().port}`
  try {
    const first = await get(u, `/api/wallets/${SEED}`); assert.equal(first.status, 200); assert.ok(!first.body.stale)
    const real = upstream.listeners('request')[0]
    upstream.removeAllListeners('request'); upstream.on('request', (req, res) => { res.writeHead(429, { 'content-type': 'application/json', 'x-ratelimit-reset': '600000' }); res.end('{"status":"0","message":"NOTOK","result":"Too many requests"}') })
    try {
      const second = await get(u, `/api/wallets/${SEED}`)
      assert.equal(second.status, 200); assert.equal(second.body.stale, true); assert.match(second.body.fetched.warnings[0], /Live provider unavailable .* Showing data fetched/)
      assert.equal((await get(u, `/api/wallets/${A}`)).status, 429, 'no cached copy: the rate limit is reported')
    } finally { upstream.removeAllListeners('request'); upstream.on('request', real) }
  } finally { srv.close() }
})

test('rate limit per client', async () => {
  let last
  for (let i = 0; i < 8; i++) last = await get(apiUrl, `/api/wallets/${SEED}`)
  assert.equal(last.status, 429); assert.equal(last.body.error.code, 'rate_limited')
})

test('the API key never appears in responses', async () => {
  const r = await get(keyedUrl, `/api/wallets/${A}`)
  assert.equal(r.status, 502); assert.equal(r.body.error.code, 'upstream_auth')
  assert.ok(!JSON.stringify(r.body).includes('test-secret-123'))
  const hlt = await get(keyedUrl, '/api/health')
  assert.equal(hlt.body.apiKeyConfigured, true); assert.ok(!JSON.stringify(hlt.body).includes('test-secret-123'))
})
