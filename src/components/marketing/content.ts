export const PROBLEMS = [
  { title: "Des outils dispersés", text: "Excel pour le stock, un logiciel pour la compta, WhatsApp pour les commandes : l'information est partout, jamais au même endroit." },
  { title: "Aucune vision en temps réel", text: "Combien avons-nous en banque ? Qui nous doit de l'argent ? Il faut attendre la fin du mois pour le savoir." },
  { title: "Factures et relances oubliées", text: "Des impayés qui s'accumulent faute de suivi, des devis jamais transformés en factures." },
  { title: "Stocks et achats mal maîtrisés", text: "Ruptures imprévues, sur-stockage, commandes fournisseur sans validation ni traçabilité." },
  { title: "Équipes et projets difficiles à piloter", text: "Congés, présences, tâches et budgets de projets suivis à la main, sans lien avec les coûts réels." },
  { title: "Peu de contrôle sur les accès", text: "Tout le monde voit tout, ou personne ne voit rien : impossible de déléguer sereinement." },
];

export const PILLARS = [
  { title: "Une seule plateforme", text: "Finance, ventes, achats, stocks, RH, projets et documents partagent les mêmes données : un devis devient une facture sans ressaisie, une réception alimente le stock, un paiement écrit en comptabilité." },
  { title: "Pensée pour l'Afrique", text: "FCFA par défaut (XOF/XAF) et multi-devises, plan comptable compatible SYSCOHADA, interface en français, mobile-first." },
  { title: "Modulaire, vous payez ce que vous utilisez", text: "Activez les modules dont vous avez besoin, ajoutez des extensions métier (transport, chantiers) quand vous grandissez." },
];

export const STEPS = [
  { n: "1", title: "Créez votre entreprise", text: "Quelques minutes : identité, pays, devise, exercice. Vos rôles et votre siège sont prêts." },
  { n: "2", title: "Invitez votre équipe", text: "Attribuez des rôles précis : chacun ne voit que ce qui le concerne." },
  { n: "3", title: "Activez vos modules", text: "Finance, ventes, stock, RH… selon votre offre. D'autres s'ajoutent à tout moment." },
  { n: "4", title: "Pilotez", text: "Un tableau de bord exécutif, des alertes et des rapports pour décider vite." },
];

export const BENEFITS = [
  { title: "Gagnez du temps", text: "Zéro ressaisie entre devis, commande, facture et paiement." },
  { title: "Décidez sur des chiffres justes", text: "Trésorerie, créances, dettes et marges toujours à jour." },
  { title: "Gardez le contrôle", text: "Permissions fines, validations, journal d'audit complet." },
  { title: "Travaillez partout", text: "Interface adaptée au téléphone, à la tablette et à l'ordinateur." },
  { title: "Évoluez sans migrer", text: "Ajoutez des modules, des agences ou des entreprises sur le même compte." },
  { title: "Restez maître de vos données", text: "Chaque entreprise est isolée ; vos exports sont à vous." },
];

export const SECTORS_LIST = [
  { title: "Commerce & distribution", text: "Ventes, stocks multi-entrepôts, achats fournisseurs, encaissements." },
  { title: "Services & conseil", text: "Devis, facturation récurrente, projets, temps passé, rentabilité." },
  { title: "BTP & chantiers", text: "Chantiers, matériaux, sous-traitants, budgets et avancement." },
  { title: "Transport & logistique", text: "Flotte, missions, carburant, entretiens, contraventions, coûts par véhicule." },
  { title: "Industrie & production", text: "Approvisionnement, stocks, coûts, suivi des équipes." },
  { title: "Agriculture & agroalimentaire", text: "Achats, stocks, ventes, multi-sites." },
  { title: "Éducation & formation", text: "Employés, projets, finances, documents." },
  { title: "ONG & associations", text: "Budgets par projet, justificatifs, validations, reporting." },
];

export const SECURITY_POINTS = [
  { title: "Isolation stricte entre entreprises", text: "Appliquée par le serveur et par la base de données (Row Level Security) : jamais seulement masquée à l'écran." },
  { title: "Permissions granulaires", text: "Plus de 100 permissions, rôles personnalisés par entreprise, validations configurables." },
  { title: "Authentification renforcée", text: "Mots de passe hachés, double authentification (2FA), verrouillage anti-force brute, sessions révocables à distance." },
  { title: "Journal d'audit infalsifiable", text: "Qui a fait quoi, quand, avant/après : les utilisateurs ne peuvent ni modifier ni supprimer le journal." },
  { title: "Modules cloisonnés", text: "Un module non activé est inaccessible, même en saisissant son adresse." },
  { title: "Données protégées", text: "Secrets chiffrés (AES-256), en-têtes de sécurité, erreurs sans détails techniques." },
];

export const FAQ = [
  { q: "À qui s'adresse AfriGest 360 ?", a: "Aux PME et ETI qui veulent centraliser leur gestion : commerce, services, BTP, transport, industrie, ONG… Une même plateforme peut gérer une ou plusieurs entreprises." },
  { q: "Puis-je gérer plusieurs entreprises avec un seul compte ?", a: "Oui. Un utilisateur peut appartenir à plusieurs entreprises avec un rôle différent dans chacune (administrateur ici, consultation là) et bascule de l'une à l'autre en un clic. Les données restent strictement séparées." },
  { q: "Les montants sont-ils en FCFA ?", a: "La devise par défaut est le FCFA (XOF), avec une architecture multi-devises. Chaque entreprise choisit sa devise principale." },
  { q: "La comptabilité est-elle compatible SYSCOHADA ?", a: "L'architecture comptable (plan de comptes paramétrable, journaux, écritures, exercices) est conçue pour le SYSCOHADA. Le module Comptabilité est en cours de livraison : demandez-nous le calendrier." },
  { q: "Quels modules sont disponibles aujourd'hui ?", a: "Les fondations (comptes, entreprises, rôles et permissions, offres et modules, administration) sont opérationnelles. Les modules métier arrivent par étapes ; la page Fonctionnalités indique l'état de chacun." },
  { q: "Mes données sont-elles en sécurité ?", a: "Chaque entreprise est isolée au niveau du serveur et de la base de données, les accès sont contrôlés par rôles, et toutes les actions sensibles sont journalisées." },
  { q: "Puis-je essayer avant de m'engager ?", a: "Oui : les offres incluent une période d'essai. Demandez une démonstration pour qu'un conseiller configure un environnement adapté à votre activité." },
];

/** Cas d'usage illustratifs (personas) — à remplacer par de vrais témoignages clients avant la mise en production. */
export const USE_CASES = [
  { initials: "DG", role: "Directrice générale — distribution", quote: "Je veux ouvrir mon tableau de bord le matin et savoir où en sont mes ventes, ma trésorerie et mes impayés, sans appeler trois personnes.", benefit: "Pilotage en temps réel" },
  { initials: "RC", role: "Responsable comptable — services", quote: "Quand une facture est payée, l'écriture comptable doit se faire toute seule. Fini les doubles saisies entre ventes et compta.", benefit: "Zéro ressaisie" },
  { initials: "GE", role: "Gérant — multi-sociétés", quote: "J'administre deux sociétés et je conseille une troisième. Un seul compte, des droits différents dans chacune, et jamais de mélange des données.", benefit: "Multi-entreprises" },
];

export const FEATURE_GROUPS = [
  { module: "finance", title: "Finance", bullets: ["Recettes, dépenses et catégories", "Banques, caisses, transferts", "Budgets, prévisions, centres de coûts", "Échéances et trésorerie prévisionnelle"] },
  { module: "accounting", title: "Comptabilité", bullets: ["Plan comptable compatible SYSCOHADA", "Journaux, écritures, pièces comptables", "Grand livre, balance, compte de résultat, bilan", "Verrouillage de période, clôture d'exercice"] },
  { module: "sales", title: "Ventes & facturation", bullets: ["Devis, proformas, commandes, bons de livraison", "Factures, avoirs, reçus, paiements partiels", "Échéanciers et relances automatiques", "Numérotation configurable (FAC-2026-00001)", "PDF professionnels à votre logo"] },
  { module: "crm", title: "CRM & clients", bullets: ["Prospects, clients, contacts", "Pipeline commercial configurable", "Activités, rendez-vous, relances", "Fiche client 360° : devis, factures, paiements, solde"] },
  { module: "purchases", title: "Achats & fournisseurs", bullets: ["Demandes d'achat avec approbation", "Commandes, réceptions, factures fournisseur", "Réception qui alimente le stock", "Historique et paiements fournisseurs"] },
  { module: "inventory", title: "Stock & inventaire", bullets: ["Produits, variantes, codes-barres", "Entrepôts, emplacements, transferts", "Mouvements traçables, valorisation", "Alertes de seuil minimum"] },
  { module: "hr", title: "Ressources humaines", bullets: ["Fiche employé et organigramme", "Présences, retards, absences", "Congés avec validation manager puis RH", "Contrats, évaluations, formations"] },
  { module: "payroll", title: "Paie", bullets: ["Rubriques et barèmes entièrement configurables", "Primes, retenues, avances, heures supplémentaires", "Bulletins de paie PDF", "Charges comptabilisées automatiquement"] },
  { module: "projects", title: "Projets & tâches", bullets: ["Vues Liste, Kanban, Calendrier, Gantt", "Budgets, coûts et temps passé", "Jalons, commentaires, pièces jointes", "Rentabilité par projet"] },
  { module: "documents", title: "Documents (GED)", bullets: ["Dossiers, versions, tags", "Partage interne et permissions", "Liens vers clients, factures, employés, véhicules", "Recherche et archivage"] },
  { module: "reports", title: "Rapports & analytics", bullets: ["Ventes, dépenses, résultat, trésorerie", "Créances clients, dettes fournisseurs", "Filtres par période, agence, projet, centre de coûts", "Exports PDF et Excel, impression"] },
  { module: "fleet", title: "Transport & flotte", bullets: ["Véhicules, chauffeurs, missions", "Carburant, kilométrage, entretiens", "Assurances, visites techniques, alertes", "Contraventions et rentabilité par véhicule"] },
  { module: "construction", title: "Gestion de chantiers", bullets: ["Chantiers, équipes, engins, matériaux", "Sous-traitants et dépenses", "Avancement, rapports terrain, photos", "Connecté à Finance, Stock, RH, Projets, Achats"] },
  { module: "intelligence", title: "AfriGest Intelligence", bullets: ["Posez vos questions en langage naturel", "Réponses limitées à vos données autorisées", "Jamais d'accès aux modules désactivés", "Insights et recommandations"] },
];

export const SOLUTIONS = [
  { slug: "dirigeants", title: "Dirigeants & DG", pain: "Savoir, à tout moment, où en est l'entreprise.", points: ["Tableau de bord exécutif (CA, dépenses, trésorerie, créances)", "Alertes : factures échues, stocks critiques, validations en attente", "Vue par agence, entreprise ou projet"], modules: ["reports", "intelligence", "finance"] },
  { slug: "finance", title: "Finance & comptabilité", pain: "Des chiffres fiables, une clôture sereine.", points: ["Encaissements, décaissements, rapprochements", "Écritures générées depuis les opérations validées", "Exercices, périodes verrouillables, exports"], modules: ["finance", "accounting", "sales"] },
  { slug: "commercial", title: "Ventes & commercial", pain: "Transformer plus de prospects en paiements.", points: ["Pipeline et opportunités", "Devis → commande → livraison → facture sans ressaisie", "Relances et solde client en un clic"], modules: ["crm", "sales"] },
  { slug: "logistique", title: "Achats, stock & logistique", pain: "Ne plus jamais être en rupture ni sur-stocké.", points: ["Demandes d'achat validées par seuil", "Réception → stock automatique", "Inventaires, transferts, valorisation"], modules: ["purchases", "inventory", "fleet"] },
  { slug: "rh", title: "RH & paie", pain: "Gérer les équipes sans paperasse.", points: ["Dossier employé et organigramme", "Congés avec circuit de validation", "Paie configurable et bulletins PDF"], modules: ["hr", "payroll"] },
  { slug: "projets", title: "Projets & chantiers", pain: "Livrer dans les délais et le budget.", points: ["Tâches, jalons, Kanban et Gantt", "Coûts réels vs budget", "Rapports terrain et documents rattachés"], modules: ["projects", "construction", "documents"] },
];
