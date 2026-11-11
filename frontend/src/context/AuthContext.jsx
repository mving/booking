import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  apiFetch,
  getStoredToken,
  setStoredToken,
  localDevLogin,
  isCognitoConfigured,
} from "@/api/client";

const AuthContext = createContext(null);

export const DEMO_ACCOUNTS = [
  {
    label: "Admin Global (Multi-Edificio)",
    email: "admin@edificio.com",
    badge: "Global Admin",
  },
  {
    label: "Admin Local (Torre Libertador)",
    email: "consorcio@libertador.com",
    badge: "Admin Edificio",
  },
  {
    label: "Propietario UF 4° B (Martín)",
    email: "propietario4b@gmail.com",
    badge: "Propietario UF",
  },
  {
    label: "Inquilino UF 4° B (Sofía)",
    email: "inquilino4b@gmail.com",
    badge: "Inquilino",
  },
  {
    label: "Vecino Deudor UF 5° C (Bloqueado)",
    email: "deudor5c@gmail.com",
    badge: "Bloqueado Expensas",
  },
  {
    label: "Seguridad / Guardia (Portería)",
    email: "seguridad@libertador.com",
    badge: "Seguridad (90d)",
  },
];

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [meData, setMeData] = useState(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState("");
  const [authError, setAuthError] = useState("");

  const refreshProfile = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setMeData(null);
      setLoading(false);
      return null;
    }

    try {
      setAuthError("");
      const data = await apiFetch("/me");
      setMeData(data);

      // Seleccionar edificio por defecto
      const firstBuildingProfile = (data.profiles || []).find(
        (p) => p.building_id && p.building_id !== "GLOBAL"
      );
      if (firstBuildingProfile) {
        setSelectedBuildingId((prev) => prev || firstBuildingProfile.building_id);
      } else if (data.buildings && data.buildings.length > 0) {
        setSelectedBuildingId((prev) => prev || data.buildings[0].building_id);
      }
      setLoading(false);
      return data;
    } catch (err) {
      setAuthError(err.message || "Error al verificar sesión");
      setMeData(null);
      setLoading(false);
      return null;
    }
  }, []);

  useEffect(() => {
    async function init() {
      const token = getStoredToken();
      if (!token && !isCognitoConfigured()) {
        // En desarrollo local iniciamos sesión automáticamente con el Propietario de la UF 4B para facilitar la vista inmediata
        try {
          await localDevLogin({ email: "propietario4b@gmail.com" });
        } catch {
          // ignore
        }
      }
      await refreshProfile();
    }
    init();
  }, [refreshProfile]);

  const switchDemoAccount = async (email) => {
    setLoading(true);
    setSelectedBuildingId("");
    try {
      await localDevLogin({ email });
      await refreshProfile();
    } catch (err) {
      setAuthError(err.message);
      setLoading(false);
    }
  };

  const logout = () => {
    setStoredToken("");
    setMeData(null);
    setSelectedBuildingId("");
  };

  // Perfil activo para el edificio seleccionado
  const activeProfile = React.useMemo(() => {
    if (!meData?.profiles) return null;
    const byBldg = meData.profiles.find(
      (p) => p.building_id === selectedBuildingId
    );
    return byBldg || meData.profiles[0] || null;
  }, [meData, selectedBuildingId]);

  const activeBuilding = React.useMemo(() => {
    if (activeProfile?.building) return activeProfile.building;
    if (meData?.buildings) {
      return (
        meData.buildings.find((b) => b.building_id === selectedBuildingId) ||
        meData.buildings[0] ||
        null
      );
    }
    return null;
  }, [activeProfile, meData, selectedBuildingId]);

  return (
    <AuthContext.Provider
      value={{
        loading,
        meData,
        authError,
        setAuthError,
        activeProfile,
        activeBuilding,
        selectedBuildingId,
        setSelectedBuildingId,
        refreshProfile,
        switchDemoAccount,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

