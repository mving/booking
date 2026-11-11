import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Building2,
  LogIn,
  KeyRound,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import {
  apiFetch,
  isCognitoConfigured,
  cognitoSignInWithPassword,
  getGoogleSsoAuthorizeUrl,
  localDevLogin,
} from "@/api/client";
import { useAuth, DEMO_ACCOUNTS } from "@/context/AuthContext";
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

export function Login() {
  const navigate = useNavigate();
  const { refreshProfile, switchDemoAccount } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [buildings, setBuildings] = useState([]);

  useEffect(() => {
    apiFetch("/public/buildings")
      .then((list) => setBuildings(list || []))
      .catch(() => {});
  }, []);

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (isCognitoConfigured()) {
        await cognitoSignInWithPassword({ email, password });
      } else {
        await localDevLogin({ email });
      }
      await refreshProfile();
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = () => {
    if (isCognitoConfigured()) {
      window.location.href = getGoogleSsoAuthorizeUrl({ mode: "login" });
    } else {
      handleQuickDemo("propietario4b@gmail.com");
    }
  };

  const handleQuickDemo = async (demoEmail) => {
    setError("");
    setSubmitting(true);
    try {
      await switchDemoAccount(demoEmail);
      if (demoEmail === "seguridad@libertador.com") navigate("/seguridad");
      else if (demoEmail === "admin@edificio.com") navigate("/admin-global");
      else if (demoEmail === "consorcio@libertador.com")
        navigate("/admin-edificio");
      else navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container max-w-4xl py-8 sm:py-12 px-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Formulario Principal de Inicio de Sesión */}
        <Card className="border-slate-200 shadow-md">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary font-semibold text-sm">
              <Building2 className="h-5 w-5" />
              Acceso al Consorcio
            </div>
            <CardTitle className="text-xl sm:text-2xl">
              Iniciar Sesión
            </CardTitle>
            <CardDescription>
              Ingresá con tu cuenta verificada o mediante Google SSO (AWS Cognito).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>No se pudo iniciar sesión</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full h-11 font-semibold border-slate-300"
              onClick={handleGoogleLogin}
              disabled={submitting}
            >
              <svg className="h-4 w-4 mr-1.5" viewBox="0 0 24 24">
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
              Continuar con Google SSO
            </Button>

            <div className="relative flex py-1 items-center">
              <div className="grow border-t border-slate-200"></div>
              <span className="shrink mx-3 text-xs uppercase text-muted-foreground">
                O con email y contraseña
              </span>
              <div className="grow border-t border-slate-200"></div>
            </div>

            <form onSubmit={handlePasswordLogin} className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="login-email">Correo Electrónico</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="tu-email@dominio.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-pass">Contraseña</Label>
                <Input
                  id="login-pass"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={isCognitoConfigured()}
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={submitting}>
                <LogIn className="h-4 w-4" />
                {submitting ? "Ingresando..." : "Iniciar Sesión"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Panel derecho: URLs Fijas de Registro por Edificio y Cuentas de Prueba */}
        <div className="space-y-4">
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                URLs Fijas de Registro por Edificio
              </CardTitle>
              <CardDescription className="text-xs">
                Cada edificio posee su propia URL protegida por contraseña para
                el alta de propietarios e inquilinos:
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {buildings.map((b) => (
                <Link
                  key={b.building_id}
                  to={`/registro/${b.slug}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-primary hover:bg-blue-50/40 transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {b.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      /registro/{b.slug}
                    </p>
                  </div>
                  <Badge variant="outline" className="gap-1">
                    Registrarse <ArrowRight className="h-3 w-3" />
                  </Badge>
                </Link>
              ))}
            </CardContent>
          </Card>

          {!isCognitoConfigured() && (
            <Card className="border-slate-200 bg-slate-50/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  Acceso Rápido por Rol (Entorno Local)
                </CardTitle>
                <CardDescription className="text-xs">
                  También podés probar el intento de ingreso de un usuario dado
                  de baja (<code>exinquilino@gmail.com</code>) para verificar el
                  bloqueo de 1 año.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-1.5">
                {DEMO_ACCOUNTS.map((acc) => (
                  <Button
                    key={acc.email}
                    variant="outline"
                    size="sm"
                    className="justify-between text-xs h-9"
                    onClick={() => handleQuickDemo(acc.email)}
                  >
                    <span>{acc.label}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {acc.email}
                    </Badge>
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-between text-xs h-9 border-red-200 text-red-700 hover:bg-red-50"
                  onClick={() => handleQuickDemo("exinquilino@gmail.com")}
                >
                  <span>Probar Usuario Dado de Baja (Bloqueado 1 año)</span>
                  <Badge variant="destructive" className="text-[10px]">
                    exinquilino@gmail.com
                  </Badge>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

