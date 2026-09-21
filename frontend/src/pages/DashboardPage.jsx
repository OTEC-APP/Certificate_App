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
  trailingAction,
  onTrailingAction,
  children,
  dark = false,
  clickable = false
}) {
  return <section onClick={clickable ? onAction : undefined} className={`er-card ${dark ? 'dark' : ''} ${clickable ? 'card-clickable' : ''}`}><header><h3>{title}</h3><div className="card-header-actions">{hint && (typeof hint === 'string' ? <span>{hint}</span> : hint)}{action && <button className="card-action" onClick={event => {
        event.stopPropagation();
        onAction();
      }}>{action}</button>}{trailingAction && <button className="card-action" onClick={event => {
        event.stopPropagation();
        onTrailingAction();
      }}>{trailingAction}</button>}</div></header>{children}</section>;
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
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  // The API normally returns all twelve months, but map by the supplied month
  // number so an incomplete or differently ordered response cannot shift points.
  const monthCounts = new Map((liveDashboard?.months || []).map((item) => [Number(item.month), Number(item.count) || 0]))
  const monthChart = monthNames.map((name, index) => [name, monthCounts.get(index + 1) || 0])
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
      <Card title={`${leaderboardLabel} Top 5 certified holders`} hint={leaderboardToggle} action="Customize email" onAction={() => goTo('top-certified-holders-mail')} trailingAction="View all" onTrailingAction={() => openEmployees({ type: 'certified', value: 'certified', certified: true, label: 'Certified employees' })}><div className="leaderboard-list">{leaderboard.length ? leaderboard.map((employee,i) => { const employeeId = employee.profile_id || employee.employee_id; return <button className="leader" onClick={() => employeeId ? goTo(`employees/${employeeId}`) : goTo(`completions?employee=${encodeURIComponent(employee.name)}`)} key={employeeId || employee.name}><em className={`r${i+1}`} aria-label={`Rank ${i + 1}`}>{rankMedals[i] || i + 1}</em><i className="face" style={{background:employee.colour}}>{employee.initials}</i><span><b>{employee.name}</b><small>{leaderboardMeta(employee)}</small></span><strong>{employee.count}<small>certs</small></strong></button> }) : <p className="user-empty">No validated certificates are available for this period.</p>}</div></Card>
       <Card title={`Certifications completed by ${chartPeriod}`} hint={chartToggle}>
  <CompletionLineChart 
    data={chartRows} 
    currentYear={currentYear}
    chartPeriod={chartPeriod}
    selectedMonthYear={selectedMonthYear}
    onPointClick={(label, index) => {
      goTo(chartPeriod === 'year' 
        ? `completions?year=${label}` 
        : `completions?year=${selectedMonthYear}&month=${index + 1}`
      );
    }} 
  />
</Card>
    </div>
   
    
    <div className="er-grid equal"><Bars title="By office location" hint="certified employees by location" rows={locationRows} onRowClick={(location) => openEmployees({type:'location',value:location,certified:true})} /><Bars title="Certified employees by tenure" hint="unique certified employees since joining" rows={tenureRows} onRowClick={(tenure) => openEmployees({type:'tenure',value: tenure})} /></div>
 
    <div className="er-grid">
      <Card title="OEM Overview" action="Full view" onAction={() => goTo('compliance')}><div className="partner">{partnerRows.length ? partnerRows.map((partner) => { const colour=partner.Achieved?'green':'red';return <div className="partner-row" role="button" tabIndex="0" onClick={() => goTo('compliance')} key={partner.name}><p><b>{partner.name}</b><small>{partner.required} required</small><strong className={colour}>{partner.Achieved?'Achieved':'At risk'} · {partner.completed} of {partner.required}</strong></p><i><b className={colour} style={{width:`${partner.progress}%`}} /></i><span>{partner.message} Select to review certifications and holders.</span></div> }) : <p className="user-empty">No validated certificates are available for compliance.</p>}</div></Card>
      <Card title="Upcoming renewals" action="See all" onAction={() => goTo('alerts?section=renewals')}><div className="renewal-list dashboard-renewal-scroll">{renewalRows.length ? renewalRows.map((renewal) => { const urgency=renewal.days_remaining<=30?'danger':'warn'; const remaining=renewalTimeLabel(renewal.days_remaining); return <button onClick={() => goTo('alerts?section=renewals')} key={renewal.id}><i className={urgency} /><span><b>{renewal.course_name} — {renewal.recipient_name}</b><small>{renewal.category||'Other'} · expires in {remaining}</small></span><em className={urgency}>{remaining}</em></button> }) : <p className="user-empty">No certificates expire in the next 90 days.</p>}</div></Card>
    </div>
  </>;
           
}
 
 
// Add this helper component at the top of DashboardPage.jsx
// const CompletionLineChart = ({ data, max, onPointClick, currentYear, chartPeriod, selectedMonthYear }) => {
//   const [hoveredIndex, setHoveredIndex] = useState(null);
  
//   const width = 800;
//   const height = 300;
//   const padding = { top: 20, right: 30, bottom: 40, left: 40 };
//   const graphWidth = width - padding.left - padding.right;
//   const graphHeight = height - padding.top - padding.bottom;
  
//   // Calculate Y-axis scale (round up to nearest even number for clean grid lines)
//   const yMax = Math.ceil(max / 2) * 2 || 2;
//   const yStep = graphHeight / yMax;
  
//   // Calculate X-axis step
//   const xStep = data.length > 1 ? graphWidth / (data.length - 1) : graphWidth;
  
//   // Generate points
//   const points = data.map(([label, count], i) => {
//     const x = padding.left + (data.length > 1 ? i * xStep : graphWidth / 2);
//     const y = height - padding.bottom - (count * yStep);
//     return { x, y, label, count, index: i };
//   });
  
//   // Build SVG paths
//   const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
//   const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z`;
  
//   // Y-axis grid lines
//   const gridLines = Array.from({ length: 5 }, (_, i) => {
//     const val = Math.round(yMax * (4 - i) / 4);
//     const y = padding.top + (i * (graphHeight / 4));
//     return { val, y };
//   });

//   return (
//     <div className="line-chart-wrapper">
//       <svg className="line-chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
//         <defs>
//           <linearGradient id="lineChartGradient" x1="0" y1="0" x2="0" y2="1">
//             <stop offset="0%" stopColor="#d84457" stopOpacity="0.3" />
//             <stop offset="100%" stopColor="#d84457" stopOpacity="0" />
//           </linearGradient>
//         </defs>
        
//         {/* Grid lines and Y-axis labels */}
//         {gridLines.map(({ val, y }) => (
//           <g key={val}>
//             <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="line-chart-grid-line" />
//             <text x={padding.left - 10} y={y + 4} textAnchor="end" className="line-chart-axis-label">{val}</text>
//           </g>
//         ))}
        
//         {/* Area Fill */}
//         <path d={areaPath} className="line-chart-area" />
        
//         {/* Line */}
//         <path d={linePath} className="line-chart-path" />
        
//         {/* Data Points and X-axis labels */}
//         {points.map((p) => (
//           <g key={p.label}>
//             <text x={p.x} y={height - 15} textAnchor="middle" className="line-chart-axis-label">{p.label}</text>
//             <circle 
//               cx={p.x} 
//               cy={p.y} 
//               r={hoveredIndex === p.index ? 7 : 4} 
//               className="line-chart-dot"
//               onMouseEnter={() => setHoveredIndex(p.index)}
//               onMouseLeave={() => setHoveredIndex(null)}
//               onClick={() => onPointClick(p.label, p.index)}
//             />
//           </g>
//         ))}
//       </svg>
      
//       {/* Custom Tooltip */}
//       {hoveredIndex !== null && (
//         <div 
//           className="line-chart-tooltip"
//           style={{ 
//             left: `${(points[hoveredIndex].x / width) * 100}%`, 
//             top: `${(points[hoveredIndex].y / height) * 100}%` 
//           }}
//         >
//           {points[hoveredIndex].label} <br />
//           {points[hoveredIndex].count}
//         </div>
//       )}
//     </div>
//   );
// };


// Replace the existing CompletionLineChart component with this updated version
const CompletionLineChart = ({ data, onPointClick, chartPeriod }) => {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollRef = useRef(null);
  
  // Dynamic width based on number of data points
  const width = Math.max(720, data.length * 72);
  // Keep the whole chart—including its X-axis—within the dashboard row.
  const height = 240;
  const padding = { top: 16, right: 30, bottom: 32, left: 10 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;
  
  // Recalculate the scale from the rendered data. Four equal intervals keep
  // every point visible as new certifications are added.
  const dataMax = Math.max(0, ...data.map(([, count]) => Number(count) || 0));
  const yMax = Math.max(4, Math.ceil(dataMax / 4) * 4);
  const yStep = graphHeight / yMax;
  const xStep = data.length > 1 ? graphWidth / (data.length - 1) : graphWidth;
  
  // Generate points
  const points = data.map(([label, rawCount], i) => {
    const count = Number(rawCount) || 0;
    const x = padding.left + (data.length > 1 ? i * xStep : graphWidth / 2);
    const y = height - padding.bottom - (count * yStep);
    return { x, y, label, count, index: i };
  });
  
  // Build paths
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z`
    : '';
  
  // Grid lines (Y-axis values)
  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const val = Math.round(yMax * (4 - i) / 4);
    const y = padding.top + (i * (graphHeight / 4));
    return { val, y };
  });

  // Auto-scroll only for the year view, where the full history may be wider
  // than the card. The month view should always open at January.
  useEffect(() => {
    if (scrollRef.current && data.length) {
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft = chartPeriod === 'year' ? scrollRef.current.scrollWidth : 0;
          setScrollLeft(scrollRef.current.scrollLeft);
        }
      }, 50);
    }
  }, [chartPeriod, data.length, data[0]?.[0], data[data.length - 1]?.[0]]);

  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex];

  return (
    <div className="line-chart-layout">
      {/* 1. Fixed Y-Axis Labels */}
      <div className="line-chart-y-axis">
        {gridLines.map(({ val }) => (
          <span key={val}>{val}</span>
        ))}
      </div>

      {/* 2. Scrollable Chart Area */}
      <div
        className="line-chart-scroll-container"
        ref={scrollRef}
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
      >
        <svg 
          className="line-chart-svg" 
          viewBox={`0 0 ${width} ${height}`} 
          style={{ width: `${width}px`, height: `${height}px` }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="lineChartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d84457" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#d84457" stopOpacity="0" />
            </linearGradient>
          </defs>
          
          {/* Grid lines (No Y-axis text here anymore) */}
          {gridLines.map(({ y }) => (
            <line key={y} x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="line-chart-grid-line" />
          ))}
          
          {/* Area & Line */}
          <path d={areaPath} className="line-chart-area" />
          <path d={linePath} className="line-chart-path" />
          
          {/* Data Points & X-Axis Labels */}
          {points.map((p) => (
            <g key={p.label}>
              <text x={p.x} y={height - 15} textAnchor="middle" className="line-chart-axis-label">{p.label}</text>
              <circle 
                cx={p.x} 
                cy={p.y} 
                r={hoveredIndex === p.index ? 7 : 4} 
                className="line-chart-dot"
                onPointerEnter={() => setHoveredIndex(p.index)}
                onPointerLeave={() => setHoveredIndex(null)}
                onClick={() => onPointClick(p.label, p.index)}
              />
            </g>
          ))}
        </svg>
        
      </div>
      {hoveredPoint && (
        <div
          className="line-chart-tooltip"
          role="status"
          style={{ left: `calc(40px + ${hoveredPoint.x - scrollLeft}px)`, top: `${hoveredPoint.y + 42}px` }}
        >
          <span>{hoveredPoint.label}</span>
          <strong>{hoveredPoint.count} completed</strong>
        </div>
      )}
    </div>
  );
};
