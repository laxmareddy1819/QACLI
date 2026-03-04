import { useState, useEffect, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Header } from './Header';
import { DynamicSidebar } from './DynamicSidebar';
import { ActiveRunBanner } from './ActiveRunBanner';
import { CommandPalette } from './CommandPalette';
import { useProject } from '../../hooks/useProject';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useActiveRuns } from '../../hooks/useActiveRuns';
import { rescanProject } from '../../api/client';
import type { WSMessage } from '../../api/types';

export function AppShell() {
  const { data: project, isLoading } = useProject();
  const { connected, subscribe, send } = useWebSocket();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const queryClient = useQueryClient();
  const activeRunsState = useActiveRuns(subscribe);

  // Ctrl+K to open command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Watch for file changes to auto-refresh project data
  // Watch for test-results to refresh Dashboard/Results immediately
  useEffect(() => {
    return subscribe((msg: WSMessage) => {
      if (msg.type === 'modules-updated') {
        queryClient.invalidateQueries({ queryKey: ['project'] });
        queryClient.invalidateQueries({ queryKey: ['fileTree'] });
        queryClient.invalidateQueries({ queryKey: ['moduleFiles'] });
      }
      // When a test run completes and results are parsed, refresh all
      // dashboard/results query caches so data appears immediately
      if (msg.type === 'test-results') {
        queryClient.invalidateQueries({ queryKey: ['test-trends'] });
        queryClient.invalidateQueries({ queryKey: ['top-failures'] });
        queryClient.invalidateQueries({ queryKey: ['flaky-tests'] });
        queryClient.invalidateQueries({ queryKey: ['slowest-tests'] });
        queryClient.invalidateQueries({ queryKey: ['result-runs'] });
        queryClient.invalidateQueries({ queryKey: ['result-run'] });
        queryClient.invalidateQueries({ queryKey: ['test-explorer'] });
        queryClient.invalidateQueries({ queryKey: ['runHistory'] });
      }
      // When healing events arrive via WebSocket, refresh healing caches
      if (msg.type === 'healing-event') {
        queryClient.invalidateQueries({ queryKey: ['healing-events'] });
        queryClient.invalidateQueries({ queryKey: ['healing-analytics'] });
        queryClient.invalidateQueries({ queryKey: ['healing-stats'] });
        queryClient.invalidateQueries({ queryKey: ['healing-fingerprints'] });
      }
    });
  }, [subscribe, queryClient]);

  const handleRescan = useCallback(async () => {
    await rescanProject();
    queryClient.invalidateQueries({ queryKey: ['project'] });
  }, [queryClient]);

  if (isLoading || !project) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-0">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-lg animate-pulse-soft">
            Q
          </div>
          <p className="text-sm text-gray-400">Loading project...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface-0">
      <Header
        framework={project.framework}
        language={project.language}
        connected={connected}
        onRescan={handleRescan}
        onSearchOpen={() => setCommandPaletteOpen(true)}
      />
      <ActiveRunBanner runs={activeRunsState.runs} />
      <div className="flex flex-1 overflow-hidden">
        <DynamicSidebar
          modules={project.modules}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
          hasActiveRun={activeRunsState.hasActiveRuns}
        />
        <main className="flex-1 overflow-y-auto">
          <Outlet context={{ project, connected, subscribe, send, activeRuns: activeRunsState.runs }} />
        </main>
      </div>
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        modules={project.modules}
      />
    </div>
  );
}
