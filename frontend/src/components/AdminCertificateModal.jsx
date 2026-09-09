import { useEffect, useState } from 'react'
import CompactSelect from './CompactSelect'
import DatePicker from './DatePicker'
 
const apiUrl = process.env.REACT_APP_API_URL

const MAX_CERTIFICATE_FILE_SIZE = 25 * 1024 * 1024
const capitalizeCertificationName = (value) =>
  String(value || '').replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
 
 
export default function AdminCertificateModal({ close, notify, runWithLoader }) {
  const [employees, setEmployees] = useState([])
  const [employeeId, setEmployeeId] = useState('')
  const [validityMode, setValidityMode] = useState('lifetime')
  const [expiresOn, setExpiresOn] = useState('')
  const [issuedDate, setIssuedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [oems, setOems] = useState([])
  const [oemName, setOemName] = useState('')
  const [loadingOems, setLoadingOems] = useState(true)
  const [categories, setCategories] = useState([])
  const [categoryName, setCategoryName] = useState('')
  const [loadingCategories, setLoadingCategories] = useState(true)
  const validateCertificateFile = (event) => {
    const file = event.currentTarget.files?.[0]
    if (file && file.size > MAX_CERTIFICATE_FILE_SIZE) {
      event.currentTarget.value = ''
      notify('Certificate file must be 25 MB or smaller.')
      return
    }
  }
 
  useEffect(() => {
    fetch(`${apiUrl}/employees?page=1&page_size=100`)
      .then((response) => response.json())
      .then((result) => setEmployees(result.items || []))
      .catch(() => setEmployees([]))
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
    return () => { active = false }
  }, [])
 
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
        ;(Array.isArray(result) ? result : [])
          .forEach((oem) => {
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
    return () => { active = false }
  }, [])
 
  const submit = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const employee = employees.find((item) => item.id === employeeId)
    if (!employee) return notify('Select an employee first')
    const certificateName = capitalizeCertificationName(form.get('name')).trim()
    const totalRuPoints = form.get('totalRuPoints')
    const image = form.get('verificationImage')
    if (image instanceof File && image.size > MAX_CERTIFICATE_FILE_SIZE) {
      notify('Certificate file must be 25 MB or smaller.')
      return
    }
    try {
      const response = await runWithLoader('Adding certificate', () =>
        fetch(`${apiUrl}/certificates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient_name: employee.name,
            email: employee.email,
            course_name: certificateName,
            vendor_name: form.get('vendorName'),
            certificate_number: form.get('certificateNumber'),
            category: form.get('category'),
            total_ru_points: totalRuPoints === '' ? null : Number(totalRuPoints),
            issued_date: form.get('issuedDate'),
            validity_years: null,
            expires_on: validityMode === 'expires' ? form.get('expiresOn') : null,
            submission_source: 'admin',
          }),
        }),
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to add certificate')
      if (image instanceof File && image.size) {
        try {
          const imageData = new FormData()
          imageData.append('image', image)
          const imageResponse = await runWithLoader('Uploading certificate file', () =>
            fetch(`${apiUrl}/certificates/${result.id}/verification-image`, {
              method: 'POST',
              body: imageData,
            }),
          )
          const imageResult = await imageResponse.json()
          if (!imageResponse.ok) throw new Error(imageResult.detail || 'Unable to upload certificate file')
        } catch {
          notify('Certificate saved, but its optional file could not be uploaded. Configure Firebase Storage to add it later.')
        }
      }
      window.dispatchEvent(new Event('certificates-updated'))
      notify(`Submitted "${certificateName}" for ${employee.name}. It is assigned to that employee's profile.`)
      close()
    } catch (error) {
      notify(error.message || 'Unable to add certificate')
    }
  }

  return (
    <div className="er-overlay">
      <form className="er-modal user-certificate-modal" onSubmit={submit}>
        <header>
          <div>
            <h2>Add certification</h2>
            <p>Record a completed employee certification.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close modal"><i className='bi bi-x-lg' aria-hidden='true' /></button>
        </header>
        <label>
          Employee name <span className="required-field-mark" aria-hidden="true">*</span>
          <CompactSelect
            required
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
          >
            <option value="">Choose employee</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}  -  {employee.employeeId}
              </option>
            ))}
          </CompactSelect>
          <small className="verification-image-help">
            The certificate and its count will belong to the selected employee's profile.
          </small>
        </label>
        <label>
          OEM name <span className="required-field-mark" aria-hidden="true">*</span>
          <CompactSelect
            name="vendorName"
            required
            value={oemName}
            onChange={(event) => setOemName(event.target.value)}
            disabled={loadingOems}
          >
            <option value="" disabled>
              {loadingOems ? 'Loading OEMs...' : oems.length ? 'Choose OEM' : 'No OEMs configured'}
            </option>
            {oems.map((oem) => <option key={oem} value={oem} title={oem}>{oem}</option>)}
          </CompactSelect>
          <small className="verification-image-help">
            Add or edit OEM names from Settings.
          </small>
        </label>
        <label>
          Certification name <span className="required-field-mark" aria-hidden="true">*</span>
          <input
            name="name"
            required
            placeholder="e.g. AVIXA CTS"
            onBlur={(event) => { event.currentTarget.value = capitalizeCertificationName(event.currentTarget.value) }}
          />
          <small className="verification-image-help">Enter the certification name exactly as shown on the certificate.</small>
        </label>
        <label>
          Category <span className="required-field-mark" aria-hidden="true">*</span>
          <CompactSelect
            name="category"
            required
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            disabled={loadingCategories}
          >
            <option value="" disabled>
              {loadingCategories ? 'Loading categories...' : categories.length ? 'Choose category' : 'No categories configured'}
            </option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </CompactSelect>
          <small className="verification-image-help">Categories are managed in Settings.</small>
        </label>
        <label>
          Certificate number (optional)
          <input name="certificateNumber" placeholder="Enter the certificate number" />
        </label>
        <label>
          Completion date <span className="required-field-mark" aria-hidden="true">*</span>
          <DatePicker name="issuedDate" value={issuedDate} onChangeValue={setIssuedDate} required label="Completion date" />
        </label>
        <fieldset className="certificate-validity-choice">
          <legend>Validity period <span className="required-field-mark" aria-hidden="true">*</span></legend>
          <label>
            <input type="radio" name="validityMode" value="lifetime" checked={validityMode === 'lifetime'} onChange={(event) => {
              setValidityMode(event.target.value)
              setExpiresOn('')
            }} />
            <span>Lifetime (no renewal required)</span>
          </label>
          <label>
            <input type="radio" name="validityMode" value="expires" checked={validityMode === 'expires'} onChange={(event) => setValidityMode(event.target.value)} />
            <span>Expires on</span>
          </label>
          {validityMode === 'expires' && <DatePicker name="expiresOn" value={expiresOn} onChangeValue={setExpiresOn} min={issuedDate} required label="Expiry date" />}
        </fieldset>

 
        <label>
          Certificate file for verification <span className="required-field-mark" aria-hidden="true">*</span>
          <input name="verificationImage" type="file" required onChange={validateCertificateFile} />
          <small className="verification-image-help">
            Images and PDFs are optimized before storage while retaining a readable preview. Other files are stored unchanged. Maximum upload: 25 MB.
          </small>
        </label>
        <label className="total-ru-field">
          Total RU points (optional) 
          <input name="totalRuPoints" type="number" min="0" max="9999" step="0.1" placeholder="Enter total RU points" />
        </label>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="save">Submit for approval</button>
        </footer>
      </form>
    </div>
  )
}
 
 
 
 
 
 
 
 
