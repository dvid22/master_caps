import { Navigate, Route, Routes } from "react-router-dom";

import AuthGuard from "./components/layout/AuthGuard";
import RoleGuard from "./components/layout/RoleGuard";
import AdminLayout from "./components/layout/AdminLayout";

import LoginPage from "./pages/auth/LoginPage";
import DashboardPage from "./pages/admin/DashboardPage";
import InventoryPage from "./pages/admin/InventoryPage";
import SalesPage from "./pages/admin/SalesPage";
import ReservationsPage from "./pages/admin/ReservationsPage";
import UsersPage from "./pages/admin/UsersPage";

import CatalogPage from "./pages/public/CatalogPage";
import ReserveProductPage from "./pages/public/ReserveProductPage";
import ReservationCheckoutPage from "./pages/public/ReservationCheckoutPage";

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

        <Route
          path="dashboard"
          element={
            <RoleGuard allowedRoles={["admin"]}>
              <DashboardPage />
            </RoleGuard>
          }
        />

        <Route
          path="inventario"
          element={
            <RoleGuard allowedRoles={["admin", "seller"]}>
              <InventoryPage />
            </RoleGuard>
          }
        />

        <Route
          path="ventas"
          element={
            <RoleGuard allowedRoles={["admin", "seller"]}>
              <SalesPage />
            </RoleGuard>
          }
        />

        <Route
          path="apartados"
          element={
            <RoleGuard allowedRoles={["admin", "seller"]}>
              <ReservationsPage />
            </RoleGuard>
          }
        />

        <Route
          path="usuarios"
          element={
            <RoleGuard allowedRoles={["admin"]}>
              <UsersPage />
            </RoleGuard>
          }
        />
      </Route>

      <Route path="/catalogo/:storeId" element={<CatalogPage />} />

      <Route
        path="/catalogo/:storeId/apartar/:productId"
        element={<ReserveProductPage />}
      />

      <Route
        path="/catalogo/:storeId/checkout"
        element={<ReservationCheckoutPage />}
      />

      <Route path="*" element={<Navigate to="/admin/inventario" replace />} />
    </Routes>
  );
}