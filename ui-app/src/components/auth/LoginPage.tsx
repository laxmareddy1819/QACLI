import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { LogIn } from 'lucide-react';

export function LoginPage() {
  const { login, isSetupRequired, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect if already authenticated or setup required
  if (isSetupRequired) {
    navigate('/setup', { replace: true });
    return null;
  }
  if (isAuthenticated) {
    navigate('/', { replace: true });
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-surface-1 rounded-xl border border-white/5 p-8"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xl">
            Q
          </div>
          <h1 className="mt-4 text-xl font-semibold text-gray-100">Sign in to qabot</h1>
          <p className="mt-1 text-sm text-gray-500">Test automation dashboard</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Username */}
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1.5">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-2 border border-white/10 rounded-lg text-gray-100 text-sm
                       focus:outline-none focus:border-brand-500/50 placeholder-gray-600"
            placeholder="Enter username"
            autoFocus
            autoComplete="username"
          />
        </div>

        {/* Password */}
        <div className="mb-6">
          <label className="block text-xs text-gray-400 mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-2 border border-white/10 rounded-lg text-gray-100 text-sm
                       focus:outline-none focus:border-brand-500/50 placeholder-gray-600"
            placeholder="Enter password"
            autoComplete="current-password"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !username.trim() || !password}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-500
                     text-white text-sm font-medium rounded-lg transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
          ) : (
            <LogIn size={16} />
          )}
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
