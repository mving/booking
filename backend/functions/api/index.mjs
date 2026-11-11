import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { subDays, addDays, parseISO } from "date-fns";

const IS_LOCAL_DEV = process.env.LOCAL_DEV === "true";

const BUILDINGS_TABLE = process.env.BUILDINGS_TABLE || "booking_buildings";
const USERS_TABLE = process.env.USERS_TABLE || "booking_users";
const AMENITIES_TABLE = process.env.AMENITIES_TABLE || "booking_amenities";
const RESERVATIONS_TABLE = process.env.RESERVATIONS_TABLE || "booking_reservations";
const REGISTRATION_TOKEN_SECRET =
  process.env.REGISTRATION_TOKEN_SECRET || "local-dev-secret-key-booking-2026";
const INITIAL_GLOBAL_ADMIN = (
  process.env.INITIAL_GLOBAL_ADMIN || "manuelvidal097@gmail.com"
).toLowerCase();
const USER_POOL_ID = process.env.USER_POOL_ID || "";

// Lazy-loaded AWS SDK clients when running in AWS Lambda
let ddbDocClient = null;
let ddbCommands = null;
let cognitoClient = null;
let cognitoCommands = null;

async function getAwsClients() {
  if (IS_LOCAL_DEV) return null;
  if (!ddbDocClient) {
    const ddbModule = await import("@aws-sdk/client-dynamodb");
    const libDdbModule = await import("@aws-sdk/lib-dynamodb");
    const cogModule = await import("@aws-sdk/client-cognito-identity-provider");

    const rawClient = new ddbModule.DynamoDBClient({});
    ddbDocClient = libDdbModule.DynamoDBDocumentClient.from(rawClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
    ddbCommands = libDdbModule;

    cognitoClient = new cogModule.CognitoIdentityProviderClient({});
    cognitoCommands = cogModule;
  }
  return { ddbDocClient, ddbCommands, cognitoClient, cognitoCommands };
}

// ============================================================================
// UTILIDADES DETERMINISTAS DE ZONA HORARIA (date-fns-tz) Y NORMALIZACIÓN
// ============================================================================

export function getTodayInTimezone(tz = "America/Argentina/Buenos_Aires") {
  return formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
}

export function getMinHistoryDateInTimezone(
  tz = "America/Argentina/Buenos_Aires",
  daysBack = 90
) {
  const zonedNow = toZonedTime(new Date(), tz);
  const pastDate = subDays(zonedNow, daysBack);
  return formatInTimeZone(pastDate, tz, "yyyy-MM-dd");
}

export function getDayOfWeekFromDateStr(dateStr) {
  // dateStr formato YYYY-MM-DD -> 0 (Domingo) a 6 (Sábado)
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return utcDate.getUTCDay();
}

export function computeReservationTtlEpoch(
  dateStr,
  tz = "America/Argentina/Buenos_Aires",
  retentionDays = 90
) {
  const parsed = parseISO(`${dateStr}T23:59:59`);
  const expireDate = addDays(parsed, retentionDays);
  return Math.floor(expireDate.getTime() / 1000);
}

export function computeDeactivatedUserTtlEpoch(retentionDays = 365) {
  return Math.floor(Date.now() / 1000) + retentionDays * 86400;
}

export function normalizeUnitKey(unitNumber = "") {
  return String(unitNumber)
    .toUpperCase()
    .replace(/\b(UF|UNIDAD|FUNCIONAL|PISO|DPTO|DTO|DEPTO)\b/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

export function hashPassword(password) {
  return crypto
    .createHmac("sha256", REGISTRATION_TOKEN_SECRET)
    .update(String(password))
    .digest("hex");
}

export function createRegistrationToken(buildingId, slug) {
  const exp = Math.floor(Date.now() / 1000) + 1800; // 30 minutos
  const payload = JSON.stringify({ building_id: buildingId, slug, exp });
  const b64 = Buffer.from(payload).toString("base64url");
  const sig = crypto
    .createHmac("sha256", REGISTRATION_TOKEN_SECRET)
    .update(b64)
    .digest("base64url");
  return `${b64}.${sig}`;
}

export function verifyRegistrationToken(token) {
  if (!token || !token.includes(".")) return null;
  const [b64, sig] = token.split(".");
  const expectedSig = crypto
    .createHmac("sha256", REGISTRATION_TOKEN_SECRET)
    .update(b64)
    .digest("base64url");
  if (sig !== expectedSig) return null;
  try {
    const data = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

// ============================================================================
// EXPONENTIAL BACKOFF + JITTER PARA TRANSACCIONES DYNAMODB
// ============================================================================

function sleepWithJitter(attempt) {
  const minMs = 25;
  const maxMs = Math.pow(2, attempt) * 65;
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function isTransactionConflictError(err) {
  if (!err) return false;
  if (err.name === "TransactionConflictException") return true;
  if (err.name === "TransactionCanceledException") {
    const reasons = err.CancellationReasons || [];
    return reasons.some((r) => r.Code === "TransactionConflict");
  }
  return String(err.message || "").includes("TransactionConflict");
}

// ============================================================================
// CAPA DE ALMACENAMIENTO UNIFICADA (AWS DYNAMODB + LOCAL DEV SEEDED STORE)
// ============================================================================

const LOCAL_DB_FILE = path.resolve(process.cwd(), ".local-booking-db.json");

function getInitialSeedData() {
  const today = getTodayInTimezone("America/Argentina/Buenos_Aires");
  const tomorrow = formatInTimeZone(
    addDays(new Date(), 1),
    "America/Argentina/Buenos_Aires",
    "yyyy-MM-dd"
  );
  const twoDaysAgo = formatInTimeZone(
    subDays(new Date(), 2),
    "America/Argentina/Buenos_Aires",
    "yyyy-MM-dd"
  );

  const defaultScheduleTwoShifts = {};
  const defaultSchedulePool = {};
  for (let d = 0; d <= 6; d++) {
    defaultScheduleTwoShifts[String(d)] = {
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
    defaultSchedulePool[String(d)] = {
      enabled: true,
      shifts: [
        {
          id: "SHIFT_1",
          name: "Horario Completo Pileta",
          start_time: "09:00",
          end_time: "20:00",
        },
      ],
    };
  }

  return {
    buildings: [
      {
        building_id: "bldg-libertador-01",
        slug: "torre-libertador",
        name: "Torre Libertador 2400",
        address: "Av. del Libertador 2400, CABA",
        registration_password_hash: hashPassword("QUINCHO2026"),
        registration_password_hint: "QUINCHO2026",
        max_users_per_unit: 3,
        blocked_user_message:
          "No puede efectuar reservas de amenities por registrar deuda de expensas pendiente. Por favor, comuníquese con la administración del consorcio.",
        timezone: "America/Argentina/Buenos_Aires",
        blocked_units: ["5C"],
        is_active: true,
        created_at: new Date().toISOString(),
      },
      {
        building_id: "bldg-palermo-02",
        slug: "aires-palermo",
        name: "Aires de Palermo Soho",
        address: "Thames 1850, CABA",
        registration_password_hash: hashPassword("PALERMO2026"),
        registration_password_hint: "PALERMO2026",
        max_users_per_unit: 2,
        blocked_user_message:
          "Su unidad funcional presenta saldo pendiente de expensas. Regularice su situación para reservar.",
        timezone: "America/Argentina/Buenos_Aires",
        blocked_units: [],
        is_active: true,
        created_at: new Date().toISOString(),
      },
    ],
    users: [
      {
        user_id: "usr-global-admin",
        building_id: "GLOBAL",
        email: "admin@edificio.com",
        first_name: "Manuel",
        last_name: "Administrador Global",
        unit_number: "ADMIN-GLOBAL",
        unit_key: "ADMINGLOBAL",
        resident_type: "staff",
        role: "global_admin",
        status: "ACTIVE",
        is_blocked: false,
        email_verified: true,
        created_at: new Date().toISOString(),
      },
      {
        user_id: "usr-local-admin-1",
        building_id: "bldg-libertador-01",
        email: "consorcio@libertador.com",
        first_name: "Laura",
        last_name: "Gómez (Admin Edificio)",
        unit_number: "Administración",
        unit_key: "ADM",
        resident_type: "staff",
        role: "building_admin",
        status: "ACTIVE",
        is_blocked: false,
        email_verified: true,
        created_at: new Date().toISOString(),
      },
      {
        user_id: "usr-owner-4b",
        building_id: "bldg-libertador-01",
        email: "propietario4b@gmail.com",
        first_name: "Martín",
        last_name: "Alvarez",
        unit_number: "UF 42 - 4° B",
        unit_key: "424B",
        resident_type: "owner",
        role: "resident",
        status: "ACTIVE",
        is_blocked: false,
        email_verified: true,
        created_at: new Date().toISOString(),
      },
      {
        user_id: "usr-tenant-4b",
        building_id: "bldg-libertador-01",
        email: "inquilino4b@gmail.com",
        first_name: "Sofía",
        last_name: "Pereyra",
        unit_number: "UF 42 - 4° B",
        unit_key: "424B",
        resident_type: "tenant",
        role: "resident",
        status: "ACTIVE",
        is_blocked: false,
        email_verified: true,
        created_at: new Date().toISOString(),
      },
      {
        user_id: "usr-blocked-5c",
        building_id: "bldg-libertador-01",
        email: "deudor5c@gmail.com",
        first_name: "Roberto",
        last_name: "Sánchez",
        unit_number: "UF 53 - 5° C",
        unit_key: "535C",
        resident_type: "owner",
        role: "resident",
        status: "ACTIVE",
        is_blocked: true,
        email_verified: true,
        created_at: new Date().toISOString(),
      },
      {
        user_id: "usr-deactivated-4b",
        building_id: "bldg-libertador-01",
        email: "exinquilino@gmail.com",
        first_name: "Lucas",
        last_name: "Méndez (Ex Inquilino)",
        unit_number: "UF 42 - 4° B",
        unit_key: "424B",
        resident_type: "tenant",
        role: "resident",
        status: "DEACTIVATED",
        is_blocked: false,
        email_verified: true,
        deactivated_at: new Date().toISOString(),
        deactivated_by: "usr-owner-4b (owner)",
        ttl: computeDeactivatedUserTtlEpoch(365),
        created_at: new Date().toISOString(),
      },
      {
        user_id: "usr-security-1",
        building_id: "bldg-libertador-01",
        email: "seguridad@libertador.com",
        first_name: "Jorge",
        last_name: "Guardia Portería",
        unit_number: "Garita Principal",
        unit_key: "SEGURIDAD",
        resident_type: "staff",
        role: "security",
        status: "ACTIVE",
        is_blocked: false,
        email_verified: true,
        created_at: new Date().toISOString(),
      },
    ],
    amenities: [
      {
        building_id: "bldg-libertador-01",
        amenity_id: "am-quincho-parrilla",
        name: "Reserva Parrilla / Quincho",
        description:
          "Sector de parrillas y mesas del quincho. Permite compartir espacio entre vecinos hasta cubrir la capacidad máxima de 20 personas por turno.",
        allow_comments: true,
        max_capacity: 20,
        max_bookings_per_day: 4,
        no_shifts: false,
        show_on_home: true,
        schedule: defaultScheduleTwoShifts,
        is_active: true,
        created_at: new Date().toISOString(),
      },
      {
        building_id: "bldg-libertador-01",
        amenity_id: "am-pileta-invitados",
        name: "Invitados Pileta",
        description:
          "Registro obligatorio de invitados para uso de pileta y solárium. Por privacidad entre vecinos no se publica en la pantalla principal (visible solo en Mis Reservas, Administración y Seguridad).",
        allow_comments: true,
        max_capacity: 15,
        max_bookings_per_day: 6,
        no_shifts: true,
        show_on_home: false,
        schedule: defaultSchedulePool,
        is_active: true,
        created_at: new Date().toISOString(),
      },
      {
        building_id: "bldg-libertador-01",
        amenity_id: "am-sum-exclusivo",
        name: "SUM Principal (Exclusivo)",
        description:
          "Salón de Usos Múltiples de uso exclusivo (máximo 1 reserva por día/turno, hasta 35 invitados).",
        allow_comments: true,
        max_capacity: 35,
        max_bookings_per_day: 1,
        no_shifts: false,
        show_on_home: true,
        schedule: defaultScheduleTwoShifts,
        is_active: true,
        created_at: new Date().toISOString(),
      },
    ],
    reservations: [
      {
        building_id: "bldg-libertador-01",
        reservation_sk: `DATE#${today}#AMENITY#am-quincho-parrilla#RES#res-demo-1`,
        reservation_id: "res-demo-1",
        user_id: "usr-owner-4b",
        user_full_name: "Martín Alvarez",
        unit_number: "UF 42 - 4° B",
        unit_key: "424B",
        amenity_id: "am-quincho-parrilla",
        amenity_name: "Reserva Parrilla / Quincho",
        date: today,
        shift_id: "SHIFT_2",
        shift_label: "Turno Noche (19:30 - 01:30)",
        custom_time: "20:00",
        guests_count: 10,
        comments: "Cena familiar - Familia Alvarez (10 invitados)",
        show_on_home: true,
        status: "CONFIRMED",
        created_at: new Date().toISOString(),
        ttl: computeReservationTtlEpoch(today),
      },
      {
        building_id: "bldg-libertador-01",
        reservation_sk: `DATE#${today}#AMENITY#am-pileta-invitados#RES#res-demo-2`,
        reservation_id: "res-demo-2",
        user_id: "usr-tenant-4b",
        user_full_name: "Sofía Pereyra",
        unit_number: "UF 42 - 4° B",
        unit_key: "424B",
        amenity_id: "am-pileta-invitados",
        amenity_name: "Invitados Pileta",
        date: today,
        shift_id: "NO_SHIFT",
        shift_label: "Sin turno fijo (Ingreso 14:30 hs)",
        custom_time: "14:30",
        guests_count: 4,
        comments: "Invitados: Camila Díaz, Tomás Ruiz, Julieta Paz y Nicolás Gil",
        show_on_home: false,
        status: "CONFIRMED",
        created_at: new Date().toISOString(),
        ttl: computeReservationTtlEpoch(today),
      },
      {
        building_id: "bldg-libertador-01",
        reservation_sk: `DATE#${tomorrow}#AMENITY#am-quincho-parrilla#RES#res-demo-3`,
        reservation_id: "res-demo-3",
        user_id: "usr-tenant-4b",
        user_full_name: "Sofía Pereyra",
        unit_number: "UF 42 - 4° B",
        unit_key: "424B",
        amenity_id: "am-quincho-parrilla",
        amenity_name: "Reserva Parrilla / Quincho",
        date: tomorrow,
        shift_id: "SHIFT_1",
        shift_label: "Turno Mediodía (11:00 - 16:30)",
        custom_time: "12:00",
        guests_count: 8,
        comments: "Almuerzo con amigos",
        show_on_home: true,
        status: "CONFIRMED",
        created_at: new Date().toISOString(),
        ttl: computeReservationTtlEpoch(tomorrow),
      },
      {
        building_id: "bldg-libertador-01",
        reservation_sk: `DATE#${twoDaysAgo}#AMENITY#am-quincho-parrilla#RES#res-demo-past`,
        reservation_id: "res-demo-past",
        user_id: "usr-owner-4b",
        user_full_name: "Martín Alvarez",
        unit_number: "UF 42 - 4° B",
        unit_key: "424B",
        amenity_id: "am-quincho-parrilla",
        amenity_name: "Reserva Parrilla / Quincho",
        date: twoDaysAgo,
        shift_id: "SHIFT_2",
        shift_label: "Turno Noche (19:30 - 01:30)",
        custom_time: "20:30",
        guests_count: 12,
        comments: "Reserva histórica dentro de la ventana de 90 días",
        show_on_home: true,
        status: "CONFIRMED",
        created_at: new Date().toISOString(),
        ttl: computeReservationTtlEpoch(twoDaysAgo),
      },
    ],
  };
}

function loadLocalDb() {
  try {
    if (fs.existsSync(LOCAL_DB_FILE)) {
      return JSON.parse(fs.readFileSync(LOCAL_DB_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error leyendo base local:", e);
  }
  const seed = getInitialSeedData();
  saveLocalDb(seed);
  return seed;
}

function saveLocalDb(data) {
  try {
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("Error guardando base local:", e);
  }
}

// ============================================================================
// OPERACIONES DEL REPOSITORIO (AWS DYNAMODB Ó LOCAL STORE)
// ============================================================================

const repo = {
  async listBuildings() {
    if (IS_LOCAL_DEV) {
      return loadLocalDb().buildings;
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const res = await ddbDocClient.send(
      new ddbCommands.ScanCommand({ TableName: BUILDINGS_TABLE })
    );
    return res.Items || [];
  },

  async getBuildingById(buildingId) {
    if (IS_LOCAL_DEV) {
      return (
        loadLocalDb().buildings.find((b) => b.building_id === buildingId) ||
        null
      );
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const res = await ddbDocClient.send(
      new ddbCommands.GetCommand({
        TableName: BUILDINGS_TABLE,
        Key: { building_id: buildingId },
      })
    );
    return res.Item || null;
  },

  async getBuildingBySlug(slug) {
    const cleanSlug = String(slug || "").trim().toLowerCase();
    if (IS_LOCAL_DEV) {
      return (
        loadLocalDb().buildings.find(
          (b) => b.slug.toLowerCase() === cleanSlug
        ) || null
      );
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const res = await ddbDocClient.send(
      new ddbCommands.QueryCommand({
        TableName: BUILDINGS_TABLE,
        IndexName: "slug-index",
        KeyConditionExpression: "slug = :slug",
        ExpressionAttributeValues: { ":slug": cleanSlug },
      })
    );
    return (res.Items && res.Items[0]) || null;
  },

  async putBuilding(building) {
    if (IS_LOCAL_DEV) {
      const db = loadLocalDb();
      const idx = db.buildings.findIndex(
        (b) => b.building_id === building.building_id
      );
      if (idx >= 0) db.buildings[idx] = building;
      else db.buildings.push(building);
      saveLocalDb(db);
      return building;
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    await ddbDocClient.send(
      new ddbCommands.PutCommand({
        TableName: BUILDINGS_TABLE,
        Item: building,
      })
    );
    return building;
  },

  async getUsersByEmail(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (IS_LOCAL_DEV) {
      return loadLocalDb().users.filter(
        (u) => u.email.toLowerCase() === cleanEmail
      );
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const res = await ddbDocClient.send(
      new ddbCommands.QueryCommand({
        TableName: USERS_TABLE,
        IndexName: "email-index",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: { ":email": cleanEmail },
      })
    );
    return res.Items || [];
  },

  async getUsersByBuilding(buildingId) {
    if (IS_LOCAL_DEV) {
      return loadLocalDb().users.filter((u) => u.building_id === buildingId);
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const res = await ddbDocClient.send(
      new ddbCommands.QueryCommand({
        TableName: USERS_TABLE,
        IndexName: "building-unit-index",
        KeyConditionExpression: "building_id = :b",
        ExpressionAttributeValues: { ":b": buildingId },
      })
    );
    return res.Items || [];
  },

  async getUser(userId, buildingId) {
    if (IS_LOCAL_DEV) {
      return (
        loadLocalDb().users.find(
          (u) => u.user_id === userId && u.building_id === buildingId
        ) || null
      );
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const res = await ddbDocClient.send(
      new ddbCommands.GetCommand({
        TableName: USERS_TABLE,
        Key: { user_id: userId, building_id: buildingId },
      })
    );
    return res.Item || null;
  },

  async putUser(user) {
    if (IS_LOCAL_DEV) {
      const db = loadLocalDb();
      const idx = db.users.findIndex(
        (u) =>
          u.user_id === user.user_id && u.building_id === user.building_id
      );
      if (idx >= 0) db.users[idx] = user;
      else db.users.push(user);
      saveLocalDb(db);
      return user;
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    await ddbDocClient.send(
      new ddbCommands.PutCommand({
        TableName: USERS_TABLE,
        Item: user,
      })
    );
    return user;
  },

  async deleteUserPermanently(userId, buildingId, email) {
    if (IS_LOCAL_DEV) {
      const db = loadLocalDb();
      db.users = db.users.filter(
        (u) => !(u.user_id === userId && u.building_id === buildingId)
      );
      saveLocalDb(db);
      return;
    }
    const { ddbDocClient, ddbCommands, cognitoClient, cognitoCommands } =
      await getAwsClients();
    await ddbDocClient.send(
      new ddbCommands.DeleteCommand({
        TableName: USERS_TABLE,
        Key: { user_id: userId, building_id: buildingId },
      })
    );

    if (USER_POOL_ID && email) {
      try {
        const listRes = await cognitoClient.send(
          new cognitoCommands.ListUsersCommand({
            UserPoolId: USER_POOL_ID,
            Filter: `email = "${email}"`,
          })
        );
        for (const u of listRes.Users || []) {
          if (u.Username) {
            await cognitoClient.send(
              new cognitoCommands.AdminDeleteUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: u.Username,
              })
            );
          }
        }
      } catch (err) {
        console.warn("Aviso al eliminar en Cognito:", err.message);
      }
    }
  },

  async setCognitoUserEnabled(email, enabled) {
    if (IS_LOCAL_DEV || !USER_POOL_ID || !email) return;
    try {
      const { cognitoClient, cognitoCommands } = await getAwsClients();
      const listRes = await cognitoClient.send(
        new cognitoCommands.ListUsersCommand({
          UserPoolId: USER_POOL_ID,
          Filter: `email = "${email}"`,
        })
      );
      for (const u of listRes.Users || []) {
        if (!u.Username) continue;
        if (enabled) {
          await cognitoClient.send(
            new cognitoCommands.AdminEnableUserCommand({
              UserPoolId: USER_POOL_ID,
              Username: u.Username,
            })
          );
        } else {
          await cognitoClient.send(
            new cognitoCommands.AdminUserGlobalSignOutCommand({
              UserPoolId: USER_POOL_ID,
              Username: u.Username,
            })
          );
          await cognitoClient.send(
            new cognitoCommands.AdminDisableUserCommand({
              UserPoolId: USER_POOL_ID,
              Username: u.Username,
            })
          );
        }
      }
    } catch (err) {
      console.warn("Aviso actualizando estado en Cognito:", err.message);
    }
  },

  async listAmenities(buildingId) {
    if (IS_LOCAL_DEV) {
      return loadLocalDb().amenities.filter(
        (a) => a.building_id === buildingId
      );
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const res = await ddbDocClient.send(
      new ddbCommands.QueryCommand({
        TableName: AMENITIES_TABLE,
        KeyConditionExpression: "building_id = :b",
        ExpressionAttributeValues: { ":b": buildingId },
      })
    );
    return res.Items || [];
  },

  async getAmenity(buildingId, amenityId) {
    if (IS_LOCAL_DEV) {
      return (
        loadLocalDb().amenities.find(
          (a) => a.building_id === buildingId && a.amenity_id === amenityId
        ) || null
      );
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const res = await ddbDocClient.send(
      new ddbCommands.GetCommand({
        TableName: AMENITIES_TABLE,
        Key: { building_id: buildingId, amenity_id: amenityId },
      })
    );
    return res.Item || null;
  },

  async putAmenity(amenity) {
    if (IS_LOCAL_DEV) {
      const db = loadLocalDb();
      const idx = db.amenities.findIndex(
        (a) =>
          a.building_id === amenity.building_id &&
          a.amenity_id === amenity.amenity_id
      );
      if (idx >= 0) db.amenities[idx] = amenity;
      else db.amenities.push(amenity);
      saveLocalDb(db);
      return amenity;
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    await ddbDocClient.send(
      new ddbCommands.PutCommand({
        TableName: AMENITIES_TABLE,
        Item: amenity,
      })
    );
    return amenity;
  },

  async deleteAmenity(buildingId, amenityId) {
    if (IS_LOCAL_DEV) {
      const db = loadLocalDb();
      db.amenities = db.amenities.filter(
        (a) => !(a.building_id === buildingId && a.amenity_id === amenityId)
      );
      saveLocalDb(db);
      return;
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    await ddbDocClient.send(
      new ddbCommands.DeleteCommand({
        TableName: AMENITIES_TABLE,
        Key: { building_id: buildingId, amenity_id: amenityId },
      })
    );
  },

  async listReservationsByBuilding(buildingId, fromDateStr) {
    if (IS_LOCAL_DEV) {
      const nowEpoch = Math.floor(Date.now() / 1000);
      return loadLocalDb().reservations.filter(
        (r) =>
          r.building_id === buildingId &&
          r.reservation_sk?.startsWith("DATE#") &&
          (!fromDateStr || r.date >= fromDateStr) &&
          (!r.ttl || r.ttl > nowEpoch)
      );
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const skPrefix = fromDateStr ? `DATE#${fromDateStr}` : "DATE#";
    const res = await ddbDocClient.send(
      new ddbCommands.QueryCommand({
        TableName: RESERVATIONS_TABLE,
        KeyConditionExpression:
          "building_id = :b AND reservation_sk >= :skPrefix",
        ExpressionAttributeValues: {
          ":b": buildingId,
          ":skPrefix": skPrefix,
        },
      })
    );
    return (res.Items || []).filter((r) =>
      r.reservation_sk?.startsWith("DATE#")
    );
  },

  async listReservationsByBuildingAndDate(buildingId, dateStr, amenityId) {
    const prefix = amenityId
      ? `DATE#${dateStr}#AMENITY#${amenityId}#`
      : `DATE#${dateStr}#`;
    if (IS_LOCAL_DEV) {
      return loadLocalDb().reservations.filter(
        (r) =>
          r.building_id === buildingId &&
          r.reservation_sk?.startsWith(prefix) &&
          r.status === "CONFIRMED"
      );
    }
    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const res = await ddbDocClient.send(
      new ddbCommands.QueryCommand({
        TableName: RESERVATIONS_TABLE,
        KeyConditionExpression:
          "building_id = :b AND begins_with(reservation_sk, :prefix)",
        ExpressionAttributeValues: {
          ":b": buildingId,
          ":prefix": prefix,
        },
      })
    );
    return (res.Items || []).filter((r) => r.status === "CONFIRMED");
  },

  // Creación de Reserva con TransactWriteItems + Exponential Backoff & Jitter
  async createReservationAtomic(reservation, amenity) {
    const maxAttempts = 4;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await sleepWithJitter(attempt);
      }

      try {
        // 1. Re-consultar el cupo restante actualizado en este instante
        const sameDayConfirmed = await this.listReservationsByBuildingAndDate(
          reservation.building_id,
          reservation.date,
          reservation.amenity_id
        );

        const sameShiftReservations = reservation.shift_id === "NO_SHIFT"
          ? sameDayConfirmed
          : sameDayConfirmed.filter((r) => r.shift_id === reservation.shift_id);

        const currentGuestsInShift = sameShiftReservations.reduce(
          (sum, r) => sum + Number(r.guests_count || 0),
          0
        );
        const currentBookingsInDay = sameDayConfirmed.length;

        const remainingGuests = amenity.max_capacity - currentGuestsInShift;
        if (currentBookingsInDay >= amenity.max_bookings_per_day) {
          const err = new Error(
            `Se alcanzó la cantidad máxima de reservas por día (${amenity.max_bookings_per_day}) para ${amenity.name} en la fecha seleccionada.`
          );
          err.statusCode = 409;
          throw err;
        }

        if (reservation.guests_count > remainingGuests) {
          const err = new Error(
            remainingGuests <= 0
              ? `El turno seleccionado ya no tiene cupo de invitados disponible (ocupado: ${currentGuestsInShift}/${amenity.max_capacity}).`
              : `No se puede superar la capacidad máxima del edificio (${amenity.max_capacity} personas). Actualmente existen reservas en este turno por ${currentGuestsInShift} personas; solo podés reservar para un máximo de ${remainingGuests} personas.`
          );
          err.statusCode = 409;
          throw err;
        }

        if (IS_LOCAL_DEV) {
          const db = loadLocalDb();
          db.reservations.push(reservation);
          saveLocalDb(db);
          return reservation;
        }

        // 2. Transacción atómica en DynamoDB sobre el contador de turno (SLOT#) + contador diario (DAY#) + la reserva
        const { ddbDocClient, ddbCommands } = await getAwsClients();
        const slotSk = `SLOT#${reservation.date}#AMENITY#${reservation.amenity_id}#SHIFT#${reservation.shift_id}`;
        const daySk = `DAY#${reservation.date}#AMENITY#${reservation.amenity_id}`;
        const maxGuestsAllowedBefore =
          amenity.max_capacity - reservation.guests_count;
        const maxDayBookingsBefore = amenity.max_bookings_per_day - 1;

        await ddbDocClient.send(
          new ddbCommands.TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: RESERVATIONS_TABLE,
                  Key: {
                    building_id: reservation.building_id,
                    reservation_sk: slotSk,
                  },
                  UpdateExpression:
                    "SET guests_count = if_not_exists(guests_count, :zero) + :guests, bookings_count = if_not_exists(bookings_count, :zero) + :one, #ttl = :ttl",
                  ConditionExpression:
                    "attribute_not_exists(guests_count) OR guests_count <= :maxGuestsBefore",
                  ExpressionAttributeNames: {
                    "#ttl": "ttl",
                  },
                  ExpressionAttributeValues: {
                    ":zero": 0,
                    ":one": 1,
                    ":guests": reservation.guests_count,
                    ":maxGuestsBefore": maxGuestsAllowedBefore,
                    ":ttl": reservation.ttl,
                  },
                },
              },
              {
                Update: {
                  TableName: RESERVATIONS_TABLE,
                  Key: {
                    building_id: reservation.building_id,
                    reservation_sk: daySk,
                  },
                  UpdateExpression:
                    "SET bookings_count = if_not_exists(bookings_count, :zero) + :one, #ttl = :ttl",
                  ConditionExpression:
                    "attribute_not_exists(bookings_count) OR bookings_count <= :maxDayBefore",
                  ExpressionAttributeNames: {
                    "#ttl": "ttl",
                  },
                  ExpressionAttributeValues: {
                    ":zero": 0,
                    ":one": 1,
                    ":maxDayBefore": maxDayBookingsBefore,
                    ":ttl": reservation.ttl,
                  },
                },
              },
              {
                Put: {
                  TableName: RESERVATIONS_TABLE,
                  Item: reservation,
                  ConditionExpression: "attribute_not_exists(reservation_sk)",
                },
              },
            ],
          })
        );

        return reservation;
      } catch (err) {
        lastError = err;
        if (err.statusCode === 409) {
          throw err;
        }
        if (isTransactionConflictError(err) && attempt < maxAttempts - 1) {
          console.warn(
            `Conflicto de transacción en DynamoDB (intento ${attempt + 1}/${maxAttempts}), aplicando Exponential Backoff + Jitter...`
          );
          continue;
        }
        if (err.name === "TransactionCanceledException") {
          const conflictErr = new Error(
            "El cupo del turno acaba de ser actualizado por otro vecino. Por favor, verificá la disponibilidad restante e intentá nuevamente."
          );
          conflictErr.statusCode = 409;
          throw conflictErr;
        }
        throw err;
      }
    }

    throw lastError;
  },

  async cancelReservation(buildingId, reservationId) {
    if (IS_LOCAL_DEV) {
      const db = loadLocalDb();
      const target = db.reservations.find(
        (r) =>
          r.building_id === buildingId && r.reservation_id === reservationId
      );
      if (!target) return null;
      target.status = "CANCELLED";
      saveLocalDb(db);
      return target;
    }

    const { ddbDocClient, ddbCommands } = await getAwsClients();
    const queryRes = await ddbDocClient.send(
      new ddbCommands.QueryCommand({
        TableName: RESERVATIONS_TABLE,
        IndexName: "reservation-id-index",
        KeyConditionExpression: "reservation_id = :rid",
        ExpressionAttributeValues: { ":rid": reservationId },
      })
    );
    const target = (queryRes.Items || []).find(
      (r) => r.building_id === buildingId
    );
    if (!target || target.status === "CANCELLED") return target || null;

    const slotSk = `SLOT#${target.date}#AMENITY#${target.amenity_id}#SHIFT#${target.shift_id}`;
    const daySk = `DAY#${target.date}#AMENITY#${target.amenity_id}`;

    await ddbDocClient.send(
      new ddbCommands.TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: RESERVATIONS_TABLE,
              Key: {
                building_id: buildingId,
                reservation_sk: target.reservation_sk,
              },
              UpdateExpression: "SET #status = :cancelled",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: { ":cancelled": "CANCELLED" },
            },
          },
          {
            Update: {
              TableName: RESERVATIONS_TABLE,
              Key: { building_id: buildingId, reservation_sk: slotSk },
              UpdateExpression:
                "SET guests_count = guests_count - :guests, bookings_count = bookings_count - :one",
              ExpressionAttributeValues: {
                ":guests": target.guests_count,
                ":one": 1,
              },
            },
          },
          {
            Update: {
              TableName: RESERVATIONS_TABLE,
              Key: { building_id: buildingId, reservation_sk: daySk },
              UpdateExpression: "SET bookings_count = bookings_count - :one",
              ExpressionAttributeValues: { ":one": 1 },
            },
          },
        ],
      })
    );

    target.status = "CANCELLED";
    return target;
  },

  async cancelFutureReservationsForUser(buildingId, userId, todayStr) {
    const allBuildingRes = await this.listReservationsByBuilding(
      buildingId,
      todayStr
    );
    const userFutureRes = allBuildingRes.filter(
      (r) => r.user_id === userId && r.status === "CONFIRMED"
    );
    for (const r of userFutureRes) {
      await this.cancelReservation(buildingId, r.reservation_id);
    }
    return userFutureRes.length;
  },
};

// ============================================================================
// EXTRACCIÓN DE IDENTIDAD (COGNITO AUTHORIZER CLAIMS / JWT / DEMO HEADER)
// ============================================================================

function parseAuthIdentity(event) {
  // 1. Claims provistos por API Gateway Cognito User Pools Authorizer
  const claims = event?.requestContext?.authorizer?.claims;
  if (claims && claims.email) {
    return {
      sub: claims.sub || claims["cognito:username"],
      email: String(claims.email).toLowerCase(),
      email_verified:
        claims.email_verified === "true" || claims.email_verified === true,
      given_name: claims.given_name || "",
      family_name: claims.family_name || "",
    };
  }

  // 2. Header Authorization Bearer JWT (para desarrollo local o invocación con token)
  const headers = event?.headers || {};
  const authHeader =
    headers.Authorization || headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(
          Buffer.from(parts[1], "base64url").toString("utf8")
        );
        if (payload.email) {
          return {
            sub: payload.sub || payload["cognito:username"] || payload.user_id,
            email: String(payload.email).toLowerCase(),
            email_verified: payload.email_verified !== false,
            given_name: payload.given_name || "",
            family_name: payload.family_name || "",
          };
        }
      }
    } catch {
      // Ignorar token malformado
    }
  }

  return null;
}

// ============================================================================
// RESPUESTA HTTP ESTÁNDAR CON CORS
// ============================================================================

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Api-Key,X-Building-Id",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

// ============================================================================
// HANDLER PRINCIPAL DE LA API REST
// ============================================================================

export const handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method || "GET";
  if (method === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  let rawPath = event.path || event.rawPath || "/";
  // Normalizar prefijos /prod o /api si están presentes
  rawPath = rawPath.replace(/^\/prod/, "").replace(/^\/api/, "") || "/";
  const query = event.queryStringParameters || {};
  let body = {};
  if (event.body) {
    try {
      body =
        typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    } catch {
      return jsonResponse(400, { error: "JSON inválido en el cuerpo de la petición." });
    }
  }

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // 1. ENDPOINTS PÚBLICOS (/public/*)
    // ──────────────────────────────────────────────────────────────────────────

    // GET /public/buildings (lista mínima de edificios activos para directorio / demo)
    if (method === "GET" && rawPath === "/public/buildings") {
      const buildings = await repo.listBuildings();
      return jsonResponse(
        200,
        buildings
          .filter((b) => b.is_active !== false)
          .map((b) => ({
            building_id: b.building_id,
            slug: b.slug,
            name: b.name,
            address: b.address,
            max_users_per_unit: b.max_users_per_unit || 3,
            registration_password_hint: IS_LOCAL_DEV
              ? b.registration_password_hint
              : undefined,
          }))
      );
    }

    // GET /public/buildings/{slug}
    const pubBldgMatch = rawPath.match(/^\/public\/buildings\/([^/]+)$/);
    if (method === "GET" && pubBldgMatch) {
      const slug = decodeURIComponent(pubBldgMatch[1]);
      const bldg = await repo.getBuildingBySlug(slug);
      if (!bldg || bldg.is_active === false) {
        return jsonResponse(404, {
          error: "No se encontró un edificio activo para esta URL de registro.",
        });
      }
      return jsonResponse(200, {
        building_id: bldg.building_id,
        slug: bldg.slug,
        name: bldg.name,
        address: bldg.address,
        max_users_per_unit: bldg.max_users_per_unit || 3,
        registration_password_hint: IS_LOCAL_DEV
          ? bldg.registration_password_hint
          : undefined,
      });
    }

    // POST /public/buildings/{slug}/verify (Valida contraseña fija del edificio)
    const verifySlugMatch = rawPath.match(
      /^\/public\/buildings\/([^/]+)\/verify$/
    );
    if (method === "POST" && verifySlugMatch) {
      const slug = decodeURIComponent(verifySlugMatch[1]);
      const bldg = await repo.getBuildingBySlug(slug);
      if (!bldg || bldg.is_active === false) {
        return jsonResponse(404, { error: "Edificio no encontrado o inactivo." });
      }
      const password = String(body.password || "").trim();
      if (!password || hashPassword(password) !== bldg.registration_password_hash) {
        return jsonResponse(401, {
          error:
            "Contraseña del edificio incorrecta. Solicite la clave vigente a la administración de su consorcio.",
        });
      }
      const registration_token = createRegistrationToken(
        bldg.building_id,
        bldg.slug
      );
      return jsonResponse(200, {
        valid: true,
        building_id: bldg.building_id,
        slug: bldg.slug,
        name: bldg.name,
        max_users_per_unit: bldg.max_users_per_unit || 3,
        registration_token,
      });
    }

    // POST /public/auth/local-login (Autenticación local / simulación de Cognito cuando corre en entorno local)
    if (method === "POST" && rawPath === "/public/auth/local-login") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) {
        return jsonResponse(400, { error: "Debe ingresar un correo electrónico." });
      }
      const existingUsers = await repo.getUsersByEmail(email);
      const nowEpoch = Math.floor(Date.now() / 1000);
      const deactivated = existingUsers.find(
        (u) => u.status === "DEACTIVATED" && (!u.ttl || u.ttl > nowEpoch)
      );
      if (deactivated) {
        return jsonResponse(403, {
          error:
            "Este correo electrónico se encuentra dado de baja en el sistema. No puede iniciar sesión ni volver a registrarse hasta que un Administrador del edificio lo reactive (o transcurra 1 año).",
        });
      }

      const activeUser = existingUsers.find((u) => u.status === "ACTIVE");
      const sub = activeUser ? activeUser.user_id : `usr-${crypto.randomUUID()}`;
      const fakeJwtPayload = Buffer.from(
        JSON.stringify({
          sub,
          email,
          email_verified: true,
          given_name: activeUser?.first_name || body.first_name || "",
          family_name: activeUser?.last_name || body.last_name || "",
        })
      ).toString("base64url");
      const token = `eyJhbGciOiJIUzI1NiJ9.${fakeJwtPayload}.localdev`;
      return jsonResponse(200, {
        token,
        user: activeUser || null,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. VALIDACIÓN DE AUTENTICACIÓN PARA RUTAS PROTEGIDAS
    // ──────────────────────────────────────────────────────────────────────────
    const identity = parseAuthIdentity(event);
    if (!identity || !identity.email) {
      return jsonResponse(401, {
        error: "No autenticado. Inicie sesión con su cuenta o mediante Google SSO.",
      });
    }

    if (!identity.email_verified) {
      return jsonResponse(403, {
        error:
          "Su dirección de correo electrónico aún no fue verificada en Cognito. Por favor, verifique su casilla de correo.",
      });
    }

    const userRecords = await repo.getUsersByEmail(identity.email);
    const nowEpoch = Math.floor(Date.now() / 1000);

    // Verificar si el usuario tiene un registro dado de baja (DEACTIVATED) vigente
    const deactivatedRecord = userRecords.find(
      (u) => u.status === "DEACTIVATED" && (!u.ttl || u.ttl > nowEpoch)
    );
    if (deactivatedRecord) {
      return jsonResponse(403, {
        error:
          "Tu cuenta fue dada de baja del edificio. No es posible operar ni crear un nuevo usuario con este mismo correo electrónico salvo que el Administrador del edificio te vuelva a dar de alta.",
        code: "USER_DEACTIVATED",
      });
    }

    // Bootstrap automático para el Administrador Global inicial si aún no existe en la tabla
    let activeRecords = userRecords.filter((u) => u.status === "ACTIVE");
    if (
      activeRecords.length === 0 &&
      identity.email.toLowerCase() === INITIAL_GLOBAL_ADMIN
    ) {
      const globalAdminUser = {
        user_id: identity.sub,
        building_id: "GLOBAL",
        email: identity.email,
        first_name: identity.given_name || "Administrador",
        last_name: identity.family_name || "Global",
        unit_number: "GLOBAL",
        unit_key: "GLOBAL",
        resident_type: "staff",
        role: "global_admin",
        status: "ACTIVE",
        is_blocked: false,
        email_verified: true,
        created_at: new Date().toISOString(),
      };
      await repo.putUser(globalAdminUser);
      activeRecords = [globalAdminUser];
    }

    const isGlobalAdmin = activeRecords.some((u) => u.role === "global_admin");

    // ──────────────────────────────────────────────────────────────────────────
    // 3. REGISTRO DE PERFIL DE VECINO EN UN EDIFICIO (POST /auth/register-profile)
    // ──────────────────────────────────────────────────────────────────────────
    if (method === "POST" && rawPath === "/auth/register-profile") {
      const { registration_token, first_name, last_name, unit_number } = body;
      const tokenData = verifyRegistrationToken(registration_token);
      if (!tokenData) {
        return jsonResponse(401, {
          error:
            "El token de validación de contraseña del edificio expiró o es inválido. Vuelva a ingresar la contraseña del edificio.",
        });
      }

      if (!first_name?.trim() || !last_name?.trim() || !unit_number?.trim()) {
        return jsonResponse(400, {
          error:
            "Nombre, Apellido y Unidad Funcional (tal como figura en las expensas) son obligatorios.",
        });
      }

      const building = await repo.getBuildingById(tokenData.building_id);
      if (!building || building.is_active === false) {
        return jsonResponse(404, { error: "El edificio no se encuentra activo." });
      }

      // Verificar si ya está registrado en este edificio
      const existingInBuilding = activeRecords.find(
        (u) => u.building_id === building.building_id
      );
      if (existingInBuilding) {
        return jsonResponse(200, {
          message: "Ya te encontrás registrado en este edificio.",
          user: existingInBuilding,
        });
      }

      const unitKey = normalizeUnitKey(unit_number);
      if (!unitKey) {
        return jsonResponse(400, {
          error: "Ingrese una Unidad Funcional válida (ej: UF 42 - 4° B).",
        });
      }

      // Verificar el cupo máximo de integrantes activos por Unidad Funcional (max_users_per_unit)
      const buildingUsers = await repo.getUsersByBuilding(building.building_id);
      const activeUnitMembers = buildingUsers.filter(
        (u) =>
          u.status === "ACTIVE" &&
          u.role === "resident" &&
          u.unit_key === unitKey
      );

      const maxUsersPerUnit = Number(building.max_users_per_unit || 3);
      if (activeUnitMembers.length >= maxUsersPerUnit) {
        return jsonResponse(409, {
          error: `Se alcanzó el límite máximo permitido de ${maxUsersPerUnit} integrantes para la Unidad Funcional "${unit_number}" (${unitKey}). Si sos nuevo inquilino o familiar, solicitá al Propietario de la Unidad Funcional o al Administrador que dé de baja a los integrantes anteriores.`,
          code: "UNIT_MAX_USERS_REACHED",
        });
      }

      // Si la Unidad Funcional estaba bloqueada en el edificio, hereda el estado de bloqueo
      const isUnitBlocked = (building.blocked_units || []).includes(unitKey);

      const newUser = {
        user_id: identity.sub,
        building_id: building.building_id,
        email: identity.email,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        unit_number: unit_number.trim(),
        unit_key: unitKey,
        // Por seguridad, todo auto-registro ingresa como inquilino/integrante; el Administrador del edificio configura al único Propietario de la UF
        resident_type: "tenant",
        role: "resident",
        status: "ACTIVE",
        is_blocked: isUnitBlocked,
        email_verified: true,
        created_at: new Date().toISOString(),
      };

      await repo.putUser(newUser);
      return jsonResponse(201, {
        message: "Registro completado exitosamente.",
        user: newUser,
        building,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. PERFIL ACTUAL DEL USUARIO (GET /me)
    // ──────────────────────────────────────────────────────────────────────────
    if (method === "GET" && rawPath === "/me") {
      if (activeRecords.length === 0) {
        return jsonResponse(200, {
          authenticated: true,
          needs_registration: true,
          email: identity.email,
          profiles: [],
        });
      }

      const buildings = await repo.listBuildings();
      const enrichedProfiles = activeRecords.map((u) => {
        const bldg = buildings.find((b) => b.building_id === u.building_id);
        const isUnitBlocked = (bldg?.blocked_units || []).includes(u.unit_key);
        return {
          ...u,
          is_effectively_blocked: Boolean(u.is_blocked || isUnitBlocked),
          building: bldg || null,
        };
      });

      return jsonResponse(200, {
        authenticated: true,
        needs_registration: false,
        email: identity.email,
        is_global_admin: isGlobalAdmin,
        profiles: enrichedProfiles,
        buildings: isGlobalAdmin ? buildings : undefined,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 5. ADMINISTRACIÓN GLOBAL DE EDIFICIOS (/buildings)
    // ──────────────────────────────────────────────────────────────────────────
    if (method === "GET" && rawPath === "/buildings") {
      if (!isGlobalAdmin) {
        return jsonResponse(403, {
          error: "Solo el Administrador Global puede listar todos los edificios.",
        });
      }
      const buildings = await repo.listBuildings();
      const enriched = await Promise.all(
        buildings.map(async (b) => {
          const users = await repo.getUsersByBuilding(b.building_id);
          const amenities = await repo.listAmenities(b.building_id);
          return {
            ...b,
            stats: {
              active_users: users.filter((u) => u.status === "ACTIVE").length,
              deactivated_users: users.filter((u) => u.status === "DEACTIVATED")
                .length,
              amenities_count: amenities.length,
              admins: users
                .filter(
                  (u) => u.role === "building_admin" && u.status === "ACTIVE"
                )
                .map((a) => ({
                  user_id: a.user_id,
                  email: a.email,
                  name: `${a.first_name} ${a.last_name}`,
                })),
            },
          };
        })
      );
      return jsonResponse(200, { buildings: enriched });
    }

    if (method === "POST" && rawPath === "/buildings") {
      if (!isGlobalAdmin) {
        return jsonResponse(403, {
          error: "Solo el Administrador Global puede crear nuevos edificios.",
        });
      }
      const {
        name,
        slug,
        address,
        registration_password,
        max_users_per_unit = 3,
        blocked_user_message,
        timezone = "America/Argentina/Buenos_Aires",
        admin_email,
        admin_first_name,
        admin_last_name,
      } = body;

      if (!name?.trim() || !slug?.trim() || !registration_password?.trim()) {
        return jsonResponse(400, {
          error:
            "El nombre del edificio, el identificador de URL (slug) y la contraseña de registro son obligatorios.",
        });
      }

      const cleanSlug = slug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-");
      const existingSlug = await repo.getBuildingBySlug(cleanSlug);
      if (existingSlug) {
        return jsonResponse(409, {
          error: `Ya existe un edificio con la URL /registro/${cleanSlug}.`,
        });
      }

      const newBuilding = {
        building_id: `bldg-${crypto.randomUUID().slice(0, 8)}`,
        slug: cleanSlug,
        name: name.trim(),
        address: (address || "").trim(),
        registration_password_hash: hashPassword(registration_password.trim()),
        registration_password_hint: IS_LOCAL_DEV
          ? registration_password.trim()
          : undefined,
        max_users_per_unit: Math.max(1, Number(max_users_per_unit || 3)),
        blocked_user_message:
          blocked_user_message?.trim() ||
          "No puede efectuar reservas de amenities por adeudar expensas. Por favor, comuníquese con la administración.",
        timezone,
        blocked_units: [],
        is_active: true,
        created_at: new Date().toISOString(),
      };

      await repo.putBuilding(newBuilding);

      // Si se especificó un Administrador Local inicial, darlo de alta para ese edificio
      if (admin_email?.trim()) {
        const cleanAdminEmail = admin_email.trim().toLowerCase();
        const existingAdminUsers = await repo.getUsersByEmail(cleanAdminEmail);
        const adminUserId =
          existingAdminUsers[0]?.user_id ||
          `usr-adm-${crypto.randomUUID().slice(0, 8)}`;
        await repo.putUser({
          user_id: adminUserId,
          building_id: newBuilding.building_id,
          email: cleanAdminEmail,
          first_name: admin_first_name?.trim() || "Administrador",
          last_name: admin_last_name?.trim() || newBuilding.name,
          unit_number: "Administración",
          unit_key: "ADM",
          resident_type: "staff",
          role: "building_admin",
          status: "ACTIVE",
          is_blocked: false,
          email_verified: true,
          created_at: new Date().toISOString(),
        });
      }

      return jsonResponse(201, { building: newBuilding });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Helper de autorización por edificio
    // ──────────────────────────────────────────────────────────────────────────
    const getBuildingRole = (buildingId) => {
      if (isGlobalAdmin) return "global_admin";
      const rec = activeRecords.find((u) => u.building_id === buildingId);
      return rec ? rec.role : null;
    };

    const getBuildingProfile = (buildingId) => {
      return activeRecords.find((u) => u.building_id === buildingId) || null;
    };

    // PUT /buildings/{building_id}
    const bldgIdMatch = rawPath.match(/^\/buildings\/([^/]+)$/);
    if (method === "PUT" && bldgIdMatch) {
      const buildingId = bldgIdMatch[1];
      const role = getBuildingRole(buildingId);
      if (role !== "global_admin" && role !== "building_admin") {
        return jsonResponse(403, {
          error: "No tiene permisos para configurar este edificio.",
        });
      }

      const building = await repo.getBuildingById(buildingId);
      if (!building) {
        return jsonResponse(404, { error: "Edificio no encontrado." });
      }

      if (body.name !== undefined) building.name = String(body.name).trim();
      if (body.address !== undefined)
        building.address = String(body.address).trim();
      if (body.slug !== undefined && role === "global_admin") {
        building.slug = String(body.slug)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-");
      }
      if (body.registration_password?.trim()) {
        building.registration_password_hash = hashPassword(
          body.registration_password.trim()
        );
        if (IS_LOCAL_DEV) {
          building.registration_password_hint = body.registration_password.trim();
        }
      }
      if (body.max_users_per_unit !== undefined) {
        building.max_users_per_unit = Math.max(
          1,
          Number(body.max_users_per_unit)
        );
      }
      if (body.blocked_user_message !== undefined) {
        building.blocked_user_message = String(body.blocked_user_message).trim();
      }
      if (body.timezone !== undefined) {
        building.timezone = String(body.timezone).trim();
      }
      if (Array.isArray(body.blocked_units)) {
        building.blocked_units = body.blocked_units.map(normalizeUnitKey);
      }
      if (body.is_active !== undefined && role === "global_admin") {
        building.is_active = Boolean(body.is_active);
      }

      await repo.putBuilding(building);
      return jsonResponse(200, { building });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 6. GESTIÓN DE USUARIOS, UNIDADES FUNCIONALES, ÚNICO PROPIETARIO Y BAJAS
    // ──────────────────────────────────────────────────────────────────────────

    // GET /buildings/{building_id}/users
    const bldgUsersMatch = rawPath.match(/^\/buildings\/([^/]+)\/users$/);
    if (method === "GET" && bldgUsersMatch) {
      const buildingId = bldgUsersMatch[1];
      const role = getBuildingRole(buildingId);
      if (role !== "global_admin" && role !== "building_admin") {
        return jsonResponse(403, { error: "Acceso denegado." });
      }

      const building = await repo.getBuildingById(buildingId);
      const users = await repo.getUsersByBuilding(buildingId);

      // Calcular estadísticas por Unidad Funcional
      const unitCounts = {};
      const unitOwners = {};
      for (const u of users) {
        if (u.status === "ACTIVE" && u.role === "resident") {
          unitCounts[u.unit_key] = (unitCounts[u.unit_key] || 0) + 1;
          if (u.resident_type === "owner") {
            unitOwners[u.unit_key] = u.user_id;
          }
        }
      }

      const enrichedUsers = users.map((u) => ({
        ...u,
        unit_active_count: unitCounts[u.unit_key] || 0,
        unit_max_users: building?.max_users_per_unit || 3,
        unit_owner_user_id: unitOwners[u.unit_key] || null,
        is_effectively_blocked: Boolean(
          u.is_blocked || (building?.blocked_units || []).includes(u.unit_key)
        ),
      }));

      return jsonResponse(200, {
        users: enrichedUsers,
        building_max_users_per_unit: building?.max_users_per_unit || 3,
        blocked_units: building?.blocked_units || [],
      });
    }

    // POST /buildings/{building_id}/users (Alta administrativa de usuario / guardia / propietario / admin local)
    if (method === "POST" && bldgUsersMatch) {
      const buildingId = bldgUsersMatch[1];
      const role = getBuildingRole(buildingId);
      if (role !== "global_admin" && role !== "building_admin") {
        return jsonResponse(403, { error: "Acceso denegado." });
      }

      const building = await repo.getBuildingById(buildingId);
      if (!building) {
        return jsonResponse(404, { error: "Edificio no encontrado." });
      }

      const {
        email,
        first_name,
        last_name,
        unit_number = "UF",
        user_role = "resident",
        resident_type = "tenant",
      } = body;

      if (!email?.trim() || !first_name?.trim() || !last_name?.trim()) {
        return jsonResponse(400, {
          error: "Email, nombre y apellido son obligatorios.",
        });
      }

      const cleanEmail = email.trim().toLowerCase();
      const unitKey = normalizeUnitKey(unit_number) || "STAFF";
      const allUsers = await repo.getUsersByBuilding(buildingId);

      if (user_role === "resident") {
        const activeInUnit = allUsers.filter(
          (u) =>
            u.status === "ACTIVE" &&
            u.role === "resident" &&
            u.unit_key === unitKey
        );
        if (activeInUnit.length >= (building.max_users_per_unit || 3)) {
          return jsonResponse(409, {
            error: `La Unidad Funcional ${unit_number} ya alcanzó el máximo configurado de ${building.max_users_per_unit} integrantes activos.`,
          });
        }

        // Si se configura como único Propietario (owner) de esa UF, transferir titularidad si había otro
        if (resident_type === "owner") {
          for (const prevOwner of activeInUnit.filter(
            (u) => u.resident_type === "owner"
          )) {
            prevOwner.resident_type = "tenant";
            await repo.putUser(prevOwner);
          }
        }
      }

      const existingByEmail = await repo.getUsersByEmail(cleanEmail);
      const userId =
        existingByEmail[0]?.user_id ||
        `usr-${crypto.randomUUID().slice(0, 8)}`;

      const newUser = {
        user_id: userId,
        building_id: buildingId,
        email: cleanEmail,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        unit_number: unit_number.trim(),
        unit_key: unitKey,
        resident_type:
          user_role === "resident" ? resident_type : "staff",
        role: user_role,
        status: "ACTIVE",
        is_blocked: false,
        email_verified: true,
        created_at: new Date().toISOString(),
      };

      await repo.putUser(newUser);
      await repo.setCognitoUserEnabled(cleanEmail, true);
      return jsonResponse(201, { user: newUser });
    }

    // PATCH /buildings/{building_id}/users/{user_id}
    // Permite: bloquear/desbloquear expensas, configurar único Propietario de UF, cambiar rol o REACTIVAR un usuario con baja
    const bldgUserItemMatch = rawPath.match(
      /^\/buildings\/([^/]+)\/users\/([^/]+)$/
    );
    if (method === "PATCH" && bldgUserItemMatch) {
      const [, buildingId, targetUserId] = bldgUserItemMatch;
      const role = getBuildingRole(buildingId);
      if (role !== "global_admin" && role !== "building_admin") {
        return jsonResponse(403, { error: "Acceso denegado." });
      }

      const building = await repo.getBuildingById(buildingId);
      const targetUser = await repo.getUser(targetUserId, buildingId);
      if (!building || !targetUser) {
        return jsonResponse(404, { error: "Usuario o edificio no encontrado." });
      }

      const allBuildingUsers = await repo.getUsersByBuilding(buildingId);

      // 1. Reactivación (Dar de alta nuevamente a un usuario que estaba con baja DEACTIVATED)
      if (body.status === "ACTIVE" && targetUser.status === "DEACTIVATED") {
        if (targetUser.role === "resident") {
          const activeInUnit = allBuildingUsers.filter(
            (u) =>
              u.status === "ACTIVE" &&
              u.role === "resident" &&
              u.unit_key === targetUser.unit_key
          );
          if (activeInUnit.length >= (building.max_users_per_unit || 3)) {
            return jsonResponse(409, {
              error: `No se puede reactivar al usuario porque la Unidad Funcional ${targetUser.unit_number} ya tiene el cupo máximo de ${building.max_users_per_unit} integrantes activos ocupados.`,
            });
          }
        }
        targetUser.status = "ACTIVE";
        delete targetUser.ttl;
        delete targetUser.deactivated_at;
        delete targetUser.deactivated_by;
        await repo.setCognitoUserEnabled(targetUser.email, true);
      }

      // 2. Cambio de Unidad Funcional
      if (body.unit_number !== undefined) {
        targetUser.unit_number = String(body.unit_number).trim();
        targetUser.unit_key = normalizeUnitKey(targetUser.unit_number);
      }

      // 3. Configurar como único Propietario de la Unidad Funcional (resident_type = 'owner' | 'tenant')
      if (body.resident_type !== undefined) {
        if (body.resident_type === "owner") {
          // Garantizar que solo exista UN propietario en esa Unidad Funcional
          const otherOwners = allBuildingUsers.filter(
            (u) =>
              u.user_id !== targetUser.user_id &&
              u.unit_key === targetUser.unit_key &&
              u.resident_type === "owner"
          );
          for (const prev of otherOwners) {
            prev.resident_type = "tenant";
            await repo.putUser(prev);
          }
          targetUser.resident_type = "owner";
        } else {
          targetUser.resident_type = body.resident_type;
        }
      }

      // 4. Cambio de rol (resident, security, building_admin)
      if (body.role !== undefined) {
        targetUser.role = body.role;
      }

      // 5. Bloqueo / Desbloqueo por deuda de expensas (individual y/o de toda la Unidad Funcional)
      if (body.is_blocked !== undefined) {
        targetUser.is_blocked = Boolean(body.is_blocked);
        if (body.apply_to_unit) {
          const blockedUnitsSet = new Set(building.blocked_units || []);
          if (targetUser.is_blocked) {
            blockedUnitsSet.add(targetUser.unit_key);
          } else {
            blockedUnitsSet.delete(targetUser.unit_key);
          }
          building.blocked_units = Array.from(blockedUnitsSet);
          await repo.putBuilding(building);

          // Actualizar también a los demás integrantes de la misma UF
          for (const member of allBuildingUsers.filter(
            (u) =>
              u.unit_key === targetUser.unit_key &&
              u.user_id !== targetUser.user_id
          )) {
            member.is_blocked = Boolean(body.is_blocked);
            await repo.putUser(member);
          }
        }
      }

      await repo.putUser(targetUser);
      return jsonResponse(200, { user: targetUser });
    }

    // DELETE /buildings/{building_id}/users/{user_id}
    // Si está ACTIVE -> Baja lógica (DEACTIVATED) por 1 año + cancela reservas futuras + bloquea email.
    // Si está DEACTIVATED y query.permanent === 'true' -> Eliminación definitiva física.
    if (method === "DELETE" && bldgUserItemMatch) {
      const [, buildingId, targetUserId] = bldgUserItemMatch;
      const role = getBuildingRole(buildingId);
      if (role !== "global_admin" && role !== "building_admin") {
        return jsonResponse(403, { error: "Acceso denegado." });
      }

      const building = await repo.getBuildingById(buildingId);
      const targetUser = await repo.getUser(targetUserId, buildingId);
      if (!building || !targetUser) {
        return jsonResponse(404, { error: "Usuario no encontrado." });
      }

      const isPermanent = query.permanent === "true";
      if (isPermanent) {
        if (targetUser.status !== "DEACTIVATED") {
          return jsonResponse(400, {
            error:
              "Para eliminar definitivamente a un usuario, primero debe encontrarse dado de baja.",
          });
        }
        await repo.deleteUserPermanently(
          targetUser.user_id,
          buildingId,
          targetUser.email
        );
        return jsonResponse(200, {
          deleted_permanently: true,
          message:
            "El usuario fue eliminado definitivamente del sistema y su correo electrónico ha sido liberado.",
        });
      }

      const todayStr = getTodayInTimezone(building.timezone);
      const cancelledCount = await repo.cancelFutureReservationsForUser(
        buildingId,
        targetUser.user_id,
        todayStr
      );

      targetUser.status = "DEACTIVATED";
      targetUser.resident_type =
        targetUser.resident_type === "owner" ? "tenant" : targetUser.resident_type;
      targetUser.deactivated_at = new Date().toISOString();
      targetUser.deactivated_by = `${identity.email} (${role})`;
      targetUser.ttl = computeDeactivatedUserTtlEpoch(365);

      await repo.putUser(targetUser);
      await repo.setCognitoUserEnabled(targetUser.email, false);

      return jsonResponse(200, {
        user: targetUser,
        cancelled_reservations: cancelledCount,
        message:
          "El usuario fue dado de baja. Su registro permanecerá bloqueado por 1 año para impedir nuevas cuentas con el mismo email, liberando inmediatamente el cupo de su Unidad Funcional.",
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 7. PANEL DEL PROPIETARIO DE UNIDAD FUNCIONAL ("MI UNIDAD FUNCIONAL")
    // ──────────────────────────────────────────────────────────────────────────

    // GET /buildings/{building_id}/my-unit
    const myUnitMatch = rawPath.match(/^\/buildings\/([^/]+)\/my-unit$/);
    if (method === "GET" && myUnitMatch) {
      const buildingId = myUnitMatch[1];
      const profile = getBuildingProfile(buildingId);
      if (!profile || profile.resident_type !== "owner") {
        return jsonResponse(403, {
          error:
            "Solo el único Propietario designado de la Unidad Funcional puede gestionar los integrantes de su unidad.",
        });
      }

      const building = await repo.getBuildingById(buildingId);
      const allUsers = await repo.getUsersByBuilding(buildingId);
      const unitMembers = allUsers.filter(
        (u) => u.unit_key === profile.unit_key && u.role === "resident"
      );

      return jsonResponse(200, {
        unit_number: profile.unit_number,
        unit_key: profile.unit_key,
        max_users_per_unit: building?.max_users_per_unit || 3,
        active_count: unitMembers.filter((m) => m.status === "ACTIVE").length,
        members: unitMembers,
      });
    }

    // DELETE /buildings/{building_id}/my-unit/tenants/{user_id}
    const ownerDeleteTenantMatch = rawPath.match(
      /^\/buildings\/([^/]+)\/my-unit\/tenants\/([^/]+)$/
    );
    if (method === "DELETE" && ownerDeleteTenantMatch) {
      const [, buildingId, tenantUserId] = ownerDeleteTenantMatch;
      const profile = getBuildingProfile(buildingId);
      if (!profile || profile.resident_type !== "owner") {
        return jsonResponse(403, {
          error:
            "Solo el Propietario de la Unidad Funcional puede dar de baja o eliminar a un inquilino de su unidad.",
        });
      }

      const building = await repo.getBuildingById(buildingId);
      const targetTenant = await repo.getUser(tenantUserId, buildingId);
      if (
        !targetTenant ||
        targetTenant.unit_key !== profile.unit_key ||
        targetTenant.user_id === profile.user_id
      ) {
        return jsonResponse(404, {
          error: "No se encontró el inquilino dentro de tu Unidad Funcional.",
        });
      }

      const isPermanent = query.permanent === "true";
      if (isPermanent) {
        if (targetTenant.status !== "DEACTIVATED") {
          return jsonResponse(400, {
            error:
              "Primero debe dar de baja al inquilino antes de eliminarlo definitivamente.",
          });
        }
        await repo.deleteUserPermanently(
          targetTenant.user_id,
          buildingId,
          targetTenant.email
        );
        return jsonResponse(200, {
          deleted_permanently: true,
          message: "Inquilino eliminado definitivamente del sistema.",
        });
      }

      const todayStr = getTodayInTimezone(building?.timezone);
      const cancelledCount = await repo.cancelFutureReservationsForUser(
        buildingId,
        targetTenant.user_id,
        todayStr
      );

      targetTenant.status = "DEACTIVATED";
      targetTenant.deactivated_at = new Date().toISOString();
      targetTenant.deactivated_by = `${profile.first_name} ${profile.last_name} (Propietario UF ${profile.unit_number})`;
      targetTenant.ttl = computeDeactivatedUserTtlEpoch(365);

      await repo.putUser(targetTenant);
      await repo.setCognitoUserEnabled(targetTenant.email, false);

      return jsonResponse(200, {
        tenant: targetTenant,
        cancelled_reservations: cancelledCount,
        message:
          "El inquilino fue dado de baja. Su cupo en la Unidad Funcional ya está libre y no podrá volver a registrarse con el mismo email.",
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 8. CONFIGURACIÓN DE AMENITIES (/buildings/{building_id}/amenities)
    // ──────────────────────────────────────────────────────────────────────────
    const amenitiesMatch = rawPath.match(/^\/buildings\/([^/]+)\/amenities$/);
    if (method === "GET" && amenitiesMatch) {
      const buildingId = amenitiesMatch[1];
      const role = getBuildingRole(buildingId);
      if (!role) {
        return jsonResponse(403, { error: "No pertenece a este edificio." });
      }

      const building = await repo.getBuildingById(buildingId);
      const profile = getBuildingProfile(buildingId);
      const isBlocked =
        role === "resident" &&
        Boolean(
          profile?.is_blocked ||
            (building?.blocked_units || []).includes(profile?.unit_key)
        );

      const amenities = await repo.listAmenities(buildingId);
      return jsonResponse(200, {
        is_blocked: isBlocked,
        blocked_message: isBlocked ? building?.blocked_user_message : null,
        // Si el vecino está bloqueado por expensas, no se le devuelven amenities para reservar
        amenities: isBlocked ? [] : amenities,
        public_amenities: amenities.filter((a) => a.show_on_home !== false),
      });
    }

    if (method === "POST" && amenitiesMatch) {
      const buildingId = amenitiesMatch[1];
      const role = getBuildingRole(buildingId);
      if (role !== "global_admin" && role !== "building_admin") {
        return jsonResponse(403, {
          error: "Solo el Administrador puede agregar amenities.",
        });
      }

      const {
        name,
        description = "",
        allow_comments = true,
        max_capacity = 20,
        max_bookings_per_day = 2,
        no_shifts = false,
        show_on_home = true,
        schedule = {},
      } = body;

      if (!name?.trim()) {
        return jsonResponse(400, {
          error: "El nombre del amenity es obligatorio.",
        });
      }

      // Validar que cada día de la semana tenga como máximo 2 turnos
      const normalizedSchedule = {};
      for (let d = 0; d <= 6; d++) {
        const dayCfg = schedule[String(d)] || { enabled: true, shifts: [] };
        const shifts = Array.isArray(dayCfg.shifts)
          ? dayCfg.shifts.slice(0, 2)
          : [];
        normalizedSchedule[String(d)] = {
          enabled: Boolean(dayCfg.enabled),
          shifts: shifts.map((s, idx) => ({
            id: s.id || `SHIFT_${idx + 1}`,
            name: s.name || `Turno ${idx + 1}`,
            start_time: s.start_time || "10:00",
            end_time: s.end_time || "18:00",
          })),
        };
      }

      const newAmenity = {
        building_id: buildingId,
        amenity_id: `am-${crypto.randomUUID().slice(0, 8)}`,
        name: name.trim(),
        description: description.trim(),
        allow_comments: Boolean(allow_comments),
        max_capacity: Math.max(1, Number(max_capacity || 20)),
        max_bookings_per_day: Math.max(1, Number(max_bookings_per_day || 1)),
        no_shifts: Boolean(no_shifts),
        show_on_home: Boolean(show_on_home),
        schedule: normalizedSchedule,
        is_active: true,
        created_at: new Date().toISOString(),
      };

      await repo.putAmenity(newAmenity);
      return jsonResponse(201, { amenity: newAmenity });
    }

    const amenityItemMatch = rawPath.match(
      /^\/buildings\/([^/]+)\/amenities\/([^/]+)$/
    );
    if (method === "PUT" && amenityItemMatch) {
      const [, buildingId, amenityId] = amenityItemMatch;
      const role = getBuildingRole(buildingId);
      if (role !== "global_admin" && role !== "building_admin") {
        return jsonResponse(403, { error: "Acceso denegado." });
      }

      const existing = await repo.getAmenity(buildingId, amenityId);
      if (!existing) {
        return jsonResponse(404, { error: "Amenity no encontrado." });
      }

      if (body.name !== undefined) existing.name = String(body.name).trim();
      if (body.description !== undefined)
        existing.description = String(body.description).trim();
      if (body.allow_comments !== undefined)
        existing.allow_comments = Boolean(body.allow_comments);
      if (body.max_capacity !== undefined)
        existing.max_capacity = Math.max(1, Number(body.max_capacity));
      if (body.max_bookings_per_day !== undefined)
        existing.max_bookings_per_day = Math.max(
          1,
          Number(body.max_bookings_per_day)
        );
      if (body.no_shifts !== undefined)
        existing.no_shifts = Boolean(body.no_shifts);
      if (body.show_on_home !== undefined)
        existing.show_on_home = Boolean(body.show_on_home);
      if (body.schedule !== undefined) {
        const normalizedSchedule = {};
        for (let d = 0; d <= 6; d++) {
          const dayCfg = body.schedule[String(d)] || {
            enabled: false,
            shifts: [],
          };
          normalizedSchedule[String(d)] = {
            enabled: Boolean(dayCfg.enabled),
            shifts: (dayCfg.shifts || []).slice(0, 2).map((s, idx) => ({
              id: s.id || `SHIFT_${idx + 1}`,
              name: s.name || `Turno ${idx + 1}`,
              start_time: s.start_time || "10:00",
              end_time: s.end_time || "18:00",
            })),
          };
        }
        existing.schedule = normalizedSchedule;
      }

      await repo.putAmenity(existing);
      return jsonResponse(200, { amenity: existing });
    }

    if (method === "DELETE" && amenityItemMatch) {
      const [, buildingId, amenityId] = amenityItemMatch;
      const role = getBuildingRole(buildingId);
      if (role !== "global_admin" && role !== "building_admin") {
        return jsonResponse(403, { error: "Acceso denegado." });
      }
      await repo.deleteAmenity(buildingId, amenityId);
      return jsonResponse(200, { deleted: true });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 9. DISPONIBILIDAD POR TURNO Y AVISO DE RESERVAS SUPERPUESTAS
    // ──────────────────────────────────────────────────────────────────────────
    const availMatch = rawPath.match(/^\/buildings\/([^/]+)\/availability$/);
    if (method === "GET" && availMatch) {
      const buildingId = availMatch[1];
      const role = getBuildingRole(buildingId);
      if (!role) return jsonResponse(403, { error: "Acceso denegado." });

      const { amenity_id, date } = query;
      if (!amenity_id || !date) {
        return jsonResponse(400, {
          error: "Debe indicar amenity_id y fecha (YYYY-MM-DD).",
        });
      }

      const building = await repo.getBuildingById(buildingId);
      const amenity = await repo.getAmenity(buildingId, amenity_id);
      if (!building || !amenity) {
        return jsonResponse(404, { error: "Amenity o edificio no encontrado." });
      }

      const todayStr = getTodayInTimezone(building.timezone);
      if (date < todayStr) {
        return jsonResponse(400, {
          error: "No es posible consultar ni efectuar reservas para fechas pasadas.",
        });
      }

      const dow = String(getDayOfWeekFromDateStr(date));
      const daySchedule = amenity.schedule?.[dow];
      if (!daySchedule || !daySchedule.enabled) {
        return jsonResponse(200, {
          date,
          day_enabled: false,
          message: "El amenity no se encuentra habilitado en este día de la semana.",
          shifts: [],
        });
      }

      const confirmedOnDate = await repo.listReservationsByBuildingAndDate(
        buildingId,
        date,
        amenity_id
      );

      const totalBookingsOnDay = confirmedOnDate.length;
      const remainingBookingsOnDay = Math.max(
        0,
        amenity.max_bookings_per_day - totalBookingsOnDay
      );

      if (amenity.no_shifts) {
        const occupiedGuests = confirmedOnDate.reduce(
          (acc, r) => acc + Number(r.guests_count || 0),
          0
        );
        const remainingGuests = Math.max(
          0,
          amenity.max_capacity - occupiedGuests
        );
        const baseRange = daySchedule.shifts?.[0]
          ? `${daySchedule.shifts[0].start_time} a ${daySchedule.shifts[0].end_time}`
          : "09:00 a 21:00";

        return jsonResponse(200, {
          date,
          day_enabled: true,
          no_shifts: true,
          max_capacity: amenity.max_capacity,
          max_bookings_per_day: amenity.max_bookings_per_day,
          total_bookings_on_day: totalBookingsOnDay,
          remaining_bookings_on_day: remainingBookingsOnDay,
          shifts: [
            {
              id: "NO_SHIFT",
              name: `Sin turno fijo (${baseRange})`,
              start_time: daySchedule.shifts?.[0]?.start_time || "09:00",
              end_time: daySchedule.shifts?.[0]?.end_time || "21:00",
              existing_bookings_count: confirmedOnDate.length,
              existing_guests_count: occupiedGuests,
              remaining_guests_capacity:
                remainingBookingsOnDay > 0 ? remainingGuests : 0,
              is_full: remainingGuests <= 0 || remainingBookingsOnDay <= 0,
              warning_message:
                occupiedGuests > 0
                  ? `Actualmente existe(n) ${confirmedOnDate.length} reserva(s) en este mismo horario para un total de ${occupiedGuests} persona(s). Podés reservar para un máximo de ${remainingGuests} persona(s).`
                  : null,
            },
          ],
        });
      }

      const shiftsAvailability = (daySchedule.shifts || []).map((shift) => {
        const shiftRes = confirmedOnDate.filter((r) => r.shift_id === shift.id);
        const occupiedGuests = shiftRes.reduce(
          (acc, r) => acc + Number(r.guests_count || 0),
          0
        );
        const remainingGuests = Math.max(
          0,
          amenity.max_capacity - occupiedGuests
        );
        const isFull = remainingGuests <= 0 || remainingBookingsOnDay <= 0;

        return {
          id: shift.id,
          name: shift.name,
          start_time: shift.start_time,
          end_time: shift.end_time,
          existing_bookings_count: shiftRes.length,
          existing_guests_count: occupiedGuests,
          remaining_guests_capacity:
            remainingBookingsOnDay > 0 ? remainingGuests : 0,
          is_full: isFull,
          warning_message:
            occupiedGuests > 0
              ? `Actualmente existe(n) ${shiftRes.length} reserva(s) en el mismo turno para ${occupiedGuests} persona(s). Capacidad máxima restante: ${remainingGuests} persona(s) (sobre un máximo de ${amenity.max_capacity}).`
              : null,
        };
      });

      return jsonResponse(200, {
        date,
        day_enabled: true,
        no_shifts: false,
        max_capacity: amenity.max_capacity,
        max_bookings_per_day: amenity.max_bookings_per_day,
        total_bookings_on_day: totalBookingsOnDay,
        remaining_bookings_on_day: remainingBookingsOnDay,
        shifts: shiftsAvailability,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 10. CREACIÓN, CONSULTA Y CANCELACIÓN DE RESERVAS (TTL 90 DÍAS)
    // ──────────────────────────────────────────────────────────────────────────
    const reservationsMatch = rawPath.match(
      /^\/buildings\/([^/]+)\/reservations$/
    );

    // POST /buildings/{building_id}/reservations
    if (method === "POST" && reservationsMatch) {
      const buildingId = reservationsMatch[1];
      const role = getBuildingRole(buildingId);
      const profile = getBuildingProfile(buildingId);

      if (!role || role === "security") {
        return jsonResponse(403, {
          error: "El rol de Seguridad solo tiene permisos de visualización.",
        });
      }

      const building = await repo.getBuildingById(buildingId);
      if (!building) {
        return jsonResponse(404, { error: "Edificio no encontrado." });
      }

      const isBlocked = Boolean(
        profile?.is_blocked ||
          (building.blocked_units || []).includes(profile?.unit_key)
      );
      if (isBlocked && role === "resident") {
        return jsonResponse(403, {
          error:
            building.blocked_user_message ||
            "No puede efectuar reservas por adeudar expensas.",
          code: "USER_BLOCKED_EXPENSES",
        });
      }

      const {
        amenity_id,
        date,
        shift_id,
        custom_time = "",
        guests_count,
        comments = "",
      } = body;

      if (!amenity_id || !date || !guests_count) {
        return jsonResponse(400, {
          error: "Debe seleccionar amenity, fecha y cantidad de invitados.",
        });
      }

      const todayStr = getTodayInTimezone(building.timezone);
      if (date < todayStr) {
        return jsonResponse(400, {
          error:
            "La fecha de reserva debe ser desde el día de hoy en adelante (nunca hacia atrás).",
        });
      }

      const amenity = await repo.getAmenity(buildingId, amenity_id);
      if (!amenity || amenity.is_active === false) {
        return jsonResponse(404, { error: "Amenity no disponible." });
      }

      const dow = String(getDayOfWeekFromDateStr(date));
      const daySchedule = amenity.schedule?.[dow];
      if (!daySchedule || !daySchedule.enabled) {
        return jsonResponse(400, {
          error: "El amenity seleccionado no opera en ese día de la semana.",
        });
      }

      const parsedGuests = Number(guests_count);
      if (!Number.isInteger(parsedGuests) || parsedGuests < 1) {
        return jsonResponse(400, {
          error: "La cantidad de invitados debe ser un número entero mayor o igual a 1.",
        });
      }

      let finalShiftId = "NO_SHIFT";
      let shiftLabel = "Sin turno fijo";

      if (amenity.no_shifts) {
        finalShiftId = "NO_SHIFT";
        shiftLabel = custom_time
          ? `Sin turno fijo (Hora declarada: ${custom_time} hs)`
          : "Sin turno fijo";
      } else {
        const matchedShift = (daySchedule.shifts || []).find(
          (s) => s.id === shift_id
        );
        if (!matchedShift) {
          return jsonResponse(400, {
            error: "Debe seleccionar un turno válido configurado para ese día.",
          });
        }
        finalShiftId = matchedShift.id;
        shiftLabel = `${matchedShift.name} (${matchedShift.start_time} - ${matchedShift.end_time})`;
      }

      const reservationId = `res-${crypto.randomUUID().slice(0, 8)}`;
      const reservation = {
        building_id: buildingId,
        reservation_sk: `DATE#${date}#AMENITY#${amenity.amenity_id}#RES#${reservationId}`,
        reservation_id: reservationId,
        user_id: profile?.user_id || identity.sub,
        user_full_name: profile
          ? `${profile.first_name} ${profile.last_name}`
          : identity.email,
        unit_number: profile?.unit_number || "Administración",
        unit_key: profile?.unit_key || "ADM",
        amenity_id: amenity.amenity_id,
        amenity_name: amenity.name,
        date,
        shift_id: finalShiftId,
        shift_label: shiftLabel,
        custom_time: custom_time || "",
        guests_count: parsedGuests,
        comments: amenity.allow_comments ? String(comments || "").trim() : "",
        show_on_home: Boolean(amenity.show_on_home),
        status: "CONFIRMED",
        created_at: new Date().toISOString(),
        ttl: computeReservationTtlEpoch(date, building.timezone, 90),
      };

      const created = await repo.createReservationAtomic(reservation, amenity);
      return jsonResponse(201, { reservation: created });
    }

    // GET /buildings/{building_id}/reservations/my ("Mis Reservas")
    const myResMatch = rawPath.match(
      /^\/buildings\/([^/]+)\/reservations\/my$/
    );
    if (method === "GET" && myResMatch) {
      const buildingId = myResMatch[1];
      const role = getBuildingRole(buildingId);
      if (!role) return jsonResponse(403, { error: "Acceso denegado." });

      const building = await repo.getBuildingById(buildingId);
      const todayStr = getTodayInTimezone(building?.timezone);
      const allRes = await repo.listReservationsByBuilding(
        buildingId,
        todayStr
      );
      const myUserId = getBuildingProfile(buildingId)?.user_id || identity.sub;

      const myReservations = allRes
        .filter((r) => r.user_id === myUserId && r.status === "CONFIRMED")
        .sort((a, b) => a.date.localeCompare(b.date));

      return jsonResponse(200, { reservations: myReservations });
    }

    // GET /buildings/{building_id}/reservations
    // - Para Vecinos (resident): desde hoy en adelante y solo amenities con show_on_home = true.
    // - Para Seguridad y Administradores: hasta 90 días hacia atrás y todos los amenities (incluyendo pileta).
    if (method === "GET" && reservationsMatch) {
      const buildingId = reservationsMatch[1];
      const role = getBuildingRole(buildingId);
      if (!role) return jsonResponse(403, { error: "Acceso denegado." });

      const building = await repo.getBuildingById(buildingId);
      const tz = building?.timezone || "America/Argentina/Buenos_Aires";
      const todayStr = getTodayInTimezone(tz);
      const minHistoryStr = getMinHistoryDateInTimezone(tz, 90);

      const isPrivilegedViewer =
        role === "security" ||
        role === "building_admin" ||
        role === "global_admin";

      const fromDate = isPrivilegedViewer ? minHistoryStr : todayStr;
      const allRes = await repo.listReservationsByBuilding(
        buildingId,
        fromDate
      );

      if (!isPrivilegedViewer) {
        // Vista pública de la pantalla principal para vecinos
        const publicReservations = allRes
          .filter(
            (r) =>
              r.status === "CONFIRMED" &&
              r.date >= todayStr &&
              r.show_on_home !== false
          )
          .map((r) => ({
            reservation_id: r.reservation_id,
            amenity_id: r.amenity_id,
            amenity_name: r.amenity_name,
            date: r.date,
            shift_id: r.shift_id,
            shift_label: r.shift_label,
            custom_time: r.custom_time,
            guests_count: r.guests_count,
            unit_number: r.unit_number,
            status: r.status,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        return jsonResponse(200, {
          reservations: publicReservations,
          today: todayStr,
          min_date: todayStr,
        });
      }

      // Vista completa para Seguridad y Administradores (90 días hacia atrás + todos los amenities)
      const fullReservations = allRes
        .filter((r) => r.status === "CONFIRMED")
        .sort((a, b) => b.date.localeCompare(a.date));

      return jsonResponse(200, {
        reservations: fullReservations,
        today: todayStr,
        min_date: minHistoryStr,
      });
    }

    // DELETE /buildings/{building_id}/reservations/{reservation_id}
    const delResMatch = rawPath.match(
      /^\/buildings\/([^/]+)\/reservations\/([^/]+)$/
    );
    if (method === "DELETE" && delResMatch) {
      const [, buildingId, reservationId] = delResMatch;
      const role = getBuildingRole(buildingId);
      const profile = getBuildingProfile(buildingId);
      if (!role || role === "security") {
        return jsonResponse(403, { error: "Acceso denegado." });
      }

      const building = await repo.getBuildingById(buildingId);
      const todayStr = getTodayInTimezone(building?.timezone);
      const allRes = await repo.listReservationsByBuilding(
        buildingId,
        todayStr
      );
      const target = allRes.find((r) => r.reservation_id === reservationId);
      if (!target) {
        return jsonResponse(404, { error: "Reserva no encontrada." });
      }

      const isAdmin = role === "building_admin" || role === "global_admin";
      if (!isAdmin && target.user_id !== profile?.user_id) {
        return jsonResponse(403, {
          error: "Solo puede cancelar sus propias reservas.",
        });
      }

      const cancelled = await repo.cancelReservation(buildingId, reservationId);
      return jsonResponse(200, { reservation: cancelled });
    }

    return jsonResponse(404, { error: `Ruta no encontrada: ${method} ${rawPath}` });
  } catch (err) {
    console.error("Error en API:", err);
    const status = err.statusCode || 500;
    return jsonResponse(status, {
      error: err.message || "Error interno del servidor.",
    });
  }
};

