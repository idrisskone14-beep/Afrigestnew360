import { describe, expect, it } from "vitest";
import { platformDb } from "@/core/db/client";
import { renderExport } from "@/core/export/table";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import { budgetSchema, reportSchema, siteSchema } from "@/modules/construction/schemas";
import * as cs from "@/modules/construction/service";
import { WIDGET_BY_KEY, availableWidgets } from "@/modules/dashboard/widgets";
import { createFine } from "@/modules/fleet/fines";
import * as ops from "@/modules/fleet/operations";
import { complianceSchema, driverSchema, fineSchema, fuelSchema, maintenanceSchema, tripSchema, vehicleSchema } from "@/modules/fleet/schemas";
import * as fl from "@/modules/fleet/service";
import { generateAlerts } from "@/modules/platform/alerts";
import { setCompanyModule } from "@/modules/platform/companies";
import { buildReport } from "@/modules/reports/service";
import { globalSearch, searchableTypes } from "@/modules/search/service";
import { addMember, ctxFor, makeCompany } from "../helpers";

const iso = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const co = await makeCompany("EXT", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const vehicle = (plate: string, over: Record<string, unknown> = {}) => fl.createVehicle(ctx, vehicleSchema.parse({ plate, type: "TRUCK", brand: "Renault", model: "Kerax", odometer: 1000, ...over }));
  return { ...co, ctx, vehicle };
}
type S = Awaited<ReturnType<typeof setup>>;
const flat = (g: Awaited<ReturnType<typeof globalSearch>>) => g.flatMap((x) => x.items.map((i) => `${x.type}:${i.label}`));
const notifs = (companyId: string, type: string) => platformDb.notification.findMany({ where: { companyId, type } });

describe("extensions Flotte et Chantiers — recherche, alertes, tableau de bord", () => {
  it("recherche globale : véhicules et chantiers, selon module et droits ; jamais d'une autre entreprise", async () => {
    const A = await setup(), B = await setup();
    await A.vehicle("CI-7777-ZZ", { name: "Camion benne" });
    await cs.createSite(A.ctx, siteSchema.parse({ name: "Pont Zébrure", city: "Bouaké" }));
    await B.vehicle("CI-8888-ZZ");
    expect(flat(await globalSearch(A.ctx, "7777"))).toEqual(["vehicle:CI-7777-ZZ"]);
    expect(flat(await globalSearch(A.ctx, "ci 7777"))).toContain("vehicle:CI-7777-ZZ"); // espaces tolérés
    expect(flat(await globalSearch(A.ctx, "benne"))).toContain("vehicle:CI-7777-ZZ");
    expect(flat(await globalSearch(A.ctx, "zébrure"))).toEqual(expect.arrayContaining(["site:CHA-0001 — Pont Zébrure", "project:Pont Zébrure"])); // le projet associé est aussi trouvé
    expect(flat(await globalSearch(B.ctx, "7777"))).toEqual([]);
    expect(flat(await globalSearch(A.ctx, "8888"))).toEqual([]);
    const viewer = await ctxFor((await addMember(A.company.id, "viewer")).user.id, A.company.id);
    expect(flat(await globalSearch(viewer, "7777")).length).toBe(1);
    const accountant = await ctxFor((await addMember(A.company.id, "accountant")).user.id, A.company.id); // pas de droits flotte
    expect(flat(await globalSearch(accountant, "7777"))).toEqual([]);
    expect(searchableTypes(accountant).map((t) => t.type)).not.toContain("vehicle");
    await setCompanyModule(A.company.id, "fleet", false);
    expect(flat(await globalSearch(await ctxFor(A.owner.id, A.company.id), "7777"))).toEqual([]);
  });

  it("alertes planifiées : entretien, documents de flotte, contraventions ; destinataires habilités seulement ; une fois par fenêtre", async () => {
    const s = await setup();
    const v = await s.vehicle("CI-ALERT-9", { odometer: 39900 });
    await fl.addCompliance(s.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "INSURANCE", expiresAt: iso(7) }));
    await fl.addCompliance(s.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "TECHNICAL_INSPECTION", expiresAt: iso(300) }));
    await ops.addMaintenance(s.ctx, maintenanceSchema.parse({ vehicleId: v.id, type: "PREVENTIVE", date: iso(-20), description: "Vidange", cost: 40000, odometer: 39900, nextDueKm: 40000 }));
    await createFine(s.ctx, fineSchema.parse({ number: "PV-ALERT", vehicleId: v.id, date: iso(-5), offence: "Excès de vitesse", amount: 25000, dueDate: iso(2) }));
    const fleetMgr = await addMember(s.company.id, "fleet_manager");
    const sales = await addMember(s.company.id, "sales_rep");
    await generateAlerts(s.company.id);
    for (const type of ["maintenance.due", "vehicle.expiring", "fine.due"]) {
      const who = (await notifs(s.company.id, type)).map((n) => n.userId).sort();
      expect(who, type).toEqual([s.owner.id, fleetMgr.user.id].sort());
      expect(who).not.toContain(sales.user.id);
    }
    const doc = (await notifs(s.company.id, "vehicle.expiring"))[0]!;
    expect(doc.title).toBe("1 document de flotte à renouveler");
    expect(doc.body).toContain("Assurance expire le");
    expect((await notifs(s.company.id, "fine.due"))[0]!.link).toBe("/app/fleet/contraventions?statut=TO_PAY");
    expect((await generateAlerts(s.company.id)).created).toBe(0); // pas de doublon
    // module désactivé : aucune alerte
    const other = await setup();
    await other.vehicle("CI-X-1");
    await fl.addCompliance(other.ctx, complianceSchema.parse({ vehicleId: (await other.ctx.db.vehicle.findFirstOrThrow()).id, kind: "INSURANCE", expiresAt: iso(-3) }));
    await setCompanyModule(other.company.id, "fleet", false);
    await generateAlerts(other.company.id);
    expect(await notifs(other.company.id, "vehicle.expiring")).toHaveLength(0);
  });

  it("tableau de bord : widgets flotte et chantiers selon module et droits", async () => {
    const s = await setup();
    await s.vehicle("CI-DASH-1");
    const v = await s.ctx.db.vehicle.findFirstOrThrow();
    await fl.addCompliance(s.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "INSURANCE", expiresAt: iso(-2) }));
    const site = await cs.createSite(s.ctx, siteSchema.parse({ name: "Chantier Dash" }));
    await cs.updateSite(s.ctx, { ...siteSchema.parse({ name: "Chantier Dash" }), id: site.id, status: "ACTIVE" } as never);
    await cs.saveReport(s.ctx, reportSchema.parse({ siteId: site.id, date: iso(0), summary: "Démarrage", progress: 40 }));
    const fleetW = await WIDGET_BY_KEY.get("fleet")!.load(s.ctx);
    expect(fleetW).toMatchObject({ kind: "list", items: expect.arrayContaining([expect.objectContaining({ tone: "danger" })]) });
    expect(await WIDGET_BY_KEY.get("sites")!.load(s.ctx)).toMatchObject({ kind: "kpi", value: "1", hint: "avancement moyen 40 %" });
    expect(JSON.stringify(await WIDGET_BY_KEY.get("alerts")!.load(s.ctx))).toContain("flotte");
    const hr = await ctxFor((await addMember(s.company.id, "hr")).user.id, s.company.id);
    expect(availableWidgets(hr).map((w) => w.key)).not.toContain("fleet");
    expect(availableWidgets(s.ctx).map((w) => w.key)).toEqual(expect.arrayContaining(["fleet", "sites"]));
    await setCompanyModule(s.company.id, "construction", false);
    expect(availableWidgets(await ctxFor(s.owner.id, s.company.id)).map((w) => w.key)).not.toContain("sites");
  });
});

describe("extensions — rapports et exports", () => {
  const run = (ctx: S["ctx"], key: string, q: Record<string, string> = {}) => buildReport(ctx, key, (k) => q[k]);

  it("flotte : coûts et rentabilité par véhicule (filtre centre de coûts) ; contraventions par véhicule, chauffeur, infraction, détail ; chantiers", async () => {
    const s = await setup();
    const cc = await s.ctx.db.costCenter.create({ data: { companyId: s.company.id, code: "CC-F", name: "Flotte nord" } });
    const v1 = await s.vehicle("CI-FLOTTE-1", { costCenterId: cc.id, odometer: 1000 }), v2 = await s.vehicle("CI-FLOTTE-2", { odometer: 500 });
    const dr = await fl.createDriver(s.ctx, driverSchema.parse({ fullName: "Awa Traoré", licenseExpiry: iso(300) }));
    for (const v of [v1, v2]) { await fl.addCompliance(s.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "INSURANCE", expiresAt: iso(300) })); await fl.addCompliance(s.ctx, complianceSchema.parse({ vehicleId: v.id, kind: "TECHNICAL_INSPECTION", expiresAt: iso(300) })); }
    const t = await ops.createTrip(s.ctx, tripSchema.parse({ vehicleId: v1.id, driverId: dr.id, origin: "Abidjan", destination: "Bouaké", plannedStart: `${iso(0)}T00:00`, plannedEnd: `${iso(0)}T23:00`, revenue: 300000 }));
    await ops.startTrip(s.ctx, { id: t.id, startKm: 1000 } as never);
    await ops.addFuel(s.ctx, fuelSchema.parse({ vehicleId: v1.id, date: iso(0), liters: 60, amount: 50000, odometer: 1300 }));
    await ops.finishTrip(s.ctx, { id: t.id, endKm: 1300 } as never);
    await createFine(s.ctx, fineSchema.parse({ number: "PV-R1", vehicleId: v1.id, driverId: dr.id, date: iso(-2), offence: "Excès de vitesse", amount: 25000 }));
    await createFine(s.ctx, fineSchema.parse({ number: "PV-R2", vehicleId: v2.id, driverId: dr.id, date: iso(-1), offence: "excès de vitesse", amount: 15000 }));

    const all = (await run(s.ctx, "flotte", { du: iso(-30), au: iso(0) })).result.table;
    expect(all.rows.map((r) => r.plate)).toEqual(["CI-FLOTTE-1", "CI-FLOTTE-2"]);
    expect(all.totals).toMatchObject({ trips: 1, km: 300, revenue: 300000, fuel: 50000, fines: 40000, cost: 90000, margin: 210000 });
    expect(all.rows[0]).toMatchObject({ km: 300, cost: 75000, margin: 225000, costPerKm: 250 });
    const filtered = (await run(s.ctx, "flotte", { du: iso(-30), au: iso(0), centre: cc.id })).result.table;
    expect(filtered.rows.map((r) => r.plate)).toEqual(["CI-FLOTTE-1"]);
    expect(filtered.filters).toContainEqual(["Centre de coûts", "Flotte nord"]);

    const byVeh = (await run(s.ctx, "contraventions", { du: iso(-30), au: iso(0) })).result;
    expect(byVeh.table.rows.map((r) => [r.label, r.amount, r.share])).toEqual([["CI-FLOTTE-1", 25000, 62.5], ["CI-FLOTTE-2", 15000, 37.5]]);
    expect((await run(s.ctx, "contraventions", { du: iso(-30), au: iso(0), vue: "chauffeur" })).result.table.rows).toEqual([{ label: "Awa Traoré", count: 2, amount: 40000, share: 100 }]);
    expect((await run(s.ctx, "contraventions", { du: iso(-30), au: iso(0), vue: "infraction" })).result.table.rows[0]).toMatchObject({ count: 2, amount: 40000 }); // casse ignorée
    expect((await run(s.ctx, "contraventions", { du: iso(-30), au: iso(0), vue: "detail" })).result.table.rows).toHaveLength(2);
    expect(byVeh.summary.find((x) => x.label === "Chauffeurs récidivistes")!.value).toBe("1");

    const site = await cs.createSite(s.ctx, siteSchema.parse({ name: "Chantier Rapport" }));
    await cs.setBudget(s.ctx, budgetSchema.parse({ siteId: site.id, lines: [{ category: "MATERIALS", amount: 800000 }] }));
    const sr = (await run(s.ctx, "chantiers")).result.table;
    expect(sr.rows[0]).toMatchObject({ code: site.code, budget: 800000, actual: 0 });
    // export : un seul tableau pour l'écran, le CSV, l'Excel et le PDF
    expect((await renderExport(all, "csv")).toString("utf8")).toContain("CI-FLOTTE-1");
    expect((await renderExport(sr, "pdf")).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("accès : un rôle sans droits flotte / chantiers ne voit pas ces rapports ; isolation", async () => {
    const A = await setup(), B = await setup();
    await A.vehicle("CI-SECRET-1");
    await createFine(A.ctx, fineSchema.parse({ number: "PV-S", vehicleId: (await A.ctx.db.vehicle.findFirstOrThrow()).id, date: iso(-1), offence: "Feu rouge", amount: 20000 }));
    const accountant = await ctxFor((await addMember(A.company.id, "accountant")).user.id, A.company.id);
    for (const k of ["flotte", "contraventions", "chantiers"]) await expect(run(accountant, k)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await run(B.ctx, "contraventions", { du: iso(-30), au: iso(0) })).result.table.rows).toEqual([]);
    expect((await run(B.ctx, "flotte", { du: iso(-30), au: iso(0) })).result.table.rows).toEqual([]);
    await setCompanyModule(A.company.id, "fleet", false);
    await expect(run(await ctxFor(A.owner.id, A.company.id), "flotte")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
