import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { formatMoney } from "@/lib/reference-data";
import { listBranches, listCostCenters, listDepartments, listSites, orgAnalysis, type OrgAnalysisRow } from "@/modules/org/service";
import { OrgPanels } from "@/modules/org/ui/org-panels";

export const metadata: Metadata = { title: "Paramètres — Organisation" };

export default async function OrganizationPage() {
  const ctx = await requirePagePermission("org.structure.read");
  const [branches, sites, departments, costCenters] = await Promise.all([listBranches(ctx), listSites(ctx), listDepartments(ctx), listCostCenters(ctx)]);
  const canAnalyse = (ctx.hasModule("sales") && ctx.can("finance.invoice.read")) || (ctx.hasModule("purchases") && ctx.can("purchases.bill.read")) || (ctx.hasModule("finance") && ctx.can("finance.expense.read"));
  const [byBranch, byCost] = canAnalyse && (branches.length > 0 || costCenters.length > 0) ? await Promise.all([orgAnalysis(ctx, "branch"), orgAnalysis(ctx, "costCenter")]) : [[], []];
  return (
    <div className="max-w-4xl space-y-10">
      <OrgPanels
        canManage={ctx.can("org.structure.manage")}
        branches={branches.map((b) => ({ id: b.id, name: b.name, code: b.code ?? "", address: b.address ?? "", city: b.city ?? "", isHeadquarters: b.isHeadquarters, isActive: b.isActive }))}
        sites={sites.map((s) => ({ id: s.id, name: s.name, type: s.type ?? "", address: s.address ?? "", branchId: s.branchId ?? "", branchName: s.branch?.name ?? "", isActive: s.isActive }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name, code: d.code ?? "", parentId: d.parentId ?? "", isActive: d.isActive }))}
        costCenters={costCenters.map((c) => ({ id: c.id, code: c.code, name: c.name, isActive: c.isActive }))}
      />
      {byBranch.length > 0 && <Analysis title="Résultat par agence" rows={byBranch} currency={ctx.company.currency} />}
      {byCost.length > 0 && <Analysis title="Résultat par centre de coûts" rows={byCost} currency={ctx.company.currency} />}
    </div>
  );
}

function Analysis({ title, rows, currency }: { title: string; rows: OrgAnalysisRow[]; currency: string }) {
  const m = (n: { toNumber(): number }) => formatMoney(n.toNumber(), currency);
  return (
    <Card className="overflow-hidden">
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Affectation</TableHead><TableHead className="text-right">Produits HT</TableHead><TableHead className="text-right">Achats HT</TableHead><TableHead className="text-right">Dépenses</TableHead><TableHead className="text-right">Résultat</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id ?? "none"}>
                <TableCell className="text-sm font-medium">{r.label}</TableCell>
                <TableCell className="text-right text-sm tabular">{m(r.revenue)}</TableCell>
                <TableCell className="text-right text-sm tabular">{m(r.purchases)}</TableCell>
                <TableCell className="text-right text-sm tabular">{m(r.expenses)}</TableCell>
                <TableCell className={`text-right text-sm font-medium tabular ${r.result.lt(0) ? "text-destructive" : ""}`}>{m(r.result)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">Indicateur de gestion : produits et achats hors taxes (documents validés) moins dépenses payées. Les documents sans affectation figurent sur la ligne « Non affecté ».</p>
      </CardContent>
    </Card>
  );
}
