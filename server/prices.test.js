// Historical price service against a local mock of the DefiLlama chart API (no network).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createPriceService } from './prices.js'

const DAY = 86400000
let mock, base, calls = 0, down = false
before(async () => {
  mock = http.createServer((req, res) => {
    calls++
    if (down) { res.writeHead(502); return res.end('bad gateway') }
    const start = Number(new URL(req.url, 'http://x').searchParams.get('start'))
    // like DefiLlama: closes stamped ~23:59 UTC, with one rolled over to 00:00 of the next day
    const prices = Array.from({ length: 365 }, (_, i) => ({ timestamp: start + i * 86400 + (i === 3 ? 86400 : 86340), price: 1000 + i }))
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ coins: { 'coingecko:ethereum': { prices } } }))
  })
  await new Promise((r) => mock.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${mock.address().port}`
})
after(() => mock.close())

test('daily prices are fetched per 365-day window and cached', async () => {
  calls = 0
  const svc = createPriceService({ PRICE_API_BASE: base })
  const d0 = Date.UTC(2024, 0, 1)
  const r = await svc.forTimestamps([d0 + 5000, d0 + DAY + 10, d0 + 400 * DAY])
  assert.equal(calls, 2, 'two windows for days ~400 apart')
  assert.equal(r.priceAt(d0 + 123), 1000); assert.equal(r.priceAt(d0 + DAY + 99), 1001)
  assert.equal(r.coverage, 1); assert.equal(r.error, null)
  assert.equal(r.priceAt(d0 + 3 * DAY + 5), 1003, 'a close stamped 00:00 next day belongs to the earlier day')
  await svc.forTimestamps([d0 + 7])
  assert.equal(calls, 2, 'cached days are not fetched again')
})

test('unavailable source: no prices, an error, and no invented values', async () => {
  down = true
  const r = await createPriceService({ PRICE_API_BASE: base, PRICE_TIMEOUT_MS: '2000' }).forTimestamps([Date.UTC(2020, 0, 1)])
  assert.equal(r.priceAt(Date.UTC(2020, 0, 1)), null); assert.equal(r.coverage, 0); assert.match(r.error, /no price series/)
  down = false
})
