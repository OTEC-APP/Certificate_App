import { useEffect, useState } from 'react'
import { confirmDelete } from '../dialogs'
const apiUrl = process.env.REACT_APP_API_URL

const emptyForm = { name: '', requirements: '', team_size: 1, backup_count: 1, location: '' }
const initials = (name) => String(name || 'Unknown').split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()

function Person({ person, label, goTo }) {
  return <button type="button" className="staff-person" onClick={() => goTo(`employees/${person.employee_id}`)}>
    <i>{initials(person.name)}</i>
    <span><b>{person.name}</b><small>{person.department} · {person.location}</small></span>
    <em className={person.score === 100 ? 'full' : 'partial'}>{person.score}%</em>
    <strong>{label}</strong>
    <div className="staff-match"><span>Matched: {person.matched.join(', ') || 'None'}</span>{person.evidence?.length > 0 && <span>Evidence: {person.evidence.join(', ')}</span>}{person.missing.length > 0 && <span className="missing">Missing: {person.missing.join(', ')}</span>}{person.expiring.length > 0 && <span className="expiring">Expiry risk: {person.expiring.map((item) => `${item.course} (${item.expiry_date})`).join(', ')}</span>}</div>
  </button>
}

function ProjectCard({ project, goTo, onDelete }) {
  const [open, setOpen] = useState(false)
  const requiredCoverage = Number(project.team_size) + Number(project.backup_count)
  const actualCoverage = project.primary.length + project.backups.length
  const covered = actualCoverage >= requiredCoverage
  return <section className="er-card staff-project">
    <header><button type="button" className="staff-project-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span><h3>{project.name}</h3><p>{project.requirements.join(' · ')}{project.location ? ` · ${project.location}` : ''}</p></span></button><div className={covered ? 'coverage good' : 'coverage risk'}><b>{actualCoverage}/{requiredCoverage}</b><small>{covered ? 'covered' : 'coverage gap'}</small></div><button type="button" className="staff-chevron" onClick={() => setOpen((value) => !value)} aria-label={`${open ? 'Close' : 'Open'} ${project.name}`}><i className={`bi bi-chevron-${open ? 'up' : 'down'}`} /></button><button type="button" className="staff-delete" onClick={() => onDelete(project)} aria-label={`Delete ${project.name}`}><i className="bi bi-trash3" /></button></header>
    {open && <><div className="staff-columns">
      <div><h4>Primary team <span>{project.primary.length}/{project.team_size}</span></h4>{project.primary.length ? project.primary.map((person) => <Person key={person.employee_id} person={person} label="Primary" goTo={goTo} />) : <p className="staff-empty">No employee meets every requirement.</p>}</div>
      <div><h4>Backup coverage <span>{project.backups.length}/{project.backup_count}</span></h4>{project.backups.length ? project.backups.map((person) => <Person key={person.employee_id} person={person} label="Backup" goTo={goTo} />) : <p className="staff-empty">No fully qualified backup is available.</p>}</div>
    </div>
    {project.alternatives.length > 0 && <details className="staff-alternatives"><summary>Review {project.alternatives.length} partial {project.alternatives.length === 1 ? 'match' : 'matches'}</summary>{project.alternatives.map((person) => <Person key={person.employee_id} person={person} label="Alternative" goTo={goTo} />)}</details>}</>}
  </section>
}

export default function ProjectStaffingPage({ goTo, notify, runWithLoader }) {
  const [form, setForm] = useState(emptyForm)
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const change = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }))

  const loadProjects = async () => {
    try {
      const response = await fetch(`${apiUrl}/projects`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to load staffing projects')
      setProjects(result.items || [])
      setError('')
    } catch (loadError) { setError(loadError.message || 'Unable to load staffing projects') }
    finally { setLoading(false) }
  }
  useEffect(() => { loadProjects() }, [])

  const submit = async (event) => {
    event.preventDefault()
    const requirements = form.requirements.split(',').map((item) => item.trim()).filter(Boolean)
    if (!requirements.length) return notify?.('Enter at least one certification or skill')
    try {
      const response = await runWithLoader('Finding suitable employees', () => fetch(`${apiUrl}/projects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, requirements, team_size: Number(form.team_size), backup_count: Number(form.backup_count), location: form.location || null }),
      }))
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Unable to create staffing project')
      setProjects((items) => [result, ...items])
      setForm(emptyForm)
      notify?.(`Recommendations ready for ${result.name}`)
    } catch (saveError) { notify?.(saveError.message || 'Unable to create staffing project') }
  }

  const remove = async (project) => {
    const confirmed = await confirmDelete({ name: project.name, itemLabel: 'staffing project' })
    if (!confirmed) return
    const response = await fetch(`${apiUrl}/projects/${project.id}`, { method: 'DELETE' })
    if (response.ok) { setProjects((items) => items.filter((item) => item.id !== project.id)); notify?.(`${project.name} deleted`) }
    else notify?.('Unable to delete project')
  }

  return <section className="staffing-page">
    <form className="er-card staff-form" onSubmit={submit}>
      <header><div><span>NEW STAFFING REQUEST</span><h2>Match certified people to a project</h2><p>Separate requirements with commas, for example: Q-SYS, Networking, CTS-certified.</p></div><i className="bi bi-diagram-3" /></header>
      <div className="staff-fields">
        <label className="wide">Project name<input name="name" value={form.name} onChange={change} required placeholder="Conference room deployment" /></label>
        <label className="wide">Required certifications and skills<input name="requirements" value={form.requirements} onChange={change} required placeholder="Q-SYS, Networking, CTS-certified" /></label>
        <label>Primary employees<input name="team_size" type="number" min="1" max="50" value={form.team_size} onChange={change} required /></label>
        <label>Backup employees<input name="backup_count" type="number" min="0" max="20" value={form.backup_count} onChange={change} required /></label>
        <label className="wide">Location (optional)<input name="location" value={form.location} onChange={change} placeholder="Leave blank for any location" /></label>
      </div>
      <button className="er-add"><i className="bi bi-stars" /> Save and recommend employees</button>
    </form>
    <div className="staff-list"><div className="staff-list-title"><div><span>SAVED PROJECTS</span><h2>Primary and backup coverage</h2></div><b>{projects.length}</b></div>{loading ? <p className="user-empty">Loading staffing projects…</p> : error ? <p className="user-empty">{error}</p> : projects.length ? projects.map((project) => <ProjectCard key={project.id} project={project} goTo={goTo} onDelete={remove} />) : <p className="user-empty">Create the first project to generate staffing recommendations.</p>}</div>
  </section>
}
