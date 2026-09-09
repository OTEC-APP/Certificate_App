export default function Pagination({
  page,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label = 'records',
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems =
    totalPages <= 5
      ? Array.from({ length: totalPages }, (_, index) => index + 1)
      : [1, 2, 3, 'ellipsis', totalPages]

  return (
    <div className="app-pagination">
      <span className="app-pagination-summary">
        Page {safePage} of {totalPages} · {totalItems} {label}
      </span>
      {onPageSizeChange && (
        <label className="app-pagination-size">
          Show
          <select
            value={pageSize}
            onChange={(event) => {
              onPageSizeChange(Number(event.target.value))
              onPageChange(1)
            }}
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
          per page
        </label>
      )}
      <div className="app-pagination-controls">
        <button disabled={safePage === 1} onClick={() => onPageChange(1)}>
          «
        </button>
        <button disabled={safePage === 1} onClick={() => onPageChange(safePage - 1)}>
          ‹
        </button>
        {pageItems.map((item) =>
          item === 'ellipsis' ? (
            <span key="ellipsis">…</span>
          ) : (
            <button
              key={item}
              className={safePage === item ? 'active' : ''}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ),
        )}
        <button disabled={safePage === totalPages} onClick={() => onPageChange(safePage + 1)}>
          ›
        </button>
        <button disabled={safePage === totalPages} onClick={() => onPageChange(totalPages)}>
          »
        </button>
      </div>
    </div>
  )
}
