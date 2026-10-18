// GhostTrace demo smoke test: drives the real app in headless Chrome (DevTools protocol, no extra deps).
//
//   npm run smoke                                   sample-case path (works without the backend)
//   npm run smoke -- --live 0xADDRESS               also creates a live case from that address
//   env: APP_URL (default http://localhost:5174), API_URL (http://localhost:8787/api), CHROME_PATH
//
// Checks: case list, graph, ledger, OSINT Evidence page, PDF export (valid, < 15 MB, sections present),
// and optionally a live Ethereum case. Read-only: it never writes evidence. Exits 1 if any check fails.
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import net from 'node:net'

const APP = process.env.APP_URL || 'http://localhost:5174'
const API = process.env.API_URL || 'http://localhost:8787/api'
const args = process.argv.slice(2)
const LIVE = args.includes('--live') ? args[args.indexOf('--live') + 1] : null
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)) }) })

async function main() {
  console.log(`GhostTrace smoke test · app ${APP} · api ${API}${LIVE ? ` · live ${LIVE}` : ''}\n`)
  try {
    const h = await (await fetch(`${API}/health`, { signal: AbortSignal.timeout(5000) })).json()
    console.log(`info  backend up · provider ${h.provider} · evidence storage ${h.evidenceStorage?.backend} · writes ${h.evidenceWrites?.enabled ? 'enabled' : 'disabled'}`)
  } catch { console.log('info  backend not reachable: sample cases must still work; live and evidence checks will fail') }
  if (!CHROME) { check('Chrome found (set CHROME_PATH)', false); return }
  try { await fetch(APP, { signal: AbortSignal.timeout(5000) }) } catch { check(`app reachable at ${APP} (start it with npm run dev)`, false); return }

  const dir = mkdtempSync(join(tmpdir(), 'gt-smoke-')), dl = join(dir, 'downloads'), port = await freePort()
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1440,900', `--user-data-dir=${join(dir, 'profile')}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' })
  try {
    let tabs; for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.length) break } catch { /* starting */ } await sleep(250) }
    const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl)
    await new Promise((r) => ws.addEventListener('open', r))
    let n = 0; const pending = new Map(), errors = []
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
      if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0])
    })
    const send = (method, params = {}) => new Promise((r) => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
    const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
    const click = (sel, text) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); b?.click(); return !!b })()`)
    const nav = (label) => click('nav.rail .nav-item', label)
    const waitFor = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 300) { const v = await ev(expr); if (v) return v; await sleep(300) } return null }
    const setCase = (id) => ev(`(() => { const s = document.querySelector('select[aria-label="Active case"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${id}'); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    const transfers = () => ev(`(() => { const m = (document.querySelector('.ws-title')?.textContent || '').match(/([\\d,]+) wallets · ([\\d,]+) transfers/); return m ? Number(m[2].replace(/,/g, '')) : null })()`)
    const ledgerRows = () => ev(`document.querySelectorAll('main table tbody tr').length`)
    await send('Runtime.enable'); await send('Page.enable')
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl })

    await send('Page.navigate', { url: `${APP}/#graph` })
    const ids = await waitFor(`(() => { const o = [...document.querySelectorAll('select[aria-label="Active case"] option')].map((x) => x.value); return o.length ? o : null })()`)
    check('sample cases available', !!ids && ids.includes('GT-2026-014') && ids.includes('GT-2026-017'), ids ? ids.join(', ') : 'no case selector')
    await setCase('GT-2026-014'); await sleep(1500)
    const tx = await waitFor(`(() => /\\d+ transfers/.test(document.querySelector('.ws-title')?.textContent || '') && document.querySelector('.ws-title').textContent)()`)
    const nTx = await transfers()
    check('Halcyon graph shows transfers', nTx > 0, tx || 'graph title missing')
    await nav('Transactions'); await sleep(1500)
    const rows = await ledgerRows()
    check('ledger lists transfers', rows > 0, `${rows} rows`)
    check('"OSINT Evidence" navigation item present', await nav('OSINT Evidence'))
    await sleep(1500)
    const findings = await waitFor(`document.querySelectorAll('button.finding').length || null`, 8000)
    check('OSINT Evidence page lists findings', findings > 0, `${findings || 0} findings`)
    check('Add Evidence button present', !!(await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add Evidence')`)))

    await nav('Reports'); await sleep(3000)
    await click('button', 'Export PDF')
    const toast = await waitFor(`(() => { const t = document.querySelector('.toast')?.textContent || ''; return /pdf|Could not/i.test(t) ? t : null })()`, 60000)
    await sleep(1500)
    const pdfs = existsSync(dl) ? readdirSync(dl).filter((f) => f.endsWith('.pdf')) : []
    if (!pdfs.length) check('PDF report exported', false, toast || 'no download')
    else {
      const file = join(dl, pdfs[0]), size = statSync(file).size, buf = readFileSync(file)
      let text = ''
      for (const m of buf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) { try { text += inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { text += m[1] } }
      check('PDF report exported and valid', buf.subarray(0, 5).toString() === '%PDF-', `${pdfs[0]}, ${(size / 1048576).toFixed(2)} MB`)
      check('PDF size under 15 MB', size < 15 * 1048576, `${(size / 1048576).toFixed(2)} MB`)
      check('PDF embeds the graph image', /\/Subtype\s*\/Image/.test(buf.toString('latin1')), /DCTDecode/.test(buf.toString('latin1')) ? 'JPEG' : 'PNG')
      const want = ['Case summary', 'Facts, inferences and hypotheses', 'Timeline and time-delta', 'Inferred clusters', 'Candidate identity matches', 'SAMPLE DATASET']
      const missing = want.filter((w) => !text.includes(w))
      check('PDF contains report sections', !missing.length, missing.length ? `missing: ${missing.join(', ')}` : want.length + ' sections found')
    }

    if (LIVE) {
      await nav('Cases'); await sleep(1000)
      await click('button', 'New investigation'); await sleep(600)
      await ev(`(() => { const el = document.getElementById('nc-seed'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(LIVE)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      await sleep(300); await click('button[type="submit"]', 'Create case')
      const t = await waitFor(`(() => { const t = document.querySelector('.toast')?.textContent || ''; return /Loaded|not loaded|unavailable/.test(t) ? t : null })()`, 120000)
      check('live case loads', !!t && /Loaded|showing data fetched earlier/.test(t), t || 'no result within 120 s')
      await sleep(2500)
      const lt = await transfers()
      check('live graph shows transfers', lt > 0, `${lt ?? 0} transfers`)
      await nav('Transactions'); await sleep(2000)
      check('live ledger lists transfers', (await ledgerRows()) > 0)
    }
    check('no uncaught errors in the page', !errors.length, errors.slice(0, 2).join(' | '))
    ws.close()
  } finally {
    const exited = new Promise((r) => chrome.once('exit', r))
    chrome.kill()
    await Promise.race([exited, sleep(5000)])
    if (!args.includes('--keep-temp')) try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* leftover temp files are harmless */ }
  }
}

main().catch((e) => check('smoke test ran', false, e.message)).finally(() => {
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
})
