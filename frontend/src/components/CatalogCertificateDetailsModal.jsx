import { useEffect, useState } from 'react'
const apiUrl = process.env.REACT_APP_API_URL
import VerificationFileButton from './VerificationFileButton'

const statusLabel = (status) => (status === 'issued' ? 'Validated' : status === 'revoked' ? 'Revoked' : 'Under Review')
const validityLabel = (row) => {
  if (row.next_expiry_date) {
    const expiry = new Date(`${String(row.next_expiry_date).slice(0, 10)}T00:00:00`)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days = Math.max(0, Math.ceil((expiry - today) / 86_400_000))
    let months = (expiry.getFullYear() - today.getFullYear()) * 12 + expiry.getMonth() - today.getMonth()
    if (expiry.getDate() < today.getDate()) months -= 1
    const remaining = months >= 12 ? `${Math.floor(months / 12)}y ${months % 12}m left` : months > 0 ? `${months}m left` : `${days}d left`
    const duration = row.uses_expiry_date ? '' : `${row.validity_years} ${Number(row.validity_years) === 1 ? 'year' : 'years'} · `
    return `${duration}Expires ${expiry.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })} · ${remaining}`
  }
  return row.uses_expiry_date ? 'Expiry date set' : !row.validity_years ? 'Lifetime' : `${row.validity_years} ${Number(row.validity_years) === 1 ? 'year' : 'years'}`
}
const formatDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ' - '

export default function CatalogCertificateDetailsModal({ row, close, notify, goTo }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const loadDetails = async () => {
      try {
        const response = await fetch(
          `${apiUrl}/certification-catalog/holders?name=${encodeURIComponent(row.name)}&vendor=${encodeURIComponent(row.vendor)}`,
        )
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to load certificate details')
        if (!cancelled) setRecords(result.items || [])
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Unable to load certificate details')
          notify(loadError.message || 'Unable to load certificate details')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadDetails()
    return () => { cancelled = true }
  }, [row.name, row.vendor])

  return (
    <div className="er-overlay catalog-details-overlay" role="presentation">
      <section className="er-modal catalog-details-modal" role="dialog" aria-modal="true" aria-label="Certification details">
        <header>
          <div>
            <h2>{row.name}</h2>
            <p>{row.vendor}  -  {row.category}  -  {validityLabel(row)}</p>
          </div>
          <button type="button" onClick={close} aria-label="Close details"><i className='bi bi-x-lg' aria-hidden='true' /></button>
        </header>
        <div className="catalog-details-summary">
          <span><b>{records.filter((record) => record.status === 'issued').length}</b> validated</span>
          <span><b>{records.filter((record) => record.status === 'pending').length}</b> under review</span>
          <span><b>{records.length}</b> submitted</span>
        </div>
        {loading ? <p className="user-empty">Loading employee certificate details...</p> : error ? <p className="user-empty">{error}</p> : !records.length ? <p className="user-empty">No employee submissions found for this certification.</p> : (
          <div className="catalog-details-table-wrap">
            <table className="er-table catalog-details-table">
              <thead>
                <tr><th>Employee</th><th>Employee ID</th><th>Department</th><th>Certificate no.</th><th>Completed</th><th>Validity</th><th>Status</th><th>Verification file</th></tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const openProfile = () => record.profile_id && goTo?.(`employees/${record.profile_id}`)
                  return <tr key={record.id} className={record.profile_id ? 'catalog-record-clickable' : ''} onClick={openProfile} onKeyDown={(event) => event.key === 'Enter' && openProfile()} tabIndex={record.profile_id ? 0 : undefined}>
                    <td data-label="Employee"><b>{record.employee_name}</b><small>{record.email}</small></td>
                    <td data-label="Employee ID">{record.employee_id}</td>
                    <td data-label="Department"><b>{record.department}</b><small>{record.location}</small></td>
                    <td data-label="Certificate no."><code>{record.certificate_number}</code></td>
                    <td data-label="Completed" className="certificate-completed-date">{formatDate(record.issued_date)}</td>
                    <td data-label="Validity">{validityLabel(record)}</td>
                    <td data-label="Status"><span className={`catalog-record-status ${record.status}`}>{statusLabel(record.status)}</span></td>
                    <td data-label="Verification file"><VerificationFileButton certificateId={record.id} hasFile={record.verification_file_uploaded} notify={notify} /></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
