import { Children, useEffect, useMemo, useRef, useState } from 'react'

// Native select popups are controlled by the mobile browser and can become much
// taller than the form. This keeps the native field for desktop/forms, while
// providing a bounded option list on small screens.
export default function CompactSelect({ children, className = '', value, defaultValue, onChange, disabled, ...props }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const selectId = useRef(`compact-select-${Math.random().toString(36).slice(2)}`)
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '')
  const currentValue = value ?? uncontrolledValue
  const options = useMemo(
    () => Children.toArray(children).filter((child) => child?.type === 'option'),
    [children],
  )
  const selected = options.find((option) => String(option.props.value ?? option.props.children) === String(currentValue))

  useEffect(() => setOpen(false), [currentValue])

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

  const choose = (nextValue) => {
    if (value === undefined) setUncontrolledValue(nextValue)
    onChange?.({ target: { value: nextValue, name: props.name } })
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
      <button type="button" className="compact-select-trigger" disabled={disabled} onClick={() => setOpen((isOpen) => {
        if (!isOpen) window.dispatchEvent(new CustomEvent('compact-select-open', { detail: selectId.current }))
        return !isOpen
      })} aria-expanded={open} aria-haspopup="listbox">
        <span>{selected?.props.children || 'Choose an option'}</span><i className={`bi bi-chevron-${open ? 'up' : 'down'}`} aria-hidden="true" />
      </button>
      {open && <span className="compact-select-menu" role="listbox">
        {options.filter((option) => !option.props.disabled).map((option) => {
          const optionValue = option.props.value ?? option.props.children
          return <button type="button" role="option" key={String(optionValue)} aria-selected={String(optionValue) === String(currentValue)} onClick={() => choose(optionValue)}>{option.props.children}</button>
        })}
      </span>}
    </span>
  )
}
