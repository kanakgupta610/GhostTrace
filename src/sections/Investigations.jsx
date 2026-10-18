import { useState } from 'react'
import { Plus, Trash2, Send, Waypoints, ArrowLeft, ArrowRight } from 'lucide-react'
import { useApp } from '../store.jsx'
import { Decode } from '../components/Motion.jsx'
import { CatDot, Risk, Modal } from '../components/common.jsx'
import { fmtUsdShort, short } from '../lib/analysis.js'
import { fmtTime, fmtDay, isAddress } from '../lib/util.js'

const STATUSES = ['Active', 'Monitoring', 'Escalated', 'Closed']

export default function Investigations() {
  const { cases, active, analysisFor, openCase, setActiveId, setStatus, addNote, deleteCase, sub, setSub } = useApp()
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState('')
  const c = active
  const a = analysisFor(c)
  const stolen = c.txs.filter((t) => c.taintSources.includes(t.from) && t.ts >= c.attackStart).reduce((s, t) => s + t.usd, 0)
  const suspects = c.wallets.map((w) => ({ w, r: a.risk.get(w.address) })).filter((x) => x.r.score != null).sort((x, y) => y.r.score - x.r.score).slice(0, 5)
  const seedW = a.idx.byAddr.get(c.seed)

  if (sub === 'detail') return (
    <div className="page page-narrow">
      <button className="back" onClick={() => setSub(null)}><ArrowLeft size={15} />All cases</button>
      <div className="page-head">
        <div><div className="eyebrow">{c.id}{c.sample ? ' · sample data' : ''}</div><h1>{c.title}</h1><p>{c.summary}</p></div>
        <div className="row">
          <select id="case-status" className="input" style={{ width: 150 }} value={c.status} onChange={(e) => setStatus(c.id, e.target.value)} aria-label="Case status">
            {STATUSES.map((st) => <option key={st}>{st}</option>)}
          </select>
          <button className="btn primary" onClick={() => openCase(c.id, 'graph')}><Waypoints size={14} />Open graph</button>
        </div>
      </div>
      <div className="stat-row">
        <div><span className="eyebrow">Stolen</span><b>{stolen ? fmtUsdShort(stolen) : '—'}</b></div>
        <div><span className="eyebrow">Incident start</span><b>{c.txs.length ? fmtTime(c.attackStart, false).replace(' UTC', '') : '—'}</b></div>
        <div><span className="eyebrow">Wallets</span><b>{c.wallets.length}</b></div>
        <div><span className="eyebrow">Owner</span><b>{c.owner}</b></div>
      </div>
      <div className="grid g-2">
        <div className="card">
          <div className="card-h"><h2>Highest-risk wallets</h2></div>
          <div className="card-b mini-list">
            {suspects.map(({ w, r }) => (
              <div className="mini-row roomy" key={w.address}><CatDot cat={w.category} /><button className="linkish grow" onClick={() => openCase(c.id, 'graph', w.address)}>{w.label}</button><Risk r={r} /></div>
            ))}
            {!suspects.length && <span className="dim">No scored wallets yet.</span>}
            <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>Seed wallet: {seedW?.label} · <span className="mono">{short(c.seed, 8)}</span></div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Case log</h2></div>
          <div className="card-b stack">
            <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (note.trim()) { addNote(c.id, note.trim()); setNote('') } }}>
              <input id="case-note" className="input" placeholder="Add a note to this case" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn" type="submit" disabled={!note.trim()}><Send size={14} />Add</button>
            </form>
            <div className="timeline">
              {c.activity.slice(0, 8).map((e, i) => (
                <div key={i} className={`tl-item ${e.kind === 'tx' ? 'copper' : ''}`}>
                  <div>{e.text}</div><div className="dim mono" style={{ fontSize: 11 }}>{fmtTime(e.ts, false)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {c.userCreated && <div><button className="btn ghost" onClick={() => { deleteCase(c.id); setSub(null) }}><Trash2 size={14} />Delete this case</button></div>}
    </div>
  )

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div><div className="eyebrow">Case</div><h1>Your <em><Decode text="cases" delay={0.25} /></em></h1><p>Pick a case to see its summary and log, or start a new one from a wallet address.</p></div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} />New investigation</button>
      </div>
      <div className="case-grid">
        {cases.map((x) => {
          const ax = analysisFor(x)
          const st = x.txs.filter((t) => x.taintSources.includes(t.from) && t.ts >= x.attackStart).reduce((q, t) => q + t.usd, 0)
          const top = x.wallets.map((w) => ax.risk.get(w.address)).filter((r) => r.score != null).sort((p, q) => q.score - p.score)[0]
          return (
            <button key={x.id} className={`card case-card ${x.id === c.id ? 'current' : ''}`} onClick={() => { setActiveId(x.id); setSub('detail') }}>
              <div className="spread"><span className="mono dim">{x.id}</span><span className={`pill ${x.status === 'Active' ? 'copper' : x.status === 'Monitoring' ? 'teal' : x.status === 'Escalated' ? 'lilac' : ''}`}>{x.status}</span></div>
              <h2>{x.title}</h2>
              <div className="case-nums">
                <div><b>{st ? fmtUsdShort(st) : '—'}</b><span>stolen</span></div>
                <div><b>{x.wallets.length}</b><span>wallets</span></div>
                <div>{top ? <Risk r={top} /> : <b>—</b>}<span>top risk</span></div>
              </div>
              <span className="dim case-foot">{x.sample ? 'Sample data' : 'Created by you'} · updated {fmtDay(x.updatedAt)}<ArrowRight size={14} /></span>
            </button>
          )
        })}
      </div>
      {creating && <CreateCase onClose={() => setCreating(false)} />}
    </div>
  )
}

export function CreateCase({ onClose, initialAddress = '' }) {
  const { createCase, cases } = useApp()
  const [form, setForm] = useState({ title: '', chain: 'Ethereum', seed: initialAddress, notes: '' })
  const valid = isAddress(form.seed)
  const known = valid && cases.some((c) => c.wallets.some((w) => w.address.toLowerCase() === form.seed.trim().toLowerCase()))
  const examples = cases.slice(0, 2).map((c) => c.wallets.find((w) => w.category === 'suspect'))
  return (
    <Modal title="New investigation" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (valid) { createCase({ ...form, seed: form.seed.trim() }); onClose() } }}>
        <div className="field"><label htmlFor="nc-title">Case name</label><input id="nc-title" className="input" placeholder="e.g. Suspected drainer affiliate" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div className="field">
          <label htmlFor="nc-seed">Seed wallet address <span className="dim">{form.seed && (valid ? (known ? 'Found in loaded data' : 'Valid address, no data loaded') : 'Must be 0x followed by 40 hex characters')}</span></label>
          <input id="nc-seed" className="input mono" placeholder="0x…" value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })} autoFocus />
          <div className="chips">{examples.filter(Boolean).map((w) => <button type="button" key={w.address} className="chip" onClick={() => setForm({ ...form, seed: w.address, title: form.title || `Follow-up on ${w.label}` })}>Use {w.label}</button>)}</div>
        </div>
        <div className="field"><label htmlFor="nc-chain">Chain</label>
          <select id="nc-chain" className="input" value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })}>{['Ethereum', 'Arbitrum', 'Base', 'BNB Chain', 'Polygon'].map((x) => <option key={x}>{x}</option>)}</select>
        </div>
        <div className="field"><label htmlFor="nc-notes">Notes</label><textarea id="nc-notes" className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What prompted this investigation?" /></div>
        <div className="note">{known ? 'This address appears in a loaded case. Its wallets within two hops will be imported into the new case.' : 'Addresses not in the loaded data start as an empty case. Transfers load when a data source is connected.'}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!valid}><Plus size={14} />Create case</button></div>
      </form>
    </Modal>
  )
}
