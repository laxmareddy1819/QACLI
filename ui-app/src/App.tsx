import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './components/dashboard/Dashboard';
import { ModuleExplorer } from './components/explorer/ModuleExplorer';
import { ProjectExplorer } from './components/explorer/ProjectExplorer';
import { RunnerPanel } from './components/runner/RunnerPanel';
import { AIPanel } from './components/ai/AIPanel';
import { ResultsPage } from './components/results/ResultsPage';
import { HealingDashboard } from './components/healing/HealingDashboard';

import { TestExplorerPage } from './components/explorer/TestExplorerPage';
import { ToastProvider } from './components/shared/Toast';
import { SettingsPage } from './components/layout/SettingsPage';
import { CICDPanel } from './components/cicd/CICDPanel';
import { SchedulesPage } from './components/schedules/SchedulesPage';
import { APITestingPage } from './components/api-testing/APITestingPage';
import { GitPage } from './components/git/GitPage';
import { LoginPage } from './components/auth/LoginPage';
import { SetupPage } from './components/auth/SetupPage';
import { AuthGuard, RoleGuard } from './components/auth/AuthGuard';
import { UserManagementPage } from './components/admin/UserManagementPage';
import { AuditLogPage } from './components/admin/AuditLogPage';
import { ProfilePage } from './components/profile/ProfilePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

const router = createBrowserRouter([
  // Public routes (no auth needed)
  { path: 'login', element: <LoginPage /> },
  { path: 'setup', element: <SetupPage /> },

  // Protected routes
  {
    element: <AuthGuard><AppShell /></AuthGuard>,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'explorer', element: <ProjectExplorer /> },
      { path: 'module/:moduleId', element: <ModuleExplorer /> },
      { path: 'runner', element: <RunnerPanel /> },
      { path: 'tests', element: <TestExplorerPage /> },
      { path: 'results', element: <ResultsPage /> },
      { path: 'healing', element: <HealingDashboard /> },
      { path: 'api-testing', element: <APITestingPage /> },
      { path: 'cicd', element: <CICDPanel /> },
      { path: 'schedules', element: <SchedulesPage /> },
      { path: 'git', element: <GitPage /> },
      { path: 'ai', element: <AIPanel /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'profile', element: <ProfilePage /> },

      // Admin-only routes
      { path: 'users', element: <RoleGuard minRole="admin"><UserManagementPage /></RoleGuard> },
      { path: 'audit', element: <RoleGuard minRole="admin"><AuditLogPage /></RoleGuard> },
    ],
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
