export const renewalTimeLabel = (value) => {
  if (value === null || value === undefined || value === '') return '—'
  const days = Number(value)
  if (!Number.isFinite(days)) return '—'
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`
  if (days === 0) return 'Expires today'
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'}`
  if (days < 365) {
    const months = Math.ceil(days / 30.44)
    return `${months} ${months === 1 ? 'month' : 'months'}`
  }
  const years = Math.floor(days / 365)
  const months = Math.round((days % 365) / 30.44)
  return months ? `${years}y ${months}m` : `${years} ${years === 1 ? 'year' : 'years'}`
}
