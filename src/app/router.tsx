import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '../features/auth/ProtectedRoute'
import { LoginPage } from '../features/auth/LoginPage'
import { PasswordPages } from '../features/auth/PasswordPages'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { UsersPage } from '../features/users/UsersPage'
import { AlertsPage } from '../features/alerts/AlertsPage'
import { TablesOperationsPage } from '../features/tables/TablesOperationsPage'
import { ReservationsQueryPage } from '../features/reservations/ReservationsQueryPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { AppShell } from '../components/AppShell'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/forgot-password" element={<PasswordPages mode="forgot" />} />
      <Route path="/auth/reset-password" element={<PasswordPages mode="reset" />} />
      <Route path="/auth/accept-invitation" element={<PasswordPages mode="invite" />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tables" element={<TablesOperationsPage />} />
          <Route path="/reservas" element={<ReservationsQueryPage />} />
          <Route path="/informes" element={<ReportsPage />} />
          <Route
            path="/alerts"
            element={
              <ProtectedRoute allowedRoles={['super_admin']}>
                <AlertsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute allowedRoles={['super_admin']}>
                <UsersPage />
              </ProtectedRoute>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}