import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth'
import { Layout, ProtectedRoute } from './components'
import { AuthPage } from './pages/AuthPage'
import { CaseDetail } from './pages/CaseDetail'
import { NewCase } from './pages/NewCase'
import { ResidentDashboard } from './pages/ResidentDashboard'
import { StaffDashboard } from './pages/StaffDashboard'

export function App() {
  return (
    <BrowserRouter><AuthProvider><Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route element={<ProtectedRoute />}><Route element={<Layout />}>
        <Route element={<ProtectedRoute role="resident" />}>
          <Route index element={<ResidentDashboard />} />
          <Route path="new" element={<NewCase />} />
        </Route>
        <Route element={<ProtectedRoute role="staff" />}><Route path="staff" element={<StaffDashboard />} /></Route>
        <Route path="cases/:id" element={<CaseDetail />} />
      </Route></Route>
      <Route path="*" element={<ProtectedRoute />} />
    </Routes></AuthProvider></BrowserRouter>
  )
}
