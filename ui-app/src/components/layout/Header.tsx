import { Sun, Moon, RefreshCw, Wifi, WifiOff, Search, LogOut, User, ChevronDown } from 'lucide-react';
import { Badge } from '../shared/Badge';
import { toggleTheme, getTheme } from '../../styles/theme';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  framework: string;
  language: string;
  connected: boolean;
  onRescan: () => void;
  onSearchOpen: () => void;
}

export function Header({ framework, language, connected, onRescan, onSearchOpen }: HeaderProps) {
  const [theme, setTheme] = useState(getTheme);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleTheme = () => {
    toggleTheme();
    setTheme(getTheme());
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const initial = user?.displayName?.charAt(0)?.toUpperCase() || user?.username?.charAt(0)?.toUpperCase() || '?';

  return (
    <header className="h-12 bg-surface-1 border-b border-white/5 flex items-center px-4 gap-3 flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-xs">
          Q
        </div>
        <span className="font-semibold text-gray-100 text-sm">qabot</span>
      </div>

      {/* Framework badges */}
      <div className="flex items-center gap-2 ml-3">
        {framework && <Badge label={framework} color="brand" />}
        {language && <Badge label={language} color="blue" />}
      </div>

      <div className="flex-1" />

      {/* Search trigger */}
      <button
        onClick={onSearchOpen}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-gray-400 text-xs border border-white/5"
      >
        <Search size={14} />
        <span>Search</span>
        <kbd className="ml-2 px-1.5 py-0.5 rounded bg-surface-3 text-[10px] font-mono">Ctrl+K</kbd>
      </button>

      {/* Connection status */}
      <div className={`flex items-center gap-1.5 text-xs ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
        {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
        <span className="hidden sm:inline">{connected ? 'Live' : 'Offline'}</span>
      </div>

      {/* Rescan */}
      <button
        onClick={onRescan}
        className="p-1.5 rounded-lg hover:bg-surface-2 text-gray-400 hover:text-gray-200"
        title="Rescan project"
      >
        <RefreshCw size={16} />
      </button>

      {/* Theme toggle */}
      <button
        onClick={handleTheme}
        className="p-1.5 rounded-lg hover:bg-surface-2 text-gray-400 hover:text-gray-200"
        title="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      {/* User avatar + menu */}
      {user && (
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-300 text-[11px] font-semibold">
              {initial}
            </div>
            <span className="text-xs text-gray-300 hidden sm:inline max-w-[80px] truncate">
              {user.username}
            </span>
            <ChevronDown size={12} className={`text-gray-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-surface-1 border border-white/10 rounded-lg z-50 py-1">
              {/* User info */}
              <div className="px-3 py-2 border-b border-white/5">
                <p className="text-sm font-medium text-gray-200">{user.displayName}</p>
                <p className="text-xs text-gray-500">@{user.username}</p>
                <Badge label={user.role} color={user.role === 'admin' ? 'brand' : user.role === 'tester' ? 'green' : 'gray'} />
              </div>

              {/* Menu items */}
              <button
                onClick={() => { setMenuOpen(false); navigate('/profile'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-surface-2 hover:text-gray-100"
              >
                <User size={14} />
                Profile
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
