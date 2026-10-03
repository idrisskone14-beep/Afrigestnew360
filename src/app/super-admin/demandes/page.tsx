import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { platformDb } from "@/core/db/client";
import { countryName } from "@/lib/reference-data";
import { DEMO_STATUSES } from "@/modules/platform/schemas";
import { DemoRequestCard } from "./demo-request-card";

export const metadata: Metadata = { title: "Demandes de démo" };

const dt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export default async function DemoRequestsPage({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const { statut } = await searchParams;
  const valid = DEMO_STATUSES.find((s) => s.value === statut)?.value;
  const [rows, counts] = await Promise.all([
    platformDb.demoRequest.findMany({ where: valid ? { status: valid } : {}, orderBy: { createdAt: "desc" }, take: 100 }),
    platformDb.demoRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <>
      <PageHeader title="Demandes de démonstration" description="Prospects issus du formulaire public (/demo). Suivez leur traitement." />
      <nav aria-label="Filtrer par statut" className="mb-4 flex flex-wrap gap-2 text-sm">
        <a href="/super-admin/demandes" className={`rounded-full border px-3 py-1 ${!valid ? "border-brand bg-accent font-medium" : "hover:bg-muted"}`}>Toutes ({counts.reduce((a, c) => a + c._count._all, 0)})</a>
        {DEMO_STATUSES.map((s) => (
          <a key={s.value} href={`/super-admin/demandes?statut=${s.value}`} className={`rounded-full border px-3 py-1 ${valid === s.value ? "border-brand bg-accent font-medium" : "hover:bg-muted"}`}>{s.label} ({count(s.value)})</a>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState icon={<Inbox className="size-8" />} title="Aucune demande" description="Les demandes envoyées depuis la page Demander une démo apparaîtront ici." />
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <DemoRequestCard
              key={r.id}
              request={{
                id: r.id, fullName: r.fullName, email: r.email, phone: r.phone ?? "", companyName: r.companyName,
                country: r.country ? countryName(r.country) : "", sector: r.sector ?? "", companySize: r.companySize ?? "", message: r.message ?? "",
                status: r.status, notes: r.notes ?? "", createdAt: dt.format(r.createdAt),
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
