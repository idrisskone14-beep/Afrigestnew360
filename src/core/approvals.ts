import "server-only";
import { APPROVAL_TYPES, APPROVAL_TYPE_KEYS, POLICY_TYPE_KEYS, isApprovalType, type ApprovalType } from "@/core/approval-types";
import { audit } from "@/core/audit";
import type { Db } from "@/core/db/client";
import { businessRule, conflict, forbidden, notFound } from "@/core/errors";
import { emit } from "@/core/events";
import { notify } from "@/core/notifications";
import { d, type Numeric } from "@/core/money";
import type { TenantContext } from "@/core/tenant/context";
import "@/modules/registry";
import { formatMoney } from "@/lib/reference-data";

type Ctx = TenantContext;

/**
 * Moteur d'approbation. Deux niveaux de configuration, qui coexistent :
 *  1. Politique simple (par type) : au-delà d'un seuil, UNE validation par une personne habilitée (permission métier + « valider les demandes »).
 *  2. Règles (chaînes de validation) : selon le type, le montant, le département et le rôle du demandeur, une suite d'ÉTAPES,
 *     chacune confiée à un rôle (ex. Manager → Directeur financier). La règle applicable la plus prioritaire gagne ; sans règle, la politique simple s'applique.
 * Invariants : jamais d'auto-validation, un même utilisateur ne valide pas deux étapes d'une demande, décisions journalisées (append-only).
 */

export { APPROVAL_TYPES, APPROVAL_TYPE_KEYS, POLICY_TYPE_KEYS, isApprovalType, type ApprovalType } from "@/core/approval-types";

export async function listPolicies(ctx: Pick<Ctx, "db">) {
  const rows = await ctx.db.approvalPolicy.findMany();
  return POLICY_TYPE_KEYS.map((type) => {
    const p = rows.find((r) => r.resourceType === type);
    return { type, ...APPROVAL_TYPES[type], isEnabled: p?.isEnabled ?? false, threshold: d(p?.threshold ?? 0).toNumber() };
  });
}

export async function savePolicy(ctx: Ctx, input: { type: string; isEnabled: boolean; threshold: number }) {
  if (!isApprovalType(input.type) || !POLICY_TYPE_KEYS.includes(input.type)) throw notFound("Type d'approbation");
  if (input.threshold < 0) throw businessRule("Le seuil doit être positif.");
  const p = await ctx.db.approvalPolicy.upsert({
    where: { companyId_resourceType: { companyId: ctx.company.id, resourceType: input.type } },
    create: { companyId: ctx.company.id, resourceType: input.type, isEnabled: input.isEnabled, threshold: input.threshold },
    update: { isEnabled: input.isEnabled, threshold: input.threshold },
  });
  await audit(ctx, { action: "approval.policy", resource: "ApprovalPolicy", resourceId: p.id, summary: `${ctx.user.name} a ${input.isEnabled ? `exigé une approbation au-delà de ${formatMoney(input.threshold, ctx.company.currency)}` : "désactivé l'approbation"} pour « ${APPROVAL_TYPES[input.type].label} ».`, after: input });
  return p;
}

// ═══ Résolution du circuit applicable ═════════════════════════

export interface FlowStep { order: number; label: string; roleId: string | null }
export interface Flow {
  required: boolean;
  /** Règle appliquée ; null = politique simple (ou aucune validation). */
  ruleId: string | null;
  ruleName: string | null;
  steps: FlowStep[];
}

interface RuleLike {
  id: string; name: string; priority: number; minAmount: Numeric; maxAmount: Numeric | null; departmentId: string | null; requesterRoleId: string | null;
  steps: { stepOrder: number; label: string; roleId: string }[];
}

/**
 * Règle applicable : montant dans [min ; max[ (max exclu), département du demandeur et rôle du demandeur identiques si la règle les précise.
 * Plusieurs règles possibles → priorité la plus haute, puis la plus spécifique (département/rôle renseignés), puis le plus grand seuil minimal.
 * Fonction pure (testée sans base).
 */
export function pickRule<R extends RuleLike>(rules: R[], q: { amount: Numeric; departmentId: string | null; roleId: string | null }): R | null {
  const amount = d(q.amount);
  const fit = rules.filter((r) => r.steps.length > 0
    && amount.gte(d(r.minAmount)) && (r.maxAmount === null || amount.lt(d(r.maxAmount)))
    && (!r.departmentId || r.departmentId === q.departmentId)
    && (!r.requesterRoleId || r.requesterRoleId === q.roleId));
  fit.sort((a, b) => b.priority - a.priority
    || Number(Boolean(b.departmentId)) + Number(Boolean(b.requesterRoleId)) - (Number(Boolean(a.departmentId)) + Number(Boolean(a.requesterRoleId)))
    || d(b.minAmount).comparedTo(d(a.minAmount)));
  return fit[0] ?? null;
}

/** Circuit de validation pour une opération du demandeur courant : règle, sinon politique simple, sinon aucune validation. */
export async function resolveFlow(db: Db, ctx: Ctx, type: ApprovalType, amount: Numeric): Promise<Flow> {
  const rules = await db.approvalRule.findMany({ where: { resourceType: type, isActive: true }, include: { steps: { orderBy: { stepOrder: "asc" } } } });
  if (rules.length > 0) {
    // le département n'est cherché que si une règle en dépend
    const dept = rules.some((r) => r.departmentId) ? (await db.employee.findFirst({ where: { userId: ctx.user.id, deletedAt: null }, select: { departmentId: true } }))?.departmentId ?? null : null;
    const rule = pickRule(rules, { amount, departmentId: dept, roleId: ctx.membership.roleId });
    if (rule) return { required: true, ruleId: rule.id, ruleName: rule.name, steps: rule.steps.map((s) => ({ order: s.stepOrder, label: s.label, roleId: s.roleId })) };
  }
  const always = "alwaysRequired" in APPROVAL_TYPES[type];
  const p = always ? null : await db.approvalPolicy.findFirst({ where: { resourceType: type } });
  const required = always || Boolean(p?.isEnabled && d(amount).gte(p.threshold));
  return { required, ruleId: null, ruleName: null, steps: required ? [{ order: 1, label: "Validation", roleId: null }] : [] };
}

/** Une approbation est-elle exigée pour cette opération du demandeur courant ? */
export async function requiresApproval(ctx: Ctx, type: ApprovalType, amount: Numeric): Promise<boolean> {
  return (await resolveFlow(ctx.db, ctx, type, amount)).required;
}

// ═══ Approbateurs ═════════════════════════════════════════════

/** Membres pouvant décider selon la politique simple (permission métier + approbation de workflow), hors demandeur. */
export async function approverIds(tx: Db, ctx: Ctx, type: ApprovalType, excludeUserId: string) {
  const perm = APPROVAL_TYPES[type].permission;
  const members = await tx.companyMembership.findMany({
    where: {
      status: "ACTIVE", userId: { not: excludeUserId },
      OR: [{ role: { isAdmin: true } }, { AND: [{ role: { permissions: { some: { permission: { key: perm } } } } }, { role: { permissions: { some: { permission: { key: "workflow.request.approve" } } } } }] }],
    },
    select: { userId: true },
  });
  void ctx;
  return members.map((m) => m.userId);
}

/** Destinataires d'une étape : membres du rôle de l'étape (et administrateurs), hors demandeur et hors ceux ayant déjà validé une étape. */
async function stepApproverIds(tx: Db, ctx: Ctx, req: { resourceType: string; currentRoleId: string | null; requestedById: string; id: string }) {
  const done = (await tx.approvalDecision.findMany({ where: { requestId: req.id }, select: { decidedById: true } })).map((x) => x.decidedById);
  const excluded = [req.requestedById, ...done];
  if (!req.currentRoleId) return (await approverIds(tx, ctx, req.resourceType as ApprovalType, req.requestedById)).filter((u) => !done.includes(u));
  const members = await tx.companyMembership.findMany({ where: { status: "ACTIVE", userId: { notIn: excluded }, roleId: req.currentRoleId }, select: { userId: true } });
  return members.map((m) => m.userId);
}

// ═══ Demandes ═════════════════════════════════════════════════

/** Ouvre une demande d'approbation (annule la précédente pour la même ressource) et alerte les approbateurs de la 1re étape. */
export async function requestApproval(tx: Db, ctx: Ctx, input: { type: ApprovalType; resourceId: string; title: string; amount: Numeric; /** Texte de la notification (par défaut : le montant) ; pour les types non monétaires (congés : `amount` = jours). */ detail?: string }) {
  await tx.approvalRequest.updateMany({ where: { resourceType: input.type, resourceId: input.resourceId, status: "PENDING" }, data: { status: "CANCELLED" } });
  const flow = await resolveFlow(tx, ctx, input.type, input.amount);
  const first = flow.steps[0] ?? { order: 1, label: "Validation", roleId: null };
  const req = await tx.approvalRequest.create({
    data: {
      companyId: ctx.company.id, resourceType: input.type, resourceId: input.resourceId, title: input.title, amount: d(input.amount).toString(), currency: ctx.company.currency, requestedById: ctx.user.id,
      ruleId: flow.ruleId, currentStep: 1, totalSteps: Math.max(1, flow.steps.length), currentRoleId: first.roleId, currentLabel: flow.ruleId ? first.label : null,
    },
  });
  const ids = await stepApproverIds(tx, ctx, req);
  if (ids.length) {
    await notify(tx, { companyId: ctx.company.id, userIds: ids, type: input.type === "leave" ? "leave.request" : "approval.pending", title: `À valider : ${input.title}`, body: input.detail ?? `${ctx.user.name} demande une validation (${formatMoney(d(input.amount).toNumber(), ctx.company.currency)}).`, link: "/app/validations" });
  }
  return req;
}

export async function cancelApprovals(tx: Db, type: ApprovalType, resourceId: string) {
  await tx.approvalRequest.updateMany({ where: { resourceType: type, resourceId, status: "PENDING" }, data: { status: "CANCELLED" } });
}

// ═══ Décisions ════════════════════════════════════════════════

/** Droit de décider selon la politique simple : permission métier du type + « valider les demandes ». */
export const canDecide = (ctx: Pick<Ctx, "can">, type: ApprovalType) => ctx.can(APPROVAL_TYPES[type].permission) && ctx.can("workflow.request.approve");

interface DecidableRequest { resourceType: string; status: string; requestedById: string; ruleId: string | null; currentRoleId: string | null; decisions?: { decidedById: string }[] }

/**
 * L'utilisateur peut-il décider de l'étape COURANTE de cette demande ? Jamais pour sa propre demande ni s'il a déjà validé une étape.
 * Demande à règle : « valider les demandes » + rôle de l'étape (ou administrateur). Sinon : politique simple.
 */
export function canDecideRequest(ctx: Pick<Ctx, "can" | "access" | "membership" | "user">, req: DecidableRequest): boolean {
  if (req.status !== "PENDING" || !isApprovalType(req.resourceType)) return false;
  if (req.requestedById === ctx.user.id) return false;
  if (req.decisions?.some((x) => x.decidedById === ctx.user.id)) return false;
  if (!req.ruleId && !req.currentRoleId) return canDecide(ctx, req.resourceType);
  return ctx.can("workflow.request.approve") && (ctx.access.isAdmin || ctx.membership.roleId === req.currentRoleId);
}

export async function decideApproval(ctx: Ctx, input: { id: string; decision: "APPROVED" | "REJECTED"; comment?: string }) {
  const first = await ctx.db.approvalRequest.findFirst({ where: { id: input.id }, select: { id: true, resourceType: true, status: true } });
  if (!first) throw notFound("Demande d'approbation");
  if (!isApprovalType(first.resourceType)) throw businessRule("Type d'approbation inconnu.");
  if (first.status !== "PENDING") throw businessRule("Cette demande a déjà été traitée.");
  if (input.decision === "REJECTED" && !input.comment?.trim()) throw businessRule("Indiquez le motif du refus.");
  const comment = input.comment?.trim() || null;

  const outcome = await ctx.tx(async (tx) => {
    // verrou de ligne : deux décisions simultanées sur la même étape ne peuvent pas toutes deux aboutir
    await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${input.id}::uuid FOR UPDATE`;
    const req = await tx.approvalRequest.findFirstOrThrow({ where: { id: input.id }, include: { decisions: { select: { decidedById: true }, orderBy: { step: "asc" } }, rule: { select: { steps: { orderBy: { stepOrder: "asc" } } } } } });
    if (req.status !== "PENDING") throw businessRule("Cette demande a déjà été traitée.");
    if (req.requestedById === ctx.user.id) throw businessRule("Vous ne pouvez pas valider votre propre demande.");
    if (req.decisions.some((x) => x.decidedById === ctx.user.id)) throw businessRule("Vous avez déjà décidé d'une étape de cette demande : une autre personne doit valider l'étape suivante.");
    if (!canDecideRequest(ctx, req)) throw forbidden(req.ruleId ? "Cette étape est réservée à un autre rôle." : "Vous n'avez pas le droit de valider ce type de demande.");

    const type = req.resourceType as ApprovalType;
    await tx.approvalDecision.create({ data: { companyId: ctx.company.id, requestId: req.id, step: req.currentStep, decidedById: ctx.user.id, decision: input.decision, comment } });

    // étape intermédiaire approuvée → on passe à la suivante, rien n'est encore appliqué à la ressource
    if (input.decision === "APPROVED" && req.currentStep < req.totalSteps) {
      const next = req.rule?.steps.find((s) => s.stepOrder === req.currentStep + 1);
      if (!next) throw conflict("La chaîne de validation a changé : refaites la demande.");
      await tx.approvalRequest.update({ where: { id: req.id }, data: { currentStep: next.stepOrder, currentRoleId: next.roleId, currentLabel: next.label } });
      const ids = await stepApproverIds(tx, ctx, { ...req, currentRoleId: next.roleId });
      await notify(tx, { companyId: ctx.company.id, userIds: ids, type: type === "leave" ? "leave.request" : "approval.pending", title: `À valider (étape ${next.stepOrder}/${req.totalSteps}) : ${req.title}`, body: `Étape précédente validée par ${ctx.user.name}.`, link: "/app/validations" });
      return { final: false as const, req, step: req.currentStep };
    }

    await tx.approvalRequest.update({ where: { id: req.id }, data: { status: input.decision, decidedById: ctx.user.id, decidedAt: new Date(), comment } });
    await emit(tx, ctx, "approval.decided", { requestId: req.id, resourceType: req.resourceType, resourceId: req.resourceId, decision: input.decision });
    await notify(tx, { companyId: ctx.company.id, userIds: [req.requestedById], type: type === "leave" ? "leave.request" : "approval.decided", title: `${input.decision === "APPROVED" ? "Validé" : "Refusé"} : ${req.title}`, body: comment, link: APPROVAL_TYPES[type].href });
    return { final: true as const, req, step: req.currentStep };
  });

  const stepNote = outcome.req.totalSteps > 1 ? ` (étape ${outcome.step}/${outcome.req.totalSteps}${outcome.req.currentLabel ? ` — ${outcome.req.currentLabel}` : ""})` : "";
  await audit(ctx, { action: `approval.${input.decision.toLowerCase()}`, resource: "ApprovalRequest", resourceId: input.id, summary: `${ctx.user.name} a ${input.decision === "APPROVED" ? "validé" : "refusé"} « ${outcome.req.title} »${stepNote}${outcome.final || input.decision === "REJECTED" ? "" : " : transmis à l'étape suivante"}.`, after: { comment, step: outcome.step, final: outcome.final } });
  return { final: outcome.final };
}

// ═══ Lecture ══════════════════════════════════════════════════

export async function listApprovals(ctx: Ctx, p: { status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; skip: number; take: number }) {
  const where = p.status ? { status: p.status } : {};
  const [total, rows] = await Promise.all([
    ctx.db.approvalRequest.count({ where }),
    ctx.db.approvalRequest.findMany({
      where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], skip: p.skip, take: p.take,
      include: { decisions: { orderBy: { step: "asc" }, select: { step: true, decidedById: true, decision: true, comment: true, decidedAt: true } }, rule: { select: { name: true, steps: { orderBy: { stepOrder: "asc" }, select: { stepOrder: true, label: true } } } } },
    }),
  ]);
  return { total, rows };
}

/** Nombre de demandes en attente dont l'étape courante est décidable par l'utilisateur (badge de la barre latérale). */
/** La page « Validations » existe-t-elle pour cet utilisateur ? (droit de lecture + au moins un module concerné actif) */
export function canSeeValidations(ctx: Ctx): boolean {
  return ctx.can("workflow.request.read") && Object.values(APPROVAL_TYPES).some((t) => ctx.hasModule(t.module));
}

export async function pendingDecisionCount(ctx: Ctx): Promise<number> {
  if (!ctx.can("workflow.request.approve")) return 0;
  const types = APPROVAL_TYPE_KEYS.filter((t) => canDecide(ctx, t));
  const mine = [
    ...(types.length ? [{ ruleId: null, currentRoleId: null, resourceType: { in: types } }] : []),
    ...(ctx.access.isAdmin ? [{ ruleId: { not: null } }, { currentRoleId: { not: null } }] : [{ currentRoleId: ctx.membership.roleId }]),
  ];
  return ctx.db.approvalRequest.count({ where: { status: "PENDING", requestedById: { not: ctx.user.id }, decisions: { none: { decidedById: ctx.user.id } }, OR: mine } });
}

/** Personnes pouvant décider de la 1re étape de l'opération du demandeur courant (vide = personne d'autre que lui : auto-approbation des congés). */
export async function availableApprovers(tx: Db, ctx: Ctx, type: ApprovalType, amount: Numeric): Promise<string[]> {
  const flow = await resolveFlow(tx, ctx, type, amount);
  if (!flow.required) return [];
  const roleId = flow.steps[0]?.roleId;
  if (!roleId) return approverIds(tx, ctx, type, ctx.user.id);
  const members = await tx.companyMembership.findMany({ where: { status: "ACTIVE", userId: { not: ctx.user.id }, OR: [{ roleId }, { role: { isAdmin: true } }] }, select: { userId: true } });
  return members.map((m) => m.userId);
}
