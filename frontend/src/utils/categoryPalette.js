const categoryPalette = {
  audio: '#f59e0b', av: '#e34861', control: '#10b5cf', lighting: '#d946ef',
  networking: '#3b82f6', other: '#94a3b8', sales: '#10b981', video: '#8b5cf6',
}

const fallbackPalette = Object.values(categoryPalette)

export const categoryColor = (category) => {
  const normalized = String(category || 'Other').trim().toLowerCase()
  if (categoryPalette[normalized]) return categoryPalette[normalized]
  const index = [...normalized].reduce((sum, character) => sum + character.charCodeAt(0), 0) % fallbackPalette.length
  return fallbackPalette[index]
}

export const categoryBadgeStyle = (category) => {
  const color = categoryColor(category)
  return { color, borderColor: `${color}55`, backgroundColor: `${color}18` }
}
