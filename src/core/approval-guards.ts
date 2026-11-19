import type { ApprovalType } from "@/core/approval-types";
import type { Db } from "@/core/db/client";
import type { TenantContext } from "@/core/tenant/context";

/**
 * Garde de décision propre à un type : le module concerné peut restreindre QUI décide d'une demande précise (ex. un responsable ne valide que les
 * demandes de son équipe). Exécutée dans la transaction de décision, après les contrôles communs ; elle refuse en levant une erreur.
 * Module « feuille » (aucun import d'exécution) : les modules s'y enregistrent sans créer de cycle avec le moteur d'approbation.
 */
export type DecisionGuard = (tx: Db, ctx: TenantContext, req: { resourceId: string; requestedById: string; /** Règle de validation à étapes appliquée ; null = politique simple (droit du type). */ ruleId: string | null }) => Promise<void>;

const guards = new Map<ApprovalType, DecisionGuard>();
export const registerDecisionGuard = (type: ApprovalType, guard: DecisionGuard) => { guards.set(type, guard); };
export const decisionGuardOf = (type: ApprovalType) => guards.get(type);
