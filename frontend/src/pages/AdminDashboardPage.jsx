import { useEffect, useMemo, useState } from 'react'
const apiUrl = process.env.REACT_APP_API_URL

const colours = ['#5147e5', '#f09b2e', '#10a58e', '#e25573', '#4385e8', '#8b5cf6']

function Card({ title, hint, children }) {
  return (
    <section className="er-card">
      <header>
        <h3>{title}</h3>
        {hint && <span>{hint}</span>}
      </header>
      {children}
    </section>
  )
}

function Empty({ children }) {
  return <p className="user-chart-empty">{children}</p>
}

function Bars({ rows, emptyText }) {
  const max = Math.max(...rows.map((row) => row.count), 1)
  if (!rows.length) return <Empty>{emptyText}</Empty>
  return (
    <div className="hbars">
      {rows.slice(0, 6).map((row, index) => (
        <div key={row.name}>
          <span>{row.name}</span>
          <b>
            <i style={{ width: `${(row.count / max) * 100}%`, background: colours[index] }} />
          </b>
          <strong>{row.count}</strong>
        </div>
      ))}
    </div>
  )
}

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const response = await fetch(`${apiUrl}/dashboard`)
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to load dashboard data')
        setDashboard(result)
        setError('')
      } catch (loadError) {
        setError(loadError.message || 'Unable to load dashboard data')
      }
    }
    loadDashboard()
    window.addEventListener('certificates-updated', loadDashboard)
    return () => window.removeEventListener('certificates-updated', loadDashboard)
  }, [])

  const years = useMemo(() => {
    const counts = new Map((dashboard?.years || []).map((item) => [item.year, item.count]))
    const currentYear = new Date().getFullYear()
    return Array.from({ length: 6 }, (_, index) => {
      const year = String(currentYear - 5 + index)
      return { year, count: counts.get(year) || 0 }
    })
  }, [dashboard])
  const maxYear = Math.max(...years.map((item) => item.count), 1)

  if (error) return <p className="user-empty">{error}</p>
  if (!dashboard) return <p className="user-empty">Loading live certificate data...</p>

  return (
    <>
      <div className="er-kpis">
        <div><span>Total certificates<i className="bi bi-award" /></span><b>{dashboard.total}</b><small>Saved certificate records</small></div>
        <div className="hero"><span>Active certificates<i className="bi bi-patch-check" /></span><b>{dashboard.issued}</b><small>Currently validated</small></div>
        <div><span>Certified employees<i className="bi bi-people" /></span><b>{dashboard.employees}</b><small>Users with active certificates</small></div>
        <div><span>Renewals in 90 days<i className="bi bi-clock-history" /></span><b>{dashboard.upcoming.length}</b><small className={dashboard.upcoming.length ? 'red' : 'green'}>{dashboard.upcoming.length ? 'Needs attention' : 'No upcoming expiry'}</small></div>
      </div>

      <div className="er-grid top-grid">
        <Card title="Certifications by category" hint="Saved certificate data"><Bars rows={dashboard.categories} emptyText="No categories saved yet." /></Card>
        <Card title="Certifications by OEM" hint="Saved OEM names"><Bars rows={dashboard.vendors} emptyText="No OEM names saved yet." /></Card>
      </div>

      <div className="er-grid lead-grid">
        <Card title="Top certificate holders" hint="Active certificates">
          {dashboard.top_employees.length ? dashboard.top_employees.map((employee, index) => (
            <div className="leader" key={employee.name}>
              <em className={`r${index + 1}`}>{index + 1}</em>
              <i className="face" style={{ background: colours[index] }}>{employee.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</i>
              <span><b>{employee.name}</b><small>Active certificates</small></span>
              <strong>{employee.count}<small>certs</small></strong>
            </div>
          )) : <Empty>No active certificates saved yet.</Empty>}
        </Card>
        <Card title="Certifications completed by year" hint={`${dashboard.total} saved records`}>
          <div className="years">{years.map((item) => <div key={item.year}><i style={{ height: `${(item.count / maxYear) * 100}%` }}>{item.count || ''}</i><b>{item.year}</b></div>)}</div>
        </Card>
      </div>

      <div className="er-grid">
        <Card title="Upcoming renewals" hint="Calculated from completion dates">
          {dashboard.upcoming.length ? <div className="renewal-list">{dashboard.upcoming.map((certificate) => <div key={certificate.id}><i className={certificate.days_remaining <= 30 ? 'danger' : 'warn'} /><span><b>{certificate.course_name}  -  {certificate.recipient_name}</b><small>{certificate.vendor_name || 'OEM not recorded'}  -  expires in {certificate.days_remaining} days</small></span><em className={certificate.days_remaining <= 30 ? 'danger' : 'warn'}>{certificate.days_remaining} days</em></div>)}</div> : <Empty>No saved certificate expires in the next 90 days.</Empty>}
        </Card>
        <Card title="Recently added certificates" hint="Latest saved records">
          {dashboard.recent.length ? <div className="renewal-list">{dashboard.recent.map((certificate) => <div key={certificate.id}><i className="warn" /><span><b>{certificate.course_name}</b><small>{certificate.recipient_name}  -  {certificate.vendor_name || 'OEM not recorded'}</small></span><em>{certificate.issued_date}</em></div>)}</div> : <Empty>No certificates have been added yet.</Empty>}
        </Card>
      </div>
    </>
  )
}
