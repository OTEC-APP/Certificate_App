
import { useEffect, useState } from 'react'
import {
  closeAlert,
  confirmCertificateReview,
  showProcessingAlert,
  showResultAlert,
} from '../dialogs'
const apiUrl = process.env.REACT_APP_API_URL
import Pagination from './Pagination'
import VerificationFileButton from './VerificationFileButton'
import CompactSelect from './CompactSelect'
import DatePicker from './DatePicker'
import { categoryBadgeStyle } from '../utils/categoryPalette'

const formatDate = (value) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : ' - '

const toDisplayDate = (value) => {
  const match = String(value || '')
    .slice(0, 10)
    .match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[2]}/${match[3]}/${match[1]}` : ''
}

const toIsoDate = (value) => {
  const match = String(value || '')
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return ''
  const [, month, day, year] = match
  const candidate = `${year}-${month}-${day}`
  const parsed = new Date(`${candidate}T00:00:00`)
  return !Number.isNaN(parsed.getTime()) &&
    parsed.getFullYear() === Number(year) &&
    parsed.getMonth() + 1 === Number(month) &&
    parsed.getDate() === Number(day)
    ? candidate
    : ''
}

export default function PendingCertificateReviews({
  user,
  notify,
  runWithLoader,
  onTotalChange,
  query = '',
  realtimeVersion,
}) {
  const [certificates, setCertificates] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [selectedCertificate, setSelectedCertificate] = useState(null)
  // const [editedCertificateName, setEditedCertificateName] = useState('')
  // const [savingCertificateName, setSavingCertificateName] = useState(false)
  const [draft, setDraft] = useState({
    course_name: '',
    vendor_name: '',
    category: '',
    certificate_number: '',
    issued_date: '',
    validity_mode: 'lifetime',
    expires_on: '',
    total_ru_points: '',
  })
  const [savingDetails, setSavingDetails] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [oems, setOems] = useState([])
  const [loadingOems, setLoadingOems] = useState(true)
  const [categories, setCategories] = useState([])
  const [loadingCategories, setLoadingCategories] = useState(true)
  const visibleCertificates = certificates.filter(
    (certificate) =>
      !query.trim() ||
      [
        certificate.recipient_name,
        certificate.email,
        certificate.course_name,
        certificate.vendor_name,
        certificate.category,
        certificate.certificate_number,
        certificate.issued_date,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  )

  const loadPending = async () => {
    setLoading(true)
    try {
      const response = await fetch(
        `${apiUrl}/certificates?status=pending&page=${page}&page_size=${pageSize}`,
      )
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

  useEffect(() => {
    let active = true
    fetch(`${apiUrl}/access-options/oems`)
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to load OEM directory')
        return result
      })
      .then((result) => {
        if (!active) return
        const byName = new Map()
        ;(Array.isArray(result) ? result : []).forEach((oem) => {
          const name = String(oem.name || '').trim()
          if (name && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), name)
        })
        setOems([...byName.values()].sort((left, right) => left.localeCompare(right)))
      })
      .catch(() => {
        if (active) setOems([])
      })
      .finally(() => {
        if (active) setLoadingOems(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetch(`${apiUrl}/access-options/categories`)
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to load categories')
        return result
      })
      .then((result) => {
        if (!active) return
        const names = new Map()
        ;(Array.isArray(result) ? result : []).forEach((category) => {
          const name = String(category.name || '').trim()
          if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name)
        })
        setCategories([...names.values()].sort((left, right) => left.localeCompare(right)))
      })
      .catch(() => {
        if (active) setCategories([])
      })
      .finally(() => {
        if (active) setLoadingCategories(false)
      })
    return () => {
      active = false
    }
  }, [])

  const saveDraft = async (certificate, currentDraft = draft) => {
    const courseName = String(currentDraft.course_name || '').trim()
    if (courseName.length < 2) {
      notify('Certificate name must contain at least 2 characters')
      return null
    }
    const issuedIso = toIsoDate(currentDraft.issued_date)
    if (!issuedIso) {
      notify('Enter a valid completion date in MM/DD/YYYY format')
      return null
    }
    const expiresIso =
      currentDraft.validity_mode === 'expires' ? toIsoDate(currentDraft.expires_on) : ''
    if (currentDraft.validity_mode === 'expires' && !expiresIso) {
      notify('Enter a valid expiry date in MM/DD/YYYY format')
      return null
    }

    const payload = {
      course_name: courseName,
      vendor_name: String(currentDraft.vendor_name || '').trim(),
      category: String(currentDraft.category || '').trim(),
      certificate_number: String(currentDraft.certificate_number || '').trim(),
      issued_date: issuedIso,
      total_ru_points:
        currentDraft.total_ru_points === '' ? null : Number(currentDraft.total_ru_points),
      validity_years: null,
      expires_on: currentDraft.validity_mode === 'expires' ? expiresIso : null,
    }

    setSavingDetails(true)
    try {
      const response = await runWithLoader('Saving certificate details', () =>
        fetch(`${apiUrl}/certificates/${certificate.id}/approval-details`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to update certificate details')
      const updated = { ...certificate, ...result }
      setCertificates((items) => items.map((item) => (item.id === certificate.id ? updated : item)))
      setSelectedCertificate((item) => (item?.id === certificate.id ? updated : item))
      setDraft({
        course_name: updated.course_name || '',
        vendor_name: updated.vendor_name || '',
        category: updated.category || '',
        certificate_number: updated.certificate_number || '',
        issued_date: toDisplayDate(updated.issued_date),
        validity_mode: updated.expires_on ? 'expires' : 'lifetime',
        expires_on: toDisplayDate(updated.expires_on || ''),
        total_ru_points: updated.total_ru_points ?? '',
      })
      notify('Certificate details updated')
      return updated
    } catch (error) {
      notify(error.message || 'Unable to update certificate details')
      return null
    } finally {
      setSavingDetails(false)
    }
  }

  const review = async (certificate, approve) => {
    const isSelected = selectedCertificate?.id === certificate.id
    const currentDraft = isSelected
      ? draft
      : {
          course_name: certificate.course_name || '',
          vendor_name: certificate.vendor_name || '',
          category: certificate.category || '',
          certificate_number: certificate.certificate_number || '',
          issued_date: toDisplayDate(certificate.issued_date),
          validity_mode: certificate.expires_on ? 'expires' : 'lifetime',
          expires_on: toDisplayDate(certificate.expires_on || ''),
          total_ru_points: certificate.total_ru_points ?? '',
        }
    const requestedName = String(currentDraft.course_name || '').trim()
    if (requestedName.length < 2)
      return notify('Certificate name must contain at least 2 characters')
    const reviewResult = await confirmCertificateReview({ name: requestedName, approve })
    if (!reviewResult) return
    showProcessingAlert(approve ? 'Approving certificate' : 'Rejecting certificate')
    try {
      const reviewedCertificate = await saveDraft(certificate, currentDraft)
      if (!reviewedCertificate) throw new Error('Certificate details were not updated')
      const response = await runWithLoader(
        approve ? 'Approving certificate' : 'Rejecting certificate',
        () =>
          fetch(`${apiUrl}/certificates/${reviewedCertificate.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: approve ? 'issued' : 'revoked',
              reviewed_by: `${user.firstName} ${user.lastName}`.trim() || 'Administrator',
              reviewed_by_id: user.employeeId || user.id || '',
              reviewer_role: user.role,
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
          ? `${reviewedCertificate.course_name} is now active for ${reviewedCertificate.recipient_name}.`
          : `${reviewedCertificate.course_name} was removed from review requests and marked as revoked for ${reviewedCertificate.recipient_name}.`,
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
    setDraft({
      course_name: certificate.course_name || '',
      vendor_name: certificate.vendor_name || '',
      category: certificate.category || '',
      certificate_number: certificate.certificate_number || '',
      issued_date: toDisplayDate(certificate.issued_date),
      validity_mode: certificate.expires_on ? 'expires' : 'lifetime',
      expires_on: toDisplayDate(certificate.expires_on || ''),
      total_ru_points: certificate.total_ru_points ?? '',
    })
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
      if (!listResponse.ok)
        throw new Error(listResult.detail || 'Unable to load employee information')
      const matchedEmployee = (listResult.items || []).find(
        (employee) =>
          String(employee.email || '').toLowerCase() ===
          String(certificate.email || '').toLowerCase(),
      )
      if (!matchedEmployee) return
      const profileResponse = await fetch(`${apiUrl}/employees/${matchedEmployee.id}`)
      const profileResult = await profileResponse.json()
      if (!profileResponse.ok)
        throw new Error(profileResult.detail || 'Unable to load employee profile')
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
                    <td>
                      <b>{certificate.recipient_name}</b>
                      <small>{certificate.email}</small>
                    </td>
                    <td>
                      <b>{certificate.course_name}</b>
                      <small>
                        {certificate.vendor_name} ·{' '}
                        <span
                          className="category-badge"
                          style={categoryBadgeStyle(certificate.category)}
                        >
                          {certificate.category || 'Other'}
                        </span>
                      </small>
                    </td>
                    <td>
                      <code>{certificate.certificate_number}</code>
                    </td>
                    <td className="certificate-completed-date">
                      {formatDate(certificate.issued_date)}
                    </td>
                    <td onClick={stopRowClick}>
                      <VerificationFileButton
                        certificateId={certificate.id}
                        hasFile={Boolean(certificate.verification_image_path)}
                        notify={notify}
                        runWithLoader={runWithLoader}
                      />
                    </td>
                    <td className="certificate-review-actions" onClick={stopRowClick}>
                      <button
                        type="button"
                        className="approve"
                        onClick={() => review(certificate, true)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="reject"
                        onClick={() => review(certificate, false)}
                      >
                        Reject
                      </button>
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
        <div
          className="approval-details-overlay"
          role="presentation"
          onMouseDown={() => setSelectedCertificate(null)}
        >
          <article
            className="approval-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="approval-details-title"
            onMouseDown={stopRowClick}
          >
            <header>
              <div className="approval-details-person">
                <span>
                  {selectedCertificate.recipient_name
                    ?.split(/\s+/)
                    .map((name) => name[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase() || 'EM'}
                </span>
                <div>
                  <small>CERTIFICATE APPROVAL REQUEST</small>
                  <h2 id="approval-details-title">{selectedCertificate.course_name}</h2>
                  <p>
                    {selectedCertificate.recipient_name} · {selectedCertificate.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="approval-details-close"
                onClick={() => setSelectedCertificate(null)}
                aria-label="Close details"
              >
                <i className="bi bi-x-lg" />
              </button>
            </header>

            <section className="approval-editable-grid" aria-label="Editable certificate details">
              <label>
                <small>OEM</small>
                <CompactSelect
                  value={draft.vendor_name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, vendor_name: event.target.value }))
                  }
                  disabled={loadingOems}
                >
                  <option value="" disabled>
                    {loadingOems
                      ? 'Loading OEMs...'
                      : oems.length
                        ? 'Choose OEM'
                        : 'No OEMs configured'}
                  </option>
                  {draft.vendor_name && !oems.includes(draft.vendor_name) && (
                    <option value={draft.vendor_name}>{draft.vendor_name}</option>
                  )}
                  {oems.map((oem) => (
                    <option key={oem} value={oem} title={oem}>
                      {oem}
                    </option>
                  ))}
                </CompactSelect>
              </label>
              <label>
                <small>Category</small>
                <CompactSelect
                  value={draft.category}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, category: event.target.value }))
                  }
                  disabled={loadingCategories}
                >
                  <option value="" disabled>
                    {loadingCategories
                      ? 'Loading categories...'
                      : categories.length
                        ? 'Choose category'
                        : 'No categories configured'}
                  </option>
                  {draft.category && !categories.includes(draft.category) && (
                    <option value={draft.category}>{draft.category}</option>
                  )}
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </CompactSelect>
              </label>
              <label>
                <small>Certificate number</small>
                <input
                  value={draft.certificate_number}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, certificate_number: event.target.value }))
                  }
                  maxLength="100"
                />
              </label>
              <label>
                <small>Completion date</small>
                <DatePicker
                  name="issued_date"
                  value={toIsoDate(draft.issued_date)}
                  onChangeValue={(value) =>
                    setDraft((current) => ({ ...current, issued_date: toDisplayDate(value) }))
                  }
                  label="Completion date"
                />
              </label>
              <label>
                <small>Validity</small>
                <select
                  value={draft.validity_mode}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, validity_mode: event.target.value }))
                  }
                >
                  <option value="lifetime">Lifetime</option>
                  <option value="expires">Expires on</option>
                </select>
                {draft.validity_mode === 'expires' && (
                  <DatePicker
                    name="expires_on"
                    value={toIsoDate(draft.expires_on)}
                    onChangeValue={(value) =>
                      setDraft((current) => ({ ...current, expires_on: toDisplayDate(value) }))
                    }
                    label="Expiry date"
                  />
                )}
              </label>
              <label>
                <small>Total RU points</small>
                <input
                  type="number"
                  min="0"
                  max="9999"
                  step="0.1"
                  value={draft.total_ru_points}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, total_ru_points: event.target.value }))
                  }
                />
              </label>
              <div className="approval-certificate-name-slot">
                <section
                  className="approval-certificate-name-edit"
                  aria-label="Correct certificate name"
                >
                  <div>
                    <small>CERTIFICATE NAME</small>
                    <label htmlFor="approval-certificate-name">
                      Correct the name before approving if needed.
                    </label>
                  </div>
                  <input
                    id="approval-certificate-name"
                    value={draft.course_name}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, course_name: event.target.value }))
                    }
                    maxLength="160"
                  />
                  <button
                    type="button"
                    onClick={() => saveDraft(selectedCertificate)}
                    disabled={savingDetails}
                  >
                    {savingDetails ? 'Saving…' : 'Save details'}
                  </button>
                </section>
              </div>
            </section>

            {/* <section className="approval-certificate-name-edit" aria-label="Correct certificate name">
            <div>
              <small>CERTIFICATE NAME</small>
              <label htmlFor="approval-certificate-name">Correct the name before approving if needed.</label>
            </div>
            <input
              id="approval-certificate-name"
              value={editedCertificateName}
              onChange={(event) => setEditedCertificateName(event.target.value)}
              maxLength="160"
            />
            <button
              type="button"
              onClick={() => saveCertificateName(selectedCertificate)}
              disabled={savingCertificateName || editedCertificateName.trim() === selectedCertificate.course_name}
            >
              {savingCertificateName ? 'Saving…' : 'Save name'}
            </button>
          </section> */}

            <section className="approval-employee-profile" aria-label="Employee information">
              <div className="approval-profile-heading">
                <div>
                  <small>EMPLOYEE INFORMATION</small>
                  <h3>Work profile</h3>
                </div>
                {profileLoading && <span>Loading profile...</span>}
              </div>
              <div className="approval-profile-grid">
                <div>
                  <i className="bi bi-person-vcard" />
                  <span>
                    <small>Employee ID</small>
                    <b>{selectedEmployee?.employeeId || 'Not available'}</b>
                  </span>
                </div>
                <div>
                  <i className="bi bi-briefcase" />
                  <span>
                    <small>Role</small>
                    <b>
                      {selectedEmployee
                        ? selectedEmployee.role === 'admin'
                          ? 'Administrator'
                          : 'User'
                        : 'Not available'}
                    </b>
                  </span>
                </div>
                <div>
                  <i className="bi bi-diagram-3" />
                  <span>
                    <small>Department</small>
                    <b>{selectedEmployee?.department || 'Not available'}</b>
                  </span>
                </div>
                <div>
                  <i className="bi bi-geo-alt" />
                  <span>
                    <small>Location</small>
                    <b>{selectedEmployee?.location || 'Not available'}</b>
                  </span>
                </div>
                <div>
                  <i className="bi bi-person-check" />
                  <span>
                    <small>Reporting manager</small>
                    <b>{selectedEmployee?.reportingManager || 'Not available'}</b>
                  </span>
                </div>
              </div>
            </section>

            <div className="approval-details-evidence">
              <div>
                <i className="bi bi-file-earmark-check" />
                <span>
                  <b>Verification evidence</b>
                  <small>
                    {selectedCertificate.verification_image_path
                      ? 'Submitted file is ready to review'
                      : 'No file was submitted'}
                  </small>
                </span>
              </div>
              <VerificationFileButton
                certificateId={selectedCertificate.id}
                hasFile={Boolean(selectedCertificate.verification_image_path)}
                notify={notify}
                runWithLoader={runWithLoader}
              />
            </div>

            <footer>
              <button
                type="button"
                className="reject"
                onClick={() => review(selectedCertificate, false)}
              >
                Reject
              </button>
              <button
                type="button"
                className="approve"
                onClick={() => review(selectedCertificate, true)}
              >
                Approve certificate
              </button>
            </footer>
          </article>
        </div>
      )}
    </>
  )
}