import React, { useState, useEffect, useCallback } from "react";
import {
  Settings,
  Plus,
  Edit3,
  Trash2,
  Users,
  Calendar,
  Ban,
  CheckCircle2,
  Home,
  UserCheck,
  UserMinus,
  RotateCcw,
  Copy,
  KeyRound,
  Eye,
  EyeOff,
  Clock,
  Shield,
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const DAYS_OF_WEEK = [
  { key: "1", label: "Lunes" },
  { key: "2", label: "Martes" },
  { key: "3", label: "Miércoles" },
  { key: "4", label: "Jueves" },
  { key: "5", label: "Viernes" },
  { key: "6", label: "Sábado" },
  { key: "0", label: "Domingo" },
];

function createDefaultSchedule() {
  const sched = {};
  for (let d = 0; d <= 6; d++) {
    sched[String(d)] = {
      enabled: true,
      shifts: [
        {
          id: "SHIFT_1",
          name: "Turno Mediodía",
          start_time: "11:00",
          end_time: "16:30",
        },
        {
          id: "SHIFT_2",
          name: "Turno Noche",
          start_time: "19:30",
          end_time: "01:30",
        },
      ],
    };
  }
  return sched;
}

export function BuildingAdmin() {
  const {
    meData,
    activeBuilding,
    selectedBuildingId,
    setSelectedBuildingId,
    refreshProfile,
  } = useAuth();
  const buildingId = activeBuilding?.building_id;

  const [loading, setLoading] = useState(true);
  const [amenities, setAmenities] = useState([]);
  const [users, setUsers] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [feedback, setFeedback] = useState(null);

  // Filtros de usuarios
  const [userSearch, setUserSearch] = useState("");
  const [userStatusFilter, setUserStatusFilter] = useState("ALL");

  // Modal de Eliminación Definitiva con Confirmación (AlertDialog)
  const [userToPermDelete, setUserToPermDelete] = useState(null);

  // Modal de Alta / Edición de Amenity
  const [amenityDialogOpen, setAmenityDialogOpen] = useState(false);
  const [editingAmenityId, setEditingAmenityId] = useState(null);
  const [amName, setAmName] = useState("");
  const [amDesc, setAmDesc] = useState("");
  const [amMaxCapacity, setAmMaxCapacity] = useState(20);
  const [amMaxBookingsDay, setAmMaxBookingsDay] = useState(2);
  const [amNoShifts, setAmNoShifts] = useState(false);
  const [amShowOnHome, setAmShowOnHome] = useState(true);
  const [amAllowComments, setAmAllowComments] = useState(true);
  const [amSchedule, setAmSchedule] = useState(createDefaultSchedule);

  // Modal de Alta Manual de Usuario
  const [newUserDialogOpen, setNewUserDialogOpen] = useState(false);
  const [nuEmail, setNuEmail] = useState("");
  const [nuFirstName, setNuFirstName] = useState("");
  const [nuLastName, setNuLastName] = useState("");
  const [nuUnit, setNuUnit] = useState("");
  const [nuRole, setNuRole] = useState("resident");
  const [nuResidentType, setNuResidentType] = useState("tenant");

  // Parámetros del Edificio
  const [bldgName, setBldgName] = useState("");
  const [bldgAddress, setBldgAddress] = useState("");
  const [bldgMaxUsersPerUnit, setBldgMaxUsersPerUnit] = useState(3);
  const [bldgBlockedMessage, setBldgBlockedMessage] = useState("");
  const [bldgNewPassword, setBldgNewPassword] = useState("");

  const loadAdminData = useCallback(async () => {
    if (!buildingId) return;
    setLoading(true);
    try {
      const [amRes, usrRes, resvRes] = await Promise.all([
        apiFetch(`/buildings/${buildingId}/amenities`),
        apiFetch(`/buildings/${buildingId}/users`),
        apiFetch(`/buildings/${buildingId}/reservations`),
      ]);
      setAmenities(amRes.amenities || []);
      setUsers(usrRes.users || []);
      setReservations(resvRes.reservations || []);

      if (activeBuilding) {
        setBldgName(activeBuilding.name || "");
        setBldgAddress(activeBuilding.address || "");
        setBldgMaxUsersPerUnit(activeBuilding.max_users_per_unit || 3);
        setBldgBlockedMessage(activeBuilding.blocked_user_message || "");
      }
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }, [buildingId, activeBuilding]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  // ──────────────────────────────────────────────────────────────────────────
  // HANDLERS DE AMENITIES
  // ──────────────────────────────────────────────────────────────────────────
  const openCreateAmenity = () => {
    setEditingAmenityId(null);
    setAmName("");
    setAmDesc("");
    setAmMaxCapacity(20);
    setAmMaxBookingsDay(2);
    setAmNoShifts(false);
    setAmShowOnHome(true);
    setAmAllowComments(true);
    setAmSchedule(createDefaultSchedule());
    setAmenityDialogOpen(true);
  };

  const openEditAmenity = (am) => {
    setEditingAmenityId(am.amenity_id);
    setAmName(am.name);
    setAmDesc(am.description || "");
    setAmMaxCapacity(am.max_capacity || 20);
    setAmMaxBookingsDay(am.max_bookings_per_day || 2);
    setAmNoShifts(Boolean(am.no_shifts));
    setAmShowOnHome(am.show_on_home !== false);
    setAmAllowComments(am.allow_comments !== false);
    setAmSchedule(am.schedule || createDefaultSchedule());
    setAmenityDialogOpen(true);
  };

  const handleSaveAmenity = async (e) => {
    e.preventDefault();
    setFeedback(null);
    const payload = {
      name: amName,
      description: amDesc,
      max_capacity: Number(amMaxCapacity),
      max_bookings_per_day: Number(amMaxBookingsDay),
      no_shifts: amNoShifts,
      show_on_home: amShowOnHome,
      allow_comments: amAllowComments,
      schedule: amSchedule,
    };

    try {
      if (editingAmenityId) {
        await apiFetch(
          `/buildings/${buildingId}/amenities/${editingAmenityId}`,
          {
            method: "PUT",
            body: JSON.stringify(payload),
          }
        );
      } else {
        await apiFetch(`/buildings/${buildingId}/amenities`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      setAmenityDialogOpen(false);
      setFeedback({
        type: "success",
        text: "Amenity guardado correctamente.",
      });
      await loadAdminData();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  const handleDeleteAmenity = async (amenityId) => {
    try {
      await apiFetch(`/buildings/${buildingId}/amenities/${amenityId}`, {
        method: "DELETE",
      });
      await loadAdminData();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  const updateDaySchedule = (dayKey, updater) => {
    setAmSchedule((prev) => {
      const currentDay = prev[dayKey] || { enabled: true, shifts: [] };
      return {
        ...prev,
        [dayKey]: updater(currentDay),
      };
    });
  };

  const copyMondayToAllDays = () => {
    const monday = amSchedule["1"];
    if (!monday) return;
    const next = {};
    for (let d = 0; d <= 6; d++) {
      next[String(d)] = JSON.parse(JSON.stringify(monday));
    }
    setAmSchedule(next);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // HANDLERS DE USUARIOS, EXPENSAS, ÚNICO PROPIETARIO, BAJA Y REACTIVACIÓN
  // ──────────────────────────────────────────────────────────────────────────
  const handleToggleBlockExpenses = async (user, applyToUnit = false) => {
    setFeedback(null);
    try {
      await apiFetch(`/buildings/${buildingId}/users/${user.user_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          is_blocked: !user.is_effectively_blocked,
          apply_to_unit: applyToUnit,
        }),
      });
      await loadAdminData();
      await refreshProfile();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  const handleSetSingleOwnerOfUnit = async (user) => {
    setFeedback(null);
    const nextType = user.resident_type === "owner" ? "tenant" : "owner";
    try {
      await apiFetch(`/buildings/${buildingId}/users/${user.user_id}`, {
        method: "PATCH",
        body: JSON.stringify({ resident_type: nextType }),
      });
      setFeedback({
        type: "success",
        text:
          nextType === "owner"
            ? `${user.first_name} ${user.last_name} fue configurado como el único Propietario de la Unidad Funcional ${user.unit_number}.`
            : `${user.first_name} ${user.last_name} pasó a condición de Inquilino/Integrante.`,
      });
      await loadAdminData();
      await refreshProfile();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  const handleChangeUserRole = async (user, newRole) => {
    setFeedback(null);
    try {
      await apiFetch(`/buildings/${buildingId}/users/${user.user_id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      await loadAdminData();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  // Dar de Baja Lógica (retención por 1 año bloqueando el email)
  const handleDeactivateUser = async (user) => {
    setFeedback(null);
    try {
      const res = await apiFetch(
        `/buildings/${buildingId}/users/${user.user_id}`,
        { method: "DELETE" }
      );
      setFeedback({
        type: "success",
        text: res.message,
      });
      await loadAdminData();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  // Reactivar (Volver a dar de alta a un usuario dado de baja)
  const handleReactivateUser = async (user) => {
    setFeedback(null);
    try {
      await apiFetch(`/buildings/${buildingId}/users/${user.user_id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ACTIVE" }),
      });
      setFeedback({
        type: "success",
        text: `El usuario ${user.first_name} ${user.last_name} (${user.email}) fue dado de alta nuevamente.`,
      });
      await loadAdminData();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  // Eliminar definitivamente (previa confirmación en AlertDialog)
  const handleConfirmPermanentDeleteUser = async () => {
    if (!userToPermDelete) return;
    setFeedback(null);
    try {
      const res = await apiFetch(
        `/buildings/${buildingId}/users/${userToPermDelete.user_id}?permanent=true`,
        { method: "DELETE" }
      );
      setUserToPermDelete(null);
      setFeedback({
        type: "success",
        text: res.message,
      });
      await loadAdminData();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  const handleCreateUserManual = async (e) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch(`/buildings/${buildingId}/users`, {
        method: "POST",
        body: JSON.stringify({
          email: nuEmail,
          first_name: nuFirstName,
          last_name: nuLastName,
          unit_number: nuUnit || "UF",
          user_role: nuRole,
          resident_type: nuResidentType,
        }),
      });
      setNewUserDialogOpen(false);
      setNuEmail("");
      setNuFirstName("");
      setNuLastName("");
      setNuUnit("");
      setFeedback({
        type: "success",
        text: "Usuario agregado al edificio correctamente.",
      });
      await loadAdminData();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // HANDLER PARÁMETROS DEL EDIFICIO
  // ──────────────────────────────────────────────────────────────────────────
  const handleSaveBuildingSettings = async (e) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch(`/buildings/${buildingId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: bldgName,
          address: bldgAddress,
          max_users_per_unit: Number(bldgMaxUsersPerUnit),
          blocked_user_message: bldgBlockedMessage,
          registration_password: bldgNewPassword || undefined,
        }),
      });
      setBldgNewPassword("");
      setFeedback({
        type: "success",
        text: "Parámetros del edificio actualizados correctamente.",
      });
      await refreshProfile();
      await loadAdminData();
    } catch (err) {
      setFeedback({ type: "error", text: err.message });
    }
  };

  const filteredUsers = users.filter((u) => {
    if (userStatusFilter === "ACTIVE" && u.status !== "ACTIVE") return false;
    if (userStatusFilter === "DEACTIVATED" && u.status !== "DEACTIVATED")
      return false;
    if (userStatusFilter === "BLOCKED" && !u.is_effectively_blocked)
      return false;
    if (userSearch.trim()) {
      const q = userSearch.toLowerCase();
      return (
        `${u.first_name} ${u.last_name}`.toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.unit_number || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="container py-6 sm:py-8 space-y-6">
      {/* Encabezado del Panel de Administración del Edificio */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2 text-primary font-semibold text-xs uppercase tracking-wider">
            <Settings className="h-4 w-4" />
            Panel de Administración Local del Consorcio
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
            {activeBuilding?.name || "Configuración del Edificio"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            URL fija de registro de vecinos:{" "}
            <code className="font-semibold text-primary">
              {window.location.origin}/registro/{activeBuilding?.slug}
            </code>
          </p>
        </div>

        {/* Si es Admin Global, puede cambiar qué edificio está administrando */}
        {meData?.is_global_admin && meData?.buildings?.length > 1 && (
          <div className="w-full sm:w-64">
            <Label className="text-xs">Edificio Seleccionado:</Label>
            <Select
              value={selectedBuildingId}
              onValueChange={setSelectedBuildingId}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Seleccionar edificio" />
              </SelectTrigger>
              <SelectContent>
                {meData.buildings.map((b) => (
                  <SelectItem key={b.building_id} value={b.building_id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {feedback && (
        <Alert
          variant={feedback.type === "error" ? "destructive" : "success"}
        >
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>
            {feedback.type === "error" ? "Atención" : "Cambios aplicados"}
          </AlertTitle>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="amenities" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="amenities">
            1. Amenities y Turnos ({amenities.length})
          </TabsTrigger>
          <TabsTrigger value="users">
            2. Usuarios, UF, Expensas y Bajas ({users.length})
          </TabsTrigger>
          <TabsTrigger value="settings">
            3. Parámetros del Edificio
          </TabsTrigger>
          <TabsTrigger value="history">
            4. Historial 90 Días ({reservations.length})
          </TabsTrigger>
        </TabsList>

        {/* ──────────────────────────────────────────────────────────────────── */}
        {/* TAB 1: CONFIGURACIÓN DE AMENITIES */}
        {/* ──────────────────────────────────────────────────────────────────── */}
        <TabsContent value="amenities" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                Amenities del Edificio (Quincho, Parrilla, Pileta, SUM)
              </h2>
              <p className="text-xs text-muted-foreground">
                Configurá la capacidad máxima de invitados, hasta 2 turnos por
                día de la semana, opción "Sin turnos", máximo de reservas por
                día y visibilidad en la pantalla principal.
              </p>
            </div>
            <Button onClick={openCreateAmenity}>
              <Plus className="h-4 w-4" />
              Agregar Amenity
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {amenities.map((am) => (
              <Card key={am.amenity_id} className="border-slate-200">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base sm:text-lg">
                        {am.name}
                      </CardTitle>
                      <CardDescription className="mt-1 text-xs">
                        {am.description || "Sin comentarios de reglamento."}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditAmenity(am)}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => handleDeleteAmenity(am.amenity_id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="default">
                      Máx. {am.max_capacity} invitados / turno
                    </Badge>
                    <Badge variant="secondary">
                      Máx. {am.max_bookings_per_day} reservas / día
                    </Badge>
                    {am.no_shifts ? (
                      <Badge variant="warning">
                        Sin turnos (Reservas superpuestas)
                      </Badge>
                    ) : (
                      <Badge variant="outline">Por turnos (Hasta 2/día)</Badge>
                    )}
                    {am.show_on_home ? (
                      <Badge variant="success" className="gap-1">
                        <Eye className="h-3 w-3" /> Visible en Pantalla Principal
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <EyeOff className="h-3 w-3" /> Oculto en Pantalla
                        Principal
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ──────────────────────────────────────────────────────────────────── */}
        {/* TAB 2: PANEL DE USUARIOS, EXPENSAS, ÚNICO PROPIETARIO Y BAJAS */}
        {/* ──────────────────────────────────────────────────────────────────── */}
        <TabsContent value="users" className="space-y-4">
          <Card className="border-slate-200">
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">
                    Padrón de Usuarios y Unidades Funcionales
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Máximo permitido por Unidad Funcional:{" "}
                    <strong>
                      {activeBuilding?.max_users_per_unit || 3} integrantes
                      activos
                    </strong>
                    . Configurá un único Propietario por UF, bloqueá reservas
                    por deuda de expensas o gestioná bajas (retención de 1 año)
                    y reactivaciones.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => setNewUserDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Dar de Alta Usuario Manual
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
                <div className="sm:col-span-2">
                  <Input
                    placeholder="Buscar por Unidad Funcional (ej: 4° B), Apellido o Email..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                  />
                </div>
                <Select
                  value={userStatusFilter}
                  onValueChange={setUserStatusFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Filtrar por estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">
                      Todos ({users.length})
                    </SelectItem>
                    <SelectItem value="ACTIVE">
                      Solo Activos (
                      {users.filter((u) => u.status === "ACTIVE").length})
                    </SelectItem>
                    <SelectItem value="BLOCKED">
                      Bloqueados por Expensas (
                      {
                        users.filter((u) => u.is_effectively_blocked).length
                      }
                      )
                    </SelectItem>
                    <SelectItem value="DEACTIVATED">
                      Dados de Baja - Retención 1 año (
                      {users.filter((u) => u.status === "DEACTIVATED").length})
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {filteredUsers.map((u) => {
                const isDeactivated = u.status === "DEACTIVATED";
                const isOwner = u.resident_type === "owner";
                return (
                  <div
                    key={`${u.user_id}-${u.building_id}`}
                    className={`rounded-xl border p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                      isDeactivated
                        ? "bg-slate-100 border-slate-300"
                        : u.is_effectively_blocked
                        ? "bg-red-50/40 border-red-200"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm sm:text-base text-slate-900">
                          {u.first_name} {u.last_name}
                        </span>
                        <Badge variant="outline">UF: {u.unit_number}</Badge>
                        {u.role === "resident" && (
                          <Badge variant="secondary">
                            Cupo UF: {u.unit_active_count}/{u.unit_max_users}
                          </Badge>
                        )}
                        {isOwner && (
                          <Badge variant="success">
                            <Home className="h-3 w-3 mr-1" />
                            Propietario Único de UF
                          </Badge>
                        )}
                        {u.role === "security" && (
                          <Badge variant="warning">
                            <Shield className="h-3 w-3 mr-1" />
                            Seguridad
                          </Badge>
                        )}
                        {u.role === "building_admin" && (
                          <Badge variant="default">Admin Edificio</Badge>
                        )}
                        {isDeactivated ? (
                          <Badge variant="destructive">
                            DADO DE BAJA (Email bloqueado 1 año)
                          </Badge>
                        ) : u.is_effectively_blocked ? (
                          <Badge variant="destructive">
                            BLOQUEADO (Mora Expensas)
                          </Badge>
                        ) : (
                          <Badge variant="success">Habilitado</Badge>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Email verificado: <strong>{u.email}</strong>
                        {isDeactivated && u.deactivated_at && (
                          <span className="ml-2 text-red-700">
                            • Baja el {u.deactivated_at.slice(0, 10)} por{" "}
                            {u.deactivated_by}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Botonera de Acciones del Administrador sobre el Usuario */}
                    <div className="flex flex-wrap items-center gap-2">
                      {!isDeactivated ? (
                        <>
                          {u.role === "resident" && (
                            <>
                              {/* Configurar Único Propietario de la Unidad Funcional */}
                              <Button
                                variant={isOwner ? "secondary" : "outline"}
                                size="sm"
                                onClick={() => handleSetSingleOwnerOfUnit(u)}
                              >
                                <Home className="h-3.5 w-3.5" />
                                {isOwner
                                  ? "Quitar Propietario UF"
                                  : "Hacer Único Propietario UF"}
                              </Button>

                              {/* Bloquear / Desbloquear por Expensas */}
                              <Button
                                variant={
                                  u.is_effectively_blocked
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                className={
                                  !u.is_effectively_blocked
                                    ? "text-red-700 border-red-200 hover:bg-red-50"
                                    : ""
                                }
                                onClick={() =>
                                  handleToggleBlockExpenses(u, true)
                                }
                              >
                                <Ban className="h-3.5 w-3.5" />
                                {u.is_effectively_blocked
                                  ? "Rehabilitar Expensas UF"
                                  : "Bloquear por Expensas"}
                              </Button>
                            </>
                          )}

                          {/* Selector de Rol */}
                          <Select
                            value={u.role}
                            onValueChange={(val) => handleChangeUserRole(u, val)}
                          >
                            <SelectTrigger className="w-[140px] h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="resident">
                                Rol: Vecino
                              </SelectItem>
                              <SelectItem value="security">
                                Rol: Seguridad
                              </SelectItem>
                              <SelectItem value="building_admin">
                                Rol: Admin Local
                              </SelectItem>
                            </SelectContent>
                          </Select>

                          {/* Dar de Baja (Retención 1 Año) */}
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-amber-800 border-amber-300 hover:bg-amber-50"
                            onClick={() => handleDeactivateUser(u)}
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                            Dar de Baja
                          </Button>
                        </>
                      ) : (
                        /* ACCIONES CUANDO EL USUARIO ESTÁ DADO DE BAJA: REACTIVAR Ó ELIMINAR DEFINITIVAMENTE */
                        <>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleReactivateUser(u)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Dar de Alta (Reactivar)
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setUserToPermDelete(u)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Eliminar Definitivamente
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ──────────────────────────────────────────────────────────────────── */}
        {/* TAB 3: PARÁMETROS DEL EDIFICIO */}
        {/* ──────────────────────────────────────────────────────────────────── */}
        <TabsContent value="settings">
          <Card className="border-slate-200 max-w-2xl">
            <CardHeader>
              <CardTitle className="text-lg">
                Parámetros Generales del Edificio
              </CardTitle>
              <CardDescription>
                Configurá el máximo de integrantes por Unidad Funcional, el
                mensaje que verán los vecinos bloqueados por adeudar expensas y
                la contraseña de registro del edificio.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleSaveBuildingSettings}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Nombre del Edificio</Label>
                    <Input
                      value={bldgName}
                      onChange={(e) => setBldgName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Dirección</Label>
                    <Input
                      value={bldgAddress}
                      onChange={(e) => setBldgAddress(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>
                      Máximo de Integrantes por Unidad Funcional *
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={bldgMaxUsersPerUnit}
                      onChange={(e) => setBldgMaxUsersPerUnit(e.target.value)}
                      required
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Cantidad máxima de usuarios activos admitidos en una misma
                      Unidad Funcional.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>
                      Cambiar Contraseña de Registro del Edificio (Opcional)
                    </Label>
                    <Input
                      type="text"
                      placeholder="Dejar en blanco para mantener la actual..."
                      value={bldgNewPassword}
                      onChange={(e) => setBldgNewPassword(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Protege la URL fija{" "}
                      <code>/registro/{activeBuilding?.slug}</code>.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>
                    Mensaje Configurable para Vecinos Bloqueados por Expensas *
                  </Label>
                  <Textarea
                    rows={3}
                    value={bldgBlockedMessage}
                    onChange={(e) => setBldgBlockedMessage(e.target.value)}
                    required
                  />
                </div>

                <Button type="submit">Guardar Configuración del Edificio</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ──────────────────────────────────────────────────────────────────── */}
        {/* TAB 4: HISTORIAL DE RESERVAS (90 DÍAS HACIA ATRÁS) */}
        {/* ──────────────────────────────────────────────────────────────────── */}
        <TabsContent value="history">
          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg">
                Historial Completo de Reservas (Últimos 90 Días y Futuras)
              </CardTitle>
              <CardDescription>
                Incluye todos los amenities del edificio (también aquellos
                ocultos de la pantalla principal como Pileta). Los registros con
                más de 90 días se purgan automáticamente mediante DynamoDB TTL.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {reservations.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay reservas registradas.
                </p>
              ) : (
                reservations.map((r) => (
                  <div
                    key={r.reservation_id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3.5 bg-white"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm">
                          {r.amenity_name}
                        </span>
                        <Badge>{r.date}</Badge>
                        <Badge variant="outline">UF: {r.unit_number}</Badge>
                        <Badge variant="secondary">
                          {r.guests_count} invitados
                        </Badge>
                        {!r.show_on_home && (
                          <Badge variant="warning">Oculta en Home</Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-700">
                        Vecino: <strong>{r.user_full_name}</strong> —{" "}
                        {r.shift_label}
                      </p>
                      {r.comments && (
                        <p className="text-xs text-muted-foreground">
                          Comentario: {r.comments}
                        </p>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50 self-end sm:self-center"
                      onClick={async () => {
                        await apiFetch(
                          `/buildings/${buildingId}/reservations/${r.reservation_id}`,
                          { method: "DELETE" }
                        );
                        await loadAdminData();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Cancelar Reserva
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* MODAL SHADCN/UI: CREAR / EDITAR AMENITY */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <Dialog open={amenityDialogOpen} onOpenChange={setAmenityDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingAmenityId ? "Editar Amenity" : "Nuevo Amenity del Edificio"}
            </DialogTitle>
            <DialogDescription>
              Configurá cupos máximos, modalidad con o sin turnos, horarios por
              día de la semana (máximo 2 turnos por día) y visibilidad en
              pantalla principal.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveAmenity} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Nombre del Amenity *</Label>
                <Input
                  placeholder="Ej: Reserva Parrilla o Invitados Pileta"
                  value={amName}
                  onChange={(e) => setAmName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Máx. Invitados Total *</Label>
                <Input
                  type="number"
                  min={1}
                  value={amMaxCapacity}
                  onChange={(e) => setAmMaxCapacity(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cantidad Máxima de Reservas x Día *</Label>
                <Input
                  type="number"
                  min={1}
                  value={amMaxBookingsDay}
                  onChange={(e) => setAmMaxBookingsDay(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Espacio de Comentarios / Reglamento</Label>
                <Input
                  placeholder="Instrucciones para el vecino..."
                  value={amDesc}
                  onChange={(e) => setAmDesc(e.target.value)}
                />
              </div>
            </div>

            {/* Checks de configuración del Amenity */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border bg-slate-50 p-3.5">
              <div className="flex items-center justify-between sm:flex-col sm:items-start gap-2">
                <div>
                  <Label className="text-xs font-semibold">
                    Check "Sin Turnos"
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Permite superponer reservas en el día
                  </p>
                </div>
                <Switch
                  checked={amNoShifts}
                  onCheckedChange={setAmNoShifts}
                />
              </div>

              <div className="flex items-center justify-between sm:flex-col sm:items-start gap-2">
                <div>
                  <Label className="text-xs font-semibold">
                    Mostrar en Pantalla Principal
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Desactivar para ej. Invitados Pileta
                  </p>
                </div>
                <Switch
                  checked={amShowOnHome}
                  onCheckedChange={setAmShowOnHome}
                />
              </div>

              <div className="flex items-center justify-between sm:flex-col sm:items-start gap-2">
                <div>
                  <Label className="text-xs font-semibold">
                    Habilitar Comentarios
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Espacio para notas en la reserva
                  </p>
                </div>
                <Switch
                  checked={amAllowComments}
                  onCheckedChange={setAmAllowComments}
                />
              </div>
            </div>

            {/* Configuración de Horarios por Día de la Semana (Máximo 2 Turnos por Día) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Horarios por Día de la Semana (Máx. 2 turnos por día)
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={copyMondayToAllDays}
                >
                  <Copy className="h-3 w-3" />
                  Repetir Lunes en toda la semana
                </Button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 border rounded-lg p-2.5 bg-white">
                {DAYS_OF_WEEK.map((d) => {
                  const dayCfg = amSchedule[d.key] || {
                    enabled: true,
                    shifts: [],
                  };
                  const shifts = dayCfg.shifts || [];
                  return (
                    <div
                      key={d.key}
                      className="rounded-lg border border-slate-200 p-2.5 space-y-2 bg-slate-50/50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={dayCfg.enabled}
                            onCheckedChange={(checked) =>
                              updateDaySchedule(d.key, (cur) => ({
                                ...cur,
                                enabled: checked,
                              }))
                            }
                          />
                          <span className="text-xs font-semibold">
                            {d.label}
                          </span>
                        </div>

                        {dayCfg.enabled && !amNoShifts && (
                          <div className="flex items-center gap-1.5">
                            {shifts.length < 2 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 text-[11px] px-2"
                                onClick={() =>
                                  updateDaySchedule(d.key, (cur) => ({
                                    ...cur,
                                    shifts: [
                                      ...(cur.shifts || []),
                                      {
                                        id: `SHIFT_${(cur.shifts?.length || 0) + 1}`,
                                        name:
                                          (cur.shifts?.length || 0) === 0
                                            ? "Turno Mediodía"
                                            : "Turno Noche",
                                        start_time: "19:00",
                                        end_time: "01:00",
                                      },
                                    ].slice(0, 2),
                                  }))
                                }
                              >
                                + Agregar 2° Turno
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {dayCfg.enabled && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {(amNoShifts ? shifts.slice(0, 1) : shifts).map(
                            (sh, idx) => (
                              <div
                                key={idx}
                                className="flex items-center gap-1.5 bg-white p-2 rounded border text-xs"
                              >
                                <Input
                                  className="h-7 text-xs px-2"
                                  value={
                                    amNoShifts ? "Horario General" : sh.name
                                  }
                                  disabled={amNoShifts}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    updateDaySchedule(d.key, (cur) => {
                                      const nextShifts = [...(cur.shifts || [])];
                                      nextShifts[idx] = {
                                        ...nextShifts[idx],
                                        name: val,
                                      };
                                      return { ...cur, shifts: nextShifts };
                                    });
                                  }}
                                />
                                <Input
                                  type="time"
                                  className="h-7 text-xs px-1.5 w-24"
                                  value={sh.start_time}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    updateDaySchedule(d.key, (cur) => {
                                      const nextShifts = [...(cur.shifts || [])];
                                      nextShifts[idx] = {
                                        ...nextShifts[idx],
                                        start_time: val,
                                      };
                                      return { ...cur, shifts: nextShifts };
                                    });
                                  }}
                                />
                                <span>a</span>
                                <Input
                                  type="time"
                                  className="h-7 text-xs px-1.5 w-24"
                                  value={sh.end_time}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    updateDaySchedule(d.key, (cur) => {
                                      const nextShifts = [...(cur.shifts || [])];
                                      nextShifts[idx] = {
                                        ...nextShifts[idx],
                                        end_time: val,
                                      };
                                      return { ...cur, shifts: nextShifts };
                                    });
                                  }}
                                />
                                {!amNoShifts && shifts.length > 1 && idx === 1 && (
                                  <button
                                    type="button"
                                    className="text-red-500 hover:text-red-700 px-1"
                                    onClick={() =>
                                      updateDaySchedule(d.key, (cur) => ({
                                        ...cur,
                                        shifts: cur.shifts.slice(0, 1),
                                      }))
                                    }
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAmenityDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit">Guardar Amenity</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* MODAL SHADCN/UI: ALTA MANUAL DE USUARIO EN EL EDIFICIO */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <Dialog open={newUserDialogOpen} onOpenChange={setNewUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Usuario al Edificio</DialogTitle>
            <DialogDescription>
              Podés dar de alta un Propietario único de Unidad Funcional, un
              Inquilino o personal de Seguridad.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUserManual} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nombre *</Label>
                <Input
                  value={nuFirstName}
                  onChange={(e) => setNuFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Apellido *</Label>
                <Input
                  value={nuLastName}
                  onChange={(e) => setNuLastName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Correo Electrónico *</Label>
              <Input
                type="email"
                value={nuEmail}
                onChange={(e) => setNuEmail(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Unidad Funcional *</Label>
                <Input
                  placeholder="Ej: UF 42 - 4° B"
                  value={nuUnit}
                  onChange={(e) => setNuUnit(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rol en el Edificio</Label>
                <Select value={nuRole} onValueChange={setNuRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resident">Vecino (UF)</SelectItem>
                    <SelectItem value="security">Seguridad</SelectItem>
                    <SelectItem value="building_admin">
                      Administrador Local
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {nuRole === "resident" && (
              <div className="space-y-1.5">
                <Label>Condición en la Unidad Funcional</Label>
                <Select
                  value={nuResidentType}
                  onValueChange={setNuResidentType}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tenant">Inquilino / Integrante</SelectItem>
                    <SelectItem value="owner">
                      Único Propietario de la UF
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewUserDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit">Crear Usuario</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* CARTEL DE CONFIRMACIÓN OBLIGATORIO (AlertDialog de shadcn/ui) PARA ELIMINACIÓN DEFINITIVA */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <AlertDialog
        open={Boolean(userToPermDelete)}
        onOpenChange={(open) => !open && setUserToPermDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirmación de Eliminación Definitiva
            </AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que deseás eliminar definitivamente a{" "}
              <strong>
                {userToPermDelete?.first_name} {userToPermDelete?.last_name}
              </strong>{" "}
              ({userToPermDelete?.email})? Esta acción borrará de forma
              permanente su registro de la base de datos y de AWS Cognito sin
              esperar el año de baja.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmPermanentDeleteUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirmar y Eliminar Definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

