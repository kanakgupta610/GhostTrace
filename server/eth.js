// Live Ethereum mainnet data for GhostTrace (server side only).
//
// Providers (all Etherscan-compatible, tried in order; the next one is used when one is rate-limited,
// slow or unreachable):
//   1. Etherscan API V2, only when ETHERSCAN_API_KEY is set (free key)
//   2. Routescan, free without a key (documented keyless tier: about 2 requests/s, 10,000 calls/day)
//   3. Blockscout, free; its keyless quota is tiny (about 10 requests per ~15 min), BLOCKSCOUT_API_KEY raises it
// Keys never leave this process: they are added to upstream URLs here and stripped from errors.

import { knownService } from '../src/lib/services.js'

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
export const isEthAddress = (s) => typeof s === 'string' && ADDRESS_RE.test(s.trim())

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

// Tokens priced without a market feed: matched by contract address, never by symbol (spam tokens copy symbols).
const KNOWN_TOKENS = {
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', usd: 'stable' },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', usd: 'stable' },
  '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', usd: 'stable' },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', usd: 'eth' },
}
const RESERVED_SYMBOLS = new Set(['ETH', ...Object.values(KNOWN_TOKENS).map((t) => t.symbol)])

export function providerChain(env = process.env) {
  const base = (env.EXPLORER_API_BASE || '').trim() // test/override: same base for every provider
  const key = (env.ETHERSCAN_API_KEY || '').trim(), bsKey = (env.BLOCKSCOUT_API_KEY || '').trim()
  const chain = []
  if (key) chain.push({ id: 'etherscan', name: 'Etherscan', base: base || 'https://api.etherscan.io/v2/api', params: { chainid: '1', apikey: key }, gapMs: 250, secret: key, lean: false })
  chain.push({ id: 'routescan', name: 'Routescan', base: base || 'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api', params: {}, gapMs: 600, secret: null, lean: false })
  // keyless Blockscout: skip the optional balance call to save its small quota
  chain.push({ id: 'blockscout', name: 'Blockscout', base: base || 'https://eth.blockscout.com/api', params: bsKey ? { apikey: bsKey } : {}, gapMs: bsKey ? 250 : 400, secret: bsKey || null, lean: !bsKey })
  return chain
}
export const providerConfig = (env = process.env) => providerChain(env)[0]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const scrub = (text, secret) => (secret ? String(text).split(secret).join('***') : String(text))
const RATE_LIMITED = /rate limit|too many requests|max calls per sec/i
const EMPTY = /no (transactions|records|token transfers|internal transactions)? ?found/i

// One Etherscan-style call with timeout and retry on rate limits / 5xx.
export async function explorerCall(cfg, params, { timeoutMs = 10000, retries = 3 } = {}) {
  const url = new URL(cfg.base)
  for (const [k, v] of Object.entries({ ...cfg.params, ...params })) url.searchParams.set(k, v)
  let lastErr
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1))
    let res, body
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
      body = await res.json().catch(() => null)
    } catch (e) {
      // a timeout is not retried, so one lookup can never take much longer than timeoutMs per call
      if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new HttpError(504, 'upstream_timeout', `${cfg.name} did not answer within ${timeoutMs / 1000}s`)
      lastErr = new HttpError(502, 'upstream_unreachable', `Could not reach ${cfg.name}: ${scrub(e.message, cfg.secret)}`)
      continue
    }
    const msg = scrub(body?.result && typeof body.result === 'string' ? body.result : body?.message || `HTTP ${res.status}`, cfg.secret)
    const resetMs = Number(res.headers.get('x-ratelimit-reset')) || Number(res.headers.get('retry-after')) * 1000 || 0
    if ((res.status === 429 || RATE_LIMITED.test(msg)) && resetMs > 5000) {
      const mins = Math.ceil(resetMs / 60000)
      throw new HttpError(429, 'upstream_rate_limited', `${cfg.name} rate limit reached; it resets in about ${mins} minute${mins > 1 ? 's' : ''}.${cfg.secret ? '' : cfg.keyHint ?? ' The keyless quota is very small: set a free ETHERSCAN_API_KEY (or BLOCKSCOUT_API_KEY) on the server for regular use.'}`)
    }
    if (res.status === 429 || res.status >= 500 || RATE_LIMITED.test(msg)) {
      if (resetMs) await sleep(resetMs)
      lastErr = new HttpError(res.status === 429 || RATE_LIMITED.test(msg) ? 429 : 502, res.status >= 500 ? 'upstream_error' : 'upstream_rate_limited', `${cfg.name}: ${msg}`)
      continue
    }
    if (!body) throw new HttpError(502, 'upstream_bad_response', `${cfg.name} returned a non-JSON response (HTTP ${res.status})`)
    if (body.jsonrpc) { // module=proxy calls answer in JSON-RPC form
      if (body.error) throw new HttpError(502, 'upstream_error', `${cfg.name}: ${scrub(body.error.message || 'JSON-RPC error', cfg.secret)}`)
      return { result: body.result, warning: null }
    }
    if (body.status === '1' || body.status === '2') return { result: body.result, warning: body.status === '2' ? scrub(body.message, cfg.secret) : null }
    if (body.status === '0' && (EMPTY.test(body.message || '') || (Array.isArray(body.result) && !body.result.length))) return { result: [], warning: null }
    if (/invalid api key|missing\/invalid api key/i.test(msg)) throw new HttpError(502, 'upstream_auth', `${cfg.name} rejected the server's API key. Check ETHERSCAN_API_KEY.`)
    throw new HttpError(502, 'upstream_error', `${cfg.name}: ${msg}`)
  }
  throw lastErr
}

const PRICE_TTL_MS = 10 * 60000
let priceCache = null // { at, price }: the current ETH price, shared across lookups

// Fetch the raw records for one address (sequential calls stay inside free-tier rate limits).
// Default record limits per type. Token-transfer queries get slow for addresses with large (often spam)
// token histories, so they use a smaller page than normal and internal transactions.
export const DEFAULT_LIMITS = { normal: 1000, token: 200, internal: 1000 }

export async function fetchWalletRaw(cfg, address, { limits = DEFAULT_LIMITS, timeoutMs = 10000 } = {}) {
  const list = (action, n) => ({ module: 'account', action, address, page: '1', offset: String(n), sort: 'desc' })
  const steps = [
    ...(cfg.lean ? [] : [['balance', { module: 'account', action: 'balance', address, tag: 'latest' }]]),
    ['normal', list('txlist', limits.normal)],
    ['token', list('tokentx', limits.token)],
    ['internal', list('txlistinternal', limits.internal)],
    ...(priceCache && Date.now() - priceCache.at < PRICE_TTL_MS ? [] : [['price', { module: 'stats', action: 'ethprice' }]]),
  ]
  const out = { warnings: [], balance: null, price: priceCache?.price ?? null, unavailable: [] }
  if (cfg.lean) out.warnings.push('Wallet balance not requested (keyless mode saves the provider quota).')
  for (const [i, [name, params]] of steps.entries()) {
    if (i) await sleep(cfg.gapMs)
    try {
      const r = await explorerCall(cfg, params, { timeoutMs })
      out[name] = r.result
      if (name === 'price' && r.result?.ethusd) priceCache = { at: Date.now(), price: r.result }
      if (r.warning) out.warnings.push(`${name}: ${r.warning}`)
    } catch (e) {
      // balance and price are optional; token transfers are skipped (and reported) when only that query
      // times out or errors. Rate limits and anything else abort so the next provider can be tried.
      const optional = name === 'price' || name === 'balance' || (name === 'token' && ['upstream_timeout', 'upstream_error', 'upstream_bad_response'].includes(e.code))
      if (!optional) throw e
      out[name] = null
      if (name === 'token') { out.unavailable.push('token'); out.warnings.push(`ERC-20 token transfers are not included: ${e.message}`) } else out.warnings.push(`${name} unavailable: ${e.message}`)
    }
  }
  return out
}

// Try each provider in order. Fall through on rate limits, timeouts and outages; stop on anything
// else (for example a rejected API key, which is a configuration problem to report, not to hide).
const FALL_THROUGH = new Set(['upstream_rate_limited', 'upstream_timeout', 'upstream_unreachable', 'upstream_error', 'upstream_bad_response'])
export async function fetchWithFallback(chain, address, opts) {
  const skipped = []
  for (const provider of chain) {
    try {
      const raw = await fetchWalletRaw(provider, address, opts)
      if (skipped.length) raw.warnings.unshift(...skipped.map((e) => `${e.provider} unavailable (${e.message}); served by ${provider.name} instead.`))
      return { raw, provider }
    } catch (e) {
      if (!FALL_THROUGH.has(e.code)) throw e
      skipped.push({ provider: provider.name, message: e.message, error: e })
    }
  }
  const last = skipped[skipped.length - 1].error
  throw new HttpError(last.status, last.code, skipped.map((e) => e.message).join(' | '))
}

// Exact token amount from an integer string and decimals, as a JS number.
export function units(value, decimals) {
  const d = Number(decimals)
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(d) || d < 0 || d > 36) return null
  const b = BigInt(value), base = 10n ** BigInt(d)
  return Number(b / base) + Number(b % base) / Number(base)
}

const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
const cleanSymbol = (s) => (String(s || '').replace(/[^A-Za-z0-9.$_-]/g, '').slice(0, 12) || 'TOKEN')
const fmtUtc = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

// Map raw explorer records to the GhostTrace case shape used by the graph, ledger and analysis.
// Nothing here is attributed: wallets get no labels, categories or tags beyond what the chain shows.
export function mapToCase(raw, { address, provider, fetchedAt = Date.now(), limits = DEFAULT_LIMITS, history = null }) {
  const seed = address.toLowerCase()
  const ethUsd = Number(raw.price?.ethusd) > 0 ? Number(raw.price.ethusd) : null
  const sourceBase = `Live Ethereum mainnet record via ${provider.name}, fetched ${fmtUtc(fetchedAt)}.`
  // USD valuation per transfer. `basis` says which price was used so the UI never shows today's price as historical.
  const day = (ms) => new Date(ms).toISOString().slice(0, 10)
  const ethValue = (amount, ts) => {
    const hp = history?.priceAt?.(ts)
    if (hp) return { usd: amount * hp, priceBasis: 'historical', priceNote: `USD at the daily ETH price on ${day(ts)} ($${hp.toLocaleString('en-US', { maximumFractionDigits: 2 })}, ${history.source}).` }
    if (ethUsd) return { usd: amount * ethUsd, priceBasis: 'current', priceNote: `USD estimated at TODAY'S ETH price ($${ethUsd.toLocaleString('en-US')}), not the price on ${day(ts)}.` }
    return { usd: 0, priceBasis: 'unpriced', priceNote: 'No ETH price was available, so this transfer has no USD value.' }
  }
  const stableValue = (amount) => ({ usd: amount, priceBasis: 'stablecoin', priceNote: 'USD assumes the stablecoin traded at $1.' })
  const unpriced = { usd: 0, priceBasis: 'unpriced', priceNote: 'This token has no USD price here.' }
  const lc = (a) => (a || '').toLowerCase()
  const txs = []
  const skipped = { failed: 0, zeroInternal: 0, unparseable: 0 }

  for (const t of raw.normal || []) {
    if (t.isError === '1' || t.txreceipt_status === '0') { skipped.failed++; continue }
    const to = lc(t.to) || lc(t.contractAddress)
    const amount = units(t.value, 18)
    if (!to || amount == null) { skipped.unparseable++; continue }
    const method = !t.to && t.contractAddress ? 'contract creation'
      : t.functionName ? t.functionName.split('(')[0] : t.input && t.input !== '0x' ? (t.methodId || 'contract call') : 'transfer'
    const ts = Number(t.timeStamp) * 1000, v = ethValue(amount, ts)
    txs.push({ id: `${t.hash}:n`, hash: t.hash, from: lc(t.from), to, asset: 'ETH', amount, usd: v.usd, priceBasis: v.priceBasis, ts, block: Number(t.blockNumber), method, note: '', status: 'success', source: `${sourceBase} ${v.priceNote}`, kind: 'normal' })
  }
  const perHash = new Map()
  const nth = (h) => { const n = (perHash.get(h) || 0) + 1; perHash.set(h, n); return n }
  for (const t of raw.token || []) {
    const known = KNOWN_TOKENS[lc(t.contractAddress)]
    const amount = units(t.value, t.tokenDecimal)
    if (amount == null || !t.from || !t.to) { skipped.unparseable++; continue }
    let asset = known ? known.symbol : cleanSymbol(t.tokenSymbol)
    if (!known && RESERVED_SYMBOLS.has(asset.toUpperCase())) asset += '?' // look-alike of a priced token
    const ts = Number(t.timeStamp) * 1000
    const v = known?.usd === 'stable' ? stableValue(amount) : known?.usd === 'eth' ? ethValue(amount, ts) : unpriced
    txs.push({ id: `${t.hash}:t${nth(t.hash)}`, hash: t.hash, from: lc(t.from), to: lc(t.to), asset, amount, usd: v.usd, priceBasis: v.priceBasis, ts, block: Number(t.blockNumber), method: 'token transfer',
      note: known ? '' : `Token contract ${t.contractAddress} (${cleanSymbol(t.tokenName)}) has no USD price here`, status: 'success', source: `${sourceBase} ${v.priceNote}`, kind: 'token', token: lc(t.contractAddress) })
  }
  for (const t of raw.internal || []) {
    const hash = t.transactionHash || t.hash
    if (t.isError === '1') { skipped.failed++; continue }
    const amount = units(t.value, 18)
    if (amount == null || !t.from || !(t.to || t.contractAddress)) { skipped.unparseable++; continue }
    if (amount === 0) { skipped.zeroInternal++; continue }
    const ts = Number(t.timeStamp) * 1000, v = ethValue(amount, ts)
    txs.push({ id: `${hash}:i${t.index || t.traceId || nth(hash)}`, hash, from: lc(t.from), to: lc(t.to) || lc(t.contractAddress), asset: 'ETH', amount, usd: v.usd, priceBasis: v.priceBasis, ts, block: Number(t.blockNumber), method: 'internal transfer', note: '', status: 'success', source: `${sourceBase} ${v.priceNote}`, kind: 'internal' })
  }
  txs.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))

  const truncated = ['normal', 'token', 'internal'].filter((k) => (raw[k] || []).length >= limits[k])
  const partial = truncated.length || (raw.unavailable || []).length // history incomplete: do not claim a first-seen time
  const volume = new Map([[seed, Infinity]])
  for (const t of txs) for (const a of [t.from, t.to]) volume.set(a, (volume.get(a) || 0) + t.usd + 1e-9)
  const addresses = [...volume.keys()]
  const balance = raw.balance != null ? units(raw.balance, 18) : null
  const wallets = addresses.map((a) => knownService(a) && a !== seed
    ? { address: a, chain: 'Ethereum', label: knownService(a).name, category: knownService(a).category, tags: ['Known service (registry)'], externalInflowUsd: 0, balanceEth: null, firstSeen: null, registry: knownService(a) }
    : a === seed
    ? { address: a, chain: 'Ethereum', label: 'Seed wallet', category: 'unknown', tags: ['Live data'], externalInflowUsd: 0, balanceEth: balance,
        firstSeen: partial || !txs.length ? null : txs[0].ts } // only the true first activity when nothing was cut off
    : { address: a, chain: 'Ethereum', label: shortAddr(a), category: 'unknown', tags: [], externalInflowUsd: 0, balanceEth: null, firstSeen: null })
  const initialVisible = [seed, ...addresses.filter((a) => a !== seed).sort((a, b) => volume.get(b) - volume.get(a)).slice(0, 24)]

  const basisCount = txs.reduce((m, t) => ((m[t.priceBasis] = (m[t.priceBasis] || 0) + 1), m), {})
  const ethTxs = (basisCount.historical || 0) + (basisCount.current || 0)
  const priced = !ethTxs ? 'No ETH or WETH transfers needed pricing' : basisCount.current
    ? `${basisCount.current} of ${ethTxs} ETH/WETH transfers are valued at TODAY'S ETH price because no historical price was available${basisCount.historical ? `; ${basisCount.historical} use the daily price on the day of transfer` : ''}`
    : `ETH and WETH transfers are valued at the daily ETH price on the day of each transfer (${history?.source || 'historical source'})`
  const counts = { normal: (raw.normal || []).length, token: (raw.token || []).length, internal: (raw.internal || []).length }
  const warnings = [...(raw.warnings || [])]
  const limitText = truncated.map((k) => `${limits[k]} ${k === 'normal' ? 'transactions' : k === 'token' ? 'token transfers' : 'internal transfers'}`).join(', ')
  if (truncated.length) warnings.push(`Only the most recent ${limitText} were retrieved; older activity is not included.`)
  return {
    live: true, sample: false, chain: 'Ethereum', source: provider.id, dataVersion: `live:${fetchedAt}`,
    summary: `Live Ethereum mainnet data for ${seed}, retrieved via ${provider.name} on ${fmtUtc(fetchedAt)}: ${txs.length} transfers with ${wallets.length - 1} counterparties. ${priced}; USDC, USDT and DAI at $1; other tokens unpriced. Wallet labels and categories are not attributed, except contracts in GhostTrace's verified service registry; risk scores are heuristics, not verified findings.${truncated.length ? ` Only the most recent ${limitText} are included.` : ''}${(raw.unavailable || []).includes('token') ? ' ERC-20 token transfers could not be retrieved and are not included.' : ''}`,
    seed, primarySuspect: seed, taintSources: [], attackStart: txs.length ? txs[0].ts : fetchedAt, initialVisible,
    wallets, txs, osint: [], clusters: [],
    fetched: { provider: provider.id, network: 'ethereum-mainnet', address: seed, at: fetchedAt, ethUsd, pricing: { basis: basisCount, historicalSource: history?.source || null, historicalError: history?.error || null }, counts, skipped, truncated, unavailable: raw.unavailable || [], warnings },
  }
}
