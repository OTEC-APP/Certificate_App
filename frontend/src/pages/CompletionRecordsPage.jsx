import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
const apiUrl = process.env.REACT_APP_API_URL
import Pagination from '../components/Pagination'
import CompactSelect from '../components/CompactSelect'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { renewalTimeLabel } from '../utils/renewalTime'
import { categoryBadgeStyle } from '../utils/categoryPalette'
import { loadCompanyLogo, drawPdfHeader } from '../utils/pdfBranding'
 
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const formatDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Not recorded'
 
const validityYearsFor = (certificate) => {
  if (Object.prototype.hasOwnProperty.call(certificate, 'validity_years')) {
    const years = certificate.validity_years
    return years === null || years === '' || Number(years) === 0 ? null : Number(years)
  }
  if (certificate.validity === 'lifetime') return null
  return { '1_year': 1, '2_years': 2, '3_years': 3 }[certificate.validity] || 3
}
 
const certificateDates = (certificate) => {
  if (certificate.expires_on) {
    const expiry = new Date(`${String(certificate.expires_on).slice(0, 10)}T00:00:00`)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return { expiry, daysRemaining: Math.ceil((expiry - today) / 86_400_000), validity: 'Expiry date set' }
  }
  const years = validityYearsFor(certificate)
  if (!years) return { expiry: null, daysRemaining: null, validity: 'Lifetime' }
  const expiry = new Date(`${certificate.issued_date}T00:00:00`)
  expiry.setFullYear(expiry.getFullYear() + years)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return {
    expiry,
    daysRemaining: Math.ceil((expiry - today) / 86_400_000),
    validity: `${years} ${years === 1 ? 'year' : 'years'}`,
  }
}
 
 
const ruPointsFor = (certificate) => {
  const numericPoints = Number(certificate.verified_ru_points ?? certificate.total_ru_points)
  return Number.isFinite(numericPoints) ? numericPoints : null
}

// const ctsCredentialType = (certificate) => {
//   const name = `${certificate.course_name || ''} ${certificate.vendor_name || ''}`.toUpperCase()
//   const normalizedName = name.replace(/[^A-Z0-9]+/g, ' ').trim()
//   if (name.includes('CTS-D') || normalizedName.includes('CTS D') || normalizedName.includes('CERTIFIED TECHNOLOGY SPECIALIST DESIGN') || normalizedName.includes('CERTIFIED TECHNOLOGY SPECIALIST D')) return 'CTS-D'
//   if (name.includes('CTS-I') || normalizedName.includes('CTS I') || normalizedName.includes('CERTIFIED TECHNOLOGY SPECIALIST INSTALL') || normalizedName.includes('CERTIFIED TECHNOLOGY SPECIALIST I')) return 'CTS-I'
//   return name.includes('CTS') || normalizedName.includes('CERTIFIED TECHNOLOGY SPECIALIST') ? 'CTS' : ''
// }
const ctsCredentialType = (certificate) => {
  // TEMP FIX: only treat AVIXA-issued certificates as CTS credentials.
  const vendor = String(certificate.vendor_name || '').trim().toUpperCase()
  const course = String(certificate.course_name || '').trim().toUpperCase()

  const isAvixa = vendor.includes('AVIXA') || vendor.includes('INFOCOMM')
if (!isAvixa) return ''

  const normalizedCourse = course.replace(/[^A-Z0-9]+/g, ' ').trim()
  const words = normalizedCourse.split(/\s+/)

  if (
    course.includes('CTS-D') ||
    normalizedCourse.includes('CTS D') ||
    normalizedCourse.includes('CERTIFIED TECHNOLOGY SPECIALIST DESIGN') ||
    normalizedCourse.includes('CERTIFIED TECHNOLOGY SPECIALIST D')
  ) return 'CTS-D'

  if (
    course.includes('CTS-I') ||
    normalizedCourse.includes('CTS I') ||
    normalizedCourse.includes('CERTIFIED TECHNOLOGY SPECIALIST INSTALL') ||
    normalizedCourse.includes('CERTIFIED TECHNOLOGY SPECIALIST I')
  ) return 'CTS-I'

  if (words.includes('CTS') || normalizedCourse.includes('CERTIFIED TECHNOLOGY SPECIALIST')) return 'CTS'

  return ''
}
 
export default function CompletionRecordsPage() {
  const { query = '', realtimeVersion } = useOutletContext()
  const [params] = useSearchParams()
  const category = params.get('category')
  const employee = params.get('employee')
  const credential = params.get('credential')
  const credentialType = params.get('credentialType')
  const year = params.get('year') || String(new Date().getFullYear())
  const month = Number(params.get('month')) || null
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [filters, setFilters] = useState({ employee: '', oem: '', category: '', certificateNumber: '' })
  const [exporting, setExporting] = useState(false)
 
  useEffect(() => {
    setLoading(true)
    setPage(1)
    fetch(`${apiUrl}/certificates?page=1&page_size=100`, { cache: 'no-store' }).then(async (response) => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to load completion records')
      setRecords((result.items || []).filter((item) => item.status === 'issued' && (credentialType
        ? (() => {
            return ctsCredentialType(item) === credentialType.toUpperCase()
          })()
        : credential
        ? credential.toUpperCase() === 'CTS'
          ? Boolean(ctsCredentialType(item))
          : `${item.course_name || ''} ${item.vendor_name || ''}`.toLowerCase().includes(credential.toLowerCase())
        : employee
        ? String(item.recipient_name || '').toLowerCase() === employee.toLowerCase()
        : category
          ? String(item.category || 'Other').toLowerCase() === category.toLowerCase()
          : String(item.issued_date).startsWith(`${year}-`) && (!month || Number(String(item.issued_date).slice(5, 7)) === month))))
      setError('')
    }).catch((loadError) => setError(loadError.message || 'Unable to load completion records')).finally(() => setLoading(false))
  }, [year, month, category, employee, credential, credentialType, realtimeVersion])
 
  const filteredRecords = useMemo(() => {
    const search = query.trim().toLowerCase()
    return records.filter((item) => {
      const dates = certificateDates(item)
      const searchable = [item.course_name, item.recipient_name, item.vendor_name, item.category,
        item.certificate_number, item.issued_date, dates.validity,
        dates.expiry?.toLocaleDateString('en-US'), dates.daysRemaining, ruPointsFor(item)]
        .join(' ').toLowerCase()
      return (!search || searchable.includes(search)) &&
        (!filters.employee || String(item.recipient_name || '').toLowerCase().includes(filters.employee.toLowerCase())) &&
        (!filters.oem || String(item.vendor_name || '').toLowerCase().includes(filters.oem.toLowerCase())) &&
        (!filters.category || String(item.category || '').toLowerCase().includes(filters.category.toLowerCase())) &&
        (!filters.certificateNumber || String(item.certificate_number || '').toLowerCase().includes(filters.certificateNumber.toLowerCase()))
    })
  }, [filters, query, records])
  useEffect(() => setPage(1), [query, filters])
  const visible = useMemo(() => filteredRecords.slice((page - 1) * pageSize, page * pageSize), [filteredRecords, page, pageSize])
  const filterOptions = useMemo(() => ({
    employees: [...new Set(records.map((item) => item.recipient_name).filter(Boolean))].sort(),
    oems: [...new Set(records.map((item) => item.vendor_name || 'Not recorded'))].sort(),
    categories: [...new Set(records.map((item) => item.category || 'Other'))].sort(),
    certificateNumbers: [...new Set(records.map((item) => item.certificate_number).filter(Boolean))].sort(),
  }), [records])
  const selectedCredential = credentialType || credential
  const period = selectedCredential ? `${selectedCredential} holders` : employee || category || (month ? `${monthNames[month - 1]} ${year}` : year)
  const description = selectedCredential ? `Validated certificates matching the ${selectedCredential} credential.` : employee ? `Validated certificates for ${employee}.` : category ? `Validated certificates recorded in the ${category} category.` : `Validated certificates completed during the selected ${month ? 'month' : 'year'}.`
  const exportRecordsPdf = async () => {
    if (!filteredRecords.length) return
    setExporting(true)
    try {
      const document = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
      const logoData = await loadCompanyLogo()
      const appliedFilters = [
        filters.employee && `Employee: ${filters.employee}`,
        filters.oem && `OEM: ${filters.oem}`,
        filters.category && `Category: ${filters.category}`,
        filters.certificateNumber && `Certificate number: ${filters.certificateNumber}`,
        query && `Search: ${query}`,
      ].filter(Boolean)
      drawPdfHeader(document, logoData, { title: 'Certificate Completion Records', subtitle: appliedFilters.length ? appliedFilters.join('  |  ') : 'All validated certificates' })
      autoTable(document, {
        startY: 33,
        head: [['Certification', 'Employee', 'OEM', 'Category', 'Certificate no.', 'Completed', 'Validity', 'Expiry', 'RU points']],
        body: filteredRecords.map((item) => {
          const { expiry, validity } = certificateDates(item)
          const points = ruPointsFor(item)
          return [item.course_name, item.recipient_name, item.vendor_name || 'Not recorded', item.category || 'Other', item.certificate_number, formatDate(item.issued_date), validity, expiry ? expiry.toLocaleDateString('en-US') : 'Lifetime', points === null ? '—' : String(points)]
        }),
        theme: 'grid',
        headStyles: { fillColor: [189, 41, 66], textColor: 255, fontSize: 8 },
        styles: { fontSize: 7.5, cellPadding: 2, textColor: [75, 39, 48], overflow: 'linebreak' },
        willDrawPage: (data) => { if (data.pageNumber > 1) drawPdfHeader(document, logoData, { title: 'Certificate Completion Records', subtitle: appliedFilters.length ? appliedFilters.join('  |  ') : 'All validated certificates' }) },
      })
      const pages = document.getNumberOfPages()
      for (let pdfPage = 1; pdfPage <= pages; pdfPage += 1) {
        document.setPage(pdfPage)
        document.setFontSize(8)
        document.setTextColor(125, 83, 92)
        document.text(`Generated ${new Date().toLocaleDateString('en-US')} | Page ${pdfPage} of ${pages}`, 283, 202, { align: 'right' })
      }
      document.save(`completion-records-${new Date().toISOString().slice(0, 10)}.pdf`)
    } finally {
      setExporting(false)
    }
  }
  return <section className="completion-records-page">
    <div className="completion-records-hero">
      <div className="completion-hero-copy"><span>{selectedCredential ? 'CREDENTIAL RECORDS' : employee ? 'EMPLOYEE CERTIFICATES' : category ? 'CATEGORY RECORDS' : 'COMPLETION RECORDS'}</span><h2>{period}</h2><p>{description}</p></div>
      <div className="completion-hero-actions"><button type="button" className="completion-export" disabled={exporting || !filteredRecords.length} onClick={exportRecordsPdf}><i className={`bi ${exporting ? 'bi-arrow-repeat' : 'bi-file-earmark-pdf'}`} /><span>{exporting ? 'Exporting...' : 'Export PDF'}</span></button><b>{filteredRecords.length}<small>{filteredRecords.length === 1 ? 'certificate' : 'certificates'}</small></b></div>
      <div className="completion-filter-popup"><header><b><i className="bi bi-funnel" /> Filter table parameters</b><div>{Object.values(filters).some(Boolean) && <button type="button" className="completion-popup-clear" onClick={() => setFilters({ employee: '', oem: '', category: '', certificateNumber: '' })}>Clear all filters</button>}</div></header><label>Employee<CompactSelect value={filters.employee} onChange={(event) => setFilters((current) => ({ ...current, employee: event.target.value }))}><option value="">All employees</option>{filterOptions.employees.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label><label>OEM<CompactSelect value={filters.oem} onChange={(event) => setFilters((current) => ({ ...current, oem: event.target.value }))}><option value="">All OEMs</option>{filterOptions.oems.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label><label>Category<CompactSelect value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="">All categories</option>{filterOptions.categories.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label><label>Certificate number<CompactSelect value={filters.certificateNumber} onChange={(event) => setFilters((current) => ({ ...current, certificateNumber: event.target.value }))}><option value="">All certificate numbers</option>{filterOptions.certificateNumbers.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label></div>
    </div>
    <section className="er-card completion-records-card">
      {loading ? <p className="user-empty">Loading completion records…</p> : error ? <p className="user-empty">{error}</p> : !filteredRecords.length ? <p className="user-empty">No validated certificates match the current search and filters.</p> : <div className="global-table-scroll"><table className="er-table"><thead><tr><th>Certification</th><th>Employee</th><th>OEM</th><th>Category</th><th>Certificate number</th><th>Completed</th><th>Validity</th>
      <th>Expiry date</th>
      <th>Days remaining</th><th>RU points</th></tr></thead><tbody>{visible.map((item) => {
      const { expiry, daysRemaining, validity } = certificateDates(item)
      const ruPoints = ruPointsFor(item)
      return <tr key={item.id}><td><b>{item.course_name}</b></td><td>{item.recipient_name}</td><td>{item.vendor_name || 'Not recorded'}</td><td><span className="category-badge" style={categoryBadgeStyle(item.category)}>{item.category || 'Other'}</span></td><td>{item.certificate_number}</td><td>{formatDate(item.issued_date)}</td><td>{validity}</td><td>{expiry ? expiry.toLocaleDateString('en-US') : 'Lifetime'}</td><td>{renewalTimeLabel(daysRemaining)}</td><td>{ruPoints === null ? '—' : ruPoints}</td></tr>
    })}</tbody></table></div>}
    {!loading && !error && filteredRecords.length > 0 && <Pagination page={page} totalItems={filteredRecords.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} label="certificates" />}</section>
  </section>
}
 
 
 
 
