// Authentication for evidence writes (server side).
//
// POST and DELETE on /api/evidence require `Authorization: Bearer <EVIDENCE_WRITE_TOKEN>`.
// The token lives only in the server environment (.env.local); investigators type it into the app,
// which keeps it in that browser's storage. It is never bundled into frontend code.
// Without a configured token (24+ characters), writes are refused: the safe default.
// Repeated failed attempts from one client are rate-limited.

import { createHash, timingSafeEqual } from 'node:crypto'
import { HttpError } from './eth.js'

const digest = (s) => createHash('sha256').update(String(s)).digest()

export function createWriteAuth(env = process.env, { maxFailuresPerMin = 10 } = {}) {
  const token = (env.EVIDENCE_WRITE_TOKEN || '').trim()
  const configured = token.length >= 24
  const expected = configured ? digest(token) : null
  const failures = new Map() // client -> [timestamps]

  function check(req, client = 'unknown') {
    if (!configured) throw new HttpError(503, 'writes_disabled', 'Evidence writes are disabled on this server: set EVIDENCE_WRITE_TOKEN (at least 24 characters) in the server environment and restart it.')
    const now = Date.now()
    const recent = (failures.get(client) || []).filter((t) => now - t < 60000)
    if (recent.length >= maxFailuresPerMin) throw new HttpError(429, 'auth_rate_limited', 'Too many failed authentication attempts. Wait a minute and try again.')
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
    if (!m) throw new HttpError(401, 'auth_required', 'An investigator write token is required to add or remove evidence.')
    if (!timingSafeEqual(digest(m[1].trim()), expected)) {
      recent.push(now); failures.set(client, recent)
      throw new HttpError(403, 'forbidden', 'The write token was not accepted.')
    }
    return { role: 'investigator' }
  }
  return { configured, check, status: () => ({ enabled: configured, method: 'bearer token (EVIDENCE_WRITE_TOKEN)' }) }
}
