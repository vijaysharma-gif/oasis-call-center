import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Patch fetch to add ngrok header (bypasses interstitial page on free tier)
const _fetch = window.fetch;
window.fetch = (url, opts = {}) => {
  const apiUrl = import.meta.env.VITE_API_URL ?? '';
  if (apiUrl && typeof url === 'string' && url.startsWith(apiUrl)) {
    opts.headers = { 'ngrok-skip-browser-warning': '1', ...opts.headers };
  }
  return _fetch(url, opts);
};
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
