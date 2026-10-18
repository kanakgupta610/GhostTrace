// Historical ETH/USD prices (server side) from DefiLlama's free coins API (no key), daily closes.
// Used to value ETH and WETH transfers at the price of the day they happened. If the source is
// unavailable, callers fall back to the current price and must label those values as such.

import { HttpError } from './eth.js'

const DAY = 86400000
const dayOf = (ms) => Math.floor(ms / DAY) * DAY

export function createPriceService(env = process.env) {
  const base = env.PRICE_API_BASE || 'https://coins.llama.fi'
  const timeoutMs = Number(env.PRICE_TIMEOUT_MS) > 0 ? Number(env.PRICE_TIMEOUT_MS) : 10000
  const days = new Map() // UTC day start (ms) -> USD price

  async function fetchWindow(startDay) {
    const url = `${base}/chart/coingecko:ethereum?start=${Math.floor(startDay / 1000)}&span=365&period=1d`
    let res
    try { res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } }) } catch (e) {
      throw new HttpError(504, 'price_unavailable', e.name === 'TimeoutError' ? `DefiLlama did not answer within ${timeoutMs / 1000}s` : 'Could not reach DefiLlama')
    }
    const body = await res.json().catch(() => null)
    const pts = body?.coins?.['coingecko:ethereum']?.prices
    if (!res.ok || !Array.isArray(pts)) throw new HttpError(502, 'price_unavailable', `DefiLlama returned no price series (HTTP ${res.status})`)
    // Daily closes are stamped around 23:59 UTC, sometimes 00:00 of the next day; both belong to the earlier day.
    for (const p of pts) if (p.price > 0) days.set(dayOf(p.timestamp * 1000 - 6 * 3600000), p.price)
  }

  // Ensure prices for every UTC day touched by `timestamps` (ms). Returns { priceAt, coverage, error }.
  async function forTimestamps(timestamps) {
    const need = [...new Set(timestamps.filter(Number.isFinite).map(dayOf))].sort((a, b) => a - b)
    let error = null
    const missing = need.filter((d) => !days.has(d))
    for (let i = 0; i < missing.length;) {
      const start = missing[i]
      try { await fetchWindow(start) } catch (e) { error = e.message; break }
      while (i < missing.length && missing[i] < start + 365 * DAY) i++
    }
    const priceAt = (ms) => days.get(dayOf(ms)) ?? null
    const covered = need.filter((d) => days.has(d)).length
    return { priceAt, coverage: need.length ? covered / need.length : 1, error, source: 'DefiLlama daily ETH/USD (coingecko:ethereum)' }
  }
  return { forTimestamps }
}
