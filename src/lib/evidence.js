// Builds the graph highlight that links one or more OSINT findings to the wallets they name.
// The beam drawn from each clue card to its wallet uses `clues`; nodes/edges drive the
// existing highlight (matched wallets plus the transfers the finding refers to).
export function evidenceHighlight(c, findings) {
  const list = Array.isArray(findings) ? findings : [findings]
  const nodes = new Set(), edges = new Set()
  for (const o of list) {
    o.matches.forEach((m) => nodes.add(m.address))
    o.relatedTx.forEach((id) => { const t = c.txs.find((x) => x.id === id); if (t) { edges.add(id); nodes.add(t.from); nodes.add(t.to) } })
  }
  return {
    kind: 'evidence', ids: list.map((o) => o.id),
    nodes: [...nodes], edges: [...edges],
    clues: list.flatMap((o) => o.matches.map((m) => ({ id: o.id, node: m.address, conf: o.confidence }))),
  }
}
export const CONF_RGB = { Confirmed: '143,208,162', Strong: '120,190,185', Weak: '227,178,106' }
