import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Pagination from '../components/Pagination'

const apiUrl = process.env.REACT_APP_API_URL

export default function CompletedTaskUsersPage() {
  const { taskId } = useParams()
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10

  useEffect(() => {
    let active = true
    const loadTask = async () => {
      try {
        const response = await fetch(`${apiUrl}/certification-tasks`, { cache: 'no-store' })
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to load completed users')
        const selectedTask = (result.items || []).find((item) => String(item.id) === String(taskId))
        if (!selectedTask) throw new Error('Certification task not found')
        if (active) setTask(selectedTask)
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load completed users')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadTask()
    return () => { active = false }
  }, [taskId])

  if (loading) return <p className="task-empty">Loading completed users...</p>
  if (error) return <section className="er-card completed-users-page"><p className="task-empty">{error}</p></section>

  const completedUsers = task.completed_by || []
  const completedCount = task.completed_count || 0
  const assignedCount = task.assigned_count || 0
  const progress = assignedCount ? Math.round((completedCount / assignedCount) * 100) : 0
  const employeeTable = completedUsers.length ? <>
    <div className="completed-users-table-wrap"><table className="completed-users-table"><thead><tr><th>Employee</th><th>Email</th><th>Department</th><th>Status</th></tr></thead><tbody>{completedUsers.slice((page - 1) * pageSize, page * pageSize).map((employee) => <tr key={employee.email}><td data-label="Employee"><b className="completed-user-name">{employee.name}{employee.mandatory && <span className="required-marker" title="Mandatory assignment" aria-label="Mandatory assignment">*</span>}</b></td><td data-label="Email">{employee.email}</td><td data-label="Department">{employee.department || 'Not assigned'}</td><td data-label="Status"><span><i className="bi bi-check-circle-fill" /> Completed</span></td></tr>)}</tbody></table></div>
    <Pagination page={page} totalItems={completedUsers.length} pageSize={pageSize} onPageChange={setPage} label="completed users" />
  </> : <p className="task-empty">No employee has completed this task yet.</p>

  return <section className="completed-users-page">
    <section className="er-card completed-users-summary">
      <header><div><span>COMPLETED USERS</span><h1>{task.certification_name}</h1><p>{task.vendor_name || 'OEM not specified'} · {task.category || 'Other'} · {task.departments?.join(', ') || 'All departments'}</p></div><b>{completedCount}/{assignedCount}<small>completed</small></b></header>
      <div className="task-progress"><i style={{ width: `${progress}%` }} /></div>
    </section>
    <section className="er-card completed-users-list">
      <header><div><span>EMPLOYEE RECORDS</span><h2>Employees who completed this task</h2></div><b>{completedUsers.length} users</b></header>
      <p style={{ margin: '0 20px 10px', color: '#765b62', fontSize: 12 }}><span style={{ color: '#c63149', fontWeight: 900 }} aria-hidden="true">* </span>Indicates an employee for whom this course is mandatory based on their department.</p>
      {employeeTable}
    </section>
  </section>
}
