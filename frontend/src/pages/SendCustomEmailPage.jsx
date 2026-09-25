import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import apiUrl from '../api'
import '../send-email.css'

export default function SendCustomEmailPage({ user }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [groupEmail, setGroupEmail] = useState(searchParams.get('group_email') || '')
  const [subject, setSubject] = useState('Celebrating our team achievements')
  const [body, setBody] = useState(`Hello team,\n\nWe would like to recognise the commitment, learning, and professional growth demonstrated across our team. Thank you for helping us build a stronger organisation every day.\n\nBest regards,\n${user?.firstName || 'The Admin Team'}`)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSend = async (event) => {
    event.preventDefault()
    setSending(true)
    try {
      const response = await fetch(`${apiUrl}/custom-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_email: groupEmail, subject, message: body }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to send email')
      setSent(true)
    } catch (error) { window.alert(error.message || 'Failed to send email. Please try again.') }
    finally { setSending(false) }
  }

  if (sent) return <div className="email-success-container"><div className="success-icon-wrapper"><i className="bi bi-check-circle-fill" /></div><h2>Email sent successfully</h2><p>Your message was delivered to the group mailbox: {groupEmail}</p><button type="button" className="back-btn" onClick={() => navigate('/dashboard')}>Back to dashboard</button></div>

  return <div className="send-email-page">
    <div className="send-email-header"><button type="button" className="back-btn" onClick={() => navigate(-1)}><i className="bi bi-arrow-left" /> Back</button><div><h2>Send group email</h2><p>One message is sent only to the company group mailbox.</p></div></div>
    <div className="send-email-workspace">
      <form className="email-editor" onSubmit={handleSend}>
        <div className="input-group"><label htmlFor="group-email">Company group email</label><input id="group-email" type="email" value={groupEmail} onChange={(event) => setGroupEmail(event.target.value)} placeholder="team@company.com" required /></div>
        <div className="input-group"><label htmlFor="email-subject">Subject</label><input id="email-subject" type="text" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength="200" required /></div>
        <div className="input-group body-group"><label htmlFor="email-body">Message</label><textarea id="email-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength="4000" required rows="12" /></div>
        <div className="editor-actions"><span className="hint-text"><i className="bi bi-info-circle" /> One manual email will be sent to this group mailbox.</span><button type="submit" className={`send-btn ${sending ? 'sending' : ''}`} disabled={sending}>{sending ? <><i className="bi bi-arrow-repeat spin" /> Sending...</> : <><i className="bi bi-send" /> Send to group</>}</button></div>
      </form>
      <div className="email-preview"><div className="preview-header"><i className="bi bi-eye" /> Live preview</div><div className="preview-content"><div className="preview-subject">{subject || 'Email subject'}</div><div className="preview-body">{body || 'Your message will appear here.'}</div><p className="preview-recipient">To: {groupEmail || 'company group email'} only</p></div></div>
    </div>
  </div>
}
