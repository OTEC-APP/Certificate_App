import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CompactSelect from '../components/CompactSelect'
import Pagination from '../components/Pagination'
import { confirmDelete } from '../dialogs'

const apiUrl = process.env.REACT_APP_API_URL

const formatDate = (value) => value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : 'No due date'

export default function CertificationTasksPage({ user, notify, realtimeVersion, openCertificateForm }) {
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const email = user?.employeeEmail || user?.email || ''
  const [tasks, setTasks] = useState([])
  const [departments, setDepartments] = useState([])
  const [oems, setOems] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState('')
  const [search, setSearch] = useState('')
  const [oemFilter, setOemFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCourseFilters, setShowCourseFilters] = useState(true)
  const [coursePage, setCoursePage] = useState(1)
  const [coursePageSize, setCoursePageSize] = useState(10)
  const [form, setForm] = useState({ certification_name: '', vendor_name: '', category: '', certification_link: '', due_date: '', departments: [] })

  const loadTasks = async () => {
    setLoading(true)
    try {
      const suffix = isAdmin ? '' : `?employee_email=${encodeURIComponent(email)}`
      const response = await fetch(`${apiUrl}/certification-tasks${suffix}`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to load certification tasks')
      setTasks(result.items || [])
    } catch (error) {
      setTasks([])
      notify?.(error.message || 'Unable to load certification tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTasks() }, [email, isAdmin, realtimeVersion])
  useEffect(() => {
    if (!isAdmin) return
    fetch(`${apiUrl}/access-options/departments`).then((response) => response.json()).then((result) => setDepartments(Array.isArray(result) ? result : [])).catch(() => setDepartments([]))
    fetch(`${apiUrl}/access-options/oems`).then((response) => response.json()).then((result) => setOems(Array.isArray(result) ? result : [])).catch(() => setOems([]))
    fetch(`${apiUrl}/access-options/categories`).then((response) => response.json()).then((result) => setCategories(Array.isArray(result) ? result : [])).catch(() => setCategories([]))
  }, [isAdmin])

  const toggleDepartment = (name) => setForm((current) => ({
    ...current,
    departments: current.departments.includes(name) ? current.departments.filter((item) => item !== name) : [...current.departments, name],
  }))

  const createTask = async (event) => {
    event.preventDefault()
    if (!form.departments.length) return notify?.('Select at least one mandatory department')
    const normalizeTaskValue = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
    const duplicateTask = !editingTaskId && tasks.some((task) =>
      normalizeTaskValue(task.certification_name) === normalizeTaskValue(form.certification_name) &&
      normalizeTaskValue(task.vendor_name) === normalizeTaskValue(form.vendor_name) &&
      normalizeTaskValue(task.category) === normalizeTaskValue(form.category),
    )
    if (duplicateTask) {
      notify?.('This course task has already been assigned. Remove the existing task before assigning it again.')
      return
    }
    setSaving(true)
    try {
      const response = await fetch(`${apiUrl}/certification-tasks${editingTaskId ? `/${encodeURIComponent(editingTaskId)}` : ''}`, {
        method: editingTaskId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, due_date: form.due_date || null, created_by: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Administrator' }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Unable to assign task')
      setForm({ certification_name: '', vendor_name: '', category: '', certification_link: '', due_date: '', departments: [] })
      setEditingTaskId('')
      setTasks((items) => editingTaskId ? items.map((item) => item.id === result.id ? { ...item, ...result } : item) : [result, ...items])
      notify?.(editingTaskId ? 'Certification task updated' : 'Certification task assigned to all employees')
    } catch (error) { notify?.(error.message || 'Unable to assign task') }
    finally { setSaving(false) }
  }

  const deleteTask = async (task) => {
    const confirmed = await confirmDelete({ name: task.certification_name, itemLabel: 'certification task' })
    if (!confirmed) return
    const response = await fetch(`${apiUrl}/certification-tasks/${task.id}`, { method: 'DELETE' })
    if (response.ok) { setTasks((items) => items.filter((item) => item.id !== task.id)); notify?.('Certification task deleted') }
    else notify?.('Unable to delete task')
  }

  const editTask = (task) => {
    setEditingTaskId(task.id)
    setForm({
      certification_name: task.certification_name || '', vendor_name: task.vendor_name || '', category: task.category || '',
      certification_link: task.certification_link || '', due_date: task.due_date || '', departments: task.departments || [],
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const filterOptions = useMemo(() => ({
    oems: [...new Set(tasks.map((task) => task.vendor_name).filter(Boolean))].sort((first, second) => first.localeCompare(second)),
    categories: [...new Set(tasks.map((task) => task.category).filter(Boolean))].sort((first, second) => first.localeCompare(second)),
  }), [tasks])
  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase()
    return tasks.filter((task) => {
      const matchesSearch = !term || [task.certification_name, task.vendor_name, task.category].some((value) => String(value || '').toLowerCase().includes(term))
      const matchesOem = !oemFilter || task.vendor_name === oemFilter
      const matchesCategory = !categoryFilter || task.category === categoryFilter
      const matchesStatus = !statusFilter || (statusFilter === 'validated' ? task.completed : statusFilter === 'under_review' ? !task.completed && task.submitted : !task.completed && !task.submitted)
      return matchesSearch && matchesOem && matchesCategory && matchesStatus
    })
  }, [categoryFilter, oemFilter, search, statusFilter, tasks])
  const pending = useMemo(() => filteredTasks.filter((task) => !task.completed && !task.submitted).length, [filteredTasks])
  const completedTasks = useMemo(() => filteredTasks.filter((task) => task.completed), [filteredTasks])
  const pendingTasks = useMemo(() => filteredTasks.filter((task) => !task.completed && !task.submitted), [filteredTasks])
  const hasFilters = Boolean(search || oemFilter || categoryFilter || statusFilter)
  const pagedTasks = useMemo(() => filteredTasks.slice((coursePage - 1) * coursePageSize, coursePage * coursePageSize), [coursePage, coursePageSize, filteredTasks])

  useEffect(() => { setCoursePage(1) }, [search, oemFilter, categoryFilter, statusFilter, isAdmin])

  const taskCard = (task) => <article className={`task-card ${task.completed ? 'completed' : ''}`} key={task.id}>
    <header><i className="bi bi-award" /><div>{(isAdmin || task.mandatory) && <span className="mandatory">{isAdmin ? `${task.departments?.length || 0} mandatory teams` : 'Mandatory'}</span>}<h3>{task.certification_name}</h3></div>{isAdmin && <div className="task-card-actions"><button type="button" className="task-edit" onClick={() => editTask(task)} aria-label="Edit task"><i className="bi bi-pencil-square" /></button><button type="button" className="task-delete" onClick={() => deleteTask(task)} aria-label="Delete task"><i className="bi bi-trash3" /></button></div>}</header>
    <dl><div><dt>OEM</dt><dd>{task.vendor_name || 'Not specified'}</dd></div><div><dt>Category</dt><dd>{task.category || 'Not specified'}</dd></div><div><dt>Due date</dt><dd>{formatDate(task.due_date)}</dd></div>{isAdmin && <div><dt>Mandatory for</dt><dd>{task.departments?.join(', ')}</dd></div>}</dl>
    {isAdmin && <section className="task-completion-report"><header><b>{task.completed_count || 0} of {task.assigned_count || 0} completed</b><span>{task.assigned_count ? Math.round(((task.completed_count || 0) / task.assigned_count) * 100) : 0}%</span></header><div className="task-progress"><i style={{ width: `${task.assigned_count ? ((task.completed_count || 0) / task.assigned_count) * 100 : 0}%` }} /></div>{task.completed_by?.length ? <button type="button" className="completed-users-link" onClick={() => navigate(`/task-assignments/${encodeURIComponent(task.id)}/completed-users`)}><span>View completed users</span><i className="bi bi-arrow-right" /></button> : <small>No employee has completed this task yet.</small>}</section>}
    <footer>{!isAdmin && <a href={task.certification_link} target="_blank" rel="noreferrer"><i className="bi bi-box-arrow-up-right" /> Access Certification Portal</a>}{!isAdmin && (task.completed ? <span className="task-approved"><i className="bi bi-patch-check-fill" /> Admin approved</span> : task.submitted ? <button type="button" className="task-under-review" disabled><i className="bi bi-hourglass-split" /> Under review</button> : <button type="button" onClick={() => openCertificateForm(task)}><i className="bi bi-upload" /> Add certificate</button>)}</footer>
  </article>

  const userTaskTable = (items) => <div className="course-table-wrap"><table className="course-table"><thead><tr><th>Course</th><th>OEM</th><th>Category</th><th>Due date</th><th>Status</th><th>Action</th></tr></thead><tbody>{items.map((task) => <tr key={task.id}><td data-label="Course"><b className="course-name">{task.certification_name}{task.mandatory && <span className="mandatory-marker" title="Mandatory certificate" aria-label="Mandatory certificate">*</span>}</b></td><td data-label="OEM">{task.vendor_name || 'Not specified'}</td><td data-label="Category">{task.category || 'Other'}</td><td data-label="Due date">{formatDate(task.due_date)}</td><td data-label="Status"><span className={task.completed ? 'done' : 'pending'}>{task.completed ? 'Validated' : task.submitted ? 'Under Review' : 'Pending'}</span></td><td data-label="Action">{task.completed ? <span className="course-action-muted">Validated</span> : task.submitted ? <span className="course-action-muted">Under Review</span> : <div className="course-user-actions"><a href={task.certification_link} target="_blank" rel="noreferrer" style={{ gap: 6, minWidth: 172 }}><i className="bi bi-box-arrow-up-right" /><span>Access Certification Portal</span></a><button type="button" className="course-open-action" onClick={() => openCertificateForm(task)} style={{ gap: 6, minWidth: 162 }}><i className="bi bi-cloud-arrow-up" /><span>Add certificate</span></button></div>}</td></tr>)}</tbody></table></div>

  return <section className={`certification-tasks-page ${isAdmin ? 'admin-courses-page' : 'user-courses-page'}`}>
    <header className="task-page-hero"><div><span>{isAdmin ? 'TEAM LEARNING' : 'MY LEARNING'}</span><h1>{isAdmin ? 'Courses List' : 'Course list'}</h1><p>{isAdmin ? 'Create and manage certification courses for your teams.' : 'Open assigned certification links and keep your learning tasks up to date.'}</p></div></header>

    {!isAdmin && <div className="task-summary-cards"><article><i className="bi bi-list-task" /><span><small>Total assigned</small><b>{tasks.length}</b></span></article><article className="complete"><i className="bi bi-check2-circle" /><span><small>Validated</small><b>{completedTasks.length}</b></span></article><article className="pending"><i className="bi bi-hourglass-split" /><span><small>Pending</small><b>{pendingTasks.length}</b></span></article></div>}

    <section className="task-course-filter-panel">
      <header><div><i className="bi bi-funnel" /><span>Filter courses</span></div><button type="button" onClick={() => setShowCourseFilters((visible) => !visible)} aria-expanded={showCourseFilters}>{showCourseFilters ? <i className="bi bi-x-lg" /> : <i className="bi bi-chevron-down" />}</button></header>
      {showCourseFilters && <div className="task-course-filters" role="search" aria-label="Filter courses">
        <label className="task-course-search"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search courses, OEM or category" aria-label="Search courses" /></label>
        <label><span>OEM</span><CompactSelect value={oemFilter} onChange={(event) => setOemFilter(event.target.value)}><option value="">All OEMs</option>{filterOptions.oems.map((oem) => <option key={oem}>{oem}</option>)}</CompactSelect></label>
        <label><span>Category</span><CompactSelect value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{filterOptions.categories.map((category) => <option key={category}>{category}</option>)}</CompactSelect></label>
        <label><span>Status</span><CompactSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All courses</option><option value="pending">Pending</option><option value="under_review">Under Review</option><option value="validated">Validated</option></CompactSelect></label>
        {hasFilters && <button type="button" className="task-course-clear" onClick={() => { setSearch(''); setOemFilter(''); setCategoryFilter(''); setStatusFilter('') }}><i className="bi bi-x-circle" /> Clear</button>}
      </div>}
    </section>

    {isAdmin && <form className="er-card task-assignment-form" onSubmit={createTask}>
      <header><div><span>{editingTaskId ? 'EDIT ASSIGNMENT' : 'NEW ASSIGNMENT'}</span><h2>Certification details</h2></div><i className={`bi ${editingTaskId ? 'bi-pencil-square' : 'bi-send-check'}`} /></header>
      <div className="task-form-fields"><label>OEM name<CompactSelect required value={form.vendor_name} onChange={(event) => setForm((current) => ({ ...current, vendor_name: event.target.value }))}><option value="" disabled>Choose OEM</option>{oems.map((oem) => <option key={oem.id || oem.name} value={oem.name}>{oem.name}</option>)}</CompactSelect></label><label>Certification name<input required value={form.certification_name} onChange={(event) => setForm((current) => ({ ...current, certification_name: event.target.value }))} placeholder="e.g. CTS-D Certification" /></label><label>Category<CompactSelect required value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}><option value="" disabled>Choose category</option>{categories.map((category) => <option key={category.id || category.name} value={category.name}>{category.name}</option>)}</CompactSelect></label><label>Certification link<input required type="url" value={form.certification_link} onChange={(event) => setForm((current) => ({ ...current, certification_link: event.target.value }))} placeholder="https://training.example.com/course" /></label><label>Due date <input type="date" min={new Date().toISOString().slice(0, 10)} value={form.due_date} onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))} /></label></div>
      <fieldset className="task-team-picker"><legend>Mandatory for departments</legend><p>Selected departments receive a Mandatory task. All other employees receive it as Optional.</p><div>{departments.map((department) => <label key={department.id || department.name} className={form.departments.includes(department.name) ? 'selected' : ''}><input type="checkbox" checked={form.departments.includes(department.name)} onChange={() => toggleDepartment(department.name)} /><i className={`bi ${form.departments.includes(department.name) ? 'bi-check-circle-fill' : 'bi-circle'}`} />{department.name}</label>)}</div>{!departments.length && <small>No departments are configured in Access management.</small>}</fieldset>
      <footer><span>{form.departments.length} mandatory {form.departments.length === 1 ? 'department' : 'departments'} selected</span><div>{editingTaskId && <button type="button" className="task-edit-cancel" onClick={() => { setEditingTaskId(''); setForm({ certification_name: '', vendor_name: '', category: '', certification_link: '', due_date: '', departments: [] }) }}>Cancel</button>}<button type="submit" disabled={saving || !form.departments.length}><i className={`bi ${editingTaskId ? 'bi-check2' : 'bi-send'}`} /> {saving ? 'Saving…' : editingTaskId ? 'Save changes' : 'Assign to everyone'}</button></div></footer>
    </form>}

    {loading ? <p className="task-empty">Loading certification tasks...</p> : isAdmin ? <section className="task-list-section"><header><div><span>COURSE LIBRARY</span><h2>Courses</h2></div><b>{filteredTasks.length} courses</b></header>{filteredTasks.length ? <><div className="task-card-grid">{pagedTasks.map(taskCard)}</div><Pagination page={coursePage} totalItems={filteredTasks.length} pageSize={coursePageSize} onPageChange={setCoursePage} onPageSizeChange={setCoursePageSize} label="courses" /></> : <p className="task-empty">No courses match the selected filters.</p>}</section> : <section className="task-list-section course-table-section"><header><div><span>MY COURSE LIST</span><h2>Courses</h2></div><b>{filteredTasks.length} courses</b></header>{filteredTasks.length ? <>{userTaskTable(pagedTasks)}<Pagination page={coursePage} totalItems={filteredTasks.length} pageSize={coursePageSize} onPageChange={setCoursePage} onPageSizeChange={setCoursePageSize} label="courses" /></> : <p className="task-empty">No courses match the selected filters.</p>}</section>}
  </section>
}
