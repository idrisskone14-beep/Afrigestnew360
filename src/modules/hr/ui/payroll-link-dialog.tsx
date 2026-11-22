"use client";

import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityDialog, type FieldSpec, type Values } from "@/components/app/entity-dialog";
import { savePayrollLinkAction } from "../payroll-actions";

export interface PayrollLinkForm { unpaidTimeOff: boolean; unpaidAbsences: boolean; overtime: boolean; advances: boolean; monthlyHours: number | null }
const bool = (v: unknown) => v === true || v === "true";

/** Réglage de la liaison RH → paie : chaque rubrique est désactivée tant que l'entreprise ne l'active pas. */
export function PayrollLinkDialog({ policy }: { policy: PayrollLinkForm }) {
  const fields: FieldSpec[] = [
    { name: "payrollUnpaidTimeOff", label: "Déduire les permissions non rémunérées validées (jours non payés)", kind: "switch", wide: true },
    { name: "payrollUnpaidAbsences", label: "Déduire les absences dont le motif est marqué « retenue sur salaire »", kind: "switch", wide: true },
    { name: "payrollOvertime", label: "Payer les heures supplémentaires validées (avec taux affecté)", kind: "switch", wide: true },
    { name: "payrollMonthlyHours", label: "Heures mensuelles de référence", kind: "number", wide: true, hint: "Taux horaire = salaire de base ÷ ces heures. À fixer avec votre conseil : aucune valeur n'est présumée." },
    { name: "payrollAdvances", label: "Retenir les avances et acomptes approuvés (mensualités)", kind: "switch", wide: true },
  ];
  const initial: Values = { payrollUnpaidTimeOff: policy.unpaidTimeOff, payrollUnpaidAbsences: policy.unpaidAbsences, payrollOvertime: policy.overtime, payrollMonthlyHours: policy.monthlyHours == null ? "" : String(policy.monthlyHours), payrollAdvances: policy.advances };
  return (
    <EntityDialog
      wide title="Éléments RH dans la paie" description="Rien n'est intégré par défaut. Chaque option s'applique au prochain calcul d'une campagne en brouillon ; les arrêts maladie ne sont jamais retenus."
      fields={fields} initial={initial} success="Réglages enregistrés"
      trigger={<Button variant="outline"><Link2 className="size-4" /> Éléments RH</Button>}
      onSubmit={(v) => savePayrollLinkAction({ payrollUnpaidTimeOff: bool(v.payrollUnpaidTimeOff), payrollUnpaidAbsences: bool(v.payrollUnpaidAbsences), payrollOvertime: bool(v.payrollOvertime), payrollAdvances: bool(v.payrollAdvances), payrollMonthlyHours: String(v.payrollMonthlyHours ?? "") as never })}
    />
  );
}
