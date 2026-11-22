"use client";

import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityDialog, type FieldSpec, type Values } from "@/components/app/entity-dialog";
import { ADVANCE_KINDS, CONDITIONS, STEP_KINDS, VISIT_KINDS } from "../admin-schemas";
import {
  addStepAction, assignOvertimeRateAction, cancelCaseAction, closeCaseAction, completeVisitAction, createAdvanceAction, createCaseAction, createOvertimeAction, createOvertimeRateAction, createSanctionTypeAction, createVisitAction,
  decideCaseAction, issueEquipmentAction, notifyCaseAction, recordRepaymentAction, returnEquipmentAction, updateAdvanceAction, updateCaseAction, updateOvertimeAction, updateOvertimeRateAction, updateSanctionTypeAction, updateVisitAction,
} from "../registers-actions";

export interface Opt { value: string; label: string }
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const dateIn = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);
const p = (v: Values, extra: Record<string, unknown> = {}) => ({ ...v, ...extra }) as never;
const opts = (xs: readonly { value: string; label: string }[]) => xs.map((x) => ({ value: x.value, label: x.label }));
const bool = (v: unknown) => v === true || v === "true";
type BtnProps = React.ComponentProps<typeof Button>;
// Les déclencheurs de fenêtre doivent transmettre les propriétés reçues (onClick, aria-*…), sinon la fenêtre ne s'ouvre pas.
const AddBtn = ({ label, ...props }: { label: string } & BtnProps) => <Button {...props}><Plus className="size-4" /> {label}</Button>;
const EditBtn = ({ label, text, ...props }: { label: string; text?: string } & BtnProps) => <Button size={text ? "sm" : "icon"} variant="ghost" aria-label={label} {...props}><Pencil className="size-4" />{text}</Button>;
const SmallBtn = ({ children, ...props }: BtnProps) => <Button size="sm" variant="outline" {...props}>{children}</Button>;

// ── Heures supplémentaires ─────────────────────────────────────

export function OvertimeDialog({ employees, rates, defaultEmployeeId, canRate, overtime }: { employees: Opt[]; rates: Opt[]; defaultEmployeeId?: string; canRate: boolean; overtime?: { id: string; date: Date; startTime: string; endTime: string; rateId: string | null; reason: string } }) {
  const fields: FieldSpec[] = [
    ...(!overtime && employees.length > 1 ? [{ name: "employeeId", label: "Salarié", kind: "select" as const, required: true, options: employees, wide: true }] : []),
    { name: "date", label: "Date", kind: "date", required: true, wide: true },
    { name: "startTime", label: "De", kind: "time", required: true }, { name: "endTime", label: "À", kind: "time", required: true, hint: "Hors horaire normal, même journée." },
    ...(canRate ? [{ name: "rateId", label: "Taux de majoration", kind: "select" as const, options: rates, emptyLabel: "— À définir —", wide: true }] : []),
    { name: "reason", label: "Motif", kind: "textarea", required: true },
    ...(!overtime ? [{ name: "submit", label: "Soumettre immédiatement à validation", kind: "switch" as const }] : []),
  ];
  const initial: Values = overtime
    ? { date: dateIn(overtime.date), startTime: overtime.startTime, endTime: overtime.endTime, rateId: str(overtime.rateId), reason: overtime.reason }
    : { employeeId: defaultEmployeeId ?? employees[0]?.value ?? "", date: today(), startTime: "18:00", endTime: "20:00", rateId: "", reason: "", submit: true };
  return (
    <EntityDialog
      wide title={overtime ? "Modifier le brouillon" : "Heures supplémentaires"} description="La durée est calculée par le serveur ; la déclaration est validée par un approbateur (module Validations)."
      fields={fields} initial={initial} success={overtime ? "Brouillon modifié" : "Heures enregistrées"}
      trigger={overtime ? <EditBtn label="Modifier" text="Modifier" /> : <AddBtn label="Déclarer des heures" />}
      onSubmit={(v) => (overtime ? updateOvertimeAction(p(v, { id: overtime.id })) : createOvertimeAction(p(v, { submit: bool(v.submit), ...(employees.length <= 1 ? { employeeId: employees[0]?.value ?? "" } : {}) })))}
    />
  );
}

export function OvertimeRateDialog({ rate }: { rate?: { id: string; name: string; multiplier: number; description: string | null; isActive: boolean } }) {
  const fields: FieldSpec[] = [
    { name: "name", label: "Nom", required: true, wide: true }, { name: "multiplier", label: "Coefficient (ex. 1,25)", kind: "number", step: "0.01", required: true, hint: "Fixé par l'entreprise selon la convention et la réglementation applicables : aucun taux n'est préchargé." },
    { name: "description", label: "Description", wide: true }, ...(rate ? [{ name: "isActive", label: "Actif", kind: "switch" as const }] : []),
  ];
  return (
    <EntityDialog
      title={rate ? `Taux « ${rate.name} »` : "Nouveau taux de majoration"} fields={fields} success="Taux enregistré"
      initial={rate ? { name: rate.name, multiplier: str(rate.multiplier), description: str(rate.description), isActive: rate.isActive } : { name: "", multiplier: "", description: "" }}
      trigger={rate ? <EditBtn label={`Modifier ${rate.name}`} /> : <SmallBtn><Plus className="size-4" /> Nouveau taux</SmallBtn>}
      onSubmit={(v) => (rate ? updateOvertimeRateAction(p(v, { id: rate.id, isActive: bool(v.isActive) })) : createOvertimeRateAction(p(v)))}
    />
  );
}

export function AssignRateDialog({ id, rates, current }: { id: string; rates: Opt[]; current: string | null }) {
  return (
    <EntityDialog
      title="Taux de majoration" description="Affectation par la RH (tracée)." success="Taux affecté" fields={[{ name: "rateId", label: "Taux", kind: "select", required: true, options: rates }]} initial={{ rateId: str(current) }}
      trigger={<Button size="sm" variant="ghost">Taux</Button>} onSubmit={(v) => assignOvertimeRateAction(p(v, { id }))}
    />
  );
}

// ── Avances et acomptes ────────────────────────────────────────

export function AdvanceDialog({ employees, defaultEmployeeId, currency, advance }: { employees: Opt[]; defaultEmployeeId?: string; currency: string; advance?: { id: string; kind: string; amount: number; requestDate: Date; reason: string | null; installments: number; firstDeductionMonth: Date } }) {
  const fields: FieldSpec[] = [
    ...(!advance && employees.length > 1 ? [{ name: "employeeId", label: "Salarié", kind: "select" as const, required: true, options: employees, wide: true }] : []),
    { name: "kind", label: "Nature", kind: "select", required: true, options: opts(ADVANCE_KINDS) }, { name: "amount", label: `Montant (${currency})`, kind: "number", required: true },
    { name: "requestDate", label: "Date de la demande", kind: "date", required: true }, { name: "installments", label: "Mensualités de régularisation", kind: "number", step: "1", required: true },
    { name: "firstDeductionMonth", label: "Premier mois de retenue", kind: "date", required: true, wide: true, hint: "Jour quelconque du mois ; la retenue sur bulletin relève du module Paie." },
    { name: "reason", label: "Motif (facultatif)", kind: "textarea" },
    ...(!advance ? [{ name: "submit", label: "Soumettre immédiatement à validation", kind: "switch" as const }] : []),
  ];
  const initial: Values = advance
    ? { kind: advance.kind, amount: str(advance.amount), requestDate: dateIn(advance.requestDate), installments: str(advance.installments), firstDeductionMonth: dateIn(advance.firstDeductionMonth), reason: str(advance.reason) }
    : { employeeId: defaultEmployeeId ?? employees[0]?.value ?? "", kind: "ADVANCE", amount: "", requestDate: today(), installments: "1", firstDeductionMonth: today(), reason: "", submit: true };
  return (
    <EntityDialog
      wide title={advance ? "Modifier le brouillon" : "Demande d'avance ou d'acompte"} description="Validée par un approbateur (module Validations) ; jamais d'auto-validation."
      fields={fields} initial={initial} success={advance ? "Brouillon modifié" : "Demande enregistrée"}
      trigger={advance ? <EditBtn label="Modifier" text="Modifier" /> : <AddBtn label="Demander une avance" />}
      onSubmit={(v) => (advance ? updateAdvanceAction(p(v, { id: advance.id })) : createAdvanceAction(p(v, { submit: bool(v.submit), ...(employees.length <= 1 ? { employeeId: employees[0]?.value ?? "" } : {}) })))}
    />
  );
}

export function RepaymentDialog({ advanceId, balance }: { advanceId: string; balance: number }) {
  return (
    <EntityDialog
      title="Enregistrer un remboursement" description={`Reste à régulariser : ${balance}.`} success="Remboursement enregistré"
      fields={[{ name: "date", label: "Date", kind: "date", required: true }, { name: "amount", label: "Montant", kind: "number", required: true }, { name: "note", label: "Note", kind: "textarea" }]}
      initial={{ date: today(), amount: str(balance), note: "" }} trigger={<SmallBtn>Remboursement</SmallBtn>} onSubmit={(v) => recordRepaymentAction(p(v, { advanceId }))}
    />
  );
}

// ── Sanctions disciplinaires ───────────────────────────────────

export function CaseDialog({ employees, c }: { employees?: Opt[]; c?: { id: string; factsDate: Date; description: string; breachNature: string; procedureNote: string | null; responsibleName: string | null; observations: string | null } }) {
  const fields: FieldSpec[] = [
    ...(!c ? [{ name: "employeeId", label: "Salarié", kind: "select" as const, required: true, options: employees ?? [], wide: true }] : []),
    { name: "factsDate", label: "Date des faits", kind: "date", required: true }, { name: "breachNature", label: "Nature du manquement", required: true },
    { name: "description", label: "Description des faits", kind: "textarea", required: true }, { name: "procedureNote", label: "Procédure suivie", kind: "textarea", hint: "Rappel de la procédure applicable (règlement intérieur, convention)." },
    { name: "responsibleName", label: "Responsable du dossier" }, { name: "observations", label: "Observations", kind: "textarea" },
  ];
  const initial: Values = c
    ? { factsDate: dateIn(c.factsDate), breachNature: c.breachNature, description: c.description, procedureNote: str(c.procedureNote), responsibleName: str(c.responsibleName), observations: str(c.observations) }
    : { employeeId: employees?.[0]?.value ?? "", factsDate: today(), breachNature: "", description: "", procedureNote: "", responsibleName: "", observations: "" };
  return (
    <EntityDialog
      wide title={c ? "Modifier le dossier" : "Ouvrir un dossier disciplinaire"} description="Confidentiel. Le logiciel ne propose ni ne prononce jamais de sanction : il suit la procédure."
      fields={fields} initial={initial} success={c ? "Dossier modifié" : "Dossier ouvert"}
      trigger={c ? <EditBtn label="Modifier" text="Modifier" /> : <AddBtn label="Ouvrir un dossier" />}
      onSubmit={(v) => (c ? updateCaseAction(p(v, { id: c.id })) : createCaseAction(p(v)))}
    />
  );
}

export function SanctionTypeDialog({ type }: { type?: { id: string; name: string; requiresHearing: boolean; description: string | null; isActive: boolean } }) {
  const fields: FieldSpec[] = [
    { name: "name", label: "Nom de la sanction", required: true, wide: true }, { name: "requiresHearing", label: "Audition préalable exigée avant la décision", kind: "switch" },
    { name: "description", label: "Description / référence au règlement intérieur", kind: "textarea" }, ...(type ? [{ name: "isActive", label: "Actif", kind: "switch" as const }] : []),
  ];
  return (
    <EntityDialog
      title={type ? `Type « ${type.name} »` : "Nouveau type de sanction"} description="À renseigner selon votre règlement intérieur et la procédure légale applicable : le logiciel n'en présume aucune." fields={fields} success="Type enregistré"
      initial={type ? { name: type.name, requiresHearing: type.requiresHearing, description: str(type.description), isActive: type.isActive } : { name: "", requiresHearing: true, description: "" }}
      trigger={type ? <EditBtn label={`Modifier ${type.name}`} /> : <SmallBtn><Plus className="size-4" /> Nouveau type</SmallBtn>}
      onSubmit={(v) => (type ? updateSanctionTypeAction(p(v, { id: type.id, requiresHearing: bool(v.requiresHearing), isActive: bool(v.isActive) })) : createSanctionTypeAction(p(v, { requiresHearing: bool(v.requiresHearing) })))}
    />
  );
}

export function StepDialog({ caseId }: { caseId: string }) {
  return (
    <EntityDialog
      title="Ajouter une étape" success="Étape ajoutée" description="Convocation, demande d'explications, audition… La décision et la notification ont leurs propres boutons."
      fields={[{ name: "kind", label: "Étape", kind: "select", required: true, options: opts(STEP_KINDS.filter((k) => k.value !== "DECISION" && k.value !== "NOTIFICATION")) }, { name: "date", label: "Date", kind: "date", required: true }, { name: "note", label: "Note", kind: "textarea" }]}
      initial={{ kind: "CONVOCATION", date: today(), note: "" }} trigger={<AddBtn label="Étape" size="sm" variant="outline" />} onSubmit={(v) => addStepAction(p(v, { caseId }))}
    />
  );
}

export function DecideDialog({ id, types }: { id: string; types: Opt[] }) {
  return (
    <EntityDialog
      title="Enregistrer la décision" description="Choisie par la personne habilitée parmi les types de sanction de l'entreprise." success="Décision enregistrée" submitLabel="Enregistrer la décision"
      fields={[{ name: "sanctionTypeId", label: "Sanction retenue", kind: "select", required: true, options: types }, { name: "decisionDate", label: "Date de la décision", kind: "date", required: true }, { name: "note", label: "Note", kind: "textarea" }]}
      initial={{ sanctionTypeId: "", decisionDate: today(), note: "" }} trigger={<SmallBtn>Décision</SmallBtn>} onSubmit={(v) => decideCaseAction(p(v, { id }))}
    />
  );
}

export function NotifyDialog({ id }: { id: string }) {
  return (
    <EntityDialog
      title="Notification de la sanction" success="Notification enregistrée" submitLabel="Enregistrer" fields={[{ name: "notificationDate", label: "Date de notification", kind: "date", required: true }]}
      initial={{ notificationDate: today() }} trigger={<SmallBtn>Notification</SmallBtn>} onSubmit={(v) => notifyCaseAction(p(v, { id }))}
    />
  );
}

export function CloseCaseDialog({ id, mode }: { id: string; mode: "close" | "cancel" }) {
  return (
    <EntityDialog
      title={mode === "close" ? "Classer sans suite" : "Annuler le dossier"} description="Le motif est obligatoire. Le dossier reste conservé." success={mode === "close" ? "Dossier classé" : "Dossier annulé"}
      fields={[{ name: "note", label: "Motif", kind: "textarea", required: true }]} initial={{ note: "" }} trigger={<Button size="sm" variant="ghost">{mode === "close" ? "Classer sans suite" : "Annuler"}</Button>}
      onSubmit={(v) => (mode === "close" ? closeCaseAction(p(v, { id })) : cancelCaseAction(p(v, { id })))}
    />
  );
}

// ── Visites médicales ──────────────────────────────────────────

export function VisitDialog({ employees, visit }: { employees: Opt[]; visit?: { id: string; kind: string; scheduledOn: Date | null; provider: string | null; notes: string | null } }) {
  const fields: FieldSpec[] = [
    ...(!visit ? [{ name: "employeeId", label: "Salarié", kind: "select" as const, required: true, options: employees, wide: true }] : []),
    { name: "kind", label: "Type de visite", kind: "select", required: true, options: opts(VISIT_KINDS) }, { name: "scheduledOn", label: "Date prévue", kind: "date", required: true },
    { name: "provider", label: "Organisme / service de santé au travail", wide: true }, { name: "notes", label: "Note administrative", kind: "textarea", hint: "Aucune information médicale." },
  ];
  const initial: Values = visit ? { kind: visit.kind, scheduledOn: dateIn(visit.scheduledOn), provider: str(visit.provider), notes: str(visit.notes) } : { employeeId: employees[0]?.value ?? "", kind: "PERIODIC", scheduledOn: today(), provider: "", notes: "" };
  return (
    <EntityDialog
      wide title={visit ? "Modifier la visite" : "Programmer une visite médicale"} fields={fields} initial={initial} success={visit ? "Visite modifiée" : "Visite programmée"}
      trigger={visit ? <EditBtn label="Modifier" /> : <AddBtn label="Programmer une visite" />}
      onSubmit={(v) => (visit ? updateVisitAction(p(v, { id: visit.id })) : createVisitAction(p(v)))}
    />
  );
}

export function CompleteVisitDialog({ id }: { id: string }) {
  return (
    <EntityDialog
      title="Visite réalisée" description="Aucun résultat médical n'est enregistré : seulement la date, la prochaine échéance et la réception du document d'aptitude." success="Visite enregistrée" submitLabel="Enregistrer"
      fields={[
        { name: "doneOn", label: "Date de réalisation", kind: "date", required: true }, { name: "nextDueOn", label: "Prochaine échéance", kind: "date", hint: "Selon la périodicité applicable à ce salarié." },
        { name: "aptitudeDoc", label: "Document d'aptitude", kind: "select", required: true, options: [{ value: "PENDING", label: "Attendu" }, { value: "PROVIDED", label: "Reçu" }, { value: "NOT_REQUIRED", label: "Sans objet" }] },
      ]}
      initial={{ doneOn: today(), nextDueOn: "", aptitudeDoc: "PENDING" }} trigger={<SmallBtn>Réalisée</SmallBtn>} onSubmit={(v) => completeVisitAction(p(v, { id }))}
    />
  );
}

// ── Équipements ────────────────────────────────────────────────

export function EquipmentDialog({ employees, products, warehouses }: { employees: Opt[]; products: Opt[]; warehouses: Opt[] }) {
  const stock = products.length > 0 && warehouses.length > 0;
  const fields: FieldSpec[] = [
    { name: "employeeId", label: "Salarié", kind: "select", required: true, options: employees, wide: true },
    { name: "name", label: "Équipement", required: true, placeholder: "Casque, gilet, chaussures…" }, { name: "reference", label: "Référence" },
    { name: "quantity", label: "Quantité", kind: "number", step: "1", required: true }, { name: "issuedOn", label: "Date de remise", kind: "date", required: true },
    { name: "condition", label: "État à la remise", kind: "select", required: true, options: opts(CONDITIONS) }, { name: "replaceOn", label: "Remplacement prévu le", kind: "date" },
    { name: "responsibleName", label: "Responsable de la remise" }, { name: "observations", label: "Observations", kind: "textarea" },
    ...(stock ? [{ name: "productId", label: "Produit en stock (facultatif)", kind: "select" as const, options: products, emptyLabel: "— Pas de sortie de stock —" }, { name: "warehouseId", label: "Entrepôt", kind: "select" as const, options: warehouses, emptyLabel: "—" }] : []),
  ];
  return (
    <EntityDialog
      wide title="Remettre un équipement" description="Si un produit est indiqué, une sortie de stock est enregistrée ; elle se rétablit à la restitution."
      fields={fields} success="Remise enregistrée" initial={{ employeeId: employees[0]?.value ?? "", name: "", reference: "", quantity: "1", issuedOn: today(), condition: "NEW", replaceOn: "", responsibleName: "", observations: "", productId: "", warehouseId: "" }}
      trigger={<AddBtn label="Remettre un équipement" />} onSubmit={(v) => issueEquipmentAction(p(v))}
    />
  );
}

export function ReturnEquipmentDialog({ id, hasStock }: { id: string; hasStock: boolean }) {
  return (
    <EntityDialog
      title="Restitution" success="Restitution enregistrée" submitLabel="Enregistrer"
      fields={[{ name: "returnedOn", label: "Date de restitution", kind: "date", required: true }, { name: "returnCondition", label: "État à la restitution", kind: "select", required: true, options: opts(CONDITIONS) }, ...(hasStock ? [{ name: "backToStock", label: "Remettre en stock", kind: "switch" as const }] : [])]}
      initial={{ returnedOn: today(), returnCondition: "GOOD", backToStock: hasStock }} trigger={<SmallBtn>Restitution</SmallBtn>} onSubmit={(v) => returnEquipmentAction(p(v, { id, backToStock: bool(v.backToStock) }))}
    />
  );
}
