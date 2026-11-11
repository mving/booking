# Sistema de Reservas de Amenities Multi-Consorcio

Plataforma serverless multi-edificio para la gestión y reserva de amenities (quincho, parrilla, SUM, pileta, gimnasio) con control de cupos concurrentes, turnos por día de la semana, bloqueo por mora de expensas, gestión de unidades funcionales y vista de seguridad/portería.

Para el detalle completo de arquitectura, modelo de datos Single-Table/Multi-Table en DynamoDB, flujos de autenticación y reglas de negocio, consultá [SISTEMA_RESERVAS.md](./SISTEMA_RESERVAS.md).

---

## Estructura del Proyecto

```text
├── .github/workflows/
│   ├── deploy_backend.yml       # CI/CD Terraform (S3, CloudFront, Cognito, API Gateway, Lambda, DynamoDB)
│   └── deploy_frontend.yml      # CI/CD Build de React + Vite, subida a S3 e invalidación de CloudFront
├── backend/
│   ├── functions/
│   │   ├── api/                 # API REST principal (Node.js 20.x, date-fns-tz, TransactWrite + Backoff/Jitter)
│   │   ├── pre_signup/          # Trigger Cognito Pre-SignUp
│   │   └── user_ttl_cleanup/    # Trigger DynamoDB Streams para limpieza definitiva en Cognito tras 1 año de baja
│   └── terraform/               # Infraestructura como Código (Terraform AWS)
├── frontend/                    # SPA en React 18 + Vite + Tailwind CSS + shadcn/ui
└── SISTEMA_RESERVAS.md          # Documento técnico y funcional del sistema
```

---

## Características Principales Implementadas

1. **Roles Jerárquicos**:
   - **Administrador Global (`global_admin`)**: Alta y configuración de múltiples edificios/consorcios, URL fija de registro (`/registro/:slug`), clave de acceso al registro y asignación de administradores locales.
   - **Administrador de Consorcio (`building_admin`)**:
     - Configuración de parámetros del edificio: cantidad máxima de usuarios por Unidad Funcional (`max_users_per_unit`), clave de registro y mensaje personalizado de bloqueo por deuda de expensas.
     - ABM completo de Amenities: capacidad máxima por turno, hasta 2 turnos configurables por día de la semana, modo *"Sin turnos"* (superposición permitida hasta agotar cupo), límite de reservas por día y visibilidad en pantalla principal (`show_on_home` para ocultar invitados de pileta a otros vecinos).
     - Gestión de Vecinos y Unidades Funcionales: bloqueo/desbloqueo por expensas (individual o por Unidad Funcional completa), designación de **un único Propietario (`owner`) por Unidad Funcional**, **baja lógica por 1 año** (`status = DEACTIVATED`, impidiendo re-registro con el mismo email verificado en Cognito), **reactivación** de usuarios dados de baja y **eliminación definitiva** con modal de confirmación (`AlertDialog`).
   - **Residente (`owner` / `tenant`)**:
     - Registro en URL fija del edificio (`/registro/:slug`) protegida por contraseña del consorcio, mediante Email/Contraseña (con verificación de email en Cognito) o Google SSO.
     - Reserva de amenities con calendario desplegable (`shadcn/ui`), validación de cupo remanente en tiempo real y aviso cuando ya existen reservas en el mismo turno.
     - Pantalla principal con sección **"Mis Reservas"** y cartelera general del edificio alternable entre **Vista Listado** y **Vista Calendario**.
     - Panel **"Mi Unidad Funcional"** (exclusivo para el único `owner` de la UF) que permite dar de baja a un inquilino (`tenant`) o eliminarlo definitivamente tras confirmación.
   - **Seguridad / Portería (`security`)**:
     - Vista de solo lectura de todas las reservas (incluyendo aquellas ocultas en la cartelera pública como *Invitados Pileta*) con historial de hasta **90 días hacia atrás** (purgado automático mediante DynamoDB TTL).

2. **Seguridad y Resiliencia en Backend**:
   - **Prevención de evasión de CloudFront**: Resource Policy (`aws_api_gateway_rest_api_policy`) en `backend/terraform/api_gateway.tf` que exige `aws:SourceArn` coincidente con la distribución de CloudFront, sumado a la inyección de `x-api-key` vía CloudFront Function.
   - **Determinismo Horario (`date-fns-tz`)**: Cálculo exacto de la medianoche y fecha vigente según el huso horario del consorcio (`America/Argentina/Buenos_Aires`).
   - **Control de Concurrencia con Retry (`Exponential Backoff + Jitter`)**: Uso de `TransactWriteItems` en DynamoDB con reintentos automáticos ante `TransactionConflictException` para evitar errores 500 cuando múltiples vecinos reservan el mismo turno en el mismo milisegundo.

---

## Ejecución en Entorno Local (Modo Demo Interactivo)

El servidor de desarrollo de Vite monta automáticamente el handler de la Lambda (`backend/functions/api/index.mjs`) en `/api/*` con persistencia local (`.local-db.json`) y datos semilla preconfigurados (Edificio *Torre Libertador 2450*, amenities *Quincho & Parrilla*, *Invitados Pileta* y *SUM*, y selector rápido de rol en la barra superior).

```bash
# 1. Instalar dependencias del backend API
npm --prefix backend/functions/api install

# 2. Instalar dependencias del frontend
npm --prefix frontend install

# 3. Iniciar servidor de desarrollo
npm --prefix frontend run dev
```

---

## Creación del Primer Administrador Global (Admin Maestro)

El sistema utiliza un mecanismo de **Bootstrap Automático** que no requiere insertar registros manualmente en DynamoDB:

1. **Configurar tu Email Maestro**:
   En [`backend/terraform/variables.tf`](./backend/terraform/variables.tf), asigná tu correo en la variable `initial_global_admin_email` (o pasalo en el comando de despliegue con `-var="initial_global_admin_email=tu_correo@gmail.com"`):
   ```hcl
   variable "initial_global_admin_email" {
     default = "tu_correo@gmail.com"
   }
   ```
2. **Iniciar Sesión**:
   - Accedé a la aplicación e iniciá sesión con **Google SSO** (o registrate con Email y Contraseña verificando el código de confirmación enviado por Cognito).
   - En la primera solicitud que llega a la API, la función Lambda detecta que el email verificado coincide con `INITIAL_GLOBAL_ADMIN` e inserta automáticamente el registro maestro en DynamoDB con `role: "global_admin"` y `building_id: "GLOBAL"`.
3. **Comenzar a Crear Edificios y Administradores Locales**:
   - Una vez autenticado, aparecerá en el menú superior la pestaña **"Admin Global"**.
   - Desde allí, hacés clic en **"Nuevo Edificio"**, completás el nombre, dirección, slug de la URL fija de registro (`/registro/:slug`), la contraseña del edificio y el **Email del Administrador Local**.
   - Ese administrador local podrá ingresar al sistema y configurar los amenities, horarios y vecinos de su consorcio.

---

## Despliegue en AWS (GitHub Actions)

1. **Desplegar Infraestructura y Backend**: Ejecutar el workflow `.github/workflows/deploy_backend.yml` (`Deploy Booking Backend (Terraform)`).
2. **Desplegar Frontend SPA**: Ejecutar el workflow `.github/workflows/deploy_frontend.yml` (`Deploy Booking Frontend (React + Vite to S3 & CloudFront)`), que obtiene automáticamente los outputs de Terraform (Cognito User Pool, Client ID, Dominio OAuth, Bucket S3 y Distribución CloudFront), compila la SPA y publica los artefactos.

