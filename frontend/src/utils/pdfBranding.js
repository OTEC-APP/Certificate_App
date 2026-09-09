const LOGO_PATH = '/o2k-logo.png'

const dataUrlFor = async (path) => {
  const response = await fetch(path)
  if (!response.ok) throw new Error('Company logo is unavailable')
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Keep every PDF export visually consistent without making the logo a dependency.
export async function loadCompanyLogo() {
  try {
    return await dataUrlFor(LOGO_PATH)
  } catch (_) {
    return null
  }
}

export function drawPdfHeader(document, logoData, { title, subtitle = '' }) {
  if (logoData) {
    const { width, height } = document.getImageProperties(logoData)
    const scale = Math.min(22 / width, 12 / height)
    document.addImage(logoData, 'PNG', 14, 7, width * scale, height * scale, undefined, 'FAST')
  }
  document.setFontSize(16)
  document.setTextColor(75, 39, 48)
  document.text(title, 42, 14)
  if (subtitle) {
    document.setFontSize(9)
    document.setTextColor(125, 83, 92)
    document.text(subtitle, 42, 20)
  }
  document.setDrawColor(189, 41, 66)
  document.setLineWidth(0.6)
  document.line(14, 28, document.internal.pageSize.getWidth() - 14, 28)
}
