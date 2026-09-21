import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import CompactSelect from '../components/CompactSelect'
import Pagination from '../components/Pagination'
import { drawPdfHeader, loadCompanyLogo } from '../utils/pdfBranding'
import { categoryBadgeStyle } from '../utils/categoryPalette'

const apiUrl = process.env.REACT_APP_API_URL

const fieldOptions = [
  ['employee', 'Employee'],
  ['employeeId', 'Employee ID'],
  ['department', 'Department'],
  ['oem', 'OEM'],
  ['certification', 'Certification'],
  ['category', 'Category'],
  ['location', 'Location'],
  ['dateOfJoining', 'Date of joining'],
  ['validity', 'Validity'],
  ['certificateNumber', 'Certificate no.'],
  ['completed', 'Completed date'],
  ['expiry', 'Expiry date'],
  ['daysRemaining', 'Days remaining'],
  ['ruPoints', 'RU points'],
]

const defaultFields = ['employee', 'employeeId', 'department', 'oem', 'certification', 'category']

const initialFilters = { employee: '', location: '', department: '', tenure: '', oem: '', category: '', certification: '', validity: '' }
const tenureOptions = ['Under 2 yrs', '2–4 years', '4–6 years', '6-10 years', '10-15 years', '15-20 years', '20+ years']
const validityFilterOptions = ['Lifetime', 'Expires within 1 year', 'Expires within 2 years', 'Expires within 3 years', 'Expires after 3 years']

const formatDate = (value) => {
  if (!value) return 'Not recorded'
  if (value instanceof Date) {
    return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`
  }
  const [year, month, day] = String(value).slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : 'Not recorded'
}

const tenureFor = (dateOfJoining) => {
  if (!dateOfJoining) return 'Not recorded'
  const joined = new Date(`${String(dateOfJoining).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(joined.getTime())) return 'Not recorded'
  const years = (Date.now() - joined.getTime()) / 31_557_600_000
  return years < 2 ? 'Under 2 yrs' : years < 4 ? '2–4 years' : years < 6 ? '4–6 years' : years < 10 ? '6-10 years' : years < 15 ? '10-15 years' : years < 20 ? '15-20 years' : '20+ years'
}

const validityYearsFor = (certificate) => {
  if (Object.prototype.hasOwnProperty.call(certificate, 'validity_years')) {
    const years = certificate.validity_years
    return years === null || years === '' || Number(years) === 0 ? null : Number(years)
  }
  if (certificate.validity === 'lifetime') return null
  return { '1_year': 1, '2_years': 2, '3_years': 3 }[certificate.validity] || 3
}

const validityFor = (certificate) => {
  // An explicitly recorded expiry date is its own validity type. Do not infer
  // a duration band from it, as that makes the "Expiry date set" filter miss
  // valid certificates.
  if (certificate.expires_on) return 'Expiry date set'
  const years = validityYearsFor(certificate)
  if (years === null) return 'Lifetime'
  return years <= 1 ? 'Up to 1 yr' : years <= 2 ? 'Over 1 to 2 yrs' : years <= 3 ? 'Over 2 to 3 yrs' : 'Over 3 yrs'
}

const expiryFor = (certificate) => {
  if (certificate.expires_on) return new Date(`${String(certificate.expires_on).slice(0, 10)}T00:00:00`)
  const years = validityYearsFor(certificate)
  if (!years || !certificate.issued_date) return null
  const expiry = new Date(`${certificate.issued_date}T00:00:00`)
  expiry.setFullYear(expiry.getFullYear() + years)
  return expiry
}

const matchesValidityPeriod = (certificate, selectedPeriod) => {
  const validity = validityFor(certificate)
  if (selectedPeriod === 'Lifetime') return validity === 'Lifetime'
  // Never include a record displayed as Lifetime in an expiry-date period,
  // even if a legacy record contains inconsistent date fields.
  if (validity === 'Lifetime') return false
  const expiry = expiryFor(certificate)
  if (!expiry || Number.isNaN(expiry.getTime())) return false
  const years = Number(selectedPeriod.match(/\d+/)?.[0])
  if (!years) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cutoff = new Date(today)
  cutoff.setFullYear(cutoff.getFullYear() + years)
  return selectedPeriod === 'Expires after 3 years' ? expiry > cutoff : expiry <= cutoff
}

const currentEmployeeName = (certificate) => (
  certificate.employee_name || certificate.name ||
  `${certificate.firstName || ''} ${certificate.lastName || ''}`.trim() ||
  certificate.recipient_name || 'Not recorded'
)

const valuesFor = (certificate) => {
  const expiry = expiryFor(certificate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = expiry && !Number.isNaN(expiry.getTime()) ? Math.ceil((expiry - today) / 86_400_000) : null
  const points = Number(certificate.verified_ru_points ?? certificate.total_ru_points)
  const validity = validityFor(certificate)
  const validityDisplay = validity === 'Expiry date set' && expiry && !Number.isNaN(expiry.getTime())
    ? `Expiry date set (${formatDate(expiry)})`
    : validity
  return {
    employee: currentEmployeeName(certificate),
    employeeId: certificate.employeeId || certificate.employee_id || 'Not recorded',
    location: certificate.location || 'Not assigned',
    department: certificate.department || 'Not assigned',
    dateOfJoining: formatDate(certificate.dateOfJoining),
    tenure: tenureFor(certificate.dateOfJoining),
    certification: certificate.course_name || 'Untitled certification',
    oem: certificate.vendor_name || 'Not recorded',
    category: certificate.category || 'Other',
    validity: validityDisplay,
    certificateNumber: certificate.certificate_number || 'Not recorded',
    completed: formatDate(certificate.issued_date),
    expiry: expiry && !Number.isNaN(expiry.getTime()) ? formatDate(expiry) : validity === 'Lifetime' ? 'Lifetime' : 'Not recorded',
    daysRemaining: days === null ? '—' : `${days} days`,
    ruPoints: Number.isFinite(points) ? String(points) : '—',
  }
}

const unique = (items, key, fallback = '') => [...new Set(items.map((item) => item[key] || fallback).filter(Boolean))]
  .sort((first, second) => first.localeCompare(second))

const filterKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
const matchesFilter = (recordValue, selectedValue) => !selectedValue || filterKey(recordValue) === filterKey(selectedValue)

export default function ExportReportsPage() {
  const { notify, realtimeVersion } = useOutletContext()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [format, setFormat] = useState('pdf')
  const [filters, setFilters] = useState(initialFilters)
  const [fields, setFields] = useState(defaultFields)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      try {
        const reportParams = new URLSearchParams({ page: '1', page_size: '100' })
        Object.entries(filters).forEach(([key, value]) => {
          if (value) reportParams.set(key, value)
        })
        const firstResponse = await fetch(`${apiUrl}/reports/certificates?${reportParams}`, { cache: 'no-store' })
        const first = await firstResponse.json()
        if (!firstResponse.ok) throw new Error(first.detail || 'Unable to load export records')
        const pages = Math.ceil((first.total || 0) / 100)
        const remaining = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, async (_, index) => {
          const pageParams = new URLSearchParams(reportParams)
          pageParams.set('page', String(index + 2))
          const response = await fetch(`${apiUrl}/reports/certificates?${pageParams}`, { cache: 'no-store' })
          const result = await response.json()
          if (!response.ok) throw new Error(result.detail || 'Unable to load export records')
          return result.items || []
        }))
        let employees = []
        try {
          const employeeResponse = await fetch(`${apiUrl}/employees?page=1&page_size=100`, { cache: 'no-store' })
          if (employeeResponse.ok) {
            const employeeResult = await employeeResponse.json()
            const employeePages = Math.ceil((employeeResult.total || 0) / 100)
            const remainingEmployees = await Promise.all(Array.from({ length: Math.max(0, employeePages - 1) }, async (_, index) => {
              const response = await fetch(`${apiUrl}/employees?page=${index + 2}&page_size=100`, { cache: 'no-store' })
              if (!response.ok) return { items: [] }
              return response.json()
            }))
            employees = [employeeResult.items || [], ...remainingEmployees.map((result) => result.items || [])].flat()
          }
        } catch (employeeError) {
          employees = []
        }
        const employeesById = new Map(employees.map((employee) => [
          String(employee.id || '').trim(),
          employee,
        ]).filter(([id]) => id))
        const employeesByEmail = new Map(employees.map((employee) => [
          String(employee.employeeEmail || employee.email || '').toLowerCase(),
          employee,
        ]).filter(([email]) => email))
        const enrichedRecords = [...(first.items || []), ...remaining.flat()].map((certificate) => ({
          ...certificate,
          ...(employeesById.get(String(certificate.employee_profile_id || '').trim()) ||
            employeesByEmail.get(String(certificate.email || '').toLowerCase()) || {}),
        }))
        if (active) {
          setRecords(enrichedRecords)
          setError('')
        }
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load export records')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [filters, realtimeVersion])

  const reportValues = useMemo(() => records.map(valuesFor), [records])

  const options = useMemo(() => ({
    employees: unique(reportValues, 'employee'),
    locations: unique(reportValues, 'location'),
    departments: unique(reportValues, 'department'),
    tenures: tenureOptions,
    oems: unique(reportValues, 'oem'),
    categories: unique(reportValues, 'category'),
    certifications: unique(reportValues, 'certification'),
    validities: validityFilterOptions,
  }), [reportValues])

  const filtered = useMemo(() => records.filter((item) => {
    const values = valuesFor(item)
    const isExpiryPeriod = filters.validity.startsWith('Expires')
    const isLifetimeRecord = values.validity === 'Lifetime' || values.expiry === 'Lifetime' || values.daysRemaining === '—'
    if (isExpiryPeriod && isLifetimeRecord) return false
    const matchesValidity = !filters.validity || (
      filters.validity === 'Lifetime'
        ? values.validity === 'Lifetime'
        : matchesValidityPeriod(item, filters.validity)
    )
    return matchesFilter(values.employee, filters.employee) &&
      matchesFilter(values.location, filters.location) &&
      matchesFilter(values.department, filters.department) &&
      matchesFilter(values.tenure, filters.tenure) &&
      matchesFilter(values.oem, filters.oem) &&
      matchesFilter(values.category, filters.category) &&
      matchesFilter(values.certification, filters.certification) &&
      matchesValidity
  }), [filters, records])

  const selectedFields = fieldOptions.filter(([key]) => fields.includes(key))
  const visibleRecords = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])
  const activeFilterCount = Object.values(filters).filter(Boolean).length
  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
  }
  const toggleField = (key) => setFields((current) => current.includes(key) ? current.filter((field) => field !== key) : [...current, key])

  const exportPdf = async () => {
    if (!filtered.length || !selectedFields.length) return
    setExporting(true)
    try {
      const document = new jsPDF({ orientation: selectedFields.length > 6 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true })
      const logo = await loadCompanyLogo()
      const summary = [
        filters.employee,
        filters.certification,
        filters.location,
        filters.department,
        filters.tenure,
        filters.oem,
        filters.category,
        filters.validity,
      ].filter(Boolean).join(' · ') || 'All active certification records'
      const header = { title: 'Certification export report', subtitle: summary }
      drawPdfHeader(document, logo, header)
      autoTable(document, {
        startY: 34,
        margin: { top: 34 },
        head: [selectedFields.map(([, label]) => label)],
        body: filtered.map((item) => {
          const values = valuesFor(item)
          return selectedFields.map(([key]) => values[key])
        }),
        theme: 'grid',
        headStyles: { fillColor: [189, 41, 66], textColor: 255, fontSize: 7.5 },
        styles: { fontSize: 7.2, cellPadding: 2, textColor: [75, 39, 48], overflow: 'linebreak' },
        willDrawPage: ({ pageNumber }) => { if (pageNumber > 1) drawPdfHeader(document, logo, header) },
      })
      const pageWidth = document.internal.pageSize.getWidth()
      const pageHeight = document.internal.pageSize.getHeight()
      const pages = document.getNumberOfPages()
      for (let page = 1; page <= pages; page += 1) {
        document.setPage(page)
        document.setFontSize(8)
        document.setTextColor(125, 83, 92)
        document.text(`Generated ${formatDate(new Date().toISOString())} · Page ${page} of ${pages}`, pageWidth - 14, pageHeight - 7, { align: 'right' })
      }
      document.save(`certification-export-${new Date().toISOString().slice(0, 10)}.pdf`)
      notify?.(`Exported ${filtered.length} certification ${filtered.length === 1 ? 'record' : 'records'}`)
    } catch (exportError) {
      notify?.(exportError.message || 'Unable to create the PDF')
    } finally {
      setExporting(false)
    }
  }

  const exportExcel = () => {
    if (!filtered.length || !selectedFields.length) return
    setExporting(true)
    try {
      const rows = filtered.map((item) => {
        const values = valuesFor(item)
        return Object.fromEntries(selectedFields.map(([key, label]) => [label, values[key]]))
      })
      const worksheet = XLSX.utils.json_to_sheet(rows, { header: selectedFields.map(([, label]) => label) })
      worksheet['!cols'] = selectedFields.map(([, label]) => ({
        wch: Math.min(42, Math.max(label.length + 2, ...rows.map((row) => String(row[label] ?? '').length + 2))),
      }))
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Certification records')
      XLSX.writeFile(workbook, `certification-export-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true })
      notify?.(`Exported ${filtered.length} certification ${filtered.length === 1 ? 'record' : 'records'} to Excel`)
    } catch (exportError) {
      notify?.(exportError.message || 'Unable to create the Excel file')
    } finally {
      setExporting(false)
    }
  }

  const startExport = () => format === 'excel' ? exportExcel() : exportPdf()

  return <section className="export-reports-page">
    <header className="export-reports-hero">
      <div><span>REPORT BUILDER</span><h1>Export certification data</h1><p>Choose exactly what the report should include, review the matches, and download it as PDF or Excel.</p></div>
      {/* <div className="export-result-count"><i className="bi bi-bar-chart-line" /><b>{filtered.length}</b><small>matching records · {activeFilterCount} active filters</small></div> */}
    </header>

    <div className="export-builder-grid">
      <aside className="er-card export-filter-card">
        <header><div><span>STEP 1</span><h2>Filter records</h2></div>{activeFilterCount > 0 && <button type="button" onClick={() => { setFilters(initialFilters); setPage(1) }}>Clear all</button>}</header>
        <div className="export-filter-fields">
          <label>Employee<CompactSelect value={filters.employee} onChange={(event) => setFilter('employee', event.target.value)}><option value="">All employees</option>{options.employees.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label>
          <label>Location<CompactSelect value={filters.location} onChange={(event) => setFilter('location', event.target.value)}><option value="">All locations</option>{options.locations.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label>
          <label>Department<CompactSelect value={filters.department} onChange={(event) => setFilter('department', event.target.value)}><option value="">All departments</option>{options.departments.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label>
          <label>Tenure<CompactSelect value={filters.tenure} onChange={(event) => setFilter('tenure', event.target.value)}><option value="">All tenure bands</option>{options.tenures.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label>
          <label>Certification name<CompactSelect value={filters.certification} onChange={(event) => setFilter('certification', event.target.value)}><option value="">All certifications</option>{options.certifications.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label>
          <label>OEM<CompactSelect value={filters.oem} onChange={(event) => setFilter('oem', event.target.value)}><option value="">All OEMs</option>{options.oems.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label>
          <label>Category<CompactSelect value={filters.category} onChange={(event) => setFilter('category', event.target.value)}><option value="">All categories</option>{options.categories.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label>
          <label>Validity / expiry period<CompactSelect value={filters.validity} onChange={(event) => setFilter('validity', event.target.value)}><option value="">All validity periods</option>{options.validities.map((value) => <option key={value} value={value}>{value}</option>)}</CompactSelect></label>
        </div>
      </aside>

      <section className="er-card export-fields-card">
        <header><div><span>STEP 2</span><h2>Choose export columns</h2></div><button type="button" onClick={() => setFields(fields.length === fieldOptions.length ? [] : fieldOptions.map(([key]) => key))}>{fields.length === fieldOptions.length ? 'Deselect all' : 'Select all'}</button></header>
        <div className="export-field-options">{fieldOptions.map(([key, label]) => <label key={key} className={fields.includes(key) ? 'selected' : ''}><input type="checkbox" checked={fields.includes(key)} onChange={() => toggleField(key)} /><i className={`bi ${fields.includes(key) ? 'bi-check-circle-fill' : 'bi-circle'}`} /><span>{label}</span></label>)}</div>
      </section>
    </div>

    <section className="er-card export-preview-card">
      <header><div><span>STEP 3</span><h2>Review &amp; export</h2><p>{activeFilterCount ? `${activeFilterCount} ${activeFilterCount === 1 ? 'filter' : 'filters'} applied` : 'All active records selected'} · {fields.length} columns</p></div><div className="export-actions"><div className="export-format" role="group" aria-label="Export format"><button type="button" className={format === 'pdf' ? 'active' : ''} onClick={() => setFormat('pdf')}><i className="bi bi-file-earmark-pdf" /> PDF</button><button type="button" className={format === 'excel' ? 'active' : ''} onClick={() => setFormat('excel')}><i className="bi bi-file-earmark-excel" /> Excel</button></div><button type="button" className="export-download" disabled={loading || exporting || !filtered.length || !fields.length} onClick={startExport}><i className={`bi ${exporting ? 'bi-arrow-repeat export-spin' : format === 'excel' ? 'bi-file-earmark-excel' : 'bi-file-earmark-pdf'}`} />{exporting ? 'Preparing…' : `Download ${format === 'excel' ? 'Excel' : 'PDF'}`}</button></div></header>
      {loading ? <div className="export-empty"><i className="bi bi-arrow-repeat export-spin" /><b>Loading records…</b></div> : error ? <div className="export-empty error"><i className="bi bi-exclamation-circle" /><b>{error}</b></div> : !filtered.length ? <div className="export-empty"><i className="bi bi-search" /><b>No matching records</b><span>Try clearing one or more filters.</span></div> : !fields.length ? <div className="export-empty"><i className="bi bi-layout-three-columns" /><b>Choose at least one export column</b></div> : <><div className="global-table-scroll"><table className="er-table export-preview-table"><thead><tr>{selectedFields.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{visibleRecords.map((item) => { const values = valuesFor(item); return <tr key={item.id}>{selectedFields.map(([key]) => <td key={key}>{key === 'category' ? <span className="category-badge" style={categoryBadgeStyle(values[key])}>{values[key]}</span> : values[key]}</td>)}</tr> })}</tbody></table></div><Pagination page={page} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} label="records" /></>}
    </section>
  </section>
}
