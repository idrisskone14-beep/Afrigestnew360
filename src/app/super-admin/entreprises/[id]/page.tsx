import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/app/page-header";
import { MODULES } from "@/core/modules/registry";
import { getCompanyDetail } from "@/modules/platform/companies";
import { CompanyAdminPanel } from "./company-admin-panel";

export const metadata: Metadata = { title: "Détail entreprise" };

const dt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const d = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const data = await getCompanyDetail(id).catch(() => null);
  if (!data) notFound();
  const { company: c, modules, overrides, members, activity, limits, usage, plans, invitations } = data;
  const moduleState = new Map(modules.map((m) => [m.module.key, m]));

  return (
    <>
      <PageHeader
        title={c.tradeName ?? c.legalName}
        description={c.legalName}
        breadcrumbs={[{ label: "Entreprises", href: "/super-admin/entreprises" }, { label: c.tradeName ?? c.legalName }]}
      />
      <CompanyAdminPanel
        company={{
          id: c.id, legalName: c.legalName, tradeName: c.tradeName ?? "", email: c.email ?? "", phone: c.phone ?? "",
          country: c.country, currency: c.currency, status: c.status, suspendedReason: c.suspendedReason,
          createdAt: d.format(c.createdAt), slug: c.slug,
        }}
        subscription={c.subscription ? {
          planId: c.subscription.planId, planName: c.subscription.plan.name, status: c.subscription.status,
          billingCycle: c.subscription.billingCycle, periodEnd: d.format(c.subscription.currentPeriodEnd),
          trialEnds: c.subscription.trialEndsAt ? d.format(c.subscription.trialEndsAt) : null, price: Number(c.subscription.priceAmount), currency: c.subscription.currency,
        } : null}
        plans={plans.map((p) => ({ id: p.id, name: p.name }))}
        modules={MODULES.map((m) => ({
          key: m.key, name: m.name, kind: m.kind,
          enabled: moduleState.get(m.key)?.enabled ?? false,
          source: moduleState.get(m.key)?.source ?? "PLAN",
        }))}
        limits={Object.entries(limits).map(([key, value]) => ({
          key, effective: value, used: usage[key as keyof typeof usage] ?? 0, overridden: overrides.some((o) => o.key === key),
        }))}
        members={members.map((m) => ({ id: m.id, name: m.user.name, email: m.user.email, role: m.role.name, status: m.status, isOwner: m.isOwner, lastLogin: m.user.lastLoginAt ? dt.format(m.user.lastLoginAt) : "Jamais" }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role.name, expires: d.format(i.expiresAt) }))}
        activity={activity.map((a) => ({ id: a.id, summary: a.summary ?? a.action, who: a.userLabel ?? "Système", at: dt.format(a.createdAt) }))}
      />
    </>
  );
}
