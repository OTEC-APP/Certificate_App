const apiUrl = process.env.REACT_APP_API_URL

export default function VerificationFileButton({ certificateId, hasFile, notify, runWithLoader }) {
  if (!hasFile) return <span className="verification-file-missing">No file</span>

  const preview = async () => {
    try {
      const request = () => fetch(`${apiUrl}/certificates/${certificateId}/verification-file`)
      const response = runWithLoader ? await runWithLoader('Opening verification file', request) : await request()
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to open verification file')
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      const message = error.message || 'Unable to open verification file'
      if (notify) notify(message)
      else window.alert(message)
    }
  }

  return <button type="button" className="verification-file-preview" onClick={preview}><i className="bi bi-box-arrow-up-right" /> Preview</button>
}

