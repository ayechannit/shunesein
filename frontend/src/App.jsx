import React, { useEffect, useState } from 'react';
import Login from './pages/Login';
import MasterDataManagement from './pages/MasterDataManagement';
import { API_ROOT } from './config/api';
import { getToken, clearToken } from './utils/authStorage';
import './App.css';

function App() {
  const [token, setToken] = useState(() => getToken());

  useEffect(() => {
    const handleStorage = () => {
      setToken(getToken());
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handleLoginSuccess = () => {
    setToken(getToken());
  };

  const handleLogout = () => {
    const currentToken = getToken();
    if (currentToken) {
      // Fire-and-forget: this is purely an audit entry (JWTs are stateless
      // here, nothing server-side to invalidate), so it must never block
      // actually logging the user out.
      fetch(`${API_ROOT}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}` },
      }).catch(() => {});
    }
    clearToken();
    setToken('');
  };

  return (
    <div className="app-shell">
      {token ? (
        <MasterDataManagement token={token} onLogout={handleLogout} />
      ) : (
        <Login onLoginSuccess={handleLoginSuccess} />
      )}
    </div>
  );
}

export default App;
