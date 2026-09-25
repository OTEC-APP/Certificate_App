export const categories = [['Professional', '#a855f7'], ['Technical', '#06b6d4'], ['Cloud', '#3b82f6'], ['Business', '#10b981'], ['Design', '#f59e0b'], ['Other', '#94a3b8']]
export const initials = name => name?.split(' ').map(word => word[0]).join('').slice(0, 2) || 'CT'
export const categoryFor = course => categories[(course?.length || 0) % categories.length]
export const formatDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
