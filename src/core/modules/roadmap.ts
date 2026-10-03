/** Contenu affiché par un module dont les écrans ne sont pas encore livrés (architecture et garde d'accès déjà actives). */
export const MODULE_ROADMAP: Record<string, { phase: number; highlights: string[] }> = {
  finance: { phase: 3, highlights: ["Recettes, dépenses et catégories", "Comptes bancaires et caisses, transferts", "Budgets, prévisions, échéances"] },
  accounting: { phase: 3, highlights: ["Plan comptable compatible SYSCOHADA", "Journaux, écritures, grand livre, balance", "Compte de résultat, bilan, clôture d'exercice"] },
  sales: { phase: 3, highlights: ["Devis → commande → livraison → facture → paiement", "Numérotation configurable (FAC-2026-00001)", "PDF professionnels avec logo"] },
  crm: { phase: 3, highlights: ["Prospects, clients, contacts", "Pipeline commercial configurable", "Fiche client 360°"] },
  purchases: { phase: 3, highlights: ["Demandes d'achat avec approbation", "Commandes, réceptions, factures fournisseur", "Réception qui alimente automatiquement le stock"] },
  inventory: { phase: 3, highlights: ["Produits, entrepôts, emplacements", "Mouvements traçables, valorisation", "Alertes de seuil minimum"] },
  hr: { phase: 4, highlights: ["Fiche employé et organigramme", "Présences, congés avec workflow de validation", "Contrats, évaluations, formations"] },
  payroll: { phase: 4, highlights: ["Rubriques et barèmes configurables", "Bulletins de paie PDF", "Écritures de charges en comptabilité"] },
  projects: { phase: 4, highlights: ["Vues Liste, Kanban, Calendrier, Gantt", "Budgets, coûts et temps passé", "Rentabilité par projet"] },
  documents: { phase: 4, highlights: ["Dossiers, versions, partage interne", "Liens vers clients, factures, employés…", "Recherche et archivage"] },
  reports: { phase: 5, highlights: ["Rapports transversaux filtrables", "Exports PDF et Excel, impression", "Analyses par agence et centre de coûts"] },
  fleet: { phase: 6, highlights: ["Véhicules, chauffeurs, missions", "Entretiens, assurances, alertes d'échéance", "Contraventions et analyses"] },
  construction: { phase: 6, highlights: ["Chantiers, équipes, matériaux", "Rapports terrain et avancement", "Connecté à Finance, Stock, RH, Projets, Achats"] },
  intelligence: { phase: 7, highlights: ["Questions en langage naturel sur vos données", "Respect strict des permissions et des modules actifs", "Jamais d'accès aux données d'une autre entreprise"] },
};
