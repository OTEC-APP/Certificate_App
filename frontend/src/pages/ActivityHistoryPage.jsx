import { useEffect, useState } from 'react'
import Pagination from '../components/Pagination'
import CompactSelect from '../components/CompactSelect'
const apiUrl = process.env.REACT_APP_API_URL

const apiErrorMessage = (detail, fallback) => {
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join(', ')
  if (detail && typeof detail === 'object') return detail.message || detail.msg || fallback
  return fallback
}

const formatHistoryTime = (value, dateOnly = false) => {
  if (!value) return 'Not recorded'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-IN', dateOnly
    ? { day: '2-digit', month: 'short', year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  ).format(parsed)
}

const certificateStatusLabel = (status) => (
  status === 'issued' ? 'Validated' : status === 'pending' ? 'Under Review' : status === 'revoked' ? 'Revoked' : status || 'Under Review'
)

const pageSettings = {
  access: {
    endpoint: '/access-options/history/logs',
    eyebrow: 'USER ADMINISTRATION',
    title: 'Access history',
    description: 'A chronological record of access updates and administrative changes.',
    empty: 'No access-management activity has been recorded yet.',
    icon: 'bi-clock-history',
  },
  certificates: {
    endpoint: '/certificate-activity',
    eyebrow: 'CERTIFICATE AUDIT TRAIL',
    title: 'Certificate activity',
    description: 'Certificate uploads, edits, deletions, approvals, and verification-file activity.',
    empty: 'No certificate activity has been recorded yet.',
    icon: 'bi-activity',
  },
  newEmployees: {
    endpoint: '/access-options/history/new-employees',
    eyebrow: 'RECENT JOINERS',
    title: 'New employees',
    description: 'Active employees whose joining date falls within the selected recent period.',
    empty: 'No employees joined during the selected period.',
    icon: 'bi-person-plus',
  },
  departed: {
    endpoint: '/access-options/departed-employees',
    eyebrow: 'EMPLOYEE OFFBOARDING',
    title: 'Exit employees',
    description: 'Departed employee details and certificate snapshots retained for 30 days.',
    empty: 'No departed employee records are currently retained.',
    icon: 'bi-person-dash',
  },
}

export default function ActivityHistoryPage({ type = 'combined', notify, query = '', realtimeVersion }) {
 
  const [activeType, setActiveType] = useState(type === 'certificates' ? 'certificates' : type === 'departed' ? 'departed' : type === 'newEmployees' ? 'newEmployees' : 'access')
  const settings = pageSettings[activeType]
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [departedProfile, setDepartedProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [newEmployeeDays, setNewEmployeeDays] = useState(30)
  const sectionItems = activeType === 'access'
    ? items.filter((item) => {
        const icon = String(item.icon || '').toLowerCase()
        const title = String(item.title || '').trim().toLowerCase()
        return icon !== 'bi-person-plus' && icon !== 'bi-person-dash' && !title.startsWith('created ') && !title.startsWith('employee left:')
      })
    : items
  const visibleItems = sectionItems.filter((item) => !query.trim() || Object.values(item).join(' ').toLowerCase().includes(query.trim().toLowerCase()))

  const openDepartedProfile = async (employeeId) => {
    setProfileLoading(true)
    try {
      const response = await fetch(`${apiUrl}/access-options/departed-employees/${employeeId}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to load departed employee profile')
      setDepartedProfile(result)
    } catch (error) {
      notify(error.message || 'Unable to load departed employee profile')
    } finally {
      setProfileLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setItems([])
      setTotal(0)
      try {
        const parameters = new URLSearchParams({
          page: activeType === 'access' ? '1' : String(page),
          page_size: activeType === 'access' ? '100' : String(pageSize),
        })
        if (activeType === 'newEmployees') {
          parameters.set('days', String(newEmployeeDays))
          if (query.trim()) parameters.set('search', query.trim())
        }
        const response = await fetch(`${apiUrl}${settings.endpoint}?${parameters}`)
        const result = await response.json()
        if (!response.ok) throw new Error(apiErrorMessage(result.detail, `Unable to load ${settings.title.toLowerCase()}`))
        if (active) {
          let nextItems = result.items || []
          let nextTotal = result.total || 0
          if (activeType === 'access') {
            nextItems = nextItems.filter((item) => {
              const icon = String(item.icon || '').toLowerCase()
              const title = String(item.title || '').trim().toLowerCase()
              return icon !== 'bi-person-plus' && icon !== 'bi-person-dash' && !title.startsWith('created ') && !title.startsWith('employee left:')
            })
            nextTotal = nextItems.length
            nextItems = nextItems.slice((page - 1) * pageSize, page * pageSize)
          }
          setItems(nextItems)
          setTotal(nextTotal)
        }
      } catch (error) {
        if (active) {
          setItems([])
          setTotal(0)
          if (activeType !== 'newEmployees') {
            notify(apiErrorMessage(error?.message, `Unable to load ${settings.title.toLowerCase()}`))
          }
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
    }, [activeType, newEmployeeDays, notify, page, pageSize, query, settings, realtimeVersion])
 

  return (
    <section className="activity-history-page">
      <nav className="activity-history-tabs" aria-label="Activity history type">
        <button type="button" className={activeType === 'access' ? 'active' : ''} onClick={() => { setActiveType('access'); setPage(1) }}>
          <i className="bi bi-clock-history" /> Access history
        </button>
        <button type="button" className={activeType === 'certificates' ? 'active' : ''} onClick={() => { setActiveType('certificates'); setPage(1) }}>
          <i className="bi bi-activity" /> Certificate history
        </button>
        <button type="button" className={activeType === 'newEmployees' ? 'active' : ''} onClick={() => { setActiveType('newEmployees'); setPage(1) }}>
          <i className="bi bi-person-plus" /> New employees
        </button>
        <button type="button" className={activeType === 'departed' ? 'active' : ''} onClick={() => { setActiveType('departed'); setPage(1) }}>
          <i className="bi bi-person-dash" /> Exit employees
        </button>
      </nav>
      <header className="activity-history-hero">
        <div className="activity-history-icon"><i className={`bi ${settings.icon}`} /></div>
        <div>
          <small>{settings.eyebrow}</small>
          <h2>{settings.title}</h2>
          <p>{settings.description}</p>
        </div>
        <strong>{total}<small>records</small></strong>
      </header>

      <section className="er-card activity-history-card">
        <header><div><h3>{activeType === 'newEmployees' ? 'Recent joiners' : 'Recent activity'}</h3>{activeType === 'newEmployees' && <p>Based on each employee’s recorded date of joining.</p>}</div>{activeType === 'newEmployees' ? <label className="new-employee-period"><i className="bi bi-calendar3" /><span>Joined within</span><CompactSelect value={String(newEmployeeDays)} onChange={(event) => { setNewEmployeeDays(Number(event.target.value)); setPage(1) }} aria-label="New employee joining period"><option value="7">Last 7 days</option><option value="10">Last 10 days</option><option value="15">Last 15 days</option><option value="30">Last 30 days</option></CompactSelect></label> : <span>Newest first</span>}</header>
        <div className="history-list activity-page-list">
          {loading ? (
            <p className="history-empty">Loading activity...</p>
          ) : visibleItems.length ? (
            visibleItems.map((item) => (
              <article
                key={item.id}
                className={activeType === 'departed' ? 'departed-history-row' : ''}
                role={activeType === 'departed' ? 'button' : undefined}
                tabIndex={activeType === 'departed' ? 0 : undefined}
                onClick={() => activeType === 'departed' && openDepartedProfile(item.id)}
                onKeyDown={(event) => {
                  if (activeType === 'departed' && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    openDepartedProfile(item.id)
                  }
                }}
              >
                <i className={`bi ${item.icon || settings.icon}`} />
                <div>
                  <b>{item.title}</b>
                  <p>{item.detail}</p>
                  <small>{activeType === 'newEmployees' ? `Joined ${formatHistoryTime(item.dateOfJoining || item.time, true)}` : formatHistoryTime(item.time)}</small>
                </div>
              </article>
            ))
          ) : <p className="history-empty">{settings.empty}</p>}
        </div>
        <Pagination
          page={page}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
          label="activity records"
        />
      </section>
      {profileLoading && <div className="er-overlay departed-profile-overlay"><div className="departed-profile-loading">Loading archived profile...</div></div>}
      {departedProfile && !profileLoading && (
        <div className="er-overlay departed-profile-overlay" onMouseDown={(event) => event.target === event.currentTarget && setDepartedProfile(null)}>
          <section className="access-dialog departed-profile-dialog" role="dialog" aria-modal="true" aria-label={`${departedProfile.name} archived profile`}>
            <header>
              <div><small>EXIT EMPLOYEE RECORD</small><h2>{departedProfile.name}</h2><p>This is a retained audit profile and does not provide active system access.</p></div>
              <button type="button" onClick={() => setDepartedProfile(null)} aria-label="Close archived profile"><i className="bi bi-x-lg" /></button>
            </header>
            <div className="departed-profile-body">
              <div className="departed-profile-facts">
                <span><small>Employee ID</small><b>{departedProfile.employeeId || 'Not assigned'}</b></span>
                <span><small>Email</small><b>{departedProfile.email || 'Not recorded'}</b></span>
                <span><small>Department</small><b>{departedProfile.department}</b></span>
                <span><small>Location</small><b>{departedProfile.location}</b></span>
                <span><small>Reporting manager</small><b>{departedProfile.reportingManager}</b></span>
                <span><small>Exited on</small><b>{formatHistoryTime(departedProfile.left_at)}</b></span>
                <span><small>Retained until</small><b>{formatHistoryTime(departedProfile.retain_until, true)}</b></span>
                <span><small>Certificate records</small><b>{departedProfile.certificate_count}</b></span>
              </div>
              <section className="departed-certificates">
                <header><h3>Retained certificates</h3><span>{departedProfile.certificates.length} {departedProfile.certificates.length === 1 ? 'record' : 'records'}</span></header>
                <div className="departed-certificate-list">
                  {departedProfile.certificates.map((certificate) => (
                    <article key={certificate.id}>
                      <div className="departed-certificate-name">
                        <i className="bi bi-patch-check" />
                        <span><b>{certificate.course_name || 'Untitled certificate'}</b><small>{certificate.certificate_number || 'No certificate number'}</small></span>
                      </div>
                      <dl>
                        <div><dt>OEM</dt><dd>{certificate.vendor_name || 'Not recorded'}</dd></div>
                        <div><dt>Category</dt><dd>{certificate.category || 'Other'}</dd></div>
                        <div><dt>Completed</dt><dd>{certificate.issued_date || 'Not recorded'}</dd></div>
                        <div><dt>Status at departure</dt><dd><span className={`user-status ${certificate.status || 'pending'}`}>{certificateStatusLabel(certificate.status)}</span></dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
                {!departedProfile.certificates.length && <p className="history-empty">No certificate records were retained.</p>}
              </section>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
