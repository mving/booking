import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  Search,
  Calendar as CalendarIcon,
  Users,
  Clock,
  EyeOff,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export function SecurityView() {
  const { activeBuilding } = useAuth();
  const buildingId = activeBuilding?.building_id;

  const [loading, setLoading] = useState(true);
  const [reservations, setReservations] = useState([]);
  const [amenities, setAmenities] = useState([]);
  const [todayStr, setTodayStr] = useState("");
  const [minHistoryStr, setMinHistoryStr] = useState("");

  // Filtros
  const [searchQuery, setSearchQuery] = useState("");
  const [amenityFilter, setAmenityFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("");

  const loadSecurityData = useCallback(async () => {
    if (!buildingId) return;
    setLoading(true);
    try {
      const [resData, amData] = await Promise.all([
        apiFetch(`/buildings/${buildingId}/reservations`),
        apiFetch(`/buildings/${buildingId}/amenities`),
      ]);
      setReservations(resData.reservations || []);
      setTodayStr(resData.today || "");
      setMinHistoryStr(resData.min_date || "");
      setAmenities(amData.amenities || []);
    } catch (err) {
      console.error("Error cargando vista de seguridad:", err);
    } finally {
      setLoading(false);
    }
  }, [buildingId]);

  useEffect(() => {
    loadSecurityData();
  }, [loadSecurityData]);

  const filtered = reservations.filter((r) => {
    if (amenityFilter !== "ALL" && r.amenity_id !== amenityFilter) return false;
    if (dateFilter && r.date !== dateFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = (r.user_full_name || "").toLowerCase().includes(q);
      const matchUnit = (r.unit_number || "").toLowerCase().includes(q);
      const matchComments = (r.comments || "").toLowerCase().includes(q);
      if (!matchName && !matchUnit && !matchComments) return false;
    }
    return true;
  });

  return (
    <div className="container py-6 sm:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5">
        <div>
          <div className="flex items-center gap-2 text-amber-700 font-semibold text-xs uppercase tracking-wider">
            <ShieldCheck className="h-4 w-4" />
            Modo Solo Lectura — Control de Accesos y Portería
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
            Panel de Seguridad — {activeBuilding?.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visualización completa de reservas (incluyendo amenities privados
            como Invitados Pileta) con historial de hasta{" "}
            <strong>90 días hacia atrás</strong> (desde{" "}
            <code>{minHistoryStr || "-90d"}</code>). Pasados los 90 días se
            eliminan automáticamente de la base de datos (DynamoDB TTL).
          </p>
        </div>

        <Badge variant="warning" className="py-1.5 px-3 text-xs self-start">
          Retención Automática: 90 Días
        </Badge>
      </div>

      {/* Barra de Filtros Responsiva */}
      <Card className="border-slate-200">
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Buscar por Vecino, Unidad Funcional o Invitado</Label>
              <div className="relative">
                <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-3" />
                <Input
                  className="pl-9"
                  placeholder="Ej: 4° B, Alvarez, Camila Díaz..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Filtrar por Amenity</Label>
              <Select value={amenityFilter} onValueChange={setAmenityFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos los amenities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos los amenities</SelectItem>
                  {amenities.map((a) => (
                    <SelectItem key={a.amenity_id} value={a.amenity_id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Fecha (mín: {minHistoryStr})</Label>
              <div className="flex gap-1.5">
                <Input
                  type="date"
                  min={minHistoryStr}
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
                {dateFilter && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDateFilter("")}
                  >
                    Todas
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Listado de Reservas para Seguridad */}
      <Card className="border-slate-200">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">
              Registro de Reservas ({filtered.length})
            </CardTitle>
            <CardDescription>
              Ordenadas cronológicamente (incluye reservas del día, futuras e
              histórico de 90 días).
            </CardDescription>
          </div>
          {todayStr && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDateFilter((prev) => (prev === todayStr ? "" : todayStr))
              }
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              {dateFilter === todayStr ? "Ver Todos los Días" : "Solo Hoy"}
            </Button>
          )}
        </CardHeader>

        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Cargando reservas para Seguridad...
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No se encontraron reservas para los filtros seleccionados.
            </p>
          ) : (
            <div className="grid gap-3">
              {filtered.map((res) => {
                const isToday = res.date === todayStr;
                const isPast = res.date < todayStr;
                return (
                  <div
                    key={res.reservation_id}
                    className={`rounded-xl border p-4 transition-colors ${
                      isToday
                        ? "border-blue-300 bg-blue-50/40"
                        : isPast
                        ? "border-slate-200 bg-slate-50/70"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-base text-slate-900">
                          {res.amenity_name}
                        </span>
                        <Badge
                          variant={
                            isToday
                              ? "default"
                              : isPast
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {res.date} {isToday ? "(HOY)" : isPast ? "(Histórico)" : ""}
                        </Badge>
                        {!res.show_on_home && (
                          <Badge variant="warning" className="gap-1">
                            <EyeOff className="h-3 w-3" />
                            Privada (Oculta en Home de vecinos)
                          </Badge>
                        )}
                      </div>

                      <Badge variant="success" className="self-start sm:self-center">
                        <Users className="h-3.5 w-3.5 mr-1" />
                        {res.guests_count} invitados autorizados
                      </Badge>
                    </div>

                    <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs sm:text-sm text-slate-700">
                      <div>
                        <span className="text-muted-foreground">Vecino: </span>
                        <strong className="text-slate-900">
                          {res.user_full_name}
                        </strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Unidad Funcional:{" "}
                        </span>
                        <strong className="text-slate-900">
                          {res.unit_number}
                        </strong>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span>{res.shift_label}</span>
                      </div>
                    </div>

                    {res.comments && (
                      <div className="mt-2.5 rounded-lg bg-white border border-slate-200 px-3 py-2 text-xs text-slate-700 flex items-start gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                        <div>
                          <span className="font-semibold">
                            Comentarios / Lista de invitados:{" "}
                          </span>
                          {res.comments}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

