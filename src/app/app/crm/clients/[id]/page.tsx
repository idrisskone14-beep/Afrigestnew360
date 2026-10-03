import type { Metadata } from "next";
import { EntityDocuments } from "@/modules/documents/ui/entity-documents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Globe, Mail, MapPin, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Status, StatusBadge } from "@/components/app/status-badge";
import { TabNav } from "@/components/app/tab-nav";
import { AppError } from "@/core/errors";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { countryName, formatMoney } from "@/lib/reference-data";
import { enumParam, type SearchParams } from "@/lib/list-params";
import { getCustomer } from "@/modules/crm/service";
import { ActivityDialog } from "@/modules/crm/ui/activity-dialog";
import { ArchiveCustomerButton } from "@/modules/crm/ui/archive-customer-button";
import { ContactsPanel } from "@/modules/crm/ui/contacts-panel";
import { CustomerFormDialog } from "@/modules/crm/ui/customer-form";
import { CustomerSalesPanel, CustomerSalesSummary } from "@/modules/sales/ui/customer-sales";

export const metadata: Metadata = { title: "Fiche client" };

const TABS = ["resume", "contacts", "activites", "opportunites", "ventes"] as const;

export default async function CustomerDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("crm.customer.read");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const customer = await getCustomer(ctx, id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const sp = await searchParams;
  const tab = enumParam(sp, "onglet", TABS) ?? "resume";
  const canEdit = ctx.can("crm.customer.update");
  const showSales = ctx.hasModule("sales") && ctx.can("finance.invoice.read");

  const tabs = [
    { href: `/app/crm/clients/${id}`, label: "Résumé", exact: true },
    { href: `/app/crm/clients/${id}?onglet=contacts`, label: `Contacts (${customer.contacts.length})`, exact: true },
    ...(ctx.can("crm.activity.read") ? [{ href: `/app/crm/clients/${id}?onglet=activites`, label: "Activités", exact: true }] : []),
    ...(ctx.can("crm.opportunity.read") ? [{ href: `/app/crm/clients/${id}?onglet=opportunites`, label: "Opportunités", exact: true }] : []),
    ...(showSales ? [{ href: `/app/crm/clients/${id}?onglet=ventes`, label: "Devis, commandes, factures", exact: true }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground"><Link href="/app/crm/clients" className="hover:text-foreground">Clients</Link> / {customer.code}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">{customer.name} <StatusBadge tone={customer.isActive ? "success" : "neutral"}>{customer.isActive ? "Actif" : "Inactif"}</StatusBadge></h2>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <CustomerFormDialog
              customerId={customer.id}
              isActive={customer.isActive}
              initial={{
                type: customer.type, name: customer.name, email: customer.email ?? "", phone: customer.phone ?? "", address: customer.address ?? "", city: customer.city ?? "",
                country: customer.country ?? "", taxId: customer.taxId ?? "", rccm: customer.rccm ?? "", website: customer.website ?? "",
                paymentTermsDays: customer.paymentTermsDays, creditLimit: customer.creditLimit ? num(customer.creditLimit) : "", notes: customer.notes ?? "",
              }}
            />
          )}
          {ctx.can("crm.customer.delete") && <ArchiveCustomerButton customerId={customer.id} name={customer.name} />}
        </div>
      </div>

      {showSales && <CustomerSalesSummary ctx={ctx} customerId={customer.id} creditLimit={customer.creditLimit ? num(customer.creditLimit) : null} />}

      <TabNav tabs={tabs} label="Sections de la fiche client" />

      {tab === "resume" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Coordonnées</CardTitle></CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <Row icon={<Mail className="size-4" />}>{customer.email ? <a href={`mailto:${customer.email}`} className="hover:text-brand">{customer.email}</a> : "—"}</Row>
              <Row icon={<Phone className="size-4" />}>{customer.phone ?? "—"}</Row>
              <Row icon={<MapPin className="size-4" />}>{[customer.address, customer.city, customer.country ? countryName(customer.country) : null].filter(Boolean).join(", ") || "—"}</Row>
              {customer.website && <Row icon={<Globe className="size-4" />}>{customer.website}</Row>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Conditions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Type">{customer.type === "COMPANY" ? "Entreprise" : "Particulier"}</Info>
              <Info label="Délai de paiement">{customer.paymentTermsDays} jours</Info>
              <Info label="Plafond de crédit">{customer.creditLimit ? formatMoney(num(customer.creditLimit), ctx.company.currency) : "Sans plafond"}</Info>
              <Info label="Identifiant fiscal">{customer.taxId ?? "—"}</Info>
              <Info label="RCCM">{customer.rccm ?? "—"}</Info>
              <Info label="Client depuis">{fmtDate(customer.createdAt)}</Info>
              {customer.notes && <div className="col-span-2"><Info label="Notes">{customer.notes}</Info></div>}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "contacts" && <ContactsPanel customerId={customer.id} canEdit={canEdit} contacts={customer.contacts.map((c) => ({ id: c.id, name: c.name, title: c.title, email: c.email, phone: c.phone, isPrimary: c.isPrimary }))} />}

      {tab === "activites" && ctx.can("crm.activity.read") && <CustomerActivities customerId={customer.id} canCreate={ctx.can("crm.activity.create")} ctx={ctx} />}
      {tab === "opportunites" && ctx.can("crm.opportunity.read") && <CustomerOpportunities customerId={customer.id} ctx={ctx} />}
      {tab === "ventes" && showSales && <CustomerSalesPanel ctx={ctx} customerId={customer.id} />}
      {tab === "resume" && <EntityDocuments ctx={ctx} type="customer" id={customer.id} />}
    </div>
  );
}

const Row = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => <p className="flex items-center gap-2.5"><span className="text-muted-foreground">{icon}</span>{children}</p>;
const Info = ({ label, children }: { label: string; children: React.ReactNode }) => <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 font-medium">{children}</p></div>;

async function CustomerActivities({ customerId, canCreate, ctx }: { customerId: string; canCreate: boolean; ctx: Awaited<ReturnType<typeof requirePagePermission>> }) {
  const rows = await ctx.db.activity.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <div className="space-y-3">
      {canCreate && <div className="flex justify-end"><ActivityDialog customerId={customerId} /></div>}
      {rows.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune activité.</p> : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((a) => (
            <li key={a.id} className="px-4 py-3">
              <p className="text-sm font-medium">{a.subject}</p>
              <p className="text-xs text-muted-foreground">{a.type} · {a.doneAt ? `fait le ${fmtDateTime(a.doneAt)}` : a.dueAt ? `à faire le ${fmtDateTime(a.dueAt)}` : "—"}</p>
              {a.notes && <p className="mt-1 text-sm text-muted-foreground">{a.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function CustomerOpportunities({ customerId, ctx }: { customerId: string; ctx: Awaited<ReturnType<typeof requirePagePermission>> }) {
  const rows = await ctx.db.opportunity.findMany({ where: { customerId, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { stage: { select: { name: true } } } });
  return rows.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune opportunité.</p> : (
    <ul className="divide-y rounded-xl border bg-card">
      {rows.map((o) => (
        <li key={o.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{o.title}</p><p className="text-xs text-muted-foreground">{o.stage.name}{o.expectedCloseDate ? ` · clôture prévue ${fmtDate(o.expectedCloseDate)}` : ""}</p></div>
          <span className="tabular text-sm">{formatMoney(num(o.amount), ctx.company.currency)}</span>
          <Status value={o.status} />
        </li>
      ))}
    </ul>
  );
}
