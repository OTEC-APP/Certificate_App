export const canonicalOemName = (value) => {
  const vendor = String(value || '').trim().replace(/\s+/g, ' ')
  const alias = vendor.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!alias || ['na', 'none', 'notrecorded', 'unknown'].includes(alias)) return null
  return vendor
}
 
export const mergeComplianceVendors = (vendors = []) => {
  const grouped = new Map()
  vendors.forEach((vendor) => {
    const name = canonicalOemName(vendor.name)
    if (!name) return
    if (!grouped.has(name)) grouped.set(name, { name, required: 0, certifications: new Map() })
    const mergedVendor = grouped.get(name)
    mergedVendor.required = Math.max(mergedVendor.required, Number(vendor.required) || 0)
    ;(vendor.certifications || []).forEach((certification) => {
      const certificationKey = String(certification.name || 'Untitled certificate').trim().toLowerCase()
      if (!mergedVendor.certifications.has(certificationKey)) {
        mergedVendor.certifications.set(certificationKey, {
          name: certification.name || 'Untitled certificate', required: 0, holders: new Map(),
        })
      }
      const mergedCertification = mergedVendor.certifications.get(certificationKey)
      mergedCertification.required = Math.max(mergedCertification.required, Number(certification.required) || 0)
      ;(certification.holders || []).forEach((holder) => {
        const holderKey = String(holder.email || holder.employee_id || holder.certificate_id || holder.name).trim().toLowerCase()
        mergedCertification.holders.set(holderKey, holder)
      })
    })
  })
 
  return [...grouped.values()].map((vendor) => {
    const vendorHolders = new Set()
    const certifications = [...vendor.certifications.values()].map((certification) => {
      const holders = [...certification.holders.values()]
      certification.holders.forEach((_, key) => vendorHolders.add(key))
      return { ...certification, holders, completed: holders.length }
    })
    return { name: vendor.name, required: vendor.required, completed: vendorHolders.size, certifications }
  }).sort((first, second) => first.name.localeCompare(second.name))
}
 
 
