import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  exchangeCognitoCodeForToken,
  getPendingRegistration,
  clearPendingRegistration,
  apiFetch,
} from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "@/components/ui/card";

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const [statusMsg, setStatusMsg] = useState(
    "Validando credenciales con AWS Cognito..."
  );

  useEffect(() => {
    async function processOAuth() {
      const code = searchParams.get("code");
      const errorDesc = searchParams.get("error_description");
      if (errorDesc) {
        setStatusMsg(`Error de autenticación: ${errorDesc}`);
        return;
      }

      if (!code) {
        navigate("/");
        return;
      }

      try {
        await exchangeCognitoCodeForToken(code);
        const pendingReg = getPendingRegistration();

        if (pendingReg && pendingReg.registration_token) {
          setStatusMsg("Vinculando tu cuenta con la Unidad Funcional del edificio...");
          await apiFetch("/auth/register-profile", {
            method: "POST",
            body: JSON.stringify({
              registration_token: pendingReg.registration_token,
              first_name: pendingReg.first_name,
              last_name: pendingReg.last_name,
              unit_number: pendingReg.unit_number,
            }),
          });
          clearPendingRegistration();
        }

        await refreshProfile();
        navigate("/");
      } catch (err) {
        setStatusMsg(`No se pudo completar el inicio de sesión: ${err.message}`);
      }
    }
    processOAuth();
  }, [searchParams, navigate, refreshProfile]);

  return (
    <div className="container max-w-md py-16 px-4">
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <div className="h-8 w-8 mx-auto rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm font-medium text-slate-700">{statusMsg}</p>
        </CardContent>
      </Card>
    </div>
  );
}

