// Cross-chain investigation: chain adapters and bridge matching (server side).
//
// ChainAdapter interface (Etherscan-compatible explorers):
//   id, name, chainId, txUrl(hash)                      – identity and links
//   available() → { ok, reason }                        – whether a data source is configured
//   blockAt(tsMs, 'after' | 'before') → block number
//   internalTransfersTo(address, fromBlock, toBlock) → [{ hash, from, to, valueWei, ts }]
//   getTransaction(hash) → { from, to, valueWei, input, ts, blockNumber }   (source chains)
//
// Bridge matchers turn a source-chain bridge deposit into a destination-chain match only when a stated,
// checkable rule holds. Otherwise the trail is reported as unconfirmed. Nothing is inferred beyond the rule.

import { explorerCall, HttpError } from './eth.js'

const lc = (s) => String(s || '').toLowerCase()
const OP_L2_STANDARD_BRIDGE = '0x4200000000000000000000000000000000000010'

function etherscanLike({ id, name, chainId, base, params = {}, txBase, gapMs = 300, needsKey = null, verifiedLive, keyHint }) {
  const cfg = { id, name, base, params, gapMs, secret: params.apikey || null, keyHint }
  const call = (p) => explorerCall(cfg, p, { timeoutMs: 12000 }).then((r) => r.result)
  return {
    id, name, chainId, verifiedLive, txUrl: (h) => `${txBase}${h}`,
    available: () => (needsKey ? { ok: false, reason: needsKey } : { ok: true }),
    async blockAt(tsMs, closest) {
      const r = await call({ module: 'block', action: 'getblocknobytime', timestamp: String(Math.floor(tsMs / 1000)), closest })
      return Number(r?.blockNumber ?? r)
    },
    async internalTransfersTo(address, fromBlock, toBlock) {
      const r = await call({ module: 'account', action: 'txlistinternal', address, startblock: String(fromBlock), endblock: String(toBlock), sort: 'asc', page: '1', offset: '200' })
      return (r || []).filter((t) => lc(t.to) === lc(address) && t.isError !== '1').map((t) => ({ hash: t.transactionHash || t.hash, from: lc(t.from), to: lc(t.to), valueWei: String(t.value), ts: Number(t.timeStamp) * 1000 }))
    },
    async getTransaction(hash) {
      const tx = await call({ module: 'proxy', action: 'eth_getTransactionByHash', txhash: hash })
      if (!tx) throw new HttpError(404, 'tx_not_found', `${name}: transaction ${hash} not found`)
      const blk = await call({ module: 'proxy', action: 'eth_getBlockByNumber', tag: tx.blockNumber, boolean: 'false' })
      return { from: lc(tx.from), to: lc(tx.to), valueWei: BigInt(tx.value).toString(), input: tx.input || '0x', blockNumber: Number(tx.blockNumber), ts: Number(blk.timestamp) * 1000 }
    },
  }
}

// Adapters that can be used with available data. Base and Arbitrum need the free Etherscan V2 key.
export function chainAdapters(env = process.env, ethereumProviders = []) {
  const key = (env.ETHERSCAN_API_KEY || '').trim()
  const base = env.CHAIN_API_BASE // test override
  const ethCfg = ethereumProviders[0]
  const ethereum = ethCfg ? etherscanLike({ id: 'ethereum', name: 'Ethereum', chainId: 1, base: base || ethCfg.base, params: ethCfg.params, txBase: 'https://etherscan.io/tx/', verifiedLive: true }) : null
  // OP Mainnet: Etherscan V2 (chainid 10) when a key is set, otherwise the keyless OP explorer API
  const optimism = key && !base
    ? etherscanLike({ id: 'optimism', name: 'OP Mainnet', chainId: 10, base: 'https://api.etherscan.io/v2/api', params: { chainid: '10', apikey: key }, txBase: 'https://optimistic.etherscan.io/tx/', verifiedLive: true })
    : etherscanLike({ id: 'optimism', name: 'OP Mainnet', chainId: 10, base: base || env.OPTIMISM_EXPLORER_API || 'https://explorer.optimism.io/api', txBase: 'https://explorer.optimism.io/tx/', verifiedLive: true,
      keyHint: ' The keyless OP explorer quota is small; wait for the reset, or set ETHERSCAN_API_KEY on the server to use Etherscan V2 for OP Mainnet.' })
  const baseChain = etherscanLike({ id: 'base', name: 'Base', chainId: 8453, base: base || 'https://api.etherscan.io/v2/api', params: key ? { chainid: '8453', apikey: key } : {}, txBase: 'https://basescan.org/tx/', verifiedLive: false,
    needsKey: key ? null : 'Base needs ETHERSCAN_API_KEY (free Etherscan V2 key) on the server; no keyless Base explorer API is reachable.' })
  return { ethereum, optimism, base: baseChain }
}

// Which matching rule applies to a source-chain bridge contract.
export const BRIDGE_RULES = {
  '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1': { bridge: 'Optimism L1 standard bridge', destination: 'optimism', rule: 'op-stack-eth' },
  '0x3154cf16ccdb4c6d922629664174b904d80f2c35': { bridge: 'Base L1 standard bridge', destination: 'base', rule: 'op-stack-eth' },
}
const ETH_SELECTORS = { '0xb1a1a882': 'depositETH', '0x09fc8843': 'bridgeETH', '0x9a2ac6d5': 'depositETHTo', '0xe11013dd': 'bridgeETHTo' }

// Decode the destination recipient of an OP Stack standard-bridge ETH deposit, or explain why not.
export function opStackRecipient(tx) {
  const sel = (tx.input || '0x').slice(0, 10)
  if (tx.input === '0x' || !tx.input) return { recipient: tx.from, call: 'plain ETH transfer (receive)' }
  const fn = ETH_SELECTORS[sel]
  if (!fn) return { recipient: null, call: sel, reason: `Call ${sel} is not an ETH deposit (for example an ERC-20 bridge call); token deposits are not matched.` }
  if (fn.endsWith('To')) return { recipient: '0x' + tx.input.slice(10 + 24, 10 + 64), call: fn }
  return { recipient: tx.from, call: fn }
}

export async function traceBridge(sourceHash, { adapters, windowMs = 60 * 60000 }) {
  const result = { sourceChain: 'Ethereum', sourceTx: { hash: sourceHash, url: `https://etherscan.io/tx/${sourceHash}` }, destinationChain: null, status: 'unconfirmed', confidence: null, checks: [], candidates: [], method: null, notes: [] }
  if (!adapters.ethereum) { result.notes.push('No Ethereum data provider configured.'); return result }
  const tx = await adapters.ethereum.getTransaction(sourceHash)
  Object.assign(result.sourceTx, { from: tx.from, to: tx.to, valueWei: tx.valueWei, ts: tx.ts })
  const rule = BRIDGE_RULES[tx.to]
  if (!rule) { result.notes.push(`Destination ${tx.to} is not a bridge with a matching rule in GhostTrace (supported: Optimism and Base standard bridges). The trail is unconfirmed.`); return result }
  const dest = adapters[rule.destination]
  result.destinationChain = dest.name; result.bridge = rule.bridge
  result.method = `OP Stack standard bridge: an ETH deposit to ${rule.bridge} is credited on ${dest.name} as an internal transfer of the exact same wei amount from the L2 standard bridge (${OP_L2_STANDARD_BRIDGE}) to the recipient, within ${windowMs / 60000} minutes.`
  const rec = opStackRecipient(tx)
  result.checks.push({ check: `Source call decoded (${rec.call})`, pass: !!rec.recipient, detail: rec.reason || `recipient ${rec.recipient}` })
  if (!rec.recipient) return result
  result.recipient = rec.recipient
  if (BigInt(tx.valueWei) === 0n) { result.checks.push({ check: 'Deposit carries ETH', pass: false, detail: 'value is 0' }); return result }
  const av = dest.available()
  if (!av.ok) { result.notes.push(av.reason); result.checks.push({ check: `${dest.name} data source available`, pass: false, detail: av.reason }); return result }
  const fromBlock = await dest.blockAt(tx.ts, 'after'), toBlock = await dest.blockAt(tx.ts + windowMs, 'before')
  const incoming = await dest.internalTransfersTo(rec.recipient, fromBlock, toBlock)
  const cands = incoming.filter((t) => t.from === OP_L2_STANDARD_BRIDGE && t.valueWei === tx.valueWei && t.ts >= tx.ts && t.ts - tx.ts <= windowMs)
  result.checks.push({ check: `${dest.name} transfers to the recipient in the ${windowMs / 60000}-minute window`, pass: incoming.length > 0, detail: `${incoming.length} internal transfer${incoming.length === 1 ? '' : 's'} (blocks ${fromBlock}–${toBlock})` })
  result.checks.push({ check: 'Exact amount from the L2 standard bridge', pass: cands.length > 0, detail: `${cands.length} candidate${cands.length === 1 ? '' : 's'}` })
  result.candidates = cands.map((t) => ({ hash: t.hash, url: dest.txUrl(t.hash), ts: t.ts, delaySec: Math.round((t.ts - tx.ts) / 1000), valueWei: t.valueWei }))
  if (cands.length === 1) { result.status = 'matched'; result.confidence = dest.verifiedLive ? 'High' : 'Medium' }
  else if (cands.length > 1) { result.status = 'ambiguous'; result.confidence = 'Low'; result.notes.push('Several transfers fit the rule; the deposit cannot be tied to one of them.') }
  else result.notes.push('No transfer fits the rule, so the destination leg is unconfirmed (it may have arrived later, been bridged elsewhere, or used a different recipient).')
  if (!dest.verifiedLive) result.notes.push(`${dest.name}: the same OP Stack rule applies, but GhostTrace could not test it against live ${dest.name} data, so confidence is capped at Medium.`)
  return result
}
