import { useEffect, useState } from 'react'
import apiUrl from '../api'
import Pagination from '../components/Pagination'

const displayDate = (value) => {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function CouncilActivityPage({ notify }) {
  const [data, setData] = useState(null)
  const [stats, setStats] = useState({})
  const [status, setStatus] = useState('overall')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [reviewerFilter, setReviewerFilter] = useState(null)
  const [activityScope, setActivityScope] = useState('all')

  useEffect(() => {
    let active = true
    const loadData = async () => {
      try {
        const params = new URLSearchParams({
          status,
          activity_scope: activityScope,
          page: String(page),
          page_size: String(pageSize),
        })
        if (reviewerFilter) params.set('reviewer', reviewerFilter)
        const [activityRes, statsRes] = await Promise.all([
          fetch(`${apiUrl}/council-activity?${params}`),
          fetch(`${apiUrl}/council-member-stats`),
        ])
        const [activityResult, statsResult] = await Promise.all([
          activityRes.json(),
          statsRes.json(),
        ])
        if (!activityRes.ok)
          throw new Error(activityResult.detail || 'Unable to load Council activity')
        if (!statsRes.ok) throw new Error(statsResult.detail || 'Unable to load stats')
        if (active) {
          setData(activityResult)
          setStats(statsResult)
        }
      } catch (error) {
        active && notify(error.message || 'Unable to load Council activity')
      }
    }
    loadData()
    return () => {
      active = false
    }
  }, [activityScope, notify, page, pageSize, status, reviewerFilter])

  if (!data) return <p className="user-empty">Loading Council activity...</p>

  return (
    <section className="council-activity-page">
      <header className="council-activity-hero">
        <div>
          <small>ADMIN WORKSPACE</small>
          <h2>Council activity</h2>
          <p>Review approval workload and see validation decisions in one focused view.</p>
        </div>
        <div className="council-hero-actions">
          <i className="bi bi-shield-check" aria-hidden="true" />
        </div>
      </header>
      <div className="council-kpis">
        <article
          className="pending clickable"
          onClick={() => {
            setStatus('pending')
            setActivityScope('all')
            setReviewerFilter(null)
            setPage(1)
          }}
          title="Show pending reviews"
        >
          <small>Pending approvals</small>
          <b>{data.pending_count}</b>
          <span>Certificates awaiting Council review</span>
        </article>
        <article
          className="clickable"
          onClick={() => {
            setStatus('approved')
            setActivityScope('all')
            setReviewerFilter(null)
            setPage(1)
          }}
          title="Show approved"
        >
          <small>Certificates validated</small>
          <b>{data.validated_count}</b>
          <span>Completed Council decisions</span>
        </article>
        <article
          className="clickable"
          onClick={() => {
            setStatus('rejected')
            setActivityScope('all')
            setReviewerFilter(null)
            setPage(1)
          }}
          title="Show rejected"
        >
          <small>Certificates revoked</small>
          <b>{data.revoked_count}</b>
          <span>Rejected after review</span>
        </article>
        <article
          className="clickable"
          onClick={() => {
            setStatus('approved')
            setActivityScope('hr')
            setReviewerFilter(null)
            setPage(1)
          }}
          title="Show approved HR activities"
        >
          <small>HR activities approved</small>
          <b>{stats.hr_activity_approvals || 0}</b>
          <span>User/Category/OEM requests approved</span>
        </article>
      </div>
      <div className="council-grid">
        <section className="er-card">
          <header>
            <div>
              <h3>Validated by</h3>
              <p>Completed certificate decisions by reviewer.</p>
            </div>
          </header>
          {data.validators.length ? (
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
                  {data.validators.map((validator) => (
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
          ) : (
            <p className="user-empty">No Council validations have been recorded yet.</p>
          )}
        </section>
        <section className="er-card">
          <header>
            <div>
              <h3>
                {status === 'pending'
                  ? 'Pending reviews'
                  : activityScope === 'hr'
                    ? 'Approved HR activities'
                    : 'Review decisions'}
              </h3>
              <p>
                {status === 'pending'
                  ? 'Certificates and HR activities awaiting Council review.'
                  : activityScope === 'hr'
                    ? 'Approved user, category, and OEM requests. Newest first.'
                    : 'Newest first.'}
              </p>
            </div>
            <div className="council-filters" role="group" aria-label="Review status">
              <button
                className={status === 'overall' ? 'active' : ''}
                onClick={() => {
                  setStatus('overall')
                  setActivityScope('all')
                  setReviewerFilter(null)
                  setPage(1)
                }}
              >
                Overall
              </button>
              <button
                className={status === 'pending' ? 'active' : ''}
                onClick={() => {
                  setStatus('pending')
                  setActivityScope('all')
                  setReviewerFilter(null)
                  setPage(1)
                }}
              >
                Pending
              </button>
              <button
                className={status === 'approved' ? 'active' : ''}
                onClick={() => {
                  setStatus('approved')
                  setActivityScope('all')
                  setReviewerFilter(null)
                  setPage(1)
                }}
              >
                Approved
              </button>
              <button
                className={status === 'rejected' ? 'active' : ''}
                onClick={() => {
                  setStatus('rejected')
                  setActivityScope('all')
                  setReviewerFilter(null)
                  setPage(1)
                }}
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
                  onClick={() => {
                    setReviewerFilter(null)
                    setStatus('overall')
                    setActivityScope('all')
                    setPage(1)
                  }}
                  aria-label="Clear filter"
                >
                  <i className="bi bi-x" />
                </button>
              </div>
            )}
          </header>
          {data.recent_reviews.length ? (
            <>
              <div className="council-table-wrap">
                <table className="council-table decisions">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Employee</th>
                      <th>Type</th>
                      {status === 'pending' ? (
                        <>
                          <th>Submitted</th>
                          <th>Status</th>
                          <th>Date</th>
                        </>
                      ) : (
                        <>
                          <th>Validated by</th>
                          <th>Decision</th>
                          <th>Date</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_reviews.map((review) => {
                      const isHR = review.is_hr_activity
                      const itemName = isHR
                        ? review.activity_type
                            ?.replace(/_/g, ' ')
                            .replace(/\b\w/g, (l) => l.toUpperCase())
                        : review.course_name
                      const itemType = isHR ? 'HR Activity' : 'Certificate'
                      return (
                        <tr key={review.id}>
                          <td>{itemName}</td>
                          <td>{review.recipient_name}</td>
                          <td>
                            <span className={`council-badge ${isHR ? 'hr' : 'cert'}`}>
                              {itemType}
                            </span>
                          </td>
                          {status === 'pending' ? (
                            <>
                              <td>{review.submitted_by || 'User'}</td>
                              <td>
                                <span className={`council-status ${review.status}`}>Pending</span>
                              </td>
                              <td>{displayDate(review.created_at)}</td>
                            </>
                          ) : (
                            <>
                              <td>{review.reviewed_by || 'Not recorded'}</td>
                              <td>
                                <span className={`council-status ${review.status}`}>
                                  {review.status === 'issued' || review.status === 'approved'
                                    ? 'Approved'
                                    : 'Rejected'}
                                </span>
                              </td>
                              <td>{displayDate(review.reviewed_at)}</td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                totalItems={Number(data.review_total) || 0}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                label={status === 'pending' ? 'reviews' : 'decisions'}
              />
            </>
          ) : (
            <p className="user-empty">
              {status === 'pending'
                ? 'No pending certificates or HR activities at this time.'
                : activityScope === 'hr'
                  ? 'No approved HR activities yet.'
                  : `No ${status === 'overall' ? 'completed' : status} decisions yet.`}
            </p>
          )}
        </section>
      </div>
    </section>
  )
}
