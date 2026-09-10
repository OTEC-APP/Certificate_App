import { NavLink } from 'react-router-dom'
import { useRef } from 'react'

const workspace = [
  ['dashboard', 'bi-grid-1x2', 'Dashboard', 'Certification overview'],
  ['employees', 'bi-people', 'Employee details', 'Employee records'],
  ['task-assignments', 'bi-journal-bookmark', 'Course list', 'Courses and catalog'],
  ['alerts', 'bi-bell', 'Alert & Renewal', 'Approvals and renewals'],
  ['exports', 'bi-file-earmark-arrow-down', 'Generate Report', 'Export reports'],
  // Project staffing is temporarily disabled.
]


const manage = [
  ['access-management', 'bi-person-gear', 'Access management', 'User access'],
  ['activity-history', 'bi-clock-history', 'Activity tracker', 'Activity history'],
  ['settings', 'bi-gear', 'Settings', 'Categories and OEMs'],
]

const userWorkspace = [
  ['dashboard', 'bi-grid-1x2', 'Dashboard', 'My overview'],
  ['certification-tasks', 'bi-list-check', 'Course list', 'Assigned courses'],
  ['upcoming-renewals', 'bi-bell', 'Alerts & renewals', 'Renewal reminders'],
]

const projectManagerWorkspace = [
  ['dashboard', 'bi-grid-1x2', 'Dashboard', 'My overview'],
  ['certification-tasks', 'bi-list-check', 'Course list', 'Assigned courses'],
  ['upcoming-renewals', 'bi-bell', 'Alerts & renewals', 'Renewal reminders'],
  ['employees', 'bi-people', 'Employee details', 'All employee records'],
  ['exports', 'bi-file-earmark-arrow-down', 'Generate Report', 'Export employee reports'],
]

export default function Sidebar({ clearFilter, onClose, onLogout, user, alertCount = 0 }) {
  const navigationRef = useRef(null)

  const collapseNavigation = () => {
    navigationRef.current?.scrollTo({ top: 0 })
    onClose()
  }

  const links = (items) =>
    items.map(([path, icon, label, description, children]) => (
      <div key={path} className="sidebar-nav-item">
      <NavLink to={`/${path}`} onClick={() => { clearFilter(); collapseNavigation() }} data-tooltip={description} title={description} aria-label={`${label}: ${description}`}>
        <i className={`bi ${icon}`} />
        {label}
        {(path === 'alerts' || path === 'upcoming-renewals') && alertCount > 0 && <em aria-label={`${alertCount} alerts and renewals`}>{alertCount > 99 ? '99+' : alertCount}</em>}
      </NavLink>
      {children && <div className="sidebar-subnav" role="group" aria-label={`${label} pages`}>{links(children)}</div>}
      </div>
    ))

  return (
    <aside className="er-side">
      <div className="er-brand">
        <div className="o2k">
          <img src="/o2k-logo.png" alt="Office 2000 Solutions logo" />
        </div>
        <div className="er-brand-copy">
          <b>OTEC</b>
          <small>Certificate Management</small>
        </div>
        <button
          className="sidebar-collapse sidebar-collapse-top"
          onClick={collapseNavigation}
          aria-label="Close navigation"
          title="Close navigation"
        >
          <i className="bi bi-x-lg" />
        </button>
      </div>

      <div className="er-nav-scroll" ref={navigationRef}>
        <label>WORKSPACE</label>
        <nav>{links(user?.role === 'project_manager' ? projectManagerWorkspace : user?.role === 'user' ? userWorkspace : workspace)}</nav>
        {user?.role === 'admin' && (
          <>
            <label>MANAGE</label>
            <nav>{links(manage)}</nav>
          </>
        )}

      </div>

      <div className="sidebar-account">
        <NavLink className="er-user er-user-fixed sidebar-profile-link" to="/my-profile" onClick={() => { clearFilter(); collapseNavigation() }} data-tooltip="My profile" title="My profile">
          <span>{`${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}` || 'U'}</span>
          <div>
            <b>{user ? `${user.firstName} ${user.lastName}` : 'Signed-in user'}</b>
            <small>{user?.role === 'admin' ? 'Administrator' : user?.role === 'project_manager' ? 'Project Manager' : 'User'}</small>
          </div>
        </NavLink>
        <div className="sidebar-actions">
          <button
            className="sidebar-logout"
            onClick={onLogout}
            aria-label="Logout"
            data-tooltip="Logout"
            title="Logout"
          >
            <i className="bi bi-box-arrow-right" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
