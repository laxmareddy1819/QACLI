import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ShieldCheck } from 'lucide-react';

export function SetupPage() {
  const { setup, isSetupRequired, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect if setup is done
  if (!isSetupRequired && isAuthenticated) {
    navigate('/', { replace: true });
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('Username is required');
      return;
    }
    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await setup(username.trim(), displayName.trim(), password);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-surface-1 rounded-xl border border-white/5 p-8"
      >
        {/* Logo + Welcome */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xl">
            Q
          </div>
          <h1 className="mt-4 text-xl font-semibold text-gray-100">Welcome to qabot</h1>
          <p className="mt-1 text-sm text-gray-500 text-center">
            Create your admin account to get started
          </p>
        </div>

        {/* Info banner */}
        <div className="mb-6 p-3 bg-brand-500/10 border border-brand-500/20 rounded-lg flex items-start gap-2">
          <ShieldCheck size={16} className="text-brand-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-brand-300">
            This account will be the administrator. You can create more users after setup.
          </p>
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
            placeholder="e.g. admin"
            autoFocus
            autoComplete="username"
          />
        </div>

        {/* Display Name */}
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1.5">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-2 border border-white/10 rounded-lg text-gray-100 text-sm
                       focus:outline-none focus:border-brand-500/50 placeholder-gray-600"
            placeholder="e.g. Admin User"
            autoComplete="name"
          />
        </div>

        {/* Password */}
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-2 border border-white/10 rounded-lg text-gray-100 text-sm
                       focus:outline-none focus:border-brand-500/50 placeholder-gray-600"
            placeholder="Min. 6 characters"
            autoComplete="new-password"
          />
        </div>

        {/* Confirm Password */}
        <div className="mb-6">
          <label className="block text-xs text-gray-400 mb-1.5">Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-3 py-2.5 bg-surface-2 border border-white/10 rounded-lg text-gray-100 text-sm
                       focus:outline-none focus:border-brand-500/50 placeholder-gray-600"
            placeholder="Re-enter password"
            autoComplete="new-password"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-500
                     text-white text-sm font-medium rounded-lg transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
          ) : (
            <ShieldCheck size={16} />
          )}
          {loading ? 'Creating Account...' : 'Create Admin Account'}
        </button>
      </form>
    </div>
  );
}
