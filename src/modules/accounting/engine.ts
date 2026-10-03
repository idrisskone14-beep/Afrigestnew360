import "server-only";
import type { Db } from "@/core/db/client";
import { businessRule, notFound } from "@/core/errors";
import { d, roundMoney, type Numeric } from "@/core/money";
import { nextNumber } from "@/core/numbering";
import type { TenantContext } from "@/core/tenant/context";
import { MAPPING_KEYS, ensureAccountingDefaults, ensureCalendarYear, type MappingKey } from "./chart";

type Ctx = Pick<TenantContext, "company" | "user">;

/** Jour calendaire (UTC, minuit) d'une date quelconque. */
export const toDay = (v: Date | string): Date => {
  const dt = typeof v === "string" ? new Date(v) : v;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
};

export interface EntryLineInput {
  /** Code du compte (ex. "411") ou `mapping` pour un compte paramétré. */
  account?: string;
  mapping?: MappingKey;
  label: string;
  debit?: Numeric;
  credit?: Numeric;
  partyType?: "customer" | "supplier";
  partyId?: string | null;
}

export interface EntryInput {
  journal: string;
  date: Date;
  description: string;
  reference?: string | null;
  lines: EntryLineInput[];
  sourceType?: string;
  sourceId?: string;
  reversalOfId?: string;
  /** Contre-passations et à-nouveaux : autorisés même sur un compte désactivé depuis. */
  allowInactive?: boolean;
}

/** Comptes paramétrés (clé → compte) ; initialise le plan par défaut si l'entreprise n'en a pas encore. */
export async function loadMappings(tx: Db, companyId: string) {
  let maps = await tx.accountMapping.findMany({ where: { companyId }, include: { ledgerAccount: true } });
  if (maps.length < Object.keys(MAPPING_KEYS).length) {
    await ensureAccountingDefaults(tx, companyId);
    maps = await tx.accountMapping.findMany({ where: { companyId }, include: { ledgerAccount: true } });
  }
  return new Map(maps.map((m) => [m.key as MappingKey, m.ledgerAccount]));
}

async function resolvePeriod(tx: Db, companyId: string, date: Date) {
  let period = await tx.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: date }, endDate: { gte: date } }, include: { fiscalYear: true } });
  if (!period) {
    // aucun exercice ne couvre cette date : création de l'exercice calendaire correspondant
    await ensureCalendarYear(tx, companyId, date.getUTCFullYear());
    period = await tx.accountingPeriod.findFirst({ where: { companyId, startDate: { lte: date }, endDate: { gte: date } }, include: { fiscalYear: true } });
  }
  if (!period) throw businessRule(`Aucun exercice comptable ne couvre le ${date.toISOString().slice(0, 10)}.`);
  if (period.fiscalYear.status === "CLOSED") throw businessRule(`L'exercice ${period.fiscalYear.name} est clôturé : aucune écriture n'y est possible.`);
  if (period.status === "LOCKED") throw businessRule(`La période du ${period.startDate.toISOString().slice(0, 10)} au ${period.endDate.toISOString().slice(0, 10)} est verrouillée.`);
  return period;
}

/**
 * Enregistre une écriture VALIDÉE (immuable) dans la transaction courante : équilibre débit = crédit, période ouverte,
 * numéro séquentiel. Une écriture n'est générée qu'une fois par document (`sourceType` + `sourceId` uniques).
 */
export async function postEntry(tx: Db, ctx: Ctx, input: EntryInput) {
  const companyId = ctx.company.id;
  const currency = ctx.company.currency;
  if (input.sourceType && input.sourceId) {
    const existing = await tx.journalEntry.findFirst({ where: { companyId, sourceType: input.sourceType, sourceId: input.sourceId } });
    if (existing) return existing;
  }
  const maps = input.lines.some((l) => l.mapping) ? await loadMappings(tx, companyId) : null;
  const codes = [...new Set(input.lines.map((l) => l.account).filter((c): c is string => Boolean(c)))];
  const accounts = codes.length ? await tx.ledgerAccount.findMany({ where: { companyId, code: { in: codes } } }) : [];
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  const lines = input.lines
    .map((l, i) => {
      const acc = l.mapping ? maps!.get(l.mapping) : l.account ? byCode.get(l.account) : undefined;
      if (!acc) throw businessRule(`Compte comptable introuvable : ${l.mapping ?? l.account}. Vérifiez le plan comptable et la table de correspondance.`);
      if (!acc.isActive && !input.allowInactive) throw businessRule(`Le compte ${acc.code} « ${acc.name} » est désactivé.`);
      return { position: i, ledgerAccountId: acc.id, label: l.label, debit: roundMoney(l.debit ?? 0, currency), credit: roundMoney(l.credit ?? 0, currency), partyType: l.partyType ?? null, partyId: l.partyId ?? null };
    })
    .filter((l) => l.debit.gt(0) || l.credit.gt(0));
  const totalDebit = lines.reduce((a, l) => a.plus(l.debit), d(0));
  const totalCredit = lines.reduce((a, l) => a.plus(l.credit), d(0));
  if (lines.length < 2 || totalDebit.lte(0)) throw businessRule("Une écriture comptable comporte au moins deux lignes non nulles.");
  if (!totalDebit.eq(totalCredit)) throw businessRule(`Écriture déséquilibrée : débit ${totalDebit.toString()} ≠ crédit ${totalCredit.toString()}.`);

  const journal = await tx.journal.findFirst({ where: { companyId, code: input.journal } });
  if (!journal || !journal.isActive) throw notFound(`Journal ${input.journal}`);
  const date = toDay(input.date);
  const period = await resolvePeriod(tx, companyId, date);
  const number = await nextNumber(tx, companyId, "journal_entry", date);
  const entry = await tx.journalEntry.create({
    data: {
      companyId, number, journalId: journal.id, fiscalYearId: period.fiscalYearId, periodId: period.id, date, reference: input.reference ?? null, description: input.description,
      sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, reversalOfId: input.reversalOfId ?? null, createdById: ctx.user.id,
      lines: { create: lines.map((l) => ({ companyId, position: l.position, ledgerAccountId: l.ledgerAccountId, label: l.label, debit: l.debit.toString(), credit: l.credit.toString(), partyType: l.partyType, partyId: l.partyId })) },
    },
  });
  // la validation fige l'écriture (trigger d'immutabilité)
  return tx.journalEntry.update({ where: { id: entry.id }, data: { status: "POSTED", postedAt: new Date(), postedById: ctx.user.id } });
}

/**
 * Contre-passation de l'écriture générée par un document (annulation d'une facture, d'un paiement…) : mêmes comptes, sens inversé.
 * Sans effet si le document n'a jamais été comptabilisé (module activé après coup) ou déjà contre-passé.
 */
export async function reverseSource(tx: Db, ctx: Ctx, sourceType: string, sourceId: string, date: Date, description?: string) {
  const original = await tx.journalEntry.findFirst({ where: { companyId: ctx.company.id, sourceType, sourceId }, include: { lines: true, journal: true } });
  if (!original) return null;
  return reverseEntryRecord(tx, ctx, original, `${sourceType}:reversal`, sourceId, date, description);
}

export async function reverseEntryRecord(
  tx: Db, ctx: Ctx,
  original: { id: string; number: string; description: string; journal: { code: string }; lines: { ledgerAccountId: string; label: string; debit: unknown; credit: unknown; partyType: string | null; partyId: string | null }[] },
  sourceType: string, sourceId: string, date: Date, description?: string,
) {
  const existing = await tx.journalEntry.findFirst({ where: { companyId: ctx.company.id, sourceType, sourceId } });
  if (existing) return existing;
  const accounts = await tx.ledgerAccount.findMany({ where: { id: { in: original.lines.map((l) => l.ledgerAccountId) } } });
  const code = new Map(accounts.map((a) => [a.id, a.code]));
  return postEntry(tx, ctx, {
    journal: original.journal.code, date, description: description ?? `Contre-passation de ${original.number} — ${original.description}`, reference: original.number,
    sourceType, sourceId, reversalOfId: original.id, allowInactive: true,
    lines: original.lines.map((l) => ({ account: code.get(l.ledgerAccountId)!, label: l.label, debit: l.credit as Numeric, credit: l.debit as Numeric, partyType: (l.partyType as "customer" | "supplier" | null) ?? undefined, partyId: l.partyId })),
  });
}
