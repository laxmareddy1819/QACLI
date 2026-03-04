import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUsers, createUser, updateUser, deleteUser, resetUserPassword, revokeUserSessions,
  type UserInfo,
} from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../shared/Toast';
import { Badge } from '../shared/Badge';
import {
  Users, Plus, Pencil, Trash2, KeyRound, LogOut, ShieldCheck,
  UserCheck, UserX, X,
} from 'lucide-react';

type ModalType = 'create' | 'edit' | 'reset-password' | null;

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin', description: 'Full access + user management' },
  { value: 'tester', label: 'Tester', description: 'Run tests, edit files, use tools' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only dashboard access' },
];

export function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: getUsers });
  const [modal, setModal] = useState<ModalType>(null);
  const [editTarget, setEditTarget] = useState<UserInfo | null>(null);

  // Form state
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'tester' });
  const [newPassword, setNewPassword] = useState('');

  const users = data?.users ?? [];
  const adminCount = users.filter(u => u.role === 'admin' && u.isActive).length;

  const createMutation = useMutation({
    mutationFn: () => createUser(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast('success', 'User created successfully');
      closeModal();
    },
    onError: (err: Error) => toast('error', err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; updates: Partial<{ displayName: string; role: string; isActive: boolean }> }) =>
      updateUser(data.id, data.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast('success', 'User updated');
      closeModal();
    },
    onError: (err: Error) => toast('error', err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast('success', 'User deleted');
    },
    onError: (err: Error) => toast('error', err.message),
  });

  const resetPwMutation = useMutation({
    mutationFn: () => resetUserPassword(editTarget!.id, newPassword),
    onSuccess: () => {
      toast('success', 'Password reset successfully');
      closeModal();
    },
    onError: (err: Error) => toast('error', err.message),
  });

  const revokeMutation = useMutation({
    mutationFn: revokeUserSessions,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast('success', `Revoked ${data.sessionsRevoked} session(s)`);
    },
    onError: (err: Error) => toast('error', err.message),
  });

  function openCreate() {
    setForm({ username: '', displayName: '', password: '', role: 'tester' });
    setModal('create');
  }

  function openEdit(user: UserInfo) {
    setEditTarget(user);
    setForm({ username: user.username, displayName: user.displayName, password: '', role: user.role });
    setModal('edit');
  }

  function openResetPassword(user: UserInfo) {
    setEditTarget(user);
    setNewPassword('');
    setModal('reset-password');
  }

  function closeModal() {
    setModal(null);
    setEditTarget(null);
  }

  function handleDelete(user: UserInfo) {
    if (!window.confirm(`Delete user "${user.username}"? This will deactivate their account.`)) return;
    deleteMutation.mutate(user.id);
  }

  function handleToggleActive(user: UserInfo) {
    updateMutation.mutate({ id: user.id, updates: { isActive: !user.isActive } });
  }

  const isLastAdmin = (u: UserInfo) => u.role === 'admin' && u.isActive && adminCount <= 1;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={24} className="text-brand-400" />
          <h1 className="text-2xl font-bold text-gray-100">User Management</h1>
          <Badge label={`${users.length} users`} color="gray" />
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium rounded-xl transition-colors"
        >
          <Plus size={14} />
          Add User
        </button>
      </div>

      {/* Users table */}
      {isLoading ? (
        <div className="text-sm text-gray-500">Loading users...</div>
      ) : (
        <div className="bg-surface-1 rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 text-sm text-gray-500">
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Last Login</th>
                <th className="text-left px-4 py-3 font-medium">Sessions</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-300 text-sm font-semibold">
                        {u.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm text-gray-200 font-medium">{u.displayName}</p>
                        <p className="text-xs text-gray-500">@{u.username}</p>
                      </div>
                      {u.id === currentUser?.id && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-brand-500/10 text-brand-400 rounded">you</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      label={u.role}
                      color={u.role === 'admin' ? 'brand' : u.role === 'tester' ? 'green' : 'gray'}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1.5 text-xs ${u.isActive ? 'text-emerald-400' : 'text-gray-500'}`}>
                      {u.isActive ? <UserCheck size={14} /> : <UserX size={14} />}
                      {u.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{u.sessions}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        className="p-1.5 rounded hover:bg-surface-2 text-gray-400 hover:text-gray-200"
                        title="Edit user"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => openResetPassword(u)}
                        className="p-1.5 rounded hover:bg-surface-2 text-gray-400 hover:text-gray-200"
                        title="Reset password"
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        onClick={() => revokeMutation.mutate(u.id)}
                        className="p-1.5 rounded hover:bg-surface-2 text-gray-400 hover:text-gray-200"
                        title="Revoke sessions"
                        disabled={u.sessions === 0}
                      >
                        <LogOut size={14} />
                      </button>
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={`p-1.5 rounded hover:bg-surface-2 ${u.isActive ? 'text-gray-400 hover:text-amber-400' : 'text-gray-400 hover:text-emerald-400'}`}
                        title={u.isActive ? 'Disable user' : 'Enable user'}
                        disabled={isLastAdmin(u)}
                      >
                        {u.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1.5 rounded hover:bg-surface-2 text-gray-400 hover:text-red-400"
                        title="Delete user"
                        disabled={u.id === currentUser?.id || isLastAdmin(u)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className="relative bg-surface-1 rounded-xl border border-white/10 p-6 w-full max-w-md animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-bold text-gray-100">
                {modal === 'create' ? 'Create User' : modal === 'edit' ? 'Edit User' : 'Reset Password'}
              </h3>
              <button onClick={closeModal} className="p-1 rounded hover:bg-surface-2 text-gray-400">
                <X size={18} />
              </button>
            </div>

            {/* Create / Edit form */}
            {(modal === 'create' || modal === 'edit') && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (modal === 'create') {
                    createMutation.mutate();
                  } else if (editTarget) {
                    updateMutation.mutate({
                      id: editTarget.id,
                      updates: { displayName: form.displayName, role: form.role },
                    });
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Username</label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    disabled={modal === 'edit'}
                    className="w-full px-3 py-2 bg-surface-2 border border-white/10 rounded-xl text-[15px] text-gray-100
                               focus:outline-none focus:border-brand-500/50 disabled:opacity-50"
                    placeholder="username"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Display Name</label>
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                    className="w-full px-3 py-2 bg-surface-2 border border-white/10 rounded-xl text-[15px] text-gray-100
                               focus:outline-none focus:border-brand-500/50"
                    placeholder="Display Name"
                  />
                </div>
                {modal === 'create' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Password</label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="w-full px-3 py-2 bg-surface-2 border border-white/10 rounded-lg text-sm text-gray-100
                                 focus:outline-none focus:border-brand-500/50"
                      placeholder="Min. 6 characters"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Role</label>
                  <div className="space-y-2">
                    {ROLE_OPTIONS.map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors
                          ${form.role === opt.value
                            ? 'border-brand-500/50 bg-brand-500/5'
                            : 'border-white/5 hover:border-white/10'
                          }`}
                      >
                        <input
                          type="radio"
                          name="role"
                          value={opt.value}
                          checked={form.role === opt.value}
                          onChange={() => setForm({ ...form, role: opt.value })}
                          className="accent-brand-500"
                        />
                        <div>
                          <span className="text-sm text-gray-200">{opt.label}</span>
                          <p className="text-xs text-gray-500">{opt.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 rounded-lg hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium rounded-xl
                               disabled:opacity-50 transition-colors"
                  >
                    <ShieldCheck size={14} />
                    {modal === 'create' ? 'Create' : 'Save'}
                  </button>
                </div>
              </form>
            )}

            {/* Reset password form */}
            {modal === 'reset-password' && editTarget && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  resetPwMutation.mutate();
                }}
                className="space-y-4"
              >
                <p className="text-sm text-gray-400">
                  Set a new password for <span className="text-gray-200 font-medium">{editTarget.username}</span>
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-2 border border-white/10 rounded-xl text-[15px] text-gray-100
                               focus:outline-none focus:border-brand-500/50"
                    placeholder="Min. 6 characters"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 rounded-lg hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resetPwMutation.isPending || newPassword.length < 6}
                    className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium rounded-xl
                               disabled:opacity-50 transition-colors"
                  >
                    <KeyRound size={14} />
                    Reset Password
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
