# Sécurité

Ce document décrit les protections **réellement en place** (chacune est vérifiée par un test ou un contrôle indiqué) et, tout aussi important, **ce qui n'est pas couvert**. Pour signaler une faille : écrire au propriétaire de la plateforme, sans détail public.

## 1. Modèle de menace

| Menace | Réponse |
|---|---|
| Une entreprise lit ou modifie les données d'une autre | Isolation en 3 couches (§2), test dédié « Company A ne voit jamais Company B » |
| Un utilisateur sort de son rôle | RBAC dynamique vérifié **côté serveur** à chaque page et action (§3) |
| Vol ou rejeu de session, force brute | Sessions révocables vérifiées en base, verrouillage, 2FA, limitation de débit (§4) |
| Injection (SQL, script, formule Excel) | Prisma paramétré, validation Zod, CSP à nonce, neutralisation des formules à l'export (§5) |
| Fichier malveillant téléversé | Type vérifié sur les octets, SHA-256, téléchargement authentifié (§6) |
| Falsification de l'historique | Journal d'audit en écriture seule, écritures comptables immuables (§7) |
| Fuite de configuration | Secrets hors dépôt, vérification de configuration, aucune valeur exposée (§8) |

## 2. Isolation multi-entreprises (3 couches)

1. **Contexte serveur** : `requireTenantContext()` authentifie, revérifie l'appartenance **à chaque requête**, contrôle que l'entreprise est active, calcule modules et permissions. Le cookie `afg_company` n'est qu'une préférence **non fiable** : retenu seulement si l'utilisateur est membre actif de l'entreprise visée. Aucun `companyId` ne vient jamais du client.
2. **Extension Prisma** (`core/db/scope.ts`) : toute requête sur un modèle métier est filtrée et estampillée avec l'entreprise active ; modifier ou supprimer une ligne d'une autre entreprise échoue.
3. **PostgreSQL Row Level Security (FORCE)** : le rôle applicatif `afrigest_app` n'est ni superutilisateur ni `BYPASSRLS` ; sans contexte (`app.company_id`) **aucune ligne n'est visible** (échec fermé). Tout contexte est posé dans la transaction qui exécute la requête.

Garde-fous automatiques : `rls-coverage` (toute table à `companyId` a la RLS activée et forcée et figure dans `TENANT_KEY`), `isolation` (A ne lit/modifie/supprime rien de B, à chaque couche), `context-queries` (le chargement groupé du contexte ne laisse fuiter aucune donnée d'une entreprise tierce). Le client `platformDb` (contourne la RLS) est interdit hors `src/core`, `src/modules/platform` et `/super-admin` par une règle ESLint.

## 3. Autorisations

- 148 permissions granulaires (`docs/PERMISSIONS.md`, généré), rôles **propres à chaque entreprise**, éditeur de matrice.
- **Anti-escalade** : on ne peut pas accorder une permission que l'on ne détient pas ; il reste toujours au moins un administrateur.
- **Modules** : un module désactivé (offre ou surcharge) est invisible **et** répond 403 par URL directe ; une permission n'est effective que si son module est actif.
- Toutes les actions passent par `defineTenantAction` : authentification → module → permission → validation Zod → traitement → erreur uniforme **sans trace de pile**.
- **Séparation des tâches** : on ne valide jamais sa propre demande ; une même personne ne valide pas deux étapes d'une chaîne ; décisions verrouillées (`FOR UPDATE`) et journalisées en écriture seule.

## 4. Authentification et sessions

- Mots de passe : bcrypt (coût 12), 10 caractères minimum avec minuscule, majuscule et chiffre.
- Verrouillage du compte après **5 échecs** (15 min) ; comparaison à temps constant, y compris pour un compte inconnu (pas d'énumération par le temps de réponse).
- **Sessions révocables** : le JWT ne suffit pas, la ligne `UserSession` est relue en base à chaque requête (révoquée, expirée ou utilisateur désactivé → refusé immédiatement). Liste et révocation depuis les paramètres de sécurité ; durée maximale 30 jours.
- **2FA TOTP** (RFC 6238) + codes de secours ; secret chiffré en AES-256-GCM (`ENCRYPTION_KEY`), jetons de vérification et de réinitialisation **stockés hachés**.
- E-mail vérifié obligatoire en production (`REQUIRE_EMAIL_VERIFICATION=true`).
- **Deux modes d'inscription**, réglables par le Super Admin (Console → Inscriptions, sans redéploiement) : *confirmation par e-mail* (défaut) ou *validation par le Super Admin* (aucun e-mail requis). En validation manuelle, le compte est créé `PENDING` : **aucune session ne peut être ouverte** tant que le Super Admin n'a pas validé ; la connexion n'indique « en attente » qu'à celui qui connaît le bon mot de passe ; une adresse déjà connue reçoit la même réponse qu'une nouvelle (aucune divulgation) ; une inscription ne se traite qu'une fois (deux validations simultanées : une seule l'emporte) ; le refus désactive le compte ; chaque décision est journalisée.
- **Limitation de débit partagée** (table `RateLimitBucket`, efficace sur serverless) : connexion 30 / 15 min, inscription 5 / h, mot de passe oublié 5 / h, demande de démo 5 / h, par adresse IP. Repli en mémoire si la base est indisponible.

## 5. Navigateur : CSP et en-têtes

- **CSP à nonce par requête** (`core/security/csp.ts`, posée par `src/proxy.ts`) : en production les scripts ne s'exécutent que s'ils portent le nonce (`'strict-dynamic'`) — ni `unsafe-inline` ni `unsafe-eval` pour les scripts ; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`. Testée (`hardening.test.ts`) et vérifiée sur un build de production (hydratation, thème).
- En-têtes statiques : `Strict-Transport-Security` (2 ans, preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (caméra, micro, géolocalisation coupés), `Cross-Origin-Opener-Policy` et `Cross-Origin-Resource-Policy: same-origin`.
- **Exports** CSV/Excel : neutralisation de l'injection de formules (`=`, `+`, `-`, `@`) ; réponses `attachment`, `no-store`, `nosniff`.

## 6. Fichiers

- Type **détecté sur les octets** (PDF, images, Office par signature ZIP, texte UTF-8) ; exécutables, HTML, SVG, archives refusés quel que soit le nom ; 8 Mo maximum ; nom assaini ; empreinte SHA-256 enregistrée **et revérifiée à chaque lecture**.
- Jamais servis directement : route authentifiée qui revérifie authentification, module, droit et accès au document ; `attachment` par défaut, aperçu en ligne limité aux PDF et images avec `nosniff` ; téléchargements journalisés.
- Les listes de documents sont filtrées **en base** ; un document interdit répond « introuvable ».

## 7. Intégrité

- `AuditLog` : le rôle applicatif n'a que `INSERT` et `SELECT` (testé). Avant/après, utilisateur, adresse IP.
- Écritures comptables **validées** immuables (trigger PostgreSQL), correction par contre-passation ; numérotation légale atomique.
- Montants en `decimal.js`, verrous de ligne sur les opérations concurrentes (paiements, stock, caisses), testés.

## 8. Configuration et secrets

- Aucun secret dans le dépôt (`.env`, `.env.*.local`, `uploads/` ignorés). Un test vérifie que les documents ne contiennent ni URL de base avec mot de passe ni clé d'API.
- `checkEnv()` (au démarrage et via `/api/health`) signale les variables **manquantes ou invalides par leur nom**, jamais leur valeur.
- **Piège** : Next.js charge automatiquement `.env.production.local` lors d'un `build` ou d'un `start` **local**. Ne nommez jamais ainsi un fichier contenant les secrets de production (votre poste se connecterait à la base de production) ; utilisez un nom non chargé, p. ex. `.env.vercel-production.local`.
- Deux rôles de base de données : l'application n'utilise jamais le propriétaire.

## 9. Dépendances

`npm audit --omit=dev` signale 6 avis, tous **sans effet sur l'application en exécution** :

| Paquet | Avis | Pourquoi sans effet |
|---|---|---|
| `mysql2`, `deepmerge-ts` (via la CLI `prisma`) | élevé | outil de développement/migration, jamais chargé par l'application ; MySQL n'est pas utilisé |
| `uuid` < 11.1.1 (via `exceljs`) | modéré | l'avis exige de fournir un tampon à `uuid` v3/v5/v6 ; `exceljs` ne le fait pas |

À réexaminer à chaque montée de version de `prisma` et `exceljs`.

## 10. Ce qui n'est PAS couvert

- **Pas d'antivirus** sur les fichiers téléversés (le type est vérifié, pas l'innocuité du contenu).
- **Pas de test d'intrusion indépendant** ni d'audit de sécurité externe à ce jour : à faire avant une exploitation à grande échelle.
- Pas de WAF, de CAPTCHA, de détection d'anomalies ni de SIEM ; la limitation de débit repose sur l'adresse IP transmise par le proxy (`x-forwarded-for`).
- Le stockage de fichiers de production (S3 compatible) n'est pas encore branché (`docs/DEPLOIEMENT.md` §8).
- Sauvegardes, supervision et astreinte relèvent de l'exploitant (`docs/EXPLOITATION.md`).
- Conformité réglementaire (protection des données personnelles selon le pays, rétention, droit à l'effacement) : non évaluée ; le journal d'audit et les exports facilitent mais ne remplacent pas un avis juridique.
