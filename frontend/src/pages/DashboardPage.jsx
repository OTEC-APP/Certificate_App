import { useEffect, useRef, useState } from 'react'
const apiUrl = process.env.REACT_APP_API_URL
import { mergeComplianceVendors } from '../utils/complianceVendors'
import { renewalTimeLabel } from '../utils/renewalTime'
import { categoryColor } from '../utils/categoryPalette'
 
 
const fallbackColours = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#0ea5e9']
const rankMedals = ['🥇', '🥈', '🥉']
function Card({
  title,
  hint,
  action,
  onAction,
  children,
  dark = false,
  clickable = false
}) {
  return <section onClick={clickable ? onAction : undefined} className={`er-card ${dark ? 'dark' : ''} ${clickable ? 'card-clickable' : ''}`}><header><h3>{title}</h3><div className="card-header-actions">{hint && (typeof hint === 'string' ? <span>{hint}</span> : hint)}{action && <button className="card-action" onClick={event => {
        event.stopPropagation();
        onAction();
      }}>{action}</button>}</div></header>{children}</section>;
}

function Bars({
  title,
  rows,
  hint,
  onRowClick
}) {
  const max = Math.max(...rows.map(r => r[1]), 1);
  return <Card title={title} hint={hint}><div className="hbars">{rows.map(([name, value]) => <div className={onRowClick ? 'clickable' : ''} role={onRowClick ? 'button' : undefined} tabIndex={onRowClick ? 0 : undefined} onClick={() => onRowClick?.(name)} onKeyDown={(event) => { if (onRowClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRowClick(name) } }} key={name}><span>{name}</span><b><i style={{
            width: `${value / max * 100}%`
          }} /></b><strong>{value}</strong></div>)}</div></Card>;
}
export default function DashboardPage({
  openEmployees,
  goTo,
  user,
  realtimeVersion,
}) {
   const [chartPeriod, setChartPeriod] = useState('year')
  const [leaderboardPeriod, setLeaderboardPeriod] = useState('month')
  const [selectedMonthYear, setSelectedMonthYear] = useState(String(new Date().getFullYear()))
  const [liveDashboard, setLiveDashboard] = useState(null)
  const [partnerCompliance, setPartnerCompliance] = useState([])
  const [savedCategories, setSavedCategories] = useState([])
  const completionChartRef = useRef(null)
 
   useEffect(() => {
    let active = true
    const loadDashboard = async () => {
      const [dashboardResult, complianceResult, categoriesResult] = await Promise.allSettled([
        fetch(`${apiUrl}/dashboard?year=${encodeURIComponent(selectedMonthYear)}`, { cache: 'no-store' }).then(response => {
          if (!response.ok) throw new Error('Unable to load dashboard')
          return response.json()
        }),
        fetch(`${apiUrl}/partner-compliance`, { cache: 'no-store' }).then(response => {
          if (!response.ok) throw new Error('Unable to load partner compliance')
          return response.json()
        }),
        fetch(`${apiUrl}/access-options/categories`, { cache: 'no-store' }).then(response => {
          if (!response.ok) throw new Error('Unable to load categories')
          return response.json()
        }),
      ])
      if (!active) return
      setLiveDashboard(dashboardResult.status === 'fulfilled' ? dashboardResult.value : null)
      setPartnerCompliance(complianceResult.status === 'fulfilled' ? mergeComplianceVendors(complianceResult.value.vendors || []) : [])
      setSavedCategories(categoriesResult.status === 'fulfilled' ? categoriesResult.value : [])
    }
    loadDashboard()
    return () => {
      active = false
    }
  }, [selectedMonthYear])
 
  useEffect(() => {
    if (!realtimeVersion) return undefined
    let active = true
    fetch(`${apiUrl}/dashboard/counts?year=${encodeURIComponent(selectedMonthYear)}`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Unable to update dashboard counts')
        return response.json()
      })
      .then((counts) => {
        if (active) setLiveDashboard((current) => current ? { ...current, ...counts } : current)
      })
      .catch(() => {
        // Keep the current view intact when the lightweight count update fails.
      })
    return () => {
      active = false
    }
  }, [realtimeVersion, selectedMonthYear])
 
 
  const currentYear = new Date().getFullYear()
  const savedYears = new Map((liveDashboard?.years || []).map(item => [String(item.year), Number(item.count) || 0]))
  const earliestJoiningYear = Number(liveDashboard?.earliest_employee_joining_year)
  const earliestSavedYear = Math.min(...Array.from(savedYears.keys()).map(Number).filter(Number.isFinite), currentYear)
  // Include company history from the earliest employee DOJ. On load, the chart
  // scrolls to the latest years; earlier years remain available by swiping.
  const firstChartYear = Number.isFinite(earliestJoiningYear) && earliestJoiningYear <= currentYear
    ? earliestJoiningYear
    : Math.min(earliestSavedYear, currentYear - 5)
  const availableYears = Array.from({ length: currentYear - firstChartYear + 1 }, (_, index) => String(firstChartYear + index))
  const yearChart = availableYears.map(year => [year, savedYears.get(year) || 0])
  useEffect(() => {
    if (chartPeriod !== 'year') return
    const chart = completionChartRef.current
    if (chart) chart.scrollLeft = chart.scrollWidth
  }, [chartPeriod, availableYears.length])
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthChart = (liveDashboard?.months || monthNames.map((_, index) => ({ month: index + 1, count: 0 }))).map((item, index) => [monthNames[index], item.count])
  const categoryCounts = new Map((liveDashboard?.categories || []).map(item => [item.name, Number(item.count) || 0]))
  const configuredCategoryNames = new Set(savedCategories.map(item => item.name))
  const categoryRows = [
    ...savedCategories.map((item, index) => [
      item.name,
      categoryCounts.get(item.name) || 0,
      categoryColor(item.name),
    ]),
    ...(liveDashboard?.categories || [])
      .filter(item => !configuredCategoryNames.has(item.name))
      .map((item, index) => [
        item.name,
        Number(item.count) || 0,
        categoryColor(item.name),
      ]),
  ]
  const categoryMax = Math.max(...categoryRows.map(([, count]) => count), 1)
  const categoryScale = Math.max(5, Math.ceil(categoryMax / 5) * 5)


   const categoryTicks = Array.from({ length: 5 }, (_, index) => Math.round(categoryScale * (4 - index) / 4))
  const decorateLeaderboard = (employees) => employees.map((employee, index) => ({
    ...employee,
    initials: String(employee.name || 'Unknown').split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    colour: fallbackColours[index % fallbackColours.length],
  }))
  const topEmployees = decorateLeaderboard(liveDashboard?.monthly_top_employees || [])
  const overallTopEmployees = decorateLeaderboard(liveDashboard?.overall_top_employees || [])
  const allMonthlyRankedEmployees = decorateLeaderboard(liveDashboard?.monthly_ranked_employees || liveDashboard?.monthly_top_employees || [])
  const allOverallRankedEmployees = decorateLeaderboard(liveDashboard?.overall_ranked_employees || liveDashboard?.overall_top_employees || [])
  const monthlyTopLabel = liveDashboard?.monthly_top_period
    ? new Date(`${liveDashboard.monthly_top_period}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : 'Current month'
  const leaderboard = leaderboardPeriod === 'overall' ? overallTopEmployees : topEmployees
  const allRankedEmployees = leaderboardPeriod === 'overall' ? allOverallRankedEmployees : allMonthlyRankedEmployees
  const leaderboardLabel = leaderboardPeriod === 'overall' ? 'Overall' : monthlyTopLabel
  const leaderboardMeta = (employee) => {
    const employeeId = employee.profile_id ? employee.employee_id : 'Not assigned'
    return `Employee ID: ${employeeId || 'Not assigned'} · Department: ${employee.department || 'Not assigned'}`
  }
  const leaderboardToggle = <div className="completion-chart-toggle"><button type="button" className={leaderboardPeriod === 'month' ? 'active' : ''} onClick={() => setLeaderboardPeriod('month')}>Month</button><button type="button" className={leaderboardPeriod === 'overall' ? 'active' : ''} onClick={() => setLeaderboardPeriod('overall')}>Overall</button></div>
  const certifiedPercent = liveDashboard?.workforce ? Math.round((liveDashboard.employees / liveDashboard.workforce) * 100) : 0
  const locationRows = (liveDashboard?.locations || []).map(item => [item.name, Number(item.count) || 0, Number(item.people) || 0])
  const tenureRows = (liveDashboard?.tenure || []).map(item => [item.name, Number(item.count) || 0, Number(item.people) || 0])
  const ctsSummary = liveDashboard?.cts_summary || { total: 0, types: [], holders: [] }
  const chartRows = chartPeriod === 'year' ? yearChart : monthChart
  const chartMax = Math.max(...chartRows.map(([, count]) => count), 1)
  const chartToggle = <div className="completion-chart-controls"><div className="completion-chart-toggle"><button type="button" className={chartPeriod === 'month' ? 'active' : ''} onClick={() => setChartPeriod('month')}>Month</button><button type="button" className={chartPeriod === 'year' ? 'active' : ''} onClick={() => setChartPeriod('year')}>Year</button></div>{chartPeriod === 'month' && <label className="completion-year-select">Year<select value={selectedMonthYear} onChange={(event) => setSelectedMonthYear(event.target.value)} aria-label="Choose a year for monthly completions">{availableYears.map(year => <option key={year} value={year}>{year}</option>)}</select></label>}</div>
  const renewalRows = (liveDashboard?.upcoming || []).filter((renewal) => {
    const days = Number(renewal.days_remaining)
    return Number.isFinite(days) && days >= 0 && days <= 90
  })
  const partnerRows = partnerCompliance.slice(0, 3).map((partner) => {
    const completed = Number(partner.completed) || 0
    const required = Number(partner.required) || 0
    const Achieved = completed >= required
    const difference = Math.abs(completed - required)
    return {
      ...partner, completed, required, Achieved,
      progress: required ? Math.min(100, Math.round((completed / required) * 100)) : 100,
      message: Achieved
        ? difference ? `Comfortable margin — ${difference} above minimum.` : 'Requirement met.'
        : `${difference} more certified ${difference === 1 ? 'employee is' : 'employees are'} required.`,
    }
  })
  const currentHour = new Date().getHours()
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening'
  const greetingDate = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date())
  const dashboardName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Administrator'
 
  return <>
    <section className="dashboard-greeting" aria-label={`${greeting}, ${dashboardName}`}>
      <div>
        <span><i className="bi bi-grid-1x2" aria-hidden="true" /> CERTIFICATION DASHBOARD</span>
        <h2>{greeting}, {dashboardName}</h2>
        <p className="dashboard-greeting-details">
          <strong><i className="bi bi-person-badge" aria-hidden="true" /> Role: Administrator</strong>
          <strong><i className="bi bi-person-vcard" aria-hidden="true" /> Employee ID: {user?.employeeId || user?.employee_id || user?.id || 'Not assigned'}</strong>
          <strong><i className="bi bi-building" aria-hidden="true" /> Department: {user?.department || 'Administration'}</strong>
        </p>
      </div>
      <time dateTime={new Date().toISOString().slice(0, 10)}>
        <i className="bi bi-calendar3" aria-hidden="true" /> {greetingDate}
      </time>
    </section>
    <div className="er-kpis">
      <button onClick={() => goTo('catalog')}><span>Total certifications<i className="bi bi-award" /></span><b>
        {liveDashboard?.total ?? 0}</b> <b></b>
        {/* <small className="green">{liveDashboard?.added_this_quarter ?? 0} added this quarter
        
      </small> */}
      </button>
      <button className="hero" onClick={() => goTo('completions?credential=CTS')}><span>AVIXA CTS holders<i className="bi bi-trophy" /></span><b>{liveDashboard?.cts_holders ?? 0}</b><small>Active credential holders · view records →</small></button>
      <button onClick={() => openEmployees({ type: 'certified', value: 'certified', certified: true, label: 'Certified employees' })}><span>Certified employees<i className="bi bi-people" /></span><b>{liveDashboard?.employees ?? 0} <small>/ {liveDashboard?.workforce ?? 0}</small></b><small>{certifiedPercent}% of workforce</small></button>
      <button onClick={() => goTo('alerts?section=renewals&source=expiring')}><span>Expiring in 90 days<i className="bi bi-clock-history" /></span><b>{liveDashboard?.expiring_90_days ?? 0}</b><small className={(liveDashboard?.expiring_30_days ?? 0) ? 'red' : 'green'}>{liveDashboard?.expiring_30_days ?? 0} need action this month</small></button>
    </div>

    <div className="er-grid top-grid">
      <Card title="Certifications by category" hint="click a category to view its records">
        <div className="prototype-channels"><div className="prototype-scale">{categoryTicks.map((tick,index) => <span key={`${tick}-${index}`}>{tick}</span>)}</div><div className="channels">{categoryRows.map(([name,n,color]) => <button type="button" aria-label={`View ${name} certification records`} className="chan" onClick={() => goTo(`completions?category=${encodeURIComponent(name)}`)} key={name}><div className="bar-wrap"><div className="bar category-red-bar" style={{height:`${n ? Math.max(5,n/categoryScale*100) : 2}%`,background:color}}><b>{n}</b></div></div><div className="c-lab">{name}</div><div className="c-sub">{n} active</div></button>)}</div></div>
        <div className="prototype-legend">{categoryRows.map(([name,,color]) => <span key={name}><i style={{background:color}} />{name}</span>)}</div>
      </Card>
      <Card dark clickable onAction={() => goTo('completions?credential=CTS')} title="CTS holders" hint="AVIXA CERTIFIED"><div className="cts"><div><b>{ctsSummary.total}</b><span>Certified {ctsSummary.total === 1 ? 'Professional' : 'Professionals'}</span></div><section>{ctsSummary.types.map((type) => <p className="cts-filter-tile" role="button" tabIndex="0" key={type.name} onClick={(event) => { event.stopPropagation();goTo(`completions?credentialType=${encodeURIComponent(type.name)}`) }}><b>{type.count}</b>{type.name}{type.name === 'CTS-D' ? ' · Design' : type.name === 'CTS-I' ? ' · Install' : ''}</p>)}</section><footer>{ctsSummary.holders.slice(0,6).map((holder,i) => { const holderInitials=String(holder.name||'Unknown').split(/\s+/).filter(Boolean).map((part)=>part[0]).join('').slice(0,2).toUpperCase();return <i key={`${holder.name}-${i}`} className={`face f${i}`}>{holderInitials}</i> })}<small>{ctsSummary.total ? `View all ${ctsSummary.total} CTS holders →` : 'No active CTS holders'}</small></footer></div></Card>
    </div>
    <div className="er-grid lead-grid">
      <Card title={`${leaderboardLabel} Top 5 certified holders`} hint={leaderboardToggle} action="View all" onAction={() => openEmployees({ type: 'employee_ids', value: allRankedEmployees.map((employee) => employee.profile_id || employee.employee_id).filter(Boolean), ranked: true, rankingPeriod: leaderboardPeriod, rankCounts: Object.fromEntries(allRankedEmployees.map((employee) => [employee.profile_id || employee.employee_id, employee.count])), label: `${leaderboardLabel} certified holder ranking` })}><div className="leaderboard-list">{leaderboard.length ? leaderboard.map((employee,i) => { const employeeId = employee.profile_id || employee.employee_id; return <button className="leader" onClick={() => employeeId ? goTo(`employees/${employeeId}`) : goTo(`completions?employee=${encodeURIComponent(employee.name)}`)} key={employeeId || employee.name}><em className={`r${i+1}`} aria-label={`Rank ${i + 1}`}>{rankMedals[i] || i + 1}</em><i className="face" style={{background:employee.colour}}>{employee.initials}</i><span><b>{employee.name}</b><small>{leaderboardMeta(employee)}</small></span><strong>{employee.count}<small>certs</small></strong></button> }) : <p className="user-empty">No validated certificates were completed for this period.</p>}</div></Card>
      <Card title={`Certifications completed by ${chartPeriod}`} hint={chartToggle}><div ref={completionChartRef} className={`years ${chartPeriod === 'month' ? 'month-view' : ''}`}>{chartRows.map(([label,num],index) => <div className="completion-bar-link" key={label} role="button" tabIndex="0" onClick={() => goTo(chartPeriod === 'year' ? `completions?year=${label}` : `completions?year=${selectedMonthYear}&month=${index+1}`)}><i style={{height:`${num ? Math.max(8,num/chartMax*100) : 3}%`}}>{num}</i><b>{label}</b><small>{chartPeriod === 'year' && label === String(currentYear) ? 'YTD' : ''}</small></div>)}</div></Card>
    </div>
   
    
    <div className="er-grid equal"><Bars title="By office location" hint="certified employees by location" rows={locationRows} onRowClick={(location) => openEmployees({type:'location',value:location,certified:true})} /><Bars title="Certified employees by tenure" hint="unique certified employees since joining" rows={tenureRows} onRowClick={(tenure) => openEmployees({type:'tenure',value: tenure})} /></div>
 
    <div className="er-grid">
      <Card title="OEM Overview" action="Full view" onAction={() => goTo('compliance')}><div className="partner">{partnerRows.length ? partnerRows.map((partner) => { const colour=partner.Achieved?'green':'red';return <div className="partner-row" role="button" tabIndex="0" onClick={() => goTo('compliance')} key={partner.name}><p><b>{partner.name}</b><small>{partner.required} required</small><strong className={colour}>{partner.Achieved?'Achieved':'At risk'} · {partner.completed} of {partner.required}</strong></p><i><b className={colour} style={{width:`${partner.progress}%`}} /></i><span>{partner.message} Select to review certifications and holders.</span></div> }) : <p className="user-empty">No validated certificates are available for compliance.</p>}</div></Card>
      <Card title="Upcoming renewals" action="See all" onAction={() => goTo('alerts?section=renewals')}><div className="renewal-list dashboard-renewal-scroll">{renewalRows.length ? renewalRows.map((renewal) => { const urgency=renewal.days_remaining<=30?'danger':'warn'; const remaining=renewalTimeLabel(renewal.days_remaining); return <button onClick={() => goTo('alerts?section=renewals')} key={renewal.id}><i className={urgency} /><span><b>{renewal.course_name} — {renewal.recipient_name}</b><small>{renewal.category||'Other'} · expires in {remaining}</small></span><em className={urgency}>{remaining}</em></button> }) : <p className="user-empty">No certificates expire in the next 90 days.</p>}</div></Card>
    </div>
  </>;
           
}
 
 
