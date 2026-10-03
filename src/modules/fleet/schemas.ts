import { z } from "zod";

const uuid = z.string().uuid();
const emptyOr = <T extends z.ZodType>(s: T) => z.union([z.literal(""), s]);
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const dateStr = z.string().min(8, "Date requise");
const optDate = z.string().optional().or(z.literal(""));
const money = z.coerce.number().min(0, "Montant positif").max(1e13);
const km = z.coerce.number().int("Nombre entier").min(0, "Kilométrage positif").max(5_000_000);
const optKm = emptyOr(km).optional();

export const idSchema = z.object({ id: uuid });

export const VEHICLE_TYPES = [
  { value: "TRUCK", label: "Camion" }, { value: "VAN", label: "Fourgon / utilitaire" }, { value: "CAR", label: "Voiture" }, { value: "TRAILER", label: "Remorque" },
  { value: "MOTORCYCLE", label: "Moto" }, { value: "MACHINE", label: "Engin" }, { value: "OTHER", label: "Autre" },
] as const;
export const VEHICLE_STATUSES = [
  { value: "ACTIVE", label: "En service" }, { value: "IN_MAINTENANCE", label: "En maintenance" }, { value: "OUT_OF_SERVICE", label: "Hors service" }, { value: "SOLD", label: "Vendu" },
] as const;
export const FUEL_TYPES = [
  { value: "DIESEL", label: "Gasoil" }, { value: "PETROL", label: "Essence" }, { value: "ELECTRIC", label: "Électrique" }, { value: "HYBRID", label: "Hybride" }, { value: "GAS", label: "Gaz" }, { value: "NONE", label: "Sans moteur" },
] as const;
export const MAINTENANCE_TYPES = [
  { value: "PREVENTIVE", label: "Entretien préventif" }, { value: "CORRECTIVE", label: "Entretien correctif" }, { value: "REPAIR", label: "Réparation" }, { value: "TIRES", label: "Pneumatiques" }, { value: "OTHER", label: "Autre" },
] as const;
export const COMPLIANCE_KINDS = [
  { value: "INSURANCE", label: "Assurance" }, { value: "TECHNICAL_INSPECTION", label: "Visite technique" }, { value: "REGISTRATION", label: "Carte grise" }, { value: "OTHER", label: "Autre document" },
] as const;
export const FINE_STATUSES = [
  { value: "TO_PAY", label: "À payer" }, { value: "PAID", label: "Payée" }, { value: "CONTESTED", label: "Contestée" }, { value: "CANCELLED", label: "Annulée" },
] as const;
export const TRIP_STATUSES = [
  { value: "PLANNED", label: "Planifiée" }, { value: "IN_PROGRESS", label: "En cours" }, { value: "DONE", label: "Terminée" }, { value: "CANCELLED", label: "Annulée" },
] as const;

const E = (list: readonly { value: string }[]) => z.enum(list.map((x) => x.value) as [string, ...string[]]);

export const vehicleSchema = z.object({
  plate: z.string().trim().min(3, "Immatriculation requise").max(20),
  name: text(80),
  type: E(VEHICLE_TYPES).default("TRUCK"),
  brand: text(60),
  model: text(60),
  year: emptyOr(z.coerce.number().int().min(1950).max(2100)).optional(),
  vin: text(40),
  fuelType: E(FUEL_TYPES).default("DIESEL"),
  odometer: km.default(0),
  acquisitionDate: optDate,
  acquisitionCost: money.default(0),
  branchId: emptyOr(uuid).optional(),
  costCenterId: emptyOr(uuid).optional(),
  notes: text(1000),
});
export const updateVehicleSchema = vehicleSchema.extend({ id: uuid, status: E(VEHICLE_STATUSES).default("ACTIVE") });

export const driverSchema = z.object({
  fullName: z.string().trim().min(2, "Nom requis").max(120),
  employeeId: emptyOr(uuid).optional(),
  phone: text(40),
  licenseNumber: text(40),
  licenseCategory: text(20),
  licenseExpiry: optDate,
  notes: text(500),
});
export const updateDriverSchema = driverSchema.extend({ id: uuid, status: E([{ value: "ACTIVE" }, { value: "SUSPENDED" }, { value: "LEFT" }]).default("ACTIVE") });

export const assignmentSchema = z.object({ vehicleId: uuid, driverId: uuid, startDate: dateStr, note: text(200) });

export const tripSchema = z.object({
  vehicleId: uuid,
  driverId: uuid,
  origin: z.string().trim().min(2, "Départ requis").max(120),
  destination: z.string().trim().min(2, "Destination requise").max(120),
  purpose: text(200),
  plannedStart: z.string().min(10, "Date de départ requise"),
  plannedEnd: z.string().optional().or(z.literal("")),
  cargo: text(200),
  customerId: emptyOr(uuid).optional(),
  projectId: emptyOr(uuid).optional(),
  revenue: money.default(0),
  notes: text(500),
});
export const updateTripSchema = tripSchema.extend({ id: uuid });
export const startTripSchema = z.object({ id: uuid, startKm: optKm });
export const finishTripSchema = z.object({ id: uuid, endKm: km, revenue: emptyOr(money).optional(), notes: text(500) });

export const fuelSchema = z.object({
  vehicleId: uuid,
  driverId: emptyOr(uuid).optional(),
  date: dateStr,
  liters: z.coerce.number().positive("Litres > 0").max(5000),
  /** Au moins l'un des deux : le serveur calcule l'autre. */
  unitPrice: emptyOr(money).optional(),
  amount: emptyOr(money).optional(),
  odometer: km,
  fullTank: z.boolean().default(true),
  station: text(100),
  notes: text(300),
});

export const maintenanceSchema = z.object({
  vehicleId: uuid,
  type: E(MAINTENANCE_TYPES),
  status: E([{ value: "PLANNED" }, { value: "DONE" }]).default("DONE"),
  date: dateStr,
  odometer: optKm,
  description: z.string().trim().min(3, "Description requise").max(300),
  supplierId: emptyOr(uuid).optional(),
  cost: money.default(0),
  nextDueDate: optDate,
  nextDueKm: optKm,
  notes: text(500),
});
export const updateMaintenanceSchema = maintenanceSchema.extend({ id: uuid });
export const completeMaintenanceSchema = z.object({ id: uuid, date: dateStr, odometer: optKm, cost: money.default(0), nextDueDate: optDate, nextDueKm: optKm, notes: text(500) });

export const complianceSchema = z.object({
  vehicleId: uuid,
  kind: E(COMPLIANCE_KINDS),
  reference: text(80),
  provider: text(100),
  startDate: optDate,
  expiresAt: dateStr,
  cost: money.default(0),
  notes: text(300),
});

export const fineSchema = z.object({
  number: z.string().trim().min(2, "Numéro de PV requis").max(60),
  vehicleId: uuid,
  /** Vide = chauffeur déduit de la mission ou de l'affectation en cours à la date de l'infraction. */
  driverId: emptyOr(uuid).optional(),
  date: dateStr,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure HH:MM").optional().or(z.literal("")),
  place: text(150),
  offence: z.string().trim().min(3, "Infraction requise").max(150),
  amount: z.coerce.number().positive("Montant > 0").max(1e13),
  dueDate: optDate,
  notes: text(500),
});
export const updateFineSchema = fineSchema.extend({ id: uuid });
export const fineStatusSchema = z.object({ id: uuid, status: E(FINE_STATUSES), paidAt: optDate, reason: text(300) });
