# Recette de préproduction : parcours complet à la main

À dérouler sur l'environnement déployé, après chaque changement important de configuration (stockage, base, e-mails). Utiliser des données préfixées **`TEST-`** (clients, produits, factures…) pour pouvoir tout supprimer ensuite (§P). Cocher chaque ligne ; noter en face le message exact de toute anomalie.

Légende : ✅ vérifié · ⬜ à faire · ❌ anomalie (voir la note).

## A. Sans connexion (vérifié automatiquement le 26/10/2026 sur le site déployé)

| # | Contrôle | Résultat attendu | |
|---|---|---|---|
| A1 | 12 pages publiques (accueil, fonctionnalités, solutions, tarifs, contact, démo, connexion, inscription, mot de passe oublié, 3 pages légales) | toutes en 200 | ✅ |
| A2 | `robots.txt`, `sitemap.xml`, manifeste, service worker, icônes, logos `/brand/*` | 200, nom « KAKO Gestion » | ✅ |
| A3 | `/app/*` et `/super-admin` sans session | redirection vers `/connexion?next=…` | ✅ |
| A4 | `/api/export`, `/api/pdf`, `/api/files/logo` sans session ; `/api/cron/*` sans ou avec un mauvais secret | 401 | ✅ |
| A5 | En-têtes : CSP à nonce, HSTS, X-Frame-Options DENY, nosniff, referrer, COOP/CORP | présents | ✅ |
| A6 | Aucune trace de l'ancien nom (« AfriGest ») dans les pages publiques | 0 occurrence | ✅ |
| A7 | `/api/health` | `ok:true`, `database:"ok"`, `storage:"s3"`, aucun problème bloquant | ❌ `storage:"disk"` : S3 non configuré |
| A8 | Pages légales sans « [à compléter] » | variables `LEGAL_*` renseignées | ❌ à renseigner |
| A9 | Sitemap : adresses canoniques (sans redirection) | `APP_URL` = adresse canonique (ici `https://www…`) | ❌ liste `https://ivoireactu.com` qui redirige (308) |

## B. Premier accès (compte propriétaire de la plateforme)

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| B1 | `/connexion` avec le compte propriétaire | arrivée sur le tableau de bord ou `/super-admin` | ⬜ |
| B2 | Mauvais mot de passe 6 fois de suite | message d'erreur, puis limitation des tentatives | ⬜ |
| B3 | Changer le mot de passe (Paramètres → Sécurité) ; activer puis tester la double authentification | reconnexion avec le code | ⬜ |
| B4 | `/super-admin` → Inscriptions : choisir le mode (e-mail ou validation) | réglage enregistré | ⬜ |
| B5 | Déconnexion, puis retour sur une page `/app/…` | redirection vers la connexion | ⬜ |

## C. Inscription et entreprise

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| C1 | `/inscription` : la case d'acceptation renvoie vers les conditions et la confidentialité | liens fonctionnels (nouvel onglet) | ⬜ |
| C2 | Inscription d'un compte de test (mode e-mail) | e-mail de vérification reçu, lien valable | ⬜ |
| C3 | Inscription en mode « validation » : le Super Admin valide | e-mail de validation reçu, connexion possible | ⬜ |
| C4 | Assistant de création d'entreprise (10 étapes), logo PNG | entreprise créée, logo affiché dans l'en-tête | ⬜ |
| C5 | Paramètres → Entreprise : capital social, RCCM, identifiant fiscal, pied de page personnalisé | enregistré ; visible sur un PDF (E4) | ⬜ |
| C6 | Inviter un second utilisateur (rôle Comptable) | e-mail d'invitation reçu, activation, droits limités | ⬜ |
| C7 | Créer une 2ᵉ entreprise et basculer de l'une à l'autre | chaque entreprise ne voit que ses données | ⬜ |

## D. Ventes et facturation

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| D1 | Créer un client `TEST-Client` (délai 30 jours) | fiche créée, code `CLI-…` | ⬜ |
| D2 | Créer un produit `TEST-Produit` avec stock | référence `PRD-…` | ⬜ |
| D3 | Devis → aperçu en direct → enregistrer → envoyer par e-mail | numéro `DEV-AAAA-…`, e-mail reçu, lien public s'ouvre | ⬜ |
| D4 | Accepter le devis depuis le lien public | statut « Accepté » côté entreprise | ⬜ |
| D5 | Devis → commande → livraison (stock diminue) → facture | numéros `CMD-`, `BL-`, `FAC-` sans trou | ⬜ |
| D6 | Émettre la facture en 3 échéances | échéancier de 3 lignes, total exact | ⬜ |
| D7 | Enregistrer un paiement partiel, puis le solde | statut « Payée en partie » puis « Payée » ; reçu PDF | ⬜ |
| D8 | Émettre un avoir partiel | reste à payer recalculé | ⬜ |
| D9 | Relance d'une facture échue | trace enregistrée | ⬜ |

## E. Documents PDF et partage

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| E1 | Voir et télécharger le PDF d'un devis, d'une facture, d'un avoir, d'un reçu, d'un bon de livraison | PDF lisible | ⬜ |
| E2 | Pied de page des PDF | mentions légales de l'entreprise + « Document généré par KAKO Gestion » sur chaque page | ⬜ |
| E3 | Facture de plus de 30 lignes | plusieurs pages, pied de page et « Page n / N » sur chacune | ⬜ |
| E4 | Aperçu à l'écran = PDF (couleurs violettes, mêmes blocs) | identique | ⬜ |

## F. Achats et stocks

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| F1 | Fournisseur `TEST-Fournisseur`, demande d'achat, commande fournisseur (PDF) | numéros `DA-`, `BC-` | ⬜ |
| F2 | Réception (stock augmente), facture fournisseur, paiement | statuts cohérents, dette suivie | ⬜ |
| F3 | Inventaire : régularisation d'une quantité | mouvement tracé | ⬜ |
| F4 | Scan d'un code-barres (téléphone) | produit trouvé | ⬜ |

## G. Finance et comptabilité

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| G1 | Dépense avec justificatif photo, circuit de validation, paiement | trésorerie diminuée, catégorie imputée | ⬜ |
| G2 | Échéancier : les factures D6 apparaissent **une ligne par échéance** | tranches 0-7 / 8-30 / 31-60 j correctes | ⬜ |
| G3 | Transfert entre caisse et banque, rapprochement | soldes cohérents | ⬜ |
| G4 | Comptabilité : écritures générées par les ventes, achats, paiements | équilibrées ; balance équilibrée | ⬜ |
| G5 | Écriture manuelle, validation, contre-passation | numéro `ECR-…`, immuable | ⬜ |

## H. RH, paie, projets

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| H1 | Salarié, contrat, congé (demande → approbation), jours fériés | solde de congés correct | ⬜ |
| H2 | Campagne de paie : calcul, validation, bulletin PDF | bulletin lisible, pied de page, rubriques d'exemple | ⬜ |
| H3 | Un salarié ne voit que **son** bulletin | accès refusé aux autres | ⬜ |
| H4 | Projet, tâches, temps passé, facturation du temps | facture brouillon générée | ⬜ |

## I. Fichiers (stockage S3)

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| I1 | Téléverser un logo ; **redéployer** ; le logo est toujours là | persistance après redéploiement | ⬜ |
| I2 | GED : téléverser un PDF de 7 Mo, nouvelle version, aperçu, téléchargement | fichier intact | ⬜ |
| I3 | Document restreint : un autre utilisateur ne le voit pas | accès refusé | ⬜ |
| I4 | Supprimer le document | fichier retiré du bucket | ⬜ |

## J. Import / export

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| J1 | Exporter les clients (Excel, CSV, PDF) | fichiers lisibles | ⬜ |
| J2 | Réimporter l'export de clients | tout « déjà présent », aucun doublon | ⬜ |
| J3 | Importer un fichier de factures impayées (modèle) | créées, échéancier cohérent, rapport d'anomalies | ⬜ |
| J4 | Importer plan comptable puis balance d'ouverture | pièce équilibrée validée | ⬜ |

## K. Notifications, e-mails, tâches planifiées

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| K1 | Notification dans l'application (nouvelle validation) | cloche mise à jour | ⬜ |
| K2 | E-mail de notification (préférence activée) | reçu dans la boîte, expéditeur au bon domaine | ⬜ |
| K3 | Appel manuel du cron des alertes avec le secret | 200, alertes créées | ⬜ |
| K4 | Facture récurrente : échéance du jour traitée par le cron | facture brouillon générée | ⬜ |
| K5 | Notifications push (si clés VAPID) : activation sur un téléphone | notification reçue | ⬜ |

## L. Sécurité et droits

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| L1 | Utilisateur « Consultation » : aucun bouton de création, URL directes refusées | refus propre (page « Accès refusé ») | ⬜ |
| L2 | Copier l'adresse d'une facture de l'entreprise A, ouvrir avec l'entreprise B | introuvable | ⬜ |
| L3 | Lien public d'un devis expiré / invalide | message clair, rien de sensible | ⬜ |
| L4 | Journal d'audit : actions de la recette présentes, non modifiables | traces complètes | ⬜ |

## M. Mobile et application installable

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| M1 | Téléphone : navigation basse, « Actions rapides », menu | tous les boutons répondent | ⬜ |
| M2 | Installer l'application (écran d'accueil) | icône « K », ouverture plein écran | ⬜ |
| M3 | Hors connexion | page « Hors connexion » claire | ⬜ |

## N. Supervision

| # | Étapes | Résultat attendu | |
|---|---|---|---|
| N1 | Provoquer une erreur de test (page inexistante côté app connecté) ; vérifier Sentry | événement reçu avec la « Référence » ; aucune donnée personnelle | ⬜ |
| N2 | Sonde externe sur `/api/health` | alerte si ≠ 200 | ⬜ |
| N3 | Restauration d'une sauvegarde de la base sur une base vide | application démarre dessus | ⬜ |

## P. Nettoyage

Supprimer les données `TEST-` (clients, produits, fournisseurs, documents), les entreprises et comptes de test créés (console propriétaire), vider le bucket de ses fichiers de test, puis consigner la date et le résultat dans le tableau ci-dessous.

| Date | Environnement | Anomalies ouvertes | Réalisée par |
|---|---|---|---|
| 26/10/2026 | www.ivoireactu.com (A seulement) | A7, A8, A9 | Claude |
