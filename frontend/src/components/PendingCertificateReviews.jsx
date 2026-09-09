import { useEffect, useState } from 'react'
import { closeAlert, confirmCertificateReview, showProcessingAlert, showResultAlert } from '../dialogs'
const apiUrl = process.env.REACT_APP_API_URL
import Pagination from './Pagination'
import VerificationFileButton from './VerificationFileButton'
import { categoryBadgeStyle } from '../utils/categoryPalette'
 
const formatDate = (value) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : ' - '
 
 
 
export default function PendingCertificateReviews({ user, notify, runWithLoader, onTotalChange, query = '', realtimeVersion }) {
  const [certificates, setCertificates] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [selectedCertificate, setSelectedCertificate] = useState(null)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const visibleCertificates = certificates.filter((certificate) => !query.trim() || [certificate.recipient_name,
    certificate.email, certificate.course_name, certificate.vendor_name, certificate.category,
    certificate.certificate_number, certificate.issued_date].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
 
  const loadPending = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${apiUrl}/certificates?status=pending&page=${page}&page_size=${pageSize}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to load under-review certificates')
      setCertificates(result.items || [])
      setTotal(result.total || 0)
      onTotalChange?.(result.total || 0)
    } catch (error) {
      notify(error.message || 'Unable to load under-review certificates')
    } finally {
      setLoading(false)
    }
  }
 
  useEffect(() => {
    loadPending()
  }, [page, pageSize, realtimeVersion])
 
  const review = async (certificate, approve) => {
    const reviewResult = await confirmCertificateReview({ name: certificate.course_name, approve })
    if (!reviewResult) return
    showProcessingAlert(approve ? 'Approving certificate' : 'Rejecting certificate')
    try {
      const response = await runWithLoader(approve ? 'Approving certificate' : 'Rejecting certificate', () =>
        fetch(`${apiUrl}/certificates/${certificate.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: approve ? 'issued' : 'revoked',
            reviewed_by: `${user.firstName} ${user.lastName}`.trim() || 'Administrator',
            remarks: approve ? '' : reviewResult,
          }),
        }),
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to review certificate')
      await loadPending()
      closeAlert()
      await showResultAlert({
        title: approve ? 'Certificate validated successfully' : 'Certificate revoked successfully',
        message: approve
          ? `${certificate.course_name} is now active for ${certificate.recipient_name}.`
          : `${certificate.course_name} was removed from review requests and marked as revoked for ${certificate.recipient_name}.`,
        success: true,
      })
      setSelectedCertificate(null)
    } catch (error) {
      closeAlert()
      await showResultAlert({
        title: 'Certificate review failed',
        message: error.message || 'Unable to review certificate',
        success: false,
      })
    }
  }
 
  const stopRowClick = (event) => event.stopPropagation()
 
  const openDetails = async (certificate) => {
    setSelectedCertificate(certificate)
    setSelectedEmployee(null)
    setProfileLoading(true)
    try {
      const params = new URLSearchParams({
        search: certificate.email || certificate.recipient_name || '',
        page: '1',
        page_size: '10',
      })
      const listResponse = await fetch(`${apiUrl}/employees?${params}`)
      const listResult = await listResponse.json()
      if (!listResponse.ok) throw new Error(listResult.detail || 'Unable to load employee information')
      const matchedEmployee = (listResult.items || []).find(
        (employee) => String(employee.email || '').toLowerCase() === String(certificate.email || '').toLowerCase(),
      )
      if (!matchedEmployee) return
      const profileResponse = await fetch(`${apiUrl}/employees/${matchedEmployee.id}`)
      const profileResult = await profileResponse.json()
      if (!profileResponse.ok) throw new Error(profileResult.detail || 'Unable to load employee profile')
      setSelectedEmployee(profileResult)
    } catch {
      // Certificate details remain available if an employee profile cannot be matched.
    } finally {
      setProfileLoading(false)
    }
  }
 
  return (
    <>
    <section className="er-card pending-certificate-reviews">
      <header>
        <div>
          <h3>Certificate approval requests</h3>
          <p>Review user-submitted certificates before they become active.</p>
        </div>
        <span>{total} under review</span>
      </header>
      {loading ? (
        <p className="user-empty">Loading certificate requests...</p>
      ) : !visibleCertificates.length ? (
        <p className="user-empty">No certificates are waiting for approval.</p>
      ) : (
        <div className="card-table-scroll">
        <table className="er-table pending-certificate-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Certificate</th>
              <th>Certificate no.</th>
              <th>Completed</th>
              <th>Evidence</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleCertificates.map((certificate) => (
              <tr
                key={certificate.id}
                className="approval-request-row"
                tabIndex="0"
                role="button"
                aria-label={`View ${certificate.course_name} submitted by ${certificate.recipient_name}`}
                onClick={() => openDetails(certificate)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openDetails(certificate)
                  }
                }}
              >
                <td><b>{certificate.recipient_name}</b><small>{certificate.email}</small></td>
                <td><b>{certificate.course_name}</b><small>{certificate.vendor_name} · <span className="category-badge" style={categoryBadgeStyle(certificate.category)}>{certificate.category || 'Other'}</span></small></td>
                <td><code>{certificate.certificate_number}</code></td>
                <td className="certificate-completed-date">{formatDate(certificate.issued_date)}</td>
                <td onClick={stopRowClick}><VerificationFileButton certificateId={certificate.id} hasFile={Boolean(certificate.verification_image_path)} notify={notify} runWithLoader={runWithLoader} /></td>
                <td className="certificate-review-actions" onClick={stopRowClick}>
                  <button type="button" className="approve" onClick={() => review(certificate, true)}>Approve</button>
                  <button type="button" className="reject" onClick={() => review(certificate, false)}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <div className="card-pagination">
        <Pagination
          page={page}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          label="approval requests"
        />
      </div>
    </section>
    {selectedCertificate && (
      <div className="approval-details-overlay" role="presentation" onMouseDown={() => setSelectedCertificate(null)}>
        <article
          className="approval-details-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="approval-details-title"
          onMouseDown={stopRowClick}
        >
          <header>
            <div className="approval-details-person">
              <span>{selectedCertificate.recipient_name?.split(/\s+/).map((name) => name[0]).slice(0, 2).join('').toUpperCase() || 'EM'}</span>
              <div>
                <small>CERTIFICATE APPROVAL REQUEST</small>
                <h2 id="approval-details-title">{selectedCertificate.course_name}</h2>
                <p>{selectedCertificate.recipient_name} · {selectedCertificate.email}</p>
              </div>
            </div>
            <button type="button" className="approval-details-close" onClick={() => setSelectedCertificate(null)} aria-label="Close details">
              <i className="bi bi-x-lg" />
            </button>
          </header>
 
          <div className="approval-details-grid">
            <div><i className="bi bi-building" /><span><small>OEM</small><b>{selectedCertificate.vendor_name || 'Not provided'}</b></span></div>
            <div><i className="bi bi-grid" /><span><small>Category</small><b>{selectedCertificate.category || 'Not provided'}</b></span></div>
            <div><i className="bi bi-patch-check" /><span><small>Certificate number</small><b>{selectedCertificate.certificate_number || 'Not provided'}</b></span></div>
            <div><i className="bi bi-calendar-check" /><span><small>Completion date</small><b>{formatDate(selectedCertificate.issued_date)}</b></span></div>
            <div><i className="bi bi-clock-history" /><span><small>Validity</small><b>{selectedCertificate.expires_on ? `Expires on ${formatDate(selectedCertificate.expires_on)}` : selectedCertificate.validity_years ? `${selectedCertificate.validity_years} ${Number(selectedCertificate.validity_years) === 1 ? 'year' : 'years'}` : 'Lifetime'}</b></span></div>
            <div><i className="bi bi-award" /><span><small>Total RU points</small><b>{selectedCertificate.total_ru_points ?? 0}</b></span></div>
          </div>
 
 
          <section className="approval-employee-profile" aria-label="Employee information">
            <div className="approval-profile-heading">
              <div>
                <small>EMPLOYEE INFORMATION</small>
                <h3>Work profile</h3>
              </div>
              {profileLoading && <span>Loading profile...</span>}
            </div>
            <div className="approval-profile-grid">
              <div><i className="bi bi-person-vcard" /><span><small>Employee ID</small><b>{selectedEmployee?.employeeId || 'Not available'}</b></span></div>
              <div><i className="bi bi-briefcase" /><span><small>Role</small><b>{selectedEmployee ? (selectedEmployee.role === 'admin' ? 'Administrator' : 'User') : 'Not available'}</b></span></div>
              <div><i className="bi bi-diagram-3" /><span><small>Department</small><b>{selectedEmployee?.department || 'Not available'}</b></span></div>
              <div><i className="bi bi-geo-alt" /><span><small>Location</small><b>{selectedEmployee?.location || 'Not available'}</b></span></div>
              <div><i className="bi bi-person-check" /><span><small>Reporting manager</small><b>{selectedEmployee?.reportingManager || 'Not available'}</b></span></div>
            </div>
          </section>
 
          <div className="approval-details-evidence">
            <div>
              <i className="bi bi-file-earmark-check" />
              <span><b>Verification evidence</b><small>{selectedCertificate.verification_image_path ? 'Submitted file is ready to review' : 'No file was submitted'}</small></span>
            </div>
            <VerificationFileButton certificateId={selectedCertificate.id} hasFile={Boolean(selectedCertificate.verification_image_path)} notify={notify} runWithLoader={runWithLoader} />
          </div>
 
          <footer>
            <button type="button" className="reject" onClick={() => review(selectedCertificate, false)}>Reject</button>
            <button type="button" className="approve" onClick={() => review(selectedCertificate, true)}>Approve certificate</button>
          </footer>
        </article>
      </div>
    )}
    </>
  )
}
 
 
