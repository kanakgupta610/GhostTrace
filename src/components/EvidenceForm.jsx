import { useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { useApp } from '../store.jsx'
import { Modal } from './common.jsx'
import { short } from '../lib/analysis.js'

const EVIDENCE_TYPES = ['Exchange notice', 'Project disclosure', 'Law-enforcement notice', 'News article', 'Social media', 'Forum post', 'On-chain observation', 'Investigator note', 'Other']
const VERIFICATION = ['Unverified', 'Corroborated by a second source', 'Verified by the investigator']

// Manual evidence entry (opened from the OSINT Evidence page, the wallet inspector or the graph).
// Validated here for quick feedback and again on the server.
export default function EvidenceForm({ onClose, initialCase, initialWallet = '' }) {
  const { active, cases, addEvidence, notify, evidenceState, evidenceApi, writeToken, setWriteToken } = useApp()
  const [token, setToken] = useState('')
  const [editToken, setEditToken] = useState(!writeToken)
  const startCase = cases.find((x) => x.id === initialCase) || active
  const knownWallet = startCase.wallets.some((w) => w.address === initialWallet)
  const [f, setF] = useState({ caseRef: startCase.id, wallet: initialWallet ? (knownWallet ? initialWallet : '__other') : '', customWallet: knownWallet ? '' : initialWallet, title: '', description: '', url: '', evidenceType: 'Investigator note', verification: 'Unverified' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const c = cases.find((x) => x.id === f.caseRef) || active
  const wallet = f.wallet === '__other' ? f.customWallet.trim() : f.wallet
  const storage = evidenceState[f.caseRef]?.storage || evidenceState[active.id]?.storage
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); setMsg(null) }
  const check = () => {
    const e = {}
    if (f.title.trim().length < 3 || f.title.trim().length > 160) e.title = 'Title must be 3 to 160 characters.'
    if (f.description.trim().length < 10 || f.description.trim().length > 4000) e.description = 'Description must be 10 to 4,000 characters.'
    if (f.url.trim() && !/^https?:\/\/[^\s]+$/i.test(f.url.trim())) e.url = 'Use a full http(s) address, or leave it empty.'
    if (wallet && !/^0x[0-9a-fA-F]{40}$/.test(wallet)) e.wallet = 'Wallet must be 0x followed by 40 hex characters.'
    if (editToken && token.trim().length < 24) e.token = 'Enter the investigator write token (24+ characters) from the server configuration.'
    return e
  }
  const submit = async (ev) => {
    ev.preventDefault()
    const e = check(); setErrors(e)
    if (Object.keys(e).length) { setMsg({ tone: 'warn', text: 'Please correct the highlighted fields.' }); return }
    setBusy(true); setMsg(null)
    const r = await addEvidence({ caseRef: f.caseRef, wallet, title: f.title.trim(), description: f.description.trim(), url: f.url.trim(), evidenceType: f.evidenceType, verification: f.verification }, editToken ? token.trim() : writeToken)
    setBusy(false)
    if (r.ok) { notify(`Evidence ${r.finding.id} saved to ${r.storage?.backend === 'supabase' ? 'Supabase' : 'the server\'s local store'} and labelled "Manually entered".`, 'ok'); onClose(); return }
    if (r.fields) setErrors(Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k === 'caseRef' ? 'caseRef' : k, v])))
    if (r.auth) { setEditToken(true); setToken('') }
    setMsg({ tone: 'warn', text: r.duplicate ? `${r.error} Nothing was added.` : `Not saved: ${r.error}` })
  }
  const Err = ({ k }) => (errors[k] ? <div className="dim" style={{ color: 'var(--copper)', fontSize: 12 }}>{errors[k]}</div> : null)
  return (
    <Modal title="Add evidence manually" onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="ev-case">Case</label>
          <select id="ev-case" className="input" value={f.caseRef} onChange={(e) => setF({ ...f, caseRef: e.target.value, wallet: '' })}>{cases.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.title}{x.sample ? ' (fictional sample)' : x.live ? ' (live)' : ''}</option>)}</select><Err k="caseRef" /></div>
        <div className="field"><label htmlFor="ev-wallet">Associated wallet</label>
          <select id="ev-wallet" className="input" value={f.wallet} onChange={set('wallet')}>
            <option value="">Not linked to a specific wallet</option>
            {c.wallets.slice(0, 400).map((w) => <option key={w.address} value={w.address}>{w.label} · {short(w.address)}</option>)}
            <option value="__other">Another address…</option>
          </select>
          {f.wallet === '__other' && <input className="input mono" placeholder="0x…" value={f.customWallet} onChange={set('customWallet')} style={{ marginTop: 6 }} aria-label="Wallet address" />}<Err k="wallet" /></div>
        <div className="field"><label htmlFor="ev-title">Title</label><input id="ev-title" className="input" placeholder="e.g. Exchange confirmed the deposit was frozen" value={f.title} onChange={set('title')} maxLength={160} /><Err k="title" /></div>
        <div className="field"><label htmlFor="ev-desc">Description</label><textarea id="ev-desc" className="input" rows={4} placeholder="What the evidence says, where it came from and how it links to the wallet." value={f.description} onChange={set('description')} maxLength={4000} /><Err k="description" /></div>
        <div className="field"><label htmlFor="ev-url">Source URL <span className="dim">optional</span></label><input id="ev-url" className="input mono" placeholder="https://…" value={f.url} onChange={set('url')} /><Err k="url" /></div>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ev-type">Evidence type</label><select id="ev-type" className="input" value={f.evidenceType} onChange={set('evidenceType')}>{EVIDENCE_TYPES.map((x) => <option key={x}>{x}</option>)}</select><Err k="evidenceType" /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ev-ver">Verification status</label><select id="ev-ver" className="input" value={f.verification} onChange={set('verification')}>{VERIFICATION.map((x) => <option key={x}>{x}</option>)}</select><Err k="verification" /></div>
        </div>
        {editToken ? (
          <div className="field"><label htmlFor="ev-token">Investigator write token</label>
            <input id="ev-token" type="password" autoComplete="off" className="input mono" placeholder="EVIDENCE_WRITE_TOKEN from the server's .env.local" value={token} onChange={(e) => { setToken(e.target.value); setErrors({ ...errors, token: undefined }) }} />
            <div className="dim" style={{ fontSize: 12 }}>Required to add or remove evidence. Kept only in this browser after a successful save.</div><Err k="token" /></div>
        ) : (
          <div className="dim" style={{ fontSize: 12 }}>Write token saved in this browser. <button type="button" className="linkish" onClick={() => setEditToken(true)}>Change</button> · <button type="button" className="linkish" onClick={() => { setWriteToken(''); setEditToken(true) }}>Forget</button></div>
        )}
        <div className="note" style={{ fontSize: 12 }}>Saved entries are labelled "Manually entered" everywhere. Unverified entries count as weak evidence in risk scoring; entries never create an identity match.
          {storage ? ` Storage: ${storage.detail}` : evidenceApi ? '' : ' No evidence backend is configured.'}</div>
        {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}Save evidence</button></div>
      </form>
    </Modal>
  )
}
