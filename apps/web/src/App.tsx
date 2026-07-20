import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { hasPermission, type Permission } from './api';
import { useAuth } from './auth';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Containers from './pages/Containers';
import ContainerDetail from './pages/ContainerDetail';
import Images from './pages/Images';
import Volumes from './pages/Volumes';
import Networks from './pages/Networks';
import Stacks from './pages/Stacks';
import StackEdit from './pages/StackEdit';
import Users from './pages/Users';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';

function CenteredSpin() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <Spin size="large" />
    </div>
  );
}

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <CenteredSpin />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { user } = useAuth();
  if (!hasPermission(user, permission)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/containers" element={<Containers />} />
        <Route path="/containers/:id" element={<ContainerDetail />} />
        <Route path="/images" element={<Images />} />
        <Route path="/volumes" element={<Volumes />} />
        <Route path="/networks" element={<Networks />} />
        <Route path="/stacks" element={<Stacks />} />
        <Route
          path="/stacks/new"
          element={
            <RequirePermission permission="manageStacks">
              <StackEdit />
            </RequirePermission>
          }
        />
        <Route path="/stacks/:name" element={<StackEdit />} />
        <Route
          path="/users"
          element={
            <AdminOnly>
              <Users />
            </AdminOnly>
          }
        />
        <Route
          path="/audit-log"
          element={
            <AdminOnly>
              <AuditLog />
            </AdminOnly>
          }
        />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
