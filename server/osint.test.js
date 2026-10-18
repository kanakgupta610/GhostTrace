// OSINT ingestion tests against local mock sources (no network). Run with: npm test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOsintService } from './osint.js'
import { createServer } from './index.js'
import { candidateMatches } from '../src/lib/identity.js'

const SANCTIONED = '0x098b716b8aaf21512996dc57eb0615e2383e2f96'
const SCAM = '0x43412801d29861ecc4c4d86e5becfd16af86a67b'
const MENTIONED = '0x1111111111111111111111111111111111111111'
const CLEAN = '0x2222222222222222222222222222222222222222'
let mock, base, mode = 'ok'
before(async () => {
  mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/ofac.csv') {
      if (mode === 'ofac-down') { res.writeHead(500); return res.end('down') }
      res.writeHead(200); return res.end(`address,name\n${SANCTIONED.toUpperCase().replace('0X', '0x')},"LAZARUS GROUP"\n0x3333333333333333333333333333333333333333,"SOMEONE, Else"\n`)
    }
    if (u.pathname === '/scam.json') { res.writeHead(200); return res.end(JSON.stringify([SCAM])) }
    if (u.pathname === '/search/issues') {
      if (mode === 'gh-limit') { res.writeHead(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }); return res.end('{}') }
      const q = u.searchParams.get('q')
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ items: q === MENTIONED ? [
        { html_url: 'https://github.com/o/r/issues/1', title: 'Phishing report', body: `Drainer sent funds to ${MENTIONED} yesterday`, created_at: '2026-09-01T10:00:00Z' },
        { html_url: 'https://github.com/o/r/issues/2', title: 'Unrelated', body: `prefix match only ${MENTIONED.slice(0, 30)}`, created_at: '2026-09-02T10:00:00Z' },
      ] : [] }))
    }
    res.writeHead(404); res.end()
  })
  await new Promise((r) => mock.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${mock.address().port}`
})
after(() => mock.close())
const svc = async (extra = {}) => createOsintService({ OSINT_OFAC_URL: `${base}/ofac.csv`, OSINT_SCAMSNIFFER_URL: `${base}/scam.json`, OSINT_GITHUB_API: base, OSINT_TIMEOUT_MS: '2000', OSINT_STORE_PATH: join(await mkdtemp(join(tmpdir(), 'gt-osint-')), 'store.json'), ...extra })

test('exact matches only, with source, times, excerpt and verification status', async () => {
  mode = 'ok'
  const s = await svc()
  const r = await s.lookup([SANCTIONED, SCAM, MENTIONED, CLEAN], { deep: [MENTIONED] })
  assert.deepEqual(r.sources.map((x) => [x.id, x.status, x.found]), [['ofac', 'ok', 1], ['scamsniffer', 'ok', 1], ['github', 'ok', 1]])
  const ofac = r.records.find((x) => x.source === 'ofac')
  assert.equal(ofac.address, SANCTIONED); assert.equal(ofac.identifies, 'LAZARUS GROUP'); assert.match(ofac.verification, /confirm on the official OFAC/)
  assert.ok(ofac.retrievedAt > 0 && ofac.url && ofac.excerpt.includes('LAZARUS GROUP'))
  const gh = r.records.find((x) => x.source === 'github')
  assert.equal(gh.url, 'https://github.com/o/r/issues/1', 'the prefix-only mention is discarded')
  assert.equal(gh.published, Date.parse('2026-09-01T10:00:00Z')); assert.match(gh.excerpt, new RegExp(MENTIONED))
  assert.ok(!r.records.some((x) => x.address === CLEAN), 'no result means no record')
  assert.ok(r.findings.every((f) => f.origin === 'external' && f.matches[0].reason.startsWith('Exact')))
})

test('no matches anywhere: empty result, nothing fabricated', async () => {
  mode = 'ok'
  const r = await (await svc()).lookup([CLEAN], { deep: [CLEAN] })
  assert.equal(r.records.length, 0); assert.equal(r.findings.length, 0)
  assert.ok(r.sources.every((x) => x.status === 'ok' && x.found === 0))
})

test('deduplicates and persists records; keeps the first retrieval time', async () => {
  mode = 'ok'
  let t = 1000
  const path = join(await mkdtemp(join(tmpdir(), 'gt-osint-')), 'store.json')
  const s = createOsintService({ OSINT_OFAC_URL: `${base}/ofac.csv`, OSINT_SCAMSNIFFER_URL: `${base}/scam.json`, OSINT_GITHUB_API: base, OSINT_STORE_PATH: path }, { now: () => t })
  await s.lookup([SANCTIONED, SANCTIONED.toUpperCase().replace('0X', '0x')])
  t = 5000
  const r2 = await s.lookup([SANCTIONED])
  assert.equal(r2.records.length, 1); assert.equal(r2.records[0].firstRetrievedAt, 1000); assert.equal(r2.records[0].retrievedAt, 5000)
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(saved.length, 1); assert.equal(saved[0].address, SANCTIONED)
})

test('one unavailable or rate-limited source does not hide the others', async () => {
  mode = 'ofac-down'
  let r = await (await svc()).lookup([SANCTIONED, SCAM])
  assert.equal(r.sources.find((x) => x.id === 'ofac').status, 'unavailable')
  assert.equal(r.sources.find((x) => x.id === 'scamsniffer').found, 1)
  mode = 'gh-limit'
  r = await (await svc()).lookup([MENTIONED], { deep: [MENTIONED] })
  const gh = r.sources.find((x) => x.id === 'github')
  assert.equal(gh.status, 'rate_limited'); assert.match(gh.message, /rate limit/)
})

test('sanctions-list name becomes a Medium identity candidate; a GitHub mention does not', async () => {
  mode = 'ok'
  const r = await (await svc()).lookup([SANCTIONED, MENTIONED], { deep: [MENTIONED] })
  const c = { osint: r.findings }
  const m = candidateMatches(c, SANCTIONED)
  assert.equal(m.candidates[0].identifier, 'LAZARUS GROUP'); assert.equal(m.candidates[0].score, 45); assert.equal(m.candidates[0].band, 'Medium')
  assert.equal(m.candidates[0].supporting[0].origin, 'external')
  assert.equal(candidateMatches(c, MENTIONED).verdict, 'No reliable identity match found.')
})

test('GET /api/osint validates input and returns findings', async () => {
  mode = 'ok'
  const dir = await mkdtemp(join(tmpdir(), 'gt-osint-'))
  const api = createServer({ HISTORICAL_PRICES: 'off', OSINT_OFAC_URL: `${base}/ofac.csv`, OSINT_SCAMSNIFFER_URL: `${base}/scam.json`, OSINT_GITHUB_API: base, OSINT_STORE_PATH: join(dir, 's.json') })
  await new Promise((r) => api.listen(0, '127.0.0.1', r))
  const u = `http://127.0.0.1:${api.address().port}`
  try {
    let r = await fetch(`${u}/api/osint`); assert.equal(r.status, 400)
    r = await fetch(`${u}/api/osint?addresses=0x123`); assert.equal(r.status, 400)
    r = await fetch(`${u}/api/osint?addresses=${SANCTIONED},${CLEAN}`)
    const b = await r.json()
    assert.equal(r.status, 200); assert.equal(b.findings.length, 1); assert.equal(b.findings[0].sourceKind, 'sanctions')
    assert.equal(b.sources.find((x) => x.id === 'github').status, 'skipped')
  } finally { api.close() }
})
