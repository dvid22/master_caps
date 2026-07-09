import { Navigate, Route, Routes } from "react-router-dom";

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

      <Route path="/admin" element={<Navigate to="/admin/inventario" replace />} />
      <Route path="/admin/dashboard" element={<DashboardPage />} />
      <Route path="/admin/inventario" element={<InventoryPage />} />
      <Route path="/admin/ventas" element={<SalesPage />} />
      <Route path="/admin/apartados" element={<ReservationsPage />} />

      <Route path="/catalogo/:storeId" element={<CatalogPage />} />
      <Route path="/catalogo/:storeId/apartar/:productId" element={<ReserveProductPage />} />
    </Routes>
  );
}