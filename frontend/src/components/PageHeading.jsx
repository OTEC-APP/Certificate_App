import { useLocation } from 'react-router-dom'
import { pageIcons, pageMeta } from './AppHeader'

export default function PageHeading({ user, filter }) {
  const location = useLocation()
  const pathname = location.pathname
  const key = pathname.split('/')[1] || 'dashboard'
  const params = new URLSearchParams(location.search)
  const isEmployeeRecord = pathname.split('/').filter(Boolean).length > 1 && key === 'employees'
  const [defaultTitle, defaultSubtitle] = isEmployeeRecord
    ? ['Employee record', 'Certification history and renewal details']
    : pageMeta[key] || pageMeta.dashboard
  const isUserDashboard = user?.role === 'user' && key === 'dashboard'
  const isProfile = key === 'my-profile'
  const displayName = user?.firstName || user?.name?.split(' ')[0] || 'User'
  const contextualTitle = key === 'employees'
    ? filter?.label || (['tenure', 'location'].includes(filter?.type) ? `${filter.value} employees` : defaultTitle)
    : key === 'alerts' && params.get('section') === 'renewals'
      ? params.get('source') === 'expiring' ? 'Expiring in 90 days' : 'Upcoming renewals'
      : filter?.label || defaultTitle
  const title = isProfile ? `Hello, ${displayName}` : isUserDashboard ? 'My certification dashboard' : contextualTitle
  const subtitle = isUserDashboard
    ? 'Your certificates, renewal alerts, and compliance tasks'
    : isProfile
      ? 'Keep your certification profile current and stay ahead of upcoming renewals.'
    : defaultSubtitle
  const eyebrow = isProfile ? 'Personal workspace' : key.replaceAll('-', ' ')
  const roleLabel = user?.role === 'admin' ? 'Administrator' : 'User'
  const icon = isEmployeeRecord ? 'bi-person-vcard' : pageIcons[key] || 'bi-grid-1x2'

  // These routes already introduce themselves with a richer in-page hero.
  const hasOwnHero = new Set([
    'dashboard',
    'compliance',
    'activity-history',
    'access-history',
    'certificate-activity',
    'completions',
    'exports',
    'task-assignments',
    'certification-tasks',
    'my-profile',
  ])
  // User alerts already start with their Alerts / Renewals tabs and card heading.
  // Do not duplicate that introduction above the user workflow.
  if (hasOwnHero.has(key) || isEmployeeRecord || (user?.role === 'user' && key === 'alerts')) return null

  return (
    <header className="page-content-heading">
      <i className={`bi ${icon} page-heading-icon`} aria-hidden="true" />
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {isProfile && <small className="profile-role-badge">Role: {roleLabel}</small>}
      </div>
    </header>
  )
}
