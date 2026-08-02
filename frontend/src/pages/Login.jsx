import React, { useState } from 'react';
import '../styles/Login.css';
import { API_ROOT } from '../config/api';

const Login = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loggedInUser, setLoggedInUser] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch(`${API_ROOT}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Login failed');
      }

      // Save token (e.g., to localStorage) if needed in real app
      localStorage.setItem('token', data.token);
      if (onLoginSuccess) onLoginSuccess(data);
      
      // Show user information
      setLoggedInUser(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loggedInUser) {
    return (
      <div className="login-wrapper">
        <div className="bg-shape shape-1"></div>
        <div className="bg-shape shape-2"></div>
        <div className="bg-shape shape-3"></div>

        <div className="login-container">
          <div className="login-card" style={{ textAlign: 'center' }}>
            <div className="login-header">
              <h2>Welcome, {loggedInUser.full_name}!</h2>
              <p>You have successfully logged in.</p>
            </div>
            
            <div style={{ color: 'var(--login-text)', margin: '20px 0', fontSize: '16px', lineHeight: '1.6' }}>
              <div><strong>Username:</strong> {loggedInUser.username}</div>
              <div><strong>Role:</strong> {loggedInUser.role_name}</div>
            </div>
            
            <button 
              className="btn-login"
              onClick={() => {
                setLoggedInUser(null);
                setUsername('');
                setPassword('');
                localStorage.removeItem('token');
              }}
            >
              <span className="btn-text">Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrapper">
      {/* Animated background elements */}
      <div className="bg-shape shape-1"></div>
      <div className="bg-shape shape-2"></div>
      <div className="bg-shape shape-3"></div>

      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <h2>Welcome Back</h2>
            <p>Tea Leaf & Fried Bean Manufacturing System</p>
          </div>

          <form className="login-form" onSubmit={handleLogin}>
            {error && <div style={{ color: '#ff3b8f', textAlign: 'center', fontSize: '14px', marginBottom: '10px' }}>{error}</div>}
            
            <div className={`input-group ${username ? 'has-val' : ''}`}>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <label htmlFor="username">Username</label>
              <span className="focus-border"></span>
            </div>

            <div className={`input-group ${password ? 'has-val' : ''}`}>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <label htmlFor="password">Password</label>
              <span className="focus-border"></span>
            </div>

            <div className="form-actions">
              <label className="checkbox-wrap">
                <input type="checkbox" />
                <span className="checkmark"></span>
                Remember me
              </label>
              <a href="#" className="forgot-link">Forgot Password?</a>
            </div>

            <button type="submit" className={`btn-login ${loading ? 'loading' : ''}`} disabled={loading}>
              <span className="btn-text">{loading ? 'Authenticating...' : 'Sign In'}</span>
              <div className="btn-spinner"></div>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
