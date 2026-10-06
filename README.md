# AfriGest 360

> **Toute votre entreprise. Une seule plateforme.**

Plateforme SaaS ERP multi-entreprises pour le marché africain : finance, comptabilité, ventes, CRM, achats, stocks, RH, paie, projets, GED, reporting, extensions Transport & Chantiers, administration SaaS.

**État : Phases 1 à 6 et 8 livrées — 420 tests** (fondations, site public, cœur ERP, RH/paie/projets/GED, pilotage, extensions Flotte et Chantiers, durcissement/performances/documentation). Reste à venir : **Phase 7 — AfriGest Intelligence**. Voir [le plan](docs/ARCHITECTURE.md#10-plan-dimplémentation). Aucune fonctionnalité n'est simulée : un module dont les écrans ne sont pas livrés l'indique explicitement (et son contrôle d'accès est déjà actif et testé).

## Ce qui fonctionne aujourd'hui

| Domaine | Détail |
|---|---|
| **Authentification** | Connexion, inscription, déconnexion, mot de passe oublié/réinitialisation, vérification e-mail, sessions révocables (liste + révocation), 2FA TOTP + codes de secours, verrouillage après 5 échecs |
| **Multi-entreprises** | Un compte, N entreprises, un rôle par entreprise ; Company Switcher ; changement immédiat de données, permissions, modules |
| **Isolation multi-tenant** | 3 couches : contexte serveur → extension Prisma → **RLS PostgreSQL** (rôle sans `BYPASSRLS`), testées |
| **RBAC dynamique** | 100+ permissions granulaires, rôles propres à chaque entreprise (éditeur de matrice), anti-escalade de privilèges, règle « toujours un admin » |
| **Modules & offres** | Catalogue central, offres (modules + limites), surcharges par entreprise ; module désactivé = invisible **et** 403 par URL directe |
| **Super Admin** (`/super-admin`) | KPI (MRR/ARR, entreprises, utilisateurs, démos), entreprises (créer, modifier, suspendre/réactiver, offre, modules, limites, utilisateurs, activité), offres, catalogue de modules, demandes de démo |
| **Paramètres** | Entreprise, utilisateurs & invitations, rôles & permissions, modules, abonnement & limites, préférences de notifications, sécurité du compte |
| **Site public** | Landing (18 sections), Fonctionnalités, Solutions, Tarifs (lus en base), Contact, Démo — le formulaire enregistre la demande (anti-spam : champ piège + limitation de débit + dédoublonnage), notifie le propriétaire par e-mail et alimente `/super-admin/demandes` |
| **Onboarding** | Assistant en 10 étapes (profil, entreprise, légal, secteur, taille, devise, pays, logo, adresse, exercice), rôles/siège/offre d'essai créés automatiquement ; logo PNG/JPEG/WebP (type vérifié sur les octets, SVG refusé), servi uniquement aux membres |
| **Plateforme** | Journal d'audit append-only, notifications, palette ⌘/Ctrl+K, thème clair/sombre, responsive (sidebar → drawer) |
| **CRM** (P3) | Clients (fiche, contacts, activités), prospects → conversion, opportunités et pipeline Kanban configurable, activités commerciales |
| **Ventes & facturation** (P3) | Devis/proforma → commande → livraison (stock) → facture (numérotation légale à l'émission, échéancier, plafond de crédit) → paiements → avoirs → relances ; PDF (pdfkit) ; TVA et numérotation paramétrables |
| **Stock** (P3) | Produits/services, entrepôts, mouvements (coût moyen pondéré, stock négatif configurable), réservations, transferts, inventaires, valorisation, seuils d'alerte |
| **Achats** (P3) | Fournisseurs, demandes d'achat → commandes → réceptions (entrée en stock valorisée) → factures fournisseur (anti-doublon) → règlements ; bon de commande PDF |
| **Validations** (P3) | Moteur d'approbation par seuil (demandes d'achat, commandes, dépenses) : jamais auto-approuvé, motif de refus obligatoire, page « Validations » avec badge |
| **Finance** (P3) | Banques/caisses/mobile money (une caisse ne peut pas être négative), mouvements, transferts, rapprochement, dépenses avec circuit d'approbation, catégories, budgets vs réalisé, échéancier, trésorerie prévisionnelle |
| **Comptabilité** (P3) | Plan **compatible SYSCOHADA** paramétrable, journaux, exercices et périodes (verrouillage, clôture avec à-nouveaux), **écritures automatiques** (ventes, achats, paiements, dépenses, transferts, soldes d'ouverture), écritures validées **immuables** (contre-passation), grand livre, balance, journal, compte de résultat et bilan simplifiés |
| **Tableau de bord** (P3) | 14 widgets filtrés par module actif **et** permission (CA, trésorerie, créances/dettes, résultat, clients, pipeline, graphiques Recharts, stocks critiques, alertes, activité), disposition personnalisable par utilisateur ; tâche d'alertes (échéances, stock) |

| **Organisation** (P4) | Agences (un siège), sites, départements hiérarchiques, centres de coûts ; imputation des dépenses, factures et projets, analyse par agence / centre |
| **RH** (P4) | Salariés et contrats, présences, congés (soldes, validation obligatoire), évaluations, formations ; salaires et contrats visibles des seuls habilités |
| **Paie** (P4) | Rubriques **paramétrables** et versionnées (aucun taux légal codé en dur), calcul au prorata, campagnes mensuelles (calcul → validation → paiement), bulletins PDF, écritures comptables et trésorerie automatiques |
| **Projets** (P4) | Projets, tâches (Kanban + Gantt), temps passé valorisé, coûts rattachés, budget, facturation du temps |
| **Documents / GED** (P4) | Dossiers, versions (SHA-256), étiquettes, liens vers clients/factures/salariés/projets, partage interne, type de fichier vérifié sur les octets, téléchargement authentifié et tracé |
| **Rapports** (P5) | 11 rapports transversaux (ventes, CA, dépenses, résultat, trésorerie, créances, dettes, stocks, RH, projets, commercial), filtres par période / agence / département / utilisateur / client / fournisseur / projet / centre de coûts, **export Excel, CSV, PDF et impression** |
| **Workflows** (P5) | Chaînes de validation à plusieurs étapes (Manager → Directeur financier) selon type, montant, département et rôle ; dépenses, achats, congés, **paiements fournisseurs, remises commerciales** ; séparation des tâches, décisions journalisées |
| **Notifications** (P5) | Centre de notifications (filtres, lues/non lues), préférences par utilisateur honorées par tous les émetteurs, e-mails en file, alertes d'échéance, de stock, de contrats, de documents expirants, d'abonnement |
| **Audit** (P5) | Journal consultable et exportable (avant/après, utilisateur, IP), en écriture seule |
| **Import / export** (P5) | Import CSV / Excel de clients, fournisseurs, salariés, produits et stocks : correspondance des colonnes, vérification, rapport d'erreurs, sans doublon ; exports des listes ; modèles |
| **Recherche globale** (P5) | ⌘/Ctrl+K : clients, fournisseurs, factures, devis, salariés, produits, projets, documents — selon modules actifs et droits |

| **Transport & Flotte** (P6) | Véhicules (plaque unique, kilométrage, statut), chauffeurs (permis, validité), affectations datées, missions (planifiée → en cours → terminée, kilométrage départ/arrivée, produit), carburant, entretiens (préventif/correctif, prochaine échéance), assurances et visites techniques, coûts et rentabilité par véhicule, alertes d'échéance ; un véhicule dont l'assurance ou la visite technique est expirée ne peut pas partir en mission |
| **Contraventions** (P6) | PV (n° unique), chauffeur déduit automatiquement de la mission ou de l'affectation à la date de l'infraction, statuts À payer → Payée / Contestée / Annulée (états finaux), échéances, analyse des récidives par chauffeur et par véhicule, justificatifs via la GED |
| **Chantiers** (P6) | Chantier = projet associé (créé automatiquement) : budget par catégorie, équipe, engins (jours × tarif, liés à la flotte), matériaux **sortis réellement du stock**, sous-traitants (factures fournisseur), rapports journaliers (un par jour, l'avancement suit le dernier rapport), budget prévu / réel / consommé, documents |

| **Sécurité** (P8) | CSP à nonce par requête (aucun `unsafe-inline`/`unsafe-eval` côté scripts), en-têtes COOP/CORP/HSTS, **limitation de débit partagée en base** (efficace sur serverless), vérification de configuration au démarrage, `/api/health` sans fuite de valeur — voir [docs/SECURITE.md](docs/SECURITE.md) |
| **Performances** (P8) | contexte chargé en une étape parallèle, compteurs de la barre latérale différés, widgets en transactions groupées, graphiques à la demande, 41 index sur clés étrangères + garde-fou de test : pages de liste ≈ 2× plus rapides, tableau de bord ≈ 1,9× (mesuré à 30 ms de latence base) |
| **Accessibilité** (P8) | audit axe-core WCAG 2.1 AA sur les pages publiques et 4 écrans de l'application ; mouvements réduits respectés |
| **Documentation** (P8) | guides de déploiement, d'exploitation, de sécurité, de contribution, matrice des 148 permissions **générée et vérifiée par test** |

À venir : AfriGest Intelligence (P7).

## Documentation

| Document | Pour qui | Contenu |
|---|---|---|
| [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) | exploitant | mise en production pas à pas (Vercel + PostgreSQL managé), variables, e-mails, vérifications |
| [docs/EXPLOITATION.md](docs/EXPLOITATION.md) | exploitant | surveillance, performances, sauvegardes, migrations, rotation des secrets, incidents |
| [docs/SECURITE.md](docs/SECURITE.md) | direction, auditeur | modèle de menace, protections en place **et ce qui n'est pas couvert** |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | développeur | architecture, isolation, événements, règles métier par phase |
| [docs/CONTRIBUER.md](docs/CONTRIBUER.md) | développeur | conventions, recettes (table, permission, module, action), tests, pièges |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | administrateur | modules, 148 permissions, rôles modèles (généré) |
| [CHANGELOG.md](CHANGELOG.md) | tous | journal des changements par phase |

## Démarrage rapide

Prérequis : **Node.js ≥ 20** (testé sur 26). Aucune installation de PostgreSQL n'est nécessaire en développement (un vrai PostgreSQL embarqué est fourni).

```bash
npm install
cp .env.example .env        # puis renseigner AUTH_SECRET, ENCRYPTION_KEY, mots de passe (voir ci-dessous)
npm run db:start            # PostgreSQL local (laisser tourner dans un terminal)
npm run db:migrate          # migrations (propriétaire)
npm run db:app-role         # active le rôle applicatif « afrigest_app » (RLS appliquée)
npm run db:seed             # catalogue + offres + propriétaire + entreprises de démo (+ données métier de démonstration)
npm run dev                 # http://localhost:3000
```

Générer les secrets :

```bash
openssl rand -base64 32     # AUTH_SECRET
openssl rand -hex 32        # ENCRYPTION_KEY
```

### Comptes de démonstration (créés par le seed)

| Compte | Rôle | Mot de passe |
|---|---|---|
| `PLATFORM_OWNER_EMAIL` (.env) | Propriétaire de la plateforme → `/super-admin` | `PLATFORM_OWNER_PASSWORD` (.env) |
| `idrissa@afrigest360.demo` | **A** Africa Business Demo : Administrateur · **B** Sahel Transport : Resp. Commercial · **C** Batimat : Consultation | `DEMO_PASSWORD` (défaut dans `prisma/seed.ts`, **dev uniquement**) |
| `awa.comptable@afrigest360.demo`, `moussa.commercial@afrigest360.demo` | Comptable / Commercial dans l'entreprise A | idem |
| `aminata.employee@afrigest360.demo` | Employée (self-service : congés, tâches, bulletins) dans l'entreprise A | idem |

Les entreprises ont des offres différentes (Enterprise / Business / Starter) : changez d'entreprise pour voir les modules et permissions changer. Les e-mails (vérification, invitation, réinitialisation) s'affichent dans la console du serveur de dev (aucun fournisseur requis ; `RESEND_API_KEY` active l'envoi réel).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` · `npm run lint` | TypeScript strict · ESLint (règles d'isolation incluses) |
| `npm test` | Tests unitaires + intégration (PostgreSQL éphémère automatique) |
| `npm run db:start` | PostgreSQL de développement (données dans `.pgdata/`) |
| `npm run db:migrate` · `db:deploy` | Migrations (dev · production) |
| `npm run db:app-role` | Active la connexion du rôle applicatif |
| `npm run docs:gen` | Régénère `docs/PERMISSIONS.md` depuis le catalogue de permissions (un test vérifie qu'il est à jour) |
| `npm run db:seed` | Seed idempotent (`SEED_DEMO=false` pour ne charger que le catalogue). Les données de démonstration passent par les **vrais services** (numérotation, stock, écritures comptables) : chiffres cohérents entre modules |
| `GET /api/cron/alerts` | Génère les alertes d'échéances et de stock (toutes entreprises). Désactivée sans `CRON_SECRET` ; appeler avec `Authorization: Bearer <secret>` (ex. une fois par jour) |

## Architecture et sécurité

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Points essentiels :

* **Jamais de `companyId` venant du client.** `requireTenantContext()` authentifie, revérifie le membership **à chaque requête**, contrôle que l'entreprise est active, puis calcule modules + permissions. Le cookie `afg_company` n'est qu'une préférence non fiable.
* **Services** : `ctx.db` (requête isolée) et `ctx.tx(fn)` (transaction isolée). Le client `platformDb` (qui contourne la RLS) n'est autorisé que dans `src/core`, `src/modules/platform` et `/super-admin` — une règle ESLint l'impose.
* **Nouvelle table métier** : ajouter `companyId`, l'enregistrer dans `src/core/db/tenant-models.ts` et appeler `SELECT afg_enable_rls('"MaTable"')` dans sa migration. Le test `rls-coverage` échoue sinon.
* **Nouvelle permission** : l'ajouter dans `src/core/rbac/catalog.ts` (clé `domaine.ressource.action` + module requis), puis `npm run db:seed` (ou le déploiement) la synchronise.
* **Nouveau module** : l'ajouter dans `src/core/modules/registry.ts` + `roadmap.ts`, créer ses permissions, ses pages sous `src/app/app/<module>` (garde `requireTenantContext` + `ctx.hasModule`) et son service sous `src/modules/<module>`.
* **Server Actions** : toujours via `defineTenantAction` / `defineUserAction` / `definePlatformAction` / `definePublicAction` (authentification → module → permission → validation Zod → traitement → erreurs uniformes, sans stack trace).
* **Audit** : `audit(ctx, { action, resource, summary, before, after })` — le rôle applicatif n'a que `INSERT`/`SELECT` sur `AuditLog`.

### Production

Guide complet : **[docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)**. En bref : PostgreSQL managé avec **deux rôles** (`DATABASE_URL` = `afrigest_app` pour l'application, `DIRECT_URL` = propriétaire pour les migrations), SSL, variables d'environnement sur Vercel, `REQUIRE_EMAIL_VERIFICATION=true` avec Resend, `SEED_DEMO=false`, puis vérifier `/api/health`. Le script `vercel-build` applique les migrations avant chaque construction.

## Limites connues

* Limitation de débit : compteurs partagés en base (par adresse IP) sur connexion, inscription, mot de passe oublié et démo/contact ; repli en mémoire si la base est indisponible. Pas de CAPTCHA.
* Les « témoignages » de la landing sont des profils illustratifs (aucun client réel à ce jour) : à remplacer avant mise en production.
* La palette ⌘K navigue entre modules/paramètres/entreprises ; la recherche d'entités est assurée par la palette (voir « Recherche globale »).
* Le compteur d'usage ne couvre que les utilisateurs ; les autres compteurs (produits, clients…) s'ajoutent avec leurs tables.
* Les gardes de pages bloquent le contenu, mais avec le streaming Next le statut HTTP d'un accès refusé peut rester 200 tant qu'aucun contenu sensible n'est émis.
* **Comptabilité** : plan SYSCOHADA *simplifié* à valider avec un expert-comptable ; états financiers **simplifiés** (pas la liasse officielle) ; inventaire intermittent (la valeur du stock n'est pas comptabilisée au fil de l'eau : écriture de variation de stocks en fin de période) ; un compte comptable par type de trésorerie ; l'affectation du résultat après clôture est une opération diverse manuelle ; pas de réouverture d'un exercice clos.
* **Multi-devises** : toutes les écritures sont dans la devise de l'entreprise ; pas de conversion ni d'écarts de change.
* **Finance** : pas d'import de relevés bancaires (le rapprochement est manuel) ; justificatifs de dépenses : à joindre via la GED (lien vers la dépense) ; budgets par catégorie de dépense uniquement.
* **Documents** : pas d'envoi par e-mail des devis/factures depuis l'application (PDF téléchargeables) ; les relances sont tracées mais pas envoyées automatiquement.
* **Stock** : pas de numéros de lot/série ni d'emplacements ; coût moyen pondéré uniquement.
* **Alertes** : la tâche planifiée doit être déclenchée par un ordonnanceur externe (cron, Vercel Cron…) ; en l'absence de planification, aucune alerte n'est créée.
* **RH / paie** : les congés comptent les jours ouvrés lundi-vendredi (pas de jours fériés ni de calendriers spécifiques) ; **aucun taux, plafond ou barème légal n'est fourni** — les rubriques d'exemple sont à remplacer par celles de votre pays et convention collective, et la paie à faire valider par un professionnel ; pas de télédéclaration sociale/fiscale, pas de fichier de virements bancaires ; une campagne payée n'est pas annulable.
* **Projets** : coût horaire = salaire de base ÷ 176 h (indicatif) ; pas de planification de ressources multi-projets.
* **GED** : **pas d'analyse antivirus** des fichiers envoyés (le type est vérifié, pas l'innocuité du contenu) ; pas de quota de stockage par entreprise ; pas de recherche dans le contenu des fichiers ; pas d'aperçu des documents Office ; 8 Mo maximum par fichier ; l'aperçu PDF en ligne dépend de la visionneuse du navigateur.
* **Workflows** : les **budgets** ne passent pas encore par un circuit de validation ; les validations de remises portent sur l'émission de la facture (pas sur les devis) ; les rôles validateurs doivent détenir « Demandes d'approbation — valider » (contrôlé à la création de la règle).
* **Notifications** : l'envoi des e-mails et la génération des alertes dépendent de la tâche planifiée (`/api/cron/alerts`, secret `CRON_SECRET`) ; sans ordonnanceur, rien n'est envoyé. Maintenance, assurances/visites techniques et contraventions sont notifiées par la même tâche.
* **Rapports** : plafonnés à 5 000 lignes ; le rapport « Résultat » vient de la comptabilité et ne se filtre que par période (pas par agence) ; pas de planification d'envoi de rapports par e-mail.
* **Import** : 2 000 lignes et 5 Mo par fichier (découpez au-delà) ; .xls ancien format refusé (enregistrer en .xlsx ou CSV) ; les contrats des salariés importés se saisissent ensuite ; catégories de produits et départements doivent exister avant l'import. La bibliothèque Excel (exceljs) dépend de `uuid` < 11.1.1 (avis de sévérité modérée sans effet ici : aucun appel à `uuid` avec tampon fourni).
* **Recherche globale** : recherche par sous-chaîne (pas de classement par pertinence ni de tolérance aux fautes) ; véhicules et chantiers inclus (selon modules actifs et droits).
* **Flotte** : le blocage de mission ne s'applique que lorsqu'une assurance ou une visite technique **expirée est enregistrée** (l'absence de dossier produit une alerte, pas un blocage) ; la correction d'un kilométrage passe par la fiche véhicule (tracée) ; pas de télématique/GPS ni de lecture de cartes carburant ; pas de génération automatique de facture depuis une mission (le produit de la mission est un montant saisi) ; coûts de flotte comptés une fois (une dépense créée depuis un coût de flotte n'est pas recomptée) ; les photos et pièces jointes passent par le module Documents.
* **Chantiers** : exige le module Projets ; les budgets n'ont pas de circuit de validation ; les engins de type véhicule dépendent du module Flotte ; pas de planning de chantier propre (utiliser les tâches du projet associé) ; pas de métrés ni de situations de travaux.
* **Stockage de fichiers** : implémentation disque (`UPLOAD_DIR`) derrière une interface `StorageProvider` ; **un fournisseur S3-compatible reste à brancher avant la production** (sur Vercel le disque est éphémère : logos et documents disparaîtraient).
* **Sécurité** : aucun test d'intrusion indépendant à ce jour ; pas d'antivirus sur les fichiers, pas de WAF ni de SIEM ; 6 avis `npm audit` sans effet à l'exécution, documentés dans `docs/SECURITE.md`.
* **Performances** : chaque requête applicative coûte ≈ 4 allers-retours vers la base ; une base distante de plus de ~10 ms ralentit nettement chaque page (mesurer avec `/api/health`, voir `docs/EXPLOITATION.md` §2). Le plan gratuit de Render supprime la base après 30 jours.
* **E-mails** : sans `RESEND_API_KEY`, aucun e-mail de vérification ni d'invitation ne part.
