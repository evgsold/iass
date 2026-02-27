import React, { useState, useContext, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { Github } from 'lucide-react';
import api from '../api';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, setToken } = useContext(AuthContext); // Assuming setToken is exposed or login handles it
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (token) {
        // Manually set token if returned from OAuth redirect
        localStorage.setItem('token', token);
        // We might need to update context state here if login() doesn't expose a direct setter
        // Ideally AuthContext should listen to storage or have a method
        window.location.href = '/'; // Force reload to pick up token in context
    }

    if (error) {
        toast.error('Authentication failed');
    }
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(email, password);
      toast.success('Login successful');
      navigate('/');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Login failed');
    }
  };

  const handleGithubLogin = async () => {
      try {
          const response = await api.get('/auth/github');
          window.location.href = response.data.url;
      } catch (error) {
          toast.error('Failed to initiate GitHub login');
      }
  };

  return (
    <div className="auth-container">
      <div className="auth-form-card">
        <h2 className="auth-title">Login</h2>
        
        <button 
            type="button" 
            onClick={handleGithubLogin}
            className="btn-github"
            style={{ 
                width: '100%', 
                marginBottom: '20px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '10px',
                backgroundColor: '#24292e',
                color: 'white',
                padding: '10px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 'bold'
            }}
        >
            <Github size={20} /> Login with GitHub
        </button>

        <div style={{ textAlign: 'center', marginBottom: '20px', color: '#666' }}>OR</div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-primary"
          >
            Login
          </button>
        </form>
        <p className="text-link">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
