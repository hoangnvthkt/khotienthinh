
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Lock, User as UserIcon, AlertCircle, Info, Eye, EyeOff, Zap } from 'lucide-react';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showForgotMsg, setShowForgotMsg] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const loggedUser = await login(username, password);
      if (loggedUser) {
        navigate('/');
      } else {
        setError('Tên đăng nhập hoặc mật khẩu không chính xác.');
      }
    } catch (err: any) {
      setError(err.message || 'Thông tin đăng nhập không hợp lệ hoặc lỗi kết nối.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Animated background */}
      <div className="login-bg">
        <div className="login-bg-orb login-bg-orb--1" />
        <div className="login-bg-orb login-bg-orb--2" />
        <div className="login-bg-orb login-bg-orb--3" />
        <div className="login-bg-grid" />
      </div>

      {/* Login card */}
      <div className={`login-card ${mounted ? 'login-card--visible' : ''}`}>
        {/* Brand header */}
        <div className="login-brand">
          <div className="login-logo">
            <div className="login-logo-icon">
              <Zap size={28} strokeWidth={2.5} />
            </div>
            <div className="login-logo-glow" />
          </div>
          <h1 className="login-title">VIOO</h1>
          <p className="login-subtitle">Phần mềm quản lý doanh nghiệp</p>
        </div>

        {/* Separator */}
        <div className="login-separator">
          <div className="login-separator-line" />
          <span className="login-separator-text">Đăng nhập</span>
          <div className="login-separator-line" />
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="login-form">
          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              <p>{error}</p>
            </div>
          )}

          <div className="login-field">
            <label className="login-label">Tên đăng nhập</label>
            <div className="login-input-wrapper">
              <UserIcon className="login-input-icon" size={18} />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="login-input"
                placeholder="Nhập tên đăng nhập..."
                autoComplete="username"
              />
            </div>
          </div>

          <div className="login-field">
            <label className="login-label">Mật khẩu</label>
            <div className="login-input-wrapper">
              <Lock className="login-input-icon" size={18} />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input login-input--password"
                placeholder="••••••••"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="login-password-toggle"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="login-options">
            <label className="login-remember">
              <input type="checkbox" />
              <span>Ghi nhớ đăng nhập</span>
            </label>
            <button
              type="button"
              onClick={() => setShowForgotMsg(true)}
              className="login-forgot"
            >
              Quên mật khẩu?
            </button>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={`login-submit ${isLoading ? 'login-submit--loading' : ''}`}
          >
            {isLoading ? (
              <div className="login-spinner" />
            ) : (
              <>
                <span>Đăng nhập</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </form>

        {showForgotMsg && (
          <div className="login-forgot-msg">
            <Info size={16} />
            <div>
              <p className="login-forgot-title">Hỗ trợ khôi phục mật khẩu</p>
              <p className="login-forgot-desc">Vui lòng liên hệ Quản trị viên (Admin) để được cấp lại mật khẩu mới.</p>
              <button onClick={() => setShowForgotMsg(false)} className="login-forgot-dismiss">
                Đã hiểu
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="login-footer">
          <p>© 2024 Vioo. Phần mềm quản lý doanh nghiệp</p>
        </div>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          position: relative;
          overflow: hidden;
          background: #0a0a1a;
        }

        /* === Animated Background === */
        .login-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
        }

        .login-bg-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.4;
          animation: orbFloat 12s ease-in-out infinite;
        }

        .login-bg-orb--1 {
          width: 400px;
          height: 400px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          top: -10%;
          left: -5%;
          animation-delay: 0s;
        }

        .login-bg-orb--2 {
          width: 350px;
          height: 350px;
          background: linear-gradient(135deg, #06b6d4, #3b82f6);
          bottom: -10%;
          right: -5%;
          animation-delay: -4s;
        }

        .login-bg-orb--3 {
          width: 250px;
          height: 250px;
          background: linear-gradient(135deg, #ec4899, #f43f5e);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          opacity: 0.15;
          animation-delay: -8s;
        }

        @keyframes orbFloat {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -30px) scale(1.05); }
          66% { transform: translate(-20px, 20px) scale(0.95); }
        }

        .login-bg-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
          background-size: 60px 60px;
        }

        /* === Login Card === */
        .login-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 420px;
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(40px);
          -webkit-backdrop-filter: blur(40px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 24px;
          padding: 2.5rem;
          opacity: 0;
          transform: translateY(20px) scale(0.98);
          transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .login-card--visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }

        /* === Brand === */
        .login-brand {
          text-align: center;
          margin-bottom: 1.75rem;
        }

        .login-logo {
          position: relative;
          display: inline-flex;
          margin-bottom: 1rem;
        }

        .login-logo-icon {
          width: 56px;
          height: 56px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6, #a78bfa);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          position: relative;
          z-index: 1;
          box-shadow: 0 8px 32px rgba(99, 102, 241, 0.4);
        }

        .login-logo-glow {
          position: absolute;
          inset: -4px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6, #a78bfa);
          border-radius: 20px;
          opacity: 0.3;
          filter: blur(12px);
          animation: logoPulse 3s ease-in-out infinite;
        }

        @keyframes logoPulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }

        .login-title {
          font-size: 1.75rem;
          font-weight: 900;
          color: white;
          letter-spacing: 0.15em;
          margin: 0;
        }

        .login-subtitle {
          font-size: 0.7rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.4);
          text-transform: uppercase;
          letter-spacing: 0.2em;
          margin-top: 4px;
        }

        /* === Separator === */
        .login-separator {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 1.5rem;
        }

        .login-separator-line {
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
        }

        .login-separator-text {
          font-size: 0.65rem;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.35);
          text-transform: uppercase;
          letter-spacing: 0.15em;
          white-space: nowrap;
        }

        /* === Form === */
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .login-error {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 12px;
          color: #fca5a5;
          font-size: 0.78rem;
          font-weight: 600;
          animation: shakeX 0.5s ease;
        }

        @keyframes shakeX {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }

        .login-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .login-label {
          font-size: 0.68rem;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.5);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          padding-left: 2px;
        }

        .login-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .login-input-icon {
          position: absolute;
          left: 14px;
          color: rgba(255, 255, 255, 0.3);
          pointer-events: none;
          transition: color 0.2s;
        }

        .login-input {
          width: 100%;
          padding: 12px 16px 12px 44px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          color: white;
          font-size: 0.9rem;
          font-weight: 500;
          outline: none;
          transition: all 0.25s ease;
        }

        .login-input--password {
          padding-right: 44px;
        }

        .login-input::placeholder {
          color: rgba(255, 255, 255, 0.2);
        }

        .login-input:focus {
          border-color: rgba(99, 102, 241, 0.5);
          background: rgba(255, 255, 255, 0.08);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }

        .login-input:focus ~ .login-input-icon,
        .login-input-wrapper:focus-within .login-input-icon {
          color: rgba(99, 102, 241, 0.8);
        }

        .login-password-toggle {
          position: absolute;
          right: 14px;
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.3);
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s;
        }

        .login-password-toggle:hover {
          color: rgba(255, 255, 255, 0.6);
        }

        /* === Options === */
        .login-options {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .login-remember {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }

        .login-remember input[type="checkbox"] {
          width: 16px;
          height: 16px;
          border-radius: 5px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.06);
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }

        .login-remember input[type="checkbox"]:checked {
          background: #6366f1;
          border-color: #6366f1;
        }

        .login-remember input[type="checkbox"]:checked::after {
          content: '';
          position: absolute;
          left: 4.5px;
          top: 1.5px;
          width: 5px;
          height: 9px;
          border: solid white;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }

        .login-remember span {
          font-size: 0.75rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.45);
        }

        .login-forgot {
          background: none;
          border: none;
          font-size: 0.75rem;
          font-weight: 600;
          color: #818cf8;
          cursor: pointer;
          transition: color 0.2s;
        }

        .login-forgot:hover {
          color: #a5b4fc;
        }

        /* === Submit Button === */
        .login-submit {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border: none;
          border-radius: 14px;
          color: white;
          font-size: 0.9rem;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
          margin-top: 0.25rem;
        }

        .login-submit::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, #818cf8, #a78bfa);
          opacity: 0;
          transition: opacity 0.3s;
        }

        .login-submit:hover::before {
          opacity: 1;
        }

        .login-submit:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 32px rgba(99, 102, 241, 0.4);
        }

        .login-submit:active {
          transform: translateY(0) scale(0.98);
        }

        .login-submit span,
        .login-submit svg {
          position: relative;
          z-index: 1;
        }

        .login-submit--loading {
          pointer-events: none;
          opacity: 0.7;
        }

        .login-spinner {
          width: 22px;
          height: 22px;
          border: 2.5px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* === Forgot Message === */
        .login-forgot-msg {
          display: flex;
          gap: 10px;
          padding: 14px 16px;
          margin-top: 1.25rem;
          background: rgba(99, 102, 241, 0.08);
          border: 1px solid rgba(99, 102, 241, 0.15);
          border-radius: 14px;
          color: #c7d2fe;
          font-size: 0.78rem;
          animation: fadeSlideIn 0.3s ease;
        }

        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .login-forgot-title {
          font-weight: 700;
          font-size: 0.78rem;
          margin: 0 0 4px;
        }

        .login-forgot-desc {
          font-size: 0.72rem;
          font-weight: 500;
          opacity: 0.7;
          margin: 0;
          line-height: 1.5;
        }

        .login-forgot-dismiss {
          background: none;
          border: none;
          font-size: 0.65rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #818cf8;
          cursor: pointer;
          margin-top: 8px;
          padding: 0;
          transition: opacity 0.2s;
        }

        .login-forgot-dismiss:hover {
          opacity: 0.7;
        }

        /* === Footer === */
        .login-footer {
          margin-top: 1.75rem;
          text-align: center;
        }

        .login-footer p {
          font-size: 0.62rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.2);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin: 0;
        }

        /* === Responsive === */
        @media (max-width: 480px) {
          .login-card {
            padding: 2rem 1.5rem;
            border-radius: 20px;
          }
          .login-bg-orb--1 { width: 250px; height: 250px; }
          .login-bg-orb--2 { width: 200px; height: 200px; }
        }
      `}</style>
    </div>
  );
};

export default Login;
