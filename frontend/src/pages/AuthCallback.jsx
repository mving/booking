import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  exchangeCognitoCodeForToken,
  getPendingRegistration,
  clearPendingRegistration,
  apiFetch,
} from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const [statusMsg, setStatusMsg] = useState(
    "Validando credenciales con AWS Cognito..."
  );
  const [errorMsg, setErrorMsg] = useState("");
  const processedCodeRef = useRef("");

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");
    const errorDesc = searchParams.get("error_description");

    if (errorParam || errorDesc) {
      setErrorMsg(
        `Error de autenticación: ${errorDesc || errorParam}`
      );
      return;
    }

    if (!code) {
      navigate("/login", { replace: true });
      return;
    }

    // Evitar doble intercambio de un authorization_code de un solo uso (React 18 StrictMode)
    if (processedCodeRef.current === code) {
      return;
    }
    processedCodeRef.current = code;

    async function processOAuth() {
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

        const me = await refreshProfile({ throwOnError: true });
        if (!me) {
          setErrorMsg(
            "Cognito validó tu cuenta, pero no se recibió respuesta válida desde el servidor (/api/me)."
          );
          return;
        }

        if (me.is_global_admin && (!me.buildings || me.buildings.length === 0)) {
          navigate("/admin-global", { replace: true });
        } else if (me.profiles?.[0]?.role === "security") {
          navigate("/seguridad", { replace: true });
        } else {
          navigate("/", { replace: true });
        }
      } catch (err) {
        setErrorMsg(`No se pudo completar el inicio de sesión: ${err.message}`);
      }
    }
    processOAuth();
  }, [searchParams, navigate, refreshProfile]);

  return (
    <div className="container max-w-md py-16 px-4">
      <Card>
        <CardContent className="py-10 text-center space-y-4">
          {!errorMsg ? (
            <>
              <div className="h-8 w-8 mx-auto rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm font-medium text-slate-700">{statusMsg}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-red-600">{errorMsg}</p>
              <Button asChild variant="outline">
                <Link to="/login">Volver a Iniciar Sesión</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
