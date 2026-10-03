"use client";

import { CircleDollarSign, Pencil, Play, Plus, Flag, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityDialog, type FieldSpec, type Values } from "@/components/app/entity-dialog";
import {
  addComplianceAction, addFuelAction, addMaintenanceAction, assignDriverAction, completeMaintenanceAction, createDriverAction, createFineAction, createTripAction, createVehicleAction, finishTripAction,
  setFineStatusAction, startTripAction, updateDriverAction, updateFineAction, updateMaintenanceAction, updateTripAction, updateVehicleAction,
} from "../actions";
import { COMPLIANCE_KINDS, FINE_STATUSES, FUEL_TYPES, MAINTENANCE_TYPES, VEHICLE_STATUSES, VEHICLE_TYPES } from "../schemas";

interface Opt { id: string; name: string }
const opts = (xs: Opt[]) => xs.map((x) => ({ value: x.id, label: x.name }));
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const dateIn = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : "");
const dtIn = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 16) : "");
const p = (v: Values, extra: Record<string, unknown> = {}) => ({ ...v, ...extra }) as never;

const AddBtn = ({ label }: { label: string }) => <Button size="sm"><Plus className="size-4" /> {label}</Button>;
const EditBtn = ({ label }: { label: string }) => <Button size="icon" variant="ghost" aria-label={label}><Pencil className="size-4" /></Button>;

// ── Véhicules ─────────────────────────────────────────────────

export interface VehicleRow { id: string; plate: string; name: string | null; type: string; brand: string | null; model: string | null; year: number | null; vin: string | null; fuelType: string; odometer: number; status: string; acquisitionDate: Date | null; acquisitionCost: number; branchId: string | null; costCenterId: string | null; notes: string | null }

export function VehicleDialog({ vehicle, branches, costCenters }: { vehicle?: VehicleRow; branches: Opt[]; costCenters: Opt[] }) {
  const fields: FieldSpec[] = [
    { name: "plate", label: "Immatriculation", required: true, placeholder: "CI-1234-AB-01" },
    { name: "name", label: "Appellation interne", placeholder: "Camion n°3" },
    { name: "type", label: "Type", kind: "select", required: true, options: VEHICLE_TYPES.map((t) => ({ value: t.value, label: t.label })) },
    { name: "fuelType", label: "Carburant", kind: "select", required: true, options: FUEL_TYPES.map((t) => ({ value: t.value, label: t.label })) },
    { name: "brand", label: "Marque" }, { name: "model", label: "Modèle" },
    { name: "year", label: "Année", kind: "number", step: "1" }, { name: "vin", label: "N° de châssis (VIN)" },
    { name: "odometer", label: "Kilométrage actuel", kind: "number", step: "1", required: true, hint: vehicle ? "Corrigez-le ici si le compteur a été remplacé (l'opération est tracée)." : undefined },
    ...(vehicle ? [{ name: "status", label: "Statut", kind: "select" as const, required: true, options: VEHICLE_STATUSES.map((t) => ({ value: t.value, label: t.label })) }] : []),
    { name: "acquisitionDate", label: "Date d'acquisition", kind: "date" }, { name: "acquisitionCost", label: "Coût d'acquisition", kind: "number" },
    { name: "branchId", label: "Agence", kind: "select", options: opts(branches), emptyLabel: "— Aucune —" },
    { name: "costCenterId", label: "Centre de coûts", kind: "select", options: opts(costCenters), emptyLabel: "— Aucun —" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const initial: Values = vehicle
    ? { plate: vehicle.plate, name: str(vehicle.name), type: vehicle.type, fuelType: vehicle.fuelType, brand: str(vehicle.brand), model: str(vehicle.model), year: str(vehicle.year), vin: str(vehicle.vin), odometer: str(vehicle.odometer), status: vehicle.status, acquisitionDate: dateIn(vehicle.acquisitionDate), acquisitionCost: str(vehicle.acquisitionCost), branchId: str(vehicle.branchId), costCenterId: str(vehicle.costCenterId), notes: str(vehicle.notes) }
    : { plate: "", name: "", type: "TRUCK", fuelType: "DIESEL", brand: "", model: "", year: "", vin: "", odometer: "0", acquisitionDate: "", acquisitionCost: "0", branchId: "", costCenterId: "", notes: "" };
  return <EntityDialog wide title={vehicle ? `Modifier ${vehicle.plate}` : "Nouveau véhicule"} fields={fields} initial={initial} trigger={vehicle ? <Button size="sm" variant="outline"><Pencil className="size-4" /> Modifier</Button> : <AddBtn label="Nouveau véhicule" />} success={vehicle ? "Véhicule mis à jour" : "Véhicule ajouté"} onSubmit={(v) => (vehicle ? updateVehicleAction(p(v, { id: vehicle.id })) : createVehicleAction(p(v)))} />;
}

// ── Chauffeurs ────────────────────────────────────────────────

export interface DriverRow { id: string; fullName: string; employeeId: string | null; phone: string | null; licenseNumber: string | null; licenseCategory: string | null; licenseExpiry: Date | null; status: string; notes: string | null }

export function DriverDialog({ driver, employees, showLicense = true }: { driver?: DriverRow; employees: Opt[]; showLicense?: boolean }) {
  const fields: FieldSpec[] = [
    { name: "fullName", label: "Nom complet", required: true, wide: true },
    ...(employees.length ? [{ name: "employeeId", label: "Salarié correspondant", kind: "select" as const, options: opts(employees), emptyLabel: "— Prestataire / non salarié —", wide: true }] : []),
    { name: "phone", label: "Téléphone" },
    ...(showLicense ? [{ name: "licenseNumber", label: "N° de permis" }, { name: "licenseCategory", label: "Catégorie" }, { name: "licenseExpiry", label: "Fin de validité du permis", kind: "date" as const }] : []),
    ...(driver ? [{ name: "status", label: "Statut", kind: "select" as const, required: true, options: [{ value: "ACTIVE", label: "Actif" }, { value: "SUSPENDED", label: "Suspendu" }, { value: "LEFT", label: "Parti" }] }] : []),
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const initial: Values = driver
    ? { fullName: driver.fullName, employeeId: str(driver.employeeId), phone: str(driver.phone), licenseNumber: str(driver.licenseNumber), licenseCategory: str(driver.licenseCategory), licenseExpiry: dateIn(driver.licenseExpiry), status: driver.status, notes: str(driver.notes) }
    : { fullName: "", employeeId: "", phone: "", licenseNumber: "", licenseCategory: "", licenseExpiry: "", notes: "" };
  return <EntityDialog wide title={driver ? `Modifier ${driver.fullName}` : "Nouveau chauffeur"} fields={fields} initial={initial} trigger={driver ? <EditBtn label={`Modifier ${driver.fullName}`} /> : <AddBtn label="Nouveau chauffeur" />} success={driver ? "Chauffeur mis à jour" : "Chauffeur ajouté"} onSubmit={(v) => (driver ? updateDriverAction(p(v, { id: driver.id })) : createDriverAction(p(v)))} />;
}

export function AssignDialog({ vehicleId, drivers }: { vehicleId: string; drivers: Opt[] }) {
  const fields: FieldSpec[] = [
    { name: "driverId", label: "Chauffeur", kind: "select", required: true, options: opts(drivers) },
    { name: "startDate", label: "À partir du", kind: "date", required: true },
    { name: "note", label: "Note" },
  ];
  return <EntityDialog title="Affecter un chauffeur" description="La nouvelle affectation met fin à la précédente la veille." fields={fields} initial={{ driverId: "", startDate: new Date().toISOString().slice(0, 10), note: "" }} trigger={<AddBtn label="Affecter" />} success="Affectation enregistrée" onSubmit={(v) => assignDriverAction(p(v, { vehicleId }))} />;
}

export function ComplianceDialog({ vehicleId }: { vehicleId: string }) {
  const fields: FieldSpec[] = [
    { name: "kind", label: "Type de document", kind: "select", required: true, options: COMPLIANCE_KINDS.map((t) => ({ value: t.value, label: t.label })) },
    { name: "reference", label: "N° de police / référence" }, { name: "provider", label: "Assureur / centre" },
    { name: "startDate", label: "Début de validité", kind: "date" }, { name: "expiresAt", label: "Échéance", kind: "date", required: true },
    { name: "cost", label: "Coût", kind: "number" }, { name: "notes", label: "Notes", kind: "textarea" },
  ];
  return <EntityDialog wide title="Assurance, visite technique, document" description="Un renouvellement remplace l'ancien document dans les alertes." fields={fields} initial={{ kind: "INSURANCE", reference: "", provider: "", startDate: "", expiresAt: "", cost: "0", notes: "" }} trigger={<AddBtn label="Ajouter" />} success="Document enregistré" onSubmit={(v) => addComplianceAction(p(v, { vehicleId }))} />;
}

// ── Missions ──────────────────────────────────────────────────

export interface TripRow { id: string; vehicleId: string; driverId: string; origin: string; destination: string; purpose: string | null; plannedStart: Date; plannedEnd: Date | null; cargo: string | null; customerId: string | null; projectId: string | null; revenue: number; notes: string | null }

export function TripDialog({ trip, vehicles, drivers, customers, projects }: { trip?: TripRow; vehicles: Opt[]; drivers: Opt[]; customers: Opt[]; projects: Opt[] }) {
  const fields: FieldSpec[] = [
    { name: "vehicleId", label: "Véhicule", kind: "select", required: true, options: opts(vehicles) },
    { name: "driverId", label: "Chauffeur", kind: "select", required: true, options: opts(drivers) },
    { name: "origin", label: "Départ", required: true }, { name: "destination", label: "Destination", required: true },
    { name: "plannedStart", label: "Départ prévu", kind: "datetime", required: true }, { name: "plannedEnd", label: "Arrivée prévue", kind: "datetime", hint: "Sans arrivée prévue : 24 h de réservation." },
    { name: "cargo", label: "Chargement" }, { name: "purpose", label: "Objet de la mission" },
    ...(customers.length ? [{ name: "customerId", label: "Client", kind: "select" as const, options: opts(customers), emptyLabel: "— Aucun —" }] : []),
    ...(projects.length ? [{ name: "projectId", label: "Projet", kind: "select" as const, options: opts(projects), emptyLabel: "— Aucun —" }] : []),
    { name: "revenue", label: "Produit de la mission (facturé)", kind: "number" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const initial: Values = trip
    ? { vehicleId: trip.vehicleId, driverId: trip.driverId, origin: trip.origin, destination: trip.destination, plannedStart: dtIn(trip.plannedStart), plannedEnd: dtIn(trip.plannedEnd), cargo: str(trip.cargo), purpose: str(trip.purpose), customerId: str(trip.customerId), projectId: str(trip.projectId), revenue: str(trip.revenue), notes: str(trip.notes) }
    : { vehicleId: "", driverId: "", origin: "", destination: "", plannedStart: "", plannedEnd: "", cargo: "", purpose: "", customerId: "", projectId: "", revenue: "0", notes: "" };
  return <EntityDialog wide title={trip ? "Modifier la mission" : "Nouvelle mission"} fields={fields} initial={initial} trigger={trip ? <EditBtn label="Modifier la mission" /> : <AddBtn label="Nouvelle mission" />} success={trip ? "Mission mise à jour" : "Mission planifiée"} onSubmit={(v) => (trip ? updateTripAction(p(v, { id: trip.id })) : createTripAction(p(v)))} />;
}

export function StartTripDialog({ id, odometer }: { id: string; odometer: number }) {
  return <EntityDialog title="Démarrer la mission" description="Le permis, l'assurance et la visite technique sont revérifiés au départ." fields={[{ name: "startKm", label: "Kilométrage au départ", kind: "number", step: "1" }]} initial={{ startKm: String(odometer) }} trigger={<Button size="sm" variant="outline"><Play className="size-4" /> Démarrer</Button>} submitLabel="Démarrer" success="Mission démarrée" onSubmit={(v) => startTripAction({ id, startKm: str(v.startKm) as never })} />;
}

export function FinishTripDialog({ id, startKm, revenue }: { id: string; startKm: number; revenue: number }) {
  const fields: FieldSpec[] = [
    { name: "endKm", label: "Kilométrage à l'arrivée", kind: "number", step: "1", required: true, hint: `Au départ : ${startKm.toLocaleString("fr-FR")} km` },
    { name: "revenue", label: "Produit de la mission", kind: "number" }, { name: "notes", label: "Remarques", kind: "textarea" },
  ];
  return <EntityDialog title="Clôturer la mission" fields={fields} initial={{ endKm: "", revenue: String(revenue), notes: "" }} trigger={<Button size="sm"><Flag className="size-4" /> Clôturer</Button>} submitLabel="Clôturer" success="Mission clôturée" onSubmit={(v) => finishTripAction(p(v, { id }))} />;
}

// ── Carburant, entretiens ─────────────────────────────────────

export function FuelDialog({ vehicles, drivers, vehicleId }: { vehicles: Opt[]; drivers: Opt[]; vehicleId?: string }) {
  const fields: FieldSpec[] = [
    ...(vehicleId ? [] : [{ name: "vehicleId", label: "Véhicule", kind: "select" as const, required: true, options: opts(vehicles), wide: true }]),
    { name: "date", label: "Date", kind: "date", required: true }, { name: "odometer", label: "Kilométrage au compteur", kind: "number", step: "1", required: true },
    { name: "liters", label: "Litres", kind: "number", required: true }, { name: "amount", label: "Montant payé", kind: "number", hint: "Ou indiquez le prix au litre : l'autre est calculé." },
    { name: "unitPrice", label: "Prix au litre", kind: "number" }, { name: "driverId", label: "Chauffeur", kind: "select", options: opts(drivers), emptyLabel: "— Non précisé —" },
    { name: "station", label: "Station" }, { name: "fullTank", label: "Plein complet (pour la consommation)", kind: "switch" },
  ];
  return <EntityDialog wide title="Enregistrer un plein" fields={fields} initial={{ vehicleId: vehicleId ?? "", date: new Date().toISOString().slice(0, 10), odometer: "", liters: "", amount: "", unitPrice: "", driverId: "", station: "", fullTank: true }} trigger={<AddBtn label="Plein" />} success="Plein enregistré" onSubmit={(v) => addFuelAction(p(v, { vehicleId: vehicleId ?? str(v.vehicleId) }))} />;
}

export interface MaintenanceRow { id: string; vehicleId: string; type: string; status: string; date: Date; odometer: number | null; description: string; supplierId: string | null; cost: number; nextDueDate: Date | null; nextDueKm: number | null; notes: string | null }

export function MaintenanceDialog({ vehicles, vehicleId, record, suppliers }: { vehicles: Opt[]; vehicleId?: string; record?: MaintenanceRow; suppliers: Opt[] }) {
  const fields: FieldSpec[] = [
    ...(vehicleId || record ? [] : [{ name: "vehicleId", label: "Véhicule", kind: "select" as const, required: true, options: opts(vehicles), wide: true }]),
    { name: "type", label: "Nature", kind: "select", required: true, options: MAINTENANCE_TYPES.map((t) => ({ value: t.value, label: t.label })) },
    { name: "status", label: "État", kind: "select", required: true, options: [{ value: "DONE", label: "Réalisé" }, { value: "PLANNED", label: "Planifié" }] },
    { name: "description", label: "Description", required: true, wide: true },
    { name: "date", label: "Date (prévue ou réalisée)", kind: "date", required: true }, { name: "odometer", label: "Kilométrage", kind: "number", step: "1" },
    { name: "cost", label: "Coût", kind: "number" },
    ...(suppliers.length ? [{ name: "supplierId", label: "Garage / fournisseur", kind: "select" as const, options: opts(suppliers), emptyLabel: "— Aucun —" }] : []),
    { name: "nextDueDate", label: "Prochaine échéance (date)", kind: "date" }, { name: "nextDueKm", label: "Prochaine échéance (km)", kind: "number", step: "1" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const initial: Values = record
    ? { type: record.type, status: record.status === "CANCELLED" ? "PLANNED" : record.status, description: record.description, date: dateIn(record.date), odometer: str(record.odometer), cost: str(record.cost), supplierId: str(record.supplierId), nextDueDate: dateIn(record.nextDueDate), nextDueKm: str(record.nextDueKm), notes: str(record.notes) }
    : { vehicleId: vehicleId ?? "", type: "PREVENTIVE", status: "DONE", description: "", date: new Date().toISOString().slice(0, 10), odometer: "", cost: "0", supplierId: "", nextDueDate: "", nextDueKm: "", notes: "" };
  return <EntityDialog wide title={record ? "Modifier l'entretien" : "Entretien ou réparation"} fields={fields} initial={initial} trigger={record ? <EditBtn label="Modifier l'entretien" /> : <AddBtn label="Entretien" />} success="Entretien enregistré" onSubmit={(v) => (record ? updateMaintenanceAction(p(v, { id: record.id, vehicleId: record.vehicleId })) : addMaintenanceAction(p(v, { vehicleId: vehicleId ?? str(v.vehicleId) })))} />;
}

export function CompleteMaintenanceDialog({ id }: { id: string }) {
  const fields: FieldSpec[] = [
    { name: "date", label: "Date de réalisation", kind: "date", required: true }, { name: "odometer", label: "Kilométrage", kind: "number", step: "1" }, { name: "cost", label: "Coût réel", kind: "number" },
    { name: "nextDueDate", label: "Prochaine échéance (date)", kind: "date" }, { name: "nextDueKm", label: "Prochaine échéance (km)", kind: "number", step: "1" }, { name: "notes", label: "Notes", kind: "textarea" },
  ];
  return <EntityDialog wide title="Entretien réalisé" fields={fields} initial={{ date: new Date().toISOString().slice(0, 10), odometer: "", cost: "0", nextDueDate: "", nextDueKm: "", notes: "" }} trigger={<Button size="sm" variant="outline"><CheckCircle2 className="size-4" /> Réalisé</Button>} success="Entretien réalisé" onSubmit={(v) => completeMaintenanceAction(p(v, { id }))} />;
}

// ── Contraventions ────────────────────────────────────────────

export interface FineRowUi { id: string; number: string; vehicleId: string; driverId: string | null; date: Date; time: string | null; place: string | null; offence: string; amount: number; dueDate: Date | null; notes: string | null }

export function FineDialog({ fine, vehicles, drivers }: { fine?: FineRowUi; vehicles: Opt[]; drivers: Opt[] }) {
  const fields: FieldSpec[] = [
    { name: "number", label: "N° du PV", required: true }, { name: "vehicleId", label: "Véhicule", kind: "select", required: true, options: opts(vehicles) },
    { name: "date", label: "Date de l'infraction", kind: "date", required: true }, { name: "time", label: "Heure", kind: "time" },
    { name: "place", label: "Lieu", wide: true }, { name: "offence", label: "Infraction", required: true, wide: true },
    { name: "amount", label: "Montant", kind: "number", required: true }, { name: "dueDate", label: "Échéance de paiement", kind: "date" },
    { name: "driverId", label: "Chauffeur", kind: "select", options: opts(drivers), emptyLabel: "— Déduit de la mission / affectation —", wide: true },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const initial: Values = fine
    ? { number: fine.number, vehicleId: fine.vehicleId, date: dateIn(fine.date), time: str(fine.time), place: str(fine.place), offence: fine.offence, amount: str(fine.amount), dueDate: dateIn(fine.dueDate), driverId: str(fine.driverId), notes: str(fine.notes) }
    : { number: "", vehicleId: "", date: new Date().toISOString().slice(0, 10), time: "", place: "", offence: "", amount: "", dueDate: "", driverId: "", notes: "" };
  return <EntityDialog wide title={fine ? `Modifier le PV ${fine.number}` : "Nouvelle contravention"} description="Joignez ensuite le PV ou la photo depuis la fiche de la contravention." fields={fields} initial={initial} trigger={fine ? <Button size="sm" variant="outline"><Pencil className="size-4" /> Modifier</Button> : <AddBtn label="Contravention" />} success={fine ? "PV mis à jour" : "Contravention enregistrée"} onSubmit={(v) => (fine ? updateFineAction(p(v, { id: fine.id })) : createFineAction(p(v)))} />;
}

export function FineStatusDialog({ id, current }: { id: string; current: string }) {
  const targets = FINE_STATUSES.filter((s) => s.value !== current);
  const fields: FieldSpec[] = [
    { name: "status", label: "Nouveau statut", kind: "select", required: true, options: targets.map((s) => ({ value: s.value, label: s.label })) },
    { name: "paidAt", label: "Date de paiement", kind: "date", hint: "Pour le statut « Payée »." },
    { name: "reason", label: "Motif", kind: "textarea", hint: "Obligatoire pour une contestation." },
  ];
  return <EntityDialog title="Changer le statut" fields={fields} initial={{ status: targets[0]?.value ?? "PAID", paidAt: new Date().toISOString().slice(0, 10), reason: "" }} trigger={<Button size="sm" variant="outline"><CircleDollarSign className="size-4" /> Statut</Button>} success="Statut mis à jour" onSubmit={(v) => setFineStatusAction(p(v, { id }))} />;
}
