import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Pagination from '../components/Pagination'
const apiUrl = process.env.REACT_APP_API_URL
 
const fetchWithTimeout = (url, options = {}) => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => window.clearTimeout(timeout))
}
const initials = (name) => String(name || 'Unknown').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
const normalizedOem = (value) => {
  const vendor = String(value || '').trim() || 'Not recorded'
  return vendor
}
const complianceFromCertificates = (certificates) => {
  const grouped = new Map()
  certificates.filter((item) => item.status === 'issued').forEach((certificate) => {
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
  return [...grouped.entries()].map(([name, courses]) => {
    const vendorHolders = new Set()
    const certifications = [...courses.entries()].map(([course, holders]) => {
      holders.forEach((_, key) => vendorHolders.add(key))
      return { name: course, holders: [...holders.values()], completed: holders.size, required: 1 }
    })
    return { name, completed: vendorHolders.size, required: 1, certifications }
  }).sort((first, second) => first.name.localeCompare(second.name))
}
 
function Progress({ completed, required }) {
  const Achieved = completed >= required
  const width = required ? Math.min(100, (completed / required) * 100) : 100
  return <><i className="compliance-track"><em className={Achieved ? 'green' : 'red'} style={{ width: `${width}%` }} /></i><span className={Achieved ? 'green' : 'red'}>{Achieved ? 'Achieved' : 'At risk'}</span></>
}
 
export default function CompliancePage({ goTo, notify, viewToggle, query = '' }) {
  const [vendors, setVendors] = useState([])
  const [totalVendors, setTotalVendors] = useState(0)
  const [summary, setSummary] = useState({ achieved: 0, total_completed: 0, total_required: 0 })
  const [page, setPage] = useState(1)
  const pageSize = 6
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
 
  const loadCompliance = async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        search: query.trim(),
        vendor: vendorName,
      })
      const response = await fetchWithTimeout(`${apiUrl}/partner-compliance?${params}`, { cache: 'no-store' })
      const result = await response.json()
      if (response.ok) {
        setVendors(result.vendors || [])
        setTotalVendors(result.total ?? (result.vendors || []).length)
        setSummary(result.summary || { achieved: 0, total_completed: 0, total_required: 0 })
      } else if (response.status === 404) {
        const certificatesResponse = await fetchWithTimeout(`${apiUrl}/certificates?page=1&page_size=100`, { cache: 'no-store' })
        const certificatesResult = await certificatesResponse.json()
        if (!certificatesResponse.ok) throw new Error(certificatesResult.detail || 'Unable to load certificates')
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
      setError(loadError.name === 'AbortError' ? 'Partner compliance took too long to load. Please refresh and try again.' : loadError.message || 'Unable to load partner compliance')
    } finally { setLoading(false) }
  }
 
  useEffect(() => { loadCompliance() }, [page, query, vendorName])
  useEffect(() => { setPage(1) }, [query])
 
  const saveRequirement = async (vendor, required) => {
    const key = vendor
    setSaving(key)
    try {
      const response = await fetch(`${apiUrl}/partner-compliance/requirement`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor, certification: '__vendor__', required: Number(required) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to save required limit')
      await loadCompliance()
      notify?.(`Required limit updated for ${vendor}`)
    } catch (saveError) { notify?.(saveError.message || 'Unable to save required limit') }
    finally { setSaving('') }
  }
 
  if (loading) return <p className="user-empty">Loading partner compliance…</p>
  if (error) return <p className="user-empty">{error}</p>
 
  const vendor = vendors.find((item) => item.name === vendorName)
  const certification = vendor?.certifications.find((item) => item.name === certificationName)
  const search = query.trim().toLowerCase()
  const visibleVendors = vendors.filter((item) => !search || [item.name, ...item.certifications.flatMap((cert) => [cert.name, ...cert.holders.flatMap((holder) => [holder.name, holder.email, holder.certificate_number])])].join(' ').toLowerCase().includes(search))
  const visibleCertifications = vendor?.certifications.filter((item) => !search || [item.name, ...item.holders.flatMap((holder) => [holder.name, holder.email, holder.certificate_number])].join(' ').toLowerCase().includes(search)) || []
  const visibleHolders = certification?.holders.filter((holder) => !search || Object.values(holder).join(' ').toLowerCase().includes(search)) || []
  const AchievedCount = summary.achieved
  const totalCompleted = summary.total_completed
  const totalRequired = summary.total_required
  const coverage = totalRequired ? Math.min(100, Math.round((totalCompleted / totalRequired) * 100)) : 100
 
  if (vendor && certification) return <section className="compliance-view">
    <header className="compliance-credential-hero">
      <i className="bi bi-patch-check" />
      <div><span>{vendor.name} credential</span><h2>{certification.name}</h2><p>Employees with a validated certificate.</p></div>
      <div className="credential-total"><b>{certification.completed}</b><small>{certification.completed === 1 ? 'certified holder' : 'certified holders'}</small></div>
    </header>
    <div className="compliance-holders holder-card-grid">{visibleHolders.map((holder) => <button key={holder.certificate_id} className="er-card compliance-holder holder-profile-card" onClick={() => holder.employee_id && goTo(`employees/${holder.employee_id}`)} disabled={!holder.employee_id}>
      <div className="holder-profile-head"><i>{initials(holder.name)}</i><span><b>{holder.name}</b><small>{holder.email}</small></span><em><i className="bi bi-check-circle-fill" /> Verified</em></div>
      <div className="holder-credential-meta"><span><small>Certificate number</small><b>{holder.certificate_number || 'Not recorded'}</b></span><span><small>Completed</small><b>{holder.issued_date}</b></span></div>
      <footer><span>View employee profile</span>{holder.employee_id ? <i className="bi bi-arrow-right" /> : <small>Profile unavailable</small>}</footer>
    </button>)}</div>
  </section>
 
  if (vendor) return <section className="compliance-view">
    <header className="compliance-detail-head">
      <div><span>OEM certifications</span><h2>{vendor.name}</h2><p>Select a certification to review its employee holders.</p></div>
      <b>{vendor.completed}<small>{vendor.completed === 1 ? 'unique employee' : 'unique employees'}</small></b>
    </header>
    <div className="compliance-grid compliance-cert-grid">{visibleCertifications.map((item) => {
      return <section className="er-card compliance-card certification-card" key={item.name}>
        <button className="compliance-card-link" onClick={() => openOemView({ oem: vendor.name, certification: item.name })}><header><h3>{item.name}</h3><i className="bi bi-chevron-right" /></header><b>{item.completed}<small>{item.completed === 1 ? ' employee completed' : ' employees completed'}</small></b><p>Select to view certificate holders</p><div className="certification-profiles" aria-label={`${item.completed} certificate holders`}>{item.holders.slice(0, 5).map((holder) => <i key={holder.certificate_id} title={holder.name}>{initials(holder.name)}</i>)}{item.holders.length > 5 && <em>+{item.holders.length - 5}</em>}</div></button>
      </section>
    })}</div>
  </section>
 
  return (vendors.length || totalVendors) ? <section className="compliance-overview">
    <div className="compliance-pulse">
      <div className="compliance-pulse-copy"><span>PARTNER READINESS</span><h2>OEM overview</h2><p><b>{coverage}% compliance coverage</b> calculated from validated employee certifications.</p></div>
      <div className="compliance-pulse-stats">
        <div><b>{totalVendors}</b><small>OEMs tracked</small></div>
        <div><b>{AchievedCount}</b><small>Achieved</small></div>
        <div className={totalVendors - AchievedCount ? 'attention' : ''}><b>{totalVendors - AchievedCount}</b><small>At risk</small></div>
      </div>
    </div>
    {viewToggle}
    <div className="compliance-grid">{visibleVendors.map((item) => <section className="er-card compliance-card compliance-oem-card" key={item.name}>
    <button className="compliance-card-link" onClick={() => openOemView({ oem: item.name })}><header><div><small>OEM</small><h3>{item.name}</h3></div><i className="bi bi-chevron-right" /></header><b>{item.completed}<small> / {item.required} required</small></b><Progress completed={item.completed} required={item.required} /><p>{item.certifications.length} certification {item.certifications.length === 1 ? 'type' : 'types'} · Select to view certifications</p></button>
    <form className="requirement-editor" onSubmit={(event) => { event.preventDefault(); saveRequirement(item.name, event.currentTarget.elements.required.value) }}>
      <label>Required employees for this OEM</label><input name="required" type="number" min="0" max="999" defaultValue={item.required} /><button disabled={saving === item.name}>{saving === item.name ? 'Saving…' : 'Save'}</button>
    </form>
    </section>)}</div>
    <Pagination page={page} totalItems={totalVendors} pageSize={pageSize} onPageChange={setPage} label="OEMs" />
    </section> : <p className="user-empty">No validated certificates are available for compliance.</p>
}
 
 
