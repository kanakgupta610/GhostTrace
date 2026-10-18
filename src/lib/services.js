// Known services and bridge/mixer investigation. Pure functions; shared by the backend and the UI.
//
// KNOWN_SERVICES holds only Ethereum mainnet contracts whose verified contract name was checked on the
// Routescan explorer on 2026-10-18 (for proxies, the implementation name). Destination chains for the
// L2 bridge contracts come from the projects' published deployment lists. Exchange hot wallets are not
// included: they are ordinary accounts, so a contract record cannot confirm who operates them.

const VERIFIED = 'Verified contract name on the Routescan explorer, checked 2026-10-18'
export const KNOWN_SERVICES = Object.fromEntries([
  ['0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc', 'mixer', 'Tornado Cash 0.1 ETH pool', 'TornadoCash_Eth_01'],
  ['0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936', 'mixer', 'Tornado Cash 1 ETH pool', 'ETHTornado'],
  ['0x910cbd523d972eb0a6f4cae4618ad62622b39dbf', 'mixer', 'Tornado Cash 10 ETH pool', 'ETHTornado'],
  ['0xa160cdab225685da1d56aa342ad8841c3b53f291', 'mixer', 'Tornado Cash 100 ETH pool', 'ETHTornado'],
  ['0xd90e2f925da726b50c4ed8d0fb90ad053324f31b', 'mixer', 'Tornado Cash router', 'TornadoRouter'],
  ['0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f', 'bridge', 'Arbitrum One delayed inbox', 'Inbox (proxy)', 'Arbitrum One'],
  ['0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a', 'bridge', 'Arbitrum One bridge', 'Bridge (proxy)', 'Arbitrum One'],
  ['0x99c9fc46f92e8a1c0dec1b1747d010903e884be1', 'bridge', 'Optimism L1 standard bridge', 'L1StandardBridge (proxy)', 'OP Mainnet'],
  ['0x3154cf16ccdb4c6d922629664174b904d80f2c35', 'bridge', 'Base L1 standard bridge', 'L1StandardBridge (proxy)', 'Base'],
  ['0xa0c68c638235ee32657e8f720a23cec1bfc77c77', 'bridge', 'Polygon PoS RootChainManager', 'RootChainManagerProxy', 'Polygon PoS'],
  ['0x8484ef722627bf18ca5ae6bcf031c23e6e922b30', 'bridge', 'Polygon PoS Ether predicate', 'EtherPredicateProxy', 'Polygon PoS'],
  ['0x32400084c286cf3e17e7b677ea9583e60a000324', 'bridge', 'zkSync Era diamond proxy', 'DiamondProxy', 'zkSync Era'],
  ['0x3ee18b2214aff97000d974cf647e7c347e8fa585', 'bridge', 'Wormhole token bridge', 'Wormhole (proxy)', 'several (Wormhole)'],
  ['0x7a250d5630b4cf539739df2c5dacb4c659f2488d', 'dex', 'Uniswap V2 router', 'UniswapV2Router02'],
  ['0xe592427a0aece92de3edee1f18e0157c05861564', 'dex', 'Uniswap V3 swap router', 'SwapRouter'],
  ['0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', 'dex', 'Uniswap swap router 02', 'SwapRouter02'],
  ['0x1111111254eeb25477b68fb85ed929f73a960582', 'dex', '1inch aggregation router v5', 'AggregationRouterV5'],
].map(([address, category, name, contract, destination]) => [address, { address, category, name, contract, destination: destination || null, source: VERIFIED }]))

export const knownService = (address) => KNOWN_SERVICES[(address || '').toLowerCase()] || null

export const SERVICE_METHOD = [
  'Known services: a wallet is marked as a mixer, bridge or DEX only if its address is in the curated registry (verified contract names) or the case data labels it. The source of each label is shown.',
  'Mixer deposits: funds can be followed into a mixer pool, but on-chain data does not link a deposit to a later withdrawal. Tracing stops at the deposit.',
  'Bridge deposits: the Ethereum leg is recorded. The destination-chain leg is linked only when the case holds an operator record (for example a bridge relay record) naming that exact deposit; otherwise tracing stops at the bridge.',
]
export const SERVICE_LIMITS = [
  'GhostTrace reads Ethereum mainnet only. It does not query destination chains, so cross-chain movements are not followed beyond the bridge.',
  'The registry covers a small set of well-known contracts. A service missing from it is shown as an ordinary wallet, not as a confirmed non-service.',
  'Token transfers and internal calls are included only as far as the data provider returns them; some contract-mediated movements may be missing.',
]

// Bridge and mixer interactions in a case, with where tracing becomes uncertain or stops.
export function serviceExposure(c) {
  const byAddr = new Map((c.wallets || []).map((w) => [w.address, w]))
  const kindOf = (a) => {
    const reg = knownService(a)
    if (reg && (reg.category === 'mixer' || reg.category === 'bridge')) return { category: reg.category, name: reg.name, basis: 'registry', destination: reg.destination, detail: `${reg.contract}. ${reg.source}` }
    const w = byAddr.get(a)
    if (w && (w.category === 'mixer' || w.category === 'bridge')) return { category: w.category, name: w.label, basis: c.sample ? 'sample label' : 'case label', destination: null, detail: c.sample ? 'Labelled in the fictional sample dataset' : 'Labelled in the case data' }
    return null
  }
  // bridge operator records in the case that cite a specific transfer
  const relays = new Map()
  for (const o of c.osint || []) if (/bridge/i.test(o.sourceType || '')) for (const id of o.relatedTx || []) relays.set(id, o)

  const events = []
  for (const t of c.txs || []) {
    for (const [dir, svcAddr, wallet] of [['in', t.to, t.from], ['out', t.from, t.to]]) {
      const k = kindOf(svcAddr)
      if (!k) continue
      const ev = { txId: t.id, hash: t.hash, ts: t.ts, wallet, service: svcAddr, serviceName: k.name, category: k.category, basis: k.basis, basisDetail: k.detail, asset: t.asset, amount: t.amount, usd: t.usd }
      if (k.category === 'mixer') {
        Object.assign(ev, dir === 'in'
          ? { kind: 'Mixer deposit', trace: 'stops', note: 'Deposits cannot be linked to specific withdrawals on-chain. Tracing stops here.' }
          : { kind: 'Mixer withdrawal', trace: 'uncertain', note: 'Withdrawals cannot be linked to specific deposits on-chain; the origin of these funds is uncertain.' })
      } else {
        const relay = relays.get(t.id)
        Object.assign(ev, dir === 'in'
          ? relay
            ? { kind: 'Bridge deposit', trace: 'linked', note: `Destination recorded in ${relay.id} (${relay.publisher}${c.sample ? ', fictional sample source' : ''}). The destination-chain leg itself is not traced here.`, linkedEvidence: relay.id }
            : { kind: 'Bridge deposit', trace: 'stops', note: `Funds left Ethereum${k.destination ? ` towards ${k.destination}` : ''}. No destination-chain record is available, so tracing stops at the bridge.` }
          : { kind: 'Bridge withdrawal', trace: 'uncertain', note: 'Funds arrived from another chain; their origin there is not traced.' })
      }
      events.push(ev)
    }
  }
  events.sort((a, b) => a.ts - b.ts)
  const sum = (f) => events.filter(f).reduce((s, e) => s + (e.usd || 0), 0)
  return {
    events,
    totals: { mixerInUsd: sum((e) => e.kind === 'Mixer deposit'), bridgeOutUsd: sum((e) => e.kind === 'Bridge deposit'), stops: events.filter((e) => e.trace === 'stops').length, linked: events.filter((e) => e.trace === 'linked').length },
    method: SERVICE_METHOD, limitations: SERVICE_LIMITS,
  }
}
