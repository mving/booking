import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  CalendarCheck,
  ShieldCheck,
  Settings,
  Globe,
  LogOut,
  UserCheck,
  Menu,
  X,
  KeyRound,
  Sparkles,
} from "lucide-react";
import { useAuth, DEMO_ACCOUNTS } from "@/context/AuthContext";
import { isCognitoConfigured } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Navbar() {
  const {
    meData,
    activeProfile,
    activeBuilding,
    switchDemoAccount,
    logout,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isGlobalAdmin = Boolean(meData?.is_global_admin);
  const role = activeProfile?.role || (isGlobalAdmin ? "global_admin" : null);
  const isOwner = activeProfile?.resident_type === "owner";

  const getRoleBadge = () => {
    if (isGlobalAdmin) return { text: "Admin Global", variant: "default" };
    if (role === "building_admin")
      return { text: "Admin Edificio", variant: "default" };
    if (role === "security")
      return { text: "Seguridad", variant: "warning" };
    if (isOwner)
      return { text: "Propietario UF", variant: "success" };
    return { text: "Inquilino", variant: "secondary" };
  };

  const roleBadge = getRoleBadge();
  const registerSlug = activeBuilding?.slug || "torre-libertador";

  const navItems = [
    {
      to: "/",
      label: "Reservas y Quincho",
      icon: CalendarCheck,
      show: Boolean(meData?.authenticated && role !== "security"),
    },
    {
      to: "/seguridad",
      label: "Panel Seguridad (90d)",
      icon: ShieldCheck,
      show:
        role === "security" ||
        role === "building_admin" ||
        isGlobalAdmin,
    },
    {
      to: "/admin-edificio",
      label: "Admin Edificio",
      icon: Settings,
      show: role === "building_admin" || isGlobalAdmin,
    },
    {
      to: "/admin-global",
      label: "Admin Global",
      icon: Globe,
      show: isGlobalAdmin,
    },
    {
      to: `/registro/${registerSlug}`,
      label: "URL Registro Vecinos",
      icon: KeyRound,
      show: true,
    },
  ].filter((item) => item.show);

  const handleDemoSwitch = async (email) => {
    await switchDemoAccount(email);
    if (email === "seguridad@libertador.com") {
      navigate("/seguridad");
    } else if (email === "admin@edificio.com") {
      navigate("/admin-global");
    } else if (email === "consorcio@libertador.com") {
      navigate("/admin-edificio");
    } else {
      navigate("/");
    }
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/95 backdrop-blur-xs">
      {/* Barra superior interactiva para cambiar de Rol en modo Demo / Local */}
      {!isCognitoConfigured() && (
        <div className="bg-slate-900 text-slate-100 px-3 py-1.5 text-xs border-b border-slate-800">
          <div className="container flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-medium text-amber-300">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>Simulador de Roles (Click para cambiar vista):</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {DEMO_ACCOUNTS.map((acc) => {
                const active = meData?.email === acc.email;
                return (
                  <button
                    key={acc.email}
                    onClick={() => handleDemoSwitch(acc.email)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                      active
                        ? "bg-primary text-white shadow-xs ring-1 ring-white/40"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
                    }`}
                  >
                    {acc.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="container flex h-16 items-center justify-between gap-3">
        {/* Marca y Edificio Activo */}
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/"
            className="flex items-center gap-2.5 font-bold text-slate-900 hover:opacity-90 truncate"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white shadow-xs">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="truncate">
              <span className="block text-sm sm:text-base font-bold leading-tight truncate">
                {activeBuilding?.name || "Gestión de Consorcios"}
              </span>
              <span className="block text-[11px] font-normal text-muted-foreground truncate">
                {activeBuilding?.address || "Sistema Multi-Edificio de Reservas"}
              </span>
            </div>
          </Link>
        </div>

        {/* Navegación Desktop */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Perfil de Usuario y Botón Menú Móvil */}
        <div className="flex items-center gap-2">
          {meData?.authenticated ? (
            <div className="hidden sm:flex items-center gap-2.5 pl-2 border-l">
              <div className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-xs font-semibold text-slate-900">
                    {activeProfile
                      ? `${activeProfile.first_name} ${activeProfile.last_name}`
                      : meData.email}
                  </span>
                  <Badge variant={roleBadge.variant} className="text-[10px] px-1.5 py-0">
                    {roleBadge.text}
                  </Badge>
                </div>
                <span className="block text-[11px] text-muted-foreground">
                  {activeProfile?.unit_number
                    ? `UF: ${activeProfile.unit_number}`
                    : meData.email}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="Cerrar sesión / Cambiar cuenta"
                onClick={() => {
                  logout();
                  navigate("/login");
                }}
              >
                <LogOut className="h-4 w-4 text-slate-600" />
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => navigate("/login")}>
              <UserCheck className="h-4 w-4" />
              Ingresar
            </Button>
          )}

          <Button
            variant="outline"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Abrir menú"
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>
        </div>
      </div>

      {/* Menú Desplegable Móvil (100% Responsive) */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t bg-white px-4 py-3 space-y-2 shadow-lg">
          {meData?.authenticated && (
            <div className="flex items-center justify-between pb-2 mb-2 border-b">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {activeProfile
                    ? `${activeProfile.first_name} ${activeProfile.last_name}`
                    : meData.email}
                </p>
                <p className="text-xs text-muted-foreground">
                  {activeProfile?.unit_number || meData.email}
                </p>
              </div>
              <Badge variant={roleBadge.variant}>{roleBadge.text}</Badge>
            </div>
          )}

          <div className="grid gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    isActive
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {meData?.authenticated && (
            <div className="pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-center text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => {
                  logout();
                  setMobileMenuOpen(false);
                  navigate("/login");
                }}
              >
                <LogOut className="h-4 w-4" />
                Cerrar Sesión
              </Button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

