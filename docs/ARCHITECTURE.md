# AfriGest 360 — Architecture & plan d'implémentation

> Document vivant. Il décrit l'architecture cible complète et l'état d'avancement par phase.

## 1. Vue d'ensemble

Monolithe modulaire **Next.js 16 (App Router) + Prisma 7 + PostgreSQL**. Un seul déploiement, des modules métier isolés par dossier,
un cœur (`core`) qui impose l'authentification, le tenant actif, les modules activés et les permissions.

```
Navigateur ──► proxy.ts (en-têtes sécurité, redirection si cookie de session absent)
            ──► Server Components / Server Actions / Route Handlers
                   │  requireTenantContext()  ← authentification + membership + entreprise + modules + permissions
                   ▼
              Services de domaine (src/modules/<module>/service.ts)
                   │  ctx.db / ctx.tx(…)   ← client Prisma « tenant » (filtre companyId + RLS PostgreSQL)
                   ▼
              PostgreSQL (rôle applicatif sans BYPASSRLS, RLS FORCE sur toutes les tables à companyId)
```

## 2. Arborescence

```
prisma/
  schema.prisma            modèle de données (livré phase par phase)
  migrations/              migrations SQL (dont RLS + rôle applicatif)
  seed.ts                  catalogue (modules, permissions, offres) + données de démo
scripts/                   dev-db.ts (PostgreSQL embarqué), outils
src/
  app/
    (marketing)/           landing, fonctionnalités, solutions, tarifs, contact, démo   [phase 2]
    (auth)/                connexion, inscription, mot de passe oublié, 2FA
    app/                   application tenant (layout : sidebar + topbar)
      [module]/            une branche par module, gardée par requireModule()
      parametres/          entreprise, utilisateurs, rôles, modules, sécurité, abonnement
    super-admin/           console propriétaire de la plateforme
    api/                   route handlers (auth, exports, webhooks)
  core/
    db/                    client Prisma de base, extension tenant, plateforme
    auth/                  Auth.js, mots de passe, TOTP, sessions révocables
    tenant/                contexte tenant, company switcher, provisioning d'entreprise
    rbac/                  catalogue de permissions, résolution, garde-fous
    modules/               registre des modules, activation, limites d'usage
    actions/               enveloppe uniforme des Server Actions (defineAction)
    errors/                AppError, mapping client/serveur
    audit/                 AuditLog append-only
    mail/                  envoi d'e-mails (console en dev, Resend/SMTP en prod)
  modules/<module>/        schémas Zod, services, actions, composants du module
  components/ui/           design system (shadcn/ui)
  components/app/          shell (sidebar, topbar, company switcher, palette de commandes)
tests/                     unitaires + intégration (PostgreSQL réel, isolation multi-tenant)
docs/                      architecture, sécurité, modèle de données
```

## 3. Multi-tenant : défense en profondeur (3 couches)

| Couche | Mécanisme | Ce qu'elle garantit |
|---|---|---|
| 1. Contexte | `requireTenantContext()` : session valide → cookie `afg_company` **non fiable** → membership actif revérifié en base → entreprise `ACTIVE` | Le `companyId` n'est **jamais** lu depuis un formulaire/une requête. |
| 2. Prisma | Extension `tenantDb(companyId)` : injecte `companyId` dans tous les `where`/`data` des modèles tenant, refuse un `companyId` étranger | Un oubli de filtre dans un service ne fuit pas. |
| 3. PostgreSQL | **RLS FORCE** sur chaque table ayant `companyId`, policy `companyId = current_setting('app.company_id')`, rôle applicatif **sans** `BYPASSRLS` ; chaque requête s'exécute dans une transaction qui fait `set_config('app.company_id', …, true)` | Même une requête mal écrite (ou du SQL brut) ne peut pas lire/écrire une autre entreprise. Sans contexte : **aucune ligne** (fail-closed). |

* Le client **plateforme** (`platformDb`) pose `app.bypass_rls = on` ; il n'est importable que depuis le code d'authentification, de provisioning et de `/super-admin` (règle ESLint `no-restricted-imports` ailleurs).
* Un test d'intégration vérifie que **toute** table contenant `companyId` a la RLS activée et forcée (une nouvelle table sans RLS fait échouer la CI).
* `AuditLog` : droits `INSERT`/`SELECT` uniquement pour le rôle applicatif (append-only au niveau base).

## 4. RBAC

* **Catalogue** de permissions en code (`src/core/rbac/catalog.ts`), synchronisé en base (`Permission`) : clé `module.ressource.action`, rattachée à un module (ex. `finance.invoice.read` → module `finance`).
* **Rôles dynamiques par entreprise** (`Role.companyId`). Les gabarits (DG, DAF, Comptable, RH, …) sont **copiés** à la création de l'entreprise puis librement modifiables. `Role.isAdmin` = toutes les permissions des modules actifs.
* Un membre = `CompanyMembership` (user × company × role). Même compte, N entreprises, un rôle par entreprise.
* Autorisation = **module actif pour l'entreprise ET permission du rôle**. La permission est vérifiée côté serveur à chaque action (`defineAction({ permission })`) et à chaque page (`requirePermission`). Le menu n'est qu'un reflet.

## 5. Activation des modules & abonnements

* `Module` : catalogue central (clé, nom, type cœur/extension, statut de livraison).
* `Plan` ↔ `Module` via `PlanModule`, limites via `PlanLimit`. `Subscription` : l'offre de l'entreprise.
* `CompanyModule` : **état effectif** par entreprise (hérité du plan, surchargeable par le Super Admin). `UsageLimit` : surcharges de limites par entreprise.
* Les clés de permission suivent la convention produit (`finance.invoice.*`…) mais le **module requis** est déclaré explicitement : les factures (`finance.invoice.*`) relèvent du module **Ventes & Facturation**, les paiements/dépenses (`finance.payment.*`, `finance.expense.*`) du module **Finance**.
* Garde serveur `requireModule('stock')` sur chaque branche `/app/[module]` : URL directe → refus 403 même si l'utilisateur connaît l'adresse. Les Server Actions et les services appliquent la même règle via la permission (qui implique le module).

## 6. Authentification

Auth.js v5 (Credentials, stratégie JWT) **+ table `UserSession`** : le JWT ne porte qu'un `sid` ; chaque requête valide que la session n'est pas révoquée/expirée → révocation immédiate, liste des appareils. Mots de passe bcrypt, verrouillage temporaire après échecs, vérification e-mail, réinitialisation par jeton à usage unique (hash en base), 2FA TOTP + codes de secours (secret chiffré AES-256-GCM).

## 7. Gestion des erreurs

`AppError(code, message, details)` ; `defineAction` renvoie `{ ok, data } | { ok: false, error }` (validation Zod → erreurs par champ, permissions, métier). Les erreurs inattendues sont journalisées côté serveur et masquées côté client (aucune stack en production).

## 8. Dépendances entre modules (ordre de construction)

```
core (auth, tenant, rbac, modules, audit, notifications)
 ├─ org (Branch, Site, Department, CostCenter)
 ├─ crm ─► sales (devis → commande → livraison → facture → paiement) ─► finance ─► accounting
 ├─ purchases (demande → commande → réception → facture → paiement) ─► inventory, finance
 ├─ inventory ◄─ sales (livraison) / purchases (réception)
 ├─ hr ─► payroll ─► finance/accounting
 ├─ projects ─► purchases/finance/hr (temps, coûts) ─► sales (facturation)
 ├─ documents (GED, liens polymorphes vers toutes les entités)
 ├─ workflows (approbations, utilisées par achats, dépenses, congés…)
 ├─ reports / search / import-export (transverses, lisent les modules actifs)
 ├─ fleet ─► finance (coûts), documents · construction ─► projects, purchases, inventory, hr
 └─ intelligence (n'interroge que des services déjà gardés par permission + module)
```

Les écritures inter-modules passent par des **services de domaine** (jamais par du SQL croisé) et dans une même transaction `ctx.tx()` (ex. facture validée → écritures comptables ; réception → mouvement de stock).

## 9. Risques techniques identifiés

| Risque | Parade |
|---|---|
| Fuite inter-tenant | 3 couches ci-dessus + test CI « Company A ne voit jamais Company B » |
| Surcoût d'une transaction par requête (RLS) | Acceptable au MVP ; `ctx.tx()` regroupe les écritures multiples ; PgBouncer en mode transaction compatible (`set_config` local) |
| JWT non révocable | `UserSession` vérifiée à chaque requête |
| Comptabilité SYSCOHADA | Plan comptable **paramétrable** (jeu de comptes importable), aucune règle fiscale codée en dur |
| Paie : taux sociaux/fiscaux évolutifs | Rubriques et barèmes en base, versionnés par date d'effet |
| Courses sur numérotation (FAC-2026-00001) | Table `NumberSequence` + `UPDATE … RETURNING` atomique par (entreprise, type, année) |
| Montants | `Decimal(18,2)` partout, calculs avec `Decimal`, jamais de `float` |
| Stockage de fichiers | Interface `StorageProvider` (disque local en dev, S3 compatible en prod) |
| Périmètre énorme | Livraison par phases, chacune testée ; fonctionnalités partielles **déclarées** comme telles (statut de module) plutôt que simulées |

## 10. Plan d'implémentation

| Phase | Contenu | État |
|---|---|---|
| 1 | Fondations : projet, design system, Prisma/PostgreSQL, Auth, multi-tenant (RLS), memberships, RBAC, modules/plans, layout, Super Admin, paramètres (rôles, membres, sécurité, abonnement) | **livrée** (87 tests) |
| 2 | Landing + pages marketing, formulaire de démo (persisté), onboarding complet en 10 étapes, logo | **livrée** |
| 3 | Dashboard, CRM, Ventes/Facturation, Achats, Stock, Finance, Comptabilité | **livrée** (225 tests ; voir §11) |
| 4 | RH, Paie, Projets, GED, Agences/centres de coûts | **livrée** (284 tests ; voir §12) |
| 5 | Analytics/Reporting, Notifications, Workflows, Audit UI, Import/Export, Recherche globale | **livrée** (359 tests ; voir §13) |
| 6 | Transport & Flotte, Contraventions, Chantiers | **livrée** (395 tests ; voir §14) |
| 7 | AfriGest Intelligence | à faire |
| 8 | Durcissement, perfs, accessibilité, documentation | **livrée** (437 tests ; voir §15) |

## 11. Phase 3 — Cœur ERP (livré)

### Découpage et schéma
Le schéma Prisma est découpé en fichiers par domaine (`prisma/schema/*.prisma` : core, crm, inventory, sales, purchasing, finance, accounting, dashboard). Chaque table métier porte `companyId`, est déclarée dans `TENANT_KEY`, et active la RLS dans sa migration (le test `rls-coverage` l'impose).

### Interconnexion des modules : événements de domaine
`src/core/events.ts` : l'émetteur (Ventes, Achats, Finance) appelle `emit(tx, ctx, événement, charge)` **dans sa propre transaction** ; les modules abonnés (`src/modules/registry.ts`) réagissent et vérifient que leur module est actif pour l'entreprise. Une erreur d'un abonné (stock insuffisant, période verrouillée, solde de caisse insuffisant…) annule toute l'opération, avec un message métier clair. Les modules ne s'importent jamais entre eux pour écrire.

| Événement | Abonnés |
|---|---|
| `order.confirmed/cancelled`, `delivery.confirmed`, `credit_note.issued` | Stock (réservation, sortie, retour), Comptabilité (avoir) |
| `goods_receipt.confirmed` | Stock (entrée valorisée au coût de la commande, coût moyen pondéré) |
| `invoice.issued/cancelled`, `supplier_bill.posted/cancelled` | Comptabilité (écriture / contre-passation) |
| `payment.validated/cancelled`, `supplier_payment.validated/cancelled` | Finance (mouvement de trésorerie, contrôle de solde), puis Comptabilité |
| `expense.paid/cancelled`, `finance.manual_transaction.*`, `finance.transfer.*`, `finance.account.opening_balance` | Comptabilité |
| `approval.decided` | Achats (demandes, commandes), Finance (dépenses) |

L'ordre d'enregistrement compte : Finance avant Comptabilité (le compte de trésorerie du paiement est fixé avant l'écriture).

### Règles métier transverses
* **Montants** : `decimal.js`, arrondi par devise (FCFA sans décimales) ; la somme des lignes égale toujours le total.
* **Numérotation** : `NumberSequence` atomique par (entreprise, type, année) ; format configurable ; numéro légal attribué à l'émission (facture) / à la validation (écriture) — les brouillons ne consomment pas de numéro.
* **Concurrence** : verrous `SELECT … FOR UPDATE` (facture, dépense, compte, stock) ; testée (paiements, stock, numéros d'écritures, sorties de caisse simultanés).
* **Approbations** (`src/core/approvals.ts`) : règles par type et seuil, jamais de validation par l'auteur, notification des approbateurs habilités, motif de refus obligatoire.
* **Comptabilité** : chaque document produit **au plus une** écriture (contrainte d'unicité source) ; équilibre débit = crédit vérifié ; une écriture validée est **immuable en base** (trigger PostgreSQL) et se corrige par contre-passation ; périodes verrouillables, exercices clôturables (écriture de résultat + à-nouveaux) ; rattrapage idempotent des documents antérieurs à l'activation du module.
* **Tableau de bord** : chaque widget déclare module + permission, vérifiés côté serveur avant tout chargement ; la disposition stockée n'est jamais crue (clés inconnues/non autorisées ignorées).
* **Requêtes SQL brutes** : toujours dans `ctx.tx` (ou `platformTransaction`) pour que le contexte RLS soit posé — une requête brute hors transaction ne voit aucune ligne (fail-closed).

## 12. Phase 4 — RH, Paie, Projets, GED, organisation (livré)

### Découpage
Cinq sous-livraisons, chacune avec sa migration (`phase4a_org` … `phase4e_documents`), ses services et ses tests : **organisation** (`modules/org`), **RH** (`modules/hr`), **paie** (`modules/payroll`), **projets** (`modules/projects`), **GED** (`modules/documents`). Nouveaux fichiers de schéma : `hr`, `payroll`, `projects`, `documents` ; toutes les tables portent `companyId`, sont dans `TENANT_KEY` et ont la RLS (imposé par le test `rls-coverage`).

### Organisation
Agences (un seul siège), sites, départements (hiérarchie, détection de cycle), centres de coûts (code unique en majuscules). Les dépenses, factures client, factures fournisseur et projets peuvent être imputés à une agence et un centre de coûts : la référence est **validée dans l'entreprise** (`assertOrgRefs`) ; l'analyse par agence/centre est calculée à la demande (`orgAnalysis`).

### RH
* Fiche salarié (matricule `EMP-…`, lien optionnel vers un utilisateur), contrats (un nouveau contrat clôture le précédent et met à jour le salaire de base), sortie des effectifs, présences (journée, mois, « tous présents »), évaluations, formations.
* **Congés** : types paramétrables, soldes annuels, jours ouvrés (hors week-ends — pas de jours fériés), validation par le moteur d'approbation (type `leave`, **toujours exigé**) ; une demande n'est approuvée d'office que s'il n'existe aucun autre valideur que le demandeur.
* **Confidentialité** : salaires, contrats, pièce d'identité et coordonnées de paiement ne sont visibles que de ceux qui gèrent les contrats/la paie ; un salarié ne voit que ses propres bulletins validés.

### Paie
* Moteur **pur** (`payroll/calc.ts`, testé sans base) : prorata de présence, gains, retenues dans l'ordre de tri avec une base *imposable* calculée après les retenues déductibles, plafonds, barèmes progressifs, charges patronales.
* **Aucun taux légal n'est codé en dur** : les rubriques (fixe, pourcentage, barème) sont paramétrées par l'entreprise et versionnées par date d'effet ; le modèle indicatif est étiqueté « exemple ». À faire valider par un professionnel de la paie du pays.
* Campagne mensuelle (une seule active par période, contrainte en base) : calcul → validation (figée, écriture comptable de charges) → paiement (mouvement de trésorerie « Salaires et charges sociales » + écriture) ; PDF de bulletin.
* Événements : `payroll.validated/paid/cancelled` (Comptabilité, Finance). Une campagne **payée** n'est pas annulable.

### Projets
Projets, tâches (Kanban, Gantt, dépendances), temps passé (coût horaire = salaire de base ÷ 176 h figé à la saisie, plafond de 24 h par jour et par salarié sous verrou `FOR UPDATE`), coûts rattachés (dépenses payées, factures fournisseur comptabilisées), budget consommé, **facturation du temps** (crée une facture brouillon via le module Ventes puis marque les saisies). Un salarié ne déplace que les tâches qui lui sont confiées.

### GED
* **Fichiers** : stockés derrière `StorageProvider` sous `<companyId>/<versionId>.<ext>`, jamais servis directement : route authentifiée `/api/documents/[id]/download` qui revérifie authentification, module, droit et accès au document à chaque appel.
* **Validation** (`documents/files.ts`) : type RÉEL détecté sur les octets (PDF, PNG/JPEG/WebP/GIF, Word/Excel/PowerPoint par signature ZIP + `[Content_Types].xml`, TXT/CSV UTF-8) ; tout le reste (exécutables, HTML, SVG, archives) est refusé quel que soit le nom ; 8 Mo maximum ; nom assaini ; extension alignée sur le type détecté ; empreinte SHA-256 enregistrée **et revérifiée à chaque lecture**.
* **Versions** : numéro attribué sous verrou de ligne (envois simultanés testés), anciennes versions consultables ; un fichier écrit puis refusé par la base est supprimé (pas d'orphelin).
* **Accès** : lecture = droit `documents.document.read` **et** (propriétaire | administrateur | partage explicite | document « Entreprise » dont toutes les entités liées sont lisibles par l'utilisateur — un document lié à un salarié exige `hr.employee.read`) ; les listes sont filtrées **en base**. Un document interdit répond « introuvable ». Modification = propriétaire/admin/partage « modification » ; suppression et partage = propriétaire ou admin. Le destinataire d'un partage doit être **membre actif** de l'entreprise.
* **Liens** polymorphes (client, fournisseur, salarié, projet, dépense, facture, facture fournisseur, commande fournisseur) : l'entité doit exister **dans l'entreprise** et l'utilisateur doit pouvoir la lire. Panneau « Documents » réutilisable sur les fiches.
* Téléchargement : `attachment` par défaut ; aperçu en ligne uniquement pour PDF et images, avec `nosniff` ; les téléchargements sont tracés dans le journal d'audit.

### Tableau de bord et alertes
Nouveaux widgets (module + permission) : effectif, contrats arrivant à échéance, projets en cours ; alertes (congés en attente, contrats à échéance sous 30 jours) dans le widget et dans la tâche planifiée.

## 13. Phase 5 — Pilotage (livré)

Six sous-livraisons : audit, recherche globale, notifications, workflows, reporting, import/export. Migrations `phase5_notifications`, `phase5_workflows`, `phase5_decisions_append_only`, `phase5_imports`.

### Exports (socle commun)
`core/export/table.ts` : un seul modèle de tableau (`ExportTable`) alimente l'écran, le CSV, l'Excel (exceljs), le PDF (pdfkit, A4 paysage, en-tête répété) et l'impression — les chiffres exportés sont donc ceux affichés. CSV pour Excel francophone (« ; », BOM, décimale « , ») avec **neutralisation de l'injection de formules** (=, +, -, @) ; nom de fichier assaini ; réponses `attachment`, `no-store`, `nosniff`. Les routes `/api/export/[kind]` et `/api/reports/[key]/export` revérifient authentification, module et permissions à chaque appel.

### Journal d'audit (Paramètres → Journal d'audit)
Liste filtrable (texte, utilisateur, ressource, préfixe d'action, période) avec détail avant/après et export. Écriture seule par construction : le rôle applicatif n'a ni UPDATE ni DELETE sur `AuditLog` (testé).

### Recherche globale (⌘/Ctrl+K)
`modules/search` : clients, fournisseurs, factures, devis, salariés, produits, projets, documents. Chaque type n'est interrogé que si son module est actif ET si l'utilisateur détient la lecture ; 5 résultats par type ; recherche exécutée par le serveur dans l'entreprise active ; les documents passent par le filtre d'accès de la GED. Véhicules et chantiers sont ajoutés avec la phase 6.

### Notifications
Catalogue unique (`core/notification-catalog.ts`) ; `notify()` honore les préférences de chaque destinataire pour TOUT émetteur (dans l'application / e-mail) et s'exécute dans la transaction de l'émetteur. L'e-mail passe par une file transactionnelle (`emailPending`) distribuée par la tâche planifiée (jamais pendant la transaction métier). Émetteurs : factures client/fournisseur échues, échéances à 3 jours, stock faible, validations (demande, décision, congés), paiement reçu, tâche confiée, documents expirants (nouvelle date d'échéance sur les documents), contrats à échéance, abonnement. Les notifications Flotte (maintenance, assurance/visite, PV) sont émises depuis la phase 6.

### Workflows et approbations
`core/approvals.ts` : deux niveaux qui coexistent — **politique simple** (seuil, une validation par permission) et **règles / chaînes de validation** (type d'opération, montant [min ; max[, département et rôle du demandeur, priorité ; suite d'étapes confiées chacune à un rôle, ex. Manager → Directeur financier). La règle applicable la plus prioritaire, puis la plus spécifique, l'emporte (`pickRule`, pur et testé).
* Invariants : jamais d'auto-validation ; une même personne ne valide pas deux étapes ; décision verrouillée par `FOR UPDATE` (deux validateurs simultanés → une seule décision) ; journal des décisions en écriture seule ; une demande en cours garde sa chaîne (étapes verrouillées, suppression refusée) ; la ressource n'est appliquée qu'à la décision FINALE (événement `approval.decided`).
* Types : demandes d'achat, commandes fournisseur, dépenses/notes de frais, congés, **paiements fournisseurs** (le règlement est créé « en attente » sans effet financier, appliqué à l'approbation, abandonné au refus ; les paiements en attente comptent dans le reste à payer), **remises commerciales** (l'émission de la facture attend la validation de CETTE remise ; une remise modifiée exige une nouvelle validation). **Budgets : non livré** (les budgets restent saisis sans circuit de validation).

### Reporting (module « Rapports »)
Onze rapports (ventes, chiffre d'affaires, performance commerciale, créances clients, dépenses, résultat, trésorerie, dettes fournisseurs, stocks, RH, projets) filtrables par période, agence, département, utilisateur, client, fournisseur, projet et centre de coûts — **seuls les filtres réellement pris en compte par un rapport lui sont proposés**. Chaque rapport exige son module, `reports.report.read` ET la lecture des données sources ; l'export exige en plus `reports.export.run`. Les valeurs sensibles (masse salariale, congés) disparaissent sans les droits. Résultats plafonnés à 5 000 lignes (signalé). Impression par feuille de style dédiée.

### Import / export de données (Paramètres → Import / export)
Import de clients, fournisseurs, salariés, produits et quantités en stock (CSV / Excel) : analyse du fichier (**format vérifié sur les octets**, contrôle de l'annuaire ZIP avant décompression, 5 Mo / 2 000 lignes / 60 colonnes) → correspondance des colonnes (automatique, modifiable) → vérification ligne par ligne par les schémas des services → import par les SERVICES métier (numérotation, limites du plan, audit) → rapport d'anomalies téléchargeable avec les valeurs d'origine. Une ligne déjà présente est ignorée (un fichier rejoué ne crée aucun doublon) ; doublons du fichier signalés ; données relues au dernier moment ; lancement unique garanti (réservation atomique du statut) ; lignes brutes purgées à la fin. Exige `data.import.manage`, le module et le droit de CRÉATION de l'élément ; salaire et pièce d'identité des salariés réservés aux profils habilités. Exports Excel/CSV/PDF des listes (clients, fournisseurs, produits, stocks, salariés — sans salaires si pas le droit) et modèles d'import téléchargeables ; un export de clients se réimporte tel quel.

## 14. Phase 6 — Extensions : Flotte, Contraventions, Chantiers (livré)

Migration `phase6_fleet_construction` (16 tables, CHECK + RLS) ; schémas `fleet.prisma` et `construction.prisma` ; services `modules/fleet` (`service`, `operations`, `fines`, `costs`) et `modules/construction`.

### Indépendance des modules
La Flotte ne dépend d'aucun autre module : client, projet, fournisseur, salarié, agence et centre de coûts sont de simples colonnes uuid **validées dans l'entreprise** par les services. Les Chantiers exigent Projets (1 chantier = 1 projet créé automatiquement) ; leurs sorties de matériaux sont de **vrais mouvements de stock** (`recordMovement`) et les engins peuvent référencer un véhicule.

### Règles métier
* **Kilométrage** (`applyOdometer`, sous verrou de ligne) : une saisie datée d'aujourd'hui ou la plus récente ne peut être inférieure au compteur et le fait avancer ; une saisie antidatée doit être cohérente avec les relevés voisins (carburant, entretiens terminés, missions terminées) sans modifier le compteur.
* **Conformité** : seule la dernière assurance / visite technique compte ; une pièce **expirée** bloque la planification et le départ en mission des véhicules routiers (voiture, utilitaire, camion, moto).
* **Missions** : planifiée → en cours → terminée / annulée ; une seule mission en cours par véhicule et par chauffeur ; permis valide exigé.
* **Coûts** : comptés une seule fois depuis les enregistrements de flotte ; `createExpenseFromCost` crée une dépense liée (`expenseId`) qui n'est pas recomptée. `vehicleEconomics` : coût total, produit, marge, coût au km.
* **Contraventions** : n° de PV unique par entreprise ; chauffeur déduit de la mission ou de l'affectation à la date (`driverAt`) ; transitions À payer → Payée / Contestée / Annulée, Payée et Annulée finales ; `analyzeFines` mesure la récidive.
* **Chantiers** : budget total = budget du projet ; rapports journaliers uniques par jour, avancement = dernier rapport ; changement de statut du chantier = statut du projet (refus propagé AVANT l'enregistrement pour ne pas diverger).

### Intégrations
GED (liens véhicule, chauffeur, PV, chantier, rapport), recherche globale, notifications (entretien à faire, assurance/visite expirante, PV à payer), alertes planifiées, widgets du tableau de bord (flotte, chantiers), 3 rapports (flotte, contraventions, chantiers), exports (véhicules, contraventions).

### Limites déclarées
Pas de GPS/télématique ni de cartes carburant ; pas de facturation automatique des missions ; pas de circuit de validation des budgets de chantier ; les absences de dossier d'assurance/visite produisent une alerte et non un blocage.

## 15. Phase 8 — Durcissement, performances, documentation (livré)

### Sécurité
* **CSP à nonce** (`core/security/csp.ts`, posée par `src/proxy.ts` sur toutes les pages) : le proxy génère un nonce par requête, le transmet à Next (qui marque ses scripts) et via `x-nonce` (script de thème). Production : `script-src 'self' 'nonce-…' 'strict-dynamic'`. Les requêtes de préchargement sont exclues du proxy (pattern documenté par Next).
* **Limiteur de débit partagé** (`core/security/rate-limit.ts`) : `UPSERT` atomique sur `RateLimitBucket` (fenêtre fixe), testé sous concurrence (20 appels simultanés, limite 5 → 5 autorisés) ; purge par la tâche planifiée ; repli en mémoire.
* `core/env.ts` : `checkEnv()` (noms seulement), utilisée par `instrumentation.ts` et `/api/health`. `global-error.tsx` en dernier filet.
* Prisma : `transactionOptions` {maxWait 10 s, timeout 20 s}, pool paramétrable (`DATABASE_POOL_MAX`).

### Performances — le coût d'une requête
Mesure (build de production, base locale + proxy ajoutant 30 ms d'aller-retour) : une requête applicative `ctx.db` = **≈ 4 allers-retours** (BEGIN, `set_config` du contexte RLS, requête, COMMIT) ; N requêtes dans une même transaction = **N + 3**. Conséquences appliquées :
* **Contexte en une étape** (`core/tenant/access-data.ts` + `context.ts`) : session, appartenances, droits, modules et abonnements en 5 lectures parallèles (droits/modules/abonnements lus pour toutes les entreprises de l'utilisateur, filtrés ensuite sur l'active ; rien n'est utilisé avant validation de la session). Équivalence avec les lectures d'origine prouvée par `context-queries.test.ts`.
* **Compteurs de la barre latérale** hors du chemin critique : `/api/nav/counts` + `NavCountsProvider` (rafraîchi à chaque navigation, au retour sur l'onglet et chaque minute).
* **Tableau de bord** (`modules/dashboard/load.ts`) : widgets répartis en 5 transactions parallèles ; en cas d'erreur SQL dans un lot, les widgets restants sont rechargés individuellement (l'échec d'un widget n'affecte pas les autres).
* Graphiques en `next/dynamic` (`lazy-charts.tsx`), offres publiques en `unstable_cache` (60 s), **41 index** sur clés étrangères (`phase8_indexes`), garde-fou `db-hygiene.test.ts`.
* Alternative non retenue : lier le contexte d'entreprise à la **connexion** (une réserve de connexions par entreprise, paramètre de démarrage) ramènerait chaque requête à 1 aller-retour ; écartée pour l'instant car elle multiplie les connexions et exclut PgBouncer en mode transaction.
* Résultats (30 ms de latence base) : listes ≈ 1,0 s → ≈ 0,5 s ; tableau de bord ≈ 3,2 s → ≈ 1,7 s. **Le levier le plus fort reste de rapprocher la base de l'application** (`docs/EXPLOITATION.md` §2).

### Accessibilité
Audit axe-core (règles WCAG 2.0/2.1 A et AA) : contraste du vert de marque (4,0 → 5,1:1), structure `<ol>`/`<li>` (composant `Reveal as="li"`), `role="status"` sur les squelettes de chargement. Les faux positifs liés à un volet de navigateur masqué sont écartés (vérification manuelle des couleurs réelles).

### Documentation
`docs/DEPLOIEMENT.md`, `SECURITE.md`, `EXPLOITATION.md`, `CONTRIBUER.md`, `PERMISSIONS.md` (généré par `npm run docs:gen` depuis le catalogue, **comparé au code par un test** : la documentation ne peut pas dériver), `CHANGELOG.md`.

Les modèles Prisma sont ajoutés **par phase** (une migration par phase) ; la liste cible figure dans la consigne produit et est couverte par les dépendances ci-dessus.
