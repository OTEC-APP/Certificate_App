// import { Children, useEffect, useMemo, useRef, useState } from 'react'

// // Native select popups are controlled by the mobile browser and can become much
// // taller than the form. This keeps the native field for desktop/forms, while
// // providing a bounded option list on small screens.
// const optionText = (value) => {
//   if (value === null || value === undefined) return ''
//   if (typeof value === 'string' || typeof value === 'number') return String(value)
//   if (Array.isArray(value)) return value.map(optionText).join(' ')
//   if (typeof value === 'object') return optionText(value.props?.children)
//   return ''
// }

// export default function CompactSelect({ children, className = '', value, defaultValue, onChange, disabled, searchable = true, ...props }) {
//   const [open, setOpen] = useState(false)
//   const [query, setQuery] = useState('')
//   const rootRef = useRef(null)
//   const selectId = useRef(`compact-select-${Math.random().toString(36).slice(2)}`)
//   const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '')
//   const currentValue = value ?? uncontrolledValue
//   const options = useMemo(
//     () => Children.toArray(children).filter((child) => child?.type === 'option'),
//     [children],
//   )
//   const selected = options.find((option) => String(option.props.value ?? option.props.children) === String(currentValue))
//   const visibleOptions = useMemo(() => {
//     const enabled = options.filter((option) => !option.props.disabled)
//     const term = query.trim().toLowerCase()
//     if (!term) return enabled
//     return enabled.filter((option) => optionText(option.props.children).toLowerCase().includes(term))
//   }, [options, query])

//   useEffect(() => {
//     setOpen(false)
//     setQuery('')
//   }, [currentValue])

//   useEffect(() => {
//     const closeFromOutside = (event) => {
//       if (!rootRef.current?.contains(event.target)) setOpen(false)
//     }
//     const closeOtherSelects = (event) => {
//       if (event.detail !== selectId.current) setOpen(false)
//     }
//     const closeOnEscape = (event) => {
//       if (event.key === 'Escape') setOpen(false)
//     }
//     document.addEventListener('mousedown', closeFromOutside)
//     document.addEventListener('keydown', closeOnEscape)
//     window.addEventListener('compact-select-open', closeOtherSelects)
//     return () => {
//       document.removeEventListener('mousedown', closeFromOutside)
//       document.removeEventListener('keydown', closeOnEscape)
//       window.removeEventListener('compact-select-open', closeOtherSelects)
//     }
//   }, [])

//   const choose = (nextValue) => {
//     if (value === undefined) setUncontrolledValue(nextValue)
//     onChange?.({ target: { value: nextValue, name: props.name } })
//   }

//   return (
//     <span className="compact-select" ref={rootRef}>
//       <select
//         {...props}
//         className={`compact-select-native ${className}`.trim()}
//         value={currentValue}
//         onChange={(event) => {
//           if (value === undefined) setUncontrolledValue(event.target.value)
//           onChange?.(event)
//         }}
//         disabled={disabled}
//       >
//         {children}
//       </select>
//       <button type="button" className="compact-select-trigger" disabled={disabled} onClick={() => {
//         if (!open) {
//           setQuery('')
//           window.dispatchEvent(new CustomEvent('compact-select-open', { detail: selectId.current }))
//         }
//         setOpen(!open)
//       }} aria-expanded={open} aria-haspopup="listbox">
//         <span>{selected?.props.children || 'Choose an option'}</span><i className={`bi bi-chevron-${open ? 'up' : 'down'}`} aria-hidden="true" />
//       </button>
//       {open && <span className="compact-select-menu" role="listbox">
//         {searchable && (
//           <span className="compact-select-search">
//             {/* <i className="bi bi-search" aria-hidden="true" /> */}
//             <input
//               autoFocus
//               type="text"
//               value={query}
//               placeholder="Type to search..."
//               aria-label="Search options"
//               onChange={(event) => setQuery(event.target.value)}
//               onKeyDown={(event) => {
//                 if (event.key === 'Enter') event.preventDefault()
//                 if (event.key === 'Escape') { setOpen(false); setQuery('') }
//               }}
//             />
//           </span>
//         )}
//         {visibleOptions.map((option) => {
//           const optionValue = option.props.value ?? option.props.children
//           return <button type="button" role="option" key={String(optionValue)} aria-selected={String(optionValue) === String(currentValue)} onClick={() => choose(optionValue)}>{option.props.children}</button>
//         })}
//         {!visibleOptions.length && <span className="compact-select-empty">No matching options</span>}
//       </span>}
//     </span>
//   )
// }




import { Children, useEffect, useMemo, useRef, useState } from 'react'

const optionText = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(optionText).join(' ')
  if (typeof value === 'object') return optionText(value.props?.children)
  return ''
}

export default function CompactSelect({
  children,
  className = '',
  value,
  defaultValue,
  onChange,
  disabled,
  searchable = true,
  onSearch,
  loading = false,
  hasMore = false,
  onLoadMore,
  ...props
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const menuRef = useRef(null)
  const selectId = useRef(`compact-select-${Math.random().toString(36).slice(2)}`)
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '')
  const currentValue = value ?? uncontrolledValue

  const options = useMemo(
    () => Children.toArray(children).filter((child) => child?.type === 'option'),
    [children],
  )
  const selected = options.find((option) => String(option.props.value ?? option.props.children) === String(currentValue))

  const visibleOptions = useMemo(() => {
    const enabled = options.filter((option) => !option.props.disabled)
    if (onSearch) return enabled
    const term = query.trim().toLowerCase()
    if (!term) return enabled
    return enabled.filter((option) => optionText(option.props.children).toLowerCase().includes(term))
  }, [options, query, onSearch])

  useEffect(() => {
    setOpen(false)
    setQuery('')
  }, [currentValue])

  // Debounced search notification to the parent (lazy mode).
  useEffect(() => {
    if (!onSearch) return
    const timer = window.setTimeout(() => onSearch(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query, onSearch])

  useEffect(() => {
    const closeFromOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOtherSelects = (event) => {
      if (event.detail !== selectId.current) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeFromOutside)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('compact-select-open', closeOtherSelects)
    return () => {
      document.removeEventListener('mousedown', closeFromOutside)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('compact-select-open', closeOtherSelects)
    }
  }, [])

  // Infinite scroll: fire onLoadMore when the user is near the bottom.
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    const handleScroll = () => {
      if (!hasMore || loading) return
      const nearBottom = menu.scrollTop + menu.clientHeight >= menu.scrollHeight - 40
      if (nearBottom) onLoadMore?.()
    }
    menu.addEventListener('scroll', handleScroll, { passive: true })
    return () => menu.removeEventListener('scroll', handleScroll)
  }, [open, hasMore, loading, onLoadMore])

  const choose = (nextValue) => {
    if (value === undefined) setUncontrolledValue(nextValue)
    onChange?.({ target: { value: nextValue, name: props.name } })
    setOpen(false)
    setQuery('')
  }

  return (
    <span className="compact-select" ref={rootRef}>
      <select
        {...props}
        className={`compact-select-native ${className}`.trim()}
        value={currentValue}
        onChange={(event) => {
          if (value === undefined) setUncontrolledValue(event.target.value)
          onChange?.(event)
        }}
        disabled={disabled}
      >
        {children}
      </select>
      <button
        type="button"
        className="compact-select-trigger"
        disabled={disabled}
        onClick={() => {
          if (!open) {
            setQuery('')
            onSearch?.('')
            window.dispatchEvent(new CustomEvent('compact-select-open', { detail: selectId.current }))
          }
          setOpen(!open)
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span>{selected?.props.children || 'Choose an option'}</span>
        <i className={`bi bi-chevron-${open ? 'up' : 'down'}`} aria-hidden="true" />
      </button>
      {open && (
        <span className="compact-select-menu" role="listbox" ref={menuRef}>
          {searchable && (
            <span className="compact-select-search">
              <input
                autoFocus
                type="text"
                value={query}
                placeholder="Type to search..."
                aria-label="Search options"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault()
                  if (event.key === 'Escape') {
                    setOpen(false)
                    setQuery('')
                  }
                }}
              />
            </span>
          )}
          {visibleOptions.map((option) => {
            const optionValue = option.props.value ?? option.props.children
            return (
              <button
                type="button"
                role="option"
                key={String(optionValue)}
                aria-selected={String(optionValue) === String(currentValue)}
                onClick={() => choose(optionValue)}
              >
                {option.props.children}
              </button>
            )
          })}
          {loading && <span className="compact-select-empty">Loading…</span>}
          {!loading && hasMore && <span className="compact-select-empty">Scroll for more…</span>}
          {!loading && !hasMore && !visibleOptions.length && (
            <span className="compact-select-empty">
              {query.trim() ? 'No matching options' : 'Type to search'}
            </span>
          )}
        </span>
      )}
    </span>
  )
}