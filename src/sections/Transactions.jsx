import { useMemo, useState } from 'react'
import { Download, Search, Waypoints } from 'lucide-react'
import { useApp } from '../store.jsx'
import { CatDot, CopyBtn, useSort, Term } from '../components/common.jsx'
import { Decode } from '../components/Motion.jsx'
import { fmtAmt, fmtUsdShort, short, DUST_USD } from '../lib/analysis.js'
import { fmtTime, saveFile } from '../lib/util.js'

// Every transfer in the case, on its own page so the graph stays uncluttered.
export default function Transactions() {
  const { active: c, analysis, selection, openCase, setSelection, notify } = useApp()
  const [q, setQ] = useState('')
  const [asset, setAsset] = useState('All')
  const [stolenOnly, setStolenOnly] = useState(false)
  const [wallet, setWallet] = useState(selection?.type === 'wallet' ? selection.id : '')
  const name = (a) => analysis.idx.byAddr.get(a)?.label || short(a)
  const assets = ['All', ...new Set(c.txs.map((t) => t.asset))]

  const rows = useMemo(() => c.txs
    .filter((t) => t.usd >= DUST_USD || t.method === 'contract creation' || t.method === 'message')
    .filter((t) => asset === 'All' || t.asset === asset)
    .filter((t) => !stolenOnly || (analysis.taint.edgeTaint.get(t.id) || 0) > 0)
    .filter((t) => !wallet || t.from === wallet || t.to === wallet)
    .filter((t) => !q || [t.hash, t.from, t.to, name(t.from), name(t.to), t.method].some((s) => s.toLowerCase().includes(q.toLowerCase())))
    .map((t) => ({ ...t, fromName: name(t.from), toName: name(t.to), taint: analysis.taint.edgeTaint.get(t.id) || 0 })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [c, analysis, q, asset, stolenOnly, wallet])
  const { sorted, th } = useSort(rows, { key: 'ts', dir: 'asc' })
  const total = rows.reduce((s, t) => s + t.usd, 0)

  const exportCsv = async () => {
    const head = 'id,hash,timestamp_utc,from,from_label,to,to_label,asset,amount,usd,price_basis,method,incident_share'
    const lines = sorted.map((t) => [t.id, t.hash, new Date(t.ts).toISOString(), t.from, t.fromName, t.to, t.toName, t.asset, t.amount, t.usd.toFixed(2), t.priceBasis || (c.sample ? 'sample-reference' : 'source'), t.method, t.taint.toFixed(4)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const r = await saveFile(`${c.id}-transfers.csv`, new Blob([[head, ...lines].join('\n')], { type: 'text/csv' }))
    notify(r.msg, r.ok ? 'ok' : 'warn')
  }
  const open = (t) => { openCase(c.id, 'graph'); setTimeout(() => setSelection({ type: 'tx', id: t.id, focus: true }), 0) }

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div><div className="eyebrow">Investigate · {c.id}</div><h1>Every <em><Decode text="transfer" delay={0.25} /></em></h1>
          <p>All transfers in this case, in time order. Click a row to see it on the graph.</p></div>
        <button className="btn" onClick={exportCsv}><Download size={14} />Export CSV</button>
      </div>

      <div className="filterbar">
        <div className="search" style={{ maxWidth: 320 }}><Search size={15} /><input id="tx-q" placeholder="Search address, wallet, hash" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input" style={{ width: 210 }} value={wallet} onChange={(e) => setWallet(e.target.value)} aria-label="Filter by wallet">
          <option value="">All wallets</option>
          {c.wallets.map((w) => <option key={w.address} value={w.address}>{w.label}</option>)}
        </select>
        <div className="chips">{assets.map((a) => <button key={a} className={`chip ${asset === a ? 'on' : ''}`} onClick={() => setAsset(a)}>{a}</button>)}</div>
        <label className="check"><input type="checkbox" checked={stolenOnly} onChange={(e) => setStolenOnly(e.target.checked)} />Only <Term k="incident">stolen funds</Term></label>
        <span className="dim filter-sum">{rows.length} transfers · {fmtUsdShort(total)}</span>
      </div>
      <PriceBasisNote c={c} />

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <table className="t t-roomy">
            <thead><tr>{th('ts', 'Time (UTC)')}{th('fromName', 'From')}{th('toName', 'To')}{th('amount', 'Amount', 'r')}{th('usd', 'Value', 'r')}{th('taint', <span className="term" data-tip="Share of the transfer that traces back to the stolen funds">Stolen share</span>, 'r')}<th>Hash</th><th /></tr></thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id} onClick={() => open(t)} className={selection?.id === t.id ? 'sel' : ''}>
                  <td className="mono">{fmtTime(t.ts).replace(' UTC', '').replace(/ \d{4},/, ',')}</td>
                  <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><CatDot cat={analysis.idx.byAddr.get(t.from)?.category} />{t.fromName}</span></td>
                  <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><CatDot cat={analysis.idx.byAddr.get(t.to)?.category} />{t.toName}</span></td>
                  <td className="r num"><b>{fmtAmt(t.amount)}</b> <span className="dim">{t.asset}</span></td>
                  <td className="r num" title={BASIS_TIP[t.priceBasis] || ''}>{t.priceBasis === 'current' ? <>≈{fmtUsdShort(t.usd)} <span className="dim" style={{ fontSize: 10.5 }}>today</span></> : fmtUsdShort(t.usd)}</td>
                  <td className="r num" style={{ color: t.taint > 0.5 ? 'var(--copper)' : 'var(--text-3)' }}>{t.taint > 0 ? `${(t.taint * 100).toFixed(0)}%` : '—'}</td>
                  <td className="mono dim">{short(t.hash, 8)}<CopyBtn text={t.hash} label="Copy hash" /></td>
                  <td className="r"><Waypoints size={14} className="row-go" /></td>
                </tr>
              ))}
              {!sorted.length && <tr><td colSpan={8} className="empty">No transfers match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const BASIS_TIP = {
  historical: 'USD at the daily ETH price on the day of the transfer',
  current: "Estimated at TODAY'S ETH price, not the price on the day of the transfer",
  stablecoin: 'Stablecoin assumed at $1',
  unpriced: 'No USD price available for this asset',
}

// Says how the Value column was priced, so today's price is never shown as a historical value.
function PriceBasisNote({ c }) {
  if (c.sample) return <div className="note" style={{ fontSize: 12, marginBottom: 12 }}>Values use the sample dataset's fixed reference price (ETH = $2,400, stablecoins = $1). The data is fictional.</div>
  const n = c.txs.reduce((m, t) => ((m[t.priceBasis || 'none'] = (m[t.priceBasis || 'none'] || 0) + 1), m), {})
  if (!c.txs.length || n.none === c.txs.length) return null
  const parts = [n.historical && `${n.historical} at the daily ETH price on the day of transfer`, n.current && `${n.current} at TODAY'S ETH price (marked ≈ today)`, n.stablecoin && `${n.stablecoin} stablecoin transfers at $1`, n.unpriced && `${n.unpriced} unpriced`].filter(Boolean)
  return <div className={`note ${n.current ? 'warn' : ''}`} style={{ fontSize: 12, marginBottom: 12 }}>USD values: {parts.join(' · ')}.{n.historical ? ' Historical prices are daily closes from DefiLlama.' : ''}</div>
}
