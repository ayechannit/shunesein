import React, { useEffect, useState } from 'react';
import Login from './pages/Login';
import MasterDataManagement from './pages/MasterDataManagement';
import { API_ROOT } from './config/api';
import './App.css';

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');

  useEffect(() => {
    const handleStorage = () => {
      setToken(localStorage.getItem('token') || '');
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handleLoginSuccess = () => {
    setToken(localStorage.getItem('token') || '');
  };

  const handleLogout = () => {
    const currentToken = localStorage.getItem('token');
    if (currentToken) {
      // Fire-and-forget: this is purely an audit entry (JWTs are stateless
      // here, nothing server-side to invalidate), so it must never block
      // actually logging the user out.
      fetch(`${API_ROOT}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}` },
      }).catch(() => {});
    }
    localStorage.removeItem('token');
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
