// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE DATASET — fictional protocols, fictional addresses, fictional sources.
// Every address and hash below is generated from a fixed seed. Source URLs use
// the reserved `.example` TLD (RFC 2606) so nothing points at a real party.
// Replace with a live source via Settings → Data source once a backend exists.
// ─────────────────────────────────────────────────────────────────────────────

function prng(seed) {
  let s = 0
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}
const HEX = '0123456789abcdef'
export function hex(seed, len) {
  const r = prng(seed)
  let out = ''
  for (let i = 0; i < len; i++) out += HEX[Math.floor(r() * 16)]
  return out
}
const addr = (k) => '0x' + hex('addr:' + k, 40)
const txh = (k) => '0x' + hex('tx:' + k, 64)

const ETH_USD = 2400 // sample reference price used for every ETH valuation in this dataset
const ts = (s) => new Date(s + 'Z').getTime()

function build(def) {
  const map = {}
  const wallets = def.wallets.map((w) => {
    const a = addr(def.id + ':' + w.k)
    map[w.k] = a
    return { address: a, chain: def.chain, tags: [], externalInflowUsd: 0, ...w, k: undefined, key: w.k }
  })
  let block = def.startBlock
  let lastTs = 0
  const txs = def.txs.map((t, i) => {
    const time = ts(t.at)
    if (time > lastTs) { block += Math.max(1, Math.round((time - lastTs) / 12000 / 50)); lastTs = time }
    const usd = t.asset === 'ETH' ? t.amount * ETH_USD : t.amount
    return {
      id: `${def.id}-T${String(i + 1).padStart(3, '0')}`,
      hash: txh(def.id + ':' + i),
      from: map[t.f], to: map[t.t], asset: t.asset, amount: t.amount, usd, ts: time,
      block, method: t.m || 'transfer', note: t.note || '', status: 'success',
      source: 'Sample dataset · modelled on an on-chain transfer record',
    }
  })
  const sub = (s) => s.replace(/\{(\w+)\}/g, (_, k) => map[k] || txs.find((x) => x.id.endsWith(k))?.hash || k)
  const osint = def.osint.map((o) => ({
    ...o,
    excerpt: sub(o.excerpt),
    url: sub(o.url),
    matches: o.matches.map((m) => ({ ...m, address: map[m.w], reason: sub(m.reason) })),
    identifiers: o.identifiers.map((x) => ({ ...x, value: sub(x.value) })),
    relatedTx: (o.relatedTx || []).map((n) => `${def.id}-${n}`),
    published: ts(o.published), collected: ts(o.collected),
  }))
  const clusters = def.clusters.map((c) => ({ ...c, members: c.members.map((k) => map[k]) }))
  return {
    ...def, wallets, txs, osint, clusters, sample: true,
    seed: map[def.seed], primarySuspect: map[def.primarySuspect],
    taintSources: def.taintSources.map((k) => map[k]),
    initialVisible: def.initialVisible.map((k) => map[k]),
    attackStart: ts(def.attackStart),
    createdAt: ts(def.createdAt), updatedAt: ts(def.updatedAt),
    activity: def.activity.map((a) => ({ ...a, ts: ts(a.at) })),
  }
}

const halcyon = {
  id: 'GT-2026-014',
  title: 'Ghost Attacks: Halcyon Bridge exploit',
  chain: 'Ethereum',
  status: 'Active',
  priority: 'Critical',
  owner: 'Case team A',
  startBlock: 20871400,
  attackStart: '2026-09-14T02:13:07',
  createdAt: '2026-09-14T03:05:00',
  updatedAt: '2026-09-16T15:20:00',
  seed: 'E1',
  primarySuspect: 'E1',
  taintSources: ['V'],
  summary:
    'An attacker deployed a contract that drained 12,110 ETH and 12.94M USDC (about $42M at the sample reference price) from the Halcyon Bridge vault in three calls. Proceeds were swapped to ETH, split across four fresh wallets within seven minutes, then routed through a mixer, a peel chain into two exchanges, a cross-chain bridge and an OTC desk.',
  wallets: [
    { k: 'V', label: 'Halcyon Bridge Vault', category: 'victim', tags: ['Protocol contract', 'Victim'], balanceEth: 212.4, firstSeen: ts('2025-03-02T10:00:00') },
    { k: 'EC', label: 'Exploit contract', category: 'exploit', tags: ['Contract', 'Deployed by exploiter'], balanceEth: 0, firstSeen: ts('2026-09-13T23:30:11') },
    { k: 'E1', label: 'Exploiter EOA', category: 'suspect', tags: ['Exploiter', 'Named in post-mortem'], balanceEth: 76.4, firstSeen: ts('2026-09-11T18:40:22') },
    { k: 'G1', label: 'Gas funder', category: 'suspect', tags: ['Funds fresh wallets'], balanceEth: 0.29, firstSeen: ts('2026-09-13T22:58:40') },
    { k: 'H1', label: 'Hop 1', category: 'intermediary', tags: ['Fresh wallet'], balanceEth: 0, firstSeen: ts('2026-09-13T23:10:05') },
    { k: 'H2', label: 'Hop 2', category: 'intermediary', tags: ['Fresh wallet', 'Mixer depositor'], balanceEth: 0, firstSeen: ts('2026-09-13T23:11:31') },
    { k: 'H3', label: 'Hop 3', category: 'intermediary', tags: ['Fresh wallet', 'Bridge user'], balanceEth: 0, firstSeen: ts('2026-09-13T23:12:50') },
    { k: 'H4', label: 'Hop 4', category: 'intermediary', tags: ['Fresh wallet'], balanceEth: 0, firstSeen: ts('2026-09-13T23:14:02') },
    { k: 'P1', label: 'Peel 1', category: 'intermediary', tags: ['Peel chain'], balanceEth: 0, firstSeen: ts('2026-09-14T03:02:10') },
    { k: 'P2', label: 'Peel 2', category: 'intermediary', tags: ['Peel chain'], balanceEth: 0, firstSeen: ts('2026-09-14T03:20:44') },
    { k: 'P3', label: 'Peel 3', category: 'intermediary', tags: ['Peel chain', 'Named in paste'], balanceEth: 0, firstSeen: ts('2026-09-14T03:44:19') },
    { k: 'C1', label: 'Consolidation wallet', category: 'intermediary', tags: ['Holding funds'], balanceEth: 720, firstSeen: ts('2026-09-14T04:10:33') },
    { k: 'M', label: 'Mixer pool', category: 'mixer', tags: ['Mixing service', 'Fixed denomination'], balanceEth: 18450, firstSeen: ts('2023-06-01T00:00:00'), externalInflowUsd: 44280000 },
    { k: 'D', label: 'DEX aggregator router', category: 'dex', tags: ['Swap router'], balanceEth: 0, firstSeen: ts('2024-01-12T00:00:00'), externalInflowUsd: 950000000 },
    { k: 'BR', label: 'Corridor Bridge deposit', category: 'bridge', tags: ['Cross-chain bridge', 'Exit to Arbitrum'], balanceEth: 9310, firstSeen: ts('2024-08-20T00:00:00'), externalInflowUsd: 61200000 },
    { k: 'X1', label: 'Northgate deposit', category: 'exchange', tags: ['Exchange deposit address', 'Frozen by exchange'], balanceEth: 0, firstSeen: ts('2026-09-14T03:01:00') },
    { k: 'NH', label: 'Northgate hot wallet', category: 'exchange', tags: ['Exchange hot wallet'], balanceEth: 31220, firstSeen: ts('2022-02-01T00:00:00'), externalInflowUsd: 182000000 },
    { k: 'X2', label: 'Kestrel deposit', category: 'exchange', tags: ['Exchange deposit address'], balanceEth: 0, firstSeen: ts('2026-09-14T03:19:00') },
    { k: 'KH', label: 'Kestrel hot wallet', category: 'exchange', tags: ['Exchange hot wallet'], balanceEth: 12880, firstSeen: ts('2021-11-01T00:00:00'), externalInflowUsd: 96000000 },
    { k: 'O1', label: 'OTC desk wallet', category: 'otc', tags: ['OTC desk', 'Named in paste'], balanceEth: 4.1, firstSeen: ts('2025-12-04T00:00:00'), externalInflowUsd: 3100000 },
    { k: 'U1', label: 'Unlabelled recipient', category: 'unknown', tags: [], balanceEth: 5800, firstSeen: ts('2026-09-16T15:00:12') },
    { k: 'DS', label: 'Dust sender', category: 'unknown', tags: ['Address-poisoning dust'], balanceEth: 0.4, firstSeen: ts('2026-08-30T00:00:00') },
    { k: 'LP1', label: 'Liquidity provider', category: 'unknown', tags: ['Normal protocol user'], balanceEth: 3.2, firstSeen: ts('2025-05-11T00:00:00') },
    { k: 'LP2', label: 'Withdrawing user', category: 'unknown', tags: ['Normal protocol user'], balanceEth: 14.0, firstSeen: ts('2025-07-19T00:00:00') },
  ],
  txs: [
    { f: 'M', t: 'E1', asset: 'ETH', amount: 1.0, at: '2026-09-11T18:40:22', m: 'withdraw', note: 'Pre-incident funding withdrawn from mixer' },
    { f: 'LP1', t: 'V', asset: 'ETH', amount: 40, at: '2026-09-13T15:02:00', m: 'deposit' },
    { f: 'V', t: 'LP2', asset: 'ETH', amount: 12, at: '2026-09-13T20:41:00', m: 'withdraw' },
    { f: 'E1', t: 'G1', asset: 'ETH', amount: 0.5, at: '2026-09-13T22:58:40' },
    { f: 'G1', t: 'H1', asset: 'ETH', amount: 0.05, at: '2026-09-13T23:10:05', note: 'Gas top-up' },
    { f: 'G1', t: 'H2', asset: 'ETH', amount: 0.05, at: '2026-09-13T23:11:31', note: 'Gas top-up' },
    { f: 'G1', t: 'H3', asset: 'ETH', amount: 0.05, at: '2026-09-13T23:12:50', note: 'Gas top-up' },
    { f: 'G1', t: 'H4', asset: 'ETH', amount: 0.05, at: '2026-09-13T23:14:02', note: 'Gas top-up' },
    { f: 'E1', t: 'EC', asset: 'ETH', amount: 0, at: '2026-09-13T23:30:11', m: 'contract creation', note: 'Exploit contract deployed' },
    { f: 'V', t: 'EC', asset: 'ETH', amount: 8750, at: '2026-09-14T02:13:07', m: 'executeMessage', note: 'Drain call 1 (forged withdrawal proof)' },
    { f: 'V', t: 'EC', asset: 'USDC', amount: 12940000, at: '2026-09-14T02:13:31', m: 'executeMessage', note: 'Drain call 2' },
    { f: 'V', t: 'EC', asset: 'ETH', amount: 3360, at: '2026-09-14T02:14:02', m: 'executeMessage', note: 'Drain call 3' },
    { f: 'EC', t: 'E1', asset: 'ETH', amount: 12110, at: '2026-09-14T02:14:40', m: 'sweep' },
    { f: 'EC', t: 'E1', asset: 'USDC', amount: 12940000, at: '2026-09-14T02:14:55', m: 'sweep' },
    { f: 'E1', t: 'D', asset: 'USDC', amount: 12940000, at: '2026-09-14T02:21:16', m: 'swap', note: 'USDC sold for ETH' },
    { f: 'D', t: 'E1', asset: 'ETH', amount: 5385.4, at: '2026-09-14T02:21:16', m: 'swap' },
    { f: 'E1', t: 'H1', asset: 'ETH', amount: 4500, at: '2026-09-14T02:34:09' },
    { f: 'E1', t: 'H2', asset: 'ETH', amount: 6300, at: '2026-09-14T02:36:12' },
    { f: 'E1', t: 'H3', asset: 'ETH', amount: 3800, at: '2026-09-14T02:38:55' },
    { f: 'E1', t: 'H4', asset: 'ETH', amount: 2820, at: '2026-09-14T02:41:03' },
    { f: 'H3', t: 'BR', asset: 'ETH', amount: 3800, at: '2026-09-14T02:58:30', m: 'depositFor', note: 'Bridged to Arbitrum' },
    { f: 'H1', t: 'X1', asset: 'ETH', amount: 35, at: '2026-09-14T03:01:00' },
    { f: 'H1', t: 'P1', asset: 'ETH', amount: 4465, at: '2026-09-14T03:02:10' },
    { f: 'H2', t: 'M', asset: 'ETH', amount: 700, at: '2026-09-14T03:05:41', m: 'deposit' },
    { f: 'P1', t: 'X2', asset: 'ETH', amount: 385, at: '2026-09-14T03:19:00' },
    { f: 'P1', t: 'P2', asset: 'ETH', amount: 4080, at: '2026-09-14T03:20:44' },
    { f: 'H2', t: 'M', asset: 'ETH', amount: 700, at: '2026-09-14T03:22:10', m: 'deposit' },
    { f: 'H2', t: 'M', asset: 'ETH', amount: 700, at: '2026-09-14T03:39:58', m: 'deposit' },
    { f: 'P2', t: 'X1', asset: 'ETH', amount: 350, at: '2026-09-14T03:43:02' },
    { f: 'P2', t: 'P3', asset: 'ETH', amount: 3730, at: '2026-09-14T03:44:19' },
    { f: 'X2', t: 'KH', asset: 'ETH', amount: 385, at: '2026-09-14T03:50:27', m: 'sweep' },
    { f: 'H2', t: 'M', asset: 'ETH', amount: 700, at: '2026-09-14T03:58:15', m: 'deposit' },
    { f: 'X1', t: 'NH', asset: 'ETH', amount: 385, at: '2026-09-14T04:00:03', m: 'sweep' },
    { f: 'H4', t: 'C1', asset: 'ETH', amount: 2820, at: '2026-09-14T04:10:33' },
    { f: 'H2', t: 'M', asset: 'ETH', amount: 700, at: '2026-09-14T04:16:40', m: 'deposit' },
    { f: 'H2', t: 'M', asset: 'ETH', amount: 700, at: '2026-09-14T04:35:02', m: 'deposit' },
    { f: 'H2', t: 'M', asset: 'ETH', amount: 700, at: '2026-09-14T04:52:47', m: 'deposit' },
    { f: 'H2', t: 'M', asset: 'ETH', amount: 700, at: '2026-09-14T05:11:20', m: 'deposit' },
    { f: 'H2', t: 'M', asset: 'ETH', amount: 700, at: '2026-09-14T05:40:09', m: 'deposit' },
    { f: 'DS', t: 'E1', asset: 'ETH', amount: 0.0001, at: '2026-09-14T06:02:00', note: 'Dust (address poisoning)' },
    { f: 'DS', t: 'H2', asset: 'ETH', amount: 0.0001, at: '2026-09-14T06:02:24', note: 'Dust (address poisoning)' },
    { f: 'E1', t: 'V', asset: 'ETH', amount: 0, at: '2026-09-15T08:00:31', m: 'message', note: 'On-chain message to protocol (see OSINT)' },
    { f: 'P3', t: 'O1', asset: 'ETH', amount: 3730, at: '2026-09-15T11:20:05' },
    { f: 'C1', t: 'O1', asset: 'ETH', amount: 2100, at: '2026-09-16T09:05:51' },
    { f: 'O1', t: 'U1', asset: 'ETH', amount: 5800, at: '2026-09-16T15:00:12' },
  ],
  osint: [
    {
      id: 'OS-01', title: 'Halcyon incident post-mortem', sourceType: 'Project disclosure', publisher: 'Halcyon Bridge (blog)',
      url: 'https://halcyon-bridge.example/blog/incident-2026-09-14', published: '2026-09-14T09:30:00', collected: '2026-09-14T10:02:00',
      confidence: 'Confirmed', reliability: 'First-party statement from the affected protocol',
      excerpt: 'At 02:13 UTC an attacker submitted forged withdrawal proofs to the vault through a freshly deployed contract ({EC}). The proceeds were swept to {E1}. We are working with exchanges and law enforcement and ask the community not to interact with these addresses.',
      identifiers: [{ type: 'address', value: '{E1}' }, { type: 'address', value: '{EC}' }, { type: 'time', value: '02:13 UTC' }],
      matches: [
        { w: 'E1', reason: 'Exact 40-hex address match in a first-party statement; also the recipient of both sweep transfers from the exploit contract.', identifies: 'Halcyon Bridge attacker (pseudonymous; no real-world identity published)' },
        { w: 'EC', reason: 'Exact address match; on-chain record confirms the contract was created by {E1} at 23:30 UTC on 13 Sep.' },
      ],
      relatedTx: ['T009', 'T010', 'T013'],
    },
    {
      id: 'OS-02', title: 'Researcher thread tracking mixer deposits', sourceType: 'Social media', publisher: '@chainwatch_sam',
      url: 'https://social.example/@chainwatch_sam/status/1834410022', published: '2026-09-14T04:12:00', collected: '2026-09-14T04:40:00',
      confidence: 'Strong', reliability: 'Independent researcher; claim reproduced on-chain',
      excerpt: 'Halcyon exploiter is splitting funds. {H2} received 6,300 ETH from the exploiter and is now pushing 700 ETH chunks into the mixer pool. Three deposits so far. {H3} just bridged 3,800 ETH to Arbitrum.',
      identifiers: [{ type: 'address', value: '{H2}' }, { type: 'address', value: '{H3}' }, { type: 'handle', value: '@chainwatch_sam' }, { type: 'amount', value: '700 ETH' }],
      matches: [
        { w: 'H2', reason: 'Exact address match. Independently verified: nine 700 ETH deposits from this wallet to the mixer pool between 03:05 and 05:40 UTC.' },
        { w: 'H3', reason: 'Exact address match. Verified: 3,800 ETH sent to the Corridor Bridge deposit contract at 02:58 UTC.' },
      ],
      relatedTx: ['T018', 'T024', 'T021'],
    },
    {
      id: 'OS-03', title: 'On-chain message from exploiter', sourceType: 'On-chain data', publisher: 'Transaction input data',
      url: 'https://explorer.example/tx/{T042}', published: '2026-09-15T08:00:31', collected: '2026-09-15T08:15:00',
      confidence: 'Confirmed', reliability: 'Signed by the sending key; cannot be forged by a third party',
      excerpt: 'Decoded input data (UTF-8): "Halcyon team, we are open to returning 90% of funds under a whitehat agreement. Reply on-chain to this address within 72 hours."',
      identifiers: [{ type: 'tx', value: '{T042}' }, { type: 'address', value: '{E1}' }],
      matches: [{ w: 'E1', reason: 'The message transaction was signed and sent by {E1}; sender identity is cryptographically bound to the address.' }],
      relatedTx: ['T042'],
    },
    {
      id: 'OS-04', title: 'Forum post linking gas funder to earlier phishing', sourceType: 'Forum', publisher: 'forum.example user "0xgumshoe"',
      url: 'https://forum.example/t/same-gas-funder-as-2025-drainer/88213', published: '2026-09-14T16:44:00', collected: '2026-09-14T17:10:00',
      confidence: 'Weak', reliability: 'Single anonymous source, not independently verified',
      excerpt: 'The wallet that topped up gas for the four Halcyon hop wallets ({G1}) looks like the same operator behind a 2025 drainer kit. Same gas pattern, same time of day. Not proof, but worth watching.',
      identifiers: [{ type: 'address', value: '{G1}' }],
      matches: [{ w: 'G1', reason: 'Exact address match. The attribution to a 2025 campaign rests on behavioural similarity only and is not treated as evidence of common ownership.', identifies: 'Operator of a 2025 drainer kit (alleged)' }],
      relatedTx: ['T005', 'T006', 'T007', 'T008'],
    },
    {
      id: 'OS-05', title: 'Northgate deposit freeze notice', sourceType: 'Exchange notice', publisher: 'Northgate Exchange status page',
      url: 'https://status.northgate.example/notices/2026-09-14-halcyon', published: '2026-09-14T07:05:00', collected: '2026-09-14T07:30:00',
      confidence: 'Strong', reliability: 'Official notice from the receiving exchange',
      excerpt: 'Northgate has frozen 385 ETH credited to deposit address {X1} following reports that the funds originate from the Halcyon Bridge incident. The account holder has been asked for source-of-funds documentation.',
      identifiers: [{ type: 'address', value: '{X1}' }, { type: 'amount', value: '385 ETH' }],
      matches: [{ w: 'X1', reason: 'Exact address match. On-chain: 35 ETH from Hop 1 and 350 ETH from Peel 2 were credited to this deposit address.', identifies: 'Northgate Exchange deposit address (account holder not disclosed)' }],
      relatedTx: ['T022', 'T029', 'T033'],
    },
    {
      id: 'OS-06', title: 'Anonymous paste listing related addresses', sourceType: 'Paste site', publisher: 'paste.example (anonymous)',
      url: 'https://paste.example/raw/k3Jx91', published: '2026-09-15T22:10:00', collected: '2026-09-16T08:00:00',
      confidence: 'Weak', reliability: 'Anonymous, unverifiable author; content only partly matches chain data',
      excerpt: 'halcyon money ends here -> {P3} -> {O1} (otc). they cash out on tuesday.',
      identifiers: [{ type: 'address', value: '{P3}' }, { type: 'address', value: '{O1}' }],
      matches: [
        { w: 'P3', reason: 'Exact address match. Chain data agrees that 3,730 ETH moved from this wallet to the OTC wallet.' },
        { w: 'O1', reason: 'Exact address match. The "cash out on Tuesday" claim is unverified.', identifies: 'OTC desk (as claimed by an anonymous paste)' },
      ],
      relatedTx: ['T043'],
    },
    {
      id: 'OS-07', title: 'Corridor Bridge relay record', sourceType: 'Bridge explorer', publisher: 'Corridor Bridge explorer',
      url: 'https://corridor-bridge.example/relay/{T021}', published: '2026-09-14T03:04:00', collected: '2026-09-14T11:20:00',
      confidence: 'Strong', reliability: 'Operator-published relay record',
      excerpt: 'Deposit {T021} from {H3}: 3,800 ETH. Destination chain: Arbitrum One. Recipient: 0x7f2c…e91a. Status: delivered 03:03:52 UTC.',
      identifiers: [{ type: 'tx', value: '{T021}' }, { type: 'address', value: '{H3}' }, { type: 'address', value: '0x7f2c…e91a (Arbitrum)' }],
      matches: [{ w: 'H3', reason: 'Sender address in the relay record matches exactly. Funds left Ethereum here; the Arbitrum leg is outside this case scope.' }],
      relatedTx: ['T021'],
    },
  ],
  clusters: [
    {
      id: 'CL-A', name: 'Exploiter-controlled set', members: ['E1', 'G1', 'H1', 'H2', 'H3', 'H4'], confidence: 'Medium',
      method: 'Gas-funding linkage',
      basis: 'The exploiter funded G1, and G1 alone made the first deposit (0.05 ETH gas) into each of H1 to H4 within four minutes. Each hop wallet was then loaded by the exploiter within seven minutes.',
      caveat: 'Gas-funding is a heuristic. A shared funder suggests, but does not prove, common control.',
    },
    {
      id: 'CL-B', name: 'Northgate Exchange', members: ['X1', 'NH'], confidence: 'High',
      method: 'Deposit-address sweep',
      basis: 'X1 forwards its entire balance to the Northgate hot wallet, which is how exchange deposit addresses behave. Corroborated by Northgate\'s freeze notice (OS-05).',
      caveat: 'Identifies the service, not the customer behind the deposit address.',
    },
    {
      id: 'CL-C', name: 'Kestrel Exchange', members: ['X2', 'KH'], confidence: 'High',
      method: 'Deposit-address sweep',
      basis: 'X2 forwards its full 385 ETH balance to the Kestrel hot wallet 31 minutes after receipt.',
      caveat: 'Identifies the service, not the customer behind the deposit address.',
    },
    {
      id: 'CL-D', name: 'Peel chain', members: ['P1', 'P2', 'P3'], confidence: 'Medium',
      method: 'Sequential peel pattern',
      basis: 'Each wallet received one input, peeled a small amount to an exchange deposit, and forwarded more than 90% to a new wallet within 25 minutes.',
      caveat: 'Peel chains are a behavioural pattern. Similar behaviour alone is not proof of common ownership.',
    },
  ],
  initialVisible: ['V', 'EC', 'E1', 'D', 'H1', 'H2', 'H3', 'H4', 'M', 'BR', 'X1', 'P1', 'C1'],
  activity: [
    { at: '2026-09-14T03:05:00', text: 'Case opened from protocol alert', kind: 'case' },
    { at: '2026-09-14T04:40:00', text: 'OSINT finding OS-02 linked to Hop 2 and Hop 3', kind: 'osint' },
    { at: '2026-09-14T07:30:00', text: 'Northgate freeze notice attached (OS-05)', kind: 'osint' },
    { at: '2026-09-15T08:15:00', text: 'On-chain message from exploiter decoded (OS-03)', kind: 'osint' },
    { at: '2026-09-16T15:20:00', text: '5,800 ETH moved from OTC desk to unlabelled wallet', kind: 'tx' },
  ],
}

const drainer = {
  id: 'GT-2026-017',
  title: 'Approval-drainer phishing wave',
  chain: 'Ethereum',
  status: 'Monitoring',
  priority: 'High',
  owner: 'Case team B',
  startBlock: 20902100,
  attackStart: '2026-09-21T14:02:00',
  createdAt: '2026-09-21T16:00:00',
  updatedAt: '2026-09-22T10:12:00',
  seed: 'DC',
  primarySuspect: 'DO',
  taintSources: ['VA', 'VB', 'VC'],
  summary:
    'Three victims signed malicious token approvals on a fake mint page. A drainer contract pulled their funds and split each haul 80/20 between an operator wallet and an affiliate wallet. The operator consolidated and sent part to an exchange deposit.',
  wallets: [
    { k: 'VA', label: 'Victim A', category: 'victim', tags: ['Victim'], balanceEth: 0.02, firstSeen: ts('2023-04-01T00:00:00') },
    { k: 'VB', label: 'Victim B', category: 'victim', tags: ['Victim'], balanceEth: 0.11, firstSeen: ts('2022-10-11T00:00:00') },
    { k: 'VC', label: 'Victim C', category: 'victim', tags: ['Victim'], balanceEth: 0.4, firstSeen: ts('2024-02-17T00:00:00') },
    { k: 'DC', label: 'Drainer contract', category: 'exploit', tags: ['Drainer kit contract'], balanceEth: 0, firstSeen: ts('2026-09-20T09:12:00') },
    { k: 'DO', label: 'Drainer operator', category: 'suspect', tags: ['Receives 80% split'], balanceEth: 12.3, firstSeen: ts('2026-09-19T21:00:00') },
    { k: 'AF', label: 'Affiliate wallet', category: 'suspect', tags: ['Receives 20% split'], balanceEth: 7.85, firstSeen: ts('2026-09-20T09:40:00') },
    { k: 'CO', label: 'Operator consolidation', category: 'intermediary', tags: [], balanceEth: 0, firstSeen: ts('2026-09-21T18:30:00') },
    { k: 'XE', label: 'Kestrel deposit', category: 'exchange', tags: ['Exchange deposit address'], balanceEth: 0, firstSeen: ts('2026-09-22T09:00:00') },
  ],
  txs: [
    { f: 'VA', t: 'DC', asset: 'USDC', amount: 18400, at: '2026-09-21T14:02:00', m: 'transferFrom', note: 'Approval abused' },
    { f: 'DC', t: 'DO', asset: 'USDC', amount: 14720, at: '2026-09-21T14:02:00', m: 'split' },
    { f: 'DC', t: 'AF', asset: 'USDC', amount: 3680, at: '2026-09-21T14:02:00', m: 'split' },
    { f: 'VB', t: 'DC', asset: 'ETH', amount: 9.6, at: '2026-09-21T15:47:12', m: 'transferFrom', note: 'WETH approval abused' },
    { f: 'DC', t: 'DO', asset: 'ETH', amount: 7.68, at: '2026-09-21T15:47:12', m: 'split' },
    { f: 'DC', t: 'AF', asset: 'ETH', amount: 1.92, at: '2026-09-21T15:47:12', m: 'split' },
    { f: 'VC', t: 'DC', asset: 'ETH', amount: 31.0, at: '2026-09-21T17:25:40', m: 'transferFrom', note: 'WETH approval abused' },
    { f: 'DC', t: 'DO', asset: 'ETH', amount: 24.8, at: '2026-09-21T17:25:40', m: 'split' },
    { f: 'DC', t: 'AF', asset: 'ETH', amount: 6.2, at: '2026-09-21T17:25:40', m: 'split' },
    { f: 'DO', t: 'CO', asset: 'ETH', amount: 20.0, at: '2026-09-21T18:30:00' },
    { f: 'CO', t: 'XE', asset: 'ETH', amount: 20.0, at: '2026-09-22T09:00:00' },
  ],
  osint: [
    {
      id: 'OS-11', title: 'Phishing domain report', sourceType: 'Threat feed', publisher: 'phish-reports.example',
      url: 'https://phish-reports.example/entry/55120', published: '2026-09-21T15:10:00', collected: '2026-09-21T16:05:00',
      confidence: 'Strong', reliability: 'Community-reviewed feed; contract address verified on-chain',
      excerpt: 'Fake mint page "free-mint-pass.example" requests setApprovalForAll and token approvals to {DC}. Reported by two users.',
      identifiers: [{ type: 'address', value: '{DC}' }, { type: 'domain', value: 'free-mint-pass.example' }],
      matches: [{ w: 'DC', reason: 'Exact address match. All three victim losses were pulled by this contract.' }],
      relatedTx: ['T001', 'T004', 'T007'],
    },
    {
      id: 'OS-12', title: 'Victim report on social media', sourceType: 'Social media', publisher: '@victim_c',
      url: 'https://social.example/@victim_c/status/1837700112', published: '2026-09-21T17:40:00', collected: '2026-09-21T18:00:00',
      confidence: 'Strong', reliability: 'Victim statement consistent with chain data',
      excerpt: 'Lost 31 ETH after signing on a mint site. Funds went to {DC} and were split instantly to {DO} and {AF}.',
      identifiers: [{ type: 'address', value: '{DC}' }, { type: 'address', value: '{DO}' }, { type: 'address', value: '{AF}' }],
      matches: [
        { w: 'DO', reason: 'Exact address match; receives 80% of every drained amount.' },
        { w: 'AF', reason: 'Exact address match; receives 20% of every drained amount.' },
      ],
      relatedTx: ['T008', 'T009'],
    },
  ],
  clusters: [
    {
      id: 'CL-E', name: 'Drainer split recipients', members: ['DO', 'AF'], confidence: 'Medium',
      method: 'Fixed-ratio split from one contract',
      basis: 'Every drained amount is split 80/20 between the same two wallets in the same transaction.',
      caveat: 'Drainer kits pay affiliates by design. The operator and the affiliate are likely different parties.',
    },
  ],
  initialVisible: ['VA', 'VB', 'VC', 'DC', 'DO', 'AF', 'CO'],
  activity: [
    { at: '2026-09-21T16:00:00', text: 'Case opened from phishing feed match', kind: 'case' },
    { at: '2026-09-22T09:00:00', text: '20 ETH reached a Kestrel deposit address', kind: 'tx' },
  ],
}

export const SAMPLE_CASES = [build(halcyon), build(drainer)]
export { ETH_USD }
