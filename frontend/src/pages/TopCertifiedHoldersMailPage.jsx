import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import apiUrl from '../api'
import '../top-certified-holders-mail.css'

export default function TopCertifiedHoldersMailPage() {
  const { notify, runWithLoader } = useOutletContext()
  const [holders, setHolders] = useState([])
  const [period, setPeriod] = useState('month')
  const [groupEmail, setGroupEmail] = useState('')
  const [subject, setSubject] = useState('Celebrating our Top 5 Certified Holders')
  const [message, setMessage] = useState('Congratulations to our Top 5 certified holders. Thank you for your commitment to learning, excellence, and professional growth.')

  useEffect(() => {
    fetch(`${apiUrl}/top-certified-holders?period=${period}`, { cache: 'no-store' })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.detail); return result })
      .then((result) => setHolders(result.holders || []))
      .catch((error) => notify(error.message || 'Unable to load the Top 5 holders'))
  }, [notify, period])

  const send = async () => {
    if (!groupEmail.trim()) return notify('Enter your company group email address')
    try {
      const response = await runWithLoader('Sending recognition email', () => fetch(`${apiUrl}/top-certified-holders/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_email: groupEmail, holder_emails: [], period, subject, message }),
      }))
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to send email')
      notify(`Recognition email sent to ${result.recipients[0]}`)
    } catch (error) { notify(error.message || 'Unable to send email') }
  }

  return <section className="top-holder-mail-page">
    <header className="top-holder-mail-hero"><span>MANUAL RECOGNITION</span><h1>Celebrate your Top 5</h1><p>Review the current leaders, tailor the message, and send one email to your company group mailbox.</p></header>
    <div className="top-holder-mail-grid">
      <section className="er-card top-holder-recipient-card"><header><h2>Top certified holders</h2><div className="top-holder-period"><button type="button" className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Month-wise</button><button type="button" className={period === 'overall' ? 'active' : ''} onClick={() => setPeriod('overall')}>Overall</button></div></header>{holders.map((holder) => <div key={holder.email} className="top-holder-row"><b>#{holder.rank}</b><span><strong>{holder.name}</strong><small>{holder.email} · {holder.count} certificates</small></span></div>)}{!holders.length && <p className="user-empty">No certified holders for this period.</p>}</section>
      <section className="er-card top-holder-compose-card"><header><h2>Customize email</h2><small>One group-mail send only</small></header><label>Company group email<input type="email" value={groupEmail} onChange={(event) => setGroupEmail(event.target.value)} placeholder="team@company.com" /></label><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength="200" /></label><label>Message<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength="4000" rows="7" /></label><button type="button" onClick={send} disabled={!holders.length}><i className="bi bi-send-fill" /> Send to group email</button></section>
    </div>
    <section className="er-card top-holder-preview"><span>LIVE PREVIEW</span><h2>{subject || 'Email subject'}</h2><p>{message || 'Your custom message will appear here.'}</p><footer>To: {groupEmail || 'company group email'} only</footer></section>
  </section>
}
