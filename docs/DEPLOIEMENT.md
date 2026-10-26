# Déploiement en production (Vercel + PostgreSQL managé)

Guide pas à pas, vérifié sur **Vercel** (application) et **Render** (PostgreSQL). Toute autre base PostgreSQL ≥ 15 convient (Neon, Supabase, RDS…) ; seul l'écran de création change.

## 1. Vue d'ensemble

```
Navigateur ──► Vercel (Next.js, fonctions serverless, région fra1)
                 │  rôle applicatif « afrigest_app » (RLS appliquée, sans BYPASSRLS)
                 ▼
               PostgreSQL managé (SSL obligatoire)         Resend (e-mails)
                 ▲  rôle propriétaire (migrations, seed)   Cron Vercel → /api/cron/alerts, /api/cron/recurring
```

Deux comptes de base de données, deux URL :

| Variable | Rôle PostgreSQL | Sert à |
|---|---|---|
| `DATABASE_URL` | `afrigest_app` (sans `BYPASSRLS`, sans droit de création) | l'application, à l'exécution |
| `DIRECT_URL` | propriétaire de la base | migrations Prisma, seed, activation du rôle applicatif — **jamais** utilisée par les requêtes de l'application |

## 2. Base de données

1. Créer une base PostgreSQL (région proche de Vercel, p. ex. Francfort). Ouvrir l'accès réseau depuis l'extérieur (Vercel n'a pas d'adresse IP fixe) : la base reste protégée par mot de passe et SSL.
2. Noter l'**URL externe** du propriétaire. Ajouter `?sslmode=require`.
3. Depuis votre poste, avec `DIRECT_URL` pointant sur cette base :

> **Générer les secrets** : `npm run secrets` affiche `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `APP_DB_PASSWORD` et un mot de passe propriétaire, à copier dans Vercel (rien n'est écrit sur disque). Les clés push : `npm run push:keys`.

```bash
npx prisma migrate deploy        # crée le schéma (migrations versionnées dans prisma/migrations)
APP_DB_PASSWORD=<mot-de-passe-fort> npm run db:app-role   # active le rôle afrigest_app
SEED_DEMO=false npm run db:seed  # catalogue (modules, offres, permissions) + compte propriétaire
```

   `APP_DB_PASSWORD` : 24 caractères aléatoires au minimum, différent de celui du propriétaire.
4. Construire `DATABASE_URL` : même hôte et même base, utilisateur `afrigest_app`, ce mot de passe, `?sslmode=require`.

> `SEED_DEMO=false` : **ne chargez pas la démonstration** sur la base de production (comptes `*.demo` partageant un même mot de passe). Elle sert aux environnements de présentation uniquement.

## 3. Variables d'environnement (Vercel → Settings → Environment Variables → *Production*)

| Variable | Obligatoire | Valeur |
|---|---|---|
| `DATABASE_URL` | oui | URL du rôle `afrigest_app` |
| `DIRECT_URL` | oui | URL du propriétaire (utilisée par `vercel-build` pour appliquer les migrations) |
| `AUTH_SECRET` | oui | `openssl rand -base64 32` (32 caractères minimum) |
| `AUTH_TRUST_HOST` | oui | `true` |
| `ENCRYPTION_KEY` | oui | `openssl rand -hex 32` (64 caractères hexadécimaux ; chiffre les secrets 2FA) |
| `APP_URL` | oui | URL publique, `https://…` (liens des e-mails) |
| `PLATFORM_OWNER_EMAIL` / `PLATFORM_OWNER_PASSWORD` | au premier seed | compte propriétaire de la plateforme (`/super-admin`) — mot de passe fort, à changer après la première connexion |
| `REQUIRE_EMAIL_VERIFICATION` | recommandé | `true` : la connexion exige une adresse e-mail confirmée — **sauf en mode « validation par le Super Admin »** (choisi dans la console, ou imposé faute d'envoi d'e-mails), où aucune confirmation n'est demandée. `false` : jamais exigée |
| `RESEND_API_KEY`, `MAIL_FROM` | si e-mails | clé Resend ; `MAIL_FROM="KAKO Gestion <no-reply@votre-domaine>"` sur un domaine **vérifié** |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | si notifications push | générer UNE paire avec `npm run push:keys` ; `VAPID_SUBJECT=mailto:contact@votre-domaine`. Changer de clés oblige chaque utilisateur à réactiver les notifications sur ses appareils |
| `CRON_SECRET` | oui | `openssl rand -hex 24` (16 caractères minimum) — Vercel l'envoie automatiquement au cron |
| `DATABASE_POOL_MAX` | non | connexions par instance serverless (défaut 5) ; ne dépassez pas `limite de la base ÷ nombre d'instances simultanées` |
| `SIGNUP_MODE` | non | `email` (défaut) ou `approval` : mode d'inscription de repli (le réglage de la console prime) |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | **oui sur Vercel** | stockage des fichiers (logos, GED) : voir §8. `S3_REGION` (défaut `auto`), `S3_ENDPOINT` (vide pour Amazon S3), `S3_FORCE_PATH_STYLE`, `S3_KEY_PREFIX` en option |
| `LEGAL_COMPANY`, `LEGAL_FORM`, `LEGAL_ADDRESS`, `LEGAL_REGISTRATION`, `LEGAL_PUBLISHER`, `LEGAL_EMAIL`, `LEGAL_HOST`, `LEGAL_COUNTRY`, `LEGAL_AUTHORITY` (+ `LEGAL_PHONE` facultatif) | **avant l'ouverture** | informations de l'éditeur affichées dans les pages légales (voir §11) ; absentes, elles s'affichent « [à compléter] » et `/api/health` avertit |
| `SENTRY_DSN` | recommandé | DSN du projet Sentry : remonte les erreurs des utilisateurs (voir `docs/EXPLOITATION.md` §1). Figé à la construction : redéployer après modification. `SENTRY_ENVIRONMENT` facultatif |
| `UPLOAD_DIR` | non | dossier des fichiers si `S3_BUCKET` est vide (serveur à disque durable uniquement) |

Ne mettez **jamais** ces valeurs dans le dépôt. `.env`, `.env.*.local` et `uploads/` sont ignorés par git.

## 4. Vercel

1. *Add New → Project* : importer le dépôt GitHub. Framework détecté : Next.js.
2. Renseigner les variables (§3) pour l'environnement **Production**, puis déployer.
3. Le script `vercel-build` (déclaré dans `package.json`) exécute **`prisma migrate deploy` puis `next build`** : chaque déploiement applique automatiquement les migrations en attente avant de construire. Si une migration échoue, **le déploiement échoue et la version précédente reste en ligne**. Les migrations sont additives et idempotentes par conception (voir `docs/CONTRIBUER.md`).
4. `vercel.json` fixe la région (`fra1`) et deux crons quotidiens : `GET /api/cron/recurring` (05 h UTC, factures récurrentes) puis `GET /api/cron/alerts` (06 h UTC). Les deux exigent `CRON_SECRET`.
5. `vercel-build` applique les migrations puis `scripts/sync-catalog.ts` (catalogue modules / permissions, idempotent) avant `next build`.
5. Après chaque modification de variables : **Redeploy** (les variables ne s'appliquent qu'aux nouveaux déploiements).

## 5. Vérifications après déploiement

```bash
curl https://<votre-domaine>/api/health
```

Réponse attendue : `{"ok":true,"database":"ok","problems":[…]}`.
- `ok:false` + liste de **noms** de variables manquantes ou invalides → corriger puis redéployer.
- `(avertissement) RESEND_API_KEY absente…` → les e-mails de vérification et d'invitation ne partiront pas.
- La route ne révèle aucune valeur ; elle peut rester publique.

Puis : `/connexion` avec le compte propriétaire → `/super-admin` ; créer une entreprise de test ; vérifier qu'un utilisateur d'une entreprise ne voit pas l'autre (isolement).

Les erreurs affichées aux utilisateurs portent une **référence** (« Référence : 1234567890 ») : cherchez-la dans *Vercel → Logs* pour retrouver la cause exacte.

## 6. Inscriptions : confirmation par e-mail ou validation par le Super Admin

Console propriétaire → **Inscriptions** : deux modes, modifiables à tout moment sans redéploiement.

| Mode | Fonctionnement | Quand l'utiliser |
|---|---|---|
| Confirmation par e-mail (défaut) | l'inscrit reçoit un lien et active son compte | e-mails configurés (Resend) |
| **Validation par le Super Admin** | aucun e-mail requis : le compte reste « en attente » ; le Super Admin le **valide** ou le **refuse** depuis la même page | e-mails pas encore configurés, ou plateforme fermée / sur invitation |

Le menu affiche une pastille avec le nombre d'inscriptions en attente ; les administrateurs reçoivent aussi un e-mail si l'envoi est configuré (sinon la pastille suffit). Un compte validé peut se connecter immédiatement puis créer son entreprise. **Aucune inscription ne reste bloquée** : si l'envoi d'e-mails n'est pas opérationnel (production sans clé Resend), le mode « e-mail » bascule automatiquement en validation par le Super Admin (un bandeau l'indique dans la console) ; et si un e-mail échoue en cours d'inscription (clé invalide, domaine non vérifié…), le compte est mis en attente de validation au lieu d'afficher une erreur. Les comptes déjà bloqués (adresse jamais confirmée, jamais connectés) apparaissent dans la même liste, repérés « Adresse e-mail non confirmée », et se débloquent en un clic.

Réglage de repli (si aucun réglage n'est enregistré) : variable `SIGNUP_MODE` = `email` ou `approval`.

## 7. E-mails (Resend)

1. Créer un compte sur resend.com ; *Domains → Add Domain* (région Irlande) ; ajouter les enregistrements DNS (SPF, DKIM, MX) chez votre registrar ; *Verify*.
2. *API Keys → Create* (permission *Sending access*) ; copier la clé `re_…` dans `RESEND_API_KEY` (Vercel uniquement).
3. `MAIL_FROM` sur le domaine vérifié. Sans domaine vérifié, Resend n'envoie qu'à l'adresse du compte (test).

Les e-mails de notification passent par une file (`emailPending`) vidée par le cron : sans cron, ils ne partent pas.

## 8. Fichiers téléversés (S3-compatible)

Logos, documents de la GED et justificatifs passent par l'interface `StorageProvider` (`src/core/storage`). Deux implémentations :

| Configuration | Fournisseur | Usage |
|---|---|---|
| `S3_BUCKET` renseigné | **S3-compatible** (Amazon S3, Cloudflare R2, Scaleway, Backblaze B2, MinIO…) | production, **obligatoire sur Vercel** (le disque y est éphémère : `/api/health` signale l'absence comme bloquante) |
| `S3_BUCKET` vide | disque (`UPLOAD_DIR`, défaut `./uploads`) | développement, ou serveur avec volume durable et sauvegardé |

Mise en place (exemple Cloudflare R2, valable à l'identique pour les autres) :

1. Créer un bucket **privé** (aucun accès public, aucun domaine public : l'application contrôle l'accès à chaque lecture).
2. Créer une clé d'accès limitée à ce bucket (lecture + écriture + suppression) ; noter l'identifiant et le secret.
3. Renseigner dans Vercel : `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (R2 : `https://<compte>.r2.cloudflarestorage.com` ; vide pour Amazon S3), `S3_REGION` (`auto` pour R2, ex. `eu-west-3` pour Amazon S3). `S3_FORCE_PATH_STYLE=true` pour MinIO.
4. Redéployer, puis vérifier `/api/health` : `"storage":"s3"` et aucun problème bloquant. Téléverser un logo (Paramètres → Entreprise) et le retrouver après un redéploiement.

Les fichiers sont rangés sous `<identifiant-entreprise>/…`. Activer la **sauvegarde / le versionnement** du bucket chez le fournisseur : l'application ne sauvegarde pas les fichiers. Pour partager un bucket entre environnements, utiliser `S3_KEY_PREFIX` (`prod`, `preprod`).

## 9. Retour arrière

- Application : *Vercel → Deployments →* version précédente → *Promote to Production*.
- Base : les migrations ne sont pas réversibles automatiquement. Avant toute migration destructive (suppression de colonne/table), faire une sauvegarde (`docs/EXPLOITATION.md` §3). Les migrations de la phase 8 ne font qu'ajouter (index, une table).

## 10. Domaine personnalisé

*Vercel → Settings → Domains* ; mettre `APP_URL` à jour ; redéployer ; mettre à jour `MAIL_FROM` si le domaine d'envoi change.

## 11. Pages légales

Le site publie trois pages : **/conditions-utilisation**, **/confidentialite** et **/mentions-legales** (liées dans le pied de page, le plan du site et la case d'acceptation de l'inscription). Elles se remplissent avec les variables `LEGAL_*` (§3) : aucune information de l'éditeur n'est écrite dans le code.

> **Ce sont des modèles.** Faites-les valider par un juriste avant l'ouverture : droit applicable et juridiction, autorité de protection des données de votre pays, durées de conservation (90 jours après résiliation, 3 ans pour les demandes de contact), plafond de responsabilité, conditions commerciales. Après toute modification du contenu, mettre à jour `LEGAL_UPDATED` dans `src/lib/legal.ts`.

Vérifier après déploiement : aucune mention « [à compléter] » visible sur les trois pages, et `/api/health` sans avertissement « Pages légales incomplètes ».
