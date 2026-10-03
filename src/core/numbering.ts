import "server-only";
import type { Db } from "@/core/db/client";

export interface NumberingDefault {
  label: string;
  prefix: string;
  padding: number;
  withYear: boolean;
}

/** Types de documents numérotés et format par défaut (modifiable par entreprise dans Paramètres). */
export const NUMBERING_DEFAULTS = {
  customer: { label: "Clients", prefix: "CLI", padding: 5, withYear: false },
  product: { label: "Produits (références)", prefix: "PRD", padding: 5, withYear: false },
  supplier: { label: "Fournisseurs", prefix: "FOU", padding: 5, withYear: false },
  quote: { label: "Devis", prefix: "DEV", padding: 5, withYear: true },
  proforma: { label: "Proformas", prefix: "PRO", padding: 5, withYear: true },
  order: { label: "Commandes clients", prefix: "CMD", padding: 5, withYear: true },
  delivery: { label: "Bons de livraison", prefix: "BL", padding: 5, withYear: true },
  invoice: { label: "Factures", prefix: "FAC", padding: 5, withYear: true },
  credit_note: { label: "Avoirs", prefix: "AV", padding: 5, withYear: true },
  receipt: { label: "Reçus de paiement", prefix: "REC", padding: 5, withYear: true },
  purchase_request: { label: "Demandes d'achat", prefix: "DA", padding: 5, withYear: true },
  purchase_order: { label: "Commandes fournisseur", prefix: "BC", padding: 5, withYear: true },
  goods_receipt: { label: "Réceptions", prefix: "BR", padding: 5, withYear: true },
  supplier_bill: { label: "Factures fournisseur", prefix: "FF", padding: 5, withYear: true },
  payment_out: { label: "Paiements fournisseurs", prefix: "PAI", padding: 5, withYear: true },
  expense: { label: "Dépenses", prefix: "DEP", padding: 5, withYear: true },
  journal_entry: { label: "Écritures comptables", prefix: "ECR", padding: 6, withYear: true },
  employee: { label: "Salariés (matricules)", prefix: "EMP", padding: 4, withYear: false },
  payslip: { label: "Bulletins de paie", prefix: "BUL", padding: 5, withYear: true },
  project: { label: "Projets", prefix: "PRJ", padding: 4, withYear: false },
  trip: { label: "Missions (transport)", prefix: "MIS", padding: 5, withYear: true },
  site: { label: "Chantiers", prefix: "CHA", padding: 4, withYear: false },
} as const satisfies Record<string, NumberingDefault>;

export type NumberingKey = keyof typeof NUMBERING_DEFAULTS;
export const NUMBERING_KEYS = Object.keys(NUMBERING_DEFAULTS) as NumberingKey[];

export interface NumberFormat {
  prefix: string;
  padding: number;
  withYear: boolean;
  resetYearly: boolean;
}

/** DEV-2026-00001 (ou CLI-00001 sans année). Pur et testable. */
export function formatNumber(fmt: Pick<NumberFormat, "prefix" | "padding" | "withYear">, seq: number, year: number): string {
  const parts = [fmt.prefix, ...(fmt.withYear ? [String(year)] : []), String(seq).padStart(fmt.padding, "0")];
  return parts.join("-");
}

/**
 * Numéro suivant, ATOMIQUE (INSERT … ON CONFLICT DO UPDATE … RETURNING) : deux créations simultanées
 * ne peuvent jamais obtenir le même numéro. À appeler dans une transaction `ctx.tx`.
 */
export async function nextNumber(tx: Db, companyId: string, key: NumberingKey, date = new Date()): Promise<string> {
  const def = NUMBERING_DEFAULTS[key];
  const cfg = await tx.numberingConfig.findFirst({ where: { key } });
  const fmt: NumberFormat = cfg ?? { prefix: def.prefix, padding: def.padding, withYear: def.withYear, resetYearly: true };
  const year = date.getFullYear();
  const seqYear = fmt.resetYearly ? year : 0;

  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "NumberSequence" ("id", "companyId", "key", "year", "last", "updatedAt")
    VALUES (gen_random_uuid(), ${companyId}::uuid, ${key}, ${seqYear}, 1, now())
    ON CONFLICT ("companyId", "key", "year")
    DO UPDATE SET "last" = "NumberSequence"."last" + 1, "updatedAt" = now()
    RETURNING "last"`;
  return formatNumber(fmt, rows[0]!.last, year);
}
