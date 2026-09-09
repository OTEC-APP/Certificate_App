const RU_PATTERNS = [
  /(?:total\s*)?r\s*u(?:s)?\s*(?:points?|credits?|units?)?\s*[.:\-]?\s*(\d+(?:\.\d+)?)/i,
  /(\d+(?:\.\d+)?)\s*(?:r\s*u(?:s)?|renewal\s+units?)(?:\s+points?)?/i,
]

export async function extractRuPoints(file) {
  if (!file?.type?.startsWith('image/')) return null
  const { recognize } = await import('tesseract.js')
  const { data } = await recognize(file, 'eng', { langPath: '/tessdata' })
  const text = data?.text || ''
  for (const pattern of RU_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      const points = Number(match[1])
      if (Number.isFinite(points) && points >= 0 && points <= 9999) return points
    }
  }
  return null
}
