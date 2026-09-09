import React from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
// Bootstrap supplies the responsive base; react-dashboard.css contains the
// prototype-specific visual system used by the native React pages.
import App from './App'

// Chromium can report this benign layout warning while responsive panels are
// settling. Keep it out of Create React App's runtime overlay without hiding
// genuine application errors.
window.addEventListener('error', (event) => {
  if (/^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)\.?$/.test(event.message || '')) {
    event.stopImmediatePropagation()
    event.preventDefault()
  }
}, true)

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
