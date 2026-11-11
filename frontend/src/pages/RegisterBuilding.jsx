import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Building2,
  KeyRound,
  Lock,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
  Mail,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import {
  apiFetch,
  isCognitoConfigured,
  cognitoSignUpWithEmail,
  cognitoConfirmSignUp,
  cognitoSignInWithPassword,
  getGoogleSsoAuthorizeUrl,
  savePendingRegistration,
  localDevLogin,
} from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export function RegisterBuilding() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  const [buildingInfo, setBuildingInfo] = useState(null);
  const [loadingBuilding, setLoadingBuilding] = useState(true);
  const [buildingError, setBuildingError] = useState("");

  // Paso 1: Contraseña del edificio
  const [buildingPassword, setBuildingPassword] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");
  const [verifyingPass, setVerifyingPass] = useState(false);

  // Paso 2: Datos personales + Unidad Funcional + Credenciales
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Paso 3 (Opcional en Cognito real): Código de verificación de email enviado por Cognito
  const [awaitingEmailCode, setAwaitingEmailCode] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  useEffect(() => {
    async function fetchBuilding() {
      setLoadingBuilding(true);
      setBuildingError("");
      try {
        const data = await apiFetch(`/public/buildings/${encodeURIComponent(slug)}`);
        setBuildingInfo(data);
      } catch (err) {
        setBuildingError(err.message);
      } finally {
        setLoadingBuilding(false);
      }
    }
    fetchBuilding();
  }, [slug]);

  const handleVerifyBuildingPassword = async (e) => {
    e.preventDefault();
    setFormError("");
    setVerifyingPass(true);
    try {
      const res = await apiFetch(
        `/public/buildings/${encodeURIComponent(slug)}/verify`,
        {
          method: "POST",
          body: JSON.stringify({ password: buildingPassword }),
        }
      );
      setRegistrationToken(res.registration_token);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setVerifyingPass(false);
    }
  };

  const handleRegisterWithPassword = async (e) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!firstName.trim() || !lastName.trim() || !unitNumber.trim() || !email.trim()) {
      setFormError("Completá Nombre, Apellido, Unidad Funcional y Correo Electrónico.");
      return;
    }

    setSubmitting(true);
    try {
      if (isCognitoConfigured()) {
        // Registro real en AWS Cognito con envío de código de verificación por email
        await cognitoSignUpWithEmail({
          email,
          password,
          firstName,
          lastName,
        });
        setAwaitingEmailCode(true);
        setFormSuccess(
          "Te enviamos un código de verificación a tu correo electrónico mediante AWS Cognito. Ingresalo abajo para activar tu cuenta."
        );
      } else {
        // Entorno local / demo
        await localDevLogin({
          email,
          first_name: firstName,
          last_name: lastName,
        });
        await apiFetch("/auth/register-profile", {
          method: "POST",
          body: JSON.stringify({
            registration_token: registrationToken,
            first_name: firstName,
            last_name: lastName,
            unit_number: unitNumber,
          }),
        });
        await refreshProfile();
        setFormSuccess("¡Registro completado con éxito! Redirigiendo al panel del edificio...");
        setTimeout(() => navigate("/"), 1200);
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmEmailCode = async (e) => {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      await cognitoConfirmSignUp({ email, code: verificationCode });
      await cognitoSignInWithPassword({ email, password });
      await apiFetch("/auth/register-profile", {
        method: "POST",
        body: JSON.stringify({
          registration_token: registrationToken,
          first_name: firstName,
          last_name: lastName,
          unit_number: unitNumber,
        }),
      });
      await refreshProfile();
      navigate("/");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSsoRegister = async () => {
    setFormError("");
    if (!firstName.trim() || !lastName.trim() || !unitNumber.trim()) {
      setFormError(
        "Antes de continuar con Google SSO, ingresá tu Nombre, Apellido y Unidad Funcional (tal como figura en las expensas)."
      );
      return;
    }

    if (isCognitoConfigured()) {
      savePendingRegistration({
        registration_token: registrationToken,
        slug,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        unit_number: unitNumber.trim(),
      });
      const url = getGoogleSsoAuthorizeUrl({
        mode: "register",
        slug,
      });
      window.location.href = url;
    } else {
      // Simulación de Google SSO en entorno local
      const googleEmail =
        email.trim() ||
        `${firstName.trim().toLowerCase()}.${lastName
          .trim()
          .toLowerCase()}@gmail.com`;
      setSubmitting(true);
      try {
        await localDevLogin({
          email: googleEmail,
          first_name: firstName,
          last_name: lastName,
        });
        await apiFetch("/auth/register-profile", {
          method: "POST",
          body: JSON.stringify({
            registration_token: registrationToken,
            first_name: firstName,
            last_name: lastName,
            unit_number: unitNumber,
          }),
        });
        await refreshProfile();
        navigate("/");
      } catch (err) {
        setFormError(err.message);
      } finally {
        setSubmitting(false);
      }
    }
  };

  if (loadingBuilding) {
    return (
      <div className="container max-w-lg py-12 text-center text-muted-foreground">
        Cargando información del edificio...
      </div>
    );
  }

  if (buildingError || !buildingInfo) {
    return (
      <div className="container max-w-lg py-12">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>URL de Edificio No Disponible</AlertTitle>
          <AlertDescription>
            {buildingError || "No existe un edificio asociado a esta URL."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container max-w-xl py-8 sm:py-12 px-4">
      <Card className="border-slate-200 shadow-md overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-6 text-white">
          <div className="flex items-center justify-between gap-2">
            <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/25">
              URL Fija de Registro: /registro/{buildingInfo.slug}
            </Badge>
            <Badge className="bg-emerald-500/20 text-emerald-100 border-emerald-300/30">
              Máx. {buildingInfo.max_users_per_unit} usuarios / UF
            </Badge>
          </div>
          <h1 className="mt-3 text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 shrink-0" />
            {buildingInfo.name}
          </h1>
          <p className="text-sm text-blue-100 mt-1">{buildingInfo.address}</p>
        </div>

        <CardContent className="pt-6 space-y-6">
          {formError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Atención</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          {formSuccess && (
            <Alert variant="success">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Operación exitosa</AlertTitle>
              <AlertDescription>{formSuccess}</AlertDescription>
            </Alert>
          )}

          {/* PASO 1: VALIDACIÓN DE CONTRASEÑA DEL EDIFICIO */}
          {!registrationToken ? (
            <form onSubmit={handleVerifyBuildingPassword} className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm">
                  <Lock className="h-4 w-4 text-primary" />
                  Acceso Protegido del Consorcio
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Para evitar que personas ajenas al edificio puedan registrarse,
                  ingresá primero la contraseña provista por la administración.
                </p>
                {buildingInfo.registration_password_hint && (
                  <p className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded px-2.5 py-1.5">
                    Clave de prueba de este edificio:{" "}
                    <code className="font-bold">
                      {buildingInfo.registration_password_hint}
                    </code>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="bldg-pass">Contraseña del Edificio</Label>
                <div className="relative">
                  <Input
                    id="bldg-pass"
                    type="password"
                    placeholder="Ingresá la clave de tu edificio..."
                    value={buildingPassword}
                    onChange={(e) => setBuildingPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={verifyingPass}
              >
                <KeyRound className="h-4 w-4" />
                {verifyingPass
                  ? "Verificando contraseña..."
                  : "Desbloquear Formulario de Registro"}
              </Button>
            </form>
          ) : awaitingEmailCode ? (
            /* PASO 3: CONFIRMACIÓN DE CÓDIGO DE VERIFICACIÓN DE EMAIL DE COGNITO */
            <form onSubmit={handleConfirmEmailCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="verify-code">
                  Código de Verificación enviado a {email}
                </Label>
                <Input
                  id="verify-code"
                  placeholder="Ej: 123456"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                <ShieldCheck className="h-4 w-4" />
                {submitting
                  ? "Verificando correo..."
                  : "Verificar Email y Finalizar Registro"}
              </Button>
            </form>
          ) : (
            /* PASO 2: FORMULARIO DE DATOS DE UNIDAD FUNCIONAL + COGNITO / GOOGLE SSO */
            <div className="space-y-5">
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs text-emerald-800">
                <span className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  Contraseña del edificio validada correctamente
                </span>
                <Badge variant="success">Habilitado</Badge>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-fname">Nombre *</Label>
                    <Input
                      id="reg-fname"
                      placeholder="Ej: Martín"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reg-lname">Apellido *</Label>
                    <Input
                      id="reg-lname"
                      placeholder="Ej: Alvarez"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-uf">
                    Unidad Funcional (tal como figura en las expensas) *
                  </Label>
                  <Input
                    id="reg-uf"
                    placeholder="Ej: UF 42 - 4° B"
                    value={unitNumber}
                    onChange={(e) => setUnitNumber(e.target.value)}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Importante: Este edificio admite hasta{" "}
                    <strong>{buildingInfo.max_users_per_unit} integrantes</strong>{" "}
                    por Unidad Funcional.
                  </p>
                </div>
              </div>

              {/* Opción 1: SSO con Google mediante AWS Cognito */}
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 font-semibold border-slate-300 hover:bg-slate-50"
                  onClick={handleGoogleSsoRegister}
                  disabled={submitting}
                >
                  <svg className="h-4 w-4 mr-1" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                    />
                  </svg>
                  Registrarse con Google SSO (AWS Cognito)
                </Button>
              </div>

              <div className="relative flex py-1 items-center">
                <div className="grow border-t border-slate-200"></div>
                <span className="shrink mx-3 text-xs uppercase text-muted-foreground">
                  O con usuario y contraseña
                </span>
                <div className="grow border-t border-slate-200"></div>
              </div>

              {/* Opción 2: Registro con Email y Contraseña en Cognito */}
              <form onSubmit={handleRegisterWithPassword} className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-email">Correo Electrónico *</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    placeholder="vecino@correo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-pass">
                    Contraseña (mínimo 8 caracteres, letras y números) *
                  </Label>
                  <Input
                    id="reg-pass"
                    type="password"
                    placeholder="••••••••"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-11"
                  disabled={submitting}
                >
                  <UserPlus className="h-4 w-4" />
                  {submitting
                    ? "Procesando registro..."
                    : "Crear Cuenta y Vincular Unidad Funcional"}
                </Button>
              </form>
            </div>
          )}

          <div className="pt-3 border-t text-center text-xs text-muted-foreground flex items-center justify-between">
            <span>¿Ya tenés usuario en el edificio?</span>
            <Link
              to="/login"
              className="font-semibold text-primary hover:underline inline-flex items-center gap-1"
            >
              Iniciar sesión <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

