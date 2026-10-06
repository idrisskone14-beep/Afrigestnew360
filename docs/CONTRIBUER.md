# Contribuer

Conventions et recettes pour faire évoluer AfriGest 360 sans casser l'isolation, les droits ni les données.

## 1. Poste de développement

```bash
npm install
cp .env.example .env     # AUTH_SECRET, ENCRYPTION_KEY, PLATFORM_OWNER_PASSWORD… (voir .env.example)
npm run db:start         # PostgreSQL embarqué (port 54329) — laisser tourner
npm run db:migrate       # migrations (propriétaire)
npm run db:app-role      # active le rôle applicatif afrigest_app (RLS appliquée)
npm run db:seed          # catalogue + démonstration (vrais services : numérotation, stock, comptabilité)
npm run dev              # http://localhost:3000
```

Contrôles avant de proposer un changement :

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

La suite complète prend ≈ 5 à 10 minutes (PostgreSQL éphémère automatique, port 54330). Un test isolé : `npx vitest run tests/integration/fleet.test.ts`.

## 2. Règles d'or

1. **Jamais de `companyId` venant du client.** Utiliser `ctx` (`requireTenantContext()` pour les pages, `defineTenantAction` pour les actions).
2. **Requêtes** : `ctx.db` (une requête isolée) ; plusieurs étapes dépendantes ou écritures multiples → `ctx.tx(async (tx) => …)`. SQL brut **uniquement** dans `ctx.tx` (hors transaction, aucune ligne n'est visible sous RLS).
3. **`platformDb` (contourne la RLS)** : interdit hors `src/core`, `src/modules/platform` et `/super-admin` (règle ESLint). Dans un module, passer par `ctx.db`, y compris pour `companyMembership`.
4. **Modules indépendants** : un module n'écrit pas dans un autre ; il émet un **événement de domaine** (`core/events.ts`) que les abonnés traitent dans la même transaction.
5. **Pas de fonctionnalité simulée** : une fonction non livrée est déclarée comme telle (statut du module, texte de la page), jamais un bouton qui ne fait rien.
6. **Performance** : chaque `ctx.db` coûte ≈ 4 allers-retours vers la base. Regrouper les lectures d'une page dans une même transaction ou les lancer en parallèle (`Promise.all`) ; éviter les requêtes en cascade. Voir `docs/EXPLOITATION.md` §2.

## 3. Recettes

### Nouvelle table métier
1. Ajouter le modèle dans `prisma/schema/<domaine>.prisma` avec `companyId`, `@@index([companyId, …])` et un index pour **chaque clé étrangère** utilisée en filtre ou jointure (le test `db-hygiene` échoue sinon).
2. L'enregistrer dans `src/core/db/tenant-models.ts` (`TENANT_KEY`).
3. `npx prisma migrate dev --create-only --name <nom>` — **une seule fois** (un second appel applique la migration, parfois en doublon vide).
4. Ajouter à la fin de la migration : `SELECT afg_enable_rls('"MaTable"');`
5. `npx prisma migrate deploy` puis `npx prisma generate` (et redémarrer le serveur de dev).
6. Ne **jamais** modifier une migration déjà appliquée : en ajouter une nouvelle.

### Nouvelle permission
Ajouter `{ key: "domaine.ressource.action", module, … }` dans `src/core/rbac/catalog.ts`, ajuster les rôles modèles si besoin, lancer `npm run docs:gen` (met à jour `docs/PERMISSIONS.md`, vérifié par un test) puis `npm run db:seed` (synchronise les permissions).

### Nouveau module
`src/core/modules/registry.ts` (+ `roadmap.ts`), ses permissions, ses pages sous `src/app/app/<module>` (garde `requireModulePage`), son service sous `src/modules/<module>` (schémas Zod, service, actions, tests). Statut `planned` tant que les écrans ne sont pas livrés.

### Nouvelle action serveur
Toujours via `defineTenantAction` / `defineUserAction` / `definePlatformAction` / `definePublicAction` (authentification → module → permission → Zod → traitement → erreurs uniformes). Un fichier `"use server"` n'exporte que des fonctions asynchrones. Une action publique (inscription, contact…) appelle `enforceRateLimit(scope, { limit, windowMs })`.

### Nouvelle notification / validation / rapport / export
Catalogue `core/notification-catalog.ts` · types dans `core/approval-types.ts` · `modules/reports/catalog.ts` · modèle `ExportTable` (`core/export/table.ts`) : un seul modèle alimente écran, CSV, Excel, PDF et impression.

## 4. Tests : ce que l'on attend

Tout changement touchant un chemin critique ajoute un test : **isolation** (l'entreprise A ne voit ni ne modifie rien de B), **permissions** (refus sans droit, refus si module désactivé), **concurrence** (verrous), **règles métier** (cas limites). Les tests d'intégration utilisent une vraie base PostgreSQL éphémère (jamais de simulacre de base).

## 5. Style

- TypeScript strict, Zod pour toute entrée ; messages d'erreur en français, sans détail technique.
- Interface : composants du dossier `components/ui` (shadcn), jetons de couleur du thème (`bg-background`, `text-brand`…), jamais de couleur codée en dur hors identité visuelle. Accessibilité : contrastes AA, rôles ARIA corrects (un audit axe-core est dans la démarche de revue).
- Commentaires : le **pourquoi** (contrainte, piège), pas le quoi.

## 6. Pièges connus

- Windows : `npx prisma migrate dev` ne doit être lancé **qu'une fois** par migration ; les scripts shell avec apostrophes ou barres obliques inverses sont fragiles → écrire un script `.mjs` dans un fichier.
- Un fichier `.env.production.local` est **chargé automatiquement** par `next build` / `next start` : n'y mettez pas de secrets de production (`docs/SECURITE.md` §8).
- `parseDate` renvoie midi **local** : pour comparer à « aujourd'hui », utiliser `todayUtc()` + `DAY`.
- La base de développement embarquée s'arrête avec sa session ; la relancer avec `npm run db:start`.
