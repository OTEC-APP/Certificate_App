import { useEffect, useState } from 'react'
import Pagination from '../components/Pagination'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
const apiUrl = process.env.REACT_APP_API_URL
import CatalogCertificateDetailsModal from '../components/CatalogCertificateDetailsModal'
import CompactSelect from '../components/CompactSelect'
import { categoryBadgeStyle } from '../utils/categoryPalette'
import { loadCompanyLogo, drawPdfHeader } from '../utils/pdfBranding'
 
 
const validityLabel = (row) => {
  if (row.next_expiry_date) {
    const expiry = new Date(`${String(row.next_expiry_date).slice(0, 10)}T00:00:00`)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days = Math.max(0, Math.ceil((expiry - today) / 86_400_000))
    let months = (expiry.getFullYear() - today.getFullYear()) * 12 + expiry.getMonth() - today.getMonth()
    if (expiry.getDate() < today.getDate()) months -= 1
    const remaining = months >= 12 ? `${Math.floor(months / 12)}y ${months % 12}m left` : months > 0 ? `${months}m left` : `${days}d left`
    const date = expiry.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const duration = row.uses_expiry_date ? '' : `${row.validity_years} ${Number(row.validity_years) === 1 ? 'year' : 'years'} · `
    return `${duration}Expires ${date} · ${remaining}`
  }
  if (row.uses_expiry_date) return 'Expiry date set'
  if (!row.validity_years) return 'Lifetime'
  return `${row.validity_years} ${Number(row.validity_years) === 1 ? 'year' : 'years'}`
}
 
export default function LiveCatalogPage({ runWithLoader, notify, viewToggle, query = '', realtimeVersion, goTo }) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [vendor, setVendor] = useState('')
  const [category, setCategory] = useState('')
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedRow, setSelectedRow] = useState(null)
  const [exporting, setExporting] = useState(false)
 
  useEffect(() => setSearch(query), [query])
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 400)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => setPage(1), [debouncedSearch, vendor, category])
 
  useEffect(() => {
    const loadFilters = async () => {
      try {
        const [oemResponse, categoryResponse] = await Promise.all([
          fetch(`${apiUrl}/access-options/oems`),
          fetch(`${apiUrl}/access-options/categories`),
        ])
        const [oems, savedCategories] = await Promise.all([oemResponse.json(), categoryResponse.json()])
        if (oemResponse.ok) setVendors((oems || []).map((item) => item.name).filter(Boolean).sort())
        if (categoryResponse.ok) setCategories((savedCategories || []).map((item) => item.name).filter(Boolean).sort())
      } catch {
        setVendors([])
        setCategories([])
      }
    }
    loadFilters()
  }, [realtimeVersion])
 
  // Keep the dropdown useful even before a newly deployed backend has been
  // restarted and can provide the full filter list.
  useEffect(() => {
    if (!rows.length) return
    if (!vendors.length) setVendors([...new Set(rows.map((row) => row.vendor).filter(Boolean))].sort())
    if (!categories.length) setCategories([...new Set(rows.map((row) => row.category).filter(Boolean))].sort())
  }, [rows, vendors.length, categories.length])
 
  useEffect(() => {
    const loadCatalog = async () => {
      setLoading(true)
      try {
        const response = await runWithLoader('Loading certification catalog', () =>
          fetch(
            `${apiUrl}/certification-catalog?search=${encodeURIComponent(debouncedSearch)}&vendor=${encodeURIComponent(vendor)}&category=${encodeURIComponent(category)}&page=${page}&page_size=${pageSize}`,
          ),
        )
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to load the certification catalog')
        setRows(result.items || [])
        setTotal(result.total || 0)
        setError('')
      } catch (loadError) {
        setError(loadError.message || 'Unable to load the certification catalog')
      } finally {
        setLoading(false)
      }
    }
    loadCatalog()
  }, [page, pageSize, debouncedSearch, vendor, category, realtimeVersion])
 
  const exportCatalog = async () => {
    setExporting(true)
    try {
      const exportPage = async (exportPageNumber) => {
        const params = new URLSearchParams({ search: debouncedSearch, vendor, category, page: String(exportPageNumber), page_size: '100' })
        const response = await fetch(`${apiUrl}/certification-catalog?${params}`)
        const result = await response.json()
        if (!response.ok) throw new Error(result.detail || 'Unable to export the certification catalog')
        return result
      }
      const firstPage = await exportPage(1)
      const pageCount = Math.ceil((firstPage.total || 0) / 100)
      const remainingPages = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => exportPage(index + 2)))
      const exportRows = [firstPage, ...remainingPages].flatMap((result) => result.items || [])
      const document = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
      const logoData = await loadCompanyLogo()
      const appliedFilters = [
        debouncedSearch && `Search: ${debouncedSearch}`,
        vendor && `OEM: ${vendor}`,
        category && `Category: ${category}`,
      ].filter(Boolean)
      drawPdfHeader(document, logoData, { title: 'Certification Catalog', subtitle: appliedFilters.length ? appliedFilters.join('  |  ') : 'All certification types' })
      autoTable(document, {
        startY: 33,
        head: [['Certification', 'OEM', 'Category', 'Holders']],
        body: exportRows.map((row) => [row.name, row.vendor, row.category, row.holders]),
        theme: 'grid',
        headStyles: { fillColor: [189, 41, 66], textColor: 255, fontSize: 9 },
        styles: { fontSize: 8.5, cellPadding: 2.5, textColor: [75, 39, 48], overflow: 'linebreak' },
        columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 60 }, 2: { cellWidth: 45 }, 3: { cellWidth: 35 }, 4: { cellWidth: 25, halign: 'center' } },
        willDrawPage: (data) => { if (data.pageNumber > 1) drawPdfHeader(document, logoData, { title: 'Certification Catalog', subtitle: appliedFilters.length ? appliedFilters.join('  |  ') : 'All certification types' }) },
      })
      const pages = document.getNumberOfPages()
      for (let pdfPage = 1; pdfPage <= pages; pdfPage += 1) {
        document.setPage(pdfPage)
        document.setFontSize(8)
        document.setTextColor(125, 83, 92)
        document.text(`Generated ${new Date().toLocaleDateString('en-US')} | Page ${pdfPage} of ${pages}`, 283, 202, { align: 'right' })
      }
      document.save(`certification-catalog-${new Date().toISOString().slice(0, 10)}.pdf`)
      notify?.(`Exported ${exportRows.length} certification ${exportRows.length === 1 ? 'type' : 'types'}`)
    } catch (exportError) {
      notify?.(exportError.message || 'Unable to export the certification catalog')
    } finally {
      setExporting(false)
    }
  }
 
  return (
    <>
      <section className="er-card catalog-heading-card">
        <header>
          <div>
            <h3>Certification catalog</h3>
            <p>Certificate types created from user-entered records.</p>
          </div>
          <div className="catalog-heading-actions">
            <span>{total} certification types</span>
            <button type="button" className="catalog-export" disabled={loading || exporting || total === 0} onClick={exportCatalog}>
              <i className={`bi ${exporting ? 'bi-arrow-repeat' : 'bi-file-earmark-pdf'}`} aria-hidden="true" />
              {exporting ? 'Exporting...' : 'Export PDF'}
            </button>
          </div>
        </header>
      </section>
      {viewToggle}
      <section className="er-card catalog-data-card">
        <div className="catalog-filters">
          <label>
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Certificate, OEM, or category"
            />
          </label>
          <label>
            OEM
            <CompactSelect
              value={vendor}
              onChange={(event) => setVendor(event.target.value)}
            >
              <option value="">All OEMs</option>
              {vendors.map((vendorName) => (
                <option key={vendorName} value={vendorName}>{vendorName}</option>
              ))}
            </CompactSelect>
          </label>
          <label>
            Category
            <CompactSelect value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((categoryName) => <option key={categoryName} value={categoryName}>{categoryName}</option>)}
            </CompactSelect>
          </label>
          {(search || vendor || category) && (
            <button
              type="button"
              className="catalog-filter-clear"
              onClick={() => {
                setSearch('')
                setVendor('')
                setCategory('')
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        {loading ? (
          <p className="user-empty">Loading saved certificate records...</p>
        ) : error ? (
          <p className="user-empty">{error}</p>
        ) : !rows.length ? (
          <p className="user-empty">No user certificates have been added yet.</p>
        ) : (
          <div className="global-table-scroll">
          <table className="er-table">
            <thead>
              <tr>
                <th>Certification</th>
                <th>OEM</th>
                <th>Category</th>
                <th>Holders</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.name}-${row.vendor}-${row.category}-${row.validity_years || 'lifetime'}-${row.uses_expiry_date ? 'expiry-date' : 'standard'}`}
                  className="catalog-row-clickable"
                  onClick={() => setSelectedRow(row)}
                  onKeyDown={(event) => event.key === 'Enter' && setSelectedRow(row)}
                  tabIndex={0}
                >
                  <td><b>{row.name}</b></td>
                  <td>{row.vendor}</td>
                  <td><span className="category-badge" style={categoryBadgeStyle(row.category)}>{row.category}</span></td>
                  <td className="count">{row.holders}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      <Pagination
        page={page}
        totalItems={total}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(1)
        }}
        label="certification types"
      />
      </section>
      {selectedRow && <CatalogCertificateDetailsModal row={selectedRow} close={() => setSelectedRow(null)} notify={notify} goTo={goTo} />}
    </>
  )
}
 
 
 
