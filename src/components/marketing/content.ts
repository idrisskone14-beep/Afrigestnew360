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
  { q: "À qui s'adresse Global Gest ?", a: "Aux PME et ETI qui veulent centraliser leur gestion : commerce, services, BTP, transport, industrie, ONG… Une même plateforme peut gérer une ou plusieurs entreprises." },
  { q: "Puis-je gérer plusieurs entreprises avec un seul compte ?", a: "Oui. Un utilisateur peut appartenir à plusieurs entreprises avec un rôle différent dans chacune (administrateur ici, consultation là) et bascule de l'une à l'autre en un clic. Les données restent strictement séparées." },
  { q: "Les montants sont-ils en FCFA ?", a: "La devise par défaut est le FCFA (XOF), avec une architecture multi-devises. Chaque entreprise choisit sa devise principale." },
  { q: "La comptabilité est-elle compatible SYSCOHADA ?", a: "Oui. Le module Comptabilité propose un plan de comptes compatible SYSCOHADA (paramétrable), des journaux, des écritures générées automatiquement par les ventes, les achats et les paiements, la gestion des exercices, le grand livre, la balance, le compte de résultat et le bilan. Le plan et les états sont simplifiés : faites-les valider par votre expert-comptable, la liasse fiscale officielle n'est pas générée." },
  { q: "Quels modules sont disponibles aujourd'hui ?", a: "Finance, Comptabilité, Ventes et facturation, CRM, Achats, Stock, Ressources humaines, Paie, Projets, Documents et Rapports sont disponibles, ainsi que les extensions Transport et flotte et Gestion de chantiers, selon votre offre. Seul l'assistant Global Gest Intelligence est encore à venir. La page Fonctionnalités détaille chaque module." },
  { q: "Mes données sont-elles en sécurité ?", a: "Chaque entreprise est isolée au niveau du serveur et de la base de données, les accès sont contrôlés par rôles, et toutes les actions sensibles sont journalisées." },
  { q: "Puis-je essayer avant de m'engager ?", a: "Oui : les offres incluent une période d'essai. Demandez une démonstration pour qu'un conseiller configure un environnement adapté à votre activité." },
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
  { module: "intelligence", title: "Global Gest Intelligence", bullets: ["Posez vos questions en langage naturel", "Réponses limitées à vos données autorisées", "Jamais d'accès aux modules désactivés", "Insights et recommandations"] },
];

export const SOLUTIONS = [
  { slug: "dirigeants", title: "Dirigeants & DG", pain: "Savoir, à tout moment, où en est l'entreprise.", points: ["Tableau de bord exécutif (CA, dépenses, trésorerie, créances)", "Alertes : factures échues, stocks critiques, validations en attente", "Vue par agence, entreprise ou projet"], modules: ["reports", "intelligence", "finance"] },
  { slug: "finance", title: "Finance & comptabilité", pain: "Des chiffres fiables, une clôture sereine.", points: ["Encaissements, décaissements, rapprochements", "Écritures générées depuis les opérations validées", "Exercices, périodes verrouillables, exports"], modules: ["finance", "accounting", "sales"] },
  { slug: "commercial", title: "Ventes & commercial", pain: "Transformer plus de prospects en paiements.", points: ["Pipeline et opportunités", "Devis → commande → livraison → facture sans ressaisie", "Relances et solde client en un clic"], modules: ["crm", "sales"] },
  { slug: "logistique", title: "Achats, stock & logistique", pain: "Ne plus jamais être en rupture ni sur-stocké.", points: ["Demandes d'achat validées par seuil", "Réception → stock automatique", "Inventaires, transferts, valorisation"], modules: ["purchases", "inventory", "fleet"] },
  { slug: "rh", title: "RH & paie", pain: "Gérer les équipes sans paperasse.", points: ["Dossier employé et organigramme", "Congés avec circuit de validation", "Paie configurable et bulletins PDF"], modules: ["hr", "payroll"] },
  { slug: "projets", title: "Projets & chantiers", pain: "Livrer dans les délais et le budget.", points: ["Tâches, jalons, Kanban et Gantt", "Coûts réels vs budget", "Rapports terrain et documents rattachés"], modules: ["projects", "construction", "documents"] },
];

/** Les quatre étapes du « flux » de l'accueil : chaque saisie alimente l'étape suivante. Captures réelles du produit (public/landing). */
export const FLOW = [
  {
    key: "devis", label: "Le devis", image: "/landing/devis.webp", alt: "Un devis dans Global Gest : le document tel qu'il sera envoyé au client",
    title: "Un devis qui se transforme tout seul",
    you: "Vous composez le devis dans un éditeur à deux volets : le document se met en forme sous vos yeux.",
    auto: [
      "Envoi par e-mail avec un lien public : le client consulte et accepte le devis en ligne",
      "Un clic le transforme en commande ou en facture",
      "Facture d'acompte créée depuis le devis, déduite automatiquement de la facture finale",
    ],
  },
  {
    key: "facture", label: "La facture", image: "/landing/facture.webp", alt: "Une facture dans Global Gest avec son numéro, son échéancier et ses actions",
    title: "Une facture conforme, sans y penser",
    you: "Vous émettez la facture depuis le devis ou la commande : les lignes, les prix et la TVA sont déjà là.",
    auto: [
      "Numéro légal attribué à l'émission, sans trou dans la série",
      "Échéancier en plusieurs tranches et plafond de crédit contrôlé par client",
      "PDF prêt à envoyer, avec vos mentions légales en pied de page",
    ],
  },
  {
    key: "encaissement", label: "L'encaissement", image: "/landing/encaissement.webp", alt: "Le suivi des encaissements et des factures échues dans Global Gest",
    title: "Des encaissements suivis, des impayés relancés",
    you: "Vous enregistrez le paiement : espèces, Mobile Money, virement, chèque ou carte.",
    auto: [
      "Le règlement s'impute sur la bonne échéance et un reçu PDF est généré",
      "Les factures échues sont signalées et relancées par e-mail : chaque relance est tracée",
      "Trésorerie, créances par ancienneté et alertes d'échéance à jour sur le tableau de bord",
    ],
  },
  {
    key: "compta", label: "La comptabilité", image: "/landing/comptabilite.webp", alt: "Les écritures comptables générées automatiquement par les factures, les paiements et les achats dans Global Gest",
    title: "Une comptabilité qui s'écrit toute seule",
    you: "Vous n'avez rien à faire : chaque facture, paiement, achat et dépense est comptabilisé à votre place.",
    auto: [
      "Écritures passées automatiquement dans un plan comptable SYSCOHADA (simplifié)",
      "Journal, grand livre, balance, compte de résultat et bilan toujours à jour",
      "Votre expert-comptable consulte et exporte : plus de ressaisie en fin de mois",
    ],
  },
] as const;

export const HERO_CHIPS = ["FCFA par défaut", "Plan comptable SYSCOHADA", "Plusieurs entreprises, un seul compte", "Application mobile installable"];

/** Ce qui se fait depuis le téléphone (application installable, voir README « Mobile »). `icon` : nom d'une icône lucide, résolue dans la page. */
export const FIELD_ACTIONS = [
  { icon: "ScanLine", title: "Scanner un code-barres", text: "L'appareil photo du téléphone retrouve le produit dans votre stock." },
  { icon: "Camera", title: "Photographier un justificatif", text: "La dépense est saisie sur place et la photo du reçu rattachée." },
  { icon: "PlusCircle", title: "Créer en un geste", text: "Devis, facture, commande ou client depuis le bouton « + » de la barre du bas." },
  { icon: "Smartphone", title: "Installer l'application", text: "Ajoutée à l'écran d'accueil, en plein écran, sans passer par un magasin d'applications." },
] as const;

/** Les métiers : uniquement des fonctions qui existent dans le produit. */
export const TRADES = [
  {
    key: "commerce", icon: "Store", title: "Commerce & distribution", extension: false,
    points: ["Stock par entrepôt, seuils minimum et alertes de rupture", "Prix par client et listes de prix", "Achats fournisseurs avec circuit de validation", "Réceptions et inventaires qui alimentent le stock"],
  },
  {
    key: "chantiers", icon: "HardHat", title: "BTP & chantiers", extension: true,
    points: ["Budget et avancement par chantier", "Matériaux sortis du stock et imputés au chantier", "Équipes, engins et sous-traitants", "Rapports de terrain datés"],
  },
  {
    key: "transport", icon: "Truck", title: "Transport & logistique", extension: true,
    points: ["Véhicules, chauffeurs et missions", "Assurances et visites techniques : alertes avant l'échéance", "Carburant, entretiens et contraventions", "Coût et rentabilité par véhicule"],
  },
  {
    key: "services", icon: "Briefcase", title: "Services & conseil", extension: false,
    points: ["Facturation récurrente automatique", "Projets et tâches en liste, Kanban ou Gantt", "Temps passé facturé en un clic", "Rentabilité par projet"],
  },
] as const;

export const IMPORT_ITEMS = ["Clients", "Fournisseurs", "Produits", "Salariés", "Factures impayées", "Plan comptable", "Balance d'ouverture"];
