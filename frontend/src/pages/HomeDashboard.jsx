import React, { useState, useEffect, useCallback } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  Clock,
  Users,
  AlertTriangle,
  CheckCircle2,
  List,
  CalendarDays,
  Trash2,
  PlusCircle,
  Ban,
  Home,
  UserMinus,
  Info,
  MessageSquare,
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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

export function HomeDashboard() {
  const { activeBuilding, activeProfile } = useAuth();
  const buildingId = activeBuilding?.building_id;
  const isUnitOwner = activeProfile?.resident_type === "owner";

  // Estado general de datos del edificio
  const [loading, setLoading] = useState(true);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState("");
  const [amenities, setAmenities] = useState([]);
  const [publicAmenities, setPublicAmenities] = useState([]);
  const [myReservations, setMyReservations] = useState([]);
  const [buildingReservations, setBuildingReservations] = useState([]);
  const [todayStr, setTodayStr] = useState(format(new Date(), "yyyy-MM-dd"));

  // Vista de reservas generales en pantalla principal: "list" | "calendar"
  const [homeViewMode, setHomeViewMode] = useState("list");
  const [selectedAmenityFilter, setSelectedAmenityFilter] = useState("ALL");
  const [calendarViewDate, setCalendarViewDate] = useState(new Date());

  // Estado del formulario de Nueva Reserva
  const [selectedAmenityId, setSelectedAmenityId] = useState("");
  const [selectedDateObj, setSelectedDateObj] = useState(new Date());
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [customTime, setCustomTime] = useState("13:00");
  const [guestsCount, setGuestsCount] = useState(1);
  const [comments, setComments] = useState("");
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingFeedback, setBookingFeedback] = useState(null);

  // Estado de "Mi Unidad Funcional" (solo para el único Propietario de la UF)
  const [myUnitData, setMyUnitData] = useState(null);
  const [tenantToPermDelete, setTenantToPermDelete] = useState(null);

  const selectedDateStr = selectedDateObj
    ? format(selectedDateObj, "yyyy-MM-dd")
    : todayStr;

  const selectedAmenity = amenities.find(
    (a) => a.amenity_id === selectedAmenityId
  );

  const loadDashboardData = useCallback(async () => {
    if (!buildingId) return;
    setLoading(true);
    try {
      const [amData, myResData, pubResData] = await Promise.all([
        apiFetch(`/buildings/${buildingId}/amenities`),
        apiFetch(`/buildings/${buildingId}/reservations/my`),
        apiFetch(`/buildings/${buildingId}/reservations`),
      ]);

      setIsBlocked(Boolean(amData.is_blocked));
      setBlockedMessage(amData.blocked_message || "");
      const amList = amData.amenities || [];
      setAmenities(amList);
      setPublicAmenities(amData.public_amenities || []);
      if (amList.length > 0 && !selectedAmenityId) {
        setSelectedAmenityId(amList[0].amenity_id);
      }

      setMyReservations(myResData.reservations || []);
      setBuildingReservations(pubResData.reservations || []);
      if (pubResData.today) {
        setTodayStr(pubResData.today);
      }

      if (isUnitOwner) {
        try {
          const uData = await apiFetch(`/buildings/${buildingId}/my-unit`);
          setMyUnitData(uData);
        } catch {
          setMyUnitData(null);
        }
      } else {
        setMyUnitData(null);
      }
    } catch (err) {
      console.error("Error cargando dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, [buildingId, isUnitOwner, selectedAmenityId]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Consultar disponibilidad y reservas superpuestas cada vez que cambia Amenity o Fecha
  const fetchAvailability = useCallback(async () => {
    if (!buildingId || !selectedAmenityId || !selectedDateStr || isBlocked) {
      setAvailability(null);
      return;
    }
    setLoadingAvail(true);
    try {
      const data = await apiFetch(
        `/buildings/${buildingId}/availability?amenity_id=${encodeURIComponent(
          selectedAmenityId
        )}&date=${encodeURIComponent(selectedDateStr)}`
      );
      setAvailability(data);
      const firstAvailableShift = (data.shifts || []).find((s) => !s.is_full);
      const fallbackShift = (data.shifts || [])[0];
      const chosen = firstAvailableShift || fallbackShift;
      setSelectedShiftId(chosen ? chosen.id : "");
      if (chosen && chosen.remaining_guests_capacity > 0) {
        setGuestsCount((prev) =>
          Math.min(Math.max(1, prev), chosen.remaining_guests_capacity)
        );
      }
    } catch (err) {
      setAvailability(null);
    } finally {
      setLoadingAvail(false);
    }
  }, [buildingId, selectedAmenityId, selectedDateStr, isBlocked]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  const activeShiftInfo = (availability?.shifts || []).find(
    (s) => s.id === selectedShiftId
  );

  // Función que valida si una fecha del calendario está deshabilitada (nunca hacia atrás ni días cerrados)
  const isCalendarDateDisabled = (date) => {
    const dStr = format(date, "yyyy-MM-dd");
    if (dStr < todayStr) return true;
    if (selectedAmenity?.schedule) {
      const dow = String(date.getDay());
      const cfg = selectedAmenity.schedule[dow];
      if (cfg && !cfg.enabled) return true;
    }
    return false;
  };

  const handleCreateReservation = async (e) => {
    e.preventDefault();
    setBookingFeedback(null);

    if (!activeShiftInfo || activeShiftInfo.is_full) {
      setBookingFeedback({
        type: "error",
        text: "El turno seleccionado no posee cupo disponible.",
      });
      return;
    }

    const numGuests = Number(guestsCount);
    if (numGuests < 1 || numGuests > activeShiftInfo.remaining_guests_capacity) {
      setBookingFeedback({
        type: "error",
        text: `No se puede superar el cupo restante de ${activeShiftInfo.remaining_guests_capacity} invitados para este turno.`,
      });
      return;
    }

    setBookingSubmitting(true);
    try {
      await apiFetch(`/buildings/${buildingId}/reservations`, {
        method: "POST",
        body: JSON.stringify({
          amenity_id: selectedAmenityId,
          date: selectedDateStr,
          shift_id: selectedShiftId,
          custom_time: selectedAmenity?.no_shifts ? customTime : "",
          guests_count: numGuests,
          comments,
        }),
      });

      setComments("");
      setBookingFeedback({
        type: "success",
        text: "¡Reserva confirmada con éxito! Ya podés visualizarla en 'Mis Reservas'.",
      });
      await loadDashboardData();
      await fetchAvailability();
    } catch (err) {
      setBookingFeedback({
        type: "error",
        text: err.message,
      });
      await fetchAvailability();
    } finally {
      setBookingSubmitting(false);
    }
  };

  const handleCancelReservation = async (reservationId) => {
    try {
      await apiFetch(
        `/buildings/${buildingId}/reservations/${reservationId}`,
        { method: "DELETE" }
      );
      await loadDashboardData();
      await fetchAvailability();
    } catch (err) {
      alert(err.message);
    }
  };

  // Dar de baja a un inquilino desde el panel del único Propietario de la UF
  const handleDeactivateTenant = async (tenantUserId) => {
    try {
      await apiFetch(
        `/buildings/${buildingId}/my-unit/tenants/${tenantUserId}`,
        { method: "DELETE" }
      );
      await loadDashboardData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Eliminar definitivamente a un inquilino que ya fue dado de baja (previa confirmación en AlertDialog)
  const handleConfirmPermanentDeleteTenant = async () => {
    if (!tenantToPermDelete) return;
    try {
      await apiFetch(
        `/buildings/${buildingId}/my-unit/tenants/${tenantToPermDelete.user_id}?permanent=true`,
        { method: "DELETE" }
      );
      setTenantToPermDelete(null);
      await loadDashboardData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Filtrado de reservas públicas en la Pantalla Principal
  const filteredPublicReservations = buildingReservations.filter((r) =>
    selectedAmenityFilter === "ALL"
      ? true
      : r.amenity_id === selectedAmenityFilter
  );

  const selectedCalendarDayStr = calendarViewDate
    ? format(calendarViewDate, "yyyy-MM-dd")
    : todayStr;
  const reservationsOnCalendarDay = filteredPublicReservations.filter(
    (r) => r.date === selectedCalendarDayStr
  );

  // Fechas que tienen reservas para resaltarlas en el calendario de vista general
  const reservedDatesObjects = filteredPublicReservations.map((r) =>
    parseISO(r.date)
  );

  if (loading && !amenities.length && !isBlocked) {
    return (
      <div className="container py-12 text-center text-muted-foreground">
        Cargando reservas y amenities del edificio...
      </div>
    );
  }

  return (
    <div className="container py-6 sm:py-8 space-y-8">
      {/* Encabezado de Bienvenida */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Reservas de Amenities
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeBuilding?.name} — Unidad Funcional:{" "}
            <strong className="text-slate-800">
              {activeProfile?.unit_number || "Administración"}
            </strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isUnitOwner && (
            <Badge variant="success" className="py-1 px-3 text-xs">
              <Home className="h-3.5 w-3.5 mr-1" />
              Propietario Único de UF ({activeProfile?.unit_number})
            </Badge>
          )}
          <Badge variant="outline" className="py-1 px-3 text-xs">
            Fecha actual del consorcio: {todayStr}
          </Badge>
        </div>
      </div>

      {/* Grilla Principal: Izquierda (Nueva Reserva + Mis Reservas) | Derecha (Pantalla Principal de Horarios Reservados) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* COLUMNA IZQUIERDA (7 cols): NUEVA RESERVA + MIS RESERVAS + MI UNIDAD FUNCIONAL */}
        <div className="lg:col-span-7 space-y-6">
          {/* TARJETA DE NUEVA RESERVA O CARTEL DE BLOQUEO POR EXPENSAS */}
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <PlusCircle className="h-5 w-5 text-primary" />
                Efectuar una Reserva
              </CardTitle>
              <CardDescription>
                Seleccioná el amenity, la fecha en el calendario desplegable y
                la cantidad de invitados.
              </CardDescription>
            </CardHeader>

            <CardContent>
              {isBlocked ? (
                /* CARTEL DE BLOQUEO POR DEUDA DE EXPENSAS (CONFIGURABLE POR EL ADMINISTRADOR) */
                <Alert variant="destructive" className="py-5">
                  <Ban className="h-5 w-5" />
                  <AlertTitle className="text-base font-bold">
                    Reserva de Amenities Bloqueada
                  </AlertTitle>
                  <AlertDescription className="mt-2 text-sm leading-relaxed">
                    {blockedMessage ||
                      "No puede efectuar reservas por adeudar expensas. Por favor, comuníquese con la administración."}
                  </AlertDescription>
                </Alert>
              ) : amenities.length === 0 ? (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Sin amenities activos</AlertTitle>
                  <AlertDescription>
                    El administrador del edificio aún no ha habilitado amenities.
                  </AlertDescription>
                </Alert>
              ) : (
                <form onSubmit={handleCreateReservation} className="space-y-5">
                  {bookingFeedback && (
                    <Alert
                      variant={
                        bookingFeedback.type === "error"
                          ? "destructive"
                          : "success"
                      }
                    >
                      {bookingFeedback.type === "error" ? (
                        <AlertTriangle className="h-4 w-4" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      <AlertTitle>
                        {bookingFeedback.type === "error"
                          ? "No se pudo realizar la reserva"
                          : "Reserva Confirmada"}
                      </AlertTitle>
                      <AlertDescription>
                        {bookingFeedback.text}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* 1. Selección de Amenity */}
                  <div className="space-y-2">
                    <Label>1. ¿Qué deseás reservar?</Label>
                    <Select
                      value={selectedAmenityId}
                      onValueChange={(val) => {
                        setSelectedAmenityId(val);
                        setBookingFeedback(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccioná un amenity..." />
                      </SelectTrigger>
                      <SelectContent>
                        {amenities.map((am) => (
                          <SelectItem key={am.amenity_id} value={am.amenity_id}>
                            {am.name} (Máx. {am.max_capacity} personas/turno)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedAmenity && (
                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
                        <span>{selectedAmenity.description}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="secondary">
                            Capacidad máx: {selectedAmenity.max_capacity} pers.
                          </Badge>
                          {selectedAmenity.no_shifts && (
                            <Badge variant="warning">Sin turnos fijos</Badge>
                          )}
                          {!selectedAmenity.show_on_home && (
                            <Badge variant="outline">
                              Reserva privada (oculta en Home)
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. Selección de Fecha con Calendario Desplegable shadcn/ui */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>2. Fecha de la Reserva (Desde hoy en adelante)</Label>
                      <Popover
                        open={datePopoverOpen}
                        onOpenChange={setDatePopoverOpen}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                          >
                            <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                            {selectedDateObj
                              ? format(selectedDateObj, "EEEE dd 'de' MMMM yyyy", {
                                  locale: es,
                                })
                              : "Elegir fecha"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={selectedDateObj}
                            onSelect={(day) => {
                              if (day) {
                                setSelectedDateObj(day);
                                setDatePopoverOpen(false);
                                setBookingFeedback(null);
                              }
                            }}
                            disabled={isCalendarDateDisabled}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* 3. Selección de Turno o Hora */}
                    <div className="space-y-2">
                      <Label>
                        3.{" "}
                        {selectedAmenity?.no_shifts
                          ? "Hora de Ingreso (Sin turnos)"
                          : "Turno de Uso"}
                      </Label>
                      {loadingAvail ? (
                        <div className="h-10 rounded-md border px-3 flex items-center text-xs text-muted-foreground">
                          Consultando disponibilidad del turno...
                        </div>
                      ) : !availability?.day_enabled ? (
                        <div className="h-10 rounded-md border border-red-200 bg-red-50 px-3 flex items-center text-xs text-red-700">
                          Este amenity no opera en el día seleccionado.
                        </div>
                      ) : selectedAmenity?.no_shifts ? (
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                          <Input
                            type="time"
                            value={customTime}
                            onChange={(e) => setCustomTime(e.target.value)}
                            required
                          />
                        </div>
                      ) : (
                        <Select
                          value={selectedShiftId}
                          onValueChange={(val) => {
                            setSelectedShiftId(val);
                            const sh = (availability?.shifts || []).find(
                              (s) => s.id === val
                            );
                            if (sh && sh.remaining_guests_capacity > 0) {
                              setGuestsCount((prev) =>
                                Math.min(prev, sh.remaining_guests_capacity)
                              );
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccioná un turno..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(availability?.shifts || []).map((sh) => (
                              <SelectItem
                                key={sh.id}
                                value={sh.id}
                                disabled={sh.is_full}
                              >
                                {sh.name} ({sh.start_time} - {sh.end_time}) —{" "}
                                {sh.is_full
                                  ? "COMPLETO"
                                  : `Disponibles: ${sh.remaining_guests_capacity}/${availability.max_capacity}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>

                  {/* CARTEL OBLIGATORIO DE AVISO DE RESERVAS EXISTENTES EN EL MISMO TURNO */}
                  {activeShiftInfo && activeShiftInfo.warning_message && (
                    <Alert variant="warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>
                        Aviso de Reserva Existente en este Turno
                      </AlertTitle>
                      <AlertDescription>
                        {activeShiftInfo.warning_message}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* 4. Cantidad de Invitados y Comentarios */}
                  {activeShiftInfo && !activeShiftInfo.is_full && (
                    <div className="space-y-4 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                        <div className="space-y-1.5">
                          <Label htmlFor="guests-input">
                            4. Cantidad de Invitados (Máx. permitido:{" "}
                            {activeShiftInfo.remaining_guests_capacity})
                          </Label>
                          <Input
                            id="guests-input"
                            type="number"
                            min={1}
                            max={activeShiftInfo.remaining_guests_capacity}
                            value={guestsCount}
                            onChange={(e) =>
                              setGuestsCount(
                                Math.min(
                                  activeShiftInfo.remaining_guests_capacity,
                                  Math.max(1, Number(e.target.value || 1))
                                )
                              )
                            }
                            required
                          />
                        </div>

                        <div className="rounded-lg bg-blue-50/70 border border-blue-200 px-3.5 py-2.5 text-xs text-blue-900 flex items-center justify-between">
                          <span>Cupo del turno tras tu reserva:</span>
                          <span className="font-bold">
                            {activeShiftInfo.existing_guests_count +
                              Number(guestsCount || 0)}{" "}
                            / {availability?.max_capacity} personas
                          </span>
                        </div>
                      </div>

                      {selectedAmenity?.allow_comments && (
                        <div className="space-y-1.5">
                          <Label htmlFor="booking-comments">
                            5. Comentarios / Lista de Invitados (Opcional)
                          </Label>
                          <Textarea
                            id="booking-comments"
                            placeholder="Agregá nombres de invitados o notas para Seguridad / Administración..."
                            value={comments}
                            onChange={(e) => setComments(e.target.value)}
                          />
                        </div>
                      )}

                      <Button
                        type="submit"
                        className="w-full h-11 text-base"
                        disabled={bookingSubmitting || activeShiftInfo.is_full}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {bookingSubmitting
                          ? "Confirmando reserva..."
                          : "Confirmar Reserva"}
                      </Button>
                    </div>
                  )}

                  {activeShiftInfo && activeShiftInfo.is_full && (
                    <Alert variant="destructive">
                      <Ban className="h-4 w-4" />
                      <AlertTitle>Turno sin cupo disponible</AlertTitle>
                      <AlertDescription>
                        Se alcanzó el límite máximo de personas (
                        {availability?.max_capacity}) o el máximo de reservas
                        diarias ({availability?.max_bookings_per_day}) para este
                        turno.
                      </AlertDescription>
                    </Alert>
                  )}
                </form>
              )}
            </CardContent>
          </Card>

          {/* SECCIÓN: MIS RESERVAS */}
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CalendarIcon className="h-5 w-5 text-primary" />
                  Mis Reservas Confirmadas
                </CardTitle>
                <Badge variant="secondary">{myReservations.length}</Badge>
              </div>
              <CardDescription>
                Tus reservas activas en el edificio (incluyendo amenities
                privados como Pileta).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {myReservations.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No tenés reservas futuras registradas en este momento.
                </p>
              ) : (
                <div className="space-y-3">
                  {myReservations.map((res) => (
                    <div
                      key={res.reservation_id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3.5 hover:border-slate-300 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm text-slate-900">
                            {res.amenity_name}
                          </span>
                          <Badge variant="default" className="text-[11px]">
                            {res.date}
                          </Badge>
                          <Badge variant="outline" className="text-[11px]">
                            <Users className="h-3 w-3 mr-1" />
                            {res.guests_count} invitados
                          </Badge>
                          {!res.show_on_home && (
                            <Badge variant="secondary" className="text-[10px]">
                              Oculta en Home público
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          {res.shift_label}
                        </p>
                        {res.comments && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {res.comments}
                          </p>
                        )}
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50 self-end sm:self-center shrink-0"
                        onClick={() =>
                          handleCancelReservation(res.reservation_id)
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Cancelar
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* SECCIÓN EXCLUSIVA PARA EL ÚNICO PROPIETARIO DE LA UNIDAD FUNCIONAL: GESTIÓN DE INQUILINOS */}
          {isUnitOwner && myUnitData && (
            <Card className="border-emerald-200 bg-emerald-50/20 shadow-xs">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-lg flex items-center gap-2 text-emerald-950">
                    <Home className="h-5 w-5 text-emerald-600" />
                    Mi Unidad Funcional ({myUnitData.unit_number})
                  </CardTitle>
                  <Badge variant="success">
                    Cupo UF: {myUnitData.active_count} /{" "}
                    {myUnitData.max_users_per_unit} integrantes activos
                  </Badge>
                </div>
                <CardDescription>
                  Como único Propietario designado de tu Unidad Funcional, podés
                  dar de baja del sistema a un inquilino (su email quedará
                  bloqueado por 1 año) o eliminarlo definitivamente luego de
                  darlo de baja.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(myUnitData.members || []).map((member) => {
                  const isMe = member.user_id === activeProfile?.user_id;
                  const isDeactivated = member.status === "DEACTIVATED";
                  return (
                    <div
                      key={member.user_id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3.5 ${
                        isDeactivated
                          ? "bg-slate-100 border-slate-300 opacity-85"
                          : "bg-white border-slate-200"
                      }`}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm">
                            {member.first_name} {member.last_name}
                          </span>
                          <Badge
                            variant={
                              member.resident_type === "owner"
                                ? "success"
                                : "secondary"
                            }
                          >
                            {member.resident_type === "owner"
                              ? "Propietario (Vos)"
                              : "Inquilino"}
                          </Badge>
                          {isDeactivated && (
                            <Badge variant="destructive">
                              Dado de Baja (Bloqueado 1 año)
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {member.email}
                        </p>
                      </div>

                      {!isMe && (
                        <div className="flex items-center gap-2 self-end sm:self-center">
                          {!isDeactivated ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-amber-700 border-amber-300 hover:bg-amber-50"
                              onClick={() =>
                                handleDeactivateTenant(member.user_id)
                              }
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                              Dar de Baja Inquilino
                            </Button>
                          ) : (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setTenantToPermDelete(member)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Eliminar Definitivamente
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        {/* COLUMNA DERECHA (5 cols): PANTALLA PRINCIPAL DE HORARIOS YA RESERVADOS (LISTADO / CALENDARIO) */}
        <div className="lg:col-span-5">
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="pb-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">
                    Horarios Reservados del Edificio
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Amenities públicos visibles en pantalla principal
                  </CardDescription>
                </div>

                {/* Botón para alternar entre Vista Listado y Vista Calendario */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setHomeViewMode((m) =>
                      m === "list" ? "calendar" : "list"
                    )
                  }
                  className="shrink-0 font-semibold"
                >
                  {homeViewMode === "list" ? (
                    <>
                      <CalendarDays className="h-4 w-4 text-primary" />
                      Ver como Calendario
                    </>
                  ) : (
                    <>
                      <List className="h-4 w-4 text-primary" />
                      Ver como Listado
                    </>
                  )}
                </Button>
              </div>

              {/* Filtro por tipo de Amenity público */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedAmenityFilter("ALL")}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                    selectedAmenityFilter === "ALL"
                      ? "bg-primary text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  Todos ({buildingReservations.length})
                </button>
                {publicAmenities.map((am) => (
                  <button
                    key={am.amenity_id}
                    type="button"
                    onClick={() => setSelectedAmenityFilter(am.amenity_id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                      selectedAmenityFilter === am.amenity_id
                        ? "bg-primary text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {am.name}
                  </button>
                ))}
              </div>
            </CardHeader>

            <CardContent>
              {homeViewMode === "list" ? (
                /* VISTA 1: LISTADO RESPONSIVE POR AMENITY */
                filteredPublicReservations.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    No hay reservas públicas registradas para este filtro.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
                    {filteredPublicReservations.map((res) => (
                      <div
                        key={res.reservation_id}
                        className="rounded-lg border border-slate-200 p-3 bg-slate-50/60 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm text-slate-900">
                            {res.amenity_name}
                          </span>
                          <Badge variant="default" className="text-[11px]">
                            {res.date}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-700 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-primary" />
                          {res.shift_label}
                        </p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                          <span>Unidad: {res.unit_number}</span>
                          <span className="font-medium text-slate-700">
                            {res.guests_count} invitados
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                /* VISTA 2: CALENDARIO INTERACTIVO */
                <div className="space-y-4">
                  <div className="flex justify-center rounded-xl border bg-white p-2">
                    <Calendar
                      mode="single"
                      selected={calendarViewDate}
                      onSelect={(d) => d && setCalendarViewDate(d)}
                      modifiers={{ booked: reservedDatesObjects }}
                      modifiersClassNames={{
                        booked:
                          "bg-blue-100 text-blue-900 font-bold border border-blue-300",
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Reservas del día {selectedCalendarDayStr}:
                    </h4>
                    {reservationsOnCalendarDay.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-3 text-center border rounded-lg bg-slate-50">
                        Sin reservas públicas en esta fecha.
                      </p>
                    ) : (
                      reservationsOnCalendarDay.map((res) => (
                        <div
                          key={res.reservation_id}
                          className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-slate-900">
                              {res.amenity_name}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {res.guests_count} pers.
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-700">
                            {res.shift_label} — {res.unit_number}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* CARTEL DE CONFIRMACIÓN OBLIGATORIO (AlertDialog de shadcn/ui) PARA ELIMINACIÓN DEFINITIVA DE INQUILINO DADO DE BAJA */}
      <AlertDialog
        open={Boolean(tenantToPermDelete)}
        onOpenChange={(open) => !open && setTenantToPermDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Eliminar definitivamente a este usuario?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Estás a punto de eliminar definitivamente del sistema a{" "}
              <strong>
                {tenantToPermDelete?.first_name} {tenantToPermDelete?.last_name}
              </strong>{" "}
              ({tenantToPermDelete?.email}). Esta acción borrará su registro de
              forma permanente antes del año de retención y liberará su correo
              electrónico en Cognito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmPermanentDeleteTenant}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sí, Eliminar Definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

