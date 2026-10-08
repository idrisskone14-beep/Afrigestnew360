# Déploiement en production (Vercel + PostgreSQL managé)

Guide pas à pas, vérifié sur **Vercel** (application) et **Render** (PostgreSQL). Toute autre base PostgreSQL ≥ 15 convient (Neon, Supabase, RDS…) ; seul l'écran de création change.

## 1. Vue d'ensemble

```
Navigateur ──► Vercel (Next.js, fonctions serverless, région fra1)
                 │  rôle applicatif « afrigest_app » (RLS appliquée, sans BYPASSRLS)
                 ▼
               PostgreSQL managé (SSL obligatoire)         Resend (e-mails)
                 ▲  rôle propriétaire (migrations, seed)   Cron Vercel → /api/cron/alerts
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
| `REQUIRE_EMAIL_VERIFICATION` | recommandé | `true` (exige `RESEND_API_KEY`) |
| `RESEND_API_KEY`, `MAIL_FROM` | si e-mails | clé Resend ; `MAIL_FROM="AfriGest 360 <no-reply@votre-domaine>"` sur un domaine **vérifié** |
| `CRON_SECRET` | oui | `openssl rand -hex 24` (16 caractères minimum) — Vercel l'envoie automatiquement au cron |
| `DATABASE_POOL_MAX` | non | connexions par instance serverless (défaut 5) ; ne dépassez pas `limite de la base ÷ nombre d'instances simultanées` |
| `SIGNUP_MODE` | non | `email` (défaut) ou `approval` : mode d'inscription de repli (le réglage de la console prime) |
| `UPLOAD_DIR` | non | voir §8 (stockage de fichiers) |

Ne mettez **jamais** ces valeurs dans le dépôt. `.env`, `.env.*.local` et `uploads/` sont ignorés par git.

## 4. Vercel

1. *Add New → Project* : importer le dépôt GitHub. Framework détecté : Next.js.
2. Renseigner les variables (§3) pour l'environnement **Production**, puis déployer.
3. Le script `vercel-build` (déclaré dans `package.json`) exécute **`prisma migrate deploy` puis `next build`** : chaque déploiement applique automatiquement les migrations en attente avant de construire. Si une migration échoue, **le déploiement échoue et la version précédente reste en ligne**. Les migrations sont additives et idempotentes par conception (voir `docs/CONTRIBUER.md`).
4. `vercel.json` fixe la région (`fra1`) et le cron quotidien (06 h UTC) `GET /api/cron/alerts`.
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

Le menu affiche une pastille avec le nombre d'inscriptions en attente ; les administrateurs reçoivent aussi un e-mail si l'envoi est configuré (sinon la pastille suffit). Un compte validé peut se connecter immédiatement puis créer son entreprise. Réglage de repli (si aucun réglage n'est enregistré) : variable `SIGNUP_MODE` = `email` ou `approval`.

## 7. E-mails (Resend)

1. Créer un compte sur resend.com ; *Domains → Add Domain* (région Irlande) ; ajouter les enregistrements DNS (SPF, DKIM, MX) chez votre registrar ; *Verify*.
2. *API Keys → Create* (permission *Sending access*) ; copier la clé `re_…` dans `RESEND_API_KEY` (Vercel uniquement).
3. `MAIL_FROM` sur le domaine vérifié. Sans domaine vérifié, Resend n'envoie qu'à l'adresse du compte (test).

Les e-mails de notification passent par une file (`emailPending`) vidée par le cron : sans cron, ils ne partent pas.

## 8. Fichiers téléversés — limite connue

Logos, documents de la GED et justificatifs sont écrits via l'interface `StorageProvider`, dont **seule l'implémentation disque** (`UPLOAD_DIR`) existe. Sur Vercel le disque est **éphémère** : ces fichiers disparaîtraient. **Avant d'ouvrir à de vrais clients**, brancher un stockage objet compatible S3 (Cloudflare R2, S3…) derrière la même interface (`src/core/storage`). Tant que ce n'est pas fait, n'utilisez pas la GED en production.

## 9. Retour arrière

- Application : *Vercel → Deployments →* version précédente → *Promote to Production*.
- Base : les migrations ne sont pas réversibles automatiquement. Avant toute migration destructive (suppression de colonne/table), faire une sauvegarde (`docs/EXPLOITATION.md` §3). Les migrations de la phase 8 ne font qu'ajouter (index, une table).

## 10. Domaine personnalisé

*Vercel → Settings → Domains* ; mettre `APP_URL` à jour ; redéployer ; mettre à jour `MAIL_FROM` si le domaine d'envoi change.
