import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from 'react-router-dom'
import { useEffect, useState } from 'react'
import DashboardPage from './pages/DashboardPage'
import UserDashboardPage from './pages/UserDashboardPage'
import LiveEmployeesPage from './pages/LiveEmployeesPage'
import CompletionRecordsPage from './pages/CompletionRecordsPage'
import ExportReportsPage from './pages/ExportReportsPage'
import CertificationTasksPage from './pages/CertificationTasksPage'
import CompletedTaskUsersPage from './pages/CompletedTaskUsersPage'
import LoadingOverlay from './components/LoadingOverlay'
import LiveAlertsPage from './pages/LiveAlertsPage'
import CompliancePage from './pages/CompliancePage'
import LiveCatalogPage from './pages/LiveCatalogPage'
import SettingsPage from './pages/SettingsPage'
import AccessManagementPage from './pages/AccessManagementPage'
import ActivityHistoryPage from './pages/ActivityHistoryPage'
import LoginPage from './pages/LoginPage'
import LiveEmployeeRecordPage from './pages/LiveEmployeeRecordPage'
import Sidebar from './components/Sidebar'
import AppHeader from './components/AppHeader'
import PageHeading from './components/PageHeading'
import AdminCertificateModal from './components/AdminCertificateModal'
import UserCertificateModal from './components/UserCertificateModal'
import { closeAlert, showProcessingAlert, showToastAlert } from './dialogs'
import apiUrl from './api'
import './react-dashboard.css'
import './prototype-match.css'
import './dashboard-scroll-fix.css'
import './employee-record.css'
import './sidebar-toggle.css'
import './access-management.css'
import './login.css'
import './user-dashboard.css'
import './loading-overlay.css'
import './compliance-page.css'
import './dashboard-chart-toggle.css'
import './completion-records.css'
import './export-reports.css'
import './certification-tasks.css'
import './certification-task-reporting.css'
import './certification-task-workflow.css'
import './project-staffing.css'
import './project-staffing-collapse.css'
import './responsive.css'
import './modern-glass-theme.css'
import './drawer-navigation.css'
import './dashboard-card-geometry.css'
import './employee-record-overrides.css'
import './responsive-overrides.css'

const SESSION_KEY = 'certtrack-auth-session'
const SESSION_USER_KEY = 'certtrack-auth-user'
const LAST_ACTIVITY_KEY = 'certtrack-last-activity'
const TAB_ID_KEY = 'certtrack-tab-id'
const TAB_OWNER_PREFIX = 'certtrack-tab-owner:'
const LAST_PRESENCE_KEY = 'certtrack-last-presence'
const IDLE_TIMEOUT_MS = 15 * 60 * 1000
const TAB_OWNER_TTL_MS = 15 * 1000
const PRESENCE_INTERVAL_MS = 60 * 1000


// Authentication is deliberately per browser tab.  localStorage is shared by every
// tab, so an admin signing in elsewhere could otherwise replace a user's role.
const authStorage = () => window.sessionStorage
const randomId = () =>
  window.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`
 
const tabRuntimeId = randomId()
 
const prepareTabSession = () => {
  try {
    let tabId = authStorage().getItem(TAB_ID_KEY)
    const navigation = window.performance?.getEntriesByType?.('navigation')?.[0]
    const isReload = navigation?.type === 'reload'
    let existingOwner = null
 
    if (tabId) {
      try {
        existingOwner = JSON.parse(localStorage.getItem(`${TAB_OWNER_PREFIX}${tabId}`) || 'null')
      } catch {
        existingOwner = null
      }
    }
 
    const copiedFromActiveTab = Boolean(
      tabId &&
      !isReload &&
      existingOwner?.runtimeId &&
      existingOwner.runtimeId !== tabRuntimeId &&
      Date.now() - Number(existingOwner.updatedAt || 0) < TAB_OWNER_TTL_MS,
    )
 
    if (copiedFromActiveTab) {
      // Browser "Duplicate tab" copies the complete sessionStorage snapshot.
      // Discard that copied state so the new tab always starts as a clean,
      // unauthenticated CertTrack tab and must complete Microsoft sign-in again.
      authStorage().clear()
      tabId = randomId()
      authStorage().setItem(TAB_ID_KEY, tabId)
    } else if (!tabId) {
      tabId = randomId()
      authStorage().setItem(TAB_ID_KEY, tabId)
    }
 
    localStorage.setItem(
      `${TAB_OWNER_PREFIX}${tabId}`,
      JSON.stringify({ runtimeId: tabRuntimeId, updatedAt: Date.now() }),
    )
    return tabId
  } catch {
    // Storage can be unavailable in hardened browsers. Authentication continues
    // normally, but duplicate-tab detection cannot run in that environment.
    return ''
  }
}
 
const currentTabId = prepareTabSession()

const normaliseUser = (savedUser) => {
  if (!savedUser || typeof savedUser !== 'object') return null

  const role = String(savedUser.role || '')
    .trim()
    .toLowerCase()
  if (!['admin', 'project_manager', 'user'].includes(role)) return null

  return { ...savedUser, role }
}

const readSessionUser = () => {
  try {
    return normaliseUser(JSON.parse(authStorage().getItem(SESSION_USER_KEY) || 'null'))
  } catch {
    return null
  }
}

function Shell({ onLogout, user }) {
  const navigate = useNavigate()
  const location = useLocation()
  const theme = 'light'
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [certificateDefaults, setCertificateDefaults] = useState(null)
  const [toast, setToast] = useState('')
  const [loadingMessage, setLoadingMessage] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [alertCount, setAlertCount] = useState(0)
  const [notifications, setNotifications] = useState([])
  const [realtimeVersion, setRealtimeVersion] = useState(0)
  const personalCertificatePage = ['/my-profile', '/my-certificates', '/upcoming-renewals'].includes(location.pathname)
  const notificationUserKey = String(user?.id || user?.employeeEmail || user?.role || 'anonymous')
  useEffect(() => {
    document.documentElement.lang = 'en-GB'
    localStorage.removeItem('certtrack-theme')
  }, [])


   useEffect(() => {
    let socket
    let reconnectTimer
    let heartbeatTimer
    let stopped = false
    const configuredApiUrl = String(apiUrl || '')
    const configuredSocketUrl = String(process.env.REACT_APP_WEBSOCKET_URL || '')
    const socketBase = configuredSocketUrl
      ? configuredSocketUrl.replace(/\/ws\/updates\/?$/, '')
      : /^https?:\/\//i.test(configuredApiUrl)
        ? configuredApiUrl.replace(/\/api\/?$/, '').replace(/^http/i, 'ws')
        // CRA's HTTP proxy does not reliably forward WebSocket upgrades. Use the
        // local FastAPI server directly, without changing the existing REST API.
        : process.env.NODE_ENV === 'development'
          ? `ws://${window.location.hostname}:5000`
          : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    const socketUrl = `${socketBase.replace(/\/$/, '')}/ws/updates`
    const connect = () => {
      socket = new WebSocket(socketUrl)
      socket.onopen = () => {
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send('ping')
        }, 25_000)
      }
      socket.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data)
          if (update.type === 'certificate.updated' || update.type === 'access.updated') {
            setRealtimeVersion((version) => version + 1)
          }
        } catch {
          // Ignore malformed messages without interrupting the application.
        }
      }
      socket.onclose = () => {
        window.clearInterval(heartbeatTimer)
        if (!stopped) reconnectTimer = window.setTimeout(connect, 5_000)
      }
    }
    connect()
    return () => {
      stopped = true
      window.clearTimeout(reconnectTimer)
      window.clearInterval(heartbeatTimer)
      socket?.close()
    }
  }, [])
 
 

  useEffect(() => {
    if (window.innerWidth <= 1000) setSidebarOpen(false)
    setQuery('')
  }, [location.pathname])

  useEffect(() => {
    let active = true
    const loadAlertCount = async () => {
      try {
        const approvalUrl = user?.role === 'admin'
          ? `${apiUrl}/certificates?status=pending&page=1&page_size=100`
          : `${apiUrl}/certificates?search=${encodeURIComponent(user.employeeEmail || '')}&page=1&page_size=100`
        const requests = [
          fetch(approvalUrl, { cache: 'no-store' }),
          fetch(`${apiUrl}/notification-reads?user_key=${encodeURIComponent(notificationUserKey)}`, { cache: 'no-store' }),
        ]
        const results = await Promise.all(requests)
        const data = await Promise.all(results.map((response) => response.ok ? response.json() : { total: 0 }))
        const seenKeys = new Set(data[1]?.notification_keys || [])
        const nextNotifications = (data[0].items || [])
          .filter((item) => user?.role === 'admin' || (
            String(item.email || '').toLowerCase() === String(user.employeeEmail || '').toLowerCase()
            && item.reviewed_at
            && ['issued', 'revoked'].includes(item.status)
          ))
          .map((item) => {
            const isAdminRequest = user?.role === 'admin'
            const key = isAdminRequest
              ? `pending:${item.id}`
              : `review:${item.id}:${item.status}:${item.reviewed_at}`
            return {
              key,
              title: item.course_name || 'Certificate approval',
              message: isAdminRequest
                ? `${item.recipient_name || 'An employee'} requested certificate approval`
                : `Your certificate was ${item.status === 'issued' ? 'validated' : 'revoked'}${item.reviewed_by ? ` by ${item.reviewed_by}` : ''}`,
              time: isAdminRequest ? item.created_at : item.reviewed_at,
              path: isAdminRequest ? '/alerts' : '/my-certificates',
              read: seenKeys.has(key),
            }
          })
          .sort((first, second) => (Date.parse(second.time) || 0) - (Date.parse(first.time) || 0))
          .filter((item) => !item.read)
        if (active) {
          setNotifications(nextNotifications)
          setAlertCount(nextNotifications.length)
        }
      } catch {
        if (active) {
          setNotifications([])
          setAlertCount(0)
        }
      }
    }
    loadAlertCount()
    const refresh = () => loadAlertCount()
    window.addEventListener('certificates-updated', refresh)
    const interval = window.setInterval(loadAlertCount, 30_000)
    return () => {
      active = false
      window.removeEventListener('certificates-updated', refresh)
      window.clearInterval(interval)
    }
  }, [notificationUserKey, user?.employeeEmail, user?.role])

  const markNotificationRead = async (notificationKey) => {
    setNotifications((items) => items.filter((item) => item.key !== notificationKey))
    setAlertCount((count) => Math.max(0, count - 1))
    try {
      const response = await fetch(`${apiUrl}/notification-reads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_key: notificationUserKey, notification_keys: [notificationKey] }),
      })
      if (!response.ok) throw new Error('Unable to synchronize notification read status')
    } catch (error) {
      console.warn(error.message)
    }
  }

  const markAllNotificationsRead = async () => {
    const notificationKeys = notifications.map((item) => item.key)
    if (!notificationKeys.length) return
    setNotifications([])
    setAlertCount(0)
    try {
      const response = await fetch(`${apiUrl}/notification-reads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_key: notificationUserKey, notification_keys: notificationKeys }),
      })
      if (!response.ok) throw new Error('Unable to synchronize notification read status')
    } catch (error) {
      console.warn(error.message)
    }
  }

  const notify = (message) => showToastAlert(message)
  const openEmployees = (nextFilter = null) => {
    setFilter(nextFilter)
    navigate('/employees')
  }
  const runWithLoader = async (message, action) => {
    showProcessingAlert(message)
    try {
      return await action()
    } finally {
      closeAlert()
    }
  }
  const context = {
    query,
    filter,
    openEmployees,
    goTo: (page) => navigate(`/${page}`),
    notify,
    runWithLoader,
    user,
    realtimeVersion,
    openCertificateForm: (defaults = null) => {
      setCertificateDefaults(defaults)
      setShowModal(true)
    },
  }

  return (
    <div
      className={`exact-react ${sidebarOpen ? '' : 'sidebar-collapsed'}`}
      data-theme={theme}
      style={{
        '--accent': '#d84457',
        '--accent2': '#f07167',
        '--soft': '#fff0f1',
      }}
    >
      <Sidebar
        clearFilter={() => setFilter(null)}
        onClose={() => setSidebarOpen(false)}
        onOpen={() => setSidebarOpen(true)}
        collapsed={!sidebarOpen}
        onLogout={onLogout}
        user={user}
        alertCount={alertCount}
      />
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <main>
        <AppHeader
          query={query}
          setQuery={setQuery}
          onAdd={() => { setCertificateDefaults(null); setShowModal(true) }}
          onMenu={() => setSidebarOpen(true)}
          user={user}
          alertCount={alertCount}
          notifications={notifications}
          onMarkNotificationRead={markNotificationRead}
          onMarkAllNotificationsRead={markAllNotificationsRead}
        />
        <section className="er-view">
          <PageHeading user={user} filter={filter} />
          <Outlet context={context} />
        </section>
        <footer className="app-footer">
          &copy; {new Date().getFullYear()} Office 2000 Solutions Pvt Ltd
        </footer>
      </main>
      {showModal &&
        (user?.role === 'user' || personalCertificatePage ? (
          <UserCertificateModal
            close={() => { setShowModal(false); setCertificateDefaults(null) }}
            notify={notify}
            user={user}
            runWithLoader={runWithLoader}
            defaults={certificateDefaults}
          />
        ) : (
          <AdminCertificateModal
            close={() => setShowModal(false)}
            notify={notify}
            runWithLoader={runWithLoader}
          />
        ))}
    </div>
  )
}

const RoutedDashboard = () => {
  const context = useOutletContext()
  return ['user', 'project_manager'].includes(context.user.role) ? (
    <UserDashboardPage {...context} initialTab="overview" />
  ) : (
    <DashboardPage {...context} />
  )
}
const RoutedUserCertificates = () => (
  <UserDashboardPage {...useOutletContext()} initialTab="certificates" />
)
// const RoutedMyProfile = () => <UserDashboardPage {...useOutletContext()} initialTab="certificates" />
const RoutedMyProfile = () => <UserDashboardPage {...useOutletContext()} initialTab="overview" />
const RoutedUserRenewals = () => <UserDashboardPage {...useOutletContext()} initialTab="renewals" />
const RoutedMyCourseList = () => <CertificationTasksPage {...useOutletContext()} personalMode />
const RoutedEmployees = () => <LiveEmployeesPage {...useOutletContext()} />
const RoutedExportReports = () => <ExportReportsPage />
const RoutedCertificationTasks = () => {
  const context = useOutletContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const oemActive = searchParams.get('view') === 'oem'
  const catalogActive = searchParams.get('view') === 'catalog'
  const isAdmin = context.user.role === 'admin'
  return (
    <div className="compliance-workspace course-list-workspace">
      {isAdmin && <nav className="compliance-view-toggle" aria-label="Course list views">
        <button type="button" className={!oemActive && !catalogActive ? 'active' : ''} aria-pressed={!oemActive && !catalogActive} onClick={() => setSearchParams({})}>
          <i className="bi bi-journal-bookmark" aria-hidden="true" /> Course list
        </button>
        <button type="button" className={catalogActive ? 'active' : ''} aria-pressed={catalogActive} onClick={() => setSearchParams({ view: 'catalog' })}>
          <i className="bi bi-journal-check" aria-hidden="true" /> Certification catalog
        </button>
        <button type="button" className={oemActive ? 'active' : ''} aria-pressed={oemActive} onClick={() => setSearchParams({ view: 'oem' })}>
          <i className="bi bi-shield-check" aria-hidden="true" /> OEM Overview
        </button>
      </nav>}
      {(!isAdmin || (!oemActive && !catalogActive)) && <CertificationTasksPage {...context} />}
      {isAdmin && oemActive && <CompliancePage {...context} />}
      {isAdmin && catalogActive && <LiveCatalogPage {...context} />}
    </div>
  )
}
const RoutedCompletedTaskUsers = () => <CompletedTaskUsersPage />
const RoutedAlerts = () => <LiveAlertsPage {...useOutletContext()} />
const RoutedCompliance = () => <Navigate to="/task-assignments?view=oem" replace />
const RoutedSettings = () => <SettingsPage {...useOutletContext()} />
const RoutedAccessManagement = () => <AccessManagementPage {...useOutletContext()} />
const RoutedActivityHistory = () => <ActivityHistoryPage {...useOutletContext()} />
const RoutedEmployeeRecord = () => <LiveEmployeeRecordPage {...useOutletContext()} />
const AdminOnly = ({ children }) => {
  const { user } = useOutletContext()
  return user.role === 'admin' ? children : <Navigate to="/dashboard" replace />
}
const AdminOrProjectManager = ({ children }) => {
  const { user } = useOutletContext()
  return ['admin', 'project_manager'].includes(user.role) ? children : <Navigate to="/dashboard" replace />
}
const UserOnly = ({ children }) => {
  const { user } = useOutletContext()
  return user.role === 'user' ? children : <Navigate to="/dashboard" replace />
}
const UserOrProjectManager = ({ children }) => {
  const { user } = useOutletContext()
  return ['user', 'project_manager'].includes(user.role) ? children : <Navigate to="/dashboard" replace />
}

export default function App() {
   const loginParameters = new URLSearchParams(window.location.search)
  const isAzureCallback =
    loginParameters.has('azure_code') || loginParameters.has('error')
  const [authenticated, setAuthenticated] = useState(() => {
    const lastActivity = Number(authStorage().getItem(LAST_ACTIVITY_KEY))
    const savedUser = readSessionUser()
    return (
      authStorage().getItem(SESSION_KEY) === 'active' &&
      Boolean(savedUser) &&
      lastActivity > 0 &&
      Date.now() - lastActivity < IDLE_TIMEOUT_MS
    )
  })
  const [user, setUser] = useState(readSessionUser)
   useEffect(() => {
    if (!currentTabId) return undefined
    const ownerKey = `${TAB_OWNER_PREFIX}${currentTabId}`
    const refreshOwnership = () => {
      localStorage.setItem(
        ownerKey,
        JSON.stringify({ runtimeId: tabRuntimeId, updatedAt: Date.now() }),
      )
    }
    const releaseOwnership = () => {
      try {
        const owner = JSON.parse(localStorage.getItem(ownerKey) || 'null')
        if (owner?.runtimeId === tabRuntimeId) localStorage.removeItem(ownerKey)
      } catch {
        // Ignore storage cleanup failures while the page is closing.
      }
    }
 
    refreshOwnership()
    const heartbeat = window.setInterval(refreshOwnership, 5000)
    window.addEventListener('pagehide', releaseOwnership)
    return () => {
      window.clearInterval(heartbeat)
      window.removeEventListener('pagehide', releaseOwnership)
      releaseOwnership()
    }
  }, [])

  const login = (signedInUser) => {
    const verifiedUser = normaliseUser(signedInUser)
    if (!verifiedUser) return
    authStorage().setItem(SESSION_KEY, 'active')
    authStorage().setItem(LAST_ACTIVITY_KEY, String(Date.now()))
    authStorage().setItem(SESSION_USER_KEY, JSON.stringify(verifiedUser))
    authStorage().removeItem(LAST_PRESENCE_KEY)
    setUser(verifiedUser)
    setAuthenticated(true)
  }

  const logout = () => {
    authStorage().removeItem(SESSION_KEY)
    authStorage().removeItem(LAST_ACTIVITY_KEY)
    authStorage().removeItem(SESSION_USER_KEY)
    authStorage().removeItem(LAST_PRESENCE_KEY)
    setUser(null)
    setAuthenticated(false)
  }

   useEffect(() => {
    if (!currentTabId || !('BroadcastChannel' in window)) return undefined
 
    // A browser duplicate copies sessionStorage.  Ask other live tabs whether
    // they already own this id instead of guessing from a page navigation.
    // This keeps the original tab signed in after a Microsoft redirect.
    const channel = new BroadcastChannel('certtrack-tab-sessions')
    const clearCopiedSession = () => {
      authStorage().clear()
      authStorage().setItem(TAB_ID_KEY, randomId())
      setUser(null)
      setAuthenticated(false)
      window.location.replace('/login')
    }
    const handleMessage = ({ data }) => {
      if (!data || data.tabId !== currentTabId) return
      if (data.type === 'tab-owner-check' && data.runtimeId !== tabRuntimeId) {
        channel.postMessage({
          type: 'tab-owner-present',
          tabId: currentTabId,
          targetRuntimeId: data.runtimeId,
          runtimeId: tabRuntimeId,
        })
      }
      if (
        data.type === 'tab-owner-present' &&
        data.targetRuntimeId === tabRuntimeId &&
        data.runtimeId !== tabRuntimeId
      ) clearCopiedSession()
    }
    channel.addEventListener('message', handleMessage)
    channel.postMessage({ type: 'tab-owner-check', tabId: currentTabId, runtimeId: tabRuntimeId })
    return () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
    }
  }, [])
 

  useEffect(() => {
    if (!authenticated) return undefined

    let expirationTimer
    let lastRecordedActivity = 0
    const expireSession = () => {
      authStorage().removeItem(SESSION_KEY)
      authStorage().removeItem(LAST_ACTIVITY_KEY)
      authStorage().removeItem(SESSION_USER_KEY)
      setUser(null)
      setAuthenticated(false)
    }
    const armExpirationTimer = () => {
      window.clearTimeout(expirationTimer)
      const lastActivity = Number(authStorage().getItem(LAST_ACTIVITY_KEY)) || Date.now()
      const remainingTime = Math.max(0, IDLE_TIMEOUT_MS - (Date.now() - lastActivity))
      expirationTimer = window.setTimeout(expireSession, remainingTime)
    }
    const recordActivity = () => {
      const now = Date.now()
      if (now - lastRecordedActivity < 30_000) return
      lastRecordedActivity = now
      authStorage().setItem(LAST_ACTIVITY_KEY, String(now))
      armExpirationTimer()
    }

    const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, recordActivity, { passive: true }),
    )
    armExpirationTimer()

    return () => {
      window.clearTimeout(expirationTimer)
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity))
    }
  }, [authenticated])

  useEffect(() => {
    if (!authenticated || !user?.id || !currentTabId) return undefined
    let stopped = false
    let requestInFlight = false
    const heartbeat = () => {
      if (stopped || document.visibilityState !== 'visible') return
      const lastSent = Number(authStorage().getItem(LAST_PRESENCE_KEY)) || 0
      if (Date.now() - lastSent < PRESENCE_INTERVAL_MS || requestInFlight) return
      requestInFlight = true
      fetch(`${apiUrl}/auth/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, session_id: currentTabId }),
        keepalive: true,
      }).then((response) => {
        if (response.ok) authStorage().setItem(LAST_PRESENCE_KEY, String(Date.now()))
      }).catch(() => {
        // Presence is helpful metadata; it must never interrupt the employee's work.
      }).finally(() => {
        requestInFlight = false
      })
    }
    heartbeat()
    const timer = window.setInterval(heartbeat, PRESENCE_INTERVAL_MS)
    document.addEventListener('visibilitychange', heartbeat)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', heartbeat)
    }
  }, [authenticated, user?.id])

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="login"
          element={
            authenticated ? <Navigate to="/dashboard" replace /> : <LoginPage onLogin={login} />
          }
        />
        <Route
          element={
            authenticated && user && !isAzureCallback ? (
              <Shell onLogout={logout} user={user} />
            ) : (
              <LoginPage onLogin={login} />
            )
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<RoutedDashboard />} />
          <Route path="my-profile" element={<RoutedMyProfile />} />
          <Route path="my-course-list" element={<AdminOnly><RoutedMyCourseList /></AdminOnly>} />
          <Route path="completions" element={<AdminOnly><CompletionRecordsPage /></AdminOnly>} />
          <Route path="exports" element={<AdminOrProjectManager><RoutedExportReports /></AdminOrProjectManager>} />
          <Route path="task-assignments" element={<AdminOnly><RoutedCertificationTasks /></AdminOnly>} />
          <Route path="task-assignments/:taskId/completed-users" element={<AdminOnly><RoutedCompletedTaskUsers /></AdminOnly>} />
          <Route path="certification-tasks" element={<UserOrProjectManager><RoutedCertificationTasks /></UserOrProjectManager>} />
          <Route
            path="my-certificates"
            element={<RoutedUserCertificates />}
          />
          <Route
            path="upcoming-renewals"
            element={<RoutedUserRenewals />}
          />
          <Route
            path="employees"
            element={
              <AdminOrProjectManager>
                <RoutedEmployees />
              </AdminOrProjectManager>
            }
          />
          {/* Project staffing is temporarily disabled. */}
          <Route
            path="employees/:employeeId"
            element={
              <AdminOrProjectManager>
                <RoutedEmployeeRecord />
              </AdminOrProjectManager>
            }
          />
          <Route
            path="alerts"
            element={
              <AdminOnly>
                <RoutedAlerts />
              </AdminOnly>
            }
          />
          <Route
            path="compliance"
            element={
              <AdminOnly>
                <RoutedCompliance />
              </AdminOnly>
            }
          />
          <Route
            path="catalog"
            element={
              <AdminOnly>
                  <Navigate to="/task-assignments?view=catalog" replace />
              </AdminOnly>
            }
          />
          <Route
            path="access-management"
            element={
              <AdminOnly>
                <RoutedAccessManagement />
              </AdminOnly>
            }
          />
          <Route
            path="activity-history"
            element={
              <AdminOnly>
                <RoutedActivityHistory />
              </AdminOnly>
            }
          />
          <Route
            path="access-history"
            element={
              <AdminOnly>
                <Navigate to="/activity-history" replace />
              </AdminOnly>
            }
          />
          <Route path="certificate-activity" element={<AdminOnly><Navigate to="/activity-history" replace /></AdminOnly>} />
          <Route
            path="settings"
            element={
              <AdminOnly>
                <RoutedSettings />
              </AdminOnly>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
