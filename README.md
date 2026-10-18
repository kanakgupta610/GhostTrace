# GhostTrace

Blockchain fund-tracing and investigation platform. React + Vite, Cytoscape.js (graph), Recharts (analytics), Lucide React (icons), jsPDF (reports).

## Just want to see it?

Double-click **GhostTrace-standalone.html**. It is the complete app in one file and works offline.

The `index.html` in this folder is the Vite source entry and only works through `npm run dev`; opening it directly shows a blank page.

## Run

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # multi-file production build in dist/ (deploy to Vercel, Netlify, S3…)
npx vite build --mode single     # one self-contained dist-single/index.html (~2.6 MB)
npx vite build --mode artifact   # small single page; React, Cytoscape, Recharts, jsPDF load from jsDelivr
```

## Structure

| Path | What it is |
| --- | --- |
| `src/data/cases.js` | **Sample dataset.** Two fictional cases (Halcyon Bridge exploit, approval-drainer wave). Addresses and hashes are generated from fixed seeds; source URLs use the reserved `.example` domain. |
| `src/lib/analysis.js` | Analysis engine: haircut taint propagation, hop distance, risk scoring (factor by factor), pattern detection, timing stats, time-ordered path tracing. Nothing is hard-coded per wallet. |
| `src/lib/report.js` | Report model shared by the on-screen preview and the PDF export. |
| `src/store.jsx` | App state: cases, selection, graph visibility/filters/highlights, journey progress, refresh from a data source. |
| `src/components/GraphCanvas.jsx` | Cytoscape graph (dagre left-to-right layout, clusters as compound nodes). |
| `src/components/Inspector.jsx` | Wallet and transfer side panel. |
| `src/sections/*` | Overview, Investigations, Transaction Graph, OSINT Evidence, Risk Analytics, Reports. |

## Supabase

On start the app reads every `is_sample = true` case from Supabase (`src/lib/supabaseData.js`) with the publishable key in `.env`. A database copy of a bundled sample case replaces it; if Supabase is unreachable or empty, the bundled cases in `src/data/cases.js` are shown. **Refresh** (with no custom URL) reloads from Supabase.

```sh
node import-sample-data.js --dry-run                         # validate rows, compare with the DB, write nothing
SUPABASE_SECRET_KEY=sb_secret_... node import-sample-data.js # upsert both sample cases (rerunnable, no duplicates)
```

Row ids are deterministic UUIDs (`src/lib/supabaseMapping.js`), so reruns update the same rows. Only the sample cases' own rows are written; `--prune` additionally deletes rows inside those cases that are no longer in the dataset. The secret key is only for this Node script: keep it in `.env.local` or the shell, never in a `VITE_` variable. `supabase/rls-policies.sql` sets read-only public access limited to sample cases.

Cluster membership is stored in `wallet_cluster_members` (created by `supabase/cluster-members.sql`: unique cluster/wallet pairs, a trigger that keeps cluster and wallet in the same case, sample-only public reads). Until that table exists, the loader falls back to the bundled membership. Run `cluster-members.sql` before `seed-sample-data.sql`.

The schema has no columns for some case-model fields (case owner/activity, wallet tags/balances, transfer method/block, OSINT source type/reliability, cluster confidence/caveat). For sample cases these come from the bundled record; the database is authoritative for everything it stores.

## Live Ethereum data

`server/` is a small Node backend (no extra dependencies) that returns real Ethereum mainnet transfers for an address in the case shape below.

```sh
npm run server     # http://localhost:8787/api  (GET /health, /wallets/{address}, /cases/{id}?seed={address})
npm test           # backend tests (mocked upstream, no network)
```

- **Provider:** Blockscout's Etherscan-compatible API. Without a key its quota is tiny (about 10 requests per 15 minutes; one lookup uses 3–4). For regular use put a free key in `.env.local` (server side, never `VITE_`): `ETHERSCAN_API_KEY=...` (Etherscan V2, preferred) or `BLOCKSCOUT_API_KEY=...`, then restart the server.
- **What is returned:** normal transactions, ERC-20 transfers and internal ETH transfers (most recent 1000 of each), failed transactions excluded. No labels, categories, clusters or OSINT are inferred. USD values are estimates: ETH/WETH at the current ETH price, USDC/USDT/DAI at $1 (matched by contract address), other tokens unpriced. Every transfer's source text says it is a live record, which provider served it and how USD was estimated.
- **In the app:** Settings → Backend base URL `http://localhost:8787/api`, create a case from a real address (Cases → New case), press **Refresh**. Sample cases are never refreshed from a live source.

## Evidence, cross-chain checks and pricing

- **Manual evidence:** OSINT Evidence → *Add Evidence* (also from the wallet inspector). Saved through `POST /api/evidence`, validated on the server, deduplicated and labelled "Manually entered".
- **Write access:** adding or removing evidence requires `EVIDENCE_WRITE_TOKEN` (24+ characters) in `.env.local`. Investigators enter it once in the form; it stays in that browser and is sent as `Authorization: Bearer`. Without it, evidence writes are disabled.
- **Older local evidence:** `npm run migrate-evidence` (dry run), then `npm run migrate-evidence -- --apply` inserts local records missing from Supabase; it never overwrites, deletes or modifies the local file. `--skip-manual` leaves manual entries out.
- **Smoke test:** with the app and backend running, `npm run smoke` (sample path) or `npm run smoke -- --live 0x…` checks cases, graph, ledger, OSINT Evidence and PDF export in headless Chrome.
- **Storage:** with `SUPABASE_SECRET_KEY` in `.env.local` (server only, never `VITE_`) and `supabase/evidence-records.sql` applied, manual and external evidence persist in the `evidence_records` table. RLS gives the publishable key no access to it. Without the key, evidence is saved to `server/data/evidence-store.json`; `/api/health` reports which is in use.
- **Cross-chain:** Risk → Bridges & mixers → *Check destination chain* (`GET /api/bridge-trace?tx=`). Ethereum → OP Mainnet ETH deposits through the standard bridge are matched by exact amount, recipient and the L2 standard-bridge sender within 60 minutes. Base needs `ETHERSCAN_API_KEY`; other bridges are reported as unconfirmed.
- **Pricing:** live ETH/WETH values use DefiLlama's daily close for the transfer day. Any value at today's price is marked "≈ today" and counted in the ledger note.

## Connecting a backend

Settings (gear icon) → Backend base URL. **Refresh** calls `GET {base}/cases/{caseId}` and expects JSON in the same shape as a case in `src/data/cases.js` after `build()`:

```json
{
  "wallets": [{ "address": "0x…", "label": "…", "category": "suspect|intermediary|mixer|exchange|bridge|dex|otc|victim|exploit|unknown", "chain": "Ethereum", "tags": [], "balanceEth": 0, "firstSeen": 1757816000000, "externalInflowUsd": 0 }],
  "txs": [{ "id": "…", "hash": "0x…", "from": "0x…", "to": "0x…", "asset": "ETH", "amount": 1.5, "usd": 3600, "ts": 1757816000000, "block": 1, "method": "transfer", "source": "…" }],
  "osint": [], "clusters": []
}
```

The whole UI (risk scores, patterns, charts, report) recomputes from whatever the endpoint returns.

## Scoring indicators

Incident share (≤30), proximity to primary suspect (15/12/8/5/2), mixer category (30), mixer interaction (15), fixed-denomination deposits (8), rapid forwarding (10), fan-out (8), peel-chain step (8), fresh wallet (6), bridge exit (6), exchange cash-out (4), OSINT match (15/10/4). Capped at 100. Bands: 70+ high, 40–69 elevated, 15–39 low.
