import { useEffect, useRef, useState } from 'react'
 
const displayDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}
 
const isoDate = (value) => {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return ''
  const [, day, month, year] = match
  const candidate = `${year}-${month}-${day}`
  const parsed = new Date(`${candidate}T00:00:00`)
  return !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === Number(year) && parsed.getMonth() + 1 === Number(month) && parsed.getDate() === Number(day)
    ? candidate
    : ''
}
 
export default function DatePicker({ name, value, onChangeValue, min, max, required = false, label }) {
  const nativeInput = useRef(null)
  const textInput = useRef(null)
  const [text, setText] = useState(() => displayDate(value))
  const dateFromText = isoDate(text)
  const inRange = Boolean(dateFromText && (!min || dateFromText >= min) && (!max || dateFromText <= max))
  const valid = (!required && !text) || inRange
  const submittedValue = inRange ? dateFromText : ''
 
  useEffect(() => setText(displayDate(value)), [value])

  useEffect(() => {
    const input = textInput.current
    if (!input) return
    let message = ''
    if (required && !text) message = `${label || 'Date'} is required.`
    else if (text && !dateFromText) message = 'Enter a valid date in DD/MM/YYYY format.'
    else if (dateFromText && min && dateFromText < min) message = `${label || 'Date'} cannot be before ${displayDate(min)}.`
    else if (dateFromText && max && dateFromText > max) message = `${label || 'Date'} cannot be after ${displayDate(max)}.`
    input.setCustomValidity(message)
  }, [dateFromText, label, max, min, required, text])
 
  const chooseDate = () => {
    const input = nativeInput.current
    if (!input) return
    if (typeof input.showPicker === 'function') input.showPicker()
    else input.click()
  }
 
  return (
    <span className="fixed-date-picker">
      <input type="hidden" name={name} value={submittedValue} />
      <input
        ref={textInput}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        value={text}
        maxLength={10}
        required={required}
        aria-label={label || name}
        aria-invalid={!valid}
        onChange={(event) => {
          const next = event.target.value.replace(/[^\d/]/g, '').slice(0, 10)
          setText(next)
          const parsed = isoDate(next)
          onChangeValue(parsed && (!min || parsed >= min) && (!max || parsed <= max) ? parsed : '')
        }}
        onBlur={() => {
          if (!text) onChangeValue('')
        }}
      />
      <input ref={nativeInput} className="fixed-date-picker-native" type="date" value={submittedValue} min={min} max={max} onChange={(event) => onChangeValue(event.target.value)} tabIndex={-1} aria-hidden="true" />
      <button type="button" onClick={chooseDate} aria-label={`Choose ${label || name}`}><i className="bi bi-calendar3" /></button>
    </span>
  )
}
 
 
