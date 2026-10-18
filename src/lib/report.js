import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtAmt, fmtUsdShort, short, SERVICE_CATS } from './analysis.js'
import { fmtTime } from './util.js'
import { ETH_USD } from '../data/cases.js'
import { fmtDelta } from './timing.js'
import { candidateMatches, NO_MATCH } from './identity.js'

export const SECTIONS = [
  { id: 'summary', label: 'Case summary' },
  { id: 'facts', label: 'Facts, inferences and hypotheses' },
  { id: 'timeline', label: 'Timeline and time-delta analysis' },
  { id: 'graph', label: 'Transaction graph' },
  { id: 'findings', label: 'Key findings and risk factors' },
  { id: 'txs', label: 'Transaction table' },
  { id: 'evidence', label: 'Evidence references' },
  { id: 'clusters', label: 'Wallet clusters (stated)' },
  { id: 'inferred', label: 'Inferred clusters' },
  { id: 'services', label: 'Bridges, mixers and trace stops' },
  { id: 'identity', label: 'Candidate identity matches' },
  { id: 'methodology', label: 'Methodology' },
  { id: 'limitations', label: 'Limitations' },
  { id: 'appendix', label: 'Wallet appendix (full addresses)' },
]

// One model feeds both the on-screen preview and the PDF so they never disagree.
export function reportModel(c, a, opts) {
  const name = (x) => a.idx.byAddr.get(x)?.label || short(x)
  const stolenTx = c.txs.filter((t) => c.taintSources.includes(t.from) && t.ts >= c.attackStart)
  const stolen = stolenTx.reduce((s, t) => s + t.usd, 0)
  const flagged = c.wallets.map((w) => ({ w, r: a.risk.get(w.address) })).filter((x) => x.r.score != null && x.r.score >= 40 && !SERVICE_CATS.has(x.w.category)).sort((x, y) => y.r.score - x.r.score)
  const txs = [...c.txs].sort((x, y) => x.ts - y.ts).filter((t) => opts.includeDust || t.usd >= 1 || t.method === 'contract creation' || t.method === 'message')
  const methodology = [
    'Fund tracing: transfers are followed forward in time from the victim wallets. A transfer only continues a path if it happened after the funds arrived.',
    'Incident share (taint): computed with the haircut method. Each wallet carries the proportion of its total received value that came from the incident; that proportion is applied to everything it sends. Swaps through a DEX carry the share of the input leg. Known service wallets include their recorded unrelated inflow in the denominator.',
    'Risk score: the sum of weighted indicators (incident share up to 30, proximity to the primary suspect up to 15, mixer use 15, rapid forwarding 10, fan-out 8, fixed-denomination mixer deposits 8, peel-chain step 8, fresh wallet 6, bridge exit 6, exchange cash-out 4, OSINT match 4 to 15), capped at 100. Bands: 70+ high, 40-69 elevated, 15-39 low.',
    'Clustering: each cluster states the method used (gas-funding linkage, deposit-address sweep, sequential peel pattern or fixed-ratio split). Clusters are investigative leads, not proof of common ownership.',
    'OSINT matching: a public-source finding is linked to a wallet only on an exact match of the full address or transaction hash, and each link records why it matches and how reliable the source is.',
  ]
  const limitations = [
    c.sample ? 'This report is generated from the GhostTrace SAMPLE DATASET. Protocol names, addresses, hashes and sources are fictional and exist to demonstrate the workflow.' : 'Transfers were retrieved from the configured data source at the time shown on the cover.',
    c.live ? `USD values: ETH and WETH at the daily ETH price on the day of each transfer where a historical price was available (DefiLlama daily close)${c.txs.some((t) => t.priceBasis === 'current') ? '; values marked ~ / ≈ use TODAY\'S price because no historical price was available' : ''}; USDC/USDT/DAI at $1; other tokens unpriced. Daily closes are not the exact price at each block.` : `USD values use a fixed reference price (ETH = $${ETH_USD.toLocaleString('en-US')}, stablecoins = $1), not the market price at each block.`,
    'Funds that enter a mixer cannot be followed to specific withdrawals; tracing stops at the deposit.',
    'Cross-chain legs (bridge exits) are recorded but not traced on the destination chain in this case.',
    'Behavioural similarity and shared funding sources suggest, but do not prove, common control of wallets.',
    'Scores for exchanges, bridges, DEXs and OTC desks measure exposure to incident funds and do not imply wrongdoing by the service.',
    'OSINT findings marked Weak come from single or anonymous sources and are not relied on for attribution.',
  ]
  if (a.deltas) limitations.push(...a.deltas.limitations, ...a.inferred.limitations, ...a.services.limitations)
  if (a.inferred) methodology.push('Inferred clusters: ' + a.inferred.method.join(' '), 'Timing: ' + a.deltas.method.join(' '), 'Bridges and mixers: ' + a.services.method.join(' '))
  const extra = a.deltas ? analysisSections(c, a, name) : null
  return { c, a, name, stolen, stolenTx, flagged, txs, methodology, limitations, generated: Date.now(), opts, extra }
}

// Facts / inferences / hypotheses, timeline, inferred clusters, services and identity for the report.
function analysisSections(c, a, name) {
  const src = c.sample ? 'the fictional sample dataset' : c.live ? `live Ethereum mainnet data (${c.fetched?.provider || 'provider'})` : 'the case data source'
  const ext = c.osint.filter((o) => o.origin === 'external')
  const observed = [
    `${c.txs.length} transfers between ${c.wallets.length} wallets, from ${src}.`,
    ...(a.services.events.length ? [`${a.services.events.length} transfers involve known bridges or mixers (${[...new Set(a.services.events.map((e) => e.basis))].join(', ')} basis).`] : []),
    ...ext.map((o) => `${o.publisher} lists ${name(o.matches[0].address)} (${o.matches[0].address}): ${o.title}. Retrieved ${fmtTime(o.collected, false)}.`),
    ...(c.sample ? c.osint.filter((o) => o.confidence === 'Confirmed').map((o) => `Fictional source ${o.id} (${o.publisher}) names ${o.matches.map((m) => name(m.address)).join(', ')}.`) : []),
  ]
  const inferred = [
    `${a.deltas.chains.length} rapid transfer sequence${a.deltas.chains.length === 1 ? '' : 's'} and ${a.deltas.cadences.length} repeated-interval pattern${a.deltas.cadences.length === 1 ? '' : 's'} (timing analysis).`,
    ...a.inferred.clusters.map((cl) => `${cl.id}: ${cl.members.length} wallets linked by transaction relationships (${cl.confidence} confidence): ${cl.members.map(name).join(', ')}.`),
    `${c.wallets.filter((w) => (a.risk.get(w.address)?.score ?? 0) >= 40).length} wallets reach an elevated risk score (heuristic indicators, not proof of wrongdoing).`,
  ]
  const identity = c.wallets.map((w) => ({ w, m: candidateMatches(c, w.address) })).filter((x) => x.m.mentions)
  const hypotheses = [
    ...c.clusters.map((cl) => `Stated cluster ${cl.id} ${cl.name} (${cl.method}): ${cl.caveat}`),
    ...identity.flatMap(({ w, m }) => m.candidates.map((x) => `${w.label} may correspond to "${x.identifier}" (${x.band}, ${x.score} pts; unverified candidate).`)),
    ...c.osint.filter((o) => o.confidence === 'Weak').map((o) => `${o.id} (${o.publisher}) claims: ${o.title}. Weak, not relied on.`),
  ]
  const timeline = [
    ...(c.txs.length ? [{ ts: Math.min(...c.txs.map((t) => t.ts)), text: 'First transfer in the case data' }] : []),
    ...(c.sample || c.taintSources.length ? [{ ts: c.attackStart, text: 'Incident start' }] : []),
    ...a.deltas.chains.map((ch) => ({ ts: c.txs.find((t) => t.id === ch.txIds[0])?.ts, text: `Rapid sequence ${ch.wallets.map(name).join(' -> ')} (${ch.delays.map(fmtDelta).join(', ')})` })),
    ...a.deltas.cadences.map((x) => ({ ts: c.txs.find((t) => t.id === x.txIds[0])?.ts, text: `${name(x.wallet)} sends ${x.txIds.length} transfers about ${fmtDelta(x.avgMs)} apart` })),
    ...a.services.events.filter((e) => e.trace !== 'uncertain' || e.category === 'bridge').slice(0, 12).map((e) => ({ ts: e.ts, text: `${e.kind}: ${name(e.wallet)} -> ${e.serviceName}, ${fmtUsdShort(e.usd || 0)}. ${e.trace === 'stops' ? 'Tracing stops.' : e.trace === 'linked' ? 'Destination linked by record.' : ''}` })),
    ...c.osint.filter((o) => o.published).map((o) => ({ ts: o.published, text: `${o.id} published by ${o.publisher}` })),
    ...(c.txs.length ? [{ ts: Math.max(...c.txs.map((t) => t.ts)), text: 'Last transfer in the case data' }] : []),
  ].filter((e) => Number.isFinite(e.ts)).sort((x, y) => x.ts - y.ts)
  return { observed, inferred, hypotheses, timeline, identity, NO_MATCH }
}

const PLUM = [40, 29, 48], COPPER = [196, 127, 89], GREY = [110, 96, 118], LIGHT = [243, 233, 240]

export async function buildPdf(m, graphPng) {
  const { c, a, name, opts } = m
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48
  let y = M
  const on = (id) => opts.sections.includes(id)
  const ensure = (h) => { if (y + h > H - 56) { doc.addPage(); y = M } }
  const heading = (txt) => {
    ensure(40); y += 8
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...PLUM); doc.text(txt, M, y)
    y += 6; doc.setDrawColor(...COPPER); doc.setLineWidth(1); doc.line(M, y, M + 36, y); y += 16
  }
  const para = (txt, size = 9.5, color = [55, 45, 62]) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color)
    const lines = doc.splitTextToSize(clean(txt), W - 2 * M)
    for (const l of lines) { ensure(size + 4); doc.text(l, M, y); y += size + 3.5 }
    y += 4
  }
  const bullet = (txt) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(55, 45, 62)
    const lines = doc.splitTextToSize(clean(txt), W - 2 * M - 14)
    lines.forEach((l, i) => { ensure(13); if (i === 0) { doc.setFillColor(...COPPER); doc.circle(M + 3, y - 3, 1.6, 'F') } doc.text(l, M + 14, y); y += 13 })
    y += 2
  }
  const table = (head, body, colStyles = {}) => {
    autoTable(doc, {
      startY: y, head: [head.map(clean)], body: body.map((r) => r.map((v) => clean(v))), margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 7.6, cellPadding: 3.5, textColor: [45, 36, 52], lineColor: [230, 214, 227], lineWidth: 0.4, overflow: 'linebreak' },
      headStyles: { fillColor: LIGHT, textColor: GREY, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [252, 248, 251] },
      columnStyles: colStyles,
    })
    y = doc.lastAutoTable.finalY + 14
  }

  // cover band
  doc.setFillColor(...PLUM); doc.rect(0, 0, W, 118, 'F')
  doc.setFillColor(...COPPER); doc.rect(0, 118, W, 3, 'F')
  doc.setTextColor(250, 240, 247); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('GHOSTTRACE  ·  INVESTIGATION REPORT', M, 40)
  doc.setFontSize(20); doc.text(clean(opts.title || c.title), M, 70)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(216, 161, 220)
  doc.text(`${c.id}  ·  ${c.chain}  ·  Status: ${c.status}  ·  Generated ${clean(fmtTime(m.generated, false))}${opts.analyst ? '  ·  Analyst: ' + clean(opts.analyst) : ''}`, M, 94)
  y = 146
  if (c.sample) {
    doc.setFillColor(243, 226, 234); doc.setDrawColor(228, 195, 211); doc.roundedRect(M, y - 12, W - 2 * M, 24, 4, 4, 'FD')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(106, 60, 79)
    doc.text('SAMPLE DATASET - fictional protocols, addresses and sources used to demonstrate GhostTrace.', M + 10, y + 3); y += 28
  }

  if (on('summary')) {
    heading('1. Case summary')
    para(c.summary)
    table(['Stolen value', 'Wallets', 'Transfers', 'Flagged wallets', 'OSINT findings', 'Incident start'],
      [[fmtUsdShort(m.stolen), c.wallets.length, c.txs.length, m.flagged.length, c.osint.length, clean(fmtTime(c.attackStart, false))]])
  }
  const x = m.extra
  if (x && on('facts')) {
    heading('Facts, inferences and hypotheses')
    para('Observed facts (recorded in the data or stated by a source):', 9.5, PLUM); x.observed.forEach(bullet)
    para('Algorithmic inferences (computed by GhostTrace; leads, not conclusions):', 9.5, PLUM); x.inferred.forEach(bullet)
    para('Unverified hypotheses (candidate explanations that need confirmation):', 9.5, PLUM); (x.hypotheses.length ? x.hypotheses : ['None recorded.']).forEach(bullet)
  }
  if (x && on('timeline')) {
    heading('Timeline and time-delta analysis')
    table(['Time (UTC)', 'Event'], x.timeline.map((e) => [clean(fmtTime(e.ts)).replace(' UTC', ''), clean(e.text)]), { 0: { cellWidth: 110 } })
    para(`Receipt-to-forward delays: ${a.deltas.stats.forwards}, median ${a.deltas.stats.medianMs == null ? '-' : fmtDelta(a.deltas.stats.medianMs)}. A short delay does not show common ownership or wrongdoing.`, 8.5, GREY)
  }
  if (on('graph') && graphPng) {
    heading('2. Transaction graph')
    const props = doc.getImageProperties(graphPng)
    const w = W - 2 * M, h = Math.min(330, (props.height / props.width) * w)
    ensure(h + 30)
    doc.setDrawColor(230, 214, 227); doc.roundedRect(M, y, w, h, 4, 4, 'S')
    const iw = Math.min(w - 8, ((h - 8) * props.width) / props.height)
    doc.addImage(graphPng, /^data:image\/jpe?g/.test(graphPng) ? 'JPEG' : 'PNG', M + (w - iw) / 2, y + 4, iw, h - 8, undefined, 'FAST')
    y += h + 12
    para('Nodes are wallets (colour = category, outer ring = risk band). Arrows are transfers in the direction funds moved; copper arrows carry traced incident funds. Graph reflects the filters applied in the workspace at export time.', 8.5, GREY)
  }
  if (on('findings')) {
    heading('3. Key findings')
    for (const { w, r } of m.flagged.slice(0, 8)) {
      ensure(40)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...PLUM)
      doc.text(`${clean(w.label)}  -  risk ${r.score} (${r.band})`, M, y)
      doc.setFont('courier', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY); doc.text(w.address, W - M, y, { align: 'right' }); y += 13
      for (const f of r.factors) bullet(`+${f.points}  ${f.label}: ${f.detail}`)
      y += 4
    }
    if (!m.flagged.length) para('No wallets reached the elevated threshold.')
  }
  if (on('txs')) {
    heading('4. Transaction table')
    table(['Time (UTC)', 'From', 'To', 'Amount', 'Value', 'Incident', 'Tx hash'],
      m.txs.map((t) => [clean(fmtTime(t.ts)).replace(' UTC', ''), clean(name(t.from)), clean(name(t.to)), `${fmtAmt(t.amount)} ${t.asset}`, (t.priceBasis === 'current' ? '~' : '') + fmtUsdShort(t.usd), (a.taint.edgeTaint.get(t.id) || 0) > 0 ? `${((a.taint.edgeTaint.get(t.id)) * 100).toFixed(0)}%` : '-', short(t.hash, 10)]),
      { 0: { cellWidth: 88 }, 6: { font: 'courier', fontSize: 6.8, cellWidth: 96 } })
  }
  if (on('evidence')) {
    heading('5. Evidence references')
    table(['ID', 'Finding', 'Source', 'Published / collected', 'Conf.', 'Linked wallets and reason'],
      c.osint.map((o) => [o.id, clean(o.title), `${clean(o.sourceType)}\n${o.url}`, `${clean(fmtTime(o.published, false))}\n${clean(fmtTime(o.collected, false))}`, o.confidence, o.matches.map((x) => `${clean(name(x.address))}: ${clean(x.reason)}`).join('\n')]),
      { 0: { cellWidth: 34 }, 2: { cellWidth: 110 }, 3: { cellWidth: 80 }, 4: { cellWidth: 46 } })
  }
  if (on('clusters')) {
    heading('6. Wallet clusters')
    table(['Cluster', 'Method', 'Members', 'Confidence', 'Basis and caveat'],
      c.clusters.map((cl) => [`${cl.id}\n${clean(cl.name)}`, clean(cl.method), cl.members.map((x) => clean(name(x))).join(', '), cl.confidence, `${clean(cl.basis)}\nCaveat: ${clean(cl.caveat)}`]),
      { 0: { cellWidth: 80 }, 1: { cellWidth: 80 }, 2: { cellWidth: 90 }, 3: { cellWidth: 52 } })
  }
  if (x && on('inferred')) {
    heading('Inferred clusters')
    if (a.inferred.clusters.length) table(['Cluster', 'Members', 'Why linked', 'Confidence'], a.inferred.clusters.map((cl) => [cl.id, cl.members.map((w) => clean(name(w))).join(', '), cl.links.map((l) => `${clean(name(l.a))} - ${clean(name(l.b))}: ${l.evidence.map((e) => e.kind).join(' + ')} (${l.score} pts)`).join('\n'), cl.confidence]), { 0: { cellWidth: 40 }, 3: { cellWidth: 56 } })
    else para('No wallets met the linking threshold.')
    para('Inferred from transaction relationships. Cluster membership does not prove common ownership.', 8.5, GREY)
  }
  if (x && on('services')) {
    heading('Bridges, mixers and trace stops')
    if (a.services.events.length) table(['Time (UTC)', 'Event', 'Wallet', 'Service', 'Value', 'Basis', 'Tracing'], a.services.events.map((e) => [clean(fmtTime(e.ts)).replace(' UTC', ''), e.kind, clean(name(e.wallet)), clean(e.serviceName), fmtUsdShort(e.usd || 0), e.basis, clean(e.note)]), { 6: { cellWidth: 150 } })
    else para('No interactions with known bridges or mixers in the loaded transfers.')
  }
  if (x && on('identity')) {
    heading('Candidate identity matches')
    if (x.identity.length) table(['Wallet', 'Candidate', 'Confidence', 'Supporting / contradicting evidence'], x.identity.map(({ w, m: im }) => im.candidates.length
      ? [clean(w.label), clean(im.candidates.map((cd) => cd.identifier).join('; ')), im.candidates.map((cd) => `${cd.band} (${cd.score})`).join('; '), clean(im.candidates.map((cd) => `${cd.supporting.map((s) => `${s.id} ${s.publisher} [${s.origin}]`).join(', ')}; contradicting: ${cd.contradicting.length ? cd.contradicting.map((s) => s.id).join(', ') : 'none'}`).join(' | '))]
      : [clean(w.label), x.NO_MATCH, '-', clean(im.rejected.length ? `Rejected below threshold: ${im.rejected.map((r) => `"${r.identifier}" (${r.score})`).join(', ')}` : `${im.mentions} mention(s) without a named identifier`)]), { 0: { cellWidth: 80 }, 2: { cellWidth: 60 } })
    else para(x.NO_MATCH + ' No source in this case names its wallets.')
    para('Candidates are identifiers as published by a source that contains the exact address. They are not verified identities.', 8.5, GREY)
  }
  if (on('methodology')) { heading('7. Methodology'); m.methodology.forEach(bullet) }
  if (on('limitations')) { heading('8. Limitations'); m.limitations.forEach(bullet) }
  if (on('appendix')) {
    heading('Appendix: wallets')
    table(['Label', 'Category', 'Full address', 'Risk'], c.wallets.map((w) => { const r = a.risk.get(w.address); return [clean(w.label), w.category, w.address, r.score == null ? 'victim' : `${r.score} ${r.band}`] }), { 2: { font: 'courier', fontSize: 7 } })
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY)
    doc.text(`GhostTrace · ${c.id}${c.sample ? ' · SAMPLE DATASET' : ''}`, M, H - 28)
    doc.text(`Page ${i} of ${pages}`, W - M, H - 28, { align: 'right' })
  }
  return doc.output('blob')
}

// Helvetica in jsPDF is Latin-1 only; replace typographic characters it cannot draw.
// eslint-disable-next-line no-control-regex
function clean(s) {
  // eslint-disable-next-line no-control-regex
  return String(s ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/→/g, '->').replace(/…/g, '...').replace(/·/g, '-').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[^\x00-\xff]/g, '')
}
