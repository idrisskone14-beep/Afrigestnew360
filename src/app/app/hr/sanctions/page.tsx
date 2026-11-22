import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { Gavel } from "lucide-react";
import { ListScope, SelectionBar } from "@/components/app/data-list";
import { ListToolbar } from "@/components/app/list-kit";
import { EmptyState } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireModulePage } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { PAGE_SIZE, enumParam, parseListParams, type SearchParams } from "@/lib/list-params";
import { DISCIPLINE_STATUSES } from "@/modules/hr/admin-schemas";
import { listCases, listSanctionTypes } from "@/modules/hr/sanctions";
import { CaseDialog, SanctionTypeDialog } from "@/modules/hr/ui/admin-dialogs";
import { ExportLinks } from "@/modules/hr/ui/export-links";

export const metadata: Metadata = { title: "Sanctions disciplinaires" };
const TONE = { OPEN: "info", DECIDED: "warning", NOTIFIED: "success", CLOSED: "neutral", CANCELLED: "neutral" } as const;

export default async function SanctionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireModulePage("hr");
  if (!ctx.can("hr.sanction.read")) forbidden();
  const sp = await searchParams;
  const lp = parseListParams(sp);
  const status = enumParam(sp, "statut", ["OPEN", "DECIDED", "NOTIFIED", "CLOSED", "CANCELLED"] as const);
  const manage = ctx.can("hr.sanction.manage");
  const [{ rows, total }, types, employees] = await Promise.all([
    listCases(ctx, { status, q: lp.q || undefined, skip: lp.skip, take: lp.take }),
    listSanctionTypes(ctx, true),
    manage ? ctx.db.employee.findMany({ where: { deletedAt: null }, select: { id: true, firstName: true, lastName: true, number: true }, orderBy: { lastName: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <ListScope filename="sanctions-disciplinaires">
      <p className="mb-3 text-xs text-muted-foreground">Registre de suivi de procédure, confidentiel. Aucune sanction n&apos;est jamais proposée ni prononcée automatiquement (ni à cause d&apos;un retard, ni d&apos;une absence). Les procédures et délais applicables sont à valider avec votre conseil.</p>
      <ListToolbar placeholder="Dossier, salarié, manquement…" filters={[{ name: "statut", label: "Statut", options: DISCIPLINE_STATUSES.map((s) => ({ value: s.value, label: s.label })) }]}>
        <ExportLinks kind="hr-sanctions" params={{ q: lp.q || undefined, statut: status }} />
        {manage && employees.length > 0 && <CaseDialog employees={employees.map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName} (${e.number})` }))} />}
      </ListToolbar>
      <SelectionBar />
      {rows.length === 0 ? <EmptyState icon={<Gavel className="size-8" />} title="Aucun dossier disciplinaire" description="Les dossiers ouverts apparaissent ici avec leurs étapes de procédure." /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Dossier</TableHead><TableHead>Salarié</TableHead><TableHead>Faits</TableHead><TableHead>Manquement</TableHead><TableHead>Sanction</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm font-medium"><Link href={`/app/hr/sanctions/${r.id}`} className="hover:text-brand">{r.number}</Link></TableCell>
                  <TableCell className="text-sm">{r.employeeName}<span className="block text-xs text-muted-foreground">{r.employeeNumber}</span></TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.factsDate)}</TableCell>
                  <TableCell className="text-sm">{r.breachNature}<span className="block text-xs text-muted-foreground">{r._count.steps} étape(s)</span></TableCell>
                  <TableCell className="text-sm">{r.sanctionType?.name ?? "—"}{r.decisionDate && <span className="block text-xs text-muted-foreground">décidée le {fmtDate(r.decisionDate)}</span>}</TableCell>
                  <TableCell><StatusBadge tone={TONE[r.status as keyof typeof TONE]}>{DISCIPLINE_STATUSES.find((s) => s.value === r.status)?.label}</StatusBadge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Pagination total={total} page={lp.page} pageSize={PAGE_SIZE} basePath="/app/hr/sanctions" searchParams={sp} />
      {manage && (
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-base">Types de sanction</CardTitle><SanctionTypeDialog /></CardHeader>
          <CardContent className="divide-y p-0">
            {types.length === 0 && <p className="px-6 pb-6 text-sm text-muted-foreground">Aucun type : ajoutez ceux de votre règlement intérieur. Rien n&apos;est préchargé.</p>}
            {types.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-6 py-2 text-sm">
                <span className={`flex-1 font-medium ${t.isActive ? "" : "text-muted-foreground line-through"}`}>{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.requiresHearing ? "audition exigée" : "sans audition exigée"}</span>
                <SanctionTypeDialog type={{ id: t.id, name: t.name, requiresHearing: t.requiresHearing, description: t.description, isActive: t.isActive }} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </ListScope>
  );
}
