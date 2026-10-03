import "server-only";
import { platformDb } from "@/core/db/client";
import { appUrl, sendMail } from "@/core/mail";
import { normalizeEmail } from "@/core/auth/login";

export interface DemoRequestData {
  fullName: string;
  email: string;
  phone?: string;
  companyName: string;
  country?: string;
  sector?: string;
  companySize?: string;
  message?: string;
  source?: string;
}

const DEDUPE_WINDOW_MS = 24 * 3_600_000;
const clean = (v?: string) => (v && v.trim() ? v.trim() : null);

/**
 * Enregistre une demande consultable par le Super Admin. Une même adresse ne crée pas de doublons
 * sur 24 h tant que la demande est « Nouvelle » : le message est simplement ajouté aux notes.
 */
export async function recordDemoRequest(input: DemoRequestData) {
  const email = normalizeEmail(input.email);
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const existing = await platformDb.demoRequest.findFirst({ where: { email, status: "NEW", createdAt: { gte: since } } });

  if (existing) {
    if (clean(input.message)) {
      await platformDb.demoRequest.update({
        where: { id: existing.id },
        data: { notes: [existing.notes, `[Relance ${new Date().toISOString().slice(0, 16)}] ${input.message!.trim()}`].filter(Boolean).join("\n") },
      });
    }
    return { id: existing.id, duplicate: true };
  }

  const created = await platformDb.demoRequest.create({
    data: {
      fullName: input.fullName.trim(),
      email,
      phone: clean(input.phone),
      companyName: input.companyName.trim(),
      country: clean(input.country),
      sector: clean(input.sector),
      companySize: clean(input.companySize),
      message: clean(input.message),
      source: input.source ?? "demo",
    },
  });

  // Notifications e-mail : ne doivent jamais faire échouer l'enregistrement.
  const owner = process.env.PLATFORM_OWNER_EMAIL;
  await Promise.allSettled([
    owner
      ? sendMail({
          to: owner,
          subject: `Nouvelle demande de démo — ${created.companyName}`,
          text: `${created.fullName} (${created.email}) de « ${created.companyName} » a demandé une démonstration.\n\n${created.message ?? ""}\n\nTraiter : ${appUrl("/super-admin/demandes")}`,
        })
      : Promise.resolve(),
    sendMail({
      to: email,
      subject: "Votre demande a bien été reçue — AfriGest 360",
      text: `Bonjour ${created.fullName},\n\nMerci pour votre intérêt pour AfriGest 360. Notre équipe vous recontacte très prochainement pour organiser votre démonstration.\n\nL'équipe AfriGest 360`,
    }),
  ]);
  return { id: created.id, duplicate: false };
}

/** Offres visibles publiquement (page Tarifs), avec modules et limites. */
export async function getPublicPlans() {
  const plans = await platformDb.plan.findMany({
    where: { isPublic: true, isActive: true },
    orderBy: { sortOrder: "asc" },
    include: { modules: { include: { module: { select: { key: true, name: true, kind: true, sortOrder: true } } } }, limits: true },
  });
  return plans.map((p) => ({
    code: p.code,
    name: p.name,
    description: p.description ?? "",
    priceMonthly: Number(p.priceMonthly),
    priceYearly: Number(p.priceYearly),
    currency: p.currency,
    trialDays: p.trialDays,
    modules: p.modules.map((m) => m.module).filter((m) => m.key !== "core").sort((a, b) => a.sortOrder - b.sortOrder),
    limits: Object.fromEntries(p.limits.map((l) => [l.key, l.value])) as Record<string, number>,
  }));
}
