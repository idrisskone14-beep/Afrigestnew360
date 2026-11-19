import "server-only";
import PDFDocument from "pdfkit";
import { audit } from "@/core/audit";
import { drawPdfFooters } from "@/core/pdf/business-document";
import { DOCUMENT_BRAND } from "@/core/pdf/legal-footer";
import type { TenantContext } from "@/core/tenant/context";
import { issuer } from "@/modules/sales/pdf";
import { getAccident } from "./accidents";
import { CONDITIONS, DISCIPLINE_STATUSES, STEP_KINDS } from "./admin-schemas";
import { getEquipment } from "./equipment";
import { renderSheet } from "./pdf-sheet";
import { getCase } from "./sanctions";
import { ACCIDENT_KINDS, CNPS_STATUSES, QUALIFICATIONS } from "./registers-schemas";

/** PDF des registres RH : le droit de lecture du registre est revérifié par le service appelé (jamais seulement par la route). */
export const HR_PDF_PERMISSION = { hr_accident: "hr.accident.read", hr_sanction: "hr.sanction.read", hr_equipment: "hr.equipment.read" } as const;
export type HrPdfKind = keyof typeof HR_PDF_PERMISSION;

const INK = "#0F172A", MUTED = "#64748B", BRAND = "#007A58", LINE = "#E2E8F0";
const fr = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(d) : "—");
const label = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;

/** Fiche d'accident du travail : faits, arrêt, déclaration CNPS, mesures correctives, signatures. Document interne, non transmissible tel quel à un organisme. */
export async function buildHrPdf(ctx: TenantContext, kind: HrPdfKind, id: string): Promise<{ data: Buffer; filename: string }> {
  if (kind === "hr_sanction") return sanctionSheet(ctx, id);
  if (kind === "hr_equipment") return equipmentSheet(ctx, id);
  const a = await getAccident(ctx, id);
  const base = await issuer(ctx);
  await audit(ctx, { action: "hr.accident.pdf", resource: "WorkAccident", resourceId: a.id, summary: `${ctx.user.name} a édité la fiche PDF du dossier d'accident ${a.number}.` });
  const data = await new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `Fiche d'accident ${a.number}`, Author: base.issuer.name } });
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    const left = 40, right = pdf.page.width - 40, width = right - left;

    let y = 40, textX = left;
    if (base.logo) { try { pdf.image(base.logo, left, y, { fit: [70, 56] }); textX = left + 82; } catch { /* logo non supporté */ } }
    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(base.issuer.name, textX, y, { width: 270 });
    pdf.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    for (const l of [...base.issuer.lines, ...base.issuer.legal]) pdf.text(l, textX, pdf.y, { width: 270 });
    pdf.fillColor(BRAND).font("Helvetica-Bold").fontSize(16).text("FICHE D'ACCIDENT", left + width / 2, y, { width: width / 2, align: "right" });
    pdf.fillColor(INK).fontSize(11).text(`N° ${a.number}`, left + width / 2, pdf.y, { width: width / 2, align: "right" });
    pdf.fillColor(MUTED).font("Helvetica").fontSize(9).text(label(ACCIDENT_KINDS, a.kind), left + width / 2, pdf.y + 2, { width: width / 2, align: "right" });
    y = Math.max(pdf.y, y + 70) + 10;
    pdf.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 12;

    const bottomLimit = () => pdf.page.height - 90;
    const heading = (t: string) => { if (pdf.y > bottomLimit() - 40) pdf.addPage(); pdf.moveDown(0.6); pdf.fillColor(BRAND).font("Helvetica-Bold").fontSize(9).text(t.toUpperCase(), left, pdf.y, { width }); pdf.moveDown(0.2); };
    const row = (k: string, v: string | null | undefined) => {
      if (pdf.y > bottomLimit()) pdf.addPage();
      const top = pdf.y;
      pdf.fillColor(MUTED).font("Helvetica").fontSize(9).text(k, left, top, { width: 150 });
      const afterKey = pdf.y;
      pdf.fillColor(INK).font("Helvetica").fontSize(9.5).text(v && v.trim() ? v : "—", left + 155, top, { width: width - 155 });
      pdf.y = Math.max(afterKey, pdf.y) + 3;
    };

    pdf.y = y;
    heading("Salarié");
    row("Nom et prénoms", a.employeeName); row("Matricule", a.employeeNumber); row("Service", a.departmentName);
    heading("Les faits");
    row("Date et heure", `${fr(a.occurredOn)}${a.occurredTime ? ` à ${a.occurredTime}` : ""}`); row("Lieu", a.place); row("Type d'accident", a.category);
    row("Circonstances", a.circumstances);
    if (a.kind === "COMMUTE") row("Trajet", a.commuteDetails);
    row("Nature des blessures", a.injuries); row("Témoins", a.witnesses); row("Premiers soins", a.firstAid); row("Prise en charge", a.careFacility);
    heading("Arrêt de travail");
    row("Arrêt prescrit", a.workStop ? "Oui" : "Non");
    if (a.workStop) { row("Du", fr(a.stopStart)); row("Au", fr(a.stopEnd)); }
    row("Date de reprise", fr(a.returnDate));
    heading("Déclaration à la CNPS");
    row("Statut", label(CNPS_STATUSES, a.cnpsStatus)); row("Date de déclaration", fr(a.cnpsDeclaredOn)); row("Référence", a.cnpsReference); row("Qualification", label(QUALIFICATIONS, a.qualification));
    heading("Mesures correctives");
    row("Mesures", a.correctiveActions);

    if (pdf.y > bottomLimit() - 70) pdf.addPage();
    const sy = pdf.y + 24;
    pdf.fillColor(MUTED).font("Helvetica").fontSize(8.5);
    pdf.text("Le salarié", left, sy, { width: width / 3 }); pdf.text("L'employeur", left + width / 3, sy, { width: width / 3 }); pdf.text("Responsable sécurité / RH", left + (2 * width) / 3, sy, { width: width / 3 });
    pdf.fillColor(MUTED).fontSize(7.5).text("Document interne de suivi. Ne remplace ni la déclaration officielle, ni les registres légaux de l'entreprise.", left, sy + 60, { width });
    drawPdfFooters(pdf, { text: base.issuer.footer, left, width, brand: `${DOCUMENT_BRAND}. Document confidentiel : données de santé et de sécurité.` });
    pdf.end();
  });
  return { data, filename: `accident-${a.number}.pdf` };
}

const frShort = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(d) : "—");

/** Fiche du dossier disciplinaire : faits, étapes, décision. Document interne de suivi ; la lettre de notification reste rédigée par l'entreprise. */
async function sanctionSheet(ctx: TenantContext, id: string) {
  const c = await getCase(ctx, id);
  await audit(ctx, { action: "hr.sanction.pdf", resource: "DisciplinaryCase", resourceId: c.id, summary: `${ctx.user.name} a édité la fiche PDF du dossier disciplinaire ${c.number}.` });
  const data = await renderSheet(ctx, {
    title: "Dossier disciplinaire", number: c.number, subtitle: DISCIPLINE_STATUSES.find((s) => s.value === c.status)?.label,
    sections: [
      { heading: "Salarié", rows: [["Nom et prénoms", c.employeeName], ["Matricule", c.employeeNumber]] },
      { heading: "Les faits", rows: [["Date des faits", frShort(c.factsDate)], ["Nature du manquement", c.breachNature], ["Description", c.description], ["Procédure suivie", c.procedureNote], ["Responsable du dossier", c.responsibleName]] },
      { heading: "Étapes de la procédure", rows: c.steps.map((s): [string, string] => [frShort(s.date), `${STEP_KINDS.find((k) => k.value === s.kind)?.label ?? s.kind}${s.note ? ` — ${s.note}` : ""}`]) },
      { heading: "Décision", rows: [["Sanction", c.sanctionType?.name], ["Date de décision", frShort(c.decisionDate)], ["Date de notification", frShort(c.notificationDate)], ["Observations", c.observations]] },
    ],
    signatures: ["Le salarié (réception)", "L'employeur", "Responsable du dossier"],
    note: "Document interne de suivi de procédure, confidentiel. Il ne remplace ni la lettre de notification ni les formalités prévues par la réglementation applicable.",
    footer: "Document confidentiel : dossier disciplinaire.",
  });
  return { data, filename: `dossier-disciplinaire-${c.number}.pdf` };
}

/** Fiche de remise d'équipement / EPI, à signer par le salarié. */
async function equipmentSheet(ctx: TenantContext, id: string) {
  const e = await getEquipment(ctx, id);
  const cond = (v: string | null) => CONDITIONS.find((c) => c.value === v)?.label ?? null;
  await audit(ctx, { action: "hr.equipment.pdf", resource: "EquipmentAssignment", resourceId: e.id, summary: `${ctx.user.name} a édité la fiche de remise de « ${e.name} » pour ${e.employee.firstName} ${e.employee.lastName}.` });
  const data = await renderSheet(ctx, {
    title: "Fiche de remise", number: e.id.slice(0, 8).toUpperCase(), subtitle: "Équipement / EPI",
    sections: [
      { heading: "Salarié", rows: [["Nom et prénoms", `${e.employee.lastName} ${e.employee.firstName}`], ["Matricule", e.employee.number]] },
      { heading: "Équipement remis", rows: [["Désignation", e.name], ["Référence", e.reference], ["Quantité", String(e.quantity)], ["Date de remise", frShort(e.issuedOn)], ["État à la remise", cond(e.condition)], ["Remplacement prévu", frShort(e.replaceOn)], ["Remis par", e.responsibleName], ["Observations", e.observations]] },
      { heading: "Restitution", rows: [["Date de restitution", e.returnedOn ? frShort(e.returnedOn) : "Non restitué"], ["État à la restitution", cond(e.returnCondition)]] },
    ],
    signatures: ["Le salarié (reçu)", "Le responsable de la remise"],
    note: "Le salarié reconnaît avoir reçu l'équipement ci-dessus et s'engage à l'utiliser conformément aux consignes et à le restituer en cas de départ ou de remplacement.",
    footer: "Fiche de remise d'équipement.",
  });
  return { data, filename: `remise-${e.name.replace(/[^\w-]+/g, "_").slice(0, 30)}-${e.id.slice(0, 6)}.pdf` };
}
