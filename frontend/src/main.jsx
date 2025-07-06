import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './grid-fix.css' // Aggressive grid overrides
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
