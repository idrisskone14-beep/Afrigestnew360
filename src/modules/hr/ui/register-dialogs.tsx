"use client";

import { Download, FileCheck2, Pencil, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityDialog, type FieldSpec, type Values } from "@/components/app/entity-dialog";
import {
  changeAssignmentAction, createSickLeaveAction, extendSickLeaveAction, returnSickLeaveAction, updateSickLeaveAction,
  createAbsenceAction, createAbsenceTypeAction, createAccidentAction, createLatenessAction, createTimeOffAction, createTimeOffTypeAction, importLatenessAction, justifyAbsenceAction, justifyLatenessAction,
  saveHrPolicyAction, updateAbsenceAction, updateAbsenceTypeAction, updateAccidentAction, updateLatenessAction, updateTimeOffAction, updateTimeOffTypeAction,
} from "../registers-actions";
import { ABSENCE_CATEGORIES, ACCIDENT_KINDS, CERTIFICATE_STATUSES, CNPS_STATUSES, JUSTIFICATIONS, QUALIFICATIONS, TIMEOFF_UNITS } from "../registers-schemas";

export interface Opt { value: string; label: string }
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const dateIn = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "");
const p = (v: Values, extra: Record<string, unknown> = {}) => ({ ...v, ...extra }) as never;
const opts = (xs: readonly { value: string; label: string }[]) => xs.map((x) => ({ value: x.value, label: x.label }));
const bool = (v: unknown) => v === true || v === "true";

// Les déclencheurs de fenêtre sont des composants : ils DOIVENT transmettre les propriétés reçues (onClick, aria-*…), sinon la fenêtre ne s'ouvre pas.
type BtnProps = React.ComponentProps<typeof Button>;
const AddBtn = ({ label, ...props }: { label: string } & BtnProps) => <Button {...props}><Plus className="size-4" /> {label}</Button>;
const EditBtn = ({ label, text, ...props }: { label: string; text?: string } & BtnProps) => <Button size={text ? "sm" : "icon"} variant="ghost" aria-label={label} {...props}><Pencil className="size-4" />{text}</Button>;

// ── Accidents de travail ───────────────────────────────────────

export interface AccidentForm {
  id: string; kind: string; occurredOn: Date; occurredTime: string | null; place: string; category: string | null; circumstances: string; injuries: string | null; witnesses: string | null; firstAid: string | null;
  careFacility: string | null; commuteDetails: string | null; workStop: boolean; stopStart: Date | null; stopEnd: Date | null; returnDate: Date | null; cnpsStatus: string; cnpsDeclaredOn: Date | null;
  cnpsReference: string | null; qualification: string; correctiveActions: string | null;
}

const accidentFields = (employees?: Opt[]): FieldSpec[] => [
  ...(employees ? [{ name: "employeeId", label: "Salarié concerné", kind: "select" as const, required: true, options: employees, wide: true }] : []),
  { name: "kind", label: "Nature du dossier", kind: "select", required: true, options: opts(ACCIDENT_KINDS) },
  { name: "category", label: "Type d'accident", placeholder: "Chute, coupure, brûlure, circulation…" },
  { name: "occurredOn", label: "Date", kind: "date", required: true }, { name: "occurredTime", label: "Heure", kind: "time" },
  { name: "place", label: "Lieu", required: true, wide: true },
  { name: "circumstances", label: "Circonstances", kind: "textarea", required: true, hint: "Que s'est-il passé, dans quelles conditions ?" },
  { name: "commuteDetails", label: "Trajet (accident de trajet)", kind: "textarea", hint: "Itinéraire suivi, heure de départ, éventuels détours ou arrêts. La reconnaissance relève de l'organisme compétent." },
  { name: "injuries", label: "Nature des blessures", kind: "textarea" }, { name: "witnesses", label: "Témoins", kind: "textarea", hint: "Noms et fonctions." },
  { name: "firstAid", label: "Premiers soins", kind: "textarea" }, { name: "careFacility", label: "Établissement de prise en charge" },
  { name: "workStop", label: "Arrêt de travail prescrit", kind: "switch" },
  { name: "stopStart", label: "Début de l'arrêt", kind: "date" }, { name: "stopEnd", label: "Fin de l'arrêt", kind: "date" }, { name: "returnDate", label: "Date de reprise", kind: "date" },
  { name: "cnpsStatus", label: "Déclaration CNPS", kind: "select", required: true, options: opts(CNPS_STATUSES) }, { name: "cnpsDeclaredOn", label: "Date de déclaration", kind: "date" },
  { name: "cnpsReference", label: "Référence de la déclaration" }, { name: "qualification", label: "Qualification (décision de l'organisme)", kind: "select", required: true, options: opts(QUALIFICATIONS) },
  { name: "correctiveActions", label: "Mesures correctives", kind: "textarea" },
];

export function AccidentDialog({ employees, accident }: { employees?: Opt[]; accident?: AccidentForm }) {
  const initial: Values = accident
    ? { kind: accident.kind, category: str(accident.category), occurredOn: dateIn(accident.occurredOn), occurredTime: str(accident.occurredTime), place: accident.place, circumstances: accident.circumstances, commuteDetails: str(accident.commuteDetails), injuries: str(accident.injuries), witnesses: str(accident.witnesses), firstAid: str(accident.firstAid), careFacility: str(accident.careFacility), workStop: accident.workStop, stopStart: dateIn(accident.stopStart), stopEnd: dateIn(accident.stopEnd), returnDate: dateIn(accident.returnDate), cnpsStatus: accident.cnpsStatus, cnpsDeclaredOn: dateIn(accident.cnpsDeclaredOn), cnpsReference: str(accident.cnpsReference), qualification: accident.qualification, correctiveActions: str(accident.correctiveActions) }
    : { employeeId: "", kind: "WORKPLACE", category: "", occurredOn: new Date().toISOString().slice(0, 10), occurredTime: "", place: "", circumstances: "", commuteDetails: "", injuries: "", witnesses: "", firstAid: "", careFacility: "", workStop: false, stopStart: "", stopEnd: "", returnDate: "", cnpsStatus: "TO_DECLARE", cnpsDeclaredOn: "", cnpsReference: "", qualification: "TO_QUALIFY", correctiveActions: "" };
  return (
    <EntityDialog
      wide title={accident ? "Modifier le dossier d'accident" : "Nouveau dossier d'accident"} description="Le numéro de dossier est attribué automatiquement. Les pièces justificatives se joignent depuis la fiche."
      fields={accidentFields(accident ? undefined : employees)} initial={initial} success={accident ? "Dossier modifié" : "Dossier créé"}
      trigger={accident ? <EditBtn label="Modifier le dossier" text="Modifier" /> : <AddBtn label="Déclarer un accident" />}
      onSubmit={(v) => (accident ? updateAccidentAction(p(v, { id: accident.id, workStop: bool(v.workStop) })) : createAccidentAction(p(v, { workStop: bool(v.workStop) })))}
    />
  );
}

// ── Permissions ────────────────────────────────────────────────

export interface TimeOffForm { id: string; typeId: string; unit: string; startDate: Date; startTime: string | null; endDate: Date; endTime: string | null; reason: string; comment: string | null; paid: boolean }

export function TimeOffDialog({ employees, types, defaultEmployeeId, timeOff }: { employees: Opt[]; types: Opt[]; defaultEmployeeId?: string; timeOff?: TimeOffForm }) {
  const fields: FieldSpec[] = [
    ...(!timeOff && employees.length > 1 ? [{ name: "employeeId", label: "Salarié", kind: "select" as const, required: true, options: employees, wide: true }] : []),
    { name: "typeId", label: "Type de permission", kind: "select", required: true, options: types, wide: true },
    { name: "unit", label: "Nature", kind: "select", required: true, options: opts(TIMEOFF_UNITS), hint: "Journalière : jours ouvrés. Horaire : heures de travail effectives." },
    { name: "paid", label: "Rémunérée", kind: "switch" },
    { name: "startDate", label: "Début (date)", kind: "date", required: true }, { name: "startTime", label: "Début (heure)", kind: "time", hint: "Permission horaire uniquement." },
    { name: "endDate", label: "Fin (date)", kind: "date", required: true }, { name: "endTime", label: "Fin (heure)", kind: "time", hint: "Permission horaire uniquement." },
    { name: "reason", label: "Motif", kind: "textarea", required: true }, { name: "comment", label: "Commentaire", kind: "textarea" },
    ...(!timeOff ? [{ name: "submit", label: "Soumettre immédiatement à validation", kind: "switch" as const }] : []),
  ];
  const today = new Date().toISOString().slice(0, 10);
  const initial: Values = timeOff
    ? { typeId: timeOff.typeId, unit: timeOff.unit, paid: timeOff.paid, startDate: dateIn(timeOff.startDate), startTime: str(timeOff.startTime), endDate: dateIn(timeOff.endDate), endTime: str(timeOff.endTime), reason: timeOff.reason, comment: str(timeOff.comment) }
    : { employeeId: defaultEmployeeId ?? employees[0]?.value ?? "", typeId: types[0]?.value ?? "", unit: "DAILY", paid: true, startDate: today, startTime: "", endDate: today, endTime: "", reason: "", comment: "", submit: true };
  return (
    <EntityDialog
      wide title={timeOff ? "Modifier le brouillon" : "Demande de permission"} description="La durée est calculée par le serveur ; la permission est ensuite validée par un approbateur (module Validations)."
      fields={fields} initial={initial} success={timeOff ? "Brouillon modifié" : "Permission enregistrée"}
      trigger={timeOff ? <EditBtn label="Modifier" text="Modifier" /> : <AddBtn label="Demander une permission" />}
      onSubmit={(v) => (timeOff ? updateTimeOffAction(p(v, { id: timeOff.id, paid: bool(v.paid) })) : createTimeOffAction(p(v, { paid: bool(v.paid), submit: bool(v.submit), ...(employees.length <= 1 ? { employeeId: employees[0]?.value ?? "" } : {}) })))}
    />
  );
}

export interface TimeOffTypeRow { id: string; name: string; paid: boolean; requiresProof: boolean; maxDays: number | null; isActive: boolean }
export function TimeOffTypeDialog({ type }: { type?: TimeOffTypeRow }) {
  const fields: FieldSpec[] = [
    { name: "name", label: "Nom", required: true, wide: true }, { name: "paid", label: "Rémunérée par défaut", kind: "switch" }, { name: "requiresProof", label: "Justificatif attendu", kind: "switch" },
    { name: "maxDays", label: "Plafond (jours par demande)", kind: "number", hint: "Facultatif. À fixer selon la convention applicable à l'entreprise." },
    ...(type ? [{ name: "isActive", label: "Actif", kind: "switch" as const }] : []),
  ];
  const initial: Values = type ? { name: type.name, paid: type.paid, requiresProof: type.requiresProof, maxDays: str(type.maxDays), isActive: type.isActive } : { name: "", paid: true, requiresProof: false, maxDays: "" };
  return (
    <EntityDialog
      title={type ? `Type « ${type.name} »` : "Nouveau type de permission"} fields={fields} initial={initial} success="Type enregistré"
      trigger={type ? <EditBtn label={`Modifier ${type.name}`} /> : <Button size="sm" variant="outline"><Plus className="size-4" /> Nouveau type</Button>}
      onSubmit={(v) => (type ? updateTimeOffTypeAction(p(v, { id: type.id, paid: bool(v.paid), requiresProof: bool(v.requiresProof), isActive: bool(v.isActive) })) : createTimeOffTypeAction(p(v, { paid: bool(v.paid), requiresProof: bool(v.requiresProof) })))}
    />
  );
}

// ── Absences ───────────────────────────────────────────────────

export function AbsenceDialog({ employees, types, absence }: { employees: Opt[]; types: Opt[]; absence?: { id: string; typeId: string; startDate: Date; endDate: Date; halfDay: boolean; reason: string | null } }) {
  const fields: FieldSpec[] = [
    ...(!absence ? [{ name: "employeeId", label: "Salarié", kind: "select" as const, required: true, options: employees, wide: true }] : []),
    { name: "typeId", label: "Motif", kind: "select", required: true, options: types, wide: true },
    { name: "startDate", label: "Du", kind: "date", required: true }, { name: "endDate", label: "Au (inclus)", kind: "date", required: true },
    { name: "halfDay", label: "Demi-journée (une seule date)", kind: "switch" }, { name: "reason", label: "Observation", kind: "textarea" },
  ];
  const today = new Date().toISOString().slice(0, 10);
  const initial: Values = absence
    ? { typeId: absence.typeId, startDate: dateIn(absence.startDate), endDate: dateIn(absence.endDate), halfDay: absence.halfDay, reason: str(absence.reason) }
    : { employeeId: employees[0]?.value ?? "", typeId: types[0]?.value ?? "", startDate: today, endDate: today, halfDay: false, reason: "" };
  return (
    <EntityDialog
      wide title={absence ? "Modifier l'absence" : "Enregistrer une absence"} description="Les jours ouvrés sont comptés automatiquement. Aucune retenue sur salaire n'est appliquée par cet enregistrement."
      fields={fields} initial={initial} success={absence ? "Absence modifiée" : "Absence enregistrée"}
      trigger={absence ? <EditBtn label="Modifier l'absence" /> : <AddBtn label="Enregistrer une absence" />}
      onSubmit={(v) => (absence ? updateAbsenceAction(p(v, { id: absence.id, halfDay: bool(v.halfDay) })) : createAbsenceAction(p(v, { halfDay: bool(v.halfDay) })))}
    />
  );
}

export interface AbsenceTypeRow { id: string; name: string; category: string; requiresValidation: boolean; requiresProof: boolean; deductFromPay: boolean; isActive: boolean }
export function AbsenceTypeDialog({ type }: { type?: AbsenceTypeRow }) {
  const fields: FieldSpec[] = [
    { name: "name", label: "Motif", required: true, wide: true }, { name: "category", label: "Catégorie", kind: "select", required: true, options: opts(ABSENCE_CATEGORIES) },
    { name: "requiresValidation", label: "Soumise à validation administrative", kind: "switch" }, { name: "requiresProof", label: "Justificatif attendu", kind: "switch" },
    { name: "deductFromPay", label: "Retenue sur salaire prévue (réservé à la paie)", kind: "switch", hint: "Règle à configurer et valider par l'entreprise ; effective seulement si la liaison RH → paie est activée." },
    ...(type ? [{ name: "isActive", label: "Actif", kind: "switch" as const }] : []),
  ];
  const initial: Values = type ? { name: type.name, category: type.category, requiresValidation: type.requiresValidation, requiresProof: type.requiresProof, deductFromPay: type.deductFromPay, isActive: type.isActive } : { name: "", category: "OTHER", requiresValidation: false, requiresProof: false, deductFromPay: false };
  return (
    <EntityDialog
      title={type ? `Motif « ${type.name} »` : "Nouveau motif d'absence"} fields={fields} initial={initial} success="Motif enregistré"
      trigger={type ? <EditBtn label={`Modifier ${type.name}`} /> : <Button size="sm" variant="outline"><Plus className="size-4" /> Nouveau motif</Button>}
      onSubmit={(v) => (type ? updateAbsenceTypeAction(p(v, { id: type.id, requiresValidation: bool(v.requiresValidation), requiresProof: bool(v.requiresProof), deductFromPay: bool(v.deductFromPay), isActive: bool(v.isActive) })) : createAbsenceTypeAction(p(v, { requiresValidation: bool(v.requiresValidation), requiresProof: bool(v.requiresProof), deductFromPay: bool(v.deductFromPay) })))}
    />
  );
}

export function JustifyDialog({ kind, id, current, note }: { kind: "absence" | "lateness"; id: string; current: string; note: string | null }) {
  const options = opts(JUSTIFICATIONS).filter((o) => kind === "absence" || o.value !== "NOT_REQUIRED");
  return (
    <EntityDialog
      title="Justificatif" description="Statut de justification et observation de la RH." success="Justification enregistrée"
      fields={[{ name: "justification", label: "Statut", kind: "select", required: true, options }, { name: "hrNote", label: "Observation RH", kind: "textarea" }]}
      initial={{ justification: current, hrNote: str(note) }}
      trigger={<Button size="icon" variant="ghost" aria-label="Justifier"><FileCheck2 className="size-4" /></Button>}
      onSubmit={(v) => (kind === "absence" ? justifyAbsenceAction(p(v, { id })) : justifyLatenessAction(p(v, { id })))}
    />
  );
}

// ── Retards ────────────────────────────────────────────────────

export function LatenessDialog({ employees, defaultExpected, lateness }: { employees: Opt[]; defaultExpected: string; lateness?: { id: string; expectedTime: string; actualTime: string; reason: string | null } }) {
  const fields: FieldSpec[] = [
    ...(!lateness ? [{ name: "employeeId", label: "Salarié", kind: "select" as const, required: true, options: employees, wide: true }, { name: "date", label: "Date", kind: "date" as const, required: true }] : []),
    { name: "expectedTime", label: "Heure prévue", kind: "time", hint: `Horaire de référence : ${defaultExpected}.` }, { name: "actualTime", label: "Heure d'arrivée", kind: "time", required: true },
    { name: "reason", label: "Motif", kind: "textarea" },
  ];
  const initial: Values = lateness ? { expectedTime: lateness.expectedTime, actualTime: lateness.actualTime, reason: str(lateness.reason) } : { employeeId: employees[0]?.value ?? "", date: new Date().toISOString().slice(0, 10), expectedTime: defaultExpected, actualTime: "", reason: "" };
  return (
    <EntityDialog
      title={lateness ? "Corriger le retard" : "Enregistrer un retard"} description="La durée du retard est calculée automatiquement." fields={fields} initial={initial} success={lateness ? "Retard corrigé" : "Retard enregistré"}
      trigger={lateness ? <EditBtn label="Corriger" /> : <AddBtn label="Enregistrer un retard" />}
      onSubmit={(v) => (lateness ? updateLatenessAction(p(v, { id: lateness.id })) : createLatenessAction(p(v)))}
    />
  );
}

export function ImportLatenessDialog() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  return (
    <EntityDialog
      title="Importer depuis les présences" description="Crée les retards des pointages dont l'arrivée dépasse l'horaire de référence. Les retards déjà enregistrés ne sont jamais modifiés."
      fields={[{ name: "from", label: "Du", kind: "date", required: true }, { name: "to", label: "Au", kind: "date", required: true }]} initial={{ from: monthStart, to: today }} submitLabel="Importer" success="Import terminé"
      trigger={<Button variant="outline"><Download className="size-4" /> Importer des présences</Button>}
      onSubmit={(v) => importLatenessAction(p(v))}
    />
  );
}

// ── Paramètres RH ──────────────────────────────────────────────

export interface PolicyForm { workStartTime: string; workEndTime: string; breakStartTime: string | null; breakEndTime: string | null; lateGraceMinutes: number; lateRecurrenceCount: number; lateRecurrenceDays: number; absenceRepeatCount: number; absenceRepeatDays: number; accidentDeclarationDays: number | null; sickReturnAlertDays: number; visitReminderDays: number; equipmentAlertDays: number }

export function PolicyDialog({ policy }: { policy: PolicyForm }) {
  const fields: FieldSpec[] = [
    { name: "workStartTime", label: "Début de journée", kind: "time", required: true }, { name: "workEndTime", label: "Fin de journée", kind: "time", required: true },
    { name: "breakStartTime", label: "Début de pause", kind: "time", hint: "Facultatif (non décomptée des permissions horaires)." }, { name: "breakEndTime", label: "Fin de pause", kind: "time" },
    { name: "lateGraceMinutes", label: "Tolérance de retard (min)", kind: "number", step: "1", required: true },
    { name: "lateRecurrenceCount", label: "Retards récurrents : au moins", kind: "number", step: "1", required: true }, { name: "lateRecurrenceDays", label: "… sur les derniers (jours)", kind: "number", step: "1", required: true },
    { name: "absenceRepeatCount", label: "Absences répétées : au moins", kind: "number", step: "1", required: true }, { name: "absenceRepeatDays", label: "… sur les derniers (jours)", kind: "number", step: "1", required: true },
    { name: "sickReturnAlertDays", label: "Alerte de reprise d'un arrêt maladie (jours avant la fin prévue)", kind: "number", step: "1", wide: true },
    { name: "visitReminderDays", label: "Rappel des visites médicales (jours avant)", kind: "number", step: "1" }, { name: "equipmentAlertDays", label: "Rappel de remplacement d'équipement (jours avant)", kind: "number", step: "1" },
    { name: "accidentDeclarationDays", label: "Délai d'alerte de déclaration d'accident (jours)", kind: "number", step: "1", wide: true, hint: "Laissez vide pour désactiver l'alerte. Valeur à confirmer avec votre conseil juridique : aucun délai réglementaire n'est présumé par le logiciel." },
  ];
  const initial: Values = { workStartTime: policy.workStartTime, workEndTime: policy.workEndTime, breakStartTime: str(policy.breakStartTime), breakEndTime: str(policy.breakEndTime), lateGraceMinutes: str(policy.lateGraceMinutes), lateRecurrenceCount: str(policy.lateRecurrenceCount), lateRecurrenceDays: str(policy.lateRecurrenceDays), absenceRepeatCount: str(policy.absenceRepeatCount), absenceRepeatDays: str(policy.absenceRepeatDays), accidentDeclarationDays: str(policy.accidentDeclarationDays), sickReturnAlertDays: str(policy.sickReturnAlertDays), visitReminderDays: str(policy.visitReminderDays), equipmentAlertDays: str(policy.equipmentAlertDays) };
  return (
    <EntityDialog
      wide title="Paramètres RH" description="Horaire de référence, tolérance et seuils de détection. Ils servent au calcul des retards et des permissions horaires, et aux alertes — jamais à une sanction automatique."
      fields={fields} initial={initial} success="Paramètres enregistrés"
      trigger={<Button variant="outline"><Settings2 className="size-4" /> Paramètres</Button>}
      onSubmit={(v) => saveHrPolicyAction(p(v))}
    />
  );
}

// ── Arrêts maladie ─────────────────────────────────────────────

export interface SickForm { id: string; startDate: Date; expectedEndDate: Date; certificate: string; observations: string | null }

export function SickLeaveDialog({ employees, sick }: { employees?: Opt[]; sick?: SickForm }) {
  const fields: FieldSpec[] = [
    ...(!sick ? [{ name: "employeeId", label: "Salarié", kind: "select" as const, required: true, options: employees ?? [], wide: true }] : []),
    { name: "startDate", label: "Premier jour d'arrêt", kind: "date", required: true }, { name: "expectedEndDate", label: "Fin prévue (dernier jour)", kind: "date", required: true },
    { name: "certificate", label: "Justificatif médical", kind: "select", required: true, options: opts(CERTIFICATE_STATUSES), hint: "Seul le statut est suivi ici ; joignez le document depuis la fiche (accès restreint)." },
    { name: "observations", label: "Observations administratives", kind: "textarea", hint: "Aucun diagnostic ni information médicale." },
  ];
  const today = new Date().toISOString().slice(0, 10);
  const initial: Values = sick
    ? { startDate: dateIn(sick.startDate), expectedEndDate: dateIn(sick.expectedEndDate), certificate: sick.certificate, observations: str(sick.observations) }
    : { employeeId: employees?.[0]?.value ?? "", startDate: today, expectedEndDate: today, certificate: "PENDING", observations: "" };
  return (
    <EntityDialog
      wide title={sick ? "Modifier l'arrêt" : "Enregistrer un arrêt maladie"} description="Suivi administratif : n'indiquez aucune information médicale détaillée."
      fields={fields} initial={initial} success={sick ? "Arrêt modifié" : "Arrêt enregistré"}
      trigger={sick ? <EditBtn label="Modifier" text="Modifier" /> : <AddBtn label="Enregistrer un arrêt" />}
      onSubmit={(v) => (sick ? updateSickLeaveAction(p(v, { id: sick.id })) : createSickLeaveAction(p(v)))}
    />
  );
}

export function ExtendSickDialog({ id, currentEnd }: { id: string; currentEnd: Date }) {
  return (
    <EntityDialog
      title="Prolonger l'arrêt" description={`Fin prévue actuelle : ${dateIn(currentEnd)}. L'ancienne fin reste dans l'historique.`} success="Arrêt prolongé" submitLabel="Prolonger"
      fields={[{ name: "newEnd", label: "Nouvelle fin prévue", kind: "date", required: true }, { name: "note", label: "Note administrative", kind: "textarea" }]}
      initial={{ newEnd: "", note: "" }} trigger={<Button size="sm" variant="outline">Prolonger</Button>}
      onSubmit={(v) => extendSickLeaveAction(p(v, { id }))}
    />
  );
}

export function ReturnSickDialog({ id, expectedEnd }: { id: string; expectedEnd: Date }) {
  const next = new Date(expectedEnd.getTime() + 86_400_000).toISOString().slice(0, 10);
  return (
    <EntityDialog
      title="Enregistrer la reprise" description="Premier jour de travail effectif après l'arrêt. Cela termine l'arrêt." success="Reprise enregistrée" submitLabel="Enregistrer la reprise"
      fields={[{ name: "returnDate", label: "Date de reprise", kind: "date", required: true }]} initial={{ returnDate: next }}
      trigger={<Button size="sm" variant="outline">Reprise</Button>}
      onSubmit={(v) => returnSickLeaveAction(p(v, { id }))}
    />
  );
}

// ── Affectation ────────────────────────────────────────────────

export function AssignmentDialog({ employeeId, current, departments, branches, managers }: {
  employeeId: string; current: { jobTitle: string | null; departmentId: string | null; branchId: string | null; managerId: string | null }; departments: Opt[]; branches: Opt[]; managers: Opt[];
}) {
  return (
    <EntityDialog
      wide title="Changer l'affectation" description="Met à jour la fiche et conserve la trace datée (poste, service, agence, responsable)." success="Affectation enregistrée"
      fields={[
        { name: "effectiveDate", label: "Date d'effet", kind: "date", required: true }, { name: "jobTitle", label: "Poste" },
        { name: "departmentId", label: "Service", kind: "select", options: departments, emptyLabel: "— Aucun —" }, { name: "branchId", label: "Agence", kind: "select", options: branches, emptyLabel: "— Aucune —" },
        { name: "managerId", label: "Responsable hiérarchique", kind: "select", options: managers, emptyLabel: "— Aucun —", wide: true }, { name: "reason", label: "Motif", kind: "textarea" },
      ]}
      initial={{ effectiveDate: new Date().toISOString().slice(0, 10), jobTitle: str(current.jobTitle), departmentId: str(current.departmentId), branchId: str(current.branchId), managerId: str(current.managerId), reason: "" }}
      trigger={<Button size="sm" variant="outline"><Pencil className="size-4" /> Changer l'affectation</Button>}
      onSubmit={(v) => changeAssignmentAction(p(v, { employeeId }))}
    />
  );
}
