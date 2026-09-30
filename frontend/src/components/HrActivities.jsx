import { useEffect, useState } from 'react'
import Pagination from './Pagination'
import { confirmDelete, promptForName, confirmEmailAlertsChange } from '../dialogs'
const apiUrl = process.env.REACT_APP_API_URL

const HR_ACTIVITY_TYPES = [
  {
    key: 'add_certificate',
    label: 'Add Certificate',
    icon: 'bi-file-earmark-plus',
    description: 'New certificate submissions awaiting approval',
  },
  {
    key: 'add_user',
    label: 'Add User',
    icon: 'bi-person-plus',
    description: 'New user registrations awaiting approval',
  },
  {
    key: 'delete_user',
    label: 'Delete User',
    icon: 'bi-person-dash',
    description: 'User deletion requests awaiting approval',
  },
  {
    key: 'add_category',
    label: 'Add Category',
    icon: 'bi-tag-plus',
    description: 'New certification category requests awaiting approval',
  },
  {
    key: 'delete_category',
    label: 'Delete Category',
    icon: 'bi-tag-dash',
    description: 'Category deletion requests awaiting approval',
  },
  {
    key: 'add_oem',
    label: 'Add OEM',
    icon: 'bi-building-gear',
    description: 'New OEM manufacturer requests awaiting approval',
  },
  {
    key: 'delete_oem',
    label: 'Delete OEM',
    icon: 'bi-building-slash',
    description: 'OEM deletion requests awaiting approval',
  },
]

export default function HrActivities({ user, notify, runWithLoader, query = '', realtimeVersion }) {
  const [hrApprovalEnabled, setHrApprovalEnabled] = useState(true)
  const [hrApprovalActivities, setHrApprovalActivities] = useState({})
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [activities, setActivities] = useState({})
  const [loadingActivities, setLoadingActivities] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalItems, setTotalItems] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch(`${apiUrl}/settings/hr-approval`)
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to load HR approval settings')
        setHrApprovalEnabled(Boolean(result.enabled))
        setHrApprovalActivities(result.activities || {})
      } catch (error) {
        notify(error.message || 'Unable to load HR approval settings')
      } finally {
        setLoadingSettings(false)
      }
    }
    loadSettings()
  }, [notify])

  const loadActivities = async () => {
    setLoadingActivities(true)
    setError('')
    try {
      const typeParam = activeTab === 'overview' ? '' : activeTab
      const response = await fetch(
        `${apiUrl}/hr-activities?activity_type=${typeParam}&page=${page}&page_size=${pageSize}`,
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to load HR activities')

      if (activeTab === 'overview') {
        const allResponse = await fetch(`${apiUrl}/hr-activities?page=1&page_size=100`)
        const allResult = await allResponse.json()
        const grouped = {}
        ;(allResult.items || []).forEach((item) => {
          if (!grouped[item.activity_type]) grouped[item.activity_type] = []
          grouped[item.activity_type].push(item)
        })
        setActivities(grouped)
        setTotalItems(allResult.total || 0)
      } else {
        setActivities({ [activeTab]: result.items || [] })
        setTotalItems(result.total || 0)
      }
    } catch (error) {
      setError(error.message || 'Unable to load HR activities')
      notify(error.message || 'Unable to load HR activities')
    } finally {
      setLoadingActivities(false)
    }
  }

  useEffect(() => {
    loadActivities()
    window.addEventListener('hr-activities-updated', loadActivities)
    return () => {
      window.removeEventListener('hr-activities-updated', loadActivities)
    }
    // WebSocket-driven realtimeVersion covers remote changes; avoiding a
    // per-browser polling loop keeps Firestore and App Engine usage bounded.
  }, [notify, realtimeVersion, activeTab, page, pageSize])

  const toggleHrApproval = async () => {
    const nextEnabled = !hrApprovalEnabled
    setSavingSettings(true)
    try {
      const response = await fetch(`${apiUrl}/settings/hr-approval`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled, activities: hrApprovalActivities }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to update HR approval settings')
      setHrApprovalEnabled(Boolean(result.enabled))
      notify(nextEnabled ? 'HR activities approval enabled' : 'HR activities approval disabled')
    } catch (error) {
      notify(error.message || 'Unable to update HR approval settings')
    } finally {
      setSavingSettings(false)
    }
  }

  const toggleHrActivity = async (activityKey) => {
    const nextActivities = {
      ...hrApprovalActivities,
      [activityKey]: !hrApprovalActivities[activityKey],
    }
    setHrApprovalActivities(nextActivities)
    setSavingSettings(true)
    try {
      const response = await fetch(`${apiUrl}/settings/hr-approval`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: hrApprovalEnabled, activities: nextActivities }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to update HR approval settings')
    } catch (error) {
      notify(error.message || 'Unable to update HR approval settings')
      setHrApprovalActivities(hrApprovalActivities)
    } finally {
      setSavingSettings(false)
    }
  }

  const getActivityItems = (type) => activities[type] || []
  const getActivityCount = (type) => getActivityItems(type).length
  const getTotalCount = () => Object.values(activities).flat().length

  if (loadingSettings || loadingActivities) {
    return <p className="user-empty">Loading HR activities...</p>
  }

  const handleApprove = (activityId, activityType) => {
    runWithLoader('Approving request', async () => {
      const response = await fetch(`${apiUrl}/hr-activities/${activityId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewed_by: `${user.firstName} ${user.lastName}`.trim(),
          review_remarks: '',
        }),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Failed to approve')
      }
      notify('Request approved')
      loadActivities()
    })
  }

  const handleReject = (activityId) => {
    runWithLoader('Rejecting request', async () => {
      const response = await fetch(`${apiUrl}/hr-activities/${activityId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewed_by: `${user.firstName} ${user.lastName}`.trim(),
          review_remarks: 'Rejected by council member',
        }),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Failed to reject')
      }
      notify('Request rejected')
      loadActivities()
    })
  }

  const formatDate = (isoString) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
  }

  return (
    <section className="er-card hr-activities-card">
      <header>
        <div>
          <h3>HR Activities Approval</h3>
          <p>Track and approve HR activities that require council review.</p>
        </div>
        <div className="hr-approval-toggle-wrapper">
          <div className={`hr-approval-control ${hrApprovalEnabled ? 'enabled' : 'disabled'}`}>
            <div className="hr-approval-icon">
              <i className={`bi ${hrApprovalEnabled ? 'bi-shield-check' : 'bi-shield-lock'}`} />
            </div>
            <div className="hr-approval-copy">
              <b>HR activities require council approval</b>
              <small>
                {hrApprovalEnabled
                  ? 'Enabled activities below route to council for review.'
                  : 'All HR activities bypass council approval.'}
              </small>
            </div>
            <button
              type="button"
              className="hr-approval-switch"
              onClick={toggleHrApproval}
              disabled={savingSettings}
              role="switch"
              aria-checked={hrApprovalEnabled}
              aria-label={`${hrApprovalEnabled ? 'Turn off' : 'Turn on'} HR activities approval`}
            >
              <span className="hr-approval-knob" aria-hidden="true" />
              <b>{hrApprovalEnabled ? 'On' : 'Off'}</b>
            </button>
          </div>
        </div>
      </header>

      <div className="hr-activities-tabs" role="tablist">
        <button
          role="tab"
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => {
            setActiveTab('overview')
            setPage(1)
          }}
        >
          Overview <span className="tab-badge">{getTotalCount()}</span>
        </button>
        {HR_ACTIVITY_TYPES.map((type) => (
          <button
            key={type.key}
            role="tab"
            className={activeTab === type.key ? 'active' : ''}
            onClick={() => {
              setActiveTab(type.key)
              setPage(1)
            }}
          >
            {type.label} <span className="tab-badge">{getActivityCount(type.key)}</span>
          </button>
        ))}
      </div>

      {error && <div className="error-message">{error}</div>}

      {activeTab === 'overview' && (
        <div className="hr-activities-overview">
          {HR_ACTIVITY_TYPES.map((type) => {
            const items = getActivityItems(type.key)
            return (
              <div key={type.key} className="hr-activity-summary-card">
                <div className="hr-activity-summary-header">
                  <div className="hr-activity-summary-icon">
                    <i className={`bi ${type.icon}`} />
                  </div>
                  <div className="hr-activity-summary-info">
                    <h4>{type.label}</h4>
                    <p>{type.description}</p>
                  </div>
                  <div className="hr-activity-summary-counts">
                    <span className="pending-count">{items.length} items</span>
                    <span className="total-count">{items.length} total</span>
                  </div>
                </div>
                <div className="hr-activity-toggle">
                  <label>
                    <input
                      type="checkbox"
                      checked={hrApprovalActivities[type.key] !== false}
                      onChange={() => toggleHrActivity(type.key)}
                      disabled={savingSettings || !hrApprovalEnabled}
                    />
                    <span>Require approval</span>
                  </label>
                </div>
                {items.length > 0 && (
                  <button
                    className="view-pending-btn"
                    onClick={() => {
                      setActiveTab(type.key)
                      setPage(1)
                    }}
                  >
                    View {items.length} pending
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {HR_ACTIVITY_TYPES.find((t) => t.key === activeTab) && activeTab !== 'overview' && (
        <div className="hr-activity-detail">
          <div className="hr-activity-detail-header">
            <h4>{HR_ACTIVITY_TYPES.find((t) => t.key === activeTab).label} - Pending Approval</h4>
            <span className="pending-count">{getActivityCount(activeTab)} items</span>
          </div>
          <div className="hr-activity-table-wrapper">
            <table className="hr-activity-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Details</th>
                  <th>Requested By</th>
                  <th>Date/Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {getActivityItems(activeTab).map((activity) => (
                  <tr key={activity.id}>
                    <td className="activity-title">{activity.title}</td>
                    <td className="activity-details">{activity.details || '-'}</td>
                    <td className="activity-requested-by">
                      {activity.requested_by_name || activity.requested_by || 'Unknown'}
                    </td>
                    <td className="activity-datetime">{formatDate(activity.created_at)}</td>
                    <td className="activity-actions">
                      <button
                        className="approve"
                        onClick={() => handleApprove(activity.id, activeTab)}
                      >
                        Approve
                      </button>
                      <button className="reject" onClick={() => handleReject(activity.id)}>
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
                {getActivityItems(activeTab).length === 0 && (
                  <tr>
                    <td colSpan="5" className="no-data">
                      No pending{' '}
                      {HR_ACTIVITY_TYPES.find((t) => t.key === activeTab).label.toLowerCase()}{' '}
                      requests.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
            label="requests"
          />
        </div>
      )}
    </section>
  )
}
