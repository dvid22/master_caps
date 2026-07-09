import { Navigate, Route, Routes } from "react-router-dom";

import AuthGuard from "./components/layout/AuthGuard";
import AdminLayout from "./components/layout/AdminLayout";

import LoginPage from "./pages/auth/LoginPage";
import DashboardPage from "./pages/admin/DashboardPage";
import InventoryPage from "./pages/admin/InventoryPage";
import SalesPage from "./pages/admin/SalesPage";
import ReservationsPage from "./pages/admin/ReservationsPage";
import CatalogPage from "./pages/public/CatalogPage";
import ReserveProductPage from "./pages/public/ReserveProductPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin/inventario" replace />} />

      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/admin"
        element={
          <AuthGuard>
            <AdminLayout />
          </AuthGuard>
        }
      >
        <Route index element={<Navigate to="/admin/inventario" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="inventario" element={<InventoryPage />} />
        <Route path="ventas" element={<SalesPage />} />
        <Route path="apartados" element={<ReservationsPage />} />
      </Route>

      <Route path="/catalogo/:storeId" element={<CatalogPage />} />
      <Route
        path="/catalogo/:storeId/apartar/:productId"
        element={<ReserveProductPage />}
      />

      <Route path="*" element={<Navigate to="/admin/inventario" replace />} />
    </Routes>
  );
}