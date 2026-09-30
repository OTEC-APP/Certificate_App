import { useEffect, useMemo, useState } from 'react'
import Pagination from '../components/Pagination'
import CompactSelect from '../components/CompactSelect'
import { useSearchParams } from 'react-router-dom'
const apiUrl = process.env.REACT_APP_API_URL
import PendingCertificateReviews from '../components/PendingCertificateReviews'
import { renewalTimeLabel } from '../utils/renewalTime'
import HrActivities from '../components/HrActivities'

const renewalText = renewalTimeLabel

export default function LiveAlertsPage({
  user,
  notify,
  runWithLoader,
  query = '',
  realtimeVersion,
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeSection =
    searchParams.get('section') === 'renewals'
      ? 'renewals'
      : searchParams.get('section') === 'hr-activities'
        ? 'hr-activities'
        : 'alerts'
  const renewalTitle =
    searchParams.get('source') === 'expiring' ? 'Expiring in 90 days' : 'Upcoming renewals'
  const [pendingTotal, setPendingTotal] = useState(0)
  const [renewals, setRenewals] = useState([])
  const [renewalFilters, setRenewalFilters] = useState({
    employee: '',
    department: '',
    validity: '',
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const employeeOptions = useMemo(
    () =>
      [
        ...new Set(renewals.map((certificate) => certificate.recipient_name).filter(Boolean)),
      ].sort(),
    [renewals],
  )
  const departmentOptions = useMemo(
    () =>
      [...new Set(renewals.map((certificate) => certificate.department || 'Not assigned'))].sort(),
    [renewals],
  )
  const filteredRenewals = renewals
    .filter(
      (certificate) =>
        !query.trim() ||
        [
          certificate.course_name,
          certificate.recipient_name,
          certificate.vendor_name,
          certificate.category,
          certificate.certificate_number,
          certificate.expiry_date,
          certificate.department,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .filter(
      (certificate) =>
        !renewalFilters.employee || certificate.recipient_name === renewalFilters.employee,
    )
    .filter(
      (certificate) =>
        !renewalFilters.department ||
        (certificate.department || 'Not assigned') === renewalFilters.department,
    )
    .filter(
      (certificate) =>
        !renewalFilters.validity || certificate.days_remaining <= Number(renewalFilters.validity),
    )
  const visibleRenewals = filteredRenewals.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    if (activeSection !== 'renewals') return undefined
    let cancelled = false
    const loadRenewals = async () => {
      setLoading(true)
      try {
        const response = await fetch(`${apiUrl}/renewals?page=1&page_size=100`)
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to load renewal alerts')
        if (!cancelled) {
          setRenewals(result.items || [])
          setError('')
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Unable to load renewal alerts')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRenewals()
    const refresh = () => loadRenewals()
    window.addEventListener('certificates-updated', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('certificates-updated', refresh)
    }
    // Renewals are refreshed by the real-time update signal, not a permanent
    // 30-second poll while the Alerts or HR tab is being viewed.
  }, [activeSection, realtimeVersion])

  useEffect(() => {
    setPage(1)
  }, [query, renewalFilters])

  return (
    <div className="alerts-page-stack">
      <nav
        className="alerts-view-toggle"
        aria-label="Alerts, renewals, and HR activities sections"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-label={`Alerts (${pendingTotal})`}
          aria-selected={activeSection === 'alerts'}
          className={activeSection === 'alerts' ? 'active' : ''}
          onClick={() => {
            setPage(1)
            setSearchParams({})
          }}
        >
          <i className="bi bi-bell" aria-hidden="true" />
          <span>Alerts</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-label={`Renewals (${filteredRenewals.length})`}
          aria-selected={activeSection === 'renewals'}
          className={activeSection === 'renewals' ? 'active' : ''}
          onClick={() => {
            setPage(1)
            setSearchParams({ section: 'renewals' })
          }}
        >
          <i className="bi bi-arrow-repeat" aria-hidden="true" />
          <span>Renewals</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-label="HR Activities"
          aria-selected={activeSection === 'hr-activities'}
          className={activeSection === 'hr-activities' ? 'active' : ''}
          onClick={() => {
            setPage(1)
            setSearchParams({ section: 'hr-activities' })
          }}
        >
          <i className="bi bi-people" aria-hidden="true" />
          <span>HR Activities</span>
        </button>
      </nav>
      {activeSection === 'alerts' ? (
        <PendingCertificateReviews
          user={user}
          query={query}
          notify={notify}
          runWithLoader={runWithLoader}
          onTotalChange={setPendingTotal}
          realtimeVersion={realtimeVersion}
        />
      ) : activeSection === 'hr-activities' ? (
        <HrActivities
          user={user}
          notify={notify}
          runWithLoader={runWithLoader}
          query={query}
          realtimeVersion={realtimeVersion}
        />
      ) : (
        <section className="er-card live-renewal-card">
          <header>
            <div>
              <h3>{renewalTitle}</h3>
              <p>Current certificates that are due in the next 90 days.</p>
            </div>
            <span className="renewal-attention-count">
              {filteredRenewals.length}{' '}
              {filteredRenewals.length === 1
                ? 'certificate needs attention'
                : 'certificates need attention'}
            </span>
          </header>
          <div className="renewal-filter-bar" aria-label="Filter renewals">
            <label>
              Employee
              <CompactSelect
                value={renewalFilters.employee}
                onChange={(event) =>
                  setRenewalFilters((filters) => ({ ...filters, employee: event.target.value }))
                }
              >
                <option value="">All employees</option>
                {employeeOptions.map((employee) => (
                  <option key={employee} value={employee}>
                    {employee}
                  </option>
                ))}
              </CompactSelect>
            </label>
            <label>
              Department
              <CompactSelect
                value={renewalFilters.department}
                onChange={(event) =>
                  setRenewalFilters((filters) => ({ ...filters, department: event.target.value }))
                }
              >
                <option value="">All departments</option>
                {departmentOptions.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </CompactSelect>
            </label>
            <label>
              Expiry period
              <CompactSelect
                value={renewalFilters.validity}
                onChange={(event) =>
                  setRenewalFilters((filters) => ({ ...filters, validity: event.target.value }))
                }
              >
                <option value="">All renewal periods</option>
                <option value="30">Expires within 30 days</option>
                <option value="60">Expires within 60 days</option>
                <option value="90">Expires within 90 days</option>
              </CompactSelect>
            </label>
            {Object.values(renewalFilters).some(Boolean) && (
              <button
                type="button"
                onClick={() => setRenewalFilters({ employee: '', department: '', validity: '' })}
              >
                Clear filters
              </button>
            )}
          </div>
          {loading ? (
            <p className="user-empty">Loading current renewals...</p>
          ) : error ? (
            <p className="user-empty">{error}</p>
          ) : !visibleRenewals.length ? (
            <p className="user-empty">No renewals match these filters.</p>
          ) : (
            <div className="renewal-list all">
              {visibleRenewals.map((certificate) => {
                const urgent = certificate.days_remaining <= 30
                return (
                  <div key={certificate.id}>
                    <i className={urgent ? 'danger' : 'warn'} />
                    <span>
                      <b>
                        {certificate.course_name} - {certificate.recipient_name}
                      </b>
                      <small>
                        {certificate.vendor_name || 'OEM not recorded'} -{' '}
                        {certificate.days_remaining < 0 ? 'expired' : 'expires'}{' '}
                        {certificate.expiry_date}
                      </small>
                    </span>
                    <em className={urgent ? 'danger' : 'warn'}>
                      {renewalText(certificate.days_remaining)}
                    </em>
                  </div>
                )
              })}
            </div>
          )}
          <div className="card-pagination">
            <Pagination
              page={page}
              totalItems={filteredRenewals.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size)
                setPage(1)
              }}
              label="renewals"
            />
          </div>
        </section>
      )}
    </div>
  )
}
