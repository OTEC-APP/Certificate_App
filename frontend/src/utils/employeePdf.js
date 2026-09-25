import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { drawPdfHeader, loadCompanyLogo } from './pdfBranding'

const RED = [189, 41, 66]
const TEXT = [75, 39, 48]
const MUTED = [125, 83, 92]

const safeFileName = (value) => String(value || 'employee').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')

const roleFor = (role) => String(role || '').toLowerCase() === 'admin' ? 'Administrator' : 'User'

const validityYearsFor = (certificate) => {
  if (Object.prototype.hasOwnProperty.call(certificate, 'validity_years')) {
    const years = certificate.validity_years
    return years === null || years === '' || Number(years) === 0 ? null : Number(years)
  }
  if (certificate.validity === 'lifetime') return null
  return { '1_year': 1, '2_years': 2, '3_years': 3 }[certificate.validity] || 3
}

const expiryFor = (certificate) => {
  if (certificate.expires_on) return new Date(`${String(certificate.expires_on).slice(0, 10)}T00:00:00`)
  const years = validityYearsFor(certificate)
  if (!years) return null
  const expiry = new Date(`${certificate.issued_date}T00:00:00`)
  expiry.setFullYear(expiry.getFullYear() + years)
  return expiry
}

const isCurrentCertificate = (certificate) => {
  if (certificate.status !== 'issued') return false
  const expiry = expiryFor(certificate)
  if (!expiry) return true
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return expiry >= today
}

const tenureFor = (dateOfJoining) => {
  if (!dateOfJoining) return 'Not recorded'
  const joined = new Date(`${String(dateOfJoining).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(joined.getTime())) return 'Not recorded'
  const today = new Date()
  if (joined > today) return '0 years 0 months'
  let years = today.getFullYear() - joined.getFullYear()
  let months = today.getMonth() - joined.getMonth()
  if (today.getDate() < joined.getDate()) months -= 1
  if (months < 0) {
    years -= 1
    months += 12
  }
  return `${years} ${years === 1 ? 'year' : 'years'} ${months} ${months === 1 ? 'month' : 'months'}`
}

const employeeDetails = (employee, certificates) => ({
  name: ['Employee name', employee.name || 'Not recorded'],
  employeeId: ['Employee ID', employee.employeeId || 'Not recorded'],
  email: ['Email', employee.email || 'Not recorded'],
  department: ['Department', employee.department || 'Not assigned'],
  role: ['Role', roleFor(employee.role)],
  location: ['Location', employee.location || 'Not assigned'],
  reportingManager: ['Reporting manager', employee.reportingManager || 'Not assigned'],
  tenure: ['Tenure', tenureFor(employee.dateOfJoining)],
  certificateCount: ['Completed certifications', String(certificates.length)],
})

const certificateValue = (certificate, field) => {
  const expiry = expiryFor(certificate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = expiry ? Math.ceil((expiry - today) / 86_400_000) : null
  const ruPoints = Number(certificate.verified_ru_points ?? certificate.total_ru_points)
  return {
    certification: certificate.course_name || 'Untitled certificate',
    employee: certificate.recipient_name || 'Not recorded',
    oem: certificate.vendor_name || 'Not recorded',
    category: certificate.category || 'Other',
    certificateNumber: certificate.certificate_number || 'Not recorded',
    completed: certificate.issued_date || 'Not recorded',
    validity: certificate.expires_on ? 'Expiry date set' : expiry ? `${validityYearsFor(certificate)} years` : 'Lifetime',
    expiry: expiry ? expiry.toLocaleDateString('en-US') : 'Lifetime',
    daysRemaining: days === null ? '—' : `${days} days`,
    ruPoints: Number.isFinite(ruPoints) ? String(ruPoints) : '—',
  }[field]
}

export async function exportEmployeePdf(employee, options) {
  const document = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const activeCertificates = (employee.certificates || []).filter((certificate) => {
    if (!isCurrentCertificate(certificate)) return false
    const oemMatches = !options.oem || options.oem === 'all' ||
      (certificate.vendor_name || 'OEM not recorded') === options.oem
    const categoryMatches = !options.category || options.category === 'all' ||
      (certificate.category || 'Other') === options.category
    return oemMatches && categoryMatches
  })
  const selectedEmployeeFields = options.employeeFields || []
  const selectedCertificateFields = options.certificateFields || []
  const detailValues = employeeDetails(employee, activeCertificates)
  const details = selectedEmployeeFields.filter((field) => detailValues[field]).map((field) => detailValues[field])
  const certificateColumns = options.certificateColumns.filter((column) => selectedCertificateFields.includes(column.key))

  const logoData = await loadCompanyLogo()
  const header = { title: employee.name || 'Employee record', subtitle: [roleFor(employee.role), employee.location, employee.department].filter(Boolean).join(' · ') }
  drawPdfHeader(document, logoData, header)

  if (details.length) {
    const detailRows = []
    for (let index = 0; index < details.length; index += 2) {
      const first = details[index]
      const second = details[index + 1] || ['', '']
      detailRows.push([first[0], first[1], second[0], second[1]])
    }
    autoTable(document, {
      startY: 33,
      margin: { top: 34 },
      theme: 'plain',
      body: detailRows,
      styles: { fontSize: 9, cellPadding: 2.5, textColor: TEXT },
      columnStyles: { 0: { fontStyle: 'bold', textColor: MUTED }, 2: { fontStyle: 'bold', textColor: MUTED } },
      willDrawPage: (data) => {
        if (data.pageNumber > 1) drawPdfHeader(document, logoData, header)
      },
    })
  }

  const certificateStart = details.length ? document.lastAutoTable.finalY + 10 : 38
  document.setFontSize(13)
  document.setTextColor(...TEXT)
  document.text('Completed certifications', 14, certificateStart)
  if (certificateColumns.length) {
    autoTable(document, {
      startY: certificateStart + 4,
      margin: { top: 34 },
      head: [certificateColumns.map((column) => column.label)],
      body: activeCertificates.map((certificate) => certificateColumns.map((column) => certificateValue(certificate, column.key))),
      theme: 'grid',
      headStyles: { fillColor: RED, textColor: 255, fontSize: 7.5 },
      styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak', textColor: TEXT },
      willDrawPage: (data) => {
        if (data.pageNumber > 1) drawPdfHeader(document, logoData, header)
      },
    })
  }

  const pages = document.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    document.setPage(page)
    document.setFontSize(8)
    document.setTextColor(...MUTED)
    document.text(`Generated ${new Date().toLocaleDateString('en-US')} · Page ${page} of ${pages}`, 196, 290, { align: 'right' })
  }
  document.save(`${safeFileName(employee.name)}-certification-report.pdf`)
}
