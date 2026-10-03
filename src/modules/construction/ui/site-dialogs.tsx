"use client";

import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityDialog, type FieldSpec, type Values } from "@/components/app/entity-dialog";
import { addEquipmentAction, addMemberAction, addSubcontractAction, createSiteAction, moveMaterialAction, saveReportAction, setBudgetAction, setMaterialPlanAction, updateSiteAction, updateSubcontractAction } from "../actions";
import { BUDGET_CATEGORIES, SITE_STATUSES, SUBCONTRACT_STATUSES } from "../schemas";

interface Opt { id: string; name: string }
const opts = (xs: Opt[]) => xs.map((x) => ({ value: x.id, label: x.name }));
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const dateIn = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);
const p = (v: Values, extra: Record<string, unknown> = {}) => ({ ...v, ...extra }) as never;
const AddBtn = ({ label }: { label: string }) => <Button size="sm"><Plus className="size-4" /> {label}</Button>;

export interface SiteRow { id: string; name: string; customerId: string | null; address: string | null; city: string | null; managerId: string | null; status: string; startDate: Date | null; endDate: Date | null; description: string | null }

export function SiteDialog({ site, customers, employees }: { site?: SiteRow; customers: Opt[]; employees: Opt[] }) {
  const fields: FieldSpec[] = [
    { name: "name", label: "Nom du chantier", required: true, wide: true },
    ...(customers.length ? [{ name: "customerId", label: "Client / maître d'ouvrage", kind: "select" as const, options: opts(customers), emptyLabel: "— Aucun —" }] : []),
    ...(employees.length ? [{ name: "managerId", label: "Responsable de chantier", kind: "select" as const, options: opts(employees), emptyLabel: "— Aucun —" }] : []),
    { name: "address", label: "Adresse", wide: true }, { name: "city", label: "Ville" },
    ...(site ? [{ name: "status", label: "Statut", kind: "select" as const, required: true, options: SITE_STATUSES.map((s) => ({ value: s.value, label: s.label })) }] : []),
    { name: "startDate", label: "Début", kind: "date" }, { name: "endDate", label: "Fin prévue", kind: "date" },
    { name: "description", label: "Description", kind: "textarea" },
  ];
  const initial: Values = site
    ? { name: site.name, customerId: str(site.customerId), managerId: str(site.managerId), address: str(site.address), city: str(site.city), status: site.status, startDate: dateIn(site.startDate), endDate: dateIn(site.endDate), description: str(site.description) }
    : { name: "", customerId: "", managerId: "", address: "", city: "", startDate: "", endDate: "", description: "" };
  return <EntityDialog wide title={site ? "Modifier le chantier" : "Nouveau chantier"} description={site ? undefined : "Un projet est créé automatiquement : dépenses, factures et temps passé rattachés à ce projet alimentent le chantier."} fields={fields} initial={initial} trigger={site ? <Button size="sm" variant="outline"><Pencil className="size-4" /> Modifier</Button> : <AddBtn label="Nouveau chantier" />} success={site ? "Chantier mis à jour" : "Chantier créé"} onSubmit={(v) => (site ? updateSiteAction(p(v, { id: site.id })) : createSiteAction(p(v)))} />;
}

export function BudgetDialog({ siteId, budget }: { siteId: string; budget: Record<string, number> }) {
  const fields: FieldSpec[] = BUDGET_CATEGORIES.map((c) => ({ name: c.value, label: c.label, kind: "number" as const }));
  const initial: Values = Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c.value, String(budget[c.value] ?? 0)]));
  return <EntityDialog title="Budget du chantier" description="Montants prévus par catégorie. Leur total devient le budget du projet associé." fields={fields} initial={initial} trigger={<Button size="sm" variant="outline"><Pencil className="size-4" /> Budget</Button>} success="Budget enregistré" onSubmit={(v) => setBudgetAction({ siteId, lines: BUDGET_CATEGORIES.map((c) => ({ category: c.value, amount: Number(v[c.value] || 0) })) } as never)} />;
}

export function MemberDialog({ siteId, employees }: { siteId: string; employees: Opt[] }) {
  const fields: FieldSpec[] = [{ name: "employeeId", label: "Salarié", kind: "select", required: true, options: opts(employees) }, { name: "role", label: "Rôle sur le chantier", placeholder: "Chef d'équipe, maçon…" }, { name: "startDate", label: "À partir du", kind: "date", required: true }];
  return <EntityDialog title="Affecter un salarié" fields={fields} initial={{ employeeId: "", role: "", startDate: today() }} trigger={<AddBtn label="Affecter" />} success="Salarié affecté" onSubmit={(v) => addMemberAction(p(v, { siteId }))} />;
}

export function EquipmentDialog({ siteId, vehicles }: { siteId: string; vehicles: Opt[] }) {
  const fields: FieldSpec[] = [
    ...(vehicles.length ? [{ name: "vehicleId", label: "Engin ou véhicule de la flotte", kind: "select" as const, options: opts(vehicles), emptyLabel: "— Matériel libre (location…) —", wide: true }] : []),
    { name: "name", label: "Désignation", required: true, placeholder: "Pelleteuse, bétonnière…" }, { name: "dailyRate", label: "Coût journalier imputé", kind: "number" }, { name: "startDate", label: "À partir du", kind: "date", required: true },
  ];
  return <EntityDialog title="Matériel et engins" description="Le coût journalier est imputé au chantier du début à la libération." fields={fields} initial={{ vehicleId: "", name: "", dailyRate: "0", startDate: today() }} trigger={<AddBtn label="Matériel" />} success="Matériel affecté" onSubmit={(v) => addEquipmentAction(p(v, { siteId }))} />;
}

export function PlanDialog({ siteId, products }: { siteId: string; products: Opt[] }) {
  const fields: FieldSpec[] = [{ name: "productId", label: "Produit", kind: "select", required: true, options: opts(products) }, { name: "plannedQty", label: "Quantité prévue", kind: "number", required: true }];
  return <EntityDialog title="Matériaux prévus" fields={fields} initial={{ productId: "", plannedQty: "" }} trigger={<Button size="sm" variant="outline"><Plus className="size-4" /> Prévoir</Button>} success="Prévision enregistrée" onSubmit={(v) => setMaterialPlanAction(p(v, { siteId }))} />;
}

export function MaterialDialog({ siteId, products, warehouses }: { siteId: string; products: Opt[]; warehouses: Opt[] }) {
  const fields: FieldSpec[] = [
    { name: "type", label: "Mouvement", kind: "select", required: true, options: [{ value: "ISSUE", label: "Sortie du stock vers le chantier" }, { value: "RETURN", label: "Retour au stock" }], wide: true },
    { name: "productId", label: "Produit", kind: "select", required: true, options: opts(products) }, { name: "warehouseId", label: "Entrepôt", kind: "select", required: true, options: opts(warehouses) },
    { name: "quantity", label: "Quantité", kind: "number", required: true }, { name: "date", label: "Date", kind: "date", required: true }, { name: "note", label: "Note", wide: true },
  ];
  return <EntityDialog wide title="Sortie ou retour de matériaux" description="Crée un vrai mouvement de stock ; le coût imputé au chantier est le coût moyen du moment." fields={fields} initial={{ type: "ISSUE", productId: "", warehouseId: warehouses[0]?.id ?? "", quantity: "", date: today(), note: "" }} trigger={<AddBtn label="Mouvement" />} success="Mouvement enregistré" onSubmit={(v) => moveMaterialAction(p(v, { siteId }))} />;
}

export interface SubcontractRow { id: string; scope: string; contractAmount: number; status: string; startDate: Date | null; endDate: Date | null }

export function SubcontractDialog({ siteId, suppliers, row }: { siteId: string; suppliers: Opt[]; row?: SubcontractRow }) {
  const fields: FieldSpec[] = [
    ...(row ? [] : [{ name: "supplierId", label: "Sous-traitant (fournisseur)", kind: "select" as const, required: true, options: opts(suppliers), wide: true }]),
    { name: "scope", label: "Périmètre des travaux", required: true, wide: true }, { name: "contractAmount", label: "Montant du marché", kind: "number" },
    ...(row ? [{ name: "status", label: "Statut", kind: "select" as const, required: true, options: SUBCONTRACT_STATUSES.map((s) => ({ value: s.value, label: s.label })) }] : []),
    { name: "startDate", label: "Début", kind: "date" }, { name: "endDate", label: "Fin", kind: "date" },
  ];
  const initial: Values = row ? { scope: row.scope, contractAmount: String(row.contractAmount), status: row.status, startDate: dateIn(row.startDate), endDate: dateIn(row.endDate) } : { supplierId: "", scope: "", contractAmount: "0", startDate: "", endDate: "" };
  return <EntityDialog wide title={row ? "Modifier la sous-traitance" : "Ajouter un sous-traitant"} description={row ? undefined : "Ses factures rattachées au projet du chantier donnent le montant facturé."} fields={fields} initial={initial} trigger={row ? <Button size="icon" variant="ghost" aria-label="Modifier la sous-traitance"><Pencil className="size-4" /></Button> : <AddBtn label="Sous-traitant" />} success="Sous-traitance enregistrée" onSubmit={(v) => (row ? updateSubcontractAction(p(v, { id: row.id })) : addSubcontractAction(p(v, { siteId })))} />;
}

export function ReportDialog({ siteId, lastProgress }: { siteId: string; lastProgress: number }) {
  const fields: FieldSpec[] = [
    { name: "date", label: "Date", kind: "date", required: true }, { name: "progress", label: "Avancement global (%)", kind: "number", step: "1", required: true },
    { name: "weather", label: "Météo" }, { name: "workforce", label: "Effectif présent", kind: "number", step: "1" },
    { name: "summary", label: "Travaux réalisés", kind: "textarea", required: true }, { name: "incidents", label: "Incidents, retards, sécurité", kind: "textarea" },
  ];
  return <EntityDialog wide title="Rapport terrain" description="Un rapport par jour : en saisir un second le même jour met à jour le premier. Joignez ensuite les photos depuis la liste des rapports." fields={fields} initial={{ date: today(), progress: String(lastProgress), weather: "", workforce: "0", summary: "", incidents: "" }} trigger={<AddBtn label="Rapport du jour" />} success="Rapport enregistré" onSubmit={(v) => saveReportAction(p(v, { siteId }))} />;
}
