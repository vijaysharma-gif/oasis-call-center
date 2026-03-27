import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const AuthContext = createContext(null);
const API = import.meta.env.VITE_API_URL ?? '';

// Refresh when less than 2 hours remain on the token
const REFRESH_THRESHOLD_MS = 2 * 60 * 60 * 1000;
// Check every 5 minutes
const CHECK_INTERVAL_MS    = 5 * 60 * 1000;

function getTokenExp(token) {
  try {
    return JSON.parse(atob(token.split('.')[1])).exp * 1000;
  } catch {
    return 0;
  }
}

export function AuthProvider({ children }) {
  const [user,               setUser]              = useState(null);
  const [token,              setToken]             = useState(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [sessionExpired,     setSessionExpired]    = useState(false);
  const [loading,            setLoading]           = useState(true);
  const tokenRef = useRef(null); // always up-to-date without stale closure issues

  useEffect(() => {
    try {
      const saved = localStorage.getItem('otr_auth');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (getTokenExp(parsed.token) > Date.now()) {
          setToken(parsed.token);
          tokenRef.current = parsed.token;
          setUser(parsed.user);
          setMustChangePassword(parsed.mustChangePassword ?? false);
        } else {
          localStorage.removeItem('otr_auth');
        }
      }
    } catch {
      localStorage.removeItem('otr_auth');
    }
    setLoading(false);
  }, []);

  const silentRefresh = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;

    const exp = getTokenExp(currentToken);
    const msLeft = exp - Date.now();

    // Token already expired — don't auto-logout, just flag it
    if (msLeft <= 0) {
      setSessionExpired(true);
      return;
    }

    // Still has plenty of time — nothing to do
    if (msLeft > REFRESH_THRESHOLD_MS) return;

    // Within threshold — refresh silently
    try {
      const res = await fetch(`${API}/api/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (!res.ok) {
        // Refresh failed (token likely expired between check and request)
        setSessionExpired(true);
        return;
      }
      const { token: newToken } = await res.json();
      setToken(newToken);
      tokenRef.current = newToken;
      const saved = localStorage.getItem('otr_auth');
      if (saved) {
        const parsed = JSON.parse(saved);
        localStorage.setItem('otr_auth', JSON.stringify({ ...parsed, token: newToken }));
      }
    } catch {
      // Network error — don't logout, agent may be on a call; they'll see the banner
      setSessionExpired(true);
    }
  }, []);

  // Run the refresh check on an interval once logged in
  useEffect(() => {
    if (!token) return;
    silentRefresh(); // check immediately on mount / token change
    const interval = setInterval(silentRefresh, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token, silentRefresh]);

  function login(token, user, mustChangePassword = false) {
    setToken(token);
    tokenRef.current = token;
    setUser(user);
    setMustChangePassword(mustChangePassword);
    setSessionExpired(false);
    localStorage.setItem('otr_auth', JSON.stringify({ token, user, mustChangePassword }));
  }

  function clearMustChangePassword() {
    setMustChangePassword(false);
    const saved = localStorage.getItem('otr_auth');
    if (saved) {
      const parsed = JSON.parse(saved);
      localStorage.setItem('otr_auth', JSON.stringify({ ...parsed, mustChangePassword: false }));
    }
  }

  function logout() {
    setToken(null);
    tokenRef.current = null;
    setUser(null);
    setMustChangePassword(false);
    setSessionExpired(false);
    localStorage.removeItem('otr_auth');
    localStorage.removeItem('activePage');
  }

  return (
    <AuthContext.Provider value={{
      user, token, loading, login, logout,
      mustChangePassword, clearMustChangePassword,
      sessionExpired,
      isAdmin: user?.role === 'admin',
      isAgent: user?.role === 'agent',
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
