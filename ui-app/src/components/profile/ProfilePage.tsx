import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  authGetMe, authChangePassword, updateMyProfile,
  getMySessions, revokeMySession, revokeAllOtherSessions,
  getMyActivity,
  type SessionInfo, type AuditEntry,
} from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../shared/Toast';
import { Badge } from '../shared/Badge';
import { LoadingState } from '../shared/LoadingState';
import {
  User, Key, Monitor, Clock, Activity,
  Trash2, LogOut, Pencil, Check, X, Loader2,
  Eye, EyeOff, Globe, Smartphone, Sun, Moon,
  Shield, Calendar, MapPin,
} from 'lucide-react';
import { toggleTheme, getTheme } from '../../styles/theme';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseUserAgent(ua: string | null): { browser: string; os: string; isMobile: boolean } {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', isMobile: false };

  let browser = 'Unknown';
  if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari')) browser = 'Safari';

  let os = 'Unknown';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  return { browser, os, isMobile };
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

const ROLE_COLORS: Record<string, 'brand' | 'green' | 'gray'> = {
  admin: 'brand',
  tester: 'green',
  viewer: 'gray',
};

const AVATAR_COLORS: Record<string, string> = {
  admin: 'bg-brand-500/20 text-brand-300 ring-brand-500/30',
  tester: 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/30',
  viewer: 'bg-gray-500/20 text-gray-300 ring-gray-500/30',
};

const ACTION_COLORS: Record<string, string> = {
  'auth.': 'text-amber-400',
  'user.': 'text-brand-400',
  'run.': 'text-emerald-400',
  'file.': 'text-sky-400',
  'git.': 'text-orange-400',
  'ai.': 'text-purple-400',
  'settings.': 'text-gray-400',
  'recorder.': 'text-pink-400',
  'cicd.': 'text-teal-400',
};

function getActionColor(action: string): string {
  for (const [prefix, color] of Object.entries(ACTION_COLORS)) {
    if (action.startsWith(prefix)) return color;
  }
  return 'text-gray-400';
}

function formatAction(action: string): string {
  return action.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── ProfilePage ──────────────────────────────────────────────────────────────

export function ProfilePage() {
  const { user, refreshStatus } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Profile data
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: authGetMe,
  });

  // Sessions
  const { data: sessionsData } = useQuery({
    queryKey: ['my-sessions'],
    queryFn: getMySessions,
  });

  // Activity
  const { data: activityData } = useQuery({
    queryKey: ['my-activity'],
    queryFn: () => getMyActivity(20),
  });

  if (profileLoading) return <LoadingState text="Loading profile..." />;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
        {/* Page Header */}
        <div className="flex items-center gap-3">
          <User size={24} className="text-brand-400" />
          <h1 className="text-2xl font-bold text-gray-100">Profile</h1>
        </div>

        {/* Section 1: Profile Overview */}
        <ProfileOverview
          profile={profile!}
          userRole={user?.role || 'viewer'}
          onUpdate={async (displayName) => {
            await updateMyProfile({ displayName });
            queryClient.invalidateQueries({ queryKey: ['profile'] });
            refreshStatus();
          }}
          toast={toast}
        />

        {/* Section 2: Change Password */}
        <ChangePasswordSection toast={toast} />

        {/* Section 3: Active Sessions */}
        <SessionsSection
          sessions={sessionsData?.sessions || []}
          queryClient={queryClient}
          toast={toast}
        />

        {/* Section 4: Recent Activity */}
        <ActivitySection entries={activityData?.entries || []} />

        {/* Section 5: Preferences */}
        <PreferencesSection />
      </div>
    </div>
  );
}

// ── Section 1: Profile Overview ──────────────────────────────────────────────

function ProfileOverview({
  profile,
  userRole,
  onUpdate,
  toast,
}: {
  profile: { id: string; username: string; displayName: string; role: string; createdAt: string; lastLoginAt: string | null };
  userRole: string;
  onUpdate: (displayName: string) => Promise<void>;
  toast: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(profile.displayName);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await onUpdate(editName.trim());
      toast('success', 'Display name updated');
      setEditing(false);
    } catch (err: any) {
      toast('error', err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const initial = (profile.displayName || profile.username).charAt(0).toUpperCase();
  const avatarClass = AVATAR_COLORS[userRole] || AVATAR_COLORS.viewer;

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <div className="flex items-start gap-5">
        {/* Avatar */}
        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold ring-2 shrink-0 ${avatarClass}`}>
          {initial}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Display Name */}
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="bg-surface-2 border border-white/10 rounded px-2 py-1 text-lg font-semibold text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
                />
                <button onClick={handleSave} disabled={saving} className="p-1 text-emerald-400 hover:text-emerald-300">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                </button>
                <button onClick={() => { setEditing(false); setEditName(profile.displayName); }} className="p-1 text-gray-400 hover:text-gray-300">
                  <X size={16} />
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-gray-100 truncate">{profile.displayName}</h2>
                <button onClick={() => { setEditName(profile.displayName); setEditing(true); }} className="p-1 text-gray-500 hover:text-gray-300">
                  <Pencil size={14} />
                </button>
              </>
            )}
          </div>

          {/* Username + Role */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">@{profile.username}</span>
            <Badge label={profile.role} color={ROLE_COLORS[profile.role] || 'gray'} />
          </div>

          {/* Dates */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Calendar size={12} /> Joined {formatDate(profile.createdAt)}</span>
            <span className="flex items-center gap-1"><Clock size={12} /> Last login {formatDate(profile.lastLoginAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section 2: Change Password ───────────────────────────────────────────────

function ChangePasswordSection({ toast }: { toast: (type: 'success' | 'error' | 'info', message: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => authChangePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast('success', 'Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to change password');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All fields are required');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    mutation.mutate();
  };

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5 space-y-4">
      <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2">
        <Key size={16} />
        Change Password
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3 max-w-md">
        {/* Current Password */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Current Password</label>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-100 pr-10 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Enter current password"
            />
            <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* New Password */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">New Password</label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-100 pr-10 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="At least 6 characters"
            />
            <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Confirm New Password</label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-100 pr-10 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Re-enter new password"
            />
            <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium rounded-xl transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
          Update Password
        </button>
      </form>
    </div>
  );
}

// ── Section 3: Active Sessions ───────────────────────────────────────────────

function SessionsSection({
  sessions,
  queryClient,
  toast,
}: {
  sessions: SessionInfo[];
  queryClient: ReturnType<typeof useQueryClient>;
  toast: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const revokeMutation = useMutation({
    mutationFn: revokeMySession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-sessions'] });
      toast('success', 'Session revoked');
    },
    onError: (err: Error) => toast('error', err.message),
  });

  const revokeAllMutation = useMutation({
    mutationFn: revokeAllOtherSessions,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['my-sessions'] });
      toast('success', `${data.sessionsRevoked} session(s) revoked`);
    },
    onError: (err: Error) => toast('error', err.message),
  });

  const otherSessions = sessions.filter(s => !s.isCurrent);

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2">
          <Monitor size={16} />
          Active Sessions
          <span className="text-xs text-gray-500 font-normal">({sessions.length})</span>
        </h2>
        {otherSessions.length > 0 && (
          <button
            onClick={() => revokeAllMutation.mutate()}
            disabled={revokeAllMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded transition-colors"
          >
            {revokeAllMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
            Revoke All Others
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No active sessions</p>
      ) : (
        <div className="space-y-2">
          {sessions.map(session => {
            const { browser, os, isMobile } = parseUserAgent(session.userAgent);
            return (
              <div key={session.id} className="flex items-center gap-3 p-3 bg-surface-2 rounded-lg border border-white/5">
                {isMobile ? (
                  <Smartphone size={18} className="text-gray-400 shrink-0" />
                ) : (
                  <Monitor size={18} className="text-gray-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-200 font-medium">{browser} on {os}</span>
                    {session.isCurrent && <Badge label="Current" color="green" />}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    {session.ipAddress && (
                      <span className="flex items-center gap-1"><MapPin size={10} /> {session.ipAddress}</span>
                    )}
                    <span className="flex items-center gap-1"><Clock size={10} /> {formatRelative(session.createdAt)}</span>
                    <span>Expires {formatDate(session.expiresAt)}</span>
                  </div>
                </div>
                {!session.isCurrent && (
                  <button
                    onClick={() => revokeMutation.mutate(session.id)}
                    disabled={revokeMutation.isPending}
                    className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
                    title="Revoke session"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Section 4: Recent Activity ───────────────────────────────────────────────

function ActivitySection({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5 space-y-4">
      <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2">
        <Activity size={16} />
        Recent Activity
      </h2>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No recent activity</p>
      ) : (
        <div className="space-y-1">
          {entries.map(entry => (
            <div key={entry.id} className="flex items-center gap-3 py-2 px-3 rounded hover:bg-surface-2 transition-colors">
              <Activity size={14} className={`shrink-0 ${getActionColor(entry.action)}`} />
              <span className="text-sm text-gray-300 flex-1 truncate">{formatAction(entry.action)}</span>
              {entry.resourceId && (
                <span className="text-xs text-gray-500 truncate max-w-[200px]">{entry.resourceId}</span>
              )}
              <span className="text-xs text-gray-500 shrink-0">{formatRelative(entry.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section 5: Preferences ───────────────────────────────────────────────────

function PreferencesSection() {
  const [theme, setTheme] = useState(getTheme());

  const handleToggleTheme = () => {
    toggleTheme();
    setTheme(getTheme());
  };

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5 space-y-4">
      <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2">
        <Globe size={16} />
        Preferences
      </h2>

      {/* Theme Toggle */}
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm text-gray-200">Theme</p>
          <p className="text-xs text-gray-500">Switch between dark and light mode</p>
        </div>
        <button
          onClick={handleToggleTheme}
          className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border border-white/10 rounded text-sm text-gray-300 hover:text-gray-100 transition-colors"
        >
          {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
          {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </div>

      {/* Future Preferences */}
      <div className="border-t border-white/5 pt-3 space-y-3 opacity-50">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Coming Soon</p>
        <div className="flex items-center justify-between py-1">
          <p className="text-sm text-gray-400">Default headless mode</p>
          <span className="text-xs text-gray-600 bg-surface-2 px-2 py-0.5 rounded">Off</span>
        </div>
        <div className="flex items-center justify-between py-1">
          <p className="text-sm text-gray-400">Notification on run complete</p>
          <span className="text-xs text-gray-600 bg-surface-2 px-2 py-0.5 rounded">Off</span>
        </div>
      </div>
    </div>
  );
}
