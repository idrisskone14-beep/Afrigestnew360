import type { Metadata } from "next";
import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { z } from "zod";
import { AlertTriangle, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { Info } from "@/components/app/info-item";
import { QueryTabs } from "@/components/app/query-tabs";
import { Status } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/core/errors";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { enumParam, type SearchParams } from "@/lib/list-params";
import { formatMoney } from "@/lib/reference-data";
import { endEquipmentAction, endMemberAction, removeMaterialPlanAction } from "@/modules/construction/actions";
import { BUDGET_CATEGORIES, SUBCONTRACT_STATUSES } from "@/modules/construction/schemas";
import { getSite, listReports, siteSummary, type SiteSummary } from "@/modules/construction/service";
import { BudgetDialog, EquipmentDialog, MaterialDialog, MemberDialog, PlanDialog, ReportDialog, SiteDialog, SubcontractDialog } from "@/modules/construction/ui/site-dialogs";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Chantier" };
const TABS = ["resume", "equipe", "materiel", "materiaux", "soustraitants", "rapports", "documents"] as const;

type Ctx = Awaited<ReturnType<typeof requireModulePage>>;

export default async function SiteDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("construction");
  if (!ctx.can("construction.site.read")) forbidden();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const site = await getSite(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const sum = await siteSummary(ctx, id);
  const sp = await searchParams;
  const tabs = [
    { key: "resume", label: "Budget et avancement" }, { key: "equipe", label: "Équipe" }, { key: "materiel", label: "Matériel et engins" }, { key: "materiaux", label: "Matériaux" },
    { key: "soustraitants", label: "Sous-traitants" }, { key: "rapports", label: "Rapports terrain" }, ...(ctx.hasModule("documents") && ctx.can("documents.document.read") ? [{ key: "documents", label: "Documents" }] : []),
  ];
  const tab = enumParam(sp, "onglet", TABS) ?? "resume";
  const manage = ctx.can("construction.site.manage") && site.status !== "DONE" && site.status !== "CANCELLED";
  const base = `/app/construction/chantiers/${id}`;
  const [customers, employees] = await Promise.all([
    ctx.hasModule("crm") && ctx.can("crm.customer.read") ? ctx.db.customer.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : Promise.resolve([]),
    ctx.hasModule("hr") && ctx.can("hr.employee.read") ? ctx.db.employee.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
  ]);
  const emp = employees.map((e) => ({ id: e.id, name: `${e.lastName} ${e.firstName}` }));
  const manager = site.managerId ? emp.find((e) => e.id === site.managerId)?.name : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/construction" className="hover:text-foreground">Chantiers</Link> / {site.code}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{site.name} <Status value={site.status} /></h2>
          <p className="text-sm text-muted-foreground">{[site.address, site.city].filter(Boolean).join(", ")}{manager ? ` · Responsable : ${manager}` : ""}{ctx.hasModule("projects") && ctx.can("project.project.read") && <> · <Link href={`/app/projects/projets/${site.projectId}`} className="hover:text-brand">Projet associé</Link></>}</p>
        </div>
        {ctx.can("construction.site.manage") && <SiteDialog site={site} customers={customers} employees={emp} />}
      </div>

      <QueryTabs tabs={tabs} current={tab} basePath={base} label="Sections du chantier" />

      {tab === "resume" && <Summary ctx={ctx} siteId={id} sum={sum} manage={manage} site={site} />}
      {tab === "equipe" && <Team ctx={ctx} siteId={id} sum={sum} manage={manage} employees={emp} />}
      {tab === "materiel" && <Equipment ctx={ctx} siteId={id} sum={sum} manage={manage} />}
      {tab === "materiaux" && <Materials ctx={ctx} siteId={id} sum={sum} manage={manage} />}
      {tab === "soustraitants" && <Subcontracts ctx={ctx} siteId={id} sum={sum} manage={manage} />}
      {tab === "rapports" && <Reports ctx={ctx} siteId={id} progress={site.progress} />}
      {tab === "documents" && <EntityDocuments ctx={ctx} type="site" id={id} />}
    </div>
  );
}

function Summary({ ctx, sum, siteId, manage, site }: { ctx: Ctx; sum: SiteSummary; siteId: string; manage: boolean; site: Awaited<ReturnType<typeof getSite>> }) {
  const money = (n: number | null) => (n === null ? "—" : formatMoney(n, ctx.company.currency));
  const gap = (b: number, a: number | null) => (a === null || b === 0 ? null : Math.round((a / b) * 100));
  return (
    <div className="space-y-6">
      {sum.overrun && <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> Dépassement de budget probable : {sum.actualTotal > sum.budgetTotal ? "le réel dépasse déjà le budget" : `à ${sum.progress} % d'avancement, le coût final est estimé à ${money(sum.forecast)} pour un budget de ${money(sum.budgetTotal)}`}.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Avancement", `${sum.progress} %`], ["Budget", money(sum.budgetTotal)], ["Réel à ce jour", `${money(sum.actualTotal)}${sum.usedPct !== null ? ` (${sum.usedPct} %)` : ""}`], ["Prévision à l'avancement", money(sum.forecast)]].map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 truncate text-xl font-semibold tabular">{v}</p></Card>)}
      </div>
      <Card className="overflow-hidden p-0">
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Budget prévu et réel</CardTitle>{manage && <BudgetDialog siteId={siteId} budget={sum.budget} />}</CardHeader>
        <Table>
          <TableHeader><TableRow><TableHead>Catégorie</TableHead><TableHead className="text-right">Prévu</TableHead><TableHead className="text-right">Réel</TableHead><TableHead className="text-right">Consommé</TableHead></TableRow></TableHeader>
          <TableBody>
            {BUDGET_CATEGORIES.map((c) => { const a = sum.actual[c.value] ?? null, b = sum.budget[c.value] ?? 0, g = gap(b, a); return (
              <TableRow key={c.value}><TableCell className="text-sm">{c.label}</TableCell><TableCell className="text-right text-sm tabular">{money(b)}</TableCell><TableCell className="text-right text-sm tabular">{a === null ? <span className="text-muted-foreground" title="Droit de lecture manquant">non visible</span> : money(a)}</TableCell><TableCell className={cn("text-right text-sm tabular", g !== null && g > 100 && "font-medium text-destructive")}>{g === null ? "—" : `${g} %`}</TableCell></TableRow>
            ); })}
            <TableRow className="border-t-2 font-semibold"><TableCell>Total</TableCell><TableCell className="text-right tabular">{money(sum.budgetTotal)}</TableCell><TableCell className="text-right tabular">{money(sum.actualTotal)}</TableCell><TableCell className="text-right tabular">{sum.usedPct === null ? "—" : `${sum.usedPct} %`}</TableCell></TableRow>
          </TableBody>
        </Table>
      </Card>
      <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-3">
        <Info label="Facturé au client (HT)">{money(sum.revenue)}</Info><Info label="Marge à ce jour">{money(sum.margin)}</Info>
        <Info label="Période">{site.startDate ? fmtDate(site.startDate) : "—"} → {site.endDate ? fmtDate(site.endDate) : "…"}</Info>
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">Matériaux : sorties de stock au coût moyen du moment. Main-d&apos;œuvre : temps passé sur le projet associé. Matériel : jours × coût journalier. Sous-traitance et autres : factures fournisseur et dépenses payées rattachées au projet du chantier.</p>
    </div>
  );
}

function Team({ sum, siteId, manage, employees }: { ctx: Ctx; sum: SiteSummary; siteId: string; manage: boolean; employees: { id: string; name: string }[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Équipe ({sum.team.filter((m) => !m.endDate).length} en poste)</CardTitle>{manage && employees.length > 0 && <MemberDialog siteId={siteId} employees={employees} />}</CardHeader>
      <Table>
        <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead className="hidden sm:table-cell">Rôle</TableHead><TableHead>Période</TableHead><TableHead className="text-right">Heures saisies</TableHead><TableHead className="w-24"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {sum.team.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Aucun salarié affecté.</TableCell></TableRow>}
          {sum.team.map((m) => <TableRow key={m.id}><TableCell className="text-sm font-medium">{m.name}</TableCell><TableCell className="hidden text-sm sm:table-cell">{m.role ?? "—"}</TableCell><TableCell className="text-sm">{fmtDate(m.startDate)} → {m.endDate ? fmtDate(m.endDate) : "en poste"}</TableCell><TableCell className="text-right text-sm tabular">{m.hours}</TableCell><TableCell className="text-right">{manage && !m.endDate && <ActionButton action={endMemberAction} input={{ id: m.id }} variant="ghost" size="sm" label="Terminer" success="Affectation terminée" />}</TableCell></TableRow>)}
        </TableBody>
      </Table>
    </Card>
  );
}

async function Equipment({ ctx, sum, siteId, manage }: { ctx: Ctx; sum: SiteSummary; siteId: string; manage: boolean }) {
  const vehicles = manage && ctx.hasModule("fleet") && ctx.can("fleet.vehicle.read") ? await ctx.db.vehicle.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, plate: true }, orderBy: { plate: "asc" } }) : [];
  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Matériel et engins</CardTitle>{manage && <EquipmentDialog siteId={siteId} vehicles={vehicles.map((v) => ({ id: v.id, name: v.plate }))} />}</CardHeader>
      <Table>
        <TableHeader><TableRow><TableHead>Matériel</TableHead><TableHead className="hidden sm:table-cell">Période</TableHead><TableHead className="text-right">Jours</TableHead><TableHead className="text-right">Coût</TableHead><TableHead className="w-24"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {sum.equipment.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Aucun matériel affecté.</TableCell></TableRow>}
          {sum.equipment.map((e) => <TableRow key={e.id}><TableCell className="text-sm font-medium">{e.vehicleId ? <Link href={`/app/fleet/vehicules/${e.vehicleId}`} className="hover:text-brand">{e.name}</Link> : e.name}<div className="text-xs font-normal text-muted-foreground">{formatMoney(e.dailyRate, ctx.company.currency)} / jour</div></TableCell><TableCell className="hidden text-sm sm:table-cell">{fmtDate(e.startDate)} → {e.endDate ? fmtDate(e.endDate) : "en cours"}</TableCell><TableCell className="text-right text-sm tabular">{e.days}</TableCell><TableCell className="text-right text-sm tabular">{formatMoney(e.cost, ctx.company.currency)}</TableCell><TableCell className="text-right">{manage && !e.endDate && <ActionButton action={endEquipmentAction} input={{ id: e.id }} variant="ghost" size="sm" label="Libérer" success="Matériel libéré" />}</TableCell></TableRow>)}
        </TableBody>
      </Table>
    </Card>
  );
}

async function Materials({ ctx, sum, siteId, manage }: { ctx: Ctx; sum: SiteSummary; siteId: string; manage: boolean }) {
  const inventory = ctx.hasModule("inventory") && ctx.can("inventory.stock.read");
  const [products, warehouses, plans] = await Promise.all([
    manage && inventory ? ctx.db.product.findMany({ where: { deletedAt: null, trackStock: true, isActive: true }, select: { id: true, name: true, sku: true }, orderBy: { name: "asc" }, take: 500 }) : Promise.resolve([]),
    manage && inventory ? ctx.db.warehouse.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    ctx.db.siteMaterialPlan.findMany({ where: { siteId }, select: { id: true, productId: true } }),
  ]);
  const planId = new Map(plans.map((p) => [p.productId, p.id]));
  const opts = products.map((p) => ({ id: p.id, name: `${p.name} (${p.sku})` }));
  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">Matériaux (liés au stock)</CardTitle>{manage && inventory && <div className="flex gap-2"><PlanDialog siteId={siteId} products={opts} /><MaterialDialog siteId={siteId} products={opts} warehouses={warehouses} /></div>}</CardHeader>
      <Table>
        <TableHeader><TableRow><TableHead>Produit</TableHead><TableHead className="text-right">Prévu</TableHead><TableHead className="text-right">Sorti (net)</TableHead><TableHead className="hidden text-right sm:table-cell">Reste</TableHead><TableHead className="text-right">Coût</TableHead><TableHead className="w-12"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {sum.materials.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Aucun matériau prévu ni sorti.</TableCell></TableRow>}
          {sum.materials.map((m) => <TableRow key={m.productId}><TableCell className="text-sm font-medium">{m.name}</TableCell><TableCell className="text-right text-sm tabular">{m.planned || "—"} {m.planned ? m.unit : ""}</TableCell><TableCell className="text-right text-sm tabular">{m.issued} {m.unit}</TableCell><TableCell className={cn("hidden text-right text-sm tabular sm:table-cell", m.planned > 0 && m.issued > m.planned && "text-destructive")}>{m.planned ? `${Math.round((m.planned - m.issued) * 1000) / 1000} ${m.unit}` : "—"}</TableCell><TableCell className="text-right text-sm tabular">{formatMoney(m.cost, ctx.company.currency)}</TableCell><TableCell>{manage && planId.has(m.productId) && <ActionButton action={removeMaterialPlanAction} input={{ id: planId.get(m.productId)! }} variant="ghost" size="icon" label="" ariaLabel={`Retirer la prévision de ${m.name}`} icon={<Trash2 className="size-4" />} success="Prévision retirée" />}</TableCell></TableRow>)}
        </TableBody>
      </Table>
    </Card>
  );
}

async function Subcontracts({ ctx, sum, siteId, manage }: { ctx: Ctx; sum: SiteSummary; siteId: string; manage: boolean }) {
  const suppliers = manage && ctx.hasModule("purchases") && ctx.can("purchases.supplier.read") ? await ctx.db.supplier.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }) : [];
  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Sous-traitants</CardTitle>{manage && suppliers.length > 0 && <SubcontractDialog siteId={siteId} suppliers={suppliers} />}</CardHeader>
      <Table>
        <TableHeader><TableRow><TableHead>Sous-traitant</TableHead><TableHead className="hidden sm:table-cell">Périmètre</TableHead><TableHead className="text-right">Marché</TableHead><TableHead className="text-right">Facturé</TableHead><TableHead>Statut</TableHead><TableHead className="w-12"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {sum.subcontracts.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Aucun sous-traitant.</TableCell></TableRow>}
          {sum.subcontracts.map((s) => <TableRow key={s.id}><TableCell className="text-sm font-medium"><Link href={`/app/purchases/fournisseurs/${s.supplierId}`} className="hover:text-brand">{s.supplier}</Link></TableCell><TableCell className="hidden text-sm sm:table-cell">{s.scope}</TableCell><TableCell className="text-right text-sm tabular">{formatMoney(s.contractAmount, ctx.company.currency)}</TableCell><TableCell className="text-right text-sm tabular">{s.billed === null ? "—" : formatMoney(s.billed, ctx.company.currency)} {s.billed !== null && s.billed > s.contractAmount && s.contractAmount > 0 && <Badge variant="destructive">dépassé</Badge>}</TableCell><TableCell><Badge variant="outline">{SUBCONTRACT_STATUSES.find((x) => x.value === s.status)?.label}</Badge></TableCell><TableCell>{manage && <SubcontractDialog siteId={siteId} suppliers={suppliers} row={s} />}</TableCell></TableRow>)}
        </TableBody>
      </Table>
    </Card>
  );
}

async function Reports({ ctx, siteId, progress }: { ctx: Ctx; siteId: string; progress: number }) {
  const rows = await listReports(ctx, siteId);
  const canWrite = ctx.can("construction.report.manage");
  const showDocs = ctx.hasModule("documents") && ctx.can("documents.document.read");
  return (
    <div className="space-y-4">
      {canWrite && <div className="flex justify-end"><ReportDialog siteId={siteId} lastProgress={progress} /></div>}
      {rows.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Aucun rapport terrain.</p> : rows.slice(0, 30).map((r) => (
        <Card key={r.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-2"><CardTitle className="text-base">{fmtDate(r.date)}</CardTitle><span className="flex items-center gap-2 text-sm text-muted-foreground">{r.weather} · {r.workforce} présents · <Badge variant="outline">{r.progress} %</Badge></span></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="whitespace-pre-line">{r.summary}</p>
            {r.incidents && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200"><span className="font-medium">Incidents :</span> {r.incidents}</p>}
            {showDocs && <EntityDocuments ctx={ctx} type="site_report" id={r.id} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
