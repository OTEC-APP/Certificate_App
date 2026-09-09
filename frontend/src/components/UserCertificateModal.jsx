const apiUrl = process.env.REACT_APP_API_URL

import { useEffect, useRef, useState } from 'react'
import { extractRuPoints } from '../utils/certificateOcr'
import CompactSelect from './CompactSelect'
import DatePicker from './DatePicker'
 

const MAX_CERTIFICATE_FILE_SIZE = 25 * 1024 * 1024
const capitalizeCertificationName = (value) =>
  String(value || '').replace(/\b[a-z]/g, (letter) => letter.toUpperCase())

const initialValidityYears = (certificate) => {
  if (!certificate) return 'lifetime'
  if (Object.prototype.hasOwnProperty.call(certificate, 'validity_years')) {
    return certificate.validity_years == null ? 'lifetime' : String(certificate.validity_years)
  }
  return { lifetime: 'lifetime', '1_year': '1', '2_years': '2', '3_years': '3' }[
    certificate.validity
  ] ?? 'lifetime'
}

const expiryDateFor = (certificate) => {
  if (!certificate) return ''
  if (certificate.expires_on) return String(certificate.expires_on).slice(0, 10)
  const years = initialValidityYears(certificate)
  if (years === 'lifetime' || !certificate.issued_date) return ''
  const issued = new Date(`${String(certificate.issued_date).slice(0, 10)}T00:00:00`)
  const expiry = new Date(issued)
  expiry.setFullYear(issued.getFullYear() + Number(years))
  if (expiry.getMonth() !== issued.getMonth()) expiry.setDate(0)
  return expiry.toISOString().slice(0, 10)
}

export default function UserCertificateModal({
  close,
  notify,
  user,
  runWithLoader,
  certificate = null,
  defaults = null,
}) {
   const isEditing = Boolean(certificate)
  const [validityMode, setValidityMode] = useState(() => certificate?.expires_on || initialValidityYears(certificate) !== 'lifetime' ? 'expires' : 'lifetime')
  const [expiresOn, setExpiresOn] = useState(() => expiryDateFor(certificate))
  const [issuedDate, setIssuedDate] = useState(() => certificate?.issued_date || new Date().toISOString().slice(0, 10))
  const [oems, setOems] = useState([])
  const [oemName, setOemName] = useState(certificate?.vendor_name || defaults?.vendor_name || '')
  const [loadingOems, setLoadingOems] = useState(true)
  const [categories, setCategories] = useState([])
  const [categoryName, setCategoryName] = useState(certificate?.category || defaults?.category || '')
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [readingRu, setReadingRu] = useState(false)
  const ruPointsInput = useRef(null)

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
        const savedOem = String(certificate?.vendor_name || defaults?.vendor_name || '').trim()
        if (savedOem && !byName.has(savedOem.toLowerCase())) byName.set(savedOem.toLowerCase(), savedOem)
        setOems([...byName.values()].sort((left, right) => left.localeCompare(right)))
      })
      .catch(() => {
        if (active) setOems((certificate?.vendor_name || defaults?.vendor_name) ? [certificate?.vendor_name || defaults?.vendor_name] : [])
      })
      .finally(() => {
        if (active) setLoadingOems(false)
      })
    return () => { active = false }
  }, [certificate?.vendor_name, defaults?.vendor_name])

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
        const savedCategory = String(certificate?.category || defaults?.category || '').trim()
        if (savedCategory && !names.has(savedCategory.toLowerCase())) names.set(savedCategory.toLowerCase(), savedCategory)
        setCategories([...names.values()].sort((left, right) => left.localeCompare(right)))
      })
      .catch(() => {
        if (active) setCategories((certificate?.category || defaults?.category) ? [certificate?.category || defaults?.category] : [])
      })
      .finally(() => {
        if (active) setLoadingCategories(false)
      })
    return () => { active = false }
  }, [certificate?.category, defaults?.category])

   const validateCertificateFile = (event) => {
    const file = event.currentTarget.files?.[0]
    if (file && file.size > MAX_CERTIFICATE_FILE_SIZE) {
      event.currentTarget.value = ''
      notify('Certificate file must be 25 MB or smaller.')
      return
    }
  }
  const submit = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = capitalizeCertificationName(form.get('name')).trim()
    const image = form.get('verificationImage')
    const totalRuPoints = form.get('totalRuPoints')
    if (image instanceof File && image.size > MAX_CERTIFICATE_FILE_SIZE) {
      notify('Certificate file must be 25 MB or smaller.')
      return
    }
 
    try {
      const response = await runWithLoader(
        isEditing ? 'Updating your certificate' : 'Adding your certificate',
        () =>
          fetch(isEditing ? `${apiUrl}/certificates/${certificate.id}` : `${apiUrl}/certificates`, {
            method: isEditing ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipient_name: `${user.firstName} ${user.lastName}`,
              email: user.employeeEmail,
              course_name: name,
              vendor_name: form.get('vendorName'),
              category: form.get('category'),
              certificate_number: form.get('certificateNumber'),
              total_ru_points: totalRuPoints === '' ? null : Number(totalRuPoints),
              validity_years: null,
              expires_on: validityMode === 'expires' ? form.get('expiresOn') : null,
              issued_date: form.get('issuedDate'),
              submission_source: 'user',
            }),
          }),
      )
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.detail || `Unable to ${isEditing ? 'update' : 'add'} certificate`)
      if (image instanceof File && image.size) {
        try {
          const imageData = new FormData()
          imageData.append('image', image)
          const uploadResponse = await runWithLoader('Uploading certificate file', () =>
            fetch(`${apiUrl}/certificates/${result.id}/verification-image`, {
              method: 'POST',
              body: imageData,
            }),
          )
          const uploadResult = await uploadResponse.json()
          if (!uploadResponse.ok) throw new Error(uploadResult.detail || 'Unable to upload certificate file')
        } catch {
          notify('Certificate submitted, but its optional file could not be uploaded. Configure Firebase Storage to add it later.')
        }
      }
      window.dispatchEvent(new Event('certificates-updated'))
      notify(
        isEditing
          ? `Resubmitted "${name}" for administrator review`
          : `Submitted "${name}" for administrator approval`,
      )
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
            <h2>{isEditing ? 'Edit my certificate' : 'Add my certificate'}</h2>
            <p>
              {isEditing
                ? 'Update certificate details or its verification image.'
                : 'Submit a completed certificate for administrator approval.'}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close modal"><i className='bi bi-x-lg' aria-hidden='true' /></button>
        </header>
        <label>
          Employee <span className="required-field-mark" aria-hidden="true">*</span>
          <input value={`${user.firstName} ${user.lastName}`} disabled />
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
          <small className="verification-image-help">OEM names are managed by the administrator in Settings.</small>
        </label>
        <label>
          Certification name <span className="required-field-mark" aria-hidden="true">*</span>
          <input
            name="name"
            required
            placeholder="e.g. AVIXA CTS"
            defaultValue={certificate?.course_name || defaults?.certification_name || ''}
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
          <small className="verification-image-help">Categories are managed by the administrator in Settings.</small>
        </label>
        <label>
          Certificate number (optional)
          <input
            name="certificateNumber"
            placeholder="Enter the certificate number"
            defaultValue={certificate?.certificate_number || ''}
          />
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
          Certificate file for verification {!isEditing && <span className="required-field-mark" aria-hidden="true">*</span>}
          <input name="verificationImage" type="file" required={!isEditing} onChange={validateCertificateFile} />
          <small className="verification-image-help">
            Images and PDFs are optimized before storage while retaining a readable preview. Other files are stored unchanged. Maximum upload: 25 MB.
          </small>
 
        </label>
        <label className="total-ru-field">
          Total RU points (optional) 
          <input
            ref={ruPointsInput}
            name="totalRuPoints"
            type="number"
            min="0"
            max="9999"
            step="0.1"
            placeholder="Enter total RU points"
            defaultValue={certificate?.total_ru_points ?? ''}
          />
        </label>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="save">{isEditing ? 'Resubmit for approval' : 'Submit for approval'}</button>
        </footer>
      </form>
    </div>
  )
}
