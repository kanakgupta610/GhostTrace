// Evidence-backed candidate identity matching. Pure functions; no UI code.
//
// A candidate is produced only when a piece of evidence names an identifier (an entity, service or
// pseudonym) AND contains the wallet's full address (exact match). Nothing is inferred from behaviour,
// and an address is never treated as a person. Confidence is a deterministic points score:
//   base by source kind: sanctions list 45 · first-party statement 40 · operator/exchange notice 35 ·
//                        independent researcher 20 · community threat list 15 · developer forum/repo 10 · anonymous 5
//   +15 per additional independent source naming the same identifier (max +30)
//   −25 per piece of evidence that names a different identifier for the same wallet
// Bands: High ≥ 60 · Medium 35–59 · Low < 35. Candidates below 35 are not shown as matches.

export const IDENTITY_METHOD = [
  'A candidate identifier is considered only when a source explicitly names it together with the wallet\'s full 40-character address. Behaviour, timing or clustering never create an identity match.',
  'Base points by source kind: sanctions list 45, first-party statement 40, operator or exchange notice 35, independent researcher 20, community threat list 15, developer forum or repository 10, anonymous source 5.',
  'Each additional independent source naming the same identifier adds 15 (up to 30). Each source naming a different identifier for the same wallet subtracts 25.',
  'Bands: High at 60 or more, Medium 35–59. Below 35 the result is "No reliable identity match found".',
  'Identifiers are entities, services or pseudonyms as published. A wallet address is never equated with a person without such a source.',
]
export const NO_MATCH = 'No reliable identity match found.'

const BASE = { sanctions: 45, 'first-party': 40, operator: 35, researcher: 20, 'threat-list': 15, developer: 10, anonymous: 5 }

// Map an OSINT finding to a source kind. External findings carry `sourceKind`; sample ones are classified by type.
export function sourceKind(o) {
  if (o.sourceKind) return o.sourceKind
  const t = `${o.sourceType || ''} ${o.publisher || ''}`.toLowerCase()
  if (/sanction|ofac/.test(t)) return 'sanctions'
  if (/project disclosure|post-mortem|on-chain data/.test(t)) return 'first-party'
  if (/exchange notice|bridge explorer|operator/.test(t)) return 'operator'
  if (/anonymous|paste/.test(t)) return 'anonymous'
  if (/threat feed|threat list|scam/.test(t)) return 'threat-list'
  if (/github|repository|forum/.test(t)) return /forum/.test(t) && /user/.test(t) ? 'anonymous' : 'developer'
  if (/social|researcher/.test(t)) return 'researcher'
  return 'anonymous'
}

// The identifier a finding attributes to a wallet, if it names one. External findings set `identifies`
// explicitly; sample findings use `matches[].identifies` when present.
const identifierFor = (o, address) => {
  const m = (o.matches || []).find((x) => x.address === address)
  return (m && m.identifies) || (o.identifies && o.identifies[address]) || null
}
const containsAddress = (o, address) => {
  const hay = `${o.excerpt || ''} ${(o.identifiers || []).map((i) => i.value).join(' ')}`.toLowerCase()
  return hay.includes(address.toLowerCase())
}

export function candidateMatches(c, address) {
  const relevant = (c.osint || []).filter((o) => (o.matches || []).some((m) => m.address === address))
  const named = relevant.map((o) => ({ o, id: identifierFor(o, address), exact: containsAddress(o, address), kind: sourceKind(o) })).filter((x) => x.id && x.exact)
  const byId = new Map()
  for (const x of named) { if (!byId.has(x.id)) byId.set(x.id, []); byId.get(x.id).push(x) }
  const candidates = [...byId.entries()].map(([identifier, support]) => {
    const sorted = [...support].sort((a, b) => BASE[b.kind] - BASE[a.kind])
    const base = BASE[sorted[0].kind]
    const corroboration = Math.min(30, 15 * new Set(sorted.slice(1).map((x) => x.o.publisher)).size)
    const contradictions = named.filter((x) => x.id !== identifier)
    const score = Math.max(0, base + corroboration - 25 * contradictions.length)
    return {
      identifier, score, band: score >= 60 ? 'High' : score >= 35 ? 'Medium' : 'Low',
      method: 'Exact address published together with this identifier',
      breakdown: [`${base}: strongest source is a ${sorted[0].kind.replace('-', ' ')} (${sorted[0].o.publisher})`, ...(corroboration ? [`+${corroboration}: ${corroboration / 15} more independent source${corroboration > 15 ? 's' : ''}`] : []), ...contradictions.map((x) => `−25: ${x.o.publisher} names "${x.id}" instead`)],
      supporting: sorted.map((x) => ({ id: x.o.id, title: x.o.title, url: x.o.url, publisher: x.o.publisher, kind: x.kind, origin: x.o.origin || (c.sample ? 'sample' : 'case') })),
      contradicting: contradictions.map((x) => ({ id: x.o.id, title: x.o.title, url: x.o.url, publisher: x.o.publisher, names: x.id })),
    }
  }).sort((a, b) => b.score - a.score)
  const reliable = candidates.filter((x) => x.score >= 35)
  return { address, candidates: reliable, rejected: candidates.filter((x) => x.score < 35), mentions: relevant.length, verdict: reliable.length ? null : NO_MATCH }
}
