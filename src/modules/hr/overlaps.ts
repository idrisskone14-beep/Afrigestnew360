import "server-only";
import type { Db } from "@/core/db/client";
import { businessRule } from "@/core/errors";
import { addDays, intervalOf, overlaps, type Interval } from "./time";

/**
 * Chevauchements incompatibles d'un salarié : un même instant ne peut pas être à la fois un congé, une permission et une absence.
 * Seules les demandes EN ATTENTE ou APPROUVÉES comptent (un brouillon, un refus ou une annulation ne bloquent rien).
 * Deux permissions horaires le même jour sont compatibles tant que leurs plages ne se recouvrent pas.
 */
const ACTIVE = ["PENDING", "APPROVED"] as const;
const fr = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const STATUS_FR: Record<string, string> = { PENDING: "en attente", APPROVED: "validé(e)" };

export type ConflictScope = "leave" | "timeoff" | "absence" | "sickleave";

export async function assertNoConflict(
  db: Pick<Db, "leaveRequest" | "timeOffRequest" | "absenceRecord" | "sickLeave">,
  employeeId: string,
  period: { startDate: Date; startTime: string | null; endDate: Date; endTime: string | null },
  /** Enregistrement en cours de saisie, exclu de la comparaison. */
  ignore?: { kind: ConflictScope; id: string },
): Promise<void> {
  const me: Interval = intervalOf(period.startDate, period.startTime, period.endDate, period.endTime);
  const range = { startDate: { lte: period.endDate }, endDate: { gte: period.startDate } };
  const skip = (kind: ConflictScope) => (ignore?.kind === kind ? { id: { not: ignore.id } } : {});
  const [leaves, offs, absences, sicks] = await Promise.all([
    db.leaveRequest.findMany({ where: { employeeId, status: { in: [...ACTIVE] }, ...range, ...skip("leave") }, select: { startDate: true, endDate: true, status: true, type: { select: { name: true } } } }),
    db.timeOffRequest.findMany({ where: { employeeId, status: { in: [...ACTIVE] }, ...range, ...skip("timeoff") }, select: { startDate: true, startTime: true, endDate: true, endTime: true, status: true, type: { select: { name: true } } } }),
    db.absenceRecord.findMany({ where: { employeeId, status: { in: [...ACTIVE] }, ...range, ...skip("absence") }, select: { startDate: true, endDate: true, status: true, type: { select: { name: true } } } }),
    // un arrêt maladie occupe ses jours jusqu'à la veille de la reprise (ou jusqu'à la fin prévue)
    db.sickLeave.findMany({ where: { employeeId, status: { in: ["ONGOING", "ENDED"] }, startDate: { lte: period.endDate }, ...skip("sickleave") }, select: { startDate: true, expectedEndDate: true, returnDate: true } }),
  ]);
  for (const l of leaves) {
    if (overlaps(me, intervalOf(l.startDate, null, l.endDate, null))) throw businessRule(`Chevauche un congé « ${l.type.name} » du ${fr(l.startDate)} au ${fr(l.endDate)} (${STATUS_FR[l.status]}).`);
  }
  for (const o of offs) {
    if (overlaps(me, intervalOf(o.startDate, o.startTime, o.endDate, o.endTime))) {
      throw businessRule(`Chevauche une permission « ${o.type.name} » du ${fr(o.startDate)}${o.startTime ? ` ${o.startTime}` : ""} au ${fr(o.endDate)}${o.endTime ? ` ${o.endTime}` : ""} (${STATUS_FR[o.status]}).`);
    }
  }
  for (const s of sicks) {
    const last = s.returnDate ? addDays(s.returnDate, -1) : s.expectedEndDate;
    if (last >= period.startDate && overlaps(me, intervalOf(s.startDate, null, last, null))) throw businessRule(`Chevauche un arrêt maladie du ${fr(s.startDate)} au ${fr(last)}.`);
  }
  for (const a of absences) {
    if (overlaps(me, intervalOf(a.startDate, null, a.endDate, null))) throw businessRule(`Chevauche une absence « ${a.type.name} » du ${fr(a.startDate)} au ${fr(a.endDate)} (${STATUS_FR[a.status]}).`);
  }
}
