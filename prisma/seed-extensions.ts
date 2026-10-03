/**
 * Démonstration Phase 6 pour « AFRICA BUSINESS DEMO SARL » : Transport & Flotte (livraisons de matériaux) et Gestion de chantiers.
 * Tout passe par les SERVICES (contrôles de dates, kilométrage, conformité, stock, projets) ; seules les DATES des missions passées
 * sont ramenées dans le passé par une écriture directe, car le service horodate le départ et l'arrivée à l'instant présent.
 * Idempotent : ne fait rien si la flotte ou les chantiers existent déjà.
 */
import * as docs from "@/modules/documents/service";
import * as cs from "@/modules/construction/service";
import * as costs from "@/modules/fleet/costs";
import * as fines from "@/modules/fleet/fines";
import * as ops from "@/modules/fleet/operations";
import * as fl from "@/modules/fleet/service";
import * as pj from "@/modules/projects/service";
import { budgetSchema, equipmentSchema, materialSchema, memberSchema, planSchema, reportSchema, siteSchema, subcontractSchema } from "@/modules/construction/schemas";
import { documentMetaSchema } from "@/modules/documents/schemas";
import { assignmentSchema, complianceSchema, driverSchema, fineSchema, fuelSchema, maintenanceSchema, tripSchema, vehicleSchema } from "@/modules/fleet/schemas";
import { taskSchema, timeSchema } from "@/modules/projects/schemas";
import { loadContext } from "./seed-demo";

const DAY = 86_400_000;
/** PNG valide de 1 × 1 pixel : sert de « photo » de démonstration (type vérifié sur les octets comme tout envoi). */
const buildPng = () => Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
const inDays = (n: number) => dateStr(-n);

export async function seedFleetDemo(companyId: string, userId: string) {
  const ctx = await loadContext(companyId, userId);
  if (!ctx.hasModule("fleet") || (await ctx.db.vehicle.count()) > 0) return { skipped: true };
  const log = (m: string) => console.log(`  • ${m}`);
  const hq = await ctx.db.branch.findFirst({ where: { isHeadquarters: true }, select: { id: true } });
  const logistics = await ctx.db.costCenter.findFirst({ where: { code: "CC-LOG" }, select: { id: true } });
  const customers = await ctx.db.customer.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" }, take: 4, select: { id: true } });
  const drissa = await ctx.db.employee.findFirst({ where: { firstName: "Drissa" }, select: { id: true } });

  // ── Véhicules ──
  const mk = (plate: string, over: Record<string, unknown>) => fl.createVehicle(ctx, vehicleSchema.parse({ plate, branchId: hq?.id ?? "", costCenterId: logistics?.id ?? "", fuelType: "DIESEL", ...over }));
  const t1 = await mk("CI-4521-AB-01", { name: "Camion benne n°1", type: "TRUCK", brand: "Renault", model: "Kerax 370", year: 2019, odometer: 184200, acquisitionCost: 28_000_000, acquisitionDate: "2019-06-12" });
  const t2 = await mk("CI-1187-BC-01", { name: "Camion plateau n°2", type: "TRUCK", brand: "Mercedes", model: "Actros 1832", year: 2021, odometer: 96400, acquisitionCost: 41_000_000, acquisitionDate: "2021-03-02" });
  const van = await mk("CI-7734-CD-01", { name: "Fourgon de livraison", type: "VAN", brand: "Toyota", model: "Hiace", year: 2022, odometer: 58100, acquisitionCost: 17_500_000 });
  const pick = await mk("CI-2290-EF-01", { name: "Pick-up commercial", type: "CAR", brand: "Toyota", model: "Hilux", year: 2023, odometer: 31200, fuelType: "DIESEL", acquisitionCost: 24_000_000 });
  const lift = await mk("ENG-0003", { name: "Chariot élévateur", type: "MACHINE", brand: "Manitou", model: "MT 1840", year: 2020, odometer: 4200, acquisitionCost: 19_000_000 });
  await mk("CI-0912-GH-01", { name: "Ancien camion (vendu)", type: "TRUCK", brand: "Renault", model: "Midlum", year: 2012, odometer: 412000 }).then((v) => fl.updateVehicle(ctx, { ...vehicleSchema.parse({ plate: v.plate, type: "TRUCK", odometer: 412000 }), id: v.id, status: "SOLD" } as never));
  void lift;

  // ── Chauffeurs et affectations ──
  const d1 = await fl.createDriver(ctx, driverSchema.parse({ fullName: "Drissa Sanogo", employeeId: drissa?.id ?? "", phone: "+225 07 12 34 56 78", licenseNumber: "CI-PC-554120", licenseCategory: "C", licenseExpiry: inDays(380) }));
  const d2 = await fl.createDriver(ctx, driverSchema.parse({ fullName: "Yao Brou", phone: "+225 05 44 21 90 12", licenseNumber: "CI-PC-338811", licenseCategory: "C", licenseExpiry: inDays(20) })); // permis bientôt expiré : alerte
  const d3 = await fl.createDriver(ctx, driverSchema.parse({ fullName: "Ibrahim Coulibaly", phone: "+225 01 88 77 66 55", licenseNumber: "CI-PC-771903", licenseCategory: "B", licenseExpiry: inDays(700) }));
  for (const [v, dr, ago] of [[t1, d1, 90], [t2, d2, 90], [van, d3, 60], [pick, d3, 20]] as const) await fl.assignDriver(ctx, assignmentSchema.parse({ vehicleId: v.id, driverId: dr.id, startDate: dateStr(ago) }));
  await fl.assignDriver(ctx, assignmentSchema.parse({ vehicleId: van.id, driverId: d1.id, startDate: dateStr(10) })); // changement d'affectation : clôt la précédente

  // ── Assurances et visites techniques ──
  const cp = (vehicleId: string, kind: string, expiresAt: string, over: Record<string, unknown> = {}) => fl.addCompliance(ctx, complianceSchema.parse({ vehicleId, kind, expiresAt, ...over }));
  for (const v of [t1, t2, van, pick]) {
    await cp(v.id, "INSURANCE", v.id === t1.id ? inDays(12) : inDays(210), { provider: "NSIA Assurances", reference: `POL-${v.plate.slice(3, 7)}`, startDate: dateStr(150), cost: 420000 });
    await cp(v.id, "TECHNICAL_INSPECTION", v.id === pick.id ? dateStr(6) : inDays(120), { provider: "Centre technique Abidjan Nord", startDate: dateStr(240), cost: 35000 });
    await cp(v.id, "REGISTRATION", inDays(900), { reference: `CG-${v.plate}` });
  }

  // ── Carburant : pleins complets réguliers (relevés croissants, avant les missions récentes) ──
  const fuel = async (veh: typeof t1, dr: typeof d1, ago: number, liters: number, odometer: number, station: string) =>
    ops.addFuel(ctx, fuelSchema.parse({ vehicleId: veh.id, driverId: dr.id, date: dateStr(ago), liters, unitPrice: 615, odometer, fullTank: true, station }));
  for (const [ago, km] of [[58, 0], [44, 330], [30, 665], [16, 990]] as const) await fuel(t1, d1, ago, ago === 58 ? 100 : 118, 184200 + km, ago % 2 ? "TotalEnergies Cocody" : "Shell Yopougon");
  for (const [ago, km] of [[52, 0], [36, 310], [20, 640]] as const) await fuel(t2, d2, ago, ago === 52 ? 95 : 112, 96400 + km, "Shell Yopougon");
  for (const [ago, km] of [[40, 0], [18, 480]] as const) await fuel(van, d1, ago, ago === 40 ? 30 : 40, 58100 + km, "TotalEnergies Marcory");
  const lastFuel = await ctx.db.fuelLog.findFirst({ orderBy: { date: "desc" } });
  if (lastFuel && ctx.hasModule("finance")) await costs.createExpenseFromCost(ctx, "fuel", lastFuel.id);

  // ── Missions : 8 terminées, 1 en cours, 2 planifiées (dates passées ramenées par écriture directe) ──
  const history: [typeof t1, typeof d1, number, string, string, number, number][] = [
    [t1, d1, 55, "Abidjan", "Bouaké", 360, 420000], [t2, d2, 50, "Abidjan", "Yamoussoukro", 240, 310000], [t1, d1, 44, "Abidjan", "San-Pédro", 350, 450000], [t2, d2, 38, "Abidjan", "Bouaké", 360, 400000],
    [t1, d1, 30, "Abidjan", "Daloa", 390, 380000], [t2, d2, 22, "Abidjan", "Korhogo", 640, 690000], [t1, d1, 14, "Abidjan", "Yamoussoukro", 240, 300000], [t2, d2, 6, "Abidjan", "Bouaké", 360, 410000],
  ];
  let n = 0;
  for (const [veh, dr, ago, from, to, kmDone, revenue] of history) {
    const cust = customers[n++ % Math.max(customers.length, 1)];
    const start = new Date(Date.now() - ago * DAY); start.setUTCHours(6, 0, 0, 0);
    const trip = await ops.createTrip(ctx, tripSchema.parse({ vehicleId: veh.id, driverId: dr.id, origin: from, destination: to, cargo: "Matériaux de construction", customerId: cust?.id ?? "", plannedStart: new Date().toISOString().slice(0, 16), plannedEnd: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 16), revenue }));
    const cur = (await fl.getVehicle(ctx, veh.id)).odometer;
    await ops.startTrip(ctx, { id: trip.id, startKm: cur } as never);
    await ops.finishTrip(ctx, { id: trip.id, endKm: cur + kmDone } as never);
    // le service horodate à l'instant présent : on recale la mission dans le passé
    await ctx.db.trip.update({ where: { id: trip.id }, data: { plannedStart: start, plannedEnd: new Date(start.getTime() + 10 * 3_600_000), startedAt: start, endedAt: new Date(start.getTime() + 10 * 3_600_000) } });
  }
  const running = await ops.createTrip(ctx, tripSchema.parse({ vehicleId: van.id, driverId: d1.id, origin: "Abidjan", destination: "Grand-Bassam", cargo: "Quincaillerie", customerId: customers[0]?.id ?? "", plannedStart: new Date().toISOString().slice(0, 16), plannedEnd: new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 16), revenue: 85000 }));
  await ops.startTrip(ctx, { id: running.id } as never);
  for (const [veh, dr, off] of [[t1, d1, 2], [t2, d2, 3]] as const) {
    await ops.createTrip(ctx, tripSchema.parse({ vehicleId: veh.id, driverId: dr.id, origin: "Abidjan", destination: "Bouaké", cargo: "Fer à béton", customerId: customers[1]?.id ?? "", plannedStart: `${inDays(off)}T06:00`, plannedEnd: `${inDays(off)}T18:00`, revenue: 420000 }));
  }
  log("flotte : 5 véhicules en service (+1 vendu), 3 chauffeurs, affectations, 8 missions terminées, 1 en cours, 2 planifiées");

  // ── Entretiens ──
  await ops.addMaintenance(ctx, maintenanceSchema.parse({ vehicleId: t1.id, type: "PREVENTIVE", date: dateStr(75), odometer: 182000, description: "Vidange et filtres", cost: 145000, nextDueKm: 192000, nextDueDate: inDays(100) }));
  await ops.addMaintenance(ctx, maintenanceSchema.parse({ vehicleId: t2.id, type: "TIRES", date: dateStr(40), description: "Remplacement de 4 pneus arrière", cost: 380000 }));
  await ops.addMaintenance(ctx, maintenanceSchema.parse({ vehicleId: van.id, type: "REPAIR", date: dateStr(18), description: "Remplacement plaquettes de frein", cost: 62000, nextDueDate: inDays(5) }));
  await ops.addMaintenance(ctx, maintenanceSchema.parse({ vehicleId: t2.id, type: "PREVENTIVE", status: "PLANNED", date: inDays(9), description: "Révision des 100 000 km" }));

  // ── Contraventions ──
  const pv = (number: string, vehicleId: string, ago: number, offence: string, amount: number, over: Record<string, unknown> = {}) => fines.createFine(ctx, fineSchema.parse({ number, vehicleId, date: dateStr(ago), offence, amount, place: "Autoroute du Nord, Abidjan", dueDate: dateStr(ago - 30), ...over }));
  await pv("PV-2026-004412", t1.id, 70, "Excès de vitesse (+20 km/h)", 25000, { driverId: d1.id, time: "09:42" });
  const f2 = await pv("PV-2026-005871", t1.id, 41, "Excès de vitesse (+10 km/h)", 15000, { driverId: d1.id, time: "14:05" });
  await fines.setFineStatus(ctx, { id: f2.id, status: "PAID", paidAt: dateStr(20) } as never);
  await pv("PV-2026-006230", t2.id, 33, "Surcharge du véhicule", 60000, { driverId: d2.id });
  const f4 = await pv("PV-2026-007015", t2.id, 19, "Stationnement gênant", 10000, { driverId: d2.id });
  await fines.setFineStatus(ctx, { id: f4.id, status: "CONTESTED", reason: "Véhicule en livraison, arrêt de moins de 5 minutes" } as never);
  await pv("PV-2026-007991", van.id, 9, "Feu rouge non respecté", 35000, { dueDate: inDays(4) }); // chauffeur déduit de l'affectation
  await pv("PV-2026-008404", t1.id, 3, "Excès de vitesse (+20 km/h)", 25000, { driverId: d1.id, dueDate: inDays(27) }); // récidive de d1
  log("flotte : carburant, entretiens, assurances et visites (avec échéances proches), 6 contraventions (dont récidive)");
  return { skipped: false, vehicles: { t1, t2, van } };
}

export async function seedConstructionDemo(companyId: string, userId: string) {
  const ctx = await loadContext(companyId, userId);
  if (!ctx.hasModule("construction") || !ctx.hasModule("projects") || (await ctx.db.constructionSite.count()) > 0) return { skipped: true };
  const log = (m: string) => console.log(`  • ${m}`);
  const customers = await ctx.db.customer.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  const customer = customers.find((c) => c.name.startsWith("Groupe Diabaté")) ?? customers[0];
  const emps = await ctx.db.employee.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, firstName: true } });
  const emp = (first: string) => emps.find((e) => e.firstName === first)?.id ?? emps[0]!.id;

  const site = await cs.createSite(ctx, siteSchema.parse({ name: "Résidence Les Flamboyants — Cocody", customerId: customer?.id ?? "", managerId: emp("Séraphin"), address: "Rue des Jardins, Cocody Riviera", city: "Abidjan", startDate: dateStr(45), endDate: inDays(120), description: "Construction de 12 logements R+2 : gros œuvre, second œuvre et finitions." }));
  await cs.updateSite(ctx, { ...siteSchema.parse({ name: site.name, customerId: customer?.id ?? "", managerId: emp("Séraphin"), address: site.address ?? "", city: "Abidjan", startDate: dateStr(45), endDate: inDays(120), description: site.description ?? "" }), id: site.id, status: "ACTIVE" } as never);
  await cs.setBudget(ctx, budgetSchema.parse({ siteId: site.id, lines: [{ category: "MATERIALS", amount: 18_000_000 }, { category: "LABOUR", amount: 6_500_000 }, { category: "EQUIPMENT", amount: 4_200_000 }, { category: "SUBCONTRACT", amount: 7_000_000 }, { category: "OTHER", amount: 1_500_000 }] }));

  // Équipe (les heures se saisissent sur le projet associé)
  for (const [first, role] of [["Séraphin", "Conducteur de travaux"], ["Koffi", "Magasinier de chantier"], ["Drissa", "Chauffeur-livreur"]] as const) await cs.addMember(ctx, memberSchema.parse({ siteId: site.id, employeeId: emp(first), role, startDate: dateStr(40) }));
  const task = await pj.createTask(ctx, taskSchema.parse({ projectId: site.projectId, title: "Fondations et dallage", status: "DONE", startDate: dateStr(44), dueDate: dateStr(20), estimateHours: 400 }));
  await pj.createTask(ctx, taskSchema.parse({ projectId: site.projectId, title: "Élévation R+1", status: "IN_PROGRESS", startDate: dateStr(19), dueDate: inDays(25), estimateHours: 500, dependsOnId: task.id }));
  await pj.createTask(ctx, taskSchema.parse({ projectId: site.projectId, title: "Élévation R+2 et toiture", status: "TODO", startDate: inDays(26), dueDate: inDays(70), estimateHours: 600 }));
  for (const [first, ago, hours] of [["Séraphin", 12, 8], ["Séraphin", 11, 8], ["Séraphin", 10, 8], ["Koffi", 12, 8], ["Koffi", 11, 8], ["Drissa", 9, 6]] as const) {
    let day = ago; while ([0, 6].includes(new Date(dateStr(day)).getUTCDay())) day++;
    await pj.logTime(ctx, timeSchema.parse({ projectId: site.projectId, employeeId: emp(first), date: dateStr(day), hours, billable: false, description: "Chantier Les Flamboyants" })).catch(() => undefined);
  }

  // Engins : un engin de la flotte et une location
  const machine = ctx.hasModule("fleet") ? await ctx.db.vehicle.findFirst({ where: { plate: "ENG-0003" }, select: { id: true } }) : null;
  if (machine) await cs.addEquipment(ctx, equipmentSchema.parse({ siteId: site.id, vehicleId: machine.id, name: "Chariot élévateur Manitou", dailyRate: 45000, startDate: dateStr(30) }));
  await cs.addEquipment(ctx, equipmentSchema.parse({ siteId: site.id, name: "Bétonnière 500 L (location)", dailyRate: 18000, startDate: dateStr(25) }));

  // Matériaux : prévus puis sortis du stock (vrais mouvements)
  if (ctx.hasModule("inventory")) {
    const wh = (await ctx.db.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } })) ?? (await ctx.db.warehouse.findFirstOrThrow({ select: { id: true } }));
    for (const [name, planned, issued] of [["Ciment CPJ 42,5 — sac 50 kg", 600, 150], ["Fer à béton Ø10 — barre 12 m", 300, 70], ["Brique creuse 15 cm", 8000, 1800]] as const) {
      const p = await ctx.db.product.findFirst({ where: { name, deletedAt: null }, select: { id: true } });
      if (!p) continue;
      await cs.setMaterialPlan(ctx, planSchema.parse({ siteId: site.id, productId: p.id, plannedQty: planned }));
      await cs.moveMaterial(ctx, materialSchema.parse({ siteId: site.id, productId: p.id, warehouseId: wh.id, type: "ISSUE", quantity: issued, date: dateStr(15), note: "Livraison chantier" })).catch((e) => console.warn("  ! matériaux :", e instanceof Error ? e.message : e));
    }
  }

  // Sous-traitant : un fournisseur existant
  const supplier = ctx.hasModule("purchases") ? await ctx.db.supplier.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } }) : null;
  if (supplier) await cs.addSubcontract(ctx, subcontractSchema.parse({ siteId: site.id, supplierId: supplier.id, scope: "Plomberie et électricité du bâtiment", contractAmount: 7_000_000, startDate: dateStr(10), endDate: inDays(90) }));

  // Rapports terrain (avancement 28 % à ce jour) + une photo liée au dernier rapport
  const reports = [[14, "Fondations coulées, début du dallage.", 8, "Soleil", 14, ""], [10, "Dallage terminé, ferraillage des poteaux.", 12, "Nuageux", 18, ""], [7, "Coulage des poteaux du rez-de-chaussée.", 14, "Soleil", 22, "Panne de la bétonnière pendant 2 h."], [3, "Élévation des murs du R+1 (côté nord).", 14, "Pluie légère", 26, "Arrêt de 3 h pour cause de pluie."], [1, "Élévation des murs du R+1 (côté sud).", 15, "Soleil", 28, ""]] as const;
  let last = "";
  for (const [ago, summary, workforce, weather, progress, incidents] of reports) last = (await cs.saveReport(ctx, reportSchema.parse({ siteId: site.id, date: dateStr(ago), summary, workforce, weather, progress, incidents }))).id;
  if (ctx.hasModule("documents")) {
    const photo = buildPng();
    await docs.createDocument(ctx, documentMetaSchema.parse({ name: "Photo — élévation R+1 côté sud", tags: "chantier, photo" }), { name: "elevation-r1.png", size: photo.length }, photo, { entityType: "site_report", entityId: last });
  }

  await cs.createSite(ctx, siteSchema.parse({ name: "Entrepôt de Bouaké — extension", customerId: "", address: "Zone industrielle", city: "Bouaké", startDate: inDays(30), endDate: inDays(150), description: "Extension de 600 m² : charpente métallique et dallage." }));
  log("chantiers : 2 chantiers (1 en cours à 28 %), budget, équipe, engins, matériaux sortis du stock, sous-traitant, 5 rapports terrain");
  return { skipped: false };
}
