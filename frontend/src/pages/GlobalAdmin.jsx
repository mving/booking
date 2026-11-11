import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Globe,
  Building2,
  Plus,
  Settings,
  KeyRound,
  Users,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { apiFetch } from "@/api/client";
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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function GlobalAdmin() {
  const { setSelectedBuildingId, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Formulario de Nuevo Edificio
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [address, setAddress] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [maxUsersPerUnit, setMaxUsersPerUnit] = useState(3);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminFirstName, setAdminFirstName] = useState("");
  const [adminLastName, setAdminLastName] = useState("");

  const loadBuildings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/buildings");
      setBuildings(res.buildings || []);
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBuildings();
  }, [loadBuildings]);

  const handleCreateBuilding = async (e) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch("/buildings", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug,
          address,
          registration_password: regPassword,
          max_users_per_unit: Number(maxUsersPerUnit),
          admin_email: adminEmail,
          admin_first_name: adminFirstName,
          admin_last_name: adminLastName,
        }),
      });
      setDialogOpen(false);
      setName("");
      setSlug("");
      setAddress("");
      setRegPassword("");
      setAdminEmail("");
      setAdminFirstName("");
      setAdminLastName("");
      setFeedback({
        type: "success",
        text: "Nuevo edificio configurado con éxito y URL fija habilitada.",
      });
      await loadBuildings();
      await refreshProfile();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  return (
    <div className="container py-6 sm:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2 text-primary font-semibold text-xs uppercase tracking-wider">
            <Globe className="h-4 w-4" />
            Administración Global Multi-Edificio
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
            Gestión Central de Consorcios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configurá múltiples edificios, asigná su URL fija de registro
            protegida por contraseña y delegá su administración local.
          </p>
        </div>

        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Dar de Alta Nuevo Edificio
        </Button>
      </div>

      {feedback && (
        <Alert
          variant={feedback.type === "error" ? "destructive" : "success"}
        >
          {feedback.type === "error" ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          <AlertTitle>
            {feedback.type === "error" ? "Error" : "Operación Exitosa"}
          </AlertTitle>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {buildings.map((b) => (
          <Card key={b.building_id} className="border-slate-200 shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Building2 className="h-5 w-5 text-primary" />
                    {b.name}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {b.address || "Sin dirección especificada"}
                  </CardDescription>
                </div>
                <Badge variant="success">Activo</Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 text-xs">
              <div className="rounded-lg bg-slate-50 border p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <KeyRound className="h-3.5 w-3.5 text-primary" />
                    URL Fija de Registro:
                  </span>
                  <Link
                    to={`/registro/${b.slug}`}
                    className="font-semibold text-primary hover:underline flex items-center gap-1"
                  >
                    /registro/{b.slug}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
                {b.registration_password_hint && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Contraseña de Registro:
                    </span>
                    <code className="font-bold text-slate-800">
                      {b.registration_password_hint}
                    </code>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Máx. integrantes por UF:
                  </span>
                  <strong>{b.max_users_per_unit || 3} usuarios / UF</strong>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  <Users className="h-3 w-3 mr-1" />
                  {b.stats?.active_users || 0} usuarios activos
                </Badge>
                <Badge variant="outline">
                  {b.stats?.amenities_count || 0} amenities configurados
                </Badge>
                {b.stats?.deactivated_users > 0 && (
                  <Badge variant="destructive">
                    {b.stats.deactivated_users} con baja (1 año)
                  </Badge>
                )}
              </div>

              {b.stats?.admins?.length > 0 && (
                <div className="text-muted-foreground">
                  <span>Administradores Locales: </span>
                  <strong className="text-slate-800">
                    {b.stats.admins.map((a) => `${a.name} (${a.email})`).join(", ")}
                  </strong>
                </div>
              )}

              <div className="pt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setSelectedBuildingId(b.building_id);
                    navigate("/admin-edificio");
                  }}
                >
                  <Settings className="h-3.5 w-3.5" />
                  Administrar Edificio
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedBuildingId(b.building_id);
                    navigate("/");
                  }}
                >
                  Ver Pantalla Principal
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Modal de Creación de Edificio */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Configurar Nuevo Edificio</DialogTitle>
            <DialogDescription>
              Definí su URL propia de registro, la contraseña de protección y el
              administrador local encargado del edificio.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateBuilding} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label>Nombre del Edificio / Consorcio *</Label>
              <Input
                placeholder="Ej: Torre Belgrano Park"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slug) {
                    setSlug(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, "")
                    );
                  }
                }}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Slug para URL Fija (/registro/slug) *</Label>
                <Input
                  placeholder="torre-belgrano"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Contraseña de Registro del Edificio *</Label>
                <Input
                  placeholder="Ej: BELGRANO2026"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Dirección</Label>
                <Input
                  placeholder="Av. Cabildo 1500, CABA"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Máx. Usuarios / UF *</Label>
                <Input
                  type="number"
                  min={1}
                  value={maxUsersPerUnit}
                  onChange={(e) => setMaxUsersPerUnit(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="border-t pt-3 space-y-2.5">
              <Label className="text-xs font-semibold text-primary">
                Asignar Administrador Local Inicial (Opcional)
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Nombre Admin"
                  value={adminFirstName}
                  onChange={(e) => setAdminFirstName(e.target.value)}
                />
                <Input
                  placeholder="Apellido Admin"
                  value={adminLastName}
                  onChange={(e) => setAdminLastName(e.target.value)}
                />
              </div>
              <Input
                type="email"
                placeholder="Email del Administrador Local (para login / Google SSO)"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit">Crear Edificio</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

