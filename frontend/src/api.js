const API_URL = process.env.REACT_APP_API_URL || '/api'
 
export { API_URL }
export default API_URL
 

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Something went wrong')
  return response.json()
}

export const api = {
  dashboard: () => request('/dashboard'),
  certificates: (search = '', status = 'all') => request(`/certificates?search=${encodeURIComponent(search)}&status=${status}`),
  create: (certificate) => request('/certificates', { method: 'POST', body: JSON.stringify(certificate) }),
  updateStatus: (id, status) => request(`/certificates/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
}
