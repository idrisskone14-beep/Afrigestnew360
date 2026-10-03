import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as ops from "@/modules/fleet/operations";
import { complianceSchema, driverSchema, fuelSchema, maintenanceSchema, tripSchema, vehicleSchema } from "@/modules/fleet/schemas";
import * as fl from "@/modules/fleet/service";
import { createEmployee } from "@/modules/hr/employees";
import { employeeSchema } from "@/modules/hr/schemas";
import { ctxFor, makeCompany } from "../helpers";

const iso = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const at = (n: number, hhmm = "08:00") => `${iso(n)}T${hhmm}`;

async function setup() {
  const co = await makeCompany("FLOTTE", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const vehicle = (over: Record<string, unknown> = {}) => fl.createVehicle(ctx, vehicleSchema.parse({ plate: `CI ${Math.floor(1000 + Math.random() * 8999)} AB 01`, type: "TRUCK", brand: "Renault", model: "Kerax", odometer: 10000, ...over }));
  const driver = (over: Record<string, unknown> = {}) => fl.createDriver(ctx, driverSchema.parse({ fullName: `Chauffeur ${Math.random().toString(36).slice(2, 6)}`, licenseExpiry: iso(400), ...over }));
  const insure = (vehicleId: string, kind = "INSURANCE", expiresAt = iso(200), over: Record<string, unknown> = {}) => fl.addCompliance(ctx, complianceSchema.parse({ vehicleId, kind, expiresAt, ...over }));
  const trip = (vehicleId: string, driverId: string, over: Record<string, unknown> = {}) => ops.createTrip(ctx, tripSchema.parse({ vehicleId, driverId, origin: "Abidjan", destination: "Bouaké", plannedStart: at(1), plannedEnd: at(2), ...over }));
  return { ...co, ctx, vehicle, driver, insure, trip };
}

describe("véhicules et chauffeurs", () => {
  it("immatriculation normalisée et unique ; isolation entre entreprises ; retrait refusé avec une mission", async () => {
    const s = await setup();
    const v = await s.vehicle({ plate: " ci 1234 ab 01 " });
    expect(v.plate).toBe("CI-1234-AB-01");
    await expect(s.vehicle({ plate: "CI-1234-AB-01" })).rejects.toMatchObject({ code: "CONFLICT" });
    const B = await setup();
    await expect(fl.getVehicle(B.ctx, v.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(fl.archiveVehicle(B.ctx, v.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await fl.listVehicles(B.ctx, { skip: 0, take: 10 })).total).toBe(0);
    const bv = await B.vehicle({ plate: "CI-1234-AB-01" }); // même plaque dans une autre entreprise : autorisé
    expect(bv.plate).toBe(v.plate);
    const dr = await s.driver();
    await s.trip(v.id, dr.id);
    await expect(fl.archiveVehicle(s.ctx, v.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(fl.archiveDriver(s.ctx, dr.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(fl.assignDriver(B.ctx, { vehicleId: v.id, driverId: dr.id, startDate: iso(0) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // un véhicule vendu ne revient pas en service
    const old = await s.vehicle();
    await fl.updateVehicle(s.ctx, { ...vehicleSchema.parse({ plate: old.plate, odometer: 10000 }), id: old.id, status: "SOLD" } as never);
    await expect(fl.updateVehicle(s.ctx, { ...vehicleSchema.parse({ plate: old.plate, odometer: 10000 }), id: old.id, status: "ACTIVE" } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("références d'agence et de centre de coûts validées dans l'entreprise ; chauffeur lié à un salarié une seule fois", async () => {
    const A = await setup(), B = await setup();
    const foreign = await B.ctx.db.costCenter.create({ data: { companyId: B.company.id, code: "CC-X", name: "Étranger" } });
    await expect(A.vehicle({ costCenterId: foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const emp = await createEmployee(A.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2022-01-03", baseSalary: 0 }));
    await A.driver({ employeeId: emp.id });
    await expect(A.driver({ employeeId: emp.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(A.driver({ employeeId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("kilométrage", () => {
  it("jamais en dessous du dernier relevé ; le compteur suit le plus élevé, même en saisies simultanées", async () => {
    const s = await setup();
    const v = await s.vehicle({ odometer: 50000 });
    const fuel = (odometer: number, over = {}) => ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: v.id, date: iso(0), liters: 40, amount: 40000, odometer, ...over }));
    await expect(fuel(49999)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("inférieur") });
    await fuel(50400);
    expect((await fl.getVehicle(s.ctx, v.id)).odometer).toBe(50400);
    await Promise.allSettled([fuel(50800), fuel(51200), fuel(50600)]);
    expect((await fl.getVehicle(s.ctx, v.id)).odometer).toBe(51200);
  });

  it("saisie a posteriori : cohérente avec les relevés voisins dans le temps, sans modifier le compteur", async () => {
    const s = await setup();
    const v = await s.vehicle({ odometer: 50000 });
    const fuel = (daysAgo: number, odometer: number) => ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: v.id, date: iso(-daysAgo), liters: 40, amount: 30000, odometer }));
    await fuel(0, 50400);
    await fuel(10, 50100); // plus ancien et plus bas : accepté
    expect((await fl.getVehicle(s.ctx, v.id)).odometer).toBe(50400); // le compteur ne recule pas
    await expect(fuel(5, 50600)).rejects.toMatchObject({ message: expect.stringContaining("incohérent") }); // au-dessus du relevé d'aujourd'hui
    await expect(fuel(5, 50050)).rejects.toMatchObject({ message: expect.stringContaining("incohérent") }); // en dessous du relevé d'il y a 10 jours
    await expect(fuel(20, 50200)).rejects.toMatchObject({ message: expect.stringContaining("incohérent") }); // plus ancien mais au-dessus d'un relevé plus récent
    await fuel(20, 49800);
    await fuel(5, 50250); // entre les deux
    expect(await s.ctx.db.fuelLog.count({ where: { vehicleId: v.id } })).toBe(4);
  });
});

describe("missions", () => {
  it("numérotation, chevauchements véhicule / chauffeur, permis, chauffeur inactif, véhicule hors service", async () => {
    const s = await setup();
    const v = await s.vehicle(), dr = await s.driver(), dr2 = await s.driver(), v2 = await s.vehicle();
    const t1 = await s.trip(v.id, dr.id, { plannedStart: at(1, "08:00"), plannedEnd: at(1, "18:00") });
    expect(t1.number).toMatch(/^MIS-\d{4}-00001$/);
    await expect(s.trip(v.id, dr2.id, { plannedStart: at(1, "10:00"), plannedEnd: at(1, "12:00") })).rejects.toMatchObject({ message: expect.stringContaining("véhicule est déjà occupé") });
    await expect(s.trip(v2.id, dr.id, { plannedStart: at(1, "17:00"), plannedEnd: at(2, "07:00") })).rejects.toMatchObject({ message: expect.stringContaining("chauffeur est déjà occupé") });
    await expect(s.trip(v.id, dr.id, { plannedStart: at(1, "18:00"), plannedEnd: at(1, "20:00") })).resolves.toBeTruthy(); // bout à bout : pas de chevauchement
    await expect(s.trip(v.id, dr.id, { plannedStart: at(3), plannedEnd: at(2) })).rejects.toMatchObject({ message: expect.stringContaining("arrivée") });
    const expired = await s.driver({ licenseExpiry: iso(-3) });
    await expect(s.trip(v2.id, expired.id)).rejects.toMatchObject({ message: expect.stringContaining("permis") });
    const suspended = await s.driver();
    await fl.updateDriver(s.ctx, { ...driverSchema.parse({ fullName: "Suspendu", licenseExpiry: iso(400) }), id: suspended.id, status: "SUSPENDED" } as never);
    await expect(s.trip(v2.id, suspended.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await fl.updateVehicle(s.ctx, { ...vehicleSchema.parse({ plate: v2.plate, odometer: 10000 }), id: v2.id, status: "OUT_OF_SERVICE" } as never);
    await expect(s.trip(v2.id, dr2.id)).rejects.toMatchObject({ message: expect.stringContaining("pas en service") });
  });

  it("deux missions simultanées sur le même véhicule : une seule est créée", async () => {
    const s = await setup();
    const v = await s.vehicle();
    const a = await s.driver(), b = await s.driver();
    const r = await Promise.allSettled([s.trip(v.id, a.id), s.trip(v.id, b.id)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await s.ctx.db.trip.count({ where: { vehicleId: v.id } })).toBe(1);
  });

  it("cycle de vie : démarrage, clôture (distance, compteur, produit), annulation ; assurance expirée bloquante", async () => {
    const s = await setup();
    const v = await s.vehicle({ odometer: 20000 }), dr = await s.driver();
    const ins = await s.insure(v.id, "INSURANCE", iso(-5)); // expirée
    await expect(s.trip(v.id, dr.id)).rejects.toMatchObject({ message: expect.stringContaining("assurance") });
    await s.ctx.db.vehicleCompliance.delete({ where: { id: ins.id } });
    await s.insure(v.id, "INSURANCE", iso(300));
    await s.insure(v.id, "TECHNICAL_INSPECTION", iso(100));
    const t = await s.trip(v.id, dr.id, { revenue: 150000 });
    await expect(ops.finishTrip(s.ctx, { id: t.id, endKm: 21000 } as never)).rejects.toMatchObject({ message: expect.stringContaining("en cours") });
    await expect(ops.startTrip(s.ctx, { id: t.id, startKm: 19000 } as never)).rejects.toMatchObject({ message: expect.stringContaining("inférieur") });
    const started = await ops.startTrip(s.ctx, { id: t.id, startKm: "" } as never);
    expect(started).toMatchObject({ status: "IN_PROGRESS", startKm: 20000 });
    await expect(ops.startTrip(s.ctx, { id: t.id } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(ops.finishTrip(s.ctx, { id: t.id, endKm: 19990 } as never)).rejects.toMatchObject({ message: expect.stringContaining("inférieur au départ") });
    const done = await ops.finishTrip(s.ctx, { id: t.id, endKm: 20620, revenue: 180000 } as never);
    expect(done).toMatchObject({ status: "DONE", distanceKm: 620 });
    expect(Number(done.revenue)).toBe(180000);
    expect((await fl.getVehicle(s.ctx, v.id)).odometer).toBe(20620);
    await expect(ops.cancelTrip(s.ctx, t.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const t2 = await s.trip(v.id, dr.id, { plannedStart: at(5), plannedEnd: at(6) });
    await ops.cancelTrip(s.ctx, t2.id);
    expect((await ops.getTrip(s.ctx, t2.id)).status).toBe("CANCELLED");
    // véhicule ou chauffeur déjà en mission : un second départ est refusé
    const t3 = await s.trip(v.id, dr.id, { plannedStart: at(7), plannedEnd: at(8) });
    const t4 = await s.trip(v.id, dr.id, { plannedStart: at(9), plannedEnd: at(10) });
    await ops.startTrip(s.ctx, { id: t3.id } as never);
    await expect(ops.startTrip(s.ctx, { id: t4.id } as never)).rejects.toMatchObject({ message: expect.stringContaining("déjà en mission") });
  });
});

describe("carburant et consommation", () => {
  it("prix au litre ou montant (l'autre est calculé) ; consommation entre pleins complets (fonction pure)", async () => {
    const s = await setup();
    const v = await s.vehicle({ odometer: 1000 });
    const f1 = await ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: v.id, date: iso(-10), liters: 50, unitPrice: 800, odometer: 1000 }));
    expect(Number(f1.amount)).toBe(40000);
    const f2 = await ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: v.id, date: iso(-5), liters: 30, amount: 24000, odometer: 1500 }));
    expect(Number(f2.unitPrice)).toBe(800);
    await expect(ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: v.id, date: iso(-1), liters: 30, odometer: 1600 }))).rejects.toMatchObject({ message: expect.stringContaining("prix au litre ou le montant") });
    await expect(ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: v.id, date: iso(20), liters: 30, amount: 1, odometer: 1700 }))).rejects.toMatchObject({ message: expect.stringContaining("futur") });
    const log = (odometer: number, liters: number, fullTank = true) => ({ date: new Date(), liters, odometer, fullTank });
    const st = ops.fuelStats([log(1000, 50), log(1500, 30), log(2000, 20, false), log(2400, 25)]);
    expect(st.segments).toEqual([{ odometer: 1500, distance: 500, liters: 30, per100: 6 }, { odometer: 2400, distance: 900, liters: 45, per100: 5 }]);
    expect(st.per100).toBe(5.4); // (30 + 45) / 1400 km
    expect(ops.fuelStats([log(1000, 50)]).per100).toBeNull();
    expect(ops.fuelStats([log(1000, 40, false), log(1500, 30)]).per100).toBeNull(); // pas de plein complet de référence
    const noMotor = await s.vehicle({ type: "TRAILER", fuelType: "NONE" });
    await expect(ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: noMotor.id, date: iso(0), liters: 5, amount: 100, odometer: 0 }))).rejects.toMatchObject({ message: expect.stringContaining("pas de moteur") });
  });
});

describe("entretiens et conformité", () => {
  it("planification, réalisation (coût, compteur, prochaine échéance), annulation ; échéance cohérente", async () => {
    const s = await setup();
    const v = await s.vehicle({ odometer: 30000 });
    const m = await ops.addMaintenance(s.ctx, maintenanceSchema.parse({ vehicleId: v.id, type: "PREVENTIVE", status: "PLANNED", date: iso(10), description: "Vidange 30 000 km" }));
    expect(m.status).toBe("PLANNED");
    await expect(ops.addMaintenance(s.ctx, maintenanceSchema.parse({ vehicleId: v.id, type: "REPAIR", status: "DONE", date: iso(5), description: "Futur" }))).rejects.toMatchObject({ message: expect.stringContaining("futur") });
    const done = await ops.completeMaintenance(s.ctx, { id: m.id, date: iso(0), odometer: 30250, cost: 85000, nextDueKm: 40000, nextDueDate: iso(180) } as never);
    expect(done).toMatchObject({ status: "DONE", odometer: 30250, nextDueKm: 40000 });
    expect((await fl.getVehicle(s.ctx, v.id)).odometer).toBe(30250);
    await expect(ops.completeMaintenance(s.ctx, { id: m.id, date: iso(0), cost: 1 } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(ops.addMaintenance(s.ctx, maintenanceSchema.parse({ vehicleId: v.id, type: "REPAIR", date: iso(0), description: "Embrayage", nextDueDate: iso(-1) }))).rejects.toMatchObject({ message: expect.stringContaining("échéance") });
    const m2 = await ops.addMaintenance(s.ctx, maintenanceSchema.parse({ vehicleId: v.id, type: "TIRES", status: "PLANNED", date: iso(20), description: "Pneus" }));
    await ops.cancelMaintenance(s.ctx, m2.id);
    await expect(ops.cancelMaintenance(s.ctx, m2.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("seul le document le plus récent de chaque type compte ; états OK / bientôt / expiré / absent (pur)", () => {
    const today = new Date("2026-10-03T00:00:00Z");
    const d = (days: number) => new Date(today.getTime() + days * 86_400_000);
    expect(fl.complianceStatus([], "INSURANCE", today)).toEqual({ state: "MISSING", expiresAt: null });
    expect(fl.complianceStatus([{ kind: "INSURANCE", expiresAt: d(-10) }, { kind: "INSURANCE", expiresAt: d(300) }], "INSURANCE", today).state).toBe("OK"); // renouvelée
    expect(fl.complianceStatus([{ kind: "INSURANCE", expiresAt: d(20) }], "INSURANCE", today).state).toBe("EXPIRING");
    expect(fl.complianceStatus([{ kind: "INSURANCE", expiresAt: d(-1) }], "INSURANCE", today).state).toBe("EXPIRED");
    expect(fl.complianceStatus([{ kind: "INSURANCE", expiresAt: d(0) }], "INSURANCE", today).state).toBe("EXPIRING"); // le jour même : encore valable
    expect(fl.complianceStatus([{ kind: "TECHNICAL_INSPECTION", expiresAt: d(-1) }], "INSURANCE", today).state).toBe("MISSING");
  });
});

describe("affectations", () => {
  it("une nouvelle affectation clôt la précédente ; chauffeur déduit de la mission puis de l'affectation", async () => {
    const s = await setup();
    const v = await s.vehicle(), a = await s.driver(), b = await s.driver();
    await s.insure(v.id, "INSURANCE"); await s.insure(v.id, "TECHNICAL_INSPECTION");
    await fl.assignDriver(s.ctx, { vehicleId: v.id, driverId: a.id, startDate: iso(-30) } as never);
    await fl.assignDriver(s.ctx, { vehicleId: v.id, driverId: b.id, startDate: iso(-10) } as never);
    await expect(fl.assignDriver(s.ctx, { vehicleId: v.id, driverId: a.id, startDate: iso(-20) } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const list = await fl.listAssignments(s.ctx, v.id);
    expect(list.map((x) => [x.driver.id, x.endDate?.toISOString().slice(0, 10) ?? null])).toEqual([[b.id, null], [a.id, iso(-11)]]);
    const noon = (n: number) => new Date(`${iso(n)}T12:00:00Z`);
    expect(await fl.driverAt(s.ctx.db, v.id, noon(-20))).toBe(a.id);
    expect(await fl.driverAt(s.ctx.db, v.id, noon(-5))).toBe(b.id);
    expect(await fl.driverAt(s.ctx.db, v.id, noon(-40))).toBeNull();
    // une mission en cours prime sur l'affectation
    const c = await s.driver();
    const t = await s.trip(v.id, c.id, { plannedStart: at(0, "06:00"), plannedEnd: at(0, "20:00") });
    await ops.startTrip(s.ctx, { id: t.id } as never);
    expect(await fl.driverAt(s.ctx.db, v.id, new Date(Date.now() + 1000))).toBe(c.id);
  });
});
