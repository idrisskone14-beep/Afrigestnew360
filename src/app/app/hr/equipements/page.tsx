import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { AlertTriangle, FileDown, HardHat } from "lucide-react";
import { ListScope, SelectionBar } from "@/components/app/data-list";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { CONDITIONS } from "@/modules/hr/admin-schemas";
import { equipmentAlerts, listEquipment } from "@/modules/hr/equipment";
import { loadPolicy, policyForm } from "@/modules/hr/policy";
import { EquipmentDialog, ReturnEquipmentDialog } from "@/modules/hr/ui/admin-dialogs";
import { PolicyDialog } from "@/modules/hr/ui/register-dialogs";
import { ExportLinks } from "@/modules/hr/ui/export-links";

export const metadata: Metadata = { title: "Équipements et EPI" };
const cond = (v: string | null) => CONDITIONS.find((c) => c.value === v)?.label ?? "—";
const ALERT_TEXT = { replace_overdue: "Remplacement dépassé", replace_soon: "Remplacement proche", not_returned: "Non restitué (salarié sorti)" } as const;

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  if (!ctx.can("hr.equipment.read")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["OUT", "RETURNED"] as const);
  const manage = ctx.can("hr.equipment.manage");
  const stock = manage && ctx.hasModule("inventory") && ctx.can("inventory.movement.read");
  const [{ rows, total }, alerts, policy, employees, products, warehouses] = await Promise.all([
    listEquipment(ctx, { status, q: lp.q || undefined, skip: lp.skip, take: lp.take }),
    equipmentAlerts(ctx),
    loadPolicy(ctx.db),
    manage ? ctx.db.employee.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
    stock ? ctx.db.product.findMany({ where: { trackStock: true, deletedAt: null, type: { not: "SERVICE" } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : Promise.resolve([]),
    stock ? ctx.db.warehouse.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <ListScope filename="equipements-epi">
      {alerts.length > 0 && (
        <Card className="mb-4 border-amber-300/60 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-amber-600" /> Alertes de remplacement et de restitution</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {alerts.map((a) => <p key={a.id}><b>{a.name}</b> ({a.employee.lastName} {a.employee.firstName}) : {ALERT_TEXT[a.alert!]}{a.replaceOn && a.alert !== "not_returned" ? ` — prévu le ${fmtDate(a.replaceOn)}` : ""}.</p>)}
          </CardContent>
        </Card>
      )}
      <ListToolbar placeholder="Équipement, salarié…" filters={[{ name: "statut", label: "Situation", options: [{ value: "OUT", label: "Remis (non restitué)" }, { value: "RETURNED", label: "Restitués" }] }]}>
        <ExportLinks kind="hr-equipements" params={{ q: lp.q || undefined, statut: status }} />
        {ctx.can("hr.holiday.manage") && <PolicyDialog policy={policyForm(policy)} />}
        {manage && employees.length > 0 && <EquipmentDialog employees={employees.map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }))} products={products.map((p) => ({ value: p.id, label: p.name }))} warehouses={warehouses.map((w) => ({ value: w.id, label: w.name }))} />}
      </ListToolbar>
      <SelectionBar />
      {rows.length === 0 ? <EmptyState icon={<HardHat className="size-8" />} title="Aucun équipement remis" description="Les remises d'équipements et d'EPI apparaissent ici, avec leur restitution." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead>Équipement</TableHead><TableHead className="text-right">Qté</TableHead><TableHead>Remis le</TableHead><TableHead>État</TableHead><TableHead>Remplacement</TableHead><TableHead>Situation</TableHead><TableHead className="w-44"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm font-medium">{r.employee.lastName} {r.employee.firstName}<span className="block text-xs font-normal text-muted-foreground">{r.employee.number}</span></TableCell>
                  <TableCell className="text-sm">{r.name}{r.reference && <span className="block text-xs text-muted-foreground">{r.reference}</span>}{r.productId && <span className="block text-xs text-muted-foreground">lié au stock</span>}</TableCell>
                  <TableCell className="text-right text-sm tabular">{r.quantity}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.issuedOn)}</TableCell>
                  <TableCell className="text-sm">{cond(r.condition)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{r.replaceOn ? fmtDate(r.replaceOn) : "—"}</TableCell>
                  <TableCell>{r.returnedOn ? <StatusBadge tone="success">Restitué {fmtDate(r.returnedOn)}</StatusBadge> : <StatusBadge tone={r.alert ? "warning" : "info"}>{r.alert ? ALERT_TEXT[r.alert] : "Remis"}</StatusBadge>}{r.returnCondition && <span className="block text-xs text-muted-foreground">{cond(r.returnCondition)}</span>}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild size="sm" variant="ghost"><a href={`/api/pdf/hr_equipment/${r.id}`} target="_blank" rel="noreferrer" aria-label="Fiche de remise PDF"><FileDown className="size-4" /></a></Button>
                      {manage && !r.returnedOn && <ReturnEquipmentDialog id={r.id} hasStock={Boolean(r.issueMovementId)} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/equipements" searchParams={sp} />
    </ListScope>
  );
}
