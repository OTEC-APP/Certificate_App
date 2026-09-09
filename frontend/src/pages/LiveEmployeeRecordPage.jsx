import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import apiUrl from '../api'
import VerificationFileButton from '../components/VerificationFileButton'
import CompactSelect from '../components/CompactSelect'
import { categoryColor } from '../utils/categoryPalette'
 
const joiningDateLabel = (value) => {
  if (!value) return 'Not recorded'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
 
const validityYearsFor = (certificate) => {
  if (Object.prototype.hasOwnProperty.call(certificate, 'validity_years')) {
    const years = certificate.validity_years
    return years === null || years === '' || Number(years) === 0 ? null : Number(years)
  }
  if (certificate.validity === 'lifetime') return null
  if (certificate.validity === '1_year') return 1
  if (certificate.validity === '2_years') return 2
  return 3
}
 
const expiryFor = (certificate) => {
  if (certificate.expires_on) return new Date(`${String(certificate.expires_on).slice(0, 10)}T00:00:00`)
  const years = validityYearsFor(certificate)
  if (!years) return null
  const issued = new Date(`${certificate.issued_date}T00:00:00`)
  issued.setFullYear(issued.getFullYear() + Number(years))
  return issued
}
 
 
const isExpiredCertificate = (certificate) => {
  const expiry = expiryFor(certificate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Boolean(certificate.status === 'issued' && expiry && expiry < today)
}
 
const newestCertificateFirst = (first, second) => {
  const firstDate = Date.parse(first.created_at || `${first.issued_date || '1970-01-01'}T00:00:00`) || 0
  const secondDate = Date.parse(second.created_at || `${second.issued_date || '1970-01-01'}T00:00:00`) || 0
  return secondDate - firstDate
}
 
const nearestExpiryFirst = (first, second) => {
  const firstExpiry = expiryFor(first)?.getTime() ?? Number.POSITIVE_INFINITY
  const secondExpiry = expiryFor(second)?.getTime() ?? Number.POSITIVE_INFINITY
  return firstExpiry - secondExpiry || newestCertificateFirst(first, second)
}
 
const mostRecentlyExpiredFirst = (first, second) =>
  (expiryFor(second)?.getTime() ?? 0) - (expiryFor(first)?.getTime() ?? 0) ||
  newestCertificateFirst(first, second)

const lastSeenLabel = (value) => {
  if (!value) return 'Not yet seen'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not yet seen'
  const elapsedMs = Math.max(0, Date.now() - date.getTime())
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 2) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

const lastCertificateLabel = (value) => {
  if (!value) return 'No certificate yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No certificate yet'
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  return days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'} ago`
}
 
 
export default function LiveEmployeeRecordPage({ query = '', realtimeVersion }) {
  const { employeeId } = useParams()
  const [searchParams] = useSearchParams()
  const highlightedCertificateId = searchParams.get('certificate')
  const [employee, setEmployee] = useState(null)
  const [error, setError] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [oemFilter, setOemFilter] = useState('all')
  const [certificateView, setCertificateView] = useState('current')
 
  useEffect(() => {
    let cancelled = false
    const loadEmployee = () => fetch(`${apiUrl}/employees/${employeeId}`)
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to load employee profile')
        return result
      })
      .then((result) => {
        if (cancelled) return
        setError('')
        setEmployee({
        ...result,
        certificates: (result.certificates || []).filter(
          (certificate) => certificate.status === 'issued',
        ),
        })
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || 'Unable to load employee profile')
      })
    loadEmployee()
    const timer = window.setInterval(loadEmployee, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [employeeId, realtimeVersion])
 
  const categories = useMemo(() => {
    if (!employee) return []
    const counts = employee.certificates.filter((certificate) => !isExpiredCertificate(certificate)).reduce((result, certificate) => {
      const category = certificate.category || 'Other'
      result[category] = (result[category] || 0) + 1
      return result
    }, {})
    return Object.entries(counts)
  }, [employee])
 
  const viewCertificates = useMemo(() => {
    if (!employee) return []
    return employee.certificates.filter((certificate) =>
      certificateView === 'expired' ? isExpiredCertificate(certificate) : !isExpiredCertificate(certificate),
    )
  }, [certificateView, employee])
 
  const viewCategories = useMemo(
    () => [...new Set(viewCertificates.map((certificate) => certificate.category || 'Other'))].sort(),
    [viewCertificates],
  )
  const viewOems = useMemo(
    () => [...new Set(viewCertificates.map((certificate) => certificate.vendor_name || 'OEM not recorded'))].sort(),
    [viewCertificates],
  )
 
  useEffect(() => {
    setCategoryFilter('all')
    setOemFilter('all')
  }, [certificateView])
 
  const filteredCertificates = useMemo(() => {
    if (!employee) return []
    return employee.certificates.filter((certificate) => {
      const isExpired = isExpiredCertificate(certificate)
      const categoryMatches = categoryFilter === 'all' ||
        (certificate.category || 'Other') === categoryFilter
      const oemMatches = oemFilter === 'all' ||
        (certificate.vendor_name || 'OEM not recorded') === oemFilter
      const viewMatches = certificateView === 'expired' ? isExpired : !isExpired
      const searchMatches = !query.trim() || [certificate.course_name, certificate.vendor_name,
        certificate.category, certificate.certificate_number, certificate.issued_date,
        certificate.reviewed_by].join(' ').toLowerCase().includes(query.trim().toLowerCase())
      return categoryMatches && oemMatches && viewMatches && searchMatches
    }).sort((first, second) => {
      if (highlightedCertificateId) {
        if (String(first.id) === highlightedCertificateId) return -1
        if (String(second.id) === highlightedCertificateId) return 1
      }
      return certificateView === 'expired'
        ? mostRecentlyExpiredFirst(first, second)
        : nearestExpiryFirst(first, second)
    })
  }, [categoryFilter, certificateView, employee, highlightedCertificateId, oemFilter, query])
 
  if (error) return <p className="user-empty">{error}</p>
  if (!employee) return <p className="user-empty">Loading employee profile...</p>
  const initials = `${employee.firstName?.[0] || ''}${employee.lastName?.[0] || ''}` || 'U'
  const ruPointsFor = (certificate) => {
    if (certificate.status !== 'issued') return 0
    const points = certificate.verified_ru_points ?? certificate.total_ru_points
    const numericPoints = Number(points)
    return Number.isFinite(numericPoints) ? numericPoints : 0
  }
  const verifiedRuTotal = employee.certificates.filter((certificate) => !isExpiredCertificate(certificate)).reduce(
    (total, certificate) => total + ruPointsFor(certificate),
    0,
  )
  const expiredCertificateCount = employee.certificates.filter(isExpiredCertificate).length
  return (
    <div className="record-page">
      <section className="record-profile">
        <div className="record-profile-identity">
          <i className="record-avatar">
            {initials}
          </i>
          <div className="record-profile-copy">
            <h2>{employee.name}</h2>
            <p>
              <span className="record-profile-role"><i className="bi bi-person-badge" /> Role: {employee.role === 'admin' ? 'Administrator' : 'User'}</span>
              <span><i className="bi bi-person-badge" /> ID: {employee.employeeId || 'Not assigned'}</span>
              <span><i className="bi bi-calendar3" /> Joined: {joiningDateLabel(employee.dateOfJoining)}</span>
              <span><i className="bi bi-geo-alt" /> {employee.location}</span>
              <span className="record-profile-department"><i className="bi bi-building" /> Department: {employee.department}</span>
              <span><i className="bi bi-clock-history" /> Last seen: {lastSeenLabel(employee.last_seen_at)}</span><span><i className="bi bi-upload" /> Last certificate: {lastCertificateLabel(employee.last_certificate_at || employee.certificates?.[0]?.issued_date)}</span>
            </p>
          </div>
        </div>
      </section>
      <div className="record-counts record-category-counts">
        <article className="record-ru-total" style={{ borderTopColor: '#d84457' }}>
          <b>{verifiedRuTotal}</b>
          <span>Verified RU points</span>
        </article>
        {categories.length ? (
          categories.map(([name, count]) => (
            <article key={name} style={{ borderTopColor: categoryColor(name) }}>
              <b>{count}</b>
              <span>{name}</span>
            </article>
          ))
        ) : (
          <article style={{ borderTopColor: '#94a3b8' }}>
            <b>0</b>
            <span>Certificates</span>
          </article>
        )}
      </div>
      <section className="er-card record-list">
        <div className="record-list-toolbar">
          <div>
            <h3 className="record-heading">Certification record</h3>
            <div className="alerts-view-toggle" role="tablist" aria-label="Certificate records">
              <button type="button" role="tab" aria-selected={certificateView === 'current'} className={certificateView === 'current' ? 'active' : ''} onClick={() => setCertificateView('current')}>
                Current certificates
              </button>
              <button type="button" role="tab" aria-selected={certificateView === 'expired'} className={certificateView === 'expired' ? 'active' : ''} onClick={() => setCertificateView('expired')}>
                Expired certificates ({expiredCertificateCount})
              </button>
            </div>
          </div>
          <div className="record-filters" aria-label="Certification filters">
            <i className="bi bi-funnel" aria-hidden="true" />
          <label>
            <span>Category</span>
            <CompactSelect value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All categories</option>
              {viewCategories.map((name) => <option key={name} value={name}>{name}</option>)}
            </CompactSelect>
          </label>
          <label>
            <span>OEM</span>
            <CompactSelect value={oemFilter} onChange={(event) => setOemFilter(event.target.value)}>
              <option value="all">All OEMs</option>
              {viewOems.map((name) => <option key={name} value={name}>{name}</option>)}
            </CompactSelect>
          </label>
          </div>
        </div>
        {filteredCertificates.length ? (
          filteredCertificates.map((certificate) => {
            const expiry = expiryFor(certificate)
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const isExpired = Boolean(expiry && expiry < today)
            return (
              <article key={certificate.id}>
                <i style={{ background: categoryColor(certificate.category) }} />
                <div>
                  <b>{certificate.course_name}</b>
                  <span>
                    {certificate.vendor_name || 'OEM not recorded'}  - {' '}
                    {certificate.category || 'Other'}
                  </span>
                  {/* {certificate.verification_image_path && (
                    <small>
                      <i className="bi bi-check-circle-fill verified-certificate-tick" /> Verified by{' '}
                      {certificate.reviewed_by || 'Administrator'}
                    </small>
                  )} */}
                  {certificate.status === 'issued' && certificate.reviewed_by && (
  <small>
    <i className="bi bi-check-circle-fill verified-certificate-tick" /> Verified by{' '}
    {certificate.reviewed_by || 'Administrator'}
  </small>
)}
                </div>
                <aside>
                  <b>Completed {certificate.issued_date}</b>
                  <span className={isExpired ? 'expiry' : ''}>
                    {expiry
                      ? `${isExpired ? 'Expired' : 'Expires'} ${expiry.toLocaleDateString('en-IN')}`
                      : 'Lifetime'}
                  </span>
                  {certificate.status === 'issued' && (certificate.verified_ru_points != null || certificate.total_ru_points != null) && (
                    <span className="record-verified-ru">
                      <i className="bi bi-patch-check-fill" /> {ruPointsFor(certificate)} RU
                      {certificate.verified_cts_type ? ` · ${certificate.verified_cts_type}` : ''}
                    </span>
                  )}
                  {certificate.verification_image_path && <VerificationFileButton certificateId={certificate.id} hasFile />}
                </aside>
 
              </article>
            )
          })
        ) : (
          <p className="user-empty">{employee.certificates.length ? certificateView === 'expired' ? 'No expired certificates for this employee.' : 'No current certificates match this filter.' : 'No certificates saved for this employee yet.'}</p>
        )}
      </section>
    </div>
  )
}
 
 
