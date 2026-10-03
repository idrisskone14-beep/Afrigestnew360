/**
 * Démonstration Phase 4 pour « AFRICA BUSINESS DEMO SARL » : organisation, ressources humaines, paie, projets et documents.
 * Comme pour le reste de la démo, tout passe par les SERVICES de l'application (numérotation, droits, écritures comptables,
 * événements) : les chiffres sont donc cohérents entre RH, paie, finance, comptabilité et projets. Idempotent.
 * Les rubriques de paie sont celles du modèle indicatif (taux et barèmes d'EXEMPLE, à remplacer par ceux du pays).
 */
import PDFDocument from "pdfkit";
import { savePolicy } from "@/core/approvals";
import * as docs from "@/modules/documents/service";
import * as ex from "@/modules/finance/expenses";
import * as tr from "@/modules/finance/treasury";
import * as emp from "@/modules/hr/employees";
import * as leave from "@/modules/hr/leave";
import * as people from "@/modules/hr/people";
import * as org from "@/modules/org/service";
import * as pay from "@/modules/payroll/service";
import * as pj from "@/modules/projects/service";
import { ruleSchema } from "@/modules/workflow/schemas";
import * as wf from "@/modules/workflow/service";
import { documentMetaSchema } from "@/modules/documents/schemas";
import { expenseSchema } from "@/modules/finance/schemas";
import { contractSchema, employeeSchema, evaluationSchema, leaveRequestSchema, trainingSchema } from "@/modules/hr/schemas";
import { branchSchema, costCenterSchema, departmentSchema, siteSchema } from "@/modules/org/schemas";
import { employeeItemSchema, runSchema } from "@/modules/payroll/schemas";
import { projectSchema, taskSchema, timeSchema } from "@/modules/projects/schemas";
import { loadContext } from "./seed-demo";

const DAY = 86_400_000;
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
const inDays = (n: number) => dateStr(-n);

/** Petit PDF lisible pour les documents de démonstration (vrai fichier, vérifié comme les envois des utilisateurs). */
function pdf(title: string, lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(18).text(title).moveDown();
    doc.fontSize(11);
    for (const l of lines) doc.text(l).moveDown(0.5);
    doc.moveDown().fontSize(9).fillColor("#666").text("Document de démonstration — AfriGest 360.");
    doc.end();
  });
}

const EMPLOYEES = [
  // [prénom, nom, poste, salaire, ancienneté (jours), département, utilisateur de démo]
  ["Idrissa", "Koné", "Directeur général", 1_200_000, 1800, "Direction", "owner"],
  ["Awa", "Traoré", "Comptable", 650_000, 1300, "Administration & Finance", "accountant"],
  ["Moussa", "Diallo", "Responsable commercial", 520_000, 1100, "Commercial", "requester"],
  ["Aminata", "Ouattara", "Assistante administrative", 380_000, 700, "Administration & Finance", "employee"],
  ["Séraphin", "Yao", "Responsable logistique", 540_000, 1500, "Logistique", null],
  ["Koffi", "Kouadio", "Magasinier", 250_000, 900, "Logistique", null],
  ["Drissa", "Sanogo", "Chauffeur-livreur", 230_000, 500, "Logistique", null],
  ["Mariam", "Coulibaly", "Commerciale terrain", 420_000, 90, "Commercial", null],
] as const;

export async function seedPeopleDemo(companyId: string, userId: string, users: { accountant?: string; requester?: string; employee?: string }) {
  const ctx = await loadContext(companyId, userId);
  if (!ctx.hasModule("hr") || (await ctx.db.employee.count()) > 0) return { skipped: true };
  const log = (m: string) => console.log(`  • ${m}`);
  const userOf: Record<string, string | undefined> = { owner: userId, accountant: users.accountant, requester: users.requester, employee: users.employee };

  // ── Organisation : agences, sites, départements, centres de coûts ──
  const hq = (await org.listBranches(ctx)).find((b) => b.isHeadquarters)!;
  const bouake = await org.createBranch(ctx, branchSchema.parse({ name: "Agence de Bouaké", code: "BKE", city: "Bouaké", address: "Quartier Commerce" }));
  await org.createSite(ctx, siteSchema.parse({ name: "Dépôt central d'Abidjan", type: "Dépôt", branchId: hq.id, address: "Zone industrielle de Yopougon" }));
  await org.createSite(ctx, siteSchema.parse({ name: "Showroom de Bouaké", type: "Point de vente", branchId: bouake.id }));
  const depts = new Map<string, string>();
  for (const [name, code] of [["Direction", "DIR"], ["Commercial", "COM"], ["Logistique", "LOG"], ["Administration & Finance", "ADM"]] as const) {
    depts.set(name, (await org.createDepartment(ctx, departmentSchema.parse({ name, code }))).id);
  }
  const centers = new Map<string, string>();
  for (const [code, name] of [["CC-COM", "Ventes et marketing"], ["CC-LOG", "Logistique et dépôts"], ["CC-ADM", "Frais généraux"]] as const) {
    centers.set(code, (await org.createCostCenter(ctx, costCenterSchema.parse({ code, name }))).id);
  }
  log("organisation : 2 agences, 2 sites, 4 départements, 3 centres de coûts");

  // ── Salariés et contrats ──
  const staff: { id: string; name: string; userId?: string }[] = [];
  let manager: string | undefined;
  for (const [firstName, lastName, jobTitle, baseSalary, seniority, dept, who] of EMPLOYEES) {
    const e = await emp.createEmployee(ctx, employeeSchema.parse({
      firstName, lastName, jobTitle, baseSalary, hireDate: dateStr(seniority), departmentId: depts.get(dept), branchId: dept === "Commercial" && firstName === "Mariam" ? bouake.id : hq.id,
      managerId: who === "owner" ? "" : manager ?? "", userId: who ? userOf[who] ?? "" : "", email: `${firstName}.${lastName}@africabusinessdemo.ci`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
      phone: "+225 07 00 00 00 00", payoutMethod: who === "owner" || who === "accountant" ? "BANK_TRANSFER" : "MOBILE_MONEY",
    }));
    if (who === "owner") manager = e.id;
    const cdd = firstName === "Mariam"; // recrue récente : CDD qui arrive bientôt à échéance (alerte de démonstration)
    await emp.addContract(ctx, contractSchema.parse(cdd
      ? { employeeId: e.id, type: "FIXED_TERM", startDate: dateStr(seniority), endDate: inDays(25), jobTitle, salary: baseSalary }
      : { employeeId: e.id, type: "PERMANENT", startDate: dateStr(seniority), jobTitle, salary: baseSalary }));
    staff.push({ id: e.id, name: `${firstName} ${lastName}`, userId: who ? userOf[who] : undefined });
  }
  const byName = (n: string) => staff.find((s) => s.name.startsWith(n))!;
  log(`${staff.length} salariés avec contrats (dont 1 CDD arrivant à échéance)`);

  // ── Congés (le demandeur est l'assistante, ayant un compte « Employé » ; le DG valide) ──
  const types = await ctx.db.leaveType.findMany();
  const annual = types.find((t) => t.name === "Congé annuel")!;
  const sick = types.find((t) => t.name === "Maladie")!;
  const aminata = byName("Aminata");
  const seed = async (employeeId: string, typeId: string, from: number, to: number, reason: string) => leave.requestLeave(ctx, leaveRequestSchema.parse({ employeeId, typeId, startDate: dateStr(from), endDate: dateStr(to), reason }));
  await seed(byName("Koffi").id, annual.id, 70, 63, "Congés annuels");
  await seed(byName("Awa").id, sick.id, 20, 18, "Arrêt maladie");
  await leave.requestLeave(ctx, leaveRequestSchema.parse({ employeeId: byName("Drissa").id, typeId: annual.id, startDate: inDays(8), endDate: inDays(12), reason: "Congés annuels" })); // à venir ; approuvé d'office (le DG est l'unique valideur)
  if (aminata.userId && userOf.employee) {
    const self = await loadContext(companyId, userOf.employee);
    await leave.requestLeave(self, leaveRequestSchema.parse({ employeeId: aminata.id, typeId: annual.id, startDate: inDays(14), endDate: inDays(18), reason: "Voyage en famille" }));
  }
  log("congés : 3 approuvés, 1 demande en attente de validation");

  // ── Présences, évaluation, formation ──
  for (let i = 1; i <= 5; i++) {
    const date = dateStr(i);
    const dow = new Date(date).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    await people.markAllPresent(ctx, { date });
  }
  await people.setAttendance(ctx, { employeeId: byName("Drissa").id, date: dateStr(1), status: "LATE", checkIn: "09:20" } as never);
  await people.createEvaluation(ctx, evaluationSchema.parse({ employeeId: byName("Moussa").id, period: "Année précédente", date: dateStr(120), score: 4, objectives: "Développer le portefeuille grands comptes.", comments: "Très bonne progression." }));
  await people.createTraining(ctx, trainingSchema.parse({ employeeId: byName("Awa").id, title: "Mise à jour fiscale annuelle", provider: "Cabinet FIDAF", date: dateStr(45), hours: 14, cost: 120000 }));

  // ── Paie : modèle indicatif, prime récurrente, deux campagnes (mois -2 payé, mois -1 validé) ──
  if (ctx.hasModule("payroll")) {
    await pay.installSampleItems(ctx);
    await pay.addEmployeeItem(ctx, employeeItemSchema.parse({ employeeId: byName("Moussa").id, name: "Prime sur objectifs", type: "EARNING", amount: 50000, taxable: true, startDate: dateStr(200) }));
    const bank = (await tr.listAccounts(ctx)).find((a) => a.type === "BANK");
    const period = (back: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }; };
    const older = await pay.createRun(ctx, runSchema.parse(period(2)));
    await pay.validateRun(ctx, older.run.id);
    if (bank) await pay.payRun(ctx, { id: older.run.id, accountId: bank.id, date: dateStr(40) });
    const last = await pay.createRun(ctx, runSchema.parse(period(1)));
    await pay.validateRun(ctx, last.run.id);
    log("paie : rubriques d'exemple, 1 campagne payée, 1 campagne validée");
  }

  // ── Projets, tâches, temps passé, coûts rattachés ──
  if (ctx.hasModule("projects")) {
    const customers = await ctx.db.customer.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" }, take: 3, select: { id: true, name: true } });
    const mk = (name: string, c: number, over: Record<string, unknown>) => pj.createProject(ctx, projectSchema.parse({ name, customerId: customers[c]?.id ?? "", managerId: byName("Séraphin").id, status: "ACTIVE", ...over }));
    const riviera = await mk("Livraison matériaux — Résidence Riviera", 1, { startDate: dateStr(60), endDate: inDays(30), budget: 4_500_000, billRate: 25000, costCenterId: centers.get("CC-LOG"), branchId: hq.id, description: "Fourniture et livraison échelonnée du gros œuvre." });
    const mairie = await mk("Équipement du marché couvert", 0, { startDate: dateStr(30), endDate: inDays(60), budget: 2_800_000, billRate: 20000, costCenterId: centers.get("CC-COM") });
    await mk("Refonte de l'entrepôt de Bouaké", 2, { status: "PLANNED", startDate: inDays(20), endDate: inDays(120), budget: 1_500_000, costCenterId: centers.get("CC-LOG"), branchId: bouake.id });
    await mk("Audit des stocks 2025", 0, { status: "DONE", startDate: dateStr(150), endDate: dateStr(100), budget: 600_000 });

    const t = async (projectId: string, title: string, over: Record<string, unknown> = {}) => pj.createTask(ctx, taskSchema.parse({ projectId, title, ...over }));
    const t1 = await t(riviera.id, "Commande des fers à béton", { status: "DONE", priority: "HIGH", assigneeId: byName("Séraphin").id, startDate: dateStr(55), dueDate: dateStr(45), estimateHours: 12 });
    const t2 = await t(riviera.id, "Livraison tranche 1", { status: "DONE", assigneeId: byName("Drissa").id, startDate: dateStr(40), dueDate: dateStr(30), estimateHours: 24, dependsOnId: t1.id });
    await t(riviera.id, "Livraison tranche 2", { status: "IN_PROGRESS", priority: "HIGH", assigneeId: byName("Drissa").id, startDate: dateStr(10), dueDate: inDays(5), estimateHours: 24, dependsOnId: t2.id });
    await t(riviera.id, "Réception et contrôle qualité", { status: "TODO", assigneeId: byName("Séraphin").id, startDate: inDays(5), dueDate: inDays(20), estimateHours: 16 });
    await t(riviera.id, "Facturation finale", { status: "TODO", priority: "LOW", dueDate: dateStr(2), estimateHours: 4 }); // en retard : visible au tableau de bord
    await t(mairie.id, "Relevé des besoins sur site", { status: "REVIEW", assigneeId: byName("Moussa").id, startDate: dateStr(28), dueDate: dateStr(14), estimateHours: 20 });
    await t(mairie.id, "Devis détaillé et négociation", { status: "IN_PROGRESS", assigneeId: byName("Moussa").id, startDate: dateStr(14), dueDate: inDays(10), estimateHours: 30 });

    const workDay = (n: number) => { let d = n; while ([0, 6].includes(new Date(dateStr(d)).getUTCDay())) d++; return dateStr(d); };
    const rows: [string, string, number, number, boolean][] = [
      [riviera.id, "Séraphin", 50, 6, true], [riviera.id, "Séraphin", 49, 5, true], [riviera.id, "Drissa", 36, 8, true], [riviera.id, "Drissa", 35, 8, true], [riviera.id, "Drissa", 9, 8, true],
      [riviera.id, "Séraphin", 8, 4, false], [mairie.id, "Moussa", 25, 7, true], [mairie.id, "Moussa", 24, 6, true], [mairie.id, "Moussa", 12, 5, true],
    ];
    for (const [projectId, who, ago, hours, billable] of rows) {
      await pj.logTime(ctx, timeSchema.parse({ projectId, employeeId: byName(who).id, date: workDay(ago), hours, billable, description: "Travail sur le projet" }));
    }
    // Un coût rattaché : dépense payée imputée au projet et à son centre de coûts
    const bank = (await tr.listAccounts(ctx)).find((a) => a.type === "BANK");
    const fuel = (await tr.listCategories(ctx, { kind: "EXPENSE" })).find((c) => c.name === "Transport et carburant");
    if (bank && fuel) {
      const e = await ex.createExpense(ctx, expenseSchema.parse({ date: dateStr(20), categoryId: fuel.id, description: "Carburant — livraisons Résidence Riviera", amount: 85000, method: "BANK_TRANSFER", projectId: riviera.id, costCenterId: centers.get("CC-LOG"), branchId: hq.id }));
      await ex.submitExpense(ctx, e.id);
      await ex.payExpense(ctx, { id: e.id, accountId: bank.id, date: dateStr(19), method: "BANK_TRANSFER", reference: "Carburant" } as never);
    }
    log("projets : 4 projets, 7 tâches, temps passé et dépense imputée");

    // ── Documents : dossiers, versions, liens, document restreint ──
    if (ctx.hasModule("documents")) {
      const folders = new Map<string, string>();
      for (const name of ["Contrats clients", "Ressources humaines", "Projets", "Comptabilité"]) folders.set(name, (await docs.createFolder(ctx, { name })).id);
      const add = async (name: string, folder: string, lines: string[], over: Record<string, unknown>, link?: { entityType: "customer" | "employee" | "project"; entityId: string }) => {
        const data = await pdf(name, lines);
        return docs.createDocument(ctx, documentMetaSchema.parse({ name, folderId: folders.get(folder), ...over }), { name: `${name}.pdf`, size: data.length }, data, link);
      };
      const cadre = await add("Contrat cadre de fourniture — BTP Ivoire", "Contrats clients", ["Contrat cadre de fourniture de matériaux de construction.", "Durée : 12 mois renouvelables.", "Conditions de paiement : 30 jours fin de mois."], { tags: "contrat, btp" }, customers[1] ? { entityType: "customer", entityId: customers[1].id } : undefined);
      const v2 = await pdf("Contrat cadre de fourniture — BTP Ivoire (avenant)", ["Version 2 : avenant tarifaire du second semestre.", "Remise de volume portée à 4 % au-delà de 5 millions de FCFA."]);
      await docs.addVersion(ctx, cadre.id, { name: "avenant.pdf", size: v2.length }, v2, "Avenant tarifaire");
      await add("Cahier des charges — Résidence Riviera", "Projets", ["Périmètre, jalons et conditions de livraison du projet.", "Livraisons en deux tranches, contrôle qualité à réception."], { tags: "projet, cahier des charges" }, { entityType: "project", entityId: riviera.id });
      await add("Contrat de travail — Mariam Coulibaly", "Ressources humaines", ["Contrat à durée déterminée.", "Fonction : commerciale terrain."], { visibility: "RESTRICTED", tags: "rh, contrat" }, { entityType: "employee", entityId: byName("Mariam").id });
      await add("Règlement intérieur", "Ressources humaines", ["Horaires, congés, discipline et sécurité.", "Remis à chaque salarié à l'embauche."], { tags: "rh, règlement" });
      await add("Procédure de clôture mensuelle", "Comptabilité", ["Rapprochements bancaires, validation des écritures, clôture des périodes.", "Responsable : service comptable."], { tags: "comptabilité, procédure" });
      log("documents : 4 dossiers, 5 documents (1 avec 2 versions, 1 restreint, liens vers client, projet, salarié)");
    }
  }
  return { skipped: false };
}

/**
 * Phase 5 — circuits de validation de démonstration : dépenses importantes validées par le Directeur financier puis la Direction générale,
 * règlements fournisseurs et remises au-delà d'un seuil soumis à validation. Idempotent.
 */
export async function seedWorkflowDemo(companyId: string, userId: string) {
  const ctx = await loadContext(companyId, userId);
  if ((await ctx.db.approvalRule.count()) > 0) return { skipped: true };
  const role = async (key: string) => (await ctx.db.role.findFirstOrThrow({ where: { templateKey: key }, select: { id: true } })).id;
  if (ctx.hasModule("finance")) {
    await wf.createRule(ctx, ruleSchema.parse({
      resourceType: "expense", name: "Dépenses importantes (≥ 500 000)", minAmount: 500_000, priority: 100,
      steps: [{ label: "Directeur financier", roleId: await role("cfo") }, { label: "Direction générale", roleId: await role("ceo") }],
    }));
  }
  if (ctx.hasModule("purchases")) {
    await savePolicy(ctx, { type: "supplier_payment", isEnabled: true, threshold: 2_000_000 });
    await wf.createRule(ctx, ruleSchema.parse({
      resourceType: "purchase_order", name: "Grosses commandes (≥ 3 000 000)", minAmount: 3_000_000,
      steps: [{ label: "Directeur financier", roleId: await role("cfo") }, { label: "Direction générale", roleId: await role("ceo") }],
    }));
  }
  if (ctx.hasModule("sales")) await savePolicy(ctx, { type: "discount", isEnabled: true, threshold: 100_000 });
  console.log("  • validations : 2 chaînes (dépenses, commandes), seuils pour règlements fournisseurs et remises");
  return { skipped: false };
}
