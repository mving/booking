import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Navbar } from "@/components/layout/Navbar";
import { HomeDashboard } from "@/pages/HomeDashboard";
import { RegisterBuilding } from "@/pages/RegisterBuilding";
import { Login } from "@/pages/Login";
import { AuthCallback } from "@/pages/AuthCallback";
import { SecurityView } from "@/pages/SecurityView";
import { BuildingAdmin } from "@/pages/BuildingAdmin";
import { GlobalAdmin } from "@/pages/GlobalAdmin";

function MainRouteGuard({ children }) {
  const { loading, meData, activeProfile, activeBuilding } = useAuth();
  if (loading) {
    return (
      <div className="container py-16 text-center text-sm text-muted-foreground">
        Cargando sesión...
      </div>
    );
  }
  if (!meData?.authenticated) {
    return <Navigate to="/login" replace />;
  }
  if (meData.is_global_admin && !activeBuilding) {
    return <Navigate to="/admin-global" replace />;
  }
  if (activeProfile?.role === "security") {
    return <Navigate to="/seguridad" replace />;
  }
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col bg-slate-50/60">
          <Navbar />
          <main className="flex-1">
            <Routes>
              <Route
                path="/"
                element={
                  <MainRouteGuard>
                    <HomeDashboard />
                  </MainRouteGuard>
                }
              />
              <Route path="/registro/:slug" element={<RegisterBuilding />} />
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/seguridad" element={<SecurityView />} />
              <Route path="/admin-edificio" element={<BuildingAdmin />} />
              <Route path="/admin-global" element={<GlobalAdmin />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;

