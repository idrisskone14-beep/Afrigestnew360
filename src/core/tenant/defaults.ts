import "server-only";
import type { Db } from "@/core/db/client";
import { DEFAULT_VAT_RATE } from "@/lib/reference-data";
import { ensureAccountingDefaults } from "@/modules/accounting/chart";
import { ensureHrDefaults } from "@/modules/hr/people";

const INCOME_CATEGORIES = ["Apport en capital", "Subventions et aides", "Autres produits"];
const EXPENSE_CATEGORIES = [
  "Loyer et charges locatives", "Salaires et charges sociales", "Transport et carburant", "Électricité, eau, internet", "Entretien et réparations",
  "Fournitures de bureau", "Marketing et publicité", "Frais bancaires", "Impôts et taxes", "Déplacements et missions", "Divers",
];

const DEFAULT_STAGES = [
  { name: "Nouveau", probability: 10, kind: "OPEN" },
  { name: "Contacté", probability: 20, kind: "OPEN" },
  { name: "Qualifié", probability: 40, kind: "OPEN" },
  { name: "Proposition", probability: 60, kind: "OPEN" },
  { name: "Négociation", probability: 80, kind: "OPEN" },
  { name: "Gagné", probability: 100, kind: "WON" },
  { name: "Perdu", probability: 0, kind: "LOST" },
] as const;

/**
 * Configuration initiale d'une entreprise (idempotente : ne crée que ce qui manque).
 * Appelée à la création de l'entreprise et par le seed pour les entreprises existantes.
 * Chaque sous-livraison de la phase 3 y ajoute ses valeurs par défaut.
 */
export async function ensureCompanyDefaults(tx: Db, companyId: string, country: string) {
  // Taxes
  if ((await tx.tax.count({ where: { companyId } })) === 0) {
    const vat = DEFAULT_VAT_RATE[country] ?? 18;
    await tx.tax.createMany({
      data: [
        { companyId, name: `TVA ${vat} %`, rate: vat, isDefault: true },
        { companyId, name: "Exonéré (0 %)", rate: 0, isDefault: false },
      ],
    });
  }
  // Entrepôt principal
  if ((await tx.warehouse.count({ where: { companyId } })) === 0) {
    await tx.warehouse.create({ data: { companyId, name: "Entrepôt principal", code: "MAIN", isDefault: true } });
  }
  // Trésorerie : une caisse et un compte bancaire principaux (soldes à zéro, à renseigner par l'entreprise)
  if ((await tx.financeAccount.count({ where: { companyId } })) === 0) {
    const { currency } = await tx.company.findFirstOrThrow({ where: { id: companyId }, select: { currency: true } });
    await tx.financeAccount.createMany({
      data: [
        { companyId, name: "Caisse principale", type: "CASH", currency, isDefault: true },
        { companyId, name: "Banque principale", type: "BANK", currency, isDefault: true },
      ],
    });
  }
  // Catégories financières
  if ((await tx.financeCategory.count({ where: { companyId } })) === 0) {
    await tx.financeCategory.createMany({
      data: [
        ...INCOME_CATEGORIES.map((name) => ({ companyId, name, kind: "INCOME" as const })),
        ...EXPENSE_CATEGORIES.map((name) => ({ companyId, name, kind: "EXPENSE" as const })),
      ],
    });
  }
  // Comptabilité : plan comptable, journaux, correspondances, exercice en cours
  await ensureAccountingDefaults(tx, companyId);
  // RH : types de congé
  await ensureHrDefaults(tx, companyId);
  // Pipeline commercial
  if ((await tx.pipelineStage.count({ where: { companyId } })) === 0) {
    await tx.pipelineStage.createMany({ data: DEFAULT_STAGES.map((s, i) => ({ companyId, position: i, ...s })) });
  }
}
