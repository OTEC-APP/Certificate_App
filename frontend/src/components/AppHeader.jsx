import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'

export const pageMeta = {
  'my-profile': ['My profile', 'Your certification records and renewal overview'],
  
  'my-certificates': ['My certificates', 'Your completed certification records'],
  // 'upcoming-renewals': ['Alerts & renewals', 'Certificates that need your attention soon'],
  'upcoming-renewals': ['Upcoming renewals', 'Certificates that need your attention soon'],
  dashboard: ['', ''],
  employees: ['Employees Details', 'click a row for the full record'],
  exports: ['Export reports', 'Filter and download certification data'],
  'task-assignments': ['', 'Publish certification learning tasks to employees'],
  'certification-tasks': ['Certification tasks', 'Mandatory and optional learning assigned to you'],
  // alerts: ['Alerts & renewals', 'Certifications expiring soon, sorted by urgency'],
  alerts: ['Renewals', 'Certificates that need your attention soon'],
  compliance: ['OEM overview', 'OEM tier requirements vs. certified headcount'],
  catalog: ['Certification catalog', 'Every certification type recognised across the company'],
  'access-management': ['Access management', 'Create and manage employee access records'],
  'access-history': ['Access history', 'Created, edited, and deleted access-user records'],
  'certificate-activity': ['Certificate activity', 'Certificate changes and verification activity'],
  'activity-history': ['Activity history', 'Access and certificate audit records'],
  settings: ['Settings', 'Manage certification categories and OEMs'],
  'project-staffing': ['Project staffing', 'Match project requirements to primary and backup employees'],
  completions: ['Certificate records', 'Validated certification records and credential holders'],
}

const searchPlaceholders = {
  employees: 'Search employee, ID, location or department',
  'task-assignments': 'Search assigned certification tasks',
  'certification-tasks': 'Search my certification tasks',
  completions: 'Search holder, certificate, OEM or category',
  alerts: 'Search approvals, renewals or employees',
  compliance: 'Search OEM, certification or holder',
  catalog: 'Search certification catalog or OEM',
  'access-management': 'Search user, email, role or department',
  'access-history': 'Search access history records',
  'certificate-activity': 'Search certificate activity records',
  'activity-history': 'Search activity history records',
  settings: 'Search categories or OEMs',
  'my-profile': 'Search my certification profile',
  'my-course-list': 'Search my assigned courses',
  'my-certificates': 'Search my certificates or OEMs',
  'upcoming-renewals': 'Search my upcoming renewals',
}

export const pageIcons = {
  'my-profile': 'bi-person-badge',
  'my-course-list': 'bi-list-check',
  dashboard: 'bi-grid-1x2',
  'my-certificates': 'bi-patch-check',
  'upcoming-renewals': 'bi-alarm',
  employees: 'bi-people',
  exports: 'bi-file-earmark-arrow-down',
  'task-assignments': 'bi-send-check',
  'certification-tasks': 'bi-list-check',
  alerts: 'bi-bell',
  compliance: 'bi-buildings',
  catalog: 'bi-journal-check',
  'access-management': 'bi-person-gear',
  'access-history': 'bi-clock-history',
  'certificate-activity': 'bi-activity',
  'activity-history': 'bi-clock-history',
  settings: 'bi-gear',
  'project-staffing': 'bi-diagram-3',
}

const notificationTime = (value) => {
  if (!value) return 'Time unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

export default function AppHeader({ query, setQuery, onAdd, onMenu, user, alertCount = 0, notifications = [], onMarkNotificationRead, onMarkAllNotificationsRead }) {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  const key = pathname.split('/')[1] || 'dashboard'
  // Keep a back control available on mobile dashboard views as well. It is
  // visually hidden on desktop where Dashboard is the home destination.
  const showBack = true
  const isUser = ['user', 'project_manager'].includes(user?.role)
  const isPersonalWorkspace = isUser || ['my-profile', 'my-certificates', 'upcoming-renewals'].includes(key)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notificationRef = useRef(null)

  useEffect(() => {
    const closeDropdown = (event) => {
      if (!notificationRef.current?.contains(event.target)) setNotificationsOpen(false)
    }
    document.addEventListener('mousedown', closeDropdown)
    return () => document.removeEventListener('mousedown', closeDropdown)
  }, [])

  const openNotification = (notification) => {
    if (!notification.read) {
      // Persist in the background; opening a notification must feel immediate.
      Promise.resolve(onMarkNotificationRead?.(notification.key)).catch(() => {})
    }
    setNotificationsOpen(false)
    navigate(notification.path)
  }

  return (
    <header className={`er-top${isUser ? ' user-topbar' : ''}`}>
      <button className="mobile-menu-button" type="button" onClick={onMenu} aria-label="Open navigation">
        <i className="bi bi-list" />
      </button>
      <div className="top-brand" aria-label="OTEC by Office 2000 Solutions">
        <img src="/o2k-logo.png" alt="" />
        <span><b>OTEC</b><small>Certificate Management</small></span>
      </div>
      {key !== 'dashboard' && (
        <div className="er-search">
          <i className="bi bi-search" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholders[key] || (isPersonalWorkspace ? 'Search my certificates' : `Search ${pageMeta[key]?.[0]?.toLowerCase() || 'records'}`)}
            aria-label={`Search records on ${pageMeta[key]?.[0] || 'this page'}`}
          />
        </div>
      )}
      <div className="top-notification" ref={notificationRef}>
        <button
          className="top-notification-button"
          type="button"
          onClick={() => setNotificationsOpen((open) => !open)}
          aria-label={`Notifications${alertCount ? `, ${alertCount} new` : ''}`}
          aria-expanded={notificationsOpen}
          title="Notifications"
        >
          <i className="bi bi-bell" aria-hidden="true" />
          {alertCount > 0 && <em>{alertCount > 99 ? '99+' : alertCount}</em>}
        </button>
        {notificationsOpen && (
          <section className="notification-dropdown" aria-label="Notifications">
            <header>
              <b>Notifications</b>
              {alertCount > 0
                ? <button type="button" onClick={() => { Promise.resolve(onMarkAllNotificationsRead?.()).catch(() => {}) }}>Mark all as read</button>
                : <small>0 unread</small>}
            </header>
            <div className="notification-dropdown-list">
              {notifications.length ? notifications.map((notification) => (
                <article className="unread" key={notification.key}>
                  <i className={`bi ${notification.key.startsWith('pending:') ? 'bi-patch-exclamation' : 'bi-patch-check'}`} />
                  <div><b>{notification.title}</b><p>{notification.message}</p><time dateTime={notification.time || undefined}>{notificationTime(notification.time)}</time></div>
                  <footer>
                    {!notification.read && <button type="button" onClick={() => { Promise.resolve(onMarkNotificationRead?.(notification.key)).catch(() => {}) }}>Mark as read</button>}
                    <button type="button" onClick={() => openNotification(notification)}>Open</button>
                  </footer>
                </article>
              )) : <p className="notification-empty">You have no notifications.</p>}
            </div>
          </section>
        )}
      </div>
      <button
        className="global-profile-button"
        type="button"
        onClick={() => navigate(user?.role === 'admin' ? '/my-profile' : '/dashboard')}
        aria-label="Open my profile"
        title="My profile"
      >
        <span aria-hidden="true">{`${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U'}</span>
      </button>
      <button className="er-add" onClick={onAdd} aria-label={isPersonalWorkspace ? 'Add my certificate' : 'Add certification'}>
        <i className="bi bi-plus-lg" /> {isPersonalWorkspace ? 'Add my certificate' : 'Add certification'}
      </button>
      {showBack && (
        <button
          className={`global-back-button${key === 'dashboard' ? ' dashboard-back-button' : ''}`}
          type="button"
          onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/dashboard', { replace: true })}
          aria-label="Go to previous page"
        >
          <i className="bi bi-arrow-left" aria-hidden="true" />
          <span>Back</span>
        </button>
      )}
    </header>
  )
}
