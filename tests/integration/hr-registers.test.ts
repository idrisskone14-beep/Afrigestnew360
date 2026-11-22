import { describe, expect, it } from "vitest";
import { decideApproval, listApprovals } from "@/core/approvals";
import { platformDb } from "@/core/db/client";
import { ensureCompanyDefaults } from "@/core/tenant/defaults";
import * as ab from "@/modules/hr/absences";
import * as ac from "@/modules/hr/accidents";
import * as emp from "@/modules/hr/employees";
import { HR_EXPORTERS } from "@/modules/hr/exports";
import * as la from "@/modules/hr/lateness";
import * as lv from "@/modules/hr/leave";
import { hrPolicySchema, savePolicy } from "@/modules/hr/policy";
import { absenceSchema, accidentSchema, latenessSchema, timeOffSchema } from "@/modules/hr/registers-schemas";
import { employeeSchema, leaveTypeSchema } from "@/modules/hr/schemas";
import * as to from "@/modules/hr/timeoff";
import { addMember, ctxFor, makeCompany } from "../helpers";

async function setup() {
  const co = await makeCompany("REGISTRES RH", "enterprise");
  await platformDb.$transaction(async (tx) => ensureCompanyDefaults(tx as never, co.company.id, "CI"));
  const ctx = await ctxFor(co.owner.id, co.company.id);
  return { ...co, ctx };
}
type S = Awaited<ReturnType<typeof setup>>;

const newEmp = (s: S, over: Record<string, unknown> = {}) => emp.createEmployee(s.ctx, employeeSchema.parse({ firstName: "Awa", lastName: "Koné", hireDate: "2020-01-06", baseSalary: 300000, jobTitle: "Comptable", ...over }));
/** Salarié lié à un compte « Employé » ; renvoie aussi son contexte. */
async function selfService(s: S, over: Record<string, unknown> = {}) {
  const m = await addMember(s.company.id, "employee");
  const e = await newEmp(s, { userId: m.user.id, ...over });
  return { m, e, ctx: await ctxFor(m.user.id, s.company.id) };
}
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const hrPolicyInput = (over: Record<string, unknown> = {}) => hrPolicySchema.parse({ workStartTime: "08:00", workEndTime: "17:00", lateGraceMinutes: 0, lateRecurrenceCount: 3, lateRecurrenceDays: 30, absenceRepeatCount: 3, absenceRepeatDays: 90, ...over });

describe("accidents de travail", () => {
  it("création : numéro automatique, instantané du salarié, journal d'audit ; dates incohérentes refusées", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const a = await ac.createAccident(s.ctx, accidentSchema.parse({ employeeId: e.id, kind: "WORKPLACE", occurredOn: "2026-01-12", occurredTime: "09:40", place: "Atelier", circumstances: "Chute depuis un escabeau lors du rangement.", injuries: "Entorse cheville", workStop: true, stopStart: "2026-01-12", stopEnd: "2026-01-26" }));
    expect(a.number).toMatch(/^AT-2026-\d{4}$/);
    expect(a).toMatchObject({ employeeNumber: e.number, employeeName: "Koné Awa", status: "OPEN", cnpsStatus: "TO_DECLARE" });
    const b = await ac.createAccident(s.ctx, accidentSchema.parse({ employeeId: e.id, kind: "COMMUTE", occurredOn: "2026-02-01", place: "Boulevard", circumstances: "Collision en rejoignant le bureau." }));
    expect(b.number).not.toBe(a.number);
    expect(await platformDb.auditLog.count({ where: { companyId: s.company.id, action: "hr.accident.create" } })).toBe(2);

    const bad = (over: Record<string, unknown>) => ac.createAccident(s.ctx, accidentSchema.parse({ employeeId: e.id, kind: "WORKPLACE", occurredOn: "2026-01-12", place: "Atelier", circumstances: "Circonstances détaillées.", ...over }));
    await expect(bad({ occurredOn: "2999-01-01" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("futur") });
    await expect(bad({ occurredOn: "2019-01-01" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("embauche") });
    await expect(bad({ workStop: true, stopStart: "2026-01-20", stopEnd: "2026-01-10" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("fin de l'arrêt") });
    await expect(bad({ workStop: true, stopStart: "2026-01-05", stopEnd: "2026-01-10" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("avant l'accident") });
    await expect(bad({ cnpsStatus: "DECLARED" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("date de déclaration") });
    expect(() => accidentSchema.parse({ employeeId: e.id, kind: "WORKPLACE", occurredOn: "2026-01-12", place: "x", circumstances: "ok ok ok" })).toThrow();
  });

  it("dossier incomplet : alertes, clôture refusée tant que les éléments bloquants manquent ; modification, réouverture, archivage contrôlé", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const a = await ac.createAccident(s.ctx, accidentSchema.parse({ employeeId: e.id, kind: "COMMUTE", occurredOn: "2026-01-12", place: "Route", circumstances: "Accident de la circulation." }));
    const list = await ac.listAccidents(s.ctx, { skip: 0, take: 20 });
    const codes = list.rows[0]!.gaps.map((g) => g.code);
    expect(codes).toEqual(expect.arrayContaining(["injuries", "cnps", "commute", "qualification"]));
    await expect(ac.closeAccident(s.ctx, a.id)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("incomplet") });
    await expect(ac.archiveAccident(s.ctx, a.id, true)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Clôturez") });

    const full = { id: a.id, kind: "COMMUTE", occurredOn: "2026-01-12", place: "Route", circumstances: "Accident de la circulation.", injuries: "Contusions", firstAid: "Pansement", commuteDetails: "Trajet habituel domicile-bureau", workStop: false, cnpsStatus: "DECLARED", cnpsDeclaredOn: "2026-01-14", cnpsReference: "REF-TEST-1", qualification: "RECOGNIZED", correctiveActions: "Rappel des consignes" };
    const { updateAccidentSchema } = await import("@/modules/hr/registers-schemas");
    await ac.updateAccident(s.ctx, updateAccidentSchema.parse(full));
    await ac.closeAccident(s.ctx, a.id);
    expect((await ac.getAccident(s.ctx, a.id)).status).toBe("CLOSED");
    await expect(ac.updateAccident(s.ctx, updateAccidentSchema.parse({ ...full, place: "Autre" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("clos") });
    await ac.archiveAccident(s.ctx, a.id, true);
    expect((await ac.listAccidents(s.ctx, { skip: 0, take: 20 })).total).toBe(0); // masqué par défaut
    expect((await ac.listAccidents(s.ctx, { status: "ARCHIVED", skip: 0, take: 20 })).total).toBe(1);
    await expect(ac.reopenAccident(s.ctx, a.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await ac.archiveAccident(s.ctx, a.id, false);
    await ac.reopenAccident(s.ctx, a.id);
    const fiche = await ac.getAccident(s.ctx, a.id);
    expect(fiche.status).toBe("OPEN");
    // historique des actions : création, modification, clôture, archivage, désarchivage, réouverture
    expect(fiche.history.map((h) => h.action)).toEqual(expect.arrayContaining(["hr.accident.create", "hr.accident.update", "hr.accident.close", "hr.accident.archive", "hr.accident.unarchive", "hr.accident.reopen"]));
  });

  it("délai de déclaration paramétrable : aucune alerte de délai sans paramètre, alerte une fois fixé", async () => {
    const s = await setup();
    const e = await newEmp(s);
    await ac.createAccident(s.ctx, accidentSchema.parse({ employeeId: e.id, kind: "WORKPLACE", occurredOn: "2026-01-12", place: "Atelier", circumstances: "Coupure à la main." }));
    expect((await ac.listAccidents(s.ctx, { skip: 0, take: 20 })).rows[0]!.gaps.some((g) => g.code === "cnps_late")).toBe(false);
    await savePolicy(s.ctx, hrPolicyInput({ accidentDeclarationDays: 2 }));
    expect((await ac.listAccidents(s.ctx, { skip: 0, take: 20 })).rows[0]!.gaps.some((g) => g.code === "cnps_late")).toBe(true);
  });

  it("tableau de bord, filtres et recherche", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const f = await newEmp(s, { firstName: "Moussa", lastName: "Traoré" });
    const mk = (employeeId: string, over: Record<string, unknown>) => ac.createAccident(s.ctx, accidentSchema.parse({ employeeId, kind: "WORKPLACE", occurredOn: "2026-03-02", place: "Entrepôt", circumstances: "Circonstances détaillées.", ...over }));
    await mk(e.id, { workStop: true, stopStart: "2026-03-02", stopEnd: "2026-03-06" });
    await mk(f.id, { kind: "COMMUTE", occurredOn: "2026-04-10", cnpsStatus: "DECLARED", cnpsDeclaredOn: "2026-04-11" });
    const dash = await ac.accidentDashboard(s.ctx, 2026);
    expect(dash).toMatchObject({ total: 2, open: 2, withStop: 1, stopDays: 5, toDeclare: 1 });
    expect(dash.byMonth[2]!.count).toBe(1);
    expect(dash.byKind).toMatchObject({ WORKPLACE: 1, COMMUTE: 1 });
    expect((await ac.listAccidents(s.ctx, { kind: "COMMUTE", skip: 0, take: 20 })).total).toBe(1);
    expect((await ac.listAccidents(s.ctx, { q: "traoré", skip: 0, take: 20 })).total).toBe(1);
    expect((await ac.listAccidents(s.ctx, { year: 2025, skip: 0, take: 20 })).total).toBe(0);
  });

  it("accès : réservé aux droits « accidents » ; un salarié ne voit rien ; isolation entre entreprises ; exports", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const a = await ac.createAccident(s.ctx, accidentSchema.parse({ employeeId: e.id, kind: "WORKPLACE", occurredOn: "2026-01-12", place: "Atelier", circumstances: "Coupure à la main." }));
    const self = await selfService(s);
    await expect(ac.listAccidents(self.ctx, { skip: 0, take: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ac.getAccident(self.ctx, a.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ac.createAccident(self.ctx, accidentSchema.parse({ employeeId: self.e.id, kind: "WORKPLACE", occurredOn: "2026-01-12", place: "Atelier", circumstances: "Déclaration par le salarié." }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await setup();
    await expect(ac.getAccident(other.ctx, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await ac.listAccidents(other.ctx, { skip: 0, take: 5 })).total).toBe(0);
    const table = await HR_EXPORTERS["hr-accidents"]!.build(s.ctx, () => undefined);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({ number: a.number, employee: "Koné Awa" });
  });
});

describe("permissions", () => {
  async function typeOf(s: S, over: Record<string, unknown> = {}) {
    return to.createTimeOffType(s.ctx, { name: `Permission ${Math.random().toString(36).slice(2, 7)}`, paid: true, requiresProof: false, ...over } as never);
  }
  const input = (employeeId: string, typeId: string, over: Record<string, unknown> = {}) => timeOffSchema.parse({ employeeId, typeId, unit: "DAILY", startDate: "2027-03-01", endDate: "2027-03-02", reason: "Événement familial", ...over });

  it("journalière : jours ouvrés calculés par le serveur ; brouillon → soumission → validation par un tiers → statut", async () => {
    const s = await setup();
    const { e, ctx } = await selfService(s);
    const t = await typeOf(s);
    const r = await to.createTimeOff(ctx, input(e.id, t.id, { startDate: "2027-03-05", endDate: "2027-03-08" })); // vendredi → lundi
    expect(r.status).toBe("DRAFT");
    expect(Number(r.days)).toBe(2);
    const sub = await to.submitTimeOff(ctx, r.id);
    expect(sub.status).toBe("PENDING");
    expect(sub.autoApproved).toBe(false);
    const appr = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 5 })).rows.find((a) => a.resourceType === "timeoff")!;
    expect(appr.resourceId).toBe(r.id);
    await expect(decideApproval(ctx, { id: appr.id, decision: "APPROVED" })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|BUSINESS_RULE/) });
    await decideApproval(s.ctx, { id: appr.id, decision: "APPROVED", comment: "Accordé" });
    const done = await to.getTimeOff(ctx, r.id);
    expect(done).toMatchObject({ status: "APPROVED", decidedById: s.owner.id, decisionComment: "Accordé" });
    expect(await platformDb.notification.count({ where: { companyId: s.company.id, userId: m(ctx), title: { startsWith: "Validé" } } })).toBe(1);
  });

  it("refus : motif obligatoire, statut REJECTED ; annulation d'une demande en attente retire la validation", async () => {
    const s = await setup();
    const { e, ctx } = await selfService(s);
    const t = await typeOf(s);
    const r = await to.createTimeOff(ctx, input(e.id, t.id, { submit: true }));
    const appr = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 5 })).rows.find((a) => a.resourceType === "timeoff")!;
    await expect(decideApproval(s.ctx, { id: appr.id, decision: "REJECTED" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await decideApproval(s.ctx, { id: appr.id, decision: "REJECTED", comment: "Période de clôture" });
    expect((await to.getTimeOff(ctx, r.id)).status).toBe("REJECTED");
    const r2 = await to.createTimeOff(ctx, input(e.id, t.id, { startDate: "2027-04-05", endDate: "2027-04-05", submit: true }));
    await to.cancelTimeOff(ctx, r2.id);
    expect((await to.getTimeOff(ctx, r2.id)).status).toBe("CANCELLED");
    expect(await platformDb.approvalRequest.count({ where: { companyId: s.company.id, resourceId: r2.id, status: "PENDING" } })).toBe(0);
  });

  it("horaire : durée en heures de travail ; à cheval sur deux journées ; hors horaire refusé", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const t = await typeOf(s);
    const h = await to.createTimeOff(s.ctx, input(e.id, t.id, { unit: "HOURLY", startDate: "2027-03-01", startTime: "09:00", endDate: "2027-03-01", endTime: "11:30" }));
    expect(Number(h.hours)).toBe(2.5);
    const two = await to.createTimeOff(s.ctx, input(e.id, t.id, { unit: "HOURLY", startDate: "2027-03-02", startTime: "16:00", endDate: "2027-03-03", endTime: "10:00" }));
    expect(Number(two.hours)).toBe(3); // 1 h le 2 + 2 h le 3
    await expect(to.createTimeOff(s.ctx, input(e.id, t.id, { unit: "HOURLY", startDate: "2027-03-08", startTime: "18:00", endDate: "2027-03-08", endTime: "20:00" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("aucune heure de travail") });
    await expect(to.createTimeOff(s.ctx, input(e.id, t.id, { unit: "HOURLY", startDate: "2027-03-08", endDate: "2027-03-08" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("heure de début") });
    await expect(to.createTimeOff(s.ctx, input(e.id, t.id, { unit: "HOURLY", startDate: "2027-03-08", startTime: "11:00", endDate: "2027-03-08", endTime: "10:00" }))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("chevauchements : permission/permission, congé, absence ; deux plages horaires voisines restent compatibles", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const t = await typeOf(s);
    const a = await to.createTimeOff(s.ctx, input(e.id, t.id, { unit: "HOURLY", startDate: "2027-03-01", startTime: "08:00", endDate: "2027-03-01", endTime: "10:00", submit: true }));
    expect(a.status).toBe("APPROVED"); // administrateur unique : acceptée d'office
    await to.createTimeOff(s.ctx, input(e.id, t.id, { unit: "HOURLY", startDate: "2027-03-01", startTime: "10:00", endDate: "2027-03-01", endTime: "12:00" })); // voisine : OK
    await expect(to.createTimeOff(s.ctx, input(e.id, t.id, { unit: "HOURLY", startDate: "2027-03-01", startTime: "09:30", endDate: "2027-03-01", endTime: "11:00" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Chevauche une permission") });
    await expect(to.createTimeOff(s.ctx, input(e.id, t.id, { startDate: "2027-03-01", endDate: "2027-03-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Chevauche une permission") });

    // congé existant
    const lt = await lv.createLeaveType(s.ctx, leaveTypeSchema.parse({ name: "Congé test", annualDays: 30, paid: true }));
    await lv.requestLeave(s.ctx, { employeeId: e.id, typeId: lt.id, startDate: "2027-05-03", endDate: "2027-05-07", reason: "" });
    await expect(to.createTimeOff(s.ctx, input(e.id, t.id, { startDate: "2027-05-05", endDate: "2027-05-05" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Chevauche un congé") });
    // et inversement : un congé par-dessus une permission validée est refusé
    await expect(lv.requestLeave(s.ctx, { employeeId: e.id, typeId: lt.id, startDate: "2027-02-26", endDate: "2027-03-02", reason: "" })).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Chevauche une permission") });

    // absence enregistrée
    const at = await ab.createAbsenceType(s.ctx, { name: "Maladie test", category: "SICK", requiresValidation: false, requiresProof: true });
    await ab.createAbsence(s.ctx, absenceSchema.parse({ employeeId: e.id, typeId: at.id, startDate: "2027-06-07", endDate: "2027-06-08" }));
    await expect(to.createTimeOff(s.ctx, input(e.id, t.id, { startDate: "2027-06-08", endDate: "2027-06-08" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Chevauche une absence") });
  });

  it("modification : brouillon seulement ; après soumission ou validation, annuler puis refaire ; plafond du type respecté", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const t = await typeOf(s, { maxDays: 2 });
    const { updateTimeOffSchema } = await import("@/modules/hr/registers-schemas");
    const upd = (id: string, over: Record<string, unknown> = {}) => updateTimeOffSchema.parse({ id, typeId: t.id, unit: "DAILY", startDate: "2027-03-09", endDate: "2027-03-09", reason: "Modifié", ...over });
    const d = await to.createTimeOff(s.ctx, input(e.id, t.id, { startDate: "2027-03-08", endDate: "2027-03-08" }));
    await to.updateTimeOff(s.ctx, upd(d.id));
    expect(Number((await to.getTimeOff(s.ctx, d.id)).days)).toBe(1);
    await to.submitTimeOff(s.ctx, d.id); // d'office (administrateur unique)
    await expect(to.updateTimeOff(s.ctx, upd(d.id))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("validée") });
    await expect(to.submitTimeOff(s.ctx, d.id)).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(to.createTimeOff(s.ctx, input(e.id, t.id, { startDate: "2027-04-05", endDate: "2027-04-09" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("limité à 2") });
  });

  it("accès : un salarié ne demande que pour lui et ne voit que les siennes ; un manager voit son équipe ; isolation entre entreprises", async () => {
    const s = await setup();
    const t = await typeOf(s);
    const a = await selfService(s, { firstName: "Alice" });
    const b = await selfService(s, { firstName: "Boris", lastName: "Yao" });
    await expect(to.createTimeOff(a.ctx, input(b.e.id, t.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const mine = await to.createTimeOff(a.ctx, input(a.e.id, t.id));
    await to.createTimeOff(b.ctx, input(b.e.id, t.id));
    expect((await to.listTimeOffs(a.ctx, { skip: 0, take: 20 })).rows.map((r) => r.id)).toEqual([mine.id]);
    await expect(to.getTimeOff(b.ctx, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await to.listTimeOffs(s.ctx, { skip: 0, take: 20 })).total).toBe(2);

    // manager (droit d'approbation) : uniquement ses collaborateurs
    const mgr = await addMember(s.company.id, "employee");
    const mgrEmp = await newEmp(s, { userId: mgr.user.id, firstName: "Chef" });
    await platformDb.employee.update({ where: { id: a.e.id }, data: { managerId: mgrEmp.id } });
    const role = await platformDb.role.findFirstOrThrow({ where: { companyId: s.company.id, id: mgr.membership.roleId } });
    const perm = await platformDb.permission.findMany({ where: { key: { in: ["hr.timeoff.approve", "hr.timeoff.request", "workflow.request.approve"] } } });
    await platformDb.rolePermission.createMany({ data: perm.map((p) => ({ roleId: role.id, permissionId: p.id, companyId: s.company.id })), skipDuplicates: true });
    const mctx = await ctxFor(mgr.user.id, s.company.id);
    const seen = (await to.listTimeOffs(mctx, { skip: 0, take: 20 })).rows.map((r) => r.employeeId);
    expect(seen).toEqual([a.e.id]);
    await expect(to.getTimeOff(mctx, (await to.listTimeOffs(b.ctx, { skip: 0, take: 5 })).rows[0]!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // et il ne VALIDE que les demandes de son équipe (garde du moteur de validation)
    const bReq = await to.submitTimeOff(b.ctx, (await to.listTimeOffs(b.ctx, { skip: 0, take: 5 })).rows[0]!.id);
    const aReq = await to.submitTimeOff(a.ctx, mine.id);
    expect([aReq.status, bReq.status]).toEqual(["PENDING", "PENDING"]);
    const pendings = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 10 })).rows.filter((r) => r.resourceType === "timeoff");
    const apprA = pendings.find((r) => r.resourceId === mine.id)!, apprB = pendings.find((r) => r.resourceId !== mine.id)!;
    await expect(decideApproval(mctx, { id: apprB.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("hors de votre équipe") });
    await decideApproval(mctx, { id: apprA.id, decision: "APPROVED" });
    expect((await to.getTimeOff(s.ctx, mine.id)).status).toBe("APPROVED");
    expect((await to.getTimeOff(s.ctx, apprB.resourceId)).status).toBe("PENDING");

    const other = await setup();
    await expect(to.getTimeOff(other.ctx, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("intégration présences : une permission validée apparaît dans le calendrier du jour", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const t = await typeOf(s);
    await to.createTimeOff(s.ctx, input(e.id, t.id, { unit: "HOURLY", startDate: "2027-03-01", startTime: "09:00", endDate: "2027-03-01", endTime: "11:00", submit: true }));
    await to.createTimeOff(s.ctx, input(e.id, t.id, { startDate: "2027-03-02", endDate: "2027-03-03", submit: true }));
    const d1 = (await to.timeOffOn(s.ctx.db, day("2027-03-01"))).get(e.id);
    expect(d1).toMatchObject({ full: false, from: "09:00", to: "11:00" });
    expect((await to.timeOffOn(s.ctx.db, day("2027-03-03"))).get(e.id)).toMatchObject({ full: true });
    expect((await to.timeOffOn(s.ctx.db, day("2027-03-04"))).has(e.id)).toBe(false);
  });
});

/** Identifiant utilisateur du contexte (destinataire des notifications). */
const m = (ctx: { user: { id: string } }) => ctx.user.id;

describe("absences", () => {
  const input = (employeeId: string, typeId: string, over: Record<string, unknown> = {}) => absenceSchema.parse({ employeeId, typeId, startDate: "2027-03-01", endDate: "2027-03-02", ...over });

  it("types configurables, durée en jours ouvrés, demi-journée, justificatif par défaut selon le motif", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const inj = await ab.createAbsenceType(s.ctx, { name: "Injustifiée", category: "UNJUSTIFIED", requiresValidation: false, requiresProof: false });
    const mal = await ab.createAbsenceType(s.ctx, { name: "Maladie", category: "SICK", requiresValidation: false, requiresProof: true });
    await expect(ab.createAbsenceType(s.ctx, { name: "injustifiée", category: "OTHER", requiresValidation: false, requiresProof: false })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    const a = await ab.createAbsence(s.ctx, input(e.id, inj.id, { startDate: "2027-03-05", endDate: "2027-03-08" })); // ven + lun
    expect(Number(a.days)).toBe(2);
    expect(a).toMatchObject({ status: "APPROVED", justification: "REFUSED" });
    const half = await ab.createAbsence(s.ctx, input(e.id, mal.id, { startDate: "2027-03-10", endDate: "2027-03-10", halfDay: true }));
    expect(Number(half.days)).toBe(0.5);
    expect(half.justification).toBe("PENDING");
    await expect(ab.createAbsence(s.ctx, input(e.id, mal.id, { startDate: "2027-03-15", endDate: "2027-03-16", halfDay: true }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("demi-journée") });
    await expect(ab.createAbsence(s.ctx, input(e.id, mal.id, { startDate: "2027-03-06", endDate: "2027-03-07" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("aucun jour travaillé") });
    await expect(ab.createAbsence(s.ctx, input(e.id, mal.id, { startDate: "2027-03-09", endDate: "2027-03-11" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Chevauche") });
    await expect(ab.createAbsence(s.ctx, input(e.id, mal.id, { startDate: "2019-03-05", endDate: "2019-03-05" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("embauche") });
  });

  it("justificatif : validation par la RH, historique du salarié ; modifications tracées", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const mal = await ab.createAbsenceType(s.ctx, { name: "Maladie", category: "SICK", requiresValidation: false, requiresProof: true });
    const a = await ab.createAbsence(s.ctx, input(e.id, mal.id));
    await ab.justifyAbsence(s.ctx, { id: a.id, justification: "ACCEPTED", hrNote: "Certificat reçu" });
    expect((await ab.getAbsence(s.ctx, a.id)).justification).toBe("ACCEPTED");
    const { updateAbsenceSchema } = await import("@/modules/hr/registers-schemas");
    await ab.updateAbsence(s.ctx, updateAbsenceSchema.parse({ id: a.id, typeId: mal.id, startDate: "2027-03-01", endDate: "2027-03-03", halfDay: false }));
    expect(Number((await ab.absenceHistory(s.ctx, e.id))[0]!.days)).toBe(3);
    expect(await platformDb.auditLog.count({ where: { companyId: s.company.id, resourceId: a.id, action: { in: ["hr.absence.justify", "hr.absence.update", "hr.absence.create"] } } })).toBe(3);
  });

  it("validation administrative : motif soumis à validation → en attente → décision ; modification interdite pendant et après la validation", async () => {
    const s = await setup();
    const { e } = await selfService(s);
    const approver = await addMember(s.company.id, "hr"); // second profil habilité : sans lui, l'absence serait acceptée d'office
    const exc = await ab.createAbsenceType(s.ctx, { name: "Exceptionnelle", category: "EXCEPTIONAL", requiresValidation: true, requiresProof: false });
    const a = await ab.createAbsence(s.ctx, input(e.id, exc.id));
    expect(a.status).toBe("PENDING");
    const { updateAbsenceSchema } = await import("@/modules/hr/registers-schemas");
    const upd = updateAbsenceSchema.parse({ id: a.id, typeId: exc.id, startDate: "2027-03-01", endDate: "2027-03-01", halfDay: false });
    await expect(ab.updateAbsence(s.ctx, upd)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("validation") });
    const appr = (await listApprovals(s.ctx, { status: "PENDING", skip: 0, take: 5 })).rows.find((r) => r.resourceType === "absence")!;
    // le déclarant (RH = propriétaire ici) ne valide pas sa propre déclaration
    await expect(decideApproval(s.ctx, { id: appr.id, decision: "APPROVED" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await decideApproval(await ctxFor(approver.user.id, s.company.id), { id: appr.id, decision: "APPROVED" });
    expect((await ab.getAbsence(s.ctx, a.id)).status).toBe("APPROVED");
    await expect(ab.updateAbsence(s.ctx, upd)).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("validée") });
    await ab.cancelAbsence(s.ctx, a.id);
    expect((await ab.getAbsence(s.ctx, a.id)).status).toBe("CANCELLED");
  });

  it("absences répétées : seuil paramétrable, seulement les injustifiées validées ; aucune sanction ni retenue créée", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const f = await newEmp(s, { firstName: "Moussa", lastName: "Traoré" });
    const inj = await ab.createAbsenceType(s.ctx, { name: "Injustifiée", category: "UNJUSTIFIED", requiresValidation: false, requiresProof: false });
    const mal = await ab.createAbsenceType(s.ctx, { name: "Maladie", category: "SICK", requiresValidation: false, requiresProof: false });
    const today = new Date("2027-06-30T10:00:00Z");
    for (const d of ["2027-06-07", "2027-06-14", "2027-06-21"]) await ab.createAbsence(s.ctx, input(e.id, inj.id, { startDate: d, endDate: d }));
    for (const d of ["2027-06-07", "2027-06-14", "2027-06-21"]) await ab.createAbsence(s.ctx, input(f.id, mal.id, { startDate: d, endDate: d }));
    const rep = await ab.repeatedAbsences(s.ctx, today);
    expect(rep.map((r) => r.employeeId)).toEqual([e.id]);
    expect(rep[0]).toMatchObject({ occurrences: 3, days: 3 });
    await savePolicy(s.ctx, hrPolicyInput({ absenceRepeatCount: 4 }));
    expect(await ab.repeatedAbsences(s.ctx, today)).toEqual([]);
    expect(await platformDb.payslip.count({ where: { companyId: s.company.id } })).toBe(0);
  });

  it("accès : seule la RH enregistre ; un salarié ne voit rien ; un manager voit son équipe ; isolation entre entreprises", async () => {
    const s = await setup();
    const self = await selfService(s);
    const mal = await ab.createAbsenceType(s.ctx, { name: "Maladie", category: "SICK", requiresValidation: false, requiresProof: false });
    await expect(ab.createAbsence(self.ctx, input(self.e.id, mal.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const a = await ab.createAbsence(s.ctx, input(self.e.id, mal.id));
    expect((await ab.listAbsences(self.ctx, { skip: 0, take: 5 })).rows).toEqual([]);
    await expect(ab.getAbsence(self.ctx, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await setup();
    await expect(ab.getAbsence(other.ctx, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const table = await HR_EXPORTERS["hr-absences"]!.build(s.ctx, () => undefined);
    expect(table.rows).toHaveLength(1);
  });
});

describe("retards", () => {
  const input = (employeeId: string, over: Record<string, unknown> = {}) => latenessSchema.parse({ employeeId, date: "2026-03-02", actualTime: "08:25", ...over });

  it("calcul automatique par rapport à l'horaire paramétré ; tolérance ; doublon et dates invalides refusés", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const r = await la.createLateness(s.ctx, input(e.id));
    expect(r).toMatchObject({ expectedTime: "08:00", actualTime: "08:25", minutesLate: 25, justification: "PENDING", source: "MANUAL" });
    await expect(la.createLateness(s.ctx, input(e.id))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("déjà enregistré") });
    await expect(la.createLateness(s.ctx, input(e.id, { date: "2026-03-03", actualTime: "07:55" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("Aucun retard") });
    await expect(la.createLateness(s.ctx, input(e.id, { date: "2999-01-01" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("future") });
    await savePolicy(s.ctx, hrPolicyInput({ workStartTime: "07:30", lateGraceMinutes: 10 }));
    const t = await la.createLateness(s.ctx, input(e.id, { date: "2026-03-04", actualTime: "07:50" }));
    expect(t).toMatchObject({ expectedTime: "07:30", minutesLate: 20 });
    await expect(la.createLateness(s.ctx, input(e.id, { date: "2026-03-05", actualTime: "07:38" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("tolérance") });
    const upd = await la.updateLateness(s.ctx, { id: t.id, actualTime: "08:00", expectedTime: "07:30", reason: "Transport" });
    expect(upd.minutesLate).toBe(30);
  });

  it("pas de retard un jour de congé ou d'absence, ni sous une permission qui couvre la plage", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const lt = await lv.createLeaveType(s.ctx, leaveTypeSchema.parse({ name: "Congé test", annualDays: 30, paid: true }));
    await lv.requestLeave(s.ctx, { employeeId: e.id, typeId: lt.id, startDate: "2026-03-02", endDate: "2026-03-03", reason: "" });
    await expect(la.createLateness(s.ctx, input(e.id, { date: "2026-03-02" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("congé") });
    const tt = await to.createTimeOffType(s.ctx, { name: "Rendez-vous", paid: true, requiresProof: false } as never);
    await to.createTimeOff(s.ctx, timeOffSchema.parse({ employeeId: e.id, typeId: tt.id, unit: "HOURLY", startDate: "2026-03-04", startTime: "08:00", endDate: "2026-03-04", endTime: "09:30", reason: "Médecin", submit: true }));
    await expect(la.createLateness(s.ctx, input(e.id, { date: "2026-03-04", actualTime: "09:00" }))).rejects.toMatchObject({ code: "BUSINESS_RULE", message: expect.stringContaining("permission") });
    expect((await la.createLateness(s.ctx, input(e.id, { date: "2026-03-04", actualTime: "10:00" }))).minutesLate).toBe(120); // au-delà de la permission
  });

  it("justification, statistiques mensuelles, retards récurrents (seuil paramétrable), historique individuel, suppression tracée", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const f = await newEmp(s, { firstName: "Moussa", lastName: "Traoré" });
    const today = new Date("2026-06-28T10:00:00Z");
    for (const dt of ["2026-06-01", "2026-06-08", "2026-06-15"]) await la.createLateness(s.ctx, input(e.id, { date: dt, actualTime: "08:30" }));
    const lf = await la.createLateness(s.ctx, input(f.id, { date: "2026-06-09", actualTime: "09:00" }));
    await la.justifyLateness(s.ctx, { id: lf.id, justification: "ACCEPTED", hrNote: "Panne de bus avérée" });
    const st = await la.latenessStats(s.ctx, 2026, 6);
    expect(st).toMatchObject({ count: 4, minutes: 3 * 30 + 60, unjustified: 3, employees: 2 });
    expect(st.perEmployee[0]).toMatchObject({ employeeId: e.id, count: 3 });
    expect(st.perDay[0]).toMatchObject({ day: 1, count: 1 });
    expect((await la.recurringLateness(s.ctx, today)).map((r) => r.employeeId)).toEqual([e.id]); // f : justifié et sous le seuil
    await savePolicy(s.ctx, hrPolicyInput({ lateRecurrenceCount: 4 }));
    expect(await la.recurringLateness(s.ctx, today)).toEqual([]);
    expect(await la.latenessHistory(s.ctx, e.id)).toHaveLength(3);
    await la.deleteLateness(s.ctx, lf.id);
    expect(await platformDb.auditLog.count({ where: { companyId: s.company.id, action: "hr.lateness.delete" } })).toBe(1);
    const table = await HR_EXPORTERS["hr-retards"]!.build(s.ctx, (k) => (k === "du" ? "2026-06-01" : k === "au" ? "2026-06-30" : undefined));
    expect(table.rows).toHaveLength(3);
  });

  it("intégration présences : import idempotent des retards depuis les pointages", async () => {
    const s = await setup();
    const e = await newEmp(s);
    const f = await newEmp(s, { firstName: "Moussa", lastName: "Traoré" });
    const att = (employeeId: string, date: string, checkIn: string, status = "PRESENT") => platformDb.attendance.create({ data: { companyId: s.company.id, employeeId, date: day(date), status: status as never, checkIn } });
    await att(e.id, "2026-04-06", "08:45");
    await att(e.id, "2026-04-07", "07:58");
    await att(f.id, "2026-04-06", "08:10");
    await att(f.id, "2026-04-07", "09:00", "ABSENT");
    const r1 = await la.importLatenessFromAttendance(s.ctx, { from: "2026-04-01", to: "2026-04-30" });
    expect(r1).toMatchObject({ created: 2, already: 0 });
    expect((await la.listLateness(s.ctx, { skip: 0, take: 10 })).rows.every((r) => r.source === "ATTENDANCE")).toBe(true);
    const r2 = await la.importLatenessFromAttendance(s.ctx, { from: "2026-04-01", to: "2026-04-30" });
    expect(r2).toMatchObject({ created: 0, already: 2 });
    await expect(la.importLatenessFromAttendance(s.ctx, { from: "2026-01-01", to: "2026-12-31" })).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("accès : réservé aux droits « retards » ; isolation entre entreprises", async () => {
    const s = await setup();
    const self = await selfService(s);
    await expect(la.createLateness(self.ctx, input(self.e.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const r = await la.createLateness(s.ctx, input(self.e.id));
    expect((await la.listLateness(self.ctx, { skip: 0, take: 5 })).rows).toEqual([]);
    await expect(la.latenessHistory(self.ctx, self.e.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await setup();
    await expect(la.justifyLateness(other.ctx, { id: r.id, justification: "ACCEPTED" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
