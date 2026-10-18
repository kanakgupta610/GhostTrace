// Manual evidence, evidence persistence (file + Supabase via a mock PostgREST) and bridge matching.
// No network access. Run with: npm test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateManual } from './evidence.js'
import { createEvidenceStore } from './evidenceStore.js'
import { createServer } from './index.js'
import { opStackRecipient, traceBridge } from './chains.js'
import { migrate } from './migrate-evidence.js'
import { writeFile } from 'node:fs/promises'

const W = '0xd1be299975d66a0b8650976d0d77f2dc7b1b17a8'
const good = { title: 'Exchange froze deposit', description: 'Support confirmed by email that the deposit was frozen pending review.', url: 'https://support.northgate.example/ticket/1', caseRef: 'GT-2026-014', wallet: W.toUpperCase().replace('0X', '0x'), evidenceType: 'Exchange notice', verification: 'Verified by the investigator' }
const tmp = async () => join(await mkdtemp(join(tmpdir(), 'gt-ev-')), 'store.json')

test('manual evidence validation', () => {
  const r = validateManual(good)
  assert.equal(r.origin, 'manual'); assert.equal(r.address, W, 'wallet is normalised to lower case'); assert.equal(r.confidence, 'Strong')
  assert.equal(validateManual({ ...good, verification: 'Unverified' }).confidence, 'Weak')
  assert.equal(validateManual({ ...good, url: '', wallet: '' }).address, null, 'url and wallet are optional')
  try { validateManual({ title: 'x', description: 'short', url: 'javascript:alert(1)', caseRef: '', wallet: '0x12', evidenceType: 'Rumour', verification: 'Sure' }); assert.fail('should throw') } catch (e) {
    assert.equal(e.status, 400); assert.deepEqual(Object.keys(e.fields).sort(), ['caseRef', 'description', 'evidenceType', 'title', 'url', 'verification', 'wallet'])
  }
  assert.equal(validateManual(good).key, validateManual({ ...good }).key, 'same content, same dedupe key')
})

const call = async (u, path, opts = {}) => { const r = await fetch(u + path, opts); return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) } }
const TOKEN = 'test-write-token-0123456789abcdef'
const AUTH = { authorization: `Bearer ${TOKEN}` }
const post = (u, body, origin, auth = AUTH) => call(u, '/api/evidence', { method: 'POST', headers: { 'content-type': 'application/json', ...auth, ...(origin ? { origin } : {}) }, body: JSON.stringify(body) })
const del = (u, key, auth = AUTH) => call(u, `/api/evidence?key=${encodeURIComponent(key)}`, { method: 'DELETE', headers: auth })
const start = async (env) => { const s = createServer({ HISTORICAL_PRICES: 'off', EVIDENCE_WRITE_TOKEN: TOKEN, ...env }); await new Promise((r) => s.listen(0, '127.0.0.1', r)); return { s, u: `http://127.0.0.1:${s.address().port}` } }

test('POST /api/evidence saves, rejects duplicates and invalid input, and persists across restarts', async () => {
  const path = await tmp()
  let { s, u } = await start({ EVIDENCE_STORE_PATH: path })
  try {
    const pre = await call(u, '/api/evidence', { method: 'OPTIONS', headers: { origin: 'http://localhost:5174', 'access-control-request-method': 'POST' } })
    assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-methods'), /POST/)
    const r1 = await post(u, good, 'http://localhost:5174')
    assert.equal(r1.status, 201); assert.equal(r1.body.finding.origin, 'manual'); assert.match(r1.body.finding.publisher, /Entered manually/)
    assert.equal(r1.body.storage.backend, 'file'); assert.match(r1.body.storage.detail, /SUPABASE_SECRET_KEY is not set/)
    const dup = await post(u, good); assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'duplicate_evidence')
    const bad = await post(u, { ...good, title: '' }); assert.equal(bad.status, 400); assert.ok(bad.body.error.fields.title)
    const notJson = await call(u, '/api/evidence', { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: '{oops' }); assert.equal(notJson.status, 400)
    const big = await post(u, { ...good, description: 'x'.repeat(20000) }); assert.equal(big.status, 413)
  } finally { s.close() }
  ;({ s, u } = await start({ EVIDENCE_STORE_PATH: path })) // restart: the entry is still there
  try {
    const g = await call(u, '/api/evidence?case=GT-2026-014')
    assert.equal(g.status, 200); assert.equal(g.body.findings.length, 1); assert.equal(g.body.findings[0].title, good.title)
    assert.equal((await call(u, '/api/evidence?case=GT-2026-017')).body.findings.length, 0, 'other cases see nothing')
    assert.equal((await call(u, '/api/evidence')).status, 400)
  } finally { s.close() }
})

// Minimal PostgREST mock for public.evidence_records (insert, upsert, select with eq / in filters).
let pg, pgUrl, rows = [], tableMissing = false, seenAuth = []
before(async () => {
  pg = http.createServer(async (req, res) => {
    seenAuth.push(req.headers.apikey)
    const u = new URL(req.url, 'http://x')
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (!u.pathname.endsWith('/evidence_records')) return json(404, {})
    if (tableMissing) return json(404, { code: 'PGRST205', message: "Could not find the table 'public.evidence_records' in the schema cache" })
    const single = /vnd\.pgrst\.object/.test(req.headers.accept || '')
    if (req.method === 'DELETE') {
      let gone = rows
      for (const [k, v] of u.searchParams) if (v.startsWith('eq.')) gone = gone.filter((r) => String(r[k]) === v.slice(3))
      rows = rows.filter((r) => !gone.includes(r)); return json(200, gone)
    }
    if (req.method === 'POST') {
      let body = ''; for await (const c of req) body += c
      const list = [].concat(JSON.parse(body)); const upsert = /merge-duplicates/.test(req.headers.prefer || '')
      for (const r of list) {
        if ('created_at' in r && r.created_at == null) return json(400, { code: '23502', message: 'null value in column "created_at" of relation "evidence_records" violates not-null constraint' })
        const i = rows.findIndex((x) => x.dedupe_key === r.dedupe_key)
        if (i >= 0 && !upsert) return json(409, { code: '23505', message: 'duplicate key value violates unique constraint "evidence_records_dedupe_key_key"' })
        if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push({ created_at: new Date().toISOString(), ...r })
      }
      return json(201, single ? rows.find((x) => x.dedupe_key === list[0].dedupe_key) : [])
    }
    let out = rows
    for (const [k, v] of u.searchParams) {
      if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3))
      if (v.startsWith('in.(')) { const set = new Set(v.slice(4, -1).split(',').map((x) => x.replace(/"/g, ''))); out = out.filter((r) => set.has(r[k])) }
    }
    if (single) return out.length ? json(200, out[0]) : json(406, { code: 'PGRST116', message: 'no rows' })
    json(200, out)
  })
  await new Promise((r) => pg.listen(0, '127.0.0.1', r)); pgUrl = `http://127.0.0.1:${pg.address().port}`
})
after(() => pg.close())

test('Supabase evidence store: insert, duplicate, query; the secret key is sent only to Supabase', async () => {
  rows = []; tableMissing = false; seenAuth = []
  const { s, u } = await start({ SUPABASE_URL: pgUrl, SUPABASE_SECRET_KEY: 'sb_secret_TESTKEY', EVIDENCE_STORE_PATH: await tmp() })
  try {
    const r1 = await post(u, good)
    assert.equal(r1.status, 201); assert.equal(r1.body.storage.backend, 'supabase')
    assert.equal(rows.length, 1); assert.equal(rows[0].origin, 'manual'); assert.equal(rows[0].wallet_address, W)
    assert.equal((await post(u, good)).status, 409)
    const g = await call(u, `/api/evidence?case=GT-2026-014&addresses=${W}`)
    assert.equal(g.body.findings.length, 1); assert.equal(g.body.storage.backend, 'supabase')
    const health = await call(u, '/api/health')
    for (const b of [r1.body, g.body, health.body]) assert.ok(!JSON.stringify(b).includes('sb_secret_TESTKEY'), 'key never in a response')
    assert.ok(seenAuth.includes('sb_secret_TESTKEY'), 'key used for the Supabase request')
  } finally { s.close() }
})

test('DELETE /api/evidence removes manual entries only (file and Supabase)', async () => {
  const path = await tmp()
  const { s, u } = await start({ EVIDENCE_STORE_PATH: path })
  try {
    const r = await post(u, good)
    const key = r.body.finding.key
    assert.match(key, /^manual\|[0-9a-f]{32}$/)
    assert.equal((await del(u, 'external|x')).status, 400, 'external records cannot be removed')
    assert.equal((await del(u, key, {})).status, 401, 'delete needs the token')
    assert.equal((await del(u, key)).status, 200)
    assert.equal((await del(u, key)).status, 404)
    assert.equal((await call(u, '/api/evidence?case=GT-2026-014')).body.findings.length, 0)
  } finally { s.close() }
  rows = []; tableMissing = false
  const sb = await start({ SUPABASE_URL: pgUrl, SUPABASE_SECRET_KEY: 'sb_secret_TESTKEY', EVIDENCE_STORE_PATH: await tmp() })
  try {
    const r = await post(sb.u, good); assert.equal(rows.length, 1)
    assert.equal((await del(sb.u, r.body.finding.key)).status, 200)
    assert.equal(rows.length, 0, 'row deleted in Supabase')
  } finally { sb.s.close() }
})

test('evidence writes require the server-side write token', async () => {
  const off = await start({ EVIDENCE_WRITE_TOKEN: '', EVIDENCE_STORE_PATH: await tmp() })
  try {
    const r = await post(off.u, good); assert.equal(r.status, 503); assert.equal(r.body.error.code, 'writes_disabled')
    assert.equal((await call(off.u, '/api/health')).body.evidenceWrites.enabled, false)
  } finally { off.s.close() }
  const short = await start({ EVIDENCE_WRITE_TOKEN: 'too-short', EVIDENCE_STORE_PATH: await tmp() })
  try { assert.equal((await post(short.u, good)).status, 503, 'tokens under 24 characters are not accepted as configuration') } finally { short.s.close() }
  const { s, u } = await start({ EVIDENCE_STORE_PATH: await tmp() })
  try {
    assert.equal((await post(u, good, null, {})).status, 401)
    assert.equal((await post(u, good, null, { authorization: 'Bearer wrong-token-wrong-token-wrong' })).status, 403)
    assert.equal((await post(u, good, null, { authorization: TOKEN })).status, 401, 'the Bearer scheme is required')
    const pre = await call(u, '/api/evidence', { method: 'OPTIONS', headers: { origin: 'http://localhost:5174', 'access-control-request-method': 'POST' } })
    assert.match(pre.headers.get('access-control-allow-headers'), /authorization/)
    const ok = await post(u, good); assert.equal(ok.status, 201)
    const h = await call(u, '/api/health'); assert.equal(h.body.evidenceWrites.enabled, true); assert.ok(!JSON.stringify(h.body).includes(TOKEN), 'token never in a response')
    let last
    for (let i = 0; i < 12; i++) last = await post(u, { ...good, title: `attempt ${i} title` }, null, { authorization: 'Bearer nope-nope-nope-nope-nope-nope' })
    assert.equal(last.status, 429, 'repeated failures are rate-limited'); assert.equal(last.body.error.code, 'auth_rate_limited')
  } finally { s.close() }
})

test('Supabase store: external records (no created_at) upsert without nulls, alongside manual ones', async () => {
  rows = []; tableMissing = false
  const store = createEvidenceStore({ SUPABASE_URL: pgUrl, SUPABASE_SECRET_KEY: 'sb_secret_TESTKEY', EVIDENCE_STORE_PATH: await tmp() })
  const ext = { key: 'ofac|u|' + W, origin: 'external', source: 'ofac', title: 'Sanctions list entry', address: W, firstRetrievedAt: 1000, retrievedAt: 2000 }
  await store.upsert([ext, { ...validateManual(good) }])
  assert.equal(store.status().backend, 'supabase', 'no silent fallback to the file')
  assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.created_at))
  assert.equal((await store.query({ addresses: new Set([W]) })).length, 2)
})

test('Supabase table missing: falls back to the local file and says which migration to apply', async () => {
  rows = []; tableMissing = true
  const store = createEvidenceStore({ SUPABASE_URL: pgUrl, SUPABASE_SECRET_KEY: 'sb_secret_TESTKEY', EVIDENCE_STORE_PATH: await tmp() })
  const r = await store.insert(validateManual(good))
  assert.equal(r.duplicate, false)
  const st = store.status()
  assert.equal(st.backend, 'file'); assert.match(st.detail, /apply supabase\/evidence-records\.sql/)
  assert.equal((await store.query({ caseRef: 'GT-2026-014' })).length, 1, 'still readable from the fallback')
  tableMissing = false
})

test('migration: dry run writes nothing; apply inserts only missing keys; rerun is a no-op', async () => {
  rows = []; tableMissing = false
  const ext = (k, t) => ({ key: `ofac|https://x.example/${k}|0x${k.repeat(40).slice(0, 40)}`, origin: 'external', source: 'ofac', title: `entry ${k}`, address: '0x' + k.repeat(40).slice(0, 40), firstRetrievedAt: t, retrievedAt: t + 5 })
  const f1 = await tmp(), f2 = await tmp()
  await writeFile(f1, JSON.stringify([ext('a', 1000), ext('b', 2000), { ...validateManual(good) }]))
  await writeFile(f2, JSON.stringify([{ ...ext('a', 500), origin: undefined }])) // legacy file: same record, earlier first retrieval, no origin
  rows.push({ dedupe_key: ext('b', 0).key, origin: 'external', source: 'ofac', title: 'already in Supabase (must not change)' })
  const opts = { files: [f1, f2, '/nonexistent.json'], url: pgUrl, key: 'sb_secret_TESTKEY', log: () => {} }
  const dry = await migrate(opts)
  assert.equal(dry.toInsert, 2); assert.equal(dry.inserted, 0); assert.equal(rows.length, 1, 'dry run writes nothing')
  const ext1 = await migrate({ ...opts, apply: true, skipManual: true })
  assert.equal(ext1.inserted, 1); assert.equal(ext1.manualSkipped, 1)
  const a = rows.find((r) => r.title === 'entry a')
  assert.equal(a.origin, 'external'); assert.equal(Date.parse(a.first_retrieved_at), 500, 'earliest first-retrieval time kept')
  assert.equal(rows.find((r) => r.dedupe_key === ext('b', 0).key).title, 'already in Supabase (must not change)', 'existing rows are not overwritten')
  const again = await migrate({ ...opts, apply: true, skipManual: true })
  assert.equal(again.inserted, 0); assert.equal(rows.length, 2, 'rerun adds nothing')
  const withManual = await migrate({ ...opts, apply: true })
  assert.equal(withManual.inserted, 1); assert.equal(rows.filter((r) => r.origin === 'manual').length, 1)
})

// ── bridge matching ──
const L1 = { from: '0xdedb0e722e69d7794cbae19bac32da650849490a', to: '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', valueWei: '125282852196799374', ts: 1792287035000, blockNumber: 1 }
const fakeDest = (transfers, extra = {}) => ({ id: 'optimism', name: 'OP Mainnet', verifiedLive: true, txUrl: (h) => `https://explorer.optimism.io/tx/${h}`, available: () => ({ ok: true }), blockAt: async () => 100, internalTransfersTo: async () => transfers, ...extra })
const credit = (hash, delay, value = L1.valueWei, from = '0x4200000000000000000000000000000000000010') => ({ hash, from, to: L1.from, valueWei: value, ts: L1.ts + delay * 1000 })

test('OP Stack recipient decoding', () => {
  assert.equal(opStackRecipient({ ...L1, input: '0x09fc8843' + '0'.repeat(128) }).recipient, L1.from)
  const to = '0x' + 'ab'.repeat(20)
  assert.equal(opStackRecipient({ ...L1, input: '0xe11013dd' + '0'.repeat(24) + to.slice(2) + '0'.repeat(64) }).recipient, to)
  assert.equal(opStackRecipient({ ...L1, input: '0x58a997f6' + '0'.repeat(64) }).recipient, null, 'ERC-20 deposits are not matched')
})

test('bridge trace: exact match, ambiguity, no match, unsupported bridge, missing key', async () => {
  const eth = (tx) => ({ getTransaction: async () => tx })
  const deposit = { ...L1, input: '0x09fc8843' + '0'.repeat(128) }
  let r = await traceBridge('0xaa', { adapters: { ethereum: eth(deposit), optimism: fakeDest([credit('0xL2', 78), credit('0xother', 90, '1')]) } })
  assert.equal(r.status, 'matched'); assert.equal(r.confidence, 'High'); assert.equal(r.candidates[0].hash, '0xL2'); assert.equal(r.candidates[0].delaySec, 78)
  assert.equal(r.sourceChain, 'Ethereum'); assert.equal(r.destinationChain, 'OP Mainnet'); assert.ok(r.checks.every((c) => c.pass))
  r = await traceBridge('0xaa', { adapters: { ethereum: eth(deposit), optimism: fakeDest([credit('0xa', 60), credit('0xb', 120)]) } })
  assert.equal(r.status, 'ambiguous'); assert.equal(r.confidence, 'Low')
  r = await traceBridge('0xaa', { adapters: { ethereum: eth(deposit), optimism: fakeDest([credit('0xwrongsender', 60, L1.valueWei, '0x' + '1'.repeat(40))]) } })
  assert.equal(r.status, 'unconfirmed'); assert.equal(r.confidence, null); assert.match(r.notes.join(' '), /unconfirmed/)
  r = await traceBridge('0xaa', { adapters: { ethereum: eth({ ...deposit, to: '0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f' }), optimism: fakeDest([]) } })
  assert.equal(r.status, 'unconfirmed'); assert.match(r.notes[0], /not a bridge with a matching rule/)
  r = await traceBridge('0xaa', { adapters: { ethereum: eth({ ...deposit, to: '0x3154cf16ccdb4c6d922629664174b904d80f2c35' }), base: fakeDest([], { name: 'Base', available: () => ({ ok: false, reason: 'Base needs ETHERSCAN_API_KEY' }) }) } })
  assert.equal(r.status, 'unconfirmed'); assert.equal(r.destinationChain, 'Base'); assert.match(r.notes[0], /ETHERSCAN_API_KEY/)
})

test('GET /api/bridge-trace validates the hash', async () => {
  const { s, u } = await start({ EVIDENCE_STORE_PATH: 'off' })
  try { assert.equal((await call(u, '/api/bridge-trace?tx=0x12')).status, 400) } finally { s.close() }
})
