import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Pagination from '../components/Pagination'
const apiUrl = process.env.REACT_APP_API_URL

const fetchWithTimeout = (url, options = {}) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    window.clearTimeout(timeout),
  )
}
const initials = (name) =>
  String(name || 'Unknown')
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
const normalizedOem = (value) => {
  const vendor = String(value || '').trim() || 'Not recorded'
  return vendor
}
const complianceFromCertificates = (certificates) => {
  const grouped = new Map()
  certificates
    .filter((item) => item.status === 'issued')
    .forEach((certificate) => {
      const vendor = normalizedOem(certificate.vendor_name)
      const course = certificate.course_name || 'Untitled certificate'
      if (!grouped.has(vendor)) grouped.set(vendor, new Map())
      const courses = grouped.get(vendor)
      if (!courses.has(course)) courses.set(course, new Map())
      const holderKey = String(certificate.email || certificate.id).toLowerCase()
      courses.get(course).set(holderKey, {
        certificate_id: certificate.id,
        employee_id: null,
        name: certificate.recipient_name || 'Unknown employee',
        email: certificate.email || '',
        issued_date: certificate.issued_date,
        certificate_number: certificate.certificate_number || '',
      })
    })
  return [...grouped.entries()]
    .map(([name, courses]) => {
      const vendorHolders = new Set()
      const certifications = [...courses.entries()].map(([course, holders]) => {
        holders.forEach((_, key) => vendorHolders.add(key))
        return {
          name: course,
          holders: [...holders.values()],
          completed: holders.size,
          required: 1,
        }
      })
      return { name, completed: vendorHolders.size, required: 1, certifications }
    })
    .sort((first, second) => first.name.localeCompare(second.name))
}

function Progress({ completed, required }) {
  const Achieved = completed >= required
  const width = required ? Math.min(100, (completed / required) * 100) : 100
  return (
    <>
      <i className="compliance-track">
        <em className={Achieved ? 'green' : 'red'} style={{ width: `${width}%` }} />
      </i>
      <span className={Achieved ? 'green' : 'red'}>{Achieved ? 'Achieved' : 'At risk'}</span>
    </>
  )
}

export default function CompliancePage({ goTo, notify, viewToggle, query = '' }) {
  const [vendors, setVendors] = useState([])
  const [totalVendors, setTotalVendors] = useState(0)
  const [summary, setSummary] = useState({ achieved: 0, total_completed: 0, total_required: 0 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [searchParams, setSearchParams] = useSearchParams()
  const openOemView = (parameters) => {
    const next = new URLSearchParams(searchParams)
    next.delete('oem')
    next.delete('certification')
    Object.entries(parameters).forEach(([key, value]) => next.set(key, value))
    setSearchParams(next)
  }
  const vendorName = searchParams.get('oem') || ''
  const certificationName = searchParams.get('certification') || ''
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')

  // Pagination state for certifications within an OEM
  const [certPage, setCertPage] = useState(1)
  const [certPageSize, setCertPageSize] = useState(10)
  const [certifications, setCertifications] = useState([])
  const [totalCertifications, setTotalCertifications] = useState(0)
  const [certLoading, setCertLoading] = useState(false)

  // Pagination state for holders within a certification
  const [holderPage, setHolderPage] = useState(1)
  const [holderPageSize, setHolderPageSize] = useState(10)
  const [holders, setHolders] = useState([])
  const [totalHolders, setTotalHolders] = useState(0)
  const [holderLoading, setHolderLoading] = useState(false)

  const loadCompliance = async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        search: query.trim(),
        vendor: vendorName,
      })
      const response = await fetchWithTimeout(`${apiUrl}/partner-compliance?${params}`, {
        cache: 'no-store',
      })
      const result = await response.json()
      if (response.ok) {
        setVendors(result.vendors || [])
        setTotalVendors(result.total ?? (result.vendors || []).length)
        setSummary(result.summary || { achieved: 0, total_completed: 0, total_required: 0 })
      } else if (response.status === 404) {
        const certificatesResponse = await fetchWithTimeout(
          `${apiUrl}/certificates?page=1&page_size=100`,
          { cache: 'no-store' },
        )
        const certificatesResult = await certificatesResponse.json()
        if (!certificatesResponse.ok)
          throw new Error(certificatesResult.detail || 'Unable to load certificates')
        const fallbackVendors = complianceFromCertificates(certificatesResult.items || [])
        setVendors(fallbackVendors)
        setTotalVendors(fallbackVendors.length)
        setSummary({
          achieved: fallbackVendors.filter((item) => item.completed >= item.required).length,
          total_completed: fallbackVendors.reduce((total, item) => total + item.completed, 0),
          total_required: fallbackVendors.reduce((total, item) => total + item.required, 0),
        })
      } else {
        throw new Error(result.detail || 'Unable to load partner compliance')
      }
      setError('')
    } catch (loadError) {
      setError(
        loadError.name === 'AbortError'
          ? 'Partner compliance took too long to load. Please refresh and try again.'
          : loadError.message || 'Unable to load partner compliance',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCompliance()
  }, [page, pageSize, query, vendorName])
  useEffect(() => {
    setPage(1)
  }, [query])

  // Load certifications for selected OEM
  const loadCertifications = async () => {
    if (!vendorName) return
    setCertLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(certPage),
        page_size: String(certPageSize),
        search: query.trim(),
      })
      const response = await fetchWithTimeout(
        `${apiUrl}/partner-compliance/oem/${encodeURIComponent(vendorName)}/certifications?${params}`,
        { cache: 'no-store' },
      )
      const result = await response.json()
      if (response.ok) {
        setCertifications(result.certifications || [])
        setTotalCertifications(result.total || 0)
      } else {
        throw new Error(result.detail || 'Unable to load certifications')
      }
    } catch (loadError) {
      notify?.(loadError.message || 'Unable to load certifications')
    } finally {
      setCertLoading(false)
    }
  }

  // Load holders for selected certification
  const loadHolders = async () => {
    if (!vendorName || !certificationName) return
    setHolderLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(holderPage),
        page_size: String(holderPageSize),
        search: query.trim(),
      })
      const response = await fetchWithTimeout(
        `${apiUrl}/partner-compliance/oem/${encodeURIComponent(vendorName)}/certification/${encodeURIComponent(certificationName)}/holders?${params}`,
        { cache: 'no-store' },
      )
      const result = await response.json()
      if (response.ok) {
        setHolders(result.holders || [])
        setTotalHolders(result.total || 0)
      } else {
        throw new Error(result.detail || 'Unable to load holders')
      }
    } catch (loadError) {
      notify?.(loadError.message || 'Unable to load holders')
    } finally {
      setHolderLoading(false)
    }
  }

  useEffect(() => {
    loadCertifications()
  }, [certPage, certPageSize, vendorName, query])

  useEffect(() => {
    loadHolders()
  }, [holderPage, holderPageSize, vendorName, certificationName, query])

  useEffect(() => {
    setCertPage(1)
  }, [vendorName, query])

  useEffect(() => {
    setHolderPage(1)
  }, [vendorName, certificationName, query])

  useEffect(() => {
    loadCompliance()
  }, [page, pageSize, query, vendorName])
  useEffect(() => {
    setPage(1)
  }, [query])

  const saveRequirement = async (vendor, required) => {
    const key = vendor
    setSaving(key)
    try {
      const response = await fetch(`${apiUrl}/partner-compliance/requirement`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor, certification: '__vendor__', required: Number(required) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to save required limit')
      await loadCompliance()
      notify?.(`Required limit updated for ${vendor}`)
    } catch (saveError) {
      notify?.(saveError.message || 'Unable to save required limit')
    } finally {
      setSaving('')
    }
  }

  if (loading) return <p className="user-empty">Loading partner compliance…</p>
  if (error) return <p className="user-empty">{error}</p>

  const vendor = vendors.find((item) => item.name === vendorName)
  // For paginated views, use the fetched data
  const certification =
    vendorName && certificationName
      ? certifications.find((c) => c.name === certificationName)
      : vendor?.certifications.find((item) => item.name === certificationName)
  const AchievedCount = summary.achieved
  const totalCompleted = summary.total_completed
  const totalRequired = summary.total_required
  const coverage = totalRequired
    ? Math.min(100, Math.round((totalCompleted / totalRequired) * 100))
    : 100

  if (vendorName && certificationName)
    return (
      <section className="compliance-view">
        <header className="compliance-credential-hero">
          <i className="bi bi-patch-check" />
          <div>
            <span>{vendorName} credential</span>
            <h2>{certificationName}</h2>
            <p>Employees with a validated certificate.</p>
          </div>
          <div className="credential-total">
            <b>{certification?.completed || 0}</b>
            <small>
              {certification?.completed === 1 ? 'certified holder' : 'certified holders'}
            </small>
          </div>
        </header>
        <div className="compliance-table-wrapper">
          <table className="compliance-table holders-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Email</th>
                <th>Certificate Number</th>
                <th>Completed Date</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(holderLoading ? [] : holders).map((holder) => (
                <tr key={holder.certificate_id}>
                  <td>
                    <div className="holder-cell">
                      <i>{initials(holder.name)}</i>
                      <div>
                        <b>{holder.name}</b>
                        <small>{holder.employee_id ? `ID: ${holder.employee_id}` : 'No employee ID'}</small>
                      </div>
                    </div>
                  </td>
                  <td>{holder.email || '-'}</td>
                  <td>{holder.certificate_number || 'Not recorded'}</td>
                  <td>{holder.issued_date || '-'}</td>
                  <td>
                    <span className="compliance-status achieved">
                      <i className="bi bi-check-circle-fill" /> Verified
                    </span>
                  </td>
                  <td>
                    {holder.employee_id ? (
                      <button
                        className="view-profile-btn"
                        onClick={() => goTo(`employees/${holder.employee_id}`)}
                      >
                        View profile
                      </button>
                    ) : (
                      <small>Profile unavailable</small>
                    )}
                  </td>
                </tr>
              ))}
              {!holderLoading && holders.length === 0 && (
                <tr>
                  <td colSpan="6" className="no-data">No certificate holders found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!holderLoading && holders.length > 0 && (
          <Pagination
            page={holderPage}
            totalItems={totalHolders}
            pageSize={holderPageSize}
            onPageChange={setHolderPage}
            onPageSizeChange={(size) => {
              setHolderPageSize(size)
              setHolderPage(1)
            }}
            label="holders"
          />
        )}
      </section>
    )

  if (vendorName)
    return (
      <section className="compliance-view">
        <header className="compliance-detail-head">
          <div>
            <span>OEM certifications</span>
            <h2>{vendorName}</h2>
            <p>Select a certification to review its employee holders.</p>
          </div>
          <b>
            {vendor?.completed || 0}
            <small>{vendor?.completed === 1 ? 'unique employee' : 'unique employees'}</small>
          </b>
        </header>
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Certification</th>
                <th>Completed</th>
                <th>Required</th>
                <th>Status</th>
                <th>Holders</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(certLoading ? [] : certifications).map((item) => (
                <tr key={item.name}>
                  <td>
                    <div className="cert-name-cell">
                      <b>{item.name}</b>
                      <small>{item.certifications?.length || 0} sub-types</small>
                    </div>
                  </td>
                  <td>{item.completed}</td>
                  <td>{item.required}</td>
                  <td>
                    <span className={`compliance-status ${item.completed >= item.required ? 'achieved' : 'at-risk'}`}>
                      {item.completed >= item.required ? 'Achieved' : 'At risk'}
                    </span>
                  </td>
                  <td>
                    <div className="holder-avatars">
                      {item.holders.slice(0, 5).map((holder) => (
                        <i key={holder.certificate_id} title={holder.name}>
                          {initials(holder.name)}
                        </i>
                      ))}
                      {item.holders.length > 5 && <em>+{item.holders.length - 5}</em>}
                    </div>
                  </td>
                  <td>
                    <button
                      className="view-holders-btn"
                      onClick={() => openOemView({ oem: vendorName, certification: item.name })}
                    >
                      View holders
                    </button>
                  </td>
                </tr>
              ))}
              {!certLoading && certifications.length === 0 && (
                <tr>
                  <td colSpan="6" className="no-data">No certifications found for this OEM.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!certLoading && certifications.length > 0 && (
          <Pagination
            page={certPage}
            totalItems={totalCertifications}
            pageSize={certPageSize}
            onPageChange={setCertPage}
            onPageSizeChange={(size) => {
              setCertPageSize(size)
              setCertPage(1)
            }}
            label="certifications"
          />
        )}
      </section>
    )

  return vendors.length || totalVendors ? (
    <section className="compliance-overview">
      <div className="compliance-pulse">
        <div className="compliance-pulse-copy">
          <span>PARTNER READINESS</span>
          <h2>OEM overview</h2>
          <p>
            <b>{coverage}% compliance coverage</b> calculated from validated employee
            certifications.
          </p>
        </div>
        <div className="compliance-pulse-stats">
          <div>
            <b>{totalVendors}</b>
            <small>OEMs tracked</small>
          </div>
          <div>
            <b>{AchievedCount}</b>
            <small>Achieved</small>
          </div>
          <div className={totalVendors - AchievedCount ? 'attention' : ''}>
            <b>{totalVendors - AchievedCount}</b>
            <small>At risk</small>
          </div>
        </div>
      </div>
      {viewToggle}
      <div className="compliance-grid">
        {vendors.map((item) => (
          <section className="er-card compliance-card compliance-oem-card" key={item.name}>
            <button
              className="compliance-card-link"
              onClick={() => openOemView({ oem: item.name })}
            >
              <header>
                <div>
                  <small>OEM</small>
                  <h3>{item.name}</h3>
                </div>
                <i className="bi bi-chevron-right" />
              </header>
              <b>
                {item.completed}
                <small> / {item.required} required</small>
              </b>
              <Progress completed={item.completed} required={item.required} />
              <p>
                {item.certifications.length} certification{' '}
                {item.certifications.length === 1 ? 'type' : 'types'} · Select to view
                certifications
              </p>
            </button>
            <form
              className="requirement-editor"
              onSubmit={(event) => {
                event.preventDefault()
                saveRequirement(item.name, event.currentTarget.elements.required.value)
              }}
            >
              <label>Required employees for this OEM</label>
              <input name="required" type="number" min="0" max="999" defaultValue={item.required} />
              <button disabled={saving === item.name}>
                {saving === item.name ? 'Saving…' : 'Save'}
              </button>
            </form>
          </section>
        ))}
      </div>
      <Pagination
        page={page}
        totalItems={totalVendors}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        label="OEMs"
      />
    </section>
  ) : (
    <p className="user-empty">No validated certificates are available for compliance.</p>
  )
}
