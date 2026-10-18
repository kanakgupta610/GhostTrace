export const fmtTime = (ms, withSec = true) => {
  if (ms == null) return '—'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${withSec ? ':' + p(d.getUTCSeconds()) : ''} UTC`
}
export const fmtDay = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`
}
export const fmtClock = (ms) => {
  const d = new Date(ms); const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}
export const fmtUsd = (v) => '$' + Math.round(v).toLocaleString('en-US')

export const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s.trim())
export const isTxHash = (s) => /^0x[0-9a-fA-F]{64}$/.test(s.trim())

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select()
      const ok = document.execCommand('copy'); ta.remove(); return ok
    } catch { return false }
  }
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem('ghosttrace:' + k); return v ? JSON.parse(v) : d } catch { return d } },
  set(k, v) { try { localStorage.setItem('ghosttrace:' + k, JSON.stringify(v)) } catch { /* storage unavailable */ } },
}

// Offer a generated file. Inside the claude.ai artifact viewer this goes through the
// `downloads` capability (the viewer confirms); anywhere else it is a normal browser download.
export async function saveFile(filename, blob) {
  try {
    if (window.claude?.use) {
      const dl = await window.claude.use('downloads')
      if (dl) {
        try { await dl.save({ filename, data: blob }); return { ok: true, msg: `Saved ${filename}` } } catch (e) {
          if (e?.code === 'declined') return { ok: false, msg: 'Download cancelled' }
          if (e?.code === 'rate_limited') return { ok: false, msg: 'A save prompt is already open' }
          return { ok: false, msg: `Download unavailable here (${e?.code || 'error'})` }
        }
      }
    }
  } catch { /* fall through */ }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return { ok: true, msg: `Downloaded ${filename}` }
}

export async function sha256(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}
