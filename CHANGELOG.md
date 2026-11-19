# Journal des changements

Format : une entrée par phase livrée, des changements les plus récents aux plus anciens. Détail technique : `docs/ARCHITECTURE.md`.

## Installer l'application : un bouton visible (2026-11)
- **Avant** : l'invite d'installation n'existait que dans Paramètres › Notifications, introuvable pour un utilisateur.
- **Maintenant** : bouton « Installer l'app » dans l'en-tête (quand le navigateur propose l'installation, et sur iPhone), entrée « Installer l'application » dans le menu du compte, et bandeau fermable sur le tableau de bord (surtout pour le téléphone).
- **Quand l'installation en un geste n'est pas possible** (iPhone, Safari, Firefox…), une fenêtre explique la marche à suivre selon l'appareil. Rien ne s'affiche si l'application est déjà installée.
- L'invite du navigateur n'étant émise qu'une fois, elle est captée une seule fois et partagée à tout l'écran (`InstallProvider`).

## Facture normalisée électronique (FNE, Côte d'Ivoire) (2026-11)
- **Fermée par défaut** : tant que la DGI n'a pas autorisé le raccordement, la FNE est invisible et inactive ; la variable `FNE_ENABLED=true` l'ouvre.
- **Raccordement par API** à la plateforme FNE de la DGI (procédure d'interfaçage de mai 2025) : Paramètres › **FNE (DGI)** — environnement test ou production, clé API **chiffrée** (jamais renvoyée au navigateur), point de vente, établissement, messages, code d'exonération pour la TVA 0 % (TVAC / TVAD), solde de stickers.
- **Factures** : certification automatique à l'émission (ou manuelle depuis la fiche), type de client (B2B/B2C/B2G/B2F, proposé d'après la fiche client) et mode de paiement choisis à l'émission. Numéro FNE, lien de vérification et **QR code imprimés sur le PDF**.
- **Avoirs** : certifiés sur les articles de la facture d'origine certifiée (API « refund »).
- **Fiabilité** : un refus ou une panne de la FNE n'annule jamais l'émission ; l'état est enregistré (certifiée / refusée / incertaine) avec son motif et la certification se relance depuis la fiche. Réservation atomique : jamais deux certifications pour la même facture. Après une panne réseau (issue incertaine), une confirmation est demandée avant de réessayer. Une facture certifiée ne peut plus être annulée (avoir obligatoire).
- Limites : lignes négatives (déduction d'acompte) et taux de TVA autres que 18 / 9 / 0 % non transmis ; bordereau d'achat de produits agricoles (API #3) et reçus normalisés (RNE) non pris en charge ; factures en XOF uniquement.

## Paramétrage du dossier de l'entreprise à la première connexion (2026-11)
- **Parcours en 4 étapes** pour l'administrateur invité par le Super Admin : Identification, Dossier fiscal, Dossier social, Équipe. Page `/app/parametrage`, proposée une seule fois à la première connexion de l'administrateur, puis accessible à tout moment (Paramètres › « Dossier (fiscal et social) »).
- **Chaque étape s'enregistre séparément** et peut être passée. « Passer pour l'instant » ne redirige plus l'administrateur, mais un rappel reste affiché sur le tableau de bord jusqu'à « Terminer le paramétrage ».
- **Nouveaux champs** (migration `company_setup_profile`) : sigle, commune, code postal, activité, référentiel comptable, régime fiscal, date de début d'activité, fréquence de TVA, ROF TVA, TVA intracommunautaire, direction régionale et service des impôts, NTD, numéro de caisse sociale, taux de prestation familiale et d'accident du travail, secteur de salaires minima. L'identifiant fiscal (NCC), le RCCM et le capital existaient déjà.
- **Étape Équipe** : le panneau Utilisateurs existant (invitation par e-mail avec rôle, changement de rôle).
- Réservé au droit « modifier l'entreprise » (l'administrateur l'a d'office). Les entreprises déjà terminées ne sont pas touchées ; celles créées par le Super Admin sans paramétrage le voient à la première connexion de leur administrateur.
- Testé : enregistrement des trois sections, champs vides à NULL, « passer » et « terminer » (une seule fois), isolation entre entreprises, validations.

## Page d'accueil repensée : concrète, avec le vrai produit (2026-11)
- **Constat** : la page ressemblait à un modèle de site de logiciel (promesses vagues, 17 sections, maquette aux faux chiffres). Elle passe à 12 sections, toutes appuyées sur des fonctions qui existent.
- **Nouveau message** : « Du devis à la comptabilité, sans ressaisir une seule ligne » (page, titre du site, aperçu au partage, pied de page, écran de connexion).
- **Héros sombre** au quadrillage de la marque, avec une **vraie capture** du produit (encaissements : espèces, Mobile Money, virement, chèque) à la place de la maquette.
- **Un seul flux** : quatre onglets (devis, facture, encaissement, comptabilité), une capture réelle par étape, « ce que vous faites » et « ce que Global Gest fait à votre place ». Navigation au clavier (flèches, Début, Fin).
- **Sur le terrain** : scan de code-barres, photo de justificatif, création en un geste, installation sur l'écran d'accueil, avec une capture mobile.
- **Pour votre métier** : commerce, BTP et chantiers, transport, services, avec les fonctions réelles de chaque module ; **reprise des données** depuis Excel ou CSV.
- **Retirés** : constat, solution, étapes, avantages, secteurs, bloc « Intelligence » et profils illustratifs (génériques), pays défilants, maquette fictive.
- Captures prises sur le compte de démonstration (noms de personnes remplacés par des noms fictifs), en WebP léger dans `public/landing/` (≈ 490 Ko pour les six).

## Nouvelle identité : Global Gest (2026-11)
- **Nouveau nom, nouveau logo, nouvelle palette « Vert & Marine »** tirée du logo : vert menthe #00D098 et marine #000D20, en thème clair comme en thème sombre. Contrastes AA vérifiés : le vert du logo étant trop clair pour du texte sur blanc, les boutons et liens du thème clair utilisent un vert plus profond (#00805C, #007A58) ; en thème sombre, c'est le vert du logo qui porte l'action.
- **Remplacé partout** : interface, e-mails, PDF (en-têtes verts, « Document généré par Global Gest »), exports Excel, aperçu des documents, pages publiques et légales, manifeste de l'application installable, icônes, service worker, nom affiché dans les applications d'authentification (2FA), graphiques et pastilles de modules.
- **Logo** : le « G » et le nom sont extraits de l'image source (`assets/brand/global-gest-logo-source.webp`) par `node scripts/make-brand-assets.mjs`. Le nom sert de masque : il prend la couleur du thème (blanc en sombre, marine en clair) avec la typographie exacte du logo. Un original vectoriel (SVG) donnerait un résultat encore plus net.
- **Aperçu au partage** (Open Graph et Twitter) : image 1200 × 630 et titre quand le lien est partagé (WhatsApp, Facebook, LinkedIn…).
- Les fichiers de sauvegarde nocturne s'appellent désormais `global-gest-….dump.gpg`.
- **Inchangé volontairement** : les noms techniques (base et rôles `afrigest_app` / `afrigest_backup`, paquet npm, comptes de démonstration), dont le renommage casserait la base en service.

## Sauvegarde nocturne hors fournisseur (2026-11)
- **Workflow `backup.yml`** (inactif tant que `BACKUP_ENABLED` n'est pas « true ») : chaque nuit, export de la base, contrôle (une sauvegarde vide est refusée), chiffrement GPG AES-256 vérifié par déchiffrement, envoi dans un stockage S3 externe, suppression des sauvegardes de plus de 30 jours (7 toujours conservées).
- **Compte de sauvegarde en lecture seule** `afrigest_backup` (`npm run db:backup-role`) : c'est son mot de passe, et non celui du propriétaire de la base, qui est confié à GitHub. Testé : lecture de toutes les lignes avec `app.bypass_rls`, aucun droit d'écriture, ni superutilisateur ni BYPASSRLS.
- **Correction de la procédure manuelle** (docs/EXPLOITATION.md §3) : l'isolation entre entreprises étant forcée même pour le propriétaire, l'ancien `pg_dump` échouait ou ne ramenait aucune entreprise. Nouvelle commande (`PGOPTIONS`, `--enable-row-security`, `--file`) et restauration avec création préalable des rôles.
- `npm run secrets` génère aussi `BACKUP_DB_PASSWORD` et `BACKUP_PASSPHRASE`. Dépôt public : le workflow masque les identifiants et n'affiche aucun chiffre métier.

## Phase 8 — Durcissement, performances, documentation (2026-10)

**Inscriptions** : nouveau mode **validation par le Super Admin** (aucun e-mail requis), réglable sans redéploiement dans la console (Inscriptions) ; le compte reste en attente jusqu'à validation ou refus. En mode « validation par le Super Admin », la confirmation d'e-mail n'est plus exigée à la connexion. Une panne d'envoi d'e-mail à l'inscription ne laisse plus de compte bloqué ni d'erreur : le compte passe en attente de validation, et les comptes déjà bloqués se débloquent depuis la console. « Mot de passe oublié » ne révèle plus l'existence d'un compte en cas d'échec d'envoi d'e-mail.

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

## RH : calendrier de travail, congés corrigés, tableaux de bord (2026-10)
- **Jours fériés** par entreprise (page RH › Jours fériés) : ajout, suppression, génération des fêtes fixes et des fêtes liées à Pâques pour la Côte d'Ivoire et le Sénégal (autres pays : fêtes communes à compléter). Les fêtes musulmanes dépendent de la lune et d'un décret : elles se saisissent chaque année. Droit `hr.holiday.manage`.
- **Semaine travaillée** configurable (lundi-vendredi par défaut, samedi possible). Elle et les jours fériés alimentent **le décompte des congés ET le prorata de la paie** : jusqu'ici un férié comptait comme jour ouvré (congé décompté trop long, jours non payés et base du mois faux).
- **Droit à congés** : droit annuel proratisé l'année d'arrivée ou de départ (au demi-jour) ; **acquisition progressive** (on ne pose que ce qui est constitué à la fin de la période) ou à l'avance ; **report** des jours non pris avec plafond et date limite d'utilisation, consommé avant le droit de l'année. Réglable par type de congé.
- **Indicateurs RH** : effectif, mouvements, rotation, ancienneté, pyramide des âges, motifs de départ, absentéisme (jours pointés), congés, masse salariale réelle (paies validées) ou estimée — salaires réservés aux droits contrats / paie.
- **Suivi des congés** : calendrier d'absences du mois (jours fériés et week-ends marqués, congés en attente hachurés), pic d'absence, demandes à valider, soldes de chaque salarié triés du plus bas au plus haut.

## Mobile : application installable, barre du bas, scan, photo, push (2026-10)
- **Application installable (PWA)** : manifeste, icônes (aussi favicon et icône iPhone), service worker. Hors connexion, une page claire s'affiche ; **aucune donnée d'entreprise n'est mise en cache** sur l'appareil.
- **Barre de navigation du bas** (téléphone) : Accueil, module principal, bouton « + » de gestes rapides (devis, facture, commande, scan, photo de justificatif, achats — selon les droits et modules), Alertes, Menu. Cibles tactiles de 44 px sur écran tactile.
- **Scan de code-barres** par la caméra (détecteur natif, ZXing en repli, saisie manuelle en secours) : ouvre la fiche produit, remplit la recherche des produits, ou ajoute l'article dans un devis / une commande / une facture.
- **Photo de justificatif** (`/app/capture`) : dépense créée en brouillon avec la photo (compressée sur l'appareil) rattachée dans les Documents.
- **Notifications push** (Web Push / VAPID) : inscription par appareil, test, préférence « Push » par type d'événement, distribution juste après la requête puis par la tâche planifiée, nettoyage des appareils disparus. Adresses limitées aux services push connus (anti-SSRF). Variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`npm run push:keys`).
- Politique de permissions : `camera=(self)` (nécessaire au scan et à la photo).

## Ventes : envoi, lien public, acomptes, récurrence, tarifs (2026-10)
- **Envoi par e-mail** des devis et des factures (PDF en pièce jointe + lien de consultation), journal des envois, colonne « Envoi » et chiffre « Factures non envoyées ». Droits `sales.quote.send` et `finance.invoice.send`.
- **Lien public** `/p/<secret>` (192 bits, révocable, sans compte) : consultation, PDF et, pour un devis, **acceptation ou refus en ligne** (nom, commentaire, adresse IP journalisés ; notification aux commerciaux ; une seule réponse).
- **Factures d'acompte** depuis un devis ou une commande (pourcentage ou montant TTC, réparti par taux de TVA) ; la facture finale **déduit** les acomptes par des lignes négatives.
- **Factures récurrentes** (mensuel à annuel) : modèle créé depuis une facture, brouillon ou émission + envoi automatiques, rattrapage des échéances manquées, tâche planifiée `/api/cron/recurring` (05 h UTC).
- **Listes de prix par client** : tarif par produit, proposé à la saisie des devis, commandes et factures ; rattachée depuis la fiche client. Droit `sales.pricelist.manage`.
- Déploiement : `vercel-build` synchronise désormais le catalogue de permissions (`scripts/sync-catalog.ts`) ; les rôles issus d'un gabarit reçoivent les NOUVELLES permissions prévues par leur gabarit (les personnalisations existantes ne sont pas touchées).

## Nouvelle interface : coque et listes (2026-10)
Barre du haut (pays, entreprise, année d'affichage), rail d'icônes par famille de modules, menu latéral clair à sous-menus dépliables (les onglets de module disparaissent), titres avec fil d'Ariane, police sans empattement. Listes : cartes de chiffres (Ventes), filtres en pastilles (statut, dates), cases à cocher, export CSV de l'affichage ou de la sélection, pagination « Page X sur N » avec choix du nombre de lignes. L'année d'affichage filtre les listes de Ventes, d'Achats (sauf fournisseurs), les dépenses, les mouvements de trésorerie et les prospects ; cartes de chiffres sur les listes de Ventes, d'Achats, de Finance et sur les prospects ; cases à cocher et export CSV sur toutes les listes en tableau.

## Devis, commandes et factures : nouvelle présentation (2026-10)
Même éditeur en deux volets pour les devis, les commandes et les factures (onglets En-tête / Produits / Paiement et mentions / Options avec, selon le document, agence, centre de coûts, projet ou entrepôt ; aperçu « papier » en direct) ; page de détail qui montre le document tel qu'il sera imprimé ; PDF refondu pour tous les documents commerciaux (logo, émetteur/client, tableau à en-tête orange, détail de TVA, récapitulatif avec « Net à payer », cadre « Bon pour accord »).

## Palette « Orange & Bleu », style corporate (2026-10)
Orange vif (action, accent) nuancé de bleu marine et de bleu vif, fond blanc, **aucun motif décoratif** (aplats unis, un simple filet orange), contrastes AA, mode sombre assorti ; série de graphiques bleu / orange. Précédemment : refonte « Terre d'Afrique » (vert forêt / terracotta / ocre) avec titres en serif, motifs de tissu (retirés depuis), ombres décalées ; barre de navigation tissée, transition de thème en cercle, animations (désactivées si l'utilisateur demande moins de mouvement).

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
