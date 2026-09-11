import { useEffect, useState } from 'react'
import apiUrl from '../api'
 
const readApiResponse = async (response) => {
  const responseText = await response.text()
  if (!responseText) return {}
 
  try {
    return JSON.parse(responseText)
  } catch {
    throw new Error(
      response.ok
        ? 'The access server returned an invalid response.'
        : 'Unable to connect to the access server. Please make sure the API is running.',
    )
  }
}
 
export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [needsSetup, setNeedsSetup] = useState(null)
  const [setupMode, setSetupMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
 
  useEffect(() => {
    const loadSetupStatus = async () => {
      try {
        const response = await fetch(`${apiUrl}/auth/setup-status`)
        const result = await readApiResponse(response)
        if (!response.ok) throw new Error(result.detail || 'Unable to check access setup')
        setNeedsSetup(Boolean(result.needs_setup))
      } catch (loadError) {
        setNeedsSetup(false)
        setError(loadError.message || 'Unable to connect to the access server.')
      }
    }
    loadSetupStatus()
  }, [])
 
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search)
    const code = parameters.get('azure_code')
    const azureError = parameters.get('error')
    const invitedEmail = parameters.get('email')
    if (invitedEmail) setEmail(invitedEmail)
 
    if (azureError) {
      setError(azureError.replaceAll('_', ' '))
      window.history.replaceState({}, '', window.location.pathname)
      return
    }
    if (!code) return
 
    // The code is single-use. Clear it before the request so React Strict Mode
    // cannot submit it twice while developing locally.
    window.history.replaceState({}, '', window.location.pathname)
 
    const exchangeMicrosoftSession = async () => {
      setSubmitting(true)
      setError('')
      try {
        const response = await fetch(`${apiUrl}/auth/azure/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })
        const result = await readApiResponse(response)
        if (!response.ok) {
          throw new Error(result.detail || 'Unable to complete Microsoft sign-in')
        }
        onLogin(result.user)
        window.history.replaceState({}, '', '/dashboard')
        window.location.reload()
      } catch (exchangeError) {
        setError(exchangeError.message || 'Unable to complete Microsoft sign-in')
      } finally {
        setSubmitting(false)
      }
    }
 
    exchangeMicrosoftSession()
  }, [onLogin])
 
  const startMicrosoftSignIn = async (event) => {
    event.preventDefault()
 
    if (!setupMode && !email.trim()) {
      setError('Enter your approved work email address.')
      return
    }
    if (setupMode && (!firstName.trim() || !lastName.trim() || !/^\d+$/.test(employeeId))) {
      setError(
        !/^\d+$/.test(employeeId)
          ? 'Employee ID must contain numbers only.'
          : 'Enter the first administrator details.',
      )
      return
    }
 
    setSubmitting(true)
    setError('')
    try {
      const payload = setupMode
        ? {
            setup: true,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            employeeId,
          }
        : { setup: false, email: email.trim().toLowerCase() }
      const response = await fetch(`${apiUrl}/auth/azure/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await readApiResponse(response)
      if (!response.ok) throw new Error(result.detail || 'Unable to start Microsoft sign-in')
      if (!result.authorization_url) throw new Error('Microsoft sign-in URL was not returned')
      window.location.assign(result.authorization_url)
    } catch (signInError) {
      setError(signInError.message || 'Unable to start Microsoft sign-in')
      setSubmitting(false)
    }
  }
 
  return (
    <main className="login-page">
      <section className="login-shell">
        <aside className="login-story">
          <div className="login-story-logo">
            <img src="/o2k-logo-white.png" alt="OTEC logo" />
          </div>
          <div className="login-story-copy">
            <b>OTEC CERTIFICATE MANAGEMENT</b>
            <h1>Keep every certification current and Achieved.</h1>
            <p>
              Manage employee certificates, monitor expiry dates, and stay ready for OEM
              compliance reviews from one secure workspace.
            </p>
            <div className="login-story-features" aria-label="OTEC benefits">
              <span>
                <i className="bi bi-patch-check" /> Centralised certificate records
              </span>
              <span>
                <i className="bi bi-clock-history" /> Proactive renewal tracking
              </span>
              <span>
                <i className="bi bi-shield-check" /> continuous skills development
              </span>
            </div>
          </div>
          <small>Track. Renew. Keep learning </small>
        </aside>

        <section className="login-panel">
          <div className="login-mobile-brand" aria-label="OTEC Certificate Management">
            <img src="/o2k-mobile-logo.png" alt="OTEC" />
            <span>OTEC Certificate Management</span>
          </div>
          <header className="login-panel-head">
            <b>OTEC</b>
            <span>Secure sign in</span>
          </header>
          <div className="login-copy">
            <h2>
              {needsSetup === null
                ? 'Checking access'
                : setupMode
                  ? 'Create first admin'
                  : 'Sign in to OTEC'}
            </h2>
            <p>
              {needsSetup === null
                ? 'Connecting to the access server...'
                : setupMode
                  ? 'Enter the first administrator details, then verify the Microsoft account.'
                  : 'Use your approved Microsoft work account to access your certificate workspace.'}
            </p>
          </div>
 
          {setupMode && (
            <span className="login-security-status">
              <i className="bi bi-shield-lock" /> One-time secure administrator setup
            </span>
          )}
 
          <form onSubmit={startMicrosoftSignIn}>
            {setupMode && (
              <div className="login-name-row">
                <label>
                  First name
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </label>
                <label>
                  Last name
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </label>
                <label>
                  Employee ID
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={employeeId}
                    onChange={(event) => setEmployeeId(event.target.value.replace(/\D/g, ''))}
                    autoComplete="off"
                    required
                  />
                </label>
              </div>
            )}
 
            {!setupMode && (
              <label>
                Email address
                <span className="login-input">
                  <i className="bi bi-envelope" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Enter Your Email"
                    autoComplete="email"
                    required
                  />
                </span>
              </label>
            )}
 
            {error && <p className="login-error">{error}</p>}
            <button
              type="submit"
              className="login-submit login-microsoft"
              disabled={submitting || needsSetup === null}
            >
              <i className="bi bi-microsoft" />{' '}
              {submitting
                ? 'Connecting to Microsoft...'
                : setupMode
                  ? 'Continue with Microsoft'
                  : 'Sign in with Microsoft'}
            </button>
          </form>
 
          {needsSetup && !setupMode && (
            <button type="button" className="login-create-admin" onClick={() => setSetupMode(true)}>
              <i className="bi bi-person-plus" /> Create first admin
            </button>
          )}
          {setupMode && (
            <button
              type="button"
              className="login-back"
              onClick={() => {
                setSetupMode(false)
                setError('')
              }}
            >
              <i className="bi bi-arrow-left" /> Back to sign in
            </button>
          )}
          <footer>Having trouble signing in? Contact your administrator.</footer>
          <small className="login-note">
            Only users created in Access Management can sign in.
          </small>
          <small className="login-copyright">
            &copy; {new Date().getFullYear()} Office 2000 Solutions Pvt Ltd
          </small>
        </section>
      </section>
    </main>
  )
}
 
 
