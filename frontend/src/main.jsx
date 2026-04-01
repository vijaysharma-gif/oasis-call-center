import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Open date picker on click anywhere on the input (since native icon is hidden)
document.addEventListener('click', e => {
  if (e.target?.type === 'date' && e.target.showPicker) {
    try { e.target.showPicker(); } catch {}
  }
});

import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
