// Manually entered evidence: validation and record construction (server side).
import { createHash } from 'node:crypto'
import { HttpError, isEthAddress } from './eth.js'

export const EVIDENCE_TYPES = ['Exchange notice', 'Project disclosure', 'Law-enforcement notice', 'News article', 'Social media', 'Forum post', 'On-chain observation', 'Investigator note', 'Other']
// Verification status set by the investigator; mapped to the confidence scale used by risk scoring.
export const VERIFICATION = { 'Unverified': 'Weak', 'Corroborated by a second source': 'Strong', 'Verified by the investigator': 'Strong' }

const str = (v) => (typeof v === 'string' ? v.trim() : '')
export function validateManual(body) {
  const errors = {}
  const title = str(body?.title), description = str(body?.description), url = str(body?.url), caseRef = str(body?.caseRef)
  const wallet = str(body?.wallet).toLowerCase(), evidenceType = str(body?.evidenceType), verification = str(body?.verification)
  if (title.length < 3 || title.length > 160) errors.title = 'Title must be 3 to 160 characters.'
  if (description.length < 10 || description.length > 4000) errors.description = 'Description must be 10 to 4,000 characters.'
  if (url) {
    let ok = false
    try { const u = new URL(url); ok = (u.protocol === 'https:' || u.protocol === 'http:') && url.length <= 2000 } catch { /* invalid */ }
    if (!ok) errors.url = 'Source URL must be a full http(s) address, or left empty.'
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(caseRef)) errors.caseRef = 'A valid case is required.'
  if (wallet && !isEthAddress(wallet)) errors.wallet = 'Wallet must be 0x followed by 40 hex characters, or left empty.'
  if (!EVIDENCE_TYPES.includes(evidenceType)) errors.evidenceType = `Evidence type must be one of: ${EVIDENCE_TYPES.join(', ')}.`
  if (!(verification in VERIFICATION)) errors.verification = `Verification status must be one of: ${Object.keys(VERIFICATION).join(', ')}.`
  if (Object.keys(errors).length) { const e = new HttpError(400, 'invalid_evidence', 'Please correct the highlighted fields.'); e.fields = errors; throw e }
  const key = 'manual|' + createHash('sha256').update([caseRef, wallet, title.toLowerCase(), url, description].join('\n')).digest('hex').slice(0, 32)
  const now = Date.now()
  return {
    key, origin: 'manual', caseRef, address: wallet || null, source: 'manual', sourceName: 'Entered manually by an investigator', sourceKind: 'manual',
    sourceType: evidenceType, evidenceType, title, excerpt: description, url: url || null, identifies: null,
    confidence: VERIFICATION[verification], verification, published: null, firstRetrievedAt: now, retrievedAt: now, createdAt: now,
  }
}

export async function readJson(req, limit = 16384) {
  let size = 0
  const chunks = []
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'payload_too_large', `Request body is larger than ${limit / 1024} KB.`); chunks.push(c) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw new HttpError(400, 'invalid_json', 'Request body must be JSON.') }
}
