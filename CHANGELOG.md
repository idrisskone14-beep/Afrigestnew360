# Journal des changements

Format : une entrée par phase livrée, des changements les plus récents aux plus anciens. Détail technique : `docs/ARCHITECTURE.md`.

## Phase 8 — Durcissement, performances, documentation (2026-10)

**Sécurité**
- CSP **à nonce par requête** (aucun `unsafe-inline`/`unsafe-eval` côté scripts en production), en-têtes COOP/CORP, `global-error`.
- **Limitation de débit partagée** en base (table `RateLimitBucket`) : efficace sur serverless, avec repli en mémoire.
- Vérification de configuration (`checkEnv`) au démarrage et via `/api/health` (noms seulement, jamais de valeur).
- Délais de transaction Prisma relevés (attente 10 s, exécution 20 s) : fin des erreurs « transaction expirée » sous charge.
- Audit des dépendances documenté (`docs/SECURITE.md`).

**Performances** (mesurées sur un build de production avec 30 ms de latence base)
- Pages de liste ≈ 1,0 s → ≈ 0,5 s ; tableau de bord ≈ 3,2 s → ≈ 1,7 s.
- Chargement du contexte en une seule étape de lectures parallèles ; compteurs de la barre latérale chargés après l'affichage ; widgets regroupés en 5 transactions parallèles ; graphiques chargés à la demande ; offres publiques en cache 60 s.
- 41 index sur clés étrangères (migration `phase8_indexes`) + test `db-hygiene` contre les régressions.
- `/api/health` mesure la latence vers la base.

**Accessibilité** : audit axe-core (WCAG 2.1 AA) sur l'accueil, la connexion et 4 écrans de l'application ; contraste du vert, structure de liste, rôles ARIA corrigés.

**Documentation** : `DEPLOIEMENT`, `SECURITE`, `EXPLOITATION`, `CONTRIBUER`, `PERMISSIONS` (générée et vérifiée par un test), README.

**Déploiement** : script `vercel-build` (migrations automatiques avant la construction), `vercel.json` (région, cron des alertes).

## Refonte visuelle « Terre d'Afrique » (2026-10)
Palette ivoire/vert forêt/terracotta/ocre, fond blanc, titres en serif, motifs de tissu, ombres décalées ; barre de navigation tissée, transition de thème en cercle, animations (désactivées si l'utilisateur demande moins de mouvement).

## Phase 6 — Extensions : Flotte, Contraventions, Chantiers (2026-10)
Véhicules, chauffeurs, missions, carburant, entretiens, assurances et visites, coûts et rentabilité ; contraventions avec déduction du chauffeur et analyse des récidives ; chantiers (budget, équipe, engins, matériaux sortis du stock réel, sous-traitants, rapports journaliers). 395 tests.

## Phase 5 — Pilotage (2026-10)
Audit consultable, recherche globale, notifications, workflows à chaînes de validation, 11 puis 14 rapports avec exports Excel/CSV/PDF, import/export. 359 tests.

## Phase 4 — RH, Paie, Projets, GED, organisation (2026-10)
Agences et centres de coûts, RH (contrats, congés, présences), paie paramétrable, projets et temps, GED (versions, SHA-256, accès filtrés). 284 tests.

## Phase 3 — Cœur ERP (2026-10)
CRM, ventes et facturation, achats, stock, finance, comptabilité SYSCOHADA, tableau de bord. 225 tests.

## Phases 1 et 2 — Fondations, site public, onboarding (2026-10)
Authentification (2FA, sessions révocables), multi-entreprises, isolation en 3 couches (RLS), RBAC dynamique, modules et offres, Super Admin, site public et assistant de création d'entreprise. 87 tests.
