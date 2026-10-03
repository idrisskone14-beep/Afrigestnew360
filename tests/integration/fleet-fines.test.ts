import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { createExpenseFromCost, fleetAttention, vehicleEconomics } from "@/modules/fleet/costs";
import { FINE_TRANSITIONS, analyzeFines, createFine, deleteFine, fineAnalytics, getFine, listFines, setFineStatus, updateFine, type FineRow } from "@/modules/fleet/fines";
import * as ops from "@/modules/fleet/operations";
import { complianceSchema, driverSchema, fineSchema, fuelSchema, maintenanceSchema, tripSchema, vehicleSchema } from "@/modules/fleet/schemas";
import * as fl from "@/modules/fleet/service";
import { setCompanyModule } from "@/modules/platform/companies";
import { addMember, ctxFor, makeCompany } from "../helpers";

const iso = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const at = (n: number, hhmm = "08:00") => `${iso(n)}T${hhmm}`;

async function setup() {
  const co = await makeCompany("PV", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const vehicle = (over: Record<string, unknown> = {}) => fl.createVehicle(ctx, vehicleSchema.parse({ plate: `CI-${Math.floor(1000 + Math.random() * 8999)}-AB`, type: "TRUCK", odometer: 1000, ...over }));
  const driver = (name = `Chauffeur ${Math.random().toString(36).slice(2, 6)}`) => fl.createDriver(ctx, driverSchema.parse({ fullName: name, licenseExpiry: iso(400) }));
  const fine = (vehicleId: string, over: Record<string, unknown> = {}) => createFine(ctx, fineSchema.parse({ number: `PV-${Math.random().toString(36).slice(2, 8)}`, vehicleId, date: iso(-3), offence: "Excès de vitesse", amount: 25000, ...over }));
  return { ...co, ctx, vehicle, driver, fine };
}

describe("contraventions", () => {
  it("PV unique par entreprise, chauffeur déduit de la mission en cours ou de l'affectation, validations de dates", async () => {
    const s = await setup();
    const v = await s.vehicle(), a = await s.driver("Awa Traoré"), b = await s.driver("Moussa Diallo");
    await fl.assignDriver(s.ctx, { vehicleId: v.id, driverId: a.id, startDate: iso(-30) } as never);
    const f1 = await s.fine(v.id, { number: "pv-001", date: iso(-5) });
    expect(f1).toMatchObject({ number: "PV-001", status: "TO_PAY", driverId: a.id }); // chauffeur affecté ce jour-là
    await expect(s.fine(v.id, { number: "PV-001" })).rejects.toMatchObject({ code: "CONFLICT" });
    // mission en cours : son chauffeur est au volant, pas l'affecté
    const t = await ops.createTrip(s.ctx, tripSchema.parse({ vehicleId: v.id, driverId: b.id, origin: "Abidjan", destination: "Bouaké", plannedStart: at(0, "00:30"), plannedEnd: at(0, "23:00") }));
    await ops.startTrip(s.ctx, { id: t.id } as never);
    const f2 = await s.fine(v.id, { date: iso(0), time: "23:59" });
    expect(f2.driverId).toBe(b.id);
    expect((await s.fine(v.id, { date: iso(0), driverId: a.id })).driverId).toBe(a.id); // choix explicite respecté
    await expect(s.fine(v.id, { date: iso(30) })).rejects.toMatchObject({ message: expect.stringContaining("futur") });
    await expect(s.fine(v.id, { date: iso(-3), dueDate: iso(-10) })).rejects.toMatchObject({ message: expect.stringContaining("échéance") });
    expect(fineSchema.safeParse({ number: "X1", vehicleId: v.id, date: iso(0), offence: "Test", amount: 0 }).success).toBe(false);
    expect(fineSchema.safeParse({ number: "X1", vehicleId: v.id, date: iso(0), offence: "Test", amount: 10, time: "25:00" }).success).toBe(false);
  });

  it("statuts : transitions autorisées, motif de contestation, payée et annulée définitives, modification et suppression", async () => {
    const s = await setup();
    const v = await s.vehicle();
    const f = await s.fine(v.id);
    await expect(setFineStatus(s.ctx, { id: f.id, status: "TO_PAY" } as never)).rejects.toMatchObject({ message: expect.stringContaining("déjà ce statut") });
    await expect(setFineStatus(s.ctx, { id: f.id, status: "CONTESTED" } as never)).rejects.toMatchObject({ message: expect.stringContaining("motif") });
    await setFineStatus(s.ctx, { id: f.id, status: "CONTESTED", reason: "Radar non homologué" } as never);
    expect(await getFine(s.ctx, f.id)).toMatchObject({ status: "CONTESTED", contestReason: "Radar non homologué" });
    await setFineStatus(s.ctx, { id: f.id, status: "PAID", paidAt: iso(0) } as never);
    expect(await getFine(s.ctx, f.id)).toMatchObject({ status: "PAID", contestReason: null });
    for (const to of ["TO_PAY", "CONTESTED", "CANCELLED"]) await expect(setFineStatus(s.ctx, { id: f.id, status: to, reason: "x" } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(updateFine(s.ctx, { ...fineSchema.parse({ number: f.number, vehicleId: v.id, date: iso(-3), offence: "Excès de vitesse", amount: 1 }), id: f.id })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(deleteFine(s.ctx, f.id)).rejects.toMatchObject({ message: expect.stringContaining("payée") });
    expect(FINE_TRANSITIONS.PAID).toEqual([]);
    const g = await s.fine(v.id);
    await expect(setFineStatus(s.ctx, { id: g.id, status: "PAID", paidAt: iso(-30) } as never)).rejects.toMatchObject({ message: expect.stringContaining("précède") });
    await setFineStatus(s.ctx, { id: g.id, status: "CANCELLED", reason: "Erreur de plaque" } as never);
    await expect(setFineStatus(s.ctx, { id: g.id, status: "TO_PAY" } as never)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    // modification possible tant qu'elle n'est pas payée / annulée ; suppression d'une contravention à payer
    const h = await s.fine(v.id, { amount: 10000 });
    await updateFine(s.ctx, { ...fineSchema.parse({ number: h.number, vehicleId: v.id, date: iso(-3), offence: "Stationnement gênant", amount: 15000 }), id: h.id });
    expect(Number((await getFine(s.ctx, h.id)).amount)).toBe(15000);
    await deleteFine(s.ctx, h.id);
    await expect(getFine(s.ctx, h.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("isolation : une entreprise ne voit ni ne modifie les contraventions d'une autre", async () => {
    const A = await setup(), B = await setup();
    const f = await A.fine((await A.vehicle()).id);
    await expect(getFine(B.ctx, f.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setFineStatus(B.ctx, { id: f.id, status: "PAID" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteFine(B.ctx, f.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listFines(B.ctx, { skip: 0, take: 20 })).total).toBe(0);
    expect((await fineAnalytics(B.ctx, {})).count).toBe(0);
    // même numéro de PV dans une autre entreprise : autorisé
    await expect(B.fine((await B.vehicle()).id, { number: f.number })).resolves.toBeTruthy();
    // un véhicule d'une autre entreprise ne peut pas recevoir de PV
    await expect(B.fine((await A.vehicle()).id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("filtres de la liste : texte, statut, véhicule, à payer en retard", async () => {
    const s = await setup();
    const v = await s.vehicle(), w = await s.vehicle();
    await s.fine(v.id, { offence: "Excès de vitesse", dueDate: iso(-2) });
    await s.fine(v.id, { offence: "Feu rouge", dueDate: iso(10) });
    const paid = await s.fine(w.id, { offence: "Stationnement" });
    await setFineStatus(s.ctx, { id: paid.id, status: "PAID", paidAt: iso(0) } as never);
    const n = async (p: Record<string, unknown>) => (await listFines(s.ctx, { skip: 0, take: 50, ...p })).total;
    expect(await n({})).toBe(3);
    expect(await n({ q: "vitesse" })).toBe(1);
    expect(await n({ status: "PAID" })).toBe(1);
    expect(await n({ vehicleId: v.id })).toBe(2);
    expect(await n({ overdue: true })).toBe(1);
  });
});

describe("analyses des contraventions (pur)", () => {
  const row = (id: string, date: string, amount: number, over: Partial<FineRow> = {}): FineRow => ({ id, date: new Date(date), amount, status: "TO_PAY", offence: "Excès de vitesse", vehicleId: "V1", vehicle: "CI-1", driverId: "D1", driver: "Awa", ...over });

  it("totaux hors annulées, par véhicule et par chauffeur, infractions fréquentes normalisées, évolution mensuelle", () => {
    const a = analyzeFines([
      row("1", "2026-08-10", 25000), row("2", "2026-08-20", 25000, { offence: "EXCES DE VITESSE", vehicleId: "V2", vehicle: "CI-2", driverId: "D2", driver: "Moussa" }),
      row("3", "2026-09-05", 50000, { offence: "Stationnement gênant", status: "PAID" }), row("4", "2026-09-06", 99999, { status: "CANCELLED" }), row("5", "2026-09-07", 10000, { driverId: null, driver: null }),
    ], new Date("2026-10-03"));
    expect(a).toMatchObject({ count: 4, total: 110000, unassigned: 1 });
    expect(a.byStatus.find((x) => x.status === "CANCELLED")).toMatchObject({ count: 1, amount: 99999 });
    expect(a.byVehicle.map((x) => [x.label, x.amount, x.count])).toEqual([["CI-1", 85000, 3], ["CI-2", 25000, 1]]);
    expect(a.byDriver.map((x) => x.label)).toEqual(["Awa", "Moussa"]); // sans chauffeur : non attribué, pas dans le classement
    expect(a.offences[0]).toMatchObject({ count: 3 }); // « Excès de vitesse » (casse et accents ignorés)
    expect(a.monthly).toEqual([{ month: "2026-08", count: 2, amount: 50000 }, { month: "2026-09", count: 2, amount: 60000 }]);
  });

  it("récidives : au moins 2 PV sur les 12 derniers mois (chauffeur, véhicule) et même infraction répétée", () => {
    const a = analyzeFines([
      row("1", "2026-01-10", 10000), row("2", "2026-05-10", 10000), row("3", "2026-06-10", 20000, { offence: "Feu rouge" }),
      row("4", "2024-01-01", 10000, { driverId: "D3", driver: "Ancien", vehicleId: "V3", vehicle: "CI-3" }), row("5", "2024-02-01", 10000, { driverId: "D3", driver: "Ancien", vehicleId: "V3", vehicle: "CI-3" }), // trop anciens
      row("6", "2026-06-11", 5000, { driverId: "D4", driver: "Une fois", vehicleId: "V4", vehicle: "CI-4" }),
    ], new Date("2026-10-03"));
    expect(a.repeatDrivers).toEqual([{ id: "D1", label: "Awa", count: 3, amount: 40000 }]);
    expect(a.repeatVehicles.map((x) => x.id)).toEqual(["V1"]);
    expect(a.repeatedOffences).toEqual([{ driver: "Awa", offence: "Excès de vitesse", count: 2 }]);
  });
});

describe("coûts, rentabilité et alertes", () => {
  it("coût par véhicule = carburant + entretiens réalisés + assurances + PV (hors annulés) ; marge et coût au km", async () => {
    const s = await setup();
    const v = await s.vehicle({ odometer: 1000 }), dr = await s.driver();
    await fl.addCompliance(s.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "INSURANCE", startDate: iso(-20), expiresAt: iso(300), cost: 120000 }));
    await fl.addCompliance(s.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "TECHNICAL_INSPECTION", startDate: iso(-20), expiresAt: iso(300), cost: 20000 }));
    const t = await ops.createTrip(s.ctx, tripSchema.parse({ vehicleId: v.id, driverId: dr.id, origin: "Abidjan", destination: "Bouaké", plannedStart: at(0, "00:00"), plannedEnd: at(0, "23:00"), revenue: 500000 }));
    await ops.startTrip(s.ctx, { id: t.id, startKm: 1000 } as never);
    await ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: v.id, date: iso(-1), liters: 50, amount: 40000, odometer: 1000 }));
    await ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: v.id, date: iso(0), liters: 100, amount: 80000, odometer: 1500 }));
    await ops.finishTrip(s.ctx, { id: t.id, endKm: 1500 } as never);
    await ops.addMaintenance(s.ctx, maintenanceSchema.parse({ vehicleId: v.id, type: "REPAIR", date: iso(0), description: "Freins", cost: 60000 }));
    await ops.addMaintenance(s.ctx, maintenanceSchema.parse({ vehicleId: v.id, type: "PREVENTIVE", status: "PLANNED", date: iso(5), description: "Prévu", cost: 999999 })); // planifié : non compté
    await s.fine(v.id, { date: iso(-2), amount: 25000 });
    const cancelled = await s.fine(v.id, { amount: 77777 });
    await setFineStatus(s.ctx, { id: cancelled.id, status: "CANCELLED", reason: "Erreur" } as never);
    const [e] = await vehicleEconomics(s.ctx, { from: new Date(`${iso(-30)}T00:00:00Z`), to: new Date(`${iso(2)}T00:00:00Z`) });
    expect(e).toMatchObject({ trips: 1, km: 500, revenue: 500000, fuel: 120000, liters: 150, maintenance: 60000, compliance: 140000, fines: 25000, cost: 345000, margin: 155000, costPerKm: 690, per100: 20 });
    // hors période : rien
    const [none] = await vehicleEconomics(s.ctx, { from: new Date(`${iso(-400)}T00:00:00Z`), to: new Date(`${iso(-300)}T00:00:00Z`) });
    expect(none).toMatchObject({ trips: 0, cost: 0, margin: 0, costPerKm: null });
  });

  it("une dépense créée dans Finance à partir d'un coût n'est jamais comptée deux fois ; une seule dépense par enregistrement", async () => {
    const s = await setup();
    const cc = await s.ctx.db.costCenter.create({ data: { companyId: s.company.id, code: "CC-FL", name: "Flotte" } });
    const v = await s.vehicle({ costCenterId: cc.id });
    const fuel = await ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: v.id, date: iso(-1), liters: 40, amount: 32000, odometer: 1200 }));
    const exp = await createExpenseFromCost(s.ctx, "fuel", fuel.id);
    const e = await s.ctx.db.expense.findFirstOrThrow({ where: { id: exp.id }, include: { category: true } });
    expect(e).toMatchObject({ status: "DRAFT", costCenterId: cc.id });
    expect(Number(e.amount)).toBe(32000);
    expect(e.category.name).toBe("Transport et carburant");
    await expect(createExpenseFromCost(s.ctx, "fuel", fuel.id)).rejects.toMatchObject({ message: expect.stringContaining("existe déjà") });
    await expect(ops.deleteFuel(s.ctx, fuel.id)).rejects.toMatchObject({ message: expect.stringContaining("dépense") });
    const [row] = await vehicleEconomics(s.ctx, {});
    expect(row!.fuel).toBe(32000); // compté une fois en flotte
    const m = await ops.addMaintenance(s.ctx, maintenanceSchema.parse({ vehicleId: v.id, type: "REPAIR", status: "PLANNED", date: iso(3), description: "À faire", cost: 1000 }));
    await expect(createExpenseFromCost(s.ctx, "maintenance", m.id)).rejects.toMatchObject({ message: expect.stringContaining("réalisé") });
    const fine = await s.fine(v.id, { amount: 18000 });
    const fe = await createExpenseFromCost(s.ctx, "fine", fine.id);
    expect(Number((await s.ctx.db.expense.findFirstOrThrow({ where: { id: fe.id } })).amount)).toBe(18000);
    await expect(setFineStatus(s.ctx, { id: fine.id, status: "CANCELLED", reason: "x" } as never)).rejects.toMatchObject({ message: expect.stringContaining("dépense") });
    // sans le module Finance : refusé
    await setCompanyModule(s.company.id, "finance", false);
    const f2 = await s.fine(v.id);
    await expect(createExpenseFromCost(await ctxFor(s.owner.id, s.company.id), "fine", f2.id)).rejects.toMatchObject({ message: expect.stringContaining("Finance") });
    // et sans le droit de créer des dépenses
    await setCompanyModule(s.company.id, "finance", true);
    const fleetOnly = await ctxFor((await addMember(s.company.id, "fleet_manager")).user.id, s.company.id); // pas de finance.expense.create
    await expect(createExpenseFromCost(fleetOnly, "fine", f2.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("alertes : assurance / visite expirées ou proches, permis, entretien dû en date ou en km, PV à payer ; isolation", async () => {
    const A = await setup(), B = await setup();
    const v = await A.vehicle({ plate: "CI-ALERT-1", odometer: 39800 });
    const dr = await fl.createDriver(A.ctx, driverSchema.parse({ fullName: "Permis Court", licenseExpiry: iso(10) }));
    void dr;
    await fl.addCompliance(A.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "INSURANCE", expiresAt: iso(10) }));
    await fl.addCompliance(A.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "TECHNICAL_INSPECTION", expiresAt: iso(-3) }));
    await fl.addCompliance(A.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "REGISTRATION", expiresAt: iso(500) }));
    await ops.addMaintenance(A.ctx, maintenanceSchema.parse({ vehicleId: v.id, type: "PREVENTIVE", date: iso(-30), description: "Vidange", cost: 50000, odometer: 39800, nextDueKm: 40000 }));
    await A.fine(v.id, { number: "PV-DUE", dueDate: iso(3) });
    const bare = await A.vehicle({ plate: "CI-NU-1" }); // route sans assurance ni visite renseignées
    const items = await fleetAttention(platformDb, A.company.id);
    const labels = items.map((i) => i.label).join("\n");
    expect(labels).toContain("Assurance expire le");
    expect(labels).toContain("Visite technique expirée le");
    expect(labels).toContain("Permis de Permis Court expire le");
    expect(labels).toContain("Entretien bientôt dû : Vidange");
    expect(labels).toContain("PV PV-DUE à payer avant le");
    expect(labels).toContain("Assurance non renseignée — CI-NU-1");
    expect(labels).not.toContain("Carte grise");
    expect(items[0]!.severity).toBe("danger"); // les urgences d'abord
    expect(bare.id).toBeTruthy();
    // le renouvellement remplace l'alerte
    await fl.addCompliance(A.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "INSURANCE", expiresAt: iso(365) }));
    expect((await fleetAttention(platformDb, A.company.id)).map((i) => i.label).join("\n")).not.toContain("Assurance expire le");
    // aucune fuite vers l'autre entreprise, ni avec ctx.db
    expect(await fleetAttention(platformDb, B.company.id)).toEqual([]);
    expect(await fleetAttention(B.ctx.db, B.company.id)).toEqual([]);
    expect((await fleetAttention(A.ctx.db, A.company.id)).length).toBeGreaterThan(0);
  });
});
