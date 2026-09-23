import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Pagination from '../components/Pagination'
import { confirmDelete, showResultAlert } from '../dialogs'
import DatePicker from '../components/DatePicker'
 
const apiUrl = process.env.REACT_APP_API_URL

const defaultPageSize = 10
const emptyUser = {
  firstName: '',
  lastName: '',
  dateOfJoining: '',
  employeeId: '',
  employeeEmail: '',
  location: '',
  department: '',
  reportingManager: '',
  role: '',
}
const fieldLabels = {
  firstName: 'First name',
  lastName: 'Last name',
  dateOfJoining: 'Date of joining',
  employeeId: 'Employee ID',
  employeeEmail: 'Employee email',
  location: 'Location',
  department: 'Department',
  reportingManager: 'Reporting manager',
  role: 'Role',
}
const initialUsers = []
function apiErrorMessage(detail, fallback) {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail.map((error) => {
      const field = (error.loc || []).filter((part) => part !== 'body').join('.')
      return `${field ? `${field}: ` : ''}${error.msg || 'Invalid value'}`
    })
    return messages.join('  -  ') || fallback
  }
  if (detail && typeof detail === 'object') return detail.message || fallback
  return fallback
}

function now() {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(),
  )
}

function formatDate(value) {
  if (!value) return ' - '
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

function UserForm({ user, locations, departments, onSave, onClose }) {
  const [form, setForm] = useState(user || emptyUser)
  const change = (event) =>
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))

  return (
    <div className="access-overlay">
      <form
        className="access-dialog access-user-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(form)
        }}
      >
        <header>
          <div>
            <h2>{user ? 'Edit user' : 'Create user'}</h2>
            <p>Manage employee access information.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><i className='bi bi-x-lg' aria-hidden='true' /></button>
        </header>
        <div className="access-form">
          <label>
            First name
            <input name="firstName" value={form.firstName} onChange={change} required />
          </label>
          <label>
            Last name
            <input name="lastName" value={form.lastName} onChange={change} required />
          </label>
          <label>
              Date of joining
            <DatePicker
              name="dateOfJoining"
              value={form.dateOfJoining || ''}
              onChangeValue={(dateOfJoining) => setForm((current) => ({ ...current, dateOfJoining }))}
              max={new Date().toISOString().slice(0, 10)}
              required={!user}
              label="Date of joining"
            />
          </label>
 
          <label>
            Employee ID
            <input
              name="employeeId"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={form.employeeId}
              onChange={change}
              required
            />
          </label>
          <label>
            Employee email
            <input
              name="employeeEmail"
              type="email"
              value={form.employeeEmail}
              onChange={change}
              required
            />
          </label>
          <label>
            Role
            <select name="role" value={form.role} onChange={change} required>
              <option value="">Select role</option>
              <option value="user">User</option>
              <option value="project_manager">Project Manager</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>
            Location
            <select name="location" value={form.location} onChange={change} required>
              <option value="">Select location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.name}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Department
            <select name="department" value={form.department} onChange={change} required>
              <option value="">Select department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.name}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="access-wide">
            Reporting manager
            <input
              name="reportingManager"
              value={form.reportingManager}
              onChange={change}
              required
            />
          </label>
        </div>
        <footer>
          <button type="button" className="outline-action" onClick={onClose}>
            Cancel
          </button>
          <button className="er-add">
            <i className="bi bi-person-plus" /> {user ? 'Save changes' : 'Create user'}
          </button>
        </footer>
      </form>
    </div>
  )
}

function OptionManagerDialog({ locations, departments, onSave, onDelete, onClose }) {
  const [locationName, setLocationName] = useState('')
  const [departmentName, setDepartmentName] = useState('')
  const [selectedLocation, setSelectedLocation] = useState('')
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [editingLocation, setEditingLocation] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState(false)
  const [error, setError] = useState('')
  const locationInputRef = useRef(null)
  const departmentInputRef = useRef(null)

  const selectOption = (type, optionId) => {
    if (type === 'locations') {
      setSelectedLocation(optionId)
      setLocationName('')
      setEditingLocation(false)
    } else {
      setSelectedDepartment(optionId)
      setDepartmentName('')
      setEditingDepartment(false)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!locationName.trim() && !departmentName.trim()) {
      setError('Enter a new location or department to create.')
      return
    }
    try {
      if (locationName.trim())
        await onSave('locations', { id: selectedLocation || undefined, name: locationName.trim() })
      if (departmentName.trim())
        await onSave('departments', {
          id: selectedDepartment || undefined,
          name: departmentName.trim(),
        })
      onClose()
    } catch (saveError) {
      setError(saveError.message || 'Unable to save the options.')
    }
  }

  const deleteSelected = async (type) => {
    const optionId = type === 'locations' ? selectedLocation : selectedDepartment
    if (!optionId) return
    const itemLabel = type === 'locations' ? 'location' : 'department'
    const option = (type === 'locations' ? locations : departments).find(
      (item) => item.id === optionId,
    )
    if (!(await confirmDelete({ name: option?.name || `this ${itemLabel}`, itemLabel }))) return
    try {
      await onDelete(type, optionId)
      selectOption(type, '')
    } catch (deleteError) {
      setError(deleteError.message || 'Unable to delete the option.')
    }
  }

  const startEditing = (type) => {
    const options = type === 'locations' ? locations : departments
    const optionId = type === 'locations' ? selectedLocation : selectedDepartment
    const selectedOption = options.find((option) => option.id === optionId)
    if (!selectedOption) return
    if (type === 'locations') {
      setLocationName(selectedOption.name)
      setEditingLocation(true)
    } else {
      setDepartmentName(selectedOption.name)
      setEditingDepartment(true)
    }
    window.requestAnimationFrame(() =>
      (type === 'locations' ? locationInputRef.current : departmentInputRef.current)?.focus(),
    )
  }

  return (
    <div className="access-overlay">
      <form className="access-dialog access-quick-create" onSubmit={submit}>
        <header>
          <div>
            <h2>Quick Create Hierarchy</h2>
            <p>Create or manage locations and departments for the user form.</p>
          </div>
          <button
            type="button"
            className="access-dialog-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </header>
        <div className="access-option-counts">
          <span>Locations: {locations.length}</span>
          <span>Departments: {departments.length}</span>
        </div>
        <div className="access-quick-fields">
          <label>
            Location
            <span>
              <select
                value={selectedLocation}
                onChange={(event) => selectOption('locations', event.target.value)}
              >
                <option value="">Select existing</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              <input
                ref={locationInputRef}
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder="Or create new"
                disabled={Boolean(selectedLocation) && !editingLocation}
              />
            </span>
            {selectedLocation && (
              <span className="access-option-actions">
                <button type="button" className="edit" onClick={() => startEditing('locations')}>
                  <i className="bi bi-pencil" /> Edit
                </button>
                <button
                  type="button"
                  className="delete"
                  onClick={() => deleteSelected('locations')}
                >
                  <i className="bi bi-trash3" /> Delete
                </button>
              </span>
            )}
          </label>
          <label>
            Department
            <span>
              <select
                value={selectedDepartment}
                onChange={(event) => selectOption('departments', event.target.value)}
              >
                <option value="">Select existing</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
              <input
                ref={departmentInputRef}
                value={departmentName}
                onChange={(event) => setDepartmentName(event.target.value)}
                placeholder="Or create new"
                disabled={Boolean(selectedDepartment) && !editingDepartment}
              />
            </span>
            {selectedDepartment && (
              <span className="access-option-actions">
                <button type="button" className="edit" onClick={() => startEditing('departments')}>
                  <i className="bi bi-pencil" /> Edit
                </button>
                <button
                  type="button"
                  className="delete"
                  onClick={() => deleteSelected('departments')}
                >
                  <i className="bi bi-trash3" /> Delete
                </button>
              </span>
            )}
          </label>
          {error && <p className="access-option-error">{error}</p>}
        </div>
        <footer>
          <button type="button" className="outline-action" onClick={onClose}>
            Cancel
          </button>
          <button className="er-add">Create options</button>
        </footer>
      </form>
    </div>
  )
}

function HistoryPanel({
  history,
  totalItems,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onClose,
  title = 'Access history',
  description = 'Created, edited, and deleted access-user records.',
  emptyMessage = 'No access-management activity yet.',
  embedded = false,
}) {
  return (
    <div className={embedded ? 'history-tab-panel' : 'access-overlay'}>
      <section className="access-dialog history-dialog">
        <header>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {!embedded && <button type="button" onClick={onClose} aria-label="Close"><i className='bi bi-x-lg' aria-hidden='true' /></button>}
        </header>
        <div className="history-list">
          {history.length ? (
            history.map((item) => (
              <article key={item.id}>
                <i className={`bi ${item.icon}`} />
                <div>
                  <b>{item.title}</b>
                  <p>{item.detail}</p>
                  <small>{item.time}</small>
                </div>
              </article>
            ))
          ) : (
            <p className="history-empty">{emptyMessage}</p>
          )}
        </div>
        <Pagination
          page={page}
          totalItems={totalItems}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          label="history records"
        />
      </section>
    </div>
  )
}

export default function AccessManagementPage({ notify, runWithLoader, query = '', realtimeVersion }) {
 
  const [users, setUsers] = useState(initialUsers)
  const [totalUsers, setTotalUsers] = useState(0)
  const [history, setHistory] = useState([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(defaultPageSize)
  const [certificateActivity, setCertificateActivity] = useState([])
  const [certificateActivityTotal, setCertificateActivityTotal] = useState(0)
  const [certificateActivityPage, setCertificateActivityPage] = useState(1)
  const [certificateActivityPageSize, setCertificateActivityPageSize] = useState(defaultPageSize)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const [editing, setEditing] = useState(null)
  const [locations, setLocations] = useState([])
  const [departments, setDepartments] = useState([])
  const [managingOptions, setManagingOptions] = useState(null)
  const [bulkUploads, setBulkUploads] = useState([])
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkFile, setBulkFile] = useState(null)
  const [bulkPage, setBulkPage] = useState(1)
  const [bulkPageSize, setBulkPageSize] = useState(defaultPageSize)
  const [editingBulkRow, setEditingBulkRow] = useState(null)
  const [bulkErrorInfo, setBulkErrorInfo] = useState(null)
  const [selectedBulkRows, setSelectedBulkRows] = useState([])
  const bulkErrorInfoRef = useRef(null)

  useEffect(() => { setSearch(query); setPage(1) }, [query])
  useEffect(() => { setBulkPage(1) }, [bulkUploads.length])

  const reloadUsers = async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        search,
      })
      const response = await fetch(`${apiUrl}/users?${params}`)
      if (!response.ok) return
      const result = await response.json()
      setUsers(result.items || [])
      setTotalUsers(result.total || 0)
    } catch {
      // The list stays empty until the Python API and Firestore are available.
    }
  }

  const reloadHistory = async () => {
    try {
      const response = await fetch(
        `${apiUrl}/access-options/history/logs?page=${historyPage}&page_size=${historyPageSize}`,
      )
      if (!response.ok) return
      const result = await response.json()
      setHistory(result.items || [])
      setHistoryTotal(result.total || 0)
    } catch {
      // History will be restored when Firestore is available again.
    }
  }

  const reloadCertificateActivity = async () => {
    try {
      const response = await fetch(
        `${apiUrl}/certificate-activity?page=${certificateActivityPage}&page_size=${certificateActivityPageSize}`,
      )
      if (!response.ok) return
      const result = await response.json()
      setCertificateActivity(result.items || [])
      setCertificateActivityTotal(result.total || 0)
    } catch {
      // Certificate activity is restored when the API is reachable again.
    }
  }

  useEffect(() => {
    let active = true
    const loadOptions = async (type, setOptions) => {
      try {
        const response = await fetch(`${apiUrl}/access-options/${type}`)
        if (!response.ok) return
        const options = await response.json()
        if (active) setOptions(options)
      } catch {
        // The form remains usable once the Python API and Firebase are configured.
      }
    }
    loadOptions('locations', setLocations)
    loadOptions('departments', setDepartments)
    return () => {
      active = false
    }

  }, [realtimeVersion])
 
  useEffect(() => {
    reloadHistory()
  }, [historyPage, historyPageSize, realtimeVersion])
 
  useEffect(() => {
    reloadCertificateActivity()
  }, [certificateActivityPage, certificateActivityPageSize, realtimeVersion])
 
  useEffect(() => {
    reloadUsers()
  }, [page, pageSize, search, realtimeVersion])
  const reloadBulkUploads = async () => { const response = await fetch(`${apiUrl}/users/bulk/pending`); if (response.ok) { setBulkUploads(await response.json()); setBulkPage(1) } }
  useEffect(() => { reloadBulkUploads().catch(() => {}) }, [realtimeVersion])
 
  const downloadBulkTemplate = async () => {
    try {
      const response = await runWithLoader('Preparing Excel template', () => fetch(`${apiUrl}/users/bulk/template`))
      if (!response.ok) throw new Error('Unable to download template')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'OTEC_User_Bulk_Template.xlsx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      notify(error.message || 'Unable to download template')
    }
  }
  const uploadBulkFile = async (file) => {
    if (!file) return
    const data = new FormData(); data.append('file', file)
    const response = await runWithLoader('Validating bulk upload', () => fetch(`${apiUrl}/users/bulk/upload`, { method: 'POST', body: data }))
    const result = await response.json(); if (!response.ok) return notify(result.detail || 'Unable to upload file')
    setBulkDialogOpen(false); setBulkFile(null); await reloadBulkUploads(); notify('Bulk upload is ready for review')
  }
  const approveBulkRow = async (uploadId, row) => {
    const response = await runWithLoader('Approving bulk user', () => fetch(`${apiUrl}/users/bulk/${uploadId}/rows/${row.row}/approve`, { method: 'POST' }))
    const result = await response.json(); if (!response.ok) return notify(result.detail || 'Unable to approve this row')
    setSelectedBulkRows((keys) => keys.filter((key) => key !== bulkRowKey(uploadId, row)))
    await Promise.all([reloadBulkUploads(), reloadUsers()]); notify(`${row.data.firstName} ${row.data.lastName} approved and added to Access Management`)
  }

  const editBulkRow = async (form) => {
    if (!editingBulkRow) return
    const { uploadId, row } = editingBulkRow
    const response = await runWithLoader('Saving bulk user row', () =>
      fetch(`${apiUrl}/users/bulk/${uploadId}/rows/${row.row}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }),
    )
    const result = await response.json()
    if (!response.ok) return notify(result.detail || 'Unable to save row')
    setEditingBulkRow(null)
    await reloadBulkUploads()
    notify(result.errors && result.errors.length
      ? `Row ${row.row} saved but still needs correction`
      : `Row ${row.row} saved and ready to approve`)
  }

  const deleteBulkRow = async (uploadId, row) => {
    if (!(await confirmDelete({ name: `${row.data.firstName} ${row.data.lastName} (row ${row.row})`, itemLabel: 'row' }))) return
    const response = await fetch(`${apiUrl}/users/bulk/${uploadId}/rows/${row.row}`, { method: 'DELETE' })
    if (!response.ok) {
      const result = await response.json()
      return notify(result.detail || 'Unable to delete this row')
    }
    setSelectedBulkRows((keys) => keys.filter((key) => key !== bulkRowKey(uploadId, row)))
    await reloadBulkUploads(); notify('Row removed from the bulk upload')
  }

  const bulkRowKey = (uploadId, row) => `${uploadId}:${row.row}`

  const toggleBulkRow = (uploadId, row) => {
    const key = bulkRowKey(uploadId, row)
    setSelectedBulkRows((keys) => (keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]))
  }

  const toggleAllBulkRows = (rows) => {
    const keys = rows.map(({ uploadId, row }) => bulkRowKey(uploadId, row))
    const allSelected = keys.length > 0 && keys.every((key) => selectedBulkRows.includes(key))
    setSelectedBulkRows(allSelected ? [] : keys)
  }

  const deleteSelectedBulkRows = async () => {
    if (!selectedBulkRows.length) return
    const grouped = selectedBulkRows.reduce((byUpload, key) => {
      const separator = key.indexOf(':')
      const uploadId = key.slice(0, separator)
      const rowNumber = Number(key.slice(separator + 1))
      ;(byUpload[uploadId] = byUpload[uploadId] || []).push(rowNumber)
      return byUpload
    }, {})
    if (!(await confirmDelete({ name: `${selectedBulkRows.length} selected row${selectedBulkRows.length === 1 ? '' : 's'}`, itemLabel: 'rows' }))) return
    let deleted = 0
    for (const [uploadId, rowNumbers] of Object.entries(grouped)) {
      const response = await runWithLoader('Deleting bulk user rows', () =>
        fetch(`${apiUrl}/users/bulk/${uploadId}/rows/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row_numbers: rowNumbers }),
        }),
      )
      const result = await response.json()
      if (!response.ok) return notify(result.detail || 'Unable to delete selected rows')
      deleted += result.deleted || 0
    }
    setSelectedBulkRows([])
    await reloadBulkUploads()
    notify(`${deleted} row${deleted === 1 ? '' : 's'} removed from the bulk upload`)
  }

  const showBulkErrors = (uploadId, row, event) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const margin = 8
    const popW = Math.min(300, window.innerWidth - 2 * margin)
    const maxH = Math.min(window.innerHeight * 0.6, 420)
    let x = rect.right + margin
    if (x + popW > window.innerWidth - margin) x = Math.max(margin, rect.left - margin - popW)
    x = Math.max(margin, Math.min(x, window.innerWidth - popW - margin))
    let y = rect.top + rect.height / 2
    y = Math.max(maxH / 2, Math.min(y, window.innerHeight - maxH / 2))
    setBulkErrorInfo({ uploadId, row, errors: row.errors || [], x, y, popW })
  }

  useEffect(() => {
    if (!bulkErrorInfo) return
    const onPointerDown = (event) => {
      if (bulkErrorInfoRef.current && bulkErrorInfoRef.current.contains(event.target)) return
      setBulkErrorInfo(null)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setBulkErrorInfo(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [bulkErrorInfo])

  const setOptionsForType = (type, update) => {
    if (type === 'locations') setLocations(update)
    else setDepartments(update)
  }

  const saveOption = async (type, option) => {
    const isUpdate = Boolean(option.id)
    const method = option.id ? 'PUT' : 'POST'
    const endpoint = option.id
      ? `${apiUrl}/access-options/${type}/${option.id}`
      : `${apiUrl}/access-options/${type}`
    const response = await runWithLoader(isUpdate ? 'Updating option' : 'Creating option', () =>
      fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: option.name }),
      }),
    )
    const result = await response.json()
    if (!response.ok) throw new Error(result.detail || `Unable to save ${type}`)
    setOptionsForType(type, (items) =>
      [...items.filter((item) => item.id !== result.id), result].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    )
    const label = type === 'locations' ? 'location' : 'department'
    addHistory({
      icon: isUpdate ? 'bi-pencil-square' : type === 'locations' ? 'bi-geo-alt' : 'bi-building',
      title: `${isUpdate ? 'Updated' : 'Created'} ${label}: ${result.name}`,
      detail: `${label[0].toUpperCase()}${label.slice(1)} option ${isUpdate ? 'renamed or updated' : 'added'}.`,
    })
    notify(`${result.name} ${isUpdate ? 'updated' : 'saved'}`)
  }

  const deleteOption = async (type, optionId) => {
    const options = type === 'locations' ? locations : departments
    const option = options.find((item) => item.id === optionId)
    if (!option) return
    const response = await runWithLoader(
      `Deleting ${type === 'locations' ? 'location' : 'department'}`,
      () => fetch(`${apiUrl}/access-options/${type}/${optionId}`, { method: 'DELETE' }),
    )
    if (!response.ok) {
      const result = await response.json()
      throw new Error(result.detail || `Unable to delete ${type}`)
    }
    setOptionsForType(type, (items) => items.filter((item) => item.id !== optionId))
    const label = type === 'locations' ? 'location' : 'department'
    addHistory({
      icon: 'bi-trash3',
      title: `Deleted ${label}: ${option.name}`,
      detail: `${label[0].toUpperCase()}${label.slice(1)} option removed.`,
    })
    notify(`${option.name} deleted`)
  }

  const visibleUsers = users
  const addHistory = async (entry) => {
    try {
      const response = await fetch(`${apiUrl}/access-options/history/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      const savedLog = await response.json()
      if (!response.ok) throw new Error(savedLog.detail || 'Unable to save history')
      setHistory((items) => [savedLog, ...items])
      setHistoryTotal((total) => total + 1)
    } catch (error) {
      notify(error.message || 'Unable to save history')
    }
  }
  const openCreate = () => setEditing({ mode: 'create', user: null })
  const openEdit = (user) => setEditing({ mode: 'edit', user })

  const saveUser = async (form) => {
    try {
      const isCreate = editing.mode === 'create'
      const payload = { ...form }
      // Legacy administrator accounts can legitimately have no joining date.
      // Omit the empty value so the API preserves the stored record instead of
      // attempting to parse an empty string as a date.
      if (!isCreate && !payload.dateOfJoining) delete payload.dateOfJoining
      const response = await runWithLoader(isCreate ? 'Creating user' : 'Updating user', () =>
        fetch(isCreate ? `${apiUrl}/users` : `${apiUrl}/users/${editing.user.id}`, {
          method: isCreate ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      )
      const result = await response.json()
      if (!response.ok) {
        const error = new Error(apiErrorMessage(result.detail, 'Unable to save user'))
        error.status = response.status
        throw error
      }
      const { invitation_sent: invitationSent, ...savedUser } = result
      setUsers((items) =>
        isCreate
          ? [savedUser, ...items]
          : items.map((item) => (item.id === savedUser.id ? savedUser : item)),
      )
      notify(isCreate
        ? `${savedUser.firstName} ${savedUser.lastName} created${invitationSent ? ' and invitation email sent' : '; invitation email could not be sent'}`
        : `${savedUser.firstName} ${savedUser.lastName} updated`)
      await reloadHistory()
      if (isCreate && page !== 1) setPage(1)
      else await reloadUsers()
      setEditing(null)
      return
    } catch (error) {
      if (error.status === 409) {
        await showResultAlert({
          title: 'Administrator change blocked',
          message: error.message,
          success: false,
        })
        return
      }
      notify(error.message || 'Unable to save user')
      return
    }
    const { password, confirmPassword, ...userData } = form
    if (editing.mode === 'create') {
      const user = { ...userData, id: Date.now() }
      setUsers((items) => [user, ...items])
      addHistory({
        icon: 'bi-person-plus',
        title: `Created ${user.firstName} ${user.lastName}`,
        detail: `Added ${user.employeeId} in ${user.department}, ${user.location}.`,
      })
      notify(`${user.firstName} ${user.lastName} created`)
      setPage(1)
    } else {
      const original = {
        ...editing.user,
        password: form.password,
        confirmPassword: form.confirmPassword,
      }
      const changes = Object.keys(emptyUser)
        .filter((key) => original[key] !== form[key])
        .map((key) => `${fieldLabels[key]}: ${original[key]}  ->  ${form[key]}`)
      setUsers((items) =>
        items.map((item) => (item.id === original.id ? { ...userData, id: original.id } : item)),
      )
      addHistory({
        icon: 'bi-pencil-square',
        title: `Edited ${form.firstName} ${form.lastName}`,
        detail: changes.length ? changes.join('  -  ') : 'Saved with no field changes.',
      })
      notify(`${form.firstName} ${form.lastName} updated`)
    }
    setEditing(null)
  }

  const deleteUser = async (user) => {
    if (!(await confirmDelete({ name: `${user.firstName} ${user.lastName}`, itemLabel: 'user' })))
      return
    try {
      const response = await runWithLoader('Offboarding employee', () =>
        fetch(`${apiUrl}/users/${user.id}`, { method: 'DELETE' }),
      )
      if (!response.ok) {
        const result = await response.json()
        const error = new Error(apiErrorMessage(result.detail, 'Unable to delete user'))
        error.status = response.status
        throw error
      }
      setUsers((items) => items.filter((item) => item.id !== user.id))
      notify(`${user.firstName} ${user.lastName} marked as left; records retained for 30 days`)
      await reloadHistory()
      await reloadUsers()
      return
    } catch (error) {
      if (error.status === 409) {
        await showResultAlert({
          title: 'Administrator change blocked',
          message: error.message,
          success: false,
        })
        return
      }
      notify(error.message || 'Unable to delete user')
      return
    }
    setUsers((items) => items.filter((item) => item.id !== user.id))
    addHistory({
      icon: 'bi-trash3',
      title: `Deleted ${user.firstName} ${user.lastName}`,
      detail: `Removed ${user.employeeId} (${user.employeeEmail}) from access management.`,
    })
    notify(`${user.firstName} ${user.lastName} deleted`)
  }

  return (
    <section className="access-management">
      <div className="access-toolbar">
        <div className="access-search">
          <i className="bi bi-search" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Search users,departments,locations"
          />
        </div>
        <span className="access-total">Total: {totalUsers}</span>
        <div className="access-toolbar-actions">
          <button className="outline-action" onClick={() => setBulkDialogOpen(true)}><i className="bi bi-upload" /> Bulk upload users</button>
          <button className="outline-action" onClick={() => setManagingOptions(true)}>
            <i className="bi bi-sliders" /> Manage options
          </button>
          <button className="er-add" onClick={openCreate}>
            <i className="bi bi-person-plus" /> Create user
          </button>
        </div>
      </div>
      <section className="er-card access-table-card">
        <div className="global-table-scroll">
        <table className="er-table access-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Employee ID</th>
              <th>Email</th>
              <th>Role</th>
              <th>Department</th>
              <th>Location</th>
              <th>Reporting manager</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((user) => (
              <tr key={user.id}>
                <td>
                  <b>
                    {user.firstName} {user.lastName}
                  </b>
                </td>
                <td>
                  <code>{user.employeeId}</code>
                </td>
                <td>{user.employeeEmail}</td>
                <td>{user.role}</td>
                <td>
                  <label>{user.department}</label>
                </td>
                <td>{user.location}</td>
                <td>{user.reportingManager}</td>
                <td className="access-row-actions">
                  <button onClick={() => openEdit(user)} aria-label={`Edit ${user.firstName}`}>
                    <i className="bi bi-pencil" />
                  </button>
                  <button
                    className="delete"
                    onClick={() => deleteUser(user)}
                    aria-label={`Delete ${user.firstName}`}
                  >
                    <i className="bi bi-trash3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!visibleUsers.length && <p className="access-empty">No users match this search.</p>}
      <Pagination
        page={page}
        totalItems={totalUsers}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        label="users"
      />
      </section>
      <section className={`er-card access-table-card bulk-upload-card ${bulkUploads.length ? '' : 'bulk-upload-card-empty'}`}>
        <header><div><h3>Approve bulk upload users <span>({bulkUploads.reduce((sum, upload) => sum + (upload.rows || []).length, 0)})</span></h3><p>All uploaded rows in one table. Approve, edit, or remove each row below.</p></div></header>
        {(() => {
          const allRows = bulkUploads.flatMap((upload) => (upload.rows || []).map((row) => ({ uploadId: upload.id, row })))
          const totalItems = allRows.length
          const visibleRows = allRows.slice((bulkPage - 1) * bulkPageSize, bulkPage * bulkPageSize)
          return allRows.length ? (
            <div className="bulk-review-section">
              <div className="bulk-review-toolbar">
                <span className="bulk-selection-count">{selectedBulkRows.length ? `${selectedBulkRows.length} selected` : ''}</span>
                <button type="button" className="bulk-delete-selected" disabled={!selectedBulkRows.length} onClick={deleteSelectedBulkRows} title="Remove the selected rows"><i className="bi bi-trash3" /> Delete selected</button>
              </div>
              <div className="global-table-scroll">
                <table className="er-table bulk-ready-table">
                  <thead><tr><th className="bulk-select-col"><input type="checkbox" checked={visibleRows.length > 0 && visibleRows.every(({ uploadId, row }) => selectedBulkRows.includes(bulkRowKey(uploadId, row)))} onChange={() => toggleAllBulkRows(visibleRows)} aria-label="Select all visible rows" /></th><th>Row</th><th>User</th><th>Employee ID</th><th>Email</th><th>Role</th><th>Department</th><th>Location</th><th>Reporting manager</th><th>Status</th><th className="bulk-actions-col">Actions</th></tr></thead>
                  <tbody>
                    {visibleRows.map(({ uploadId, row }) => (
                      <tr key={`${uploadId}-${row.row}`}>
                        <td className="bulk-select-col" data-label="Select"><input type="checkbox" checked={selectedBulkRows.includes(bulkRowKey(uploadId, row))} onChange={() => toggleBulkRow(uploadId, row)} aria-label={`Select row ${row.row}`} /></td>
                        <td data-label="Row">{row.row}</td>
                        <td data-label="User"><b>{row.data.firstName} {row.data.lastName}</b></td>
                        <td data-label="Employee ID">{row.data.employeeId}</td>
                        <td data-label="Email">{row.data.employeeEmail}</td>
                        <td data-label="Role">{row.data.role}</td>
                        <td data-label="Department">{row.data.department}</td>
                        <td data-label="Location">{row.data.location}</td>
                        <td data-label="Reporting manager">{row.data.reportingManager}</td>
                        <td data-label="Status">{row.errors && row.errors.length ? <span className="bulk-status-wrap"><span className="bulk-row-error">Needs correction</span><button type="button" className="bulk-error-info" onClick={(event) => showBulkErrors(uploadId, row, event)} aria-label="Show error details" title="Show error details"><i className="bi bi-info-circle" /></button></span> : <span className="bulk-row-valid">Ready</span>}</td>
                        <td className="access-row-actions" data-label="Actions">
                          <button className="approve" disabled={row.errors && row.errors.length} onClick={() => approveBulkRow(uploadId, row)} aria-label="Approve row" title="Approve"><i className="bi bi-check-lg" /></button>
                          <button onClick={() => setEditingBulkRow({ uploadId, row })} aria-label="Edit row" title="Edit"><i className="bi bi-pencil" /></button>
                          <button className="delete" onClick={() => deleteBulkRow(uploadId, row)} aria-label="Delete row" title="Delete row"><i className="bi bi-trash3" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={bulkPage} totalItems={totalItems} pageSize={bulkPageSize} onPageChange={setBulkPage} onPageSizeChange={(size) => { setBulkPageSize(size); setBulkPage(1) }} label="uploaded users" />
            </div>
          ) : <p className="access-empty">No bulk uploaded users awaiting approval.</p>
        })()}
        {bulkErrorInfo && createPortal(
          <div ref={bulkErrorInfoRef} className="bulk-error-popover" style={{ left: bulkErrorInfo.x, top: bulkErrorInfo.y, width: bulkErrorInfo.popW }}>
            <div className="bulk-error-popover-head">
              <span>Row {bulkErrorInfo.row.row} errors</span>
              <button type="button" onClick={() => setBulkErrorInfo(null)} aria-label="Close"><i className="bi bi-x-lg" /></button>
            </div>
            <ul className="bulk-error-list">
              {bulkErrorInfo.errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
            <p className="bulk-error-popover-hint">Edit the row to fix these before approving.</p>
          </div>,
          document.body,
        )}
      </section>
      {editing && (
        <UserForm
          user={editing.user}
          locations={locations}
          departments={departments}
          onSave={saveUser}
          onClose={() => setEditing(null)}
        />
      )}
      {editingBulkRow && (
        <UserForm
          user={editingBulkRow.row.data}
          locations={locations}
          departments={departments}
          onSave={editBulkRow}
          onClose={() => setEditingBulkRow(null)}
        />
      )}
      {managingOptions && (
        <OptionManagerDialog
          locations={locations}
          departments={departments}
          onSave={saveOption}
          onDelete={deleteOption}
          onClose={() => setManagingOptions(null)}
        />
      )}
      {bulkDialogOpen && <div className="access-overlay" onMouseDown={(event) => event.target === event.currentTarget && setBulkDialogOpen(false)}><section className="access-dialog bulk-upload-dialog" role="dialog" aria-modal="true" aria-label="Upload bulk users"><header><div><h2><i className="bi bi-upload" /> Upload Excel File</h2><p>Upload the completed OTEC user template for validation.</p></div><button type="button" onClick={() => setBulkDialogOpen(false)} aria-label="Close"><i className="bi bi-x-lg" /></button></header><label className="bulk-file-input">Choose Excel File<input type="file" accept=".xlsx" onChange={(event) => setBulkFile(event.target.files?.[0] || null)} /></label><footer><button type="button" className="outline-action" onClick={downloadBulkTemplate}><i className="bi bi-download" /> Export Excel template</button><button type="button" className="er-add" disabled={!bulkFile} onClick={() => uploadBulkFile(bulkFile)}><i className="bi bi-upload" /> Upload</button></footer></section></div>}
    </section>
  )
}
