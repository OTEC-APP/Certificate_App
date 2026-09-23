import { useEffect, useState } from 'react'
import Pagination from '../components/Pagination'
import apiUrl from '../api'
 
 
const initialsFor = (employee) =>
  `${employee.firstName?.[0] || ''}${employee.lastName?.[0] || ''}` || 'U'

const rankMedals = ['🥇', '🥈', '🥉']

const categoryIcon = (category) => ({
  audio: 'bi-volume-up',
  video: 'bi-camera-video',
  control: 'bi-sliders',
  sales: 'bi-graph-up-arrow',
  networking: 'bi-diagram-3',
  other: 'bi-grid',
}[String(category || '').toLowerCase()] || 'bi-award')

const lastSeenLabel = (value) => {
  if (!value) return 'Not yet seen'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not yet seen'
  const elapsedMs = Math.max(0, Date.now() - date.getTime())
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 2) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`
  return date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const lastCertificateLabel = (value) => {
  if (!value) return 'No certificate yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No certificate yet'
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  return days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'} ago`
}

const joiningDateLabel = (value) => {
  if (!value) return 'Not recorded'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
 
export default function LiveEmployeesPage({ query, filter, goTo, realtimeVersion }) {
  const [employees, setEmployees] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [categoryProfile, setCategoryProfile] = useState(null)
  const [debouncedQuery, setDebouncedQuery] = useState(query || '')
  const isTenureDrilldown = filter?.type === 'tenure' && filter?.value
  const isRankedDrilldown = filter?.type === 'employee_ids' && filter?.ranked
  const rankingCountLabel = filter?.rankingPeriod === 'month' ? 'Month certs' : 'Overall certs'

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query || ''), 350)
    return () => window.clearTimeout(timer)
  }, [query])
  useEffect(() => setPage(1), [debouncedQuery, filter])
 
  useEffect(() => {
    let cancelled = false
    const loadEmployees = async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        const params = new URLSearchParams({
          search: debouncedQuery,
          page: String(page),
          page_size: String(pageSize),
        })
        if (filter?.type === 'tenure') params.set('tenure', filter.value)
        if (filter?.type === 'location') params.set('location', filter.value)
        if (filter?.type === 'employee_ids') params.set('employee_ids', filter.value.join(','))
        if (filter?.certified) params.set('certified', 'true')
 
        const response = await fetch(`${apiUrl}/employees?${params}`)
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to load employees')
        if (!cancelled) {
          setEmployees(result.items || [])
          setTotal(result.total || 0)
          setError('')
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Unable to load employees')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadEmployees()
    const timer = window.setInterval(() => loadEmployees(true), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [debouncedQuery, filter, page, pageSize, realtimeVersion])
 
  return (
    <>
      <section className="er-card live-employees-card" aria-busy={loading}>
        {loading && !employees.length ? (
          <p className="user-empty">Loading current employee records…</p>
        ) : error && !employees.length ? (
          <p className="user-empty">{error}</p>
        ) : !employees.length ? (
          <p className="user-empty">No Access Management users found.</p>
        ) : (
          <div className="global-table-scroll">
          <table className="er-table">
            <thead>
              <tr>
                {isRankedDrilldown && <th>Rank</th>}
                <th>Employee</th>
                <th>Employee ID</th>
                <th>Date of joining</th>
                <th>Location</th>
                <th>Department</th>
                <th>Categories held</th>
                <th>{isRankedDrilldown ? rankingCountLabel : 'Certs'}</th>
                <th>Last seen</th>
                <th>Last certificate</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee, index) => (
                <tr key={employee.id} onClick={() => goTo(`employees/${employee.id}`)}>
                  {isRankedDrilldown && (() => { const rank = (page - 1) * pageSize + index + 1; return <td data-label="Rank" title={`Rank ${rank}`}><strong>{rankMedals[rank - 1] || rank}</strong></td> })()}
                  <td>
                    <div className="employee">
                      <i className={`face f${index % 6}`}>{initialsFor(employee)}</i>
                      <span>
                        <b>{employee.name}</b>
                        <small>
                          {employee.role === 'admin' ? 'Administrator' : 'User'} · {employee.email}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>{employee.employeeId}</td>
                  <td>{joiningDateLabel(employee.dateOfJoining)}</td>
                  <td>{employee.location}</td>
                  <td>{employee.department}</td>
                  <td className="employee-categories-cell" onClick={(event) => event.stopPropagation()}>
                    {employee.categories.length ? (
                      <button type="button" className="employee-categories-trigger" onClick={() => setCategoryProfile(employee)}>
                          <span className="category-icon-stack" aria-hidden="true">
                            {employee.categories.slice(0, 3).map((category) => (
                              <i className={`bi ${categoryIcon(category)}`} key={category} />
                            ))}
                          </span>
                          <b className="category-count-badge">{employee.categories.length}</b>
                          <span className="category-view-label">View</span>
                          <i className="bi bi-arrow-up-right category-summary-chevron" />
                      </button>
                    ) : '—'}
                  </td>
                  <td className="count">{isRankedDrilldown ? (filter?.rankCounts?.[employee.id] ?? 0) : employee.certificateCount}</td>
                  <td>{lastSeenLabel(employee.last_seen_at)}</td>
                  <td>{lastCertificateLabel(employee.last_certificate_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      <Pagination
        page={page}
        totalItems={total}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(1)
        }}
        label="people"
      />
      </section>
      {categoryProfile && (
        <div className="category-profile-overlay" onMouseDown={() => setCategoryProfile(null)}>
          <section className="category-profile-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div className="category-profile-identity">
                <i>{initialsFor(categoryProfile)}</i>
                <span>
                  <small>EMPLOYEE CERTIFICATION PROFILE</small>
                  <h2>{categoryProfile.name}</h2>
                  <p>{categoryProfile.department} · {categoryProfile.location}</p>
                </span>
              </div>
              <button type="button" onClick={() => setCategoryProfile(null)} aria-label="Close category profile"><i className="bi bi-x-lg" /></button>
            </header>
            <div className="category-profile-stats">
              <span><i className="bi bi-person-badge" /><small>Employee ID</small><b>{categoryProfile.employeeId}</b></span>
              <span><i className="bi bi-award" /><small>Certificates</small><b>{categoryProfile.certificateCount}</b></span>
              <span><i className="bi bi-collection" /><small>Categories</small><b>{categoryProfile.categories.length}</b></span>
            </div>
            <div className="category-profile-content">
              <div className="category-profile-title"><span><i className="bi bi-stars" /></span><div><h3>Categories held</h3><p>Certification areas completed by this employee.</p></div></div>
              <div className="category-profile-grid">
                {categoryProfile.categories.map((category) => (
                  <article key={category}><i className={`bi ${categoryIcon(category)}`} /><span><b>{category}</b><small>Active certification area</small></span><i className="bi bi-check-circle-fill" /></article>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
 
 
