import { useEffect, useMemo, useState } from 'react'
import apiUrl from '../api'
import Pagination from '../components/Pagination'

const displayDate = (value) => {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function CouncilMemberDashboardPage({ notify }) {
  const [activityData, setActivityData] = useState(null)
  const [memberStats, setMemberStats] = useState({ council_members: [] })
  const [status, setStatus] = useState('overall')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [showCouncilMembers, setShowCouncilMembers] = useState(true)
  const [reviewerFilter, setReviewerFilter] = useState(null)
  const [activityScope, setActivityScope] = useState('all')
  const [loading, setLoading] = useState(true)

  // Pagination for the "Validated by" side panel so it never grows unbounded.
  const [validatorPage, setValidatorPage] = useState(1)
  const [validatorPageSize, setValidatorPageSize] = useState(5)

  // Single source of truth for filter changes. Prevents the 12+ places where
  // the same 4 setState calls were being repeated from drifting apart.
  const applyFilter = (nextStatus, nextScope = 'all', nextReviewer = null) => {
    setStatus(nextStatus)
    setActivityScope(nextScope)
    setReviewerFilter(nextReviewer)
    setPage(1)
  }

  // Reset the validator page whenever the underlying filter changes.
  useEffect(() => {
    setValidatorPage(1)
  }, [reviewerFilter, status, activityScope])

  useEffect(() => {
    let active = true
    const loadData = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          status,
          activity_scope: activityScope,
          page: String(page),
          page_size: String(pageSize),
        })
        if (reviewerFilter) params.set('reviewer', reviewerFilter)

        // Fetch activity page + aggregate stats + per-member breakdown in parallel.
        const [activityRes, statsRes, detailedRes] = await Promise.all([
          fetch(`${apiUrl}/council-activity?${params}`),
          fetch(`${apiUrl}/council-member-stats`),
          fetch(`${apiUrl}/council-member-stats/detailed`),
        ])
        const [activityResult, statsResult, detailedResult] = await Promise.all([
          activityRes.json(),
          statsRes.json(),
          detailedRes.json(),
        ])

        if (!activityRes.ok)
          throw new Error(activityResult.detail || 'Unable to load Council activity')
        if (!statsRes.ok) throw new Error(statsResult.detail || 'Unable to load stats')
        if (!detailedRes.ok)
          throw new Error(detailedResult.detail || 'Unable to load member stats')

        if (active) {
          setActivityData(activityResult)
          // The backend now provides the full per-member aggregation from the
          // complete audit trail, not just the current page of recent_reviews.
          setMemberStats({
            ...statsResult,
            council_members: detailedResult.council_members || [],
          })
        }
      } catch (error) {
        if (active) notify(error.message || 'Unable to load Council member dashboard')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadData()
    return () => {
      active = false
    }
  }, [activityScope, notify, page, pageSize, status, reviewerFilter])

  // Only block the first render. Subsequent refetches dim the table instead of
  // unmounting the whole page (hero, KPIs, and tabs stay in place).
  const validators = activityData?.validators || []
  const pagedValidators = useMemo(
    () =>
      validators.slice(
        (validatorPage - 1) * validatorPageSize,
        validatorPage * validatorPageSize,
      ),
    [validators, validatorPage, validatorPageSize],
  )

  if (loading && !activityData) {
    return <p className="user-empty">Loading Council member dashboard...</p>
  }

  return (
    <section className="council-activity-page">
      <header className="council-activity-hero">
        <div>
          <small>HR REFERENCE</small>
          <h2>Council Member Dashboard</h2>
          <p>Track council member approval activity and validation responsibility.</p>
        </div>
        <i className="bi bi-shield-check" aria-hidden="true" />
      </header>

      <div className="council-kpis">
        <button
          type="button"
          className="pending clickable council-kpi-button"
          onClick={() => applyFilter('pending')}
          title="Show pending reviews"
          aria-label="Show pending approvals"
        >
          <small>Pending approvals</small>
          <b>{activityData?.pending_count || 0}</b>
          <span>Certificates awaiting Council review</span>
        </button>
        <button
          type="button"
          className="clickable council-kpi-button"
          onClick={() => applyFilter('approved')}
          title="Show approved"
          aria-label="Show approved certificates"
        >
          <small>Certificates validated</small>
          <b>{activityData?.validated_count || 0}</b>
          <span>Completed Council decisions</span>
        </button>
        <button
          type="button"
          className="clickable council-kpi-button"
          onClick={() => applyFilter('rejected')}
          title="Show rejected"
          aria-label="Show rejected certificates"
        >
          <small>Certificates revoked</small>
          <b>{activityData?.revoked_count || 0}</b>
          <span>Rejected after review</span>
        </button>
        <button
          type="button"
          className="clickable council-kpi-button"
          onClick={() => applyFilter('approved', 'hr')}
          title="Show approved HR activities"
          aria-label="Show approved HR activities"
        >
          <small>HR activities approved</small>
          <b>{memberStats.hr_activity_approvals || 0}</b>
          <span>User/Category/OEM requests approved</span>
        </button>
        <button
          type="button"
          className={`council-members-toggle ${showCouncilMembers ? 'active' : ''}`}
          onClick={() => setShowCouncilMembers(!showCouncilMembers)}
          aria-expanded={showCouncilMembers}
          aria-controls="council-members-panel"
        >
          <i className="bi bi-people" />
          <span>Council Members</span>
          <i className={`bi ${showCouncilMembers ? 'bi-chevron-up' : 'bi-chevron-down'}`} />
        </button>
      </div>

      {showCouncilMembers && (
        <section
          id="council-members-panel"
          className="er-card council-members-panel"
          aria-labelledby="council-members-heading"
        >
          <header>
            <h3 id="council-members-heading">Council Member Stats</h3>
            <p>Validation activity by council member</p>
            {reviewerFilter && (
              <button
                type="button"
                className="clear-filter-btn"
                onClick={() => {
                  applyFilter('overall')
                  setShowCouncilMembers(false)
                }}
                aria-label="Clear reviewer filter"
              >
                <i className="bi bi-x" /> Clear filter: {reviewerFilter}
              </button>
            )}
          </header>
          {memberStats.council_members?.length ? (
            <div className="council-table-wrap">
              <table className="council-table">
                <thead>
                  <tr>
                    <th>Council Member</th>
                    <th>Approvals</th>
                    <th>Rejections</th>
                    <th>Total Reviews</th>
                  </tr>
                </thead>
                <tbody>
                  {memberStats.council_members.map((member) => (
                    <tr
                      key={member.name}
                      className="clickable"
                      onClick={() => {
                        applyFilter('overall', 'all', member.name)
                        setShowCouncilMembers(false)
                      }}
                      title={`Filter by ${member.name}`}
                    >
                      <td>
                        <span className="council-initials">
                          {member.name
                            .split(/\s+/)
                            .map((part) => part[0])
                            .join('')
                            .slice(0, 2)}
                        </span>
                        {member.name}
                      </td>
                      <td>{member.approvals || 0}</td>
                      <td>{member.rejections || 0}</td>
                      <td>{member.total_reviews || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="user-empty">No council member stats available.</p>
          )}
        </section>
      )}

      <div className="council-grid">
        <section className="er-card">
          <header>
            <div>
              <h3>Validated by</h3>
              <p>Completed certificate decisions by reviewer.</p>
            </div>
          </header>
          {validators.length ? (
            <>
              <div className="council-table-wrap">
                <table className="council-table">
                  <thead>
                    <tr>
                      <th>Reviewer</th>
                      <th>Validated</th>
                      <th>Rejected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedValidators.map((validator) => (
                      <tr key={validator.id}>
                        <td>
                          <span className="council-initials">
                            {validator.name
                              .split(/\s+/)
                              .map((part) => part[0])
                              .join('')
                              .slice(0, 2)}
                          </span>
                          {validator.name}
                        </td>
                        <td>{validator.validated_count}</td>
                        <td>{validator.rejected_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={validatorPage}
                totalItems={validators.length}
                pageSize={validatorPageSize}
                onPageChange={setValidatorPage}
                onPageSizeChange={(size) => {
                  setValidatorPageSize(size)
                  setValidatorPage(1)
                }}
                label="reviewers"
              />
            </>
          ) : (
            <p className="user-empty">No Council validations have been recorded yet.</p>
          )}
        </section>

        <section className="er-card">
          <header>
            <div>
              <h3>{activityScope === 'hr' ? 'Approved HR activities' : 'Review decisions'}</h3>
              <p>
                {activityScope === 'hr'
                  ? 'Approved user, category, and OEM requests. Newest first.'
                  : 'Newest first.'}
              </p>
            </div>
            <div className="council-filters" role="group" aria-label="Review status">
              <button
                type="button"
                className={status === 'overall' ? 'active' : ''}
                onClick={() => applyFilter('overall')}
              >
                Overall
              </button>
              <button
                type="button"
                className={status === 'pending' ? 'active' : ''}
                onClick={() => applyFilter('pending')}
              >
                Pending
              </button>
              <button
                type="button"
                className={status === 'approved' ? 'active' : ''}
                onClick={() => applyFilter('approved')}
              >
                Approved
              </button>
              <button
                type="button"
                className={status === 'rejected' ? 'active' : ''}
                onClick={() => applyFilter('rejected')}
              >
                Rejected
              </button>
            </div>
            {reviewerFilter && (
              <div className="active-filter-tag">
                <span>
                  Filtered by: <strong>{reviewerFilter}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => applyFilter('overall')}
                  aria-label="Clear filter"
                >
                  <i className="bi bi-x" />
                </button>
              </div>
            )}
          </header>
          {activityData?.recent_reviews?.length ? (
            <>
              <div className="council-table-wrap" aria-busy={loading}>
                <table className="council-table decisions">
                  <thead>
                    <tr>
                      <th>{activityScope === 'hr' ? 'HR activity' : 'Certificate'}</th>
                      <th>{activityScope === 'hr' ? 'Requested for' : 'Employee'}</th>
                      <th>Validated by</th>
                      <th>Decision</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityData.recent_reviews.map((review) => {
                      const isHR = review.is_hr_activity
                      const activityName = review.activity_type
                        ?.replace(/_/g, ' ')
                        .replace(/\b\w/g, (letter) => letter.toUpperCase())
                      return (
                        <tr key={review.id}>
                          <td>{isHR ? activityName || 'HR activity' : review.course_name}</td>
                          <td>{review.recipient_name}</td>
                          <td>{review.reviewed_by}</td>
                          <td>
                            <span className={`council-status ${review.status}`}>
                              {['issued', 'approved'].includes(review.status)
                                ? 'Approved'
                                : 'Rejected'}
                            </span>
                          </td>
                          <td>{displayDate(review.reviewed_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                totalItems={Number(activityData?.review_total) || 0}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                label="decisions"
              />
            </>
          ) : (
            <p className="user-empty">
              {activityScope === 'hr'
                ? 'No approved HR activities yet.'
                : `No ${status === 'overall' ? 'completed' : status} decisions yet.`}
            </p>
          )}
        </section>
      </div>
    </section>
  )
}