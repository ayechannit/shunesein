import React, { useState } from 'react';
import '../styles/Login.css';
import { API_ROOT } from '../config/api';
import brandMark2x from '../assets/brand/shunesein-mark@2x.png';
import { saveToken, clearToken, getRememberedUsername, setRememberedUsername } from '../utils/authStorage';

const Login = ({ onLoginSuccess }) => {
  // Pre-filled when the last sign-in on this device ticked "Remember me".
  const [username, setUsername] = useState(() => getRememberedUsername());
  const [remember, setRemember] = useState(() => Boolean(getRememberedUsername()));
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [showForgotHint, setShowForgotHint] = useState(false);

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
        body: JSON.stringify({ username, password, remember })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Login failed');
      }

      saveToken(data.token, remember);
      setRememberedUsername(username.trim(), remember);
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
              <img className="login-logo" src={brandMark2x} alt="" />
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
                clearToken();
              }}
            >
              <span className="btn-text">Sign out</span>
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
              <img className="login-logo" src={brandMark2x} alt="" />
            <h2>Shune Sein</h2>
            <p className="login-tagline">ရွှန်းစိန် လက်ဖက်နှင့်အကြော်စုံ</p>
            <p>Sign in to manage sales, stock and deliveries.</p>
          </div>

          <form className="login-form" onSubmit={handleLogin} autoComplete="on">
            {error && <div style={{ color: 'var(--login-error)', textAlign: 'center', fontSize: '14px', marginBottom: '10px' }}>{error}</div>}
            
            <div className={`input-group ${username ? 'has-val' : ''}`}>
              <input
                type="text"
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
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
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <label htmlFor="password">Password</label>
              <span className="focus-border"></span>
            </div>

            <div className="form-actions">
              <label className="checkbox-wrap">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <span className="checkmark"></span>
                Remember me
              </label>
              <button
                type="button"
                className="forgot-link"
                onClick={() => setShowForgotHint(true)}
              >
                Forgot password?
              </button>
            </div>

            {showForgotHint && (
              <p className="forgot-hint">
                Password resets aren't self-service yet — please contact your system administrator.
              </p>
            )}

            <button type="submit" className={`btn-login ${loading ? 'loading' : ''}`} disabled={loading}>
              <span className="btn-text">{loading ? 'Signing in…' : 'Sign in'}</span>
              <div className="btn-spinner"></div>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
