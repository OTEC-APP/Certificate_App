// import { useEffect, useMemo, useState } from 'react'
// import UserCertificateModal from '../components/UserCertificateModal'
// import { useLocation } from 'react-router-dom'
// import { confirmDelete } from '../dialogs'
// const apiUrl = process.env.REACT_APP_API_URL
// import VerificationFileButton from '../components/VerificationFileButton'
// import CompactSelect from '../components/CompactSelect'
// import { renewalTimeLabel } from '../utils/renewalTime'

// const shortMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// const validityYearsFor = (certificate) => {
//   if (Object.prototype.hasOwnProperty.call(certificate, 'validity_years')) {
//     const value = certificate.validity_years
//     return value === null || value === '' || Number(value) === 0 ? null : Number(value)
//   }
//   return { lifetime: null, '1_year': 1, '2_years': 2, '3_years': 3 }[
//     certificate.validity
//   ] ?? null
// }

// const expiryFor = (certificate) => {
//   if (certificate.expires_on) return new Date(`${String(certificate.expires_on).slice(0, 10)}T00:00:00`)
//   const years = validityYearsFor(certificate)
//   if (!years) return null
//   const issued = new Date(`${certificate.issued_date}T00:00:00`)
//   issued.setFullYear(issued.getFullYear() + Number(years))
//   return issued
// }
 
// const oemColors = ['#5147e5', '#f09b2e', '#10a58e', '#e25573', '#4385e8']
// const validityLabel = (certificate) => {
//   if (certificate.expires_on) return 'Expiry date set'
//   const years = validityYearsFor(certificate)
//   return years ? `${years} ${Number(years) === 1 ? 'year' : 'years'}` : 'Lifetime'
// }

// const oemFor = (certificate) => {
//   if (certificate.vendor_name?.trim()) return certificate.vendor_name.trim()
//   const name = certificate.course_name?.toLowerCase() || ''
//   if (name.includes('avixa') || name.includes('cts')) return 'AVIXA'
//   if (name.includes('crestron')) return 'Crestron'
//   if (name.includes('q-sys')) return 'QSC'
//   if (name.includes('dante')) return 'Audinate'
//   if (name.includes('cisco')) return 'Cisco'
//   return 'Other'
// }

// const certificateStatusLabel = (status) => (
//   status === 'issued' ? 'Validated' : status === 'pending' ? 'Under Review' : status === 'revoked' ? 'Revoked' : status
// )

// const newestCertificateFirst = (first, second) => {
//   const firstDate = Date.parse(first.created_at || `${first.issued_date || '1970-01-01'}T00:00:00`) || 0
//   const secondDate = Date.parse(second.created_at || `${second.issued_date || '1970-01-01'}T00:00:00`) || 0
//   return secondDate - firstDate
// }

// export default function UserDashboardPage({
//   user,
//   openCertificateForm,
//   runWithLoader,
//   notify,
//   goTo,
//   query = '',
//   realtimeVersion,
//   initialTab = 'overview',
// }) {
//   const location = useLocation()
//   const isProfileRoute = location.pathname.split('/')[1] === 'my-profile'
//   const isRenewalsRoute = location.pathname.split('/')[1] === 'upcoming-renewals'
//   const isProjectManager = user?.role === 'project_manager'
//   const isAdminProfile = isProfileRoute && user.role === 'admin'
//   const [certificates, setCertificates] = useState([])
//   const [loading, setLoading] = useState(true)
//   const [tab, setTab] = useState(initialTab)
//   const [editingCertificate, setEditingCertificate] = useState(null)
//   const [certificateSearch, setCertificateSearch] = useState('')
//   const [certificateOem, setCertificateOem] = useState('all')
//   const [certificateStatus, setCertificateStatus] = useState('all')
//   const [configuredOems, setConfiguredOems] = useState([])
//   const [monthlyRank, setMonthlyRank] = useState({ rank: null, certificate_count: 0 })
//   const [completionPeriod, setCompletionPeriod] = useState('year')
//   const [selectedCompletionYear, setSelectedCompletionYear] = useState(String(new Date().getFullYear()))

//   useEffect(() => setTab(initialTab), [initialTab])
//   useEffect(() => setCertificateSearch(query), [query])

//   useEffect(() => {
//     fetch(`${apiUrl}/access-options/oems`)
//       .then(async (response) => response.ok ? response.json() : [])
//       .then((oems) => setConfiguredOems((oems || []).map((item) => item.name).filter(Boolean).sort()) )
//       .catch(() => setConfiguredOems([]))
//   }, [realtimeVersion])

//   useEffect(() => {
//     fetch(`${apiUrl}/monthly-rankings?email=${encodeURIComponent(user.employeeEmail || '')}`)
//       .then(async (response) => response.ok ? response.json() : { rank: null, certificate_count: 0 })
//       .then((result) => setMonthlyRank({
//         rank: result.rank ?? null,
//         certificate_count: Number(result.certificate_count) || 0,
//       }))
//       .catch(() => setMonthlyRank({ rank: null, certificate_count: 0 }))
//   }, [realtimeVersion, user.employeeEmail])

//   const loadCertificates = async (showLoader = true) => {
//     try {
//       const request = () =>
//         fetch(
//           `${apiUrl}/certificates?search=${encodeURIComponent(user.employeeEmail)}&page=1&page_size=100`,
//         )
//       const response = showLoader ? await runWithLoader('Loading your certificates', request) : await request()
//       if (!response.ok) throw new Error('Unable to load certificates')
//       const result = await response.json()
//       const savedCertificates = result.items || []
//       setCertificates(
//         savedCertificates.filter(
//           (certificate) => certificate.email?.toLowerCase() === user.employeeEmail.toLowerCase(),
//         ),
//       )
//     } catch (error) {
//       notify(error.message || 'Unable to load your certificates')
//     } finally {
//       setLoading(false)
//     }
//   }
//   useEffect(() => {
//     // Keep the existing loading overlay for the first visit only. WebSocket
//     // updates refresh data quietly so the dashboard is never interrupted.
//     loadCertificates(realtimeVersion === 0)
//   }, [realtimeVersion, user.employeeEmail])
 
//   const [renewals, setRenewals] = useState([])
 
//   const loadRenewals = async () => {
//     try {
//       const response = await fetch(
//         `${apiUrl}/renewals?email=${encodeURIComponent(user.employeeEmail)}&page=1&page_size=100`,
//       )
//       if (!response.ok) throw new Error('Unable to load your renewal alerts')
//       const result = await response.json()
//       setRenewals(
//         (result.items || []).map((certificate) => ({
//           ...certificate,
//           expiry: new Date(`${certificate.expiry_date}T00:00:00`),
//         })),
//       )
//     } catch (error) {
//       notify(error.message || 'Unable to load your renewal alerts')
//     }
//   }
 
//   useEffect(() => {
//     loadRenewals()
//   }, [realtimeVersion, user.employeeEmail])
 

//   // Approval is performed by an administrator in a different session. Refresh
//   // quietly so a user sees its decision without needing to sign out or reload.
 
//   const activeCount = certificates.filter((certificate) => certificate.status === 'issued').length
//   const approvedCertificates = useMemo(
//     () => certificates.filter((certificate) => certificate.status === 'issued'),
//     [certificates],
//   )
//   const certificateOems = useMemo(() => configuredOems.length
//     ? configuredOems
//     : [...new Set(certificates.map(oemFor))].sort((first, second) => first.localeCompare(second)),
//   [certificates, configuredOems])
//   const filteredCertificates = useMemo(() => {
//     const search = certificateSearch.trim().toLowerCase()
//     return certificates.filter((certificate) => {
//       const matchesSearch = !search || [
//         certificate.course_name,
//         certificate.certificate_number,
//         oemFor(certificate),
//       ].some((value) => String(value || '').toLowerCase().includes(search))
//       const matchesOem = certificateOem === 'all' || oemFor(certificate) === certificateOem
//       const matchesStatus = certificateStatus === 'all' || certificate.status === certificateStatus
//       return matchesSearch && matchesOem && matchesStatus
//     }).sort(newestCertificateFirst)
//   }, [certificates, certificateSearch, certificateOem, certificateStatus])
//   const oemRows = useMemo(
//     () =>
//       Object.entries(
//         approvedCertificates.reduce((counts, certificate) => {
//           const oem = oemFor(certificate)
//           counts[oem] = (counts[oem] || 0) + 1
//           return counts
//         }, {}),
//       ).sort(([, first], [, second]) => second - first),
//     [approvedCertificates],
//   )
//   const yearRows = useMemo(() => {
//     const currentYear = new Date().getFullYear()
//     const joiningYear = new Date(`${String(user?.dateOfJoining || '').slice(0, 10)}T00:00:00`).getFullYear()
//     const firstYear = Number.isFinite(joiningYear) && joiningYear <= currentYear
//       ? joiningYear
//       : currentYear - 5
//     const counts = approvedCertificates.reduce((total, certificate) => {
//       const year = new Date(`${certificate.issued_date}T00:00:00`).getFullYear()
//       total[year] = (total[year] || 0) + 1
//       return total
//     }, {})
//     return Array.from({ length: currentYear - firstYear + 1 }, (_, index) => {
//       const year = firstYear + index
//       return [year, counts[year] || 0]
//     })
//   }, [approvedCertificates, user?.dateOfJoining])
//   const monthRows = useMemo(() => {
//     const counts = approvedCertificates.reduce((total, certificate) => {
//       const issued = new Date(`${certificate.issued_date}T00:00:00`)
//       if (issued.getFullYear() === Number(selectedCompletionYear)) total[issued.getMonth()] = (total[issued.getMonth()] || 0) + 1
//       return total
//     }, {})
//     return shortMonthNames.map((name, index) => [name, counts[index] || 0])
//   }, [approvedCertificates, selectedCompletionYear])

//   const deleteCertificate = async (certificate) => {
//     const confirmed = await confirmDelete({
//       name: certificate.course_name,
//       itemLabel: 'certificate',
//     })
//     if (!confirmed) return
//     try {
//       const response = await runWithLoader('Deleting certificate', () =>
//         fetch(`${apiUrl}/certificates/${certificate.id}`, { method: 'DELETE' }),
//       )
//       if (!response.ok) {
//         const result = await response.json()
//         throw new Error(result.detail || 'Unable to delete certificate')
//       }
//       window.dispatchEvent(new Event('certificates-updated'))
//       notify(`Deleted "${certificate.course_name}" certificate`)
//     } catch (error) {
//       notify(error.message || 'Unable to delete certificate')
//     }
//   }

//   const currentHour = new Date().getHours()
//   const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening'
//   const greetingDate = new Intl.DateTimeFormat('en-IN', {
//     weekday: 'long', day: 'numeric', month: 'long',
//   }).format(new Date())
//   const dashboardName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'User'

//   return (
//     <section className="user-dashboard">
//       {!isProfileRoute && !isRenewalsRoute && (
//         <section className="dashboard-greeting" aria-label={`${greeting}, ${dashboardName}`}>
//           <div>
//             <span><i className="bi bi-grid-1x2" aria-hidden="true" /> CERTIFICATION DASHBOARD</span>
//             <h2>{greeting}, {dashboardName}
//               {/* <small>Here is the latest certification and compliance overview.</small>     */}
//             </h2>
//             <p className="user-greeting-details">
//               {isProjectManager && <strong><i className="bi bi-person-badge" aria-hidden="true" /> Role: Project Manager</strong>}
//               <strong><i className="bi bi-person-vcard" aria-hidden="true" /> Employee ID: {user?.employeeId || user?.employee_id || user?.id || 'Not assigned'}</strong>
//               <strong><i className="bi bi-building" aria-hidden="true" /> Department: {user?.department || 'Not assigned'}</strong>
//             </p>
//           </div>
//           <time dateTime={new Date().toISOString().slice(0, 10)}>
//             <i className="bi bi-calendar3" aria-hidden="true" /> {greetingDate}
//           </time>
//         </section>
//       )}
//       {isAdminProfile && (
//         <section className="admin-profile-banner">
//           <div className="admin-profile-avatar">{`${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}` || 'A'}</div>
//           <div><span>ADMIN PROFILE</span><h1>{user.firstName} {user.lastName}</h1><p>{user.employeeEmail || user.email} · {user.department || 'Administration'}</p></div>
//           <strong><i className="bi bi-shield-check" /> Administrator</strong>
//         </section>
//       )}
//       {isAdminProfile && (
//         <nav className="profile-certificate-tabs" aria-label="Admin certificate views">
//           <button
//             type="button"
//             className={tab === 'certificates' ? 'active' : ''}
//             onClick={() => setTab('certificates')}
//             aria-pressed={tab === 'certificates'}
//           >
//             <i className="bi bi-patch-check" aria-hidden="true" /> My certificates
//           </button>
//           <button
//             type="button"
//             className={tab === 'renewals' ? 'active' : ''}
//             onClick={() => setTab('renewals')}
//             aria-pressed={tab === 'renewals'}
//           >
//             <i className="bi bi-clock-history" aria-hidden="true" /> Upcoming renewals
//             {renewals.length > 0 && <span>{renewals.length}</span>}
//           </button>
//           <button type="button" onClick={() => goTo('my-course-list')}>
//             <i className="bi bi-list-check" aria-hidden="true" /> My course list
//           </button>
//         </nav>
//       )}
//       {tab === 'overview' && (
//         <>
//           <div className="user-kpis">
//             <article
//               className="user-kpi-link"
//               role="button"
//               tabIndex={0}
//               onClick={() => goTo('my-certificates')}
//               onKeyDown={(event) => event.key === 'Enter' && goTo('my-certificates')}
//             >
//               <i className="bi bi-patch-check" />
//               <span>
//                 Active certificates<b>{activeCount}</b>
//               </span>
//             </article>
//             <article
//               className="user-kpi-link"
//               role="button"
//               tabIndex={0}
//               onClick={() => goTo('upcoming-renewals')}
//               onKeyDown={(event) => event.key === 'Enter' && goTo('upcoming-renewals')}
//             >
//               <i className="bi bi-clock-history" />
//               <span>
//                 Upcoming renewals<b>{renewals.length}</b>
//                 <small>Next 90 days</small>
//               </span>
//             </article>
//             <article>
//               <i className="bi bi-trophy" />
//               <span>
//                 Current month rank<b>{monthlyRank.rank || '—'}</b>
//                 <small>{monthlyRank.certificate_count ? `${monthlyRank.certificate_count} validated ${monthlyRank.certificate_count === 1 ? 'certificate' : 'certificates'}` : 'No validated certificates this month'}</small>
//               </span>
//             </article>
//           </div>
//           <div className="user-chart-grid">
//             <OemChart rows={oemRows} />
//             <YearChart rows={completionPeriod === 'year' ? yearRows : monthRows} period={completionPeriod} selectedYear={selectedCompletionYear} years={yearRows.map(([year]) => String(year))} onPeriodChange={setCompletionPeriod} onYearChange={setSelectedCompletionYear} />
//           </div>
//           <section className="er-card user-renewal-card">
//             <header>
//               <div>
//                 <h3>Upcoming renewals</h3>
//                 <p>We will notify you before a certificate expires.</p>
//               </div>
//               <button className="card-action" onClick={() => setTab('renewals')}>
//                 View all
//               </button>
//             </header>
//             <RenewalList renewals={renewals} onAdd={openCertificateForm} />
//           </section>
//         </>
//       )}
//       {tab === 'certificates' && (
//         <section className="er-card user-table-card">
//           <header>
//             <div>
//               <h3>My certificates</h3>
//               <p>{isAdminProfile ? 'Certificates recorded for this administrator.' : `Certificates recorded under ${user.employeeEmail}`}</p>
//             </div>
//             <button className="er-add" onClick={openCertificateForm}>
//               <i className="bi bi-plus-lg" /> Add certificate
//             </button>
//           </header>
//           <div className="user-certificate-filters" aria-label="Certificate filters">
//             <label className="user-certificate-search">
//               <i className="bi bi-search" aria-hidden="true" />
//               <input
//                 type="search"
//                 value={certificateSearch}
//                 onChange={(event) => setCertificateSearch(event.target.value)}
//                 placeholder="Search certificate or number"
//                 aria-label="Search my certificates"
//               />
//             </label>
//             <label>
//               <span>OEM</span>
//               <CompactSelect value={certificateOem} onChange={(event) => setCertificateOem(event.target.value)}>
//                 <option value="all">All OEMs</option>
//                 {certificateOems.map((oem) => <option key={oem} value={oem}>{oem}</option>)}
//               </CompactSelect>
//             </label>
//             <label>
//               <span>Status</span>
//               <CompactSelect value={certificateStatus} onChange={(event) => setCertificateStatus(event.target.value)}>
//                 <option value="all">All statuses</option>
//                 <option value="issued">Validated</option>
//                 <option value="pending">Under Review</option>
//                 <option value="revoked">Revoked</option>
//               </CompactSelect>
//             </label>
//             {(certificateSearch || certificateOem !== 'all' || certificateStatus !== 'all') && (
//               <button type="button" onClick={() => {
//                 setCertificateSearch('')
//                 setCertificateOem('all')
//                 setCertificateStatus('all')
//               }}>
//                 <i className="bi bi-x-lg" aria-hidden="true" /> Clear
//               </button>
//             )}
//           </div>
//           <CertificateTable
//             certificates={filteredCertificates}
//             loading={loading}
//             onEdit={setEditingCertificate}
//             onDelete={deleteCertificate}
//             notify={notify}
//             runWithLoader={runWithLoader}
//           />
//         </section>
//       )}
//       {tab === 'renewals' && (
//         <section className="er-card user-renewal-card">
//           <header>
//             <div>
//               <h3>Upcoming renewals</h3>
//               <p>{isAdminProfile ? 'Review this administrator’s certificates approaching their renewal date.' : 'Review certificates approaching their renewal date.'}</p>
//             </div>
//           </header>
//           <RenewalList renewals={renewals} onAdd={openCertificateForm} />
//         </section>
//       )}
//       {editingCertificate && (
//         <UserCertificateModal
//           certificate={editingCertificate}
//           close={() => setEditingCertificate(null)}
//           notify={notify}
//           runWithLoader={runWithLoader}
//           user={user}
//         />
//       )}
//     </section>
//   )
// }

// function OemChart({ rows }) {
//   const max = Math.max(...rows.map(([, count]) => count), 1)
//   return (
//     <section className="er-card user-chart-card">
//       <header>
//         <div>
//           <h3>Certifications by OEM wise</h3>
//           <p>Your certificates grouped by issuing organisation.</p>
//         </div>
//       </header>
//       {rows.length ? (
//         <div className="user-oem-bars">
//           {rows.map(([oem, count], index) => (
//             <div key={oem}>
//               <span>{oem}</span>
//               <i>
//                 <b
//                   style={{
//                     width: `${(count / max) * 100}%`,
//                     background: oemColors[index % oemColors.length],
//                   }}
//                 />
//               </i>
//               <strong>{count}</strong>
//             </div>
//           ))}
//         </div>
//       ) : (
//         <p className="user-chart-empty">Add a certificate to see your OEM-wise summary.</p>
//       )}
//     </section>
//   )
// }

// function YearChart({ rows, period, selectedYear, years, onPeriodChange, onYearChange }) {
//   return (
//     <section className="er-card user-chart-card">
//       <header>
//         <div>
//           <h3>Certifications completed by {period}</h3>
//           <p>{period === 'year' ? 'Your recorded completion history.' : `Your completions in ${selectedYear}.`}</p>
//         </div>
//         <div className="completion-chart-controls">
//           <div className="completion-chart-toggle">
//             <button type="button" className={period === 'month' ? 'active' : ''} onClick={() => onPeriodChange('month')}>Month</button>
//             <button type="button" className={period === 'year' ? 'active' : ''} onClick={() => onPeriodChange('year')}>Year</button>
//           </div>
//           {period === 'month' && <label className="completion-year-select">Year<select value={selectedYear} onChange={(event) => onYearChange(event.target.value)} aria-label="Choose a year for monthly completions">{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>}
//         </div>
//       </header>
//       <UserCompletionLineChart rows={rows} period={period} />
//     </section>
//   )
// }

// function UserCompletionLineChart({ rows, period }) {
//   const [hoveredIndex, setHoveredIndex] = useState(null)
//   const [scrollLeft, setScrollLeft] = useState(0)
//   const width = Math.max(620, rows.length * 72)
//   const height = 240
//   const padding = { top: 16, right: 30, bottom: 32, left: 10 }
//   const graphWidth = width - padding.left - padding.right
//   const graphHeight = height - padding.top - padding.bottom
//   const dataMax = Math.max(0, ...rows.map(([, count]) => Number(count) || 0))
//   const yMax = Math.max(4, Math.ceil(dataMax / 4) * 4)
//   const xStep = rows.length > 1 ? graphWidth / (rows.length - 1) : graphWidth
//   const points = rows.map(([label, rawCount], index) => {
//     const count = Number(rawCount) || 0
//     return { label, count, index, x: padding.left + (rows.length > 1 ? index * xStep : graphWidth / 2), y: height - padding.bottom - (count / yMax) * graphHeight }
//   })
//   const linePath = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
//   const areaPath = points.length ? `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z` : ''
//   const gridLines = Array.from({ length: 5 }, (_, index) => ({ value: yMax - (yMax / 4) * index, y: padding.top + (graphHeight / 4) * index }))
//   const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex]

//   return <div className="line-chart-layout user-completion-line-chart">
//     <div className="line-chart-y-axis">{gridLines.map(({ value }) => <span key={value}>{value}</span>)}</div>
//     <div className="line-chart-scroll-container" onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}>
//       <svg className="line-chart-svg" viewBox={`0 0 ${width} ${height}`} style={{ width: `${width}px`, height: `${height}px` }} aria-label={`Certifications completed by ${period} line chart`}>
//         <defs><linearGradient id="lineChartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d84457" stopOpacity="0.3" /><stop offset="100%" stopColor="#d84457" stopOpacity="0" /></linearGradient></defs>
//         {gridLines.map(({ y }) => <line key={y} x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="line-chart-grid-line" />)}
//         <path d={areaPath} className="line-chart-area" /><path d={linePath} className="line-chart-path" />
//         {points.map((point) => <g key={point.label}><text x={point.x} y={height - 15} textAnchor="middle" className="line-chart-axis-label">{point.label}</text><circle cx={point.x} cy={point.y} r={hoveredIndex === point.index ? 7 : 4} className="line-chart-dot" onPointerEnter={() => setHoveredIndex(point.index)} onPointerLeave={() => setHoveredIndex(null)} /></g>)}
//       </svg>
//     </div>
//     {hoveredPoint && <div className="line-chart-tooltip" role="status" style={{ left: `calc(40px + ${hoveredPoint.x - scrollLeft}px)`, top: `${hoveredPoint.y + 42}px` }}><span>{hoveredPoint.label}</span><strong>{hoveredPoint.count} completed</strong></div>}
//   </div>
// }

// function CertificateTable({ certificates, loading, onEdit, onDelete, notify, runWithLoader }) {
//   if (loading) return <p className="user-empty">Loading your certificates...</p>
//   if (!certificates.length)
//     return (
//       <p className="user-empty">
//         No certificates saved yet. Use "Add certificate" to add your first one.
//       </p>
//     )
//   return (
//     <div className="global-table-scroll">
//     <table className="er-table user-cert-table">
//       <thead>
//         <tr>
//           <th>Certificate</th>
//           <th>OEM</th>
//           <th>Certificate no.</th>
//           <th>Validity</th>
//           <th>Renewal / expiry</th>
//           <th>Completed</th>
//           <th>Status</th>
//           <th>Evidence</th>
//           <th>Actions</th>
//         </tr>
//       </thead>
//       <tbody>
//         {certificates.map((certificate) => (
//           <tr key={certificate.id}>
//             <td>
//               <b>{certificate.course_name}</b>
//             </td>
//             <td>{certificate.vendor_name || oemFor(certificate)}</td>
//             <td>
//               <code>{certificate.certificate_number}</code>
//             </td>
//             <td>{validityLabel(certificate)}</td>
//             <td>
//               {expiryFor(certificate)
//                 ? expiryFor(certificate).toLocaleDateString('en-IN')
//                 : 'No expiry'}
//             </td>
//             <td>{certificate.issued_date}</td>
//             <td>
//               <span className={`user-status ${certificate.status}`}>{certificateStatusLabel(certificate.status)}</span>
//             </td>
//             <td>
//               <VerificationFileButton
//                 certificateId={certificate.id}
//                 hasFile={Boolean(certificate.verification_image_path)}
//                 notify={notify}
//                 runWithLoader={runWithLoader}
//               />
//             </td>
//             <td className="user-certificate-actions">
//               <button
//                 type="button"
//                 onClick={() => onEdit(certificate)}
//                 aria-label="Edit certificate"
//               >
//                 <i className="bi bi-pencil" />
//               </button>
//               <button
//                 type="button"
//                 className="delete"
//                 onClick={() => onDelete(certificate)}
//                 aria-label="Delete certificate"
//               >
//                 <i className="bi bi-trash3" />
//               </button>
//             </td>
//           </tr>
//         ))}
//       </tbody>
//     </table>
//     </div>
//   )
// }

// function RenewalList({ renewals, onAdd }) {
//   if (!renewals.length)
//     return (
//       <div className="user-empty">
//         <i className="bi bi-shield-check" />
//         <b>No upcoming renewals</b>
//         <p>Your active certificates do not expire in the next 90 days.</p>
//         <button className="outline-action" style={{ margin: '14px 0 22px' }} onClick={onAdd}>
//           Add certificate
//         </button>
//       </div>
//     )
//   return (
//     <div className="user-renewals">
//       {renewals.map((certificate) => {
//         const days = certificate.days_remaining
//         const isOverdue = days < 0
//         const isUrgent = days <= 30
//         return (
//           <article key={certificate.id}>
//             <i className={isUrgent ? 'urgent bi bi-exclamation-circle' : 'bi bi-clock'} />
//             <div>
//               <b>{certificate.course_name}</b>
//               <small>
//                 {isOverdue ? 'Expired' : 'Expires'}{' '}
//                 {certificate.expiry.toLocaleDateString('en-IN', {
//                   day: '2-digit',
//                   month: 'short',
//                   year: 'numeric',
//                 })}
//               </small>
//               <small className="renewal-certificate-details">
//                 {certificate.vendor_name || oemFor(certificate)} · Certificate no. {certificate.certificate_number || 'Not recorded'}
//               </small>
//             </div>
//             <em className={isUrgent ? 'urgent' : ''}>
//               {renewalTimeLabel(days)}
//             </em>
//           </article>
//         )
//       })}
//     </div>
//   )
// }







import { useEffect, useMemo, useState } from 'react'
import UserCertificateModal from '../components/UserCertificateModal'
import { useLocation } from 'react-router-dom'
import { confirmDelete } from '../dialogs'
const apiUrl = process.env.REACT_APP_API_URL
import VerificationFileButton from '../components/VerificationFileButton'
import CompactSelect from '../components/CompactSelect'
import { renewalTimeLabel } from '../utils/renewalTime'

const shortMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const validityYearsFor = (certificate) => {
  if (Object.prototype.hasOwnProperty.call(certificate, 'validity_years')) {
    const value = certificate.validity_years
    return value === null || value === '' || Number(value) === 0 ? null : Number(value)
  }
  return { lifetime: null, '1_year': 1, '2_years': 2, '3_years': 3 }[
    certificate.validity
  ] ?? null
}

const expiryFor = (certificate) => {
  if (certificate.expires_on) return new Date(`${String(certificate.expires_on).slice(0, 10)}T00:00:00`)
  const years = validityYearsFor(certificate)
  if (!years) return null
  const issued = new Date(`${certificate.issued_date}T00:00:00`)
  issued.setFullYear(issued.getFullYear() + Number(years))
  return issued
}
 
const oemColors = ['#5147e5', '#f09b2e', '#10a58e', '#e25573', '#4385e8']
const formatDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Not recorded'
const validityLabel = (certificate) => {
  if (certificate.expires_on) return 'Expiry date set'
  const years = validityYearsFor(certificate)
  return years ? `${years} ${Number(years) === 1 ? 'year' : 'years'}` : 'Lifetime'
}

const oemFor = (certificate) => {
  if (certificate.vendor_name?.trim()) return certificate.vendor_name.trim()
  const name = certificate.course_name?.toLowerCase() || ''
  if (name.includes('avixa') || name.includes('cts')) return 'AVIXA'
  if (name.includes('crestron')) return 'Crestron'
  if (name.includes('q-sys')) return 'QSC'
  if (name.includes('dante')) return 'Audinate'
  if (name.includes('cisco')) return 'Cisco'
  return 'Other'
}

const certificateStatusLabel = (status) => (
  status === 'issued' ? 'Validated' : status === 'pending' ? 'Under Review' : status === 'revoked' ? 'Revoked' : status
)

const newestCertificateFirst = (first, second) => {
  const firstDate = Date.parse(first.created_at || `${first.issued_date || '1970-01-01'}T00:00:00`) || 0
  const secondDate = Date.parse(second.created_at || `${second.issued_date || '1970-01-01'}T00:00:00`) || 0
  return secondDate - firstDate
}

export default function UserDashboardPage({
  user,
  openCertificateForm,
  runWithLoader,
  notify,
  goTo,
  query = '',
  realtimeVersion,
  initialTab = 'overview',
}) {
  const location = useLocation()
  const isProfileRoute = location.pathname.split('/')[1] === 'my-profile'
  const isRenewalsRoute = location.pathname.split('/')[1] === 'upcoming-renewals'
  const isAdminProfile = isProfileRoute && user.role === 'admin'
  const [certificates, setCertificates] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(initialTab)
  const [editingCertificate, setEditingCertificate] = useState(null)
  const [certificateSearch, setCertificateSearch] = useState('')
  const [certificateOem, setCertificateOem] = useState('all')
  const [certificateStatus, setCertificateStatus] = useState('all')
  const [configuredOems, setConfiguredOems] = useState([])
  const [monthlyRank, setMonthlyRank] = useState({ rank: null, certificate_count: 0 })
  const [completionPeriod, setCompletionPeriod] = useState('year')
  const [selectedCompletionYear, setSelectedCompletionYear] = useState(String(new Date().getFullYear()))

  useEffect(() => setTab(initialTab), [initialTab])
  useEffect(() => setCertificateSearch(query), [query])

  useEffect(() => {
    fetch(`${apiUrl}/access-options/oems`)
      .then(async (response) => response.ok ? response.json() : [])
      .then((oems) => setConfiguredOems((oems || []).map((item) => item.name).filter(Boolean).sort()) )
      .catch(() => setConfiguredOems([]))
  }, [realtimeVersion])

  useEffect(() => {
    fetch(`${apiUrl}/monthly-rankings?email=${encodeURIComponent(user.employeeEmail || '')}`)
      .then(async (response) => response.ok ? response.json() : { rank: null, certificate_count: 0 })
      .then((result) => setMonthlyRank({
        rank: result.rank ?? null,
        certificate_count: Number(result.certificate_count) || 0,
      }))
      .catch(() => setMonthlyRank({ rank: null, certificate_count: 0 }))
  }, [realtimeVersion, user.employeeEmail])

  const loadCertificates = async (showLoader = true) => {
    try {
      const request = () =>
        fetch(
          `${apiUrl}/certificates?search=${encodeURIComponent(user.employeeEmail)}&page=1&page_size=100`,
        )
      const response = showLoader ? await runWithLoader('Loading your certificates', request) : await request()
      if (!response.ok) throw new Error('Unable to load certificates')
      const result = await response.json()
      const savedCertificates = result.items || []
      setCertificates(
        savedCertificates.filter(
          (certificate) => certificate.email?.toLowerCase() === user.employeeEmail.toLowerCase(),
        ),
      )
    } catch (error) {
      notify(error.message || 'Unable to load your certificates')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    // Keep the existing loading overlay for the first visit only. WebSocket
    // updates refresh data quietly so the dashboard is never interrupted.
    loadCertificates(realtimeVersion === 0)
  }, [realtimeVersion, user.employeeEmail])
 
  const [renewals, setRenewals] = useState([])
 
  const loadRenewals = async () => {
    try {
      const response = await fetch(
        `${apiUrl}/renewals?email=${encodeURIComponent(user.employeeEmail)}&page=1&page_size=100`,
      )
      if (!response.ok) throw new Error('Unable to load your renewal alerts')
      const result = await response.json()
      setRenewals(
        (result.items || []).map((certificate) => ({
          ...certificate,
          expiry: new Date(`${certificate.expiry_date}T00:00:00`),
        })),
      )
    } catch (error) {
      notify(error.message || 'Unable to load your renewal alerts')
    }
  }
 
  useEffect(() => {
    loadRenewals()
  }, [realtimeVersion, user.employeeEmail])
 

  // Approval is performed by an administrator in a different session. Refresh
  // quietly so a user sees its decision without needing to sign out or reload.
 
  const activeCount = certificates.filter((certificate) => certificate.status === 'issued').length
  const approvedCertificates = useMemo(
    () => certificates.filter((certificate) => certificate.status === 'issued'),
    [certificates],
  )
  const certificateOems = useMemo(() => configuredOems.length
    ? configuredOems
    : [...new Set(certificates.map(oemFor))].sort((first, second) => first.localeCompare(second)),
  [certificates, configuredOems])
  const filteredCertificates = useMemo(() => {
    const search = certificateSearch.trim().toLowerCase()
    return certificates.filter((certificate) => {
      const matchesSearch = !search || [
        certificate.course_name,
        certificate.certificate_number,
        oemFor(certificate),
      ].some((value) => String(value || '').toLowerCase().includes(search))
      const matchesOem = certificateOem === 'all' || oemFor(certificate) === certificateOem
      const matchesStatus = certificateStatus === 'all' || certificate.status === certificateStatus
      return matchesSearch && matchesOem && matchesStatus
    }).sort(newestCertificateFirst)
  }, [certificates, certificateSearch, certificateOem, certificateStatus])
  const oemRows = useMemo(
    () =>
      Object.entries(
        approvedCertificates.reduce((counts, certificate) => {
          const oem = oemFor(certificate)
          counts[oem] = (counts[oem] || 0) + 1
          return counts
        }, {}),
      ).sort(([, first], [, second]) => second - first),
    [approvedCertificates],
  )
  const yearRows = useMemo(() => {
    const currentYear = new Date().getFullYear()
    const joiningYear = new Date(`${String(user?.dateOfJoining || '').slice(0, 10)}T00:00:00`).getFullYear()
    const firstYear = Number.isFinite(joiningYear) && joiningYear <= currentYear
      ? joiningYear
      : currentYear - 5
    const counts = approvedCertificates.reduce((total, certificate) => {
      const year = new Date(`${certificate.issued_date}T00:00:00`).getFullYear()
      total[year] = (total[year] || 0) + 1
      return total
    }, {})
    return Array.from({ length: currentYear - firstYear + 1 }, (_, index) => {
      const year = firstYear + index
      return [year, counts[year] || 0]
    })
  }, [approvedCertificates, user?.dateOfJoining])
  const monthRows = useMemo(() => {
    const counts = approvedCertificates.reduce((total, certificate) => {
      const issued = new Date(`${certificate.issued_date}T00:00:00`)
      if (issued.getFullYear() === Number(selectedCompletionYear)) total[issued.getMonth()] = (total[issued.getMonth()] || 0) + 1
      return total
    }, {})
    return shortMonthNames.map((name, index) => [name, counts[index] || 0])
  }, [approvedCertificates, selectedCompletionYear])

  const deleteCertificate = async (certificate) => {
    const confirmed = await confirmDelete({
      name: certificate.course_name,
      itemLabel: 'certificate',
    })
    if (!confirmed) return
    try {
      const response = await runWithLoader('Deleting certificate', () =>
        fetch(`${apiUrl}/certificates/${certificate.id}`, { method: 'DELETE' }),
      )
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.detail || 'Unable to delete certificate')
      }
      window.dispatchEvent(new Event('certificates-updated'))
      notify(`Deleted "${certificate.course_name}" certificate`)
    } catch (error) {
      notify(error.message || 'Unable to delete certificate')
    }
  }

  const currentHour = new Date().getHours()
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening'
  const greetingDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date())
  const dashboardName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'User'

  return (
    <section className="user-dashboard">
      {/* {!isRenewalsRoute && (
        <section className="dashboard-greeting" aria-label={`${greeting}, ${dashboardName}`}> */}
      {!isRenewalsRoute && !isProfileRoute && (
  <section className="dashboard-greeting" aria-label={`${greeting}, ${dashboardName}`}>
          <div>
            <span><i className="bi bi-grid-1x2" aria-hidden="true" /> CERTIFICATION DASHBOARD</span>
            <h2>{greeting}, {dashboardName}
              {/* <small>Here is the latest certification and compliance overview.</small>     */}
            </h2>
            <p className="user-greeting-details">
              <strong><i className="bi bi-person-vcard" aria-hidden="true" /> Employee ID: {user?.employeeId || user?.employee_id || user?.id || 'Not assigned'}</strong>
              <strong><i className="bi bi-building" aria-hidden="true" /> Department: {user?.department || 'Not assigned'}</strong>
            </p>
          </div>
          <time dateTime={new Date().toISOString().slice(0, 10)}>
            <i className="bi bi-calendar3" aria-hidden="true" /> {greetingDate}
          </time>
        </section>
      )}
      {isProfileRoute && (
        <section className="dashboard-greeting" aria-label={`${dashboardName} Dashboard`}>
          <div>
            <span><i className="bi bi-grid-1x2" aria-hidden="true" /> PERSONAL WORKSPACE</span>
            <h2>{dashboardName}'s Dashboard</h2>
            <p className="dashboard-greeting-details">
              {user?.role === 'admin' && <strong><i className="bi bi-person-badge" aria-hidden="true" /> Role: Administrator</strong>}
              <strong><i className="bi bi-person-vcard" aria-hidden="true" /> Employee ID: {user?.employeeId || user?.employee_id || user?.id || 'Not assigned'}</strong>
              <strong><i className="bi bi-building" aria-hidden="true" /> Department: {user?.department || 'Not assigned'}</strong>
            </p>
          </div>
          <time dateTime={new Date().toISOString().slice(0, 10)}>
            <i className="bi bi-calendar3" aria-hidden="true" /> {greetingDate}
          </time>
        </section>
      )}
     
      {isProfileRoute && (
  <nav className="completion-chart-toggle admin-tabs-toggle" aria-label="Profile views">
    <button
      type="button"
      className={tab === 'overview' ? 'active' : ''}
      onClick={() => setTab('overview')}
      aria-pressed={tab === 'overview'}
    >
      <i className="bi bi-grid-1x2" aria-hidden="true" /> Dashboard
    </button>
    <button
      type="button"
      className={tab === 'certificates' ? 'active' : ''}
      onClick={() => setTab('certificates')}
      aria-pressed={tab === 'certificates'}
    >
      <i className="bi bi-patch-check" aria-hidden="true" /> My certificates
    </button>
    <button
      type="button"
      className={tab === 'renewals' ? 'active' : ''}
      onClick={() => setTab('renewals')}
      aria-pressed={tab === 'renewals'}
    >
      <i className="bi bi-clock-history" aria-hidden="true" /> Upcoming renewals
      {renewals.length > 0 && <span>{renewals.length}</span>}
    </button>
    <button
      type="button"
      onClick={() => goTo('my-course-list')}
    >
      <i className="bi bi-list-check" aria-hidden="true" /> My course list
    </button>
  </nav>
)}
      
      {tab === 'overview' && (
        <>
          <div className="user-kpis">
            <article
              className="user-kpi-link"
              role="button"
              tabIndex={0}
              onClick={() => goTo('my-certificates')}
              onKeyDown={(event) => event.key === 'Enter' && goTo('my-certificates')}
            >
              <i className="bi bi-patch-check" />
              <span>
                Active certificates<b>{activeCount}</b>
              </span>
            </article>
            <article
              className="user-kpi-link"
              role="button"
              tabIndex={0}
              onClick={() => goTo('upcoming-renewals')}
              onKeyDown={(event) => event.key === 'Enter' && goTo('upcoming-renewals')}
            >
              <i className="bi bi-clock-history" />
              <span>
                Upcoming renewals<b>{renewals.length}</b>
                <small>Next 90 days</small>
              </span>
            </article>
            <article>
              <i className="bi bi-trophy" />
              <span>
                Current month rank<b>{monthlyRank.rank || '—'}</b>
                <small>{monthlyRank.certificate_count ? `${monthlyRank.certificate_count} validated ${monthlyRank.certificate_count === 1 ? 'certificate' : 'certificates'}` : 'No validated certificates this month'}</small>
              </span>
            </article>
          </div>
          <div className="user-chart-grid">
            <OemChart rows={oemRows} />
            <YearChart rows={completionPeriod === 'year' ? yearRows : monthRows} period={completionPeriod} selectedYear={selectedCompletionYear} years={yearRows.map(([year]) => String(year))} onPeriodChange={setCompletionPeriod} onYearChange={setSelectedCompletionYear} />
          </div>
          <section className="er-card user-renewal-card">
            <header>
              <div>
                <h3>Upcoming renewals</h3>
                <p>We will notify you before a certificate expires.</p>
              </div>
              <button className="card-action" onClick={() => setTab('renewals')}>
                View all
              </button>
            </header>
            <RenewalList renewals={renewals} onAdd={openCertificateForm} />
          </section>
        </>
      )}
      {tab === 'certificates' && (
        <section className="er-card user-table-card">
          <header>
            <div>
              <h3>My certificates</h3>
              <p>{isAdminProfile ? 'Certificates recorded for this administrator.' : `Certificates recorded under ${user.employeeEmail}`}</p>
            </div>
            <button className="er-add" onClick={openCertificateForm}>
              <i className="bi bi-plus-lg" /> Add certificate
            </button>
          </header>
          <div className="user-certificate-filters" aria-label="Certificate filters">
            <label className="user-certificate-search">
              <i className="bi bi-search" aria-hidden="true" />
              <input
                type="search"
                value={certificateSearch}
                onChange={(event) => setCertificateSearch(event.target.value)}
                placeholder="Search certificate or number"
                aria-label="Search my certificates"
              />
            </label>
            <label>
              <span>OEM</span>
              <CompactSelect value={certificateOem} onChange={(event) => setCertificateOem(event.target.value)}>
                <option value="all">All OEMs</option>
                {certificateOems.map((oem) => <option key={oem} value={oem}>{oem}</option>)}
              </CompactSelect>
            </label>
            <label>
              <span>Status</span>
              <CompactSelect value={certificateStatus} onChange={(event) => setCertificateStatus(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="issued">Validated</option>
                <option value="pending">Under Review</option>
                <option value="revoked">Revoked</option>
              </CompactSelect>
            </label>
            {(certificateSearch || certificateOem !== 'all' || certificateStatus !== 'all') && (
              <button type="button" onClick={() => {
                setCertificateSearch('')
                setCertificateOem('all')
                setCertificateStatus('all')
              }}>
                <i className="bi bi-x-lg" aria-hidden="true" /> Clear
              </button>
            )}
          </div>
                <CertificateTable
        certificates={filteredCertificates}
        loading={loading}
        onEdit={setEditingCertificate}
        onDelete={deleteCertificate}
        notify={notify}
        runWithLoader={runWithLoader}
      />
    </section>
  
)}
      {tab === 'renewals' && (
        <section className="er-card user-renewal-card">
          <header>
            <div>
              <h3>Upcoming renewals</h3>
              <p>{isAdminProfile ? 'Review this administrator’s certificates approaching their renewal date.' : 'Review certificates approaching their renewal date.'}</p>
            </div>
          </header>
          <RenewalList renewals={renewals} onAdd={openCertificateForm} />
        </section>
      )}
      {editingCertificate && (
        <UserCertificateModal
          certificate={editingCertificate}
          close={() => setEditingCertificate(null)}
          notify={notify}
          runWithLoader={runWithLoader}
          user={user}
        />
      )}
    </section>
  )
}

function OemChart({ rows }) {
  const max = Math.max(...rows.map(([, count]) => count), 1)
  return (
    <section className="er-card user-chart-card">
      <header>
        <div>
          <h3>Certifications by OEM wise</h3>
          <p>Your certificates grouped by issuing organisation.</p>
        </div>
      </header>
      {rows.length ? (
        <div className="user-oem-bars">
          {rows.map(([oem, count], index) => (
            <div key={oem}>
              <span>{oem}</span>
              <i>
                <b
                  style={{
                    width: `${(count / max) * 100}%`,
                    background: oemColors[index % oemColors.length],
                  }}
                />
              </i>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="user-chart-empty">Add a certificate to see your OEM-wise summary.</p>
      )}
    </section>
  )
}

function YearChart({ rows, period, selectedYear, years, onPeriodChange, onYearChange }) {
  return (
    <section className="er-card user-chart-card">
      <header>
        <div>
          <h3>Certifications completed by {period}</h3>
          <p>{period === 'year' ? 'Your recorded completion history.' : `Your completions in ${selectedYear}.`}</p>
        </div>
        <div className="completion-chart-controls">
          <div className="completion-chart-toggle">
            <button type="button" className={period === 'month' ? 'active' : ''} onClick={() => onPeriodChange('month')}>Month</button>
            <button type="button" className={period === 'year' ? 'active' : ''} onClick={() => onPeriodChange('year')}>Year</button>
          </div>
          {period === 'month' && <label className="completion-year-select">Year<select value={selectedYear} onChange={(event) => onYearChange(event.target.value)} aria-label="Choose a year for monthly completions">{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>}
        </div>
      </header>
      <UserCompletionLineChart rows={rows} period={period} />
    </section>
  )
}

function UserCompletionLineChart({ rows, period }) {
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const width = Math.max(620, rows.length * 72)
  const height = 240
  const padding = { top: 16, right: 30, bottom: 32, left: 10 }
  const graphWidth = width - padding.left - padding.right
  const graphHeight = height - padding.top - padding.bottom
  const dataMax = Math.max(0, ...rows.map(([, count]) => Number(count) || 0))
  const yMax = Math.max(4, Math.ceil(dataMax / 4) * 4)
  const xStep = rows.length > 1 ? graphWidth / (rows.length - 1) : graphWidth
  const points = rows.map(([label, rawCount], index) => {
    const count = Number(rawCount) || 0
    return { label, count, index, x: padding.left + (rows.length > 1 ? index * xStep : graphWidth / 2), y: height - padding.bottom - (count / yMax) * graphHeight }
  })
  const linePath = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
  const areaPath = points.length ? `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z` : ''
  const gridLines = Array.from({ length: 5 }, (_, index) => ({ value: yMax - (yMax / 4) * index, y: padding.top + (graphHeight / 4) * index }))
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex]

  return <div className="line-chart-layout user-completion-line-chart">
    <div className="line-chart-y-axis">{gridLines.map(({ value }) => <span key={value}>{value}</span>)}</div>
    <div className="line-chart-scroll-container" onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}>
      <svg className="line-chart-svg" viewBox={`0 0 ${width} ${height}`} style={{ width: `${width}px`, height: `${height}px` }} aria-label={`Certifications completed by ${period} line chart`}>
        <defs><linearGradient id="lineChartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d84457" stopOpacity="0.3" /><stop offset="100%" stopColor="#d84457" stopOpacity="0" /></linearGradient></defs>
        {gridLines.map(({ y }) => <line key={y} x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="line-chart-grid-line" />)}
        <path d={areaPath} className="line-chart-area" /><path d={linePath} className="line-chart-path" />
        {points.map((point) => <g key={point.label}><text x={point.x} y={height - 15} textAnchor="middle" className="line-chart-axis-label">{point.label}</text><circle cx={point.x} cy={point.y} r={hoveredIndex === point.index ? 7 : 4} className="line-chart-dot" onPointerEnter={() => setHoveredIndex(point.index)} onPointerLeave={() => setHoveredIndex(null)} /></g>)}
      </svg>
    </div>
    {hoveredPoint && <div className="line-chart-tooltip" role="status" style={{ left: `calc(40px + ${hoveredPoint.x - scrollLeft}px)`, top: `${hoveredPoint.y + 42}px` }}><span>{hoveredPoint.label}</span><strong>{hoveredPoint.count} completed</strong></div>}
  </div>
}

function CertificateTable({ certificates, loading, onEdit, onDelete, notify, runWithLoader }) {
  if (loading) return <p className="user-empty">Loading your certificates...</p>
  if (!certificates.length)
    return (
      <p className="user-empty">
        No certificates saved yet. Use "Add certificate" to add your first one.
      </p>
    )
  return (
    <div className="global-table-scroll">
    <table className="er-table user-cert-table">
      <thead>
        <tr>
          <th>Certificate</th>
          <th>OEM</th>
          <th>Certificate no.</th>
          <th>Validity</th>
          <th>Renewal / expiry</th>
          <th>Completed</th>
          <th>Status</th>
          <th>Evidence</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {certificates.map((certificate) => (
          <tr key={certificate.id}>
            <td>
              <b>{certificate.course_name}</b>
            </td>
            <td>{certificate.vendor_name || oemFor(certificate)}</td>
            <td>
              <code>{certificate.certificate_number}</code>
            </td>
            <td>{validityLabel(certificate)}</td>
            <td>
              {expiryFor(certificate)
                ? expiryFor(certificate).toLocaleDateString('en-US')
                : 'No expiry'}
            </td>
            <td>{formatDate(certificate.issued_date)}</td>
            <td>
              <span className={`user-status ${certificate.status}`}>{certificateStatusLabel(certificate.status)}</span>
            </td>
            <td>
              <VerificationFileButton
                certificateId={certificate.id}
                hasFile={Boolean(certificate.verification_image_path)}
                notify={notify}
                runWithLoader={runWithLoader}
              />
            </td>
            <td className="user-certificate-actions">
              <button
                type="button"
                onClick={() => onEdit(certificate)}
                aria-label="Edit certificate"
              >
                <i className="bi bi-pencil" />
              </button>
              <button
                type="button"
                className="delete"
                onClick={() => onDelete(certificate)}
                aria-label="Delete certificate"
              >
                <i className="bi bi-trash3" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

function RenewalList({ renewals, onAdd }) {
  if (!renewals.length)
    return (
      <div className="user-empty">
        <i className="bi bi-shield-check" />
        <b>No upcoming renewals</b>
        <p>Your active certificates do not expire in the next 90 days.</p>
        <button className="outline-action" style={{ margin: '14px 0 22px' }} onClick={onAdd}>
          Add certificate
        </button>
      </div>
    )
  return (
    <div className="user-renewals">
      {renewals.map((certificate) => {
        const days = certificate.days_remaining
        const isOverdue = days < 0
        const isUrgent = days <= 30
        return (
          <article key={certificate.id}>
            <i className={isUrgent ? 'urgent bi bi-exclamation-circle' : 'bi bi-clock'} />
            <div>
              <b>{certificate.course_name}</b>
              <small>
                {isOverdue ? 'Expired' : 'Expires'}{' '}
                {certificate.expiry.toLocaleDateString('en-US', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </small>
              <small className="renewal-certificate-details">
                {certificate.vendor_name || oemFor(certificate)} · Certificate no. {certificate.certificate_number || 'Not recorded'}
              </small>
            </div>
            <em className={isUrgent ? 'urgent' : ''}>
              {renewalTimeLabel(days)}
            </em>
          </article>
        )
      })}
    </div>
  )
}
