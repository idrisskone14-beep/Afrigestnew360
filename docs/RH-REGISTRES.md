# Registres RH — mode d'emploi, règles et limites

Ce document décrit les registres de gestion administrative du personnel (module **Ressources humaines**) : ce qui est livré, comment s'en servir, et surtout **ce qui reste à valider juridiquement**. Il ne constitue pas un avis juridique.

> Un registre numérique de Global Gest **ne remplace pas** les registres et déclarations exigés par la réglementation (registre de l'employeur, déclaration d'accident à la CNPS, etc.). Il aide à les préparer et à suivre les dossiers.

## Menu RH

Le menu RH est regroupé en rubriques repliables : *Vue d'ensemble* (Tableau de bord RH, Indicateurs RH, Alertes et échéances, Rapports RH) · *Personnel* · *Personnel* (Salariés, Registre du personnel) · *Temps et absences* (Présences, Congés, Suivi des congés, Permissions, Absences, Retards, Heures supplémentaires, Jours fériés) · *Santé et sécurité* (Accidents de travail, Arrêts maladie, Visites médicales, Équipements et EPI) · *Administration RH* (Sanctions disciplinaires, Avances et acomptes). Chaque entrée n'apparaît que si l'utilisateur a le droit correspondant.

## Droits (catalogue RBAC)

| Registre | Voir tout | Saisir / gérer | Valider | Demander (soi-même) |
|---|---|---|---|---|
| Accidents de travail | `hr.accident.read` | `hr.accident.manage` | — | — (réservé RH) |
| Permissions | `hr.timeoff.read` | `hr.timeoff.manage` | `hr.timeoff.approve` (voit aussi son équipe) | `hr.timeoff.request` |
| Absences | `hr.absence.read` | `hr.absence.manage` | `hr.absence.approve` (voit aussi son équipe) | — |
| Retards | `hr.lateness.read` | `hr.lateness.manage` | — | — |
| Arrêts maladie | `hr.sickleave.read` | `hr.sickleave.manage` | — | — (réservé RH) |
| Heures supplémentaires | `hr.overtime.read` | `hr.overtime.manage` | `hr.overtime.approve` (voit aussi son équipe) | `hr.overtime.request` |
| Avances et acomptes | `hr.advance.read` | `hr.advance.manage` | `hr.advance.approve` (voit aussi son équipe) | `hr.advance.request` |
| Sanctions disciplinaires | `hr.sanction.read` | `hr.sanction.manage` | — | — (réservé RH) |
| Visites médicales | `hr.medvisit.read` | `hr.medvisit.manage` | — | — (réservé RH) |
| Équipements et EPI | `hr.equipment.read` | `hr.equipment.manage` | — | — |
| Registre du personnel, affectations | `hr.employee.read` | `hr.employee.update` | — | — |
| Paramètres RH (horaires, seuils) | — | `hr.holiday.manage` | — | — |

Portée des données : *tout* (RH) · *équipe* = collaborateurs directs et indirects par la hiérarchie `Responsable` de la fiche salarié (droit « valider ») · *soi-même* (droit « demander »). Les rôles existants ne sont pas modifiés : le gabarit « RH » (`hr.*`) reçoit les nouveaux droits, le gabarit « Employé » reçoit « demander une permission ». Pour un responsable d'équipe, ajoutez à son rôle `hr.timeoff.approve`, `hr.absence.approve` et `workflow.request.approve`.

## Accidents de travail

- Numéro de dossier automatique `AT-AAAA-NNNN` ; instantané du salarié (nom, matricule, service) conservé dans le dossier.
- Trois natures : accident de travail, **accident de trajet**, accident en mission. Pour le trajet : champ « itinéraire et circonstances » et « qualification » (À qualifier / Reconnu / Non reconnu) — **la qualification relève de l'organisme compétent, pas du logiciel**.
- Déclaration CNPS : statut, date, référence. Arrêt de travail : dates de début/fin, date de reprise.
- **Alertes de dossier incomplet** (blessures, début d'arrêt, reprise non renseignée, référence CNPS, itinéraire du trajet, déclaration à faire…). Les points « bloquants » empêchent la clôture.
- Cycle : *Ouvert* → *Clos* → *Archivé* (archivage possible seulement après clôture ; **aucune suppression**). Un dossier clos se rouvre explicitement.
- Pièces justificatives : panneau « Documents » de la fiche (module **Documents** requis). Les documents liés à un accident ne sont lisibles que par les profils `hr.accident.read`.
- Historique : toutes les actions (création, modification avec valeurs avant/après, clôture, archivage, **consultation de la fiche**, édition du PDF) sont dans le journal d'audit et affichées sur la fiche.
- Fiche PDF et export Excel/PDF du registre ; tableau de bord (accidents par mois et par nature, jours d'arrêt, déclarations à faire, dossiers incomplets).

## Permissions (distinctes des congés annuels)

- Types de permission **configurables** par l'entreprise (rémunérée ou non par défaut, justificatif attendu, plafond de jours par demande). *Aucune durée « légale » n'est préchargée.*
- Permission **journalière** (jours ouvrés, week-ends et jours fériés exclus) ou **horaire** (heures de travail effectives selon l'horaire de référence des Paramètres RH, pause exclue ; peut chevaucher deux journées).
- Workflow : *Brouillon* → *Soumise (en attente)* → *Approuvée* / *Refusée* → éventuellement *Annulée*. La validation passe par le **moteur global « Validations »** (règles à étapes possibles). Jamais d'auto-validation ; s'il n'existe aucun autre approbateur (entreprise à administrateur unique), la demande est acceptée d'office et la décision est tracée.
- **Chevauchements** refusés avec les congés, les absences et les autres permissions (deux plages horaires voisines sont compatibles). La même vérification est maintenant appliquée aux demandes de **congé** (par-dessus une permission ou une absence).
- Modification : uniquement en brouillon. Une demande en attente ou validée s'annule puis se refait.
- Présences : une permission validée apparaît sur la page **Présences** (permission journalière : « En permission » ; horaire : note sous le nom). Rien n'est recopié dans la table des présences : annuler la permission suffit à tout rétablir.

## Absences

- Motifs **configurables** avec catégorie (justifiée, injustifiée, maladie, exceptionnelle, autre), option « soumise à validation administrative » et « justificatif attendu ».
- Durée en jours ouvrés (demi-journée possible). Statut de justificatif (À justifier / Fourni / Justifiée / Non justifiée) et observation RH.
- Historique par salarié ; **détection des absences répétées** (seuils réglables : au moins N absences injustifiées sur P jours) — c'est un *signal*, il ne déclenche **ni sanction ni retenue**.
- **Aucune retenue sur salaire n'est appliquée** par ce registre. La liaison avec la paie suppose une règle configurée et validée : *non livrée à ce stade*.

## Retards

- Saisie manuelle ou **import depuis les pointages** (Présences) : l'heure d'arrivée est comparée à l'horaire de référence (+ tolérance). L'import est idempotent.
- Durée calculée par le serveur ; un seul retard par salarié et par jour ; pas de retard un jour de congé, d'absence, ni sous une permission validée qui couvre la plage.
- Justification, observation RH, historique, statistiques du mois, **retards récurrents** (seuil réglable), export Excel/PDF. Aucune sanction automatique.
- L'horaire de référence est **unique pour l'entreprise** (Paramètres RH). Les plannings par équipe ou par salarié ne sont pas gérés (il n'existe pas de module de planning).

## Arrêts maladie (suivi administratif)

- **Aucune donnée médicale** n'est enregistrée : ni diagnostic, ni pathologie (aucune colonne n'existe pour cela, vérifié par un test). On suit les dates, le statut du justificatif (attendu / reçu / conforme / non conforme), des observations *administratives* et la reprise. Le certificat se joint dans la GED : il n'est lisible que par les profils `hr.sickleave.read`.
- Début, fin prévue, **prolongations historisées** (ancienne et nouvelle fin, note), **reprise effective** (anticipée ou tardive : les jours effectivement absents sont toujours ceux qui précèdent la reprise). Statuts : En cours → Terminé (reprise) ou Annulé.
- **Alertes de reprise** : fin prévue dans au plus N jours (paramètre, 3 par défaut) ou dépassée sans reprise enregistrée ; justificatif manquant. Affichées sur la page, sur la vue d'ensemble RH (indicateur « Arrêts maladie en cours ») et dans l'export.
- **Absences et présences** : l'arrêt est lu dans son registre (aucune absence n'est dupliquée) : il apparaît comme « Absent — Arrêt maladie » dans les présences, il empêche tout congé, permission ou absence par-dessus, et un retard ce jour-là. Un arrêt annulé ou raccourci par la reprise libère ses jours.
- **Paie : non livrée.** Aucune retenue ni indemnité n'est calculée ; les règles de maintien de salaire et d'indemnisation sont à faire valider (voir ci-dessous).

## Registre du personnel et affectations

- Page **Registre du personnel** : une ligne par salarié (en activité, suspendu, sorti) lue dans la fiche et le dernier contrat : matricule (unique par entreprise), identité et coordonnées, service, agence, poste, **statut professionnel** (libellé libre, ex. cadre/employé), type de contrat, date d'embauche, responsable, situation, date et motif de sortie. Export Excel/PDF **sans salaire ni pièce d'identité**. Aucune donnée n'est dupliquée.
- **Historique des affectations** (onglet « Affectations » de la fiche) : chaque changement de poste, service, agence ou responsable est daté et motivé ; les noms sont conservés tels qu'à l'époque (un service renommé ne réécrit pas le passé). Il est alimenté à l'embauche, à chaque modification de la fiche, à chaque nouveau contrat qui change le poste, et par « Changer l'affectation » (date d'effet : pas dans le futur, pas avant l'embauche ni la dernière affectation). À la mise en service, une ligne initiale est créée par salarié d'après sa fiche actuelle.
- Historique des contrats, pièces administratives (panneau Documents) et sortie (date, motif) : fonctions existantes de la fiche, conservées.

## Heures supplémentaires

- Déclaration datée avec plage horaire (de … à …) : le serveur calcule les **heures réalisées** et les **heures normales prévues** ce jour-là (horaire de référence, jours non travaillés et fériés exclus). Une plage qui empiète sur l'horaire normal d'un jour travaillé est refusée (ce ne sont pas des heures supplémentaires) ; un week-end ou un férié est entièrement supplémentaire. Pas de déclaration à l'avance.
- **Taux de majoration paramétrables** (nom + coefficient) : *aucun taux n'est préchargé ni codé en dur*. La RH affecte le taux (tracé). L'export calcule les heures « majorées » équivalentes à partir du taux choisi.
- Circuit : brouillon → soumission → validation hiérarchique par le moteur « Validations » (un responsable ne valide que son équipe) → heures approuvées. Pas d'auto-validation ; chevauchements avec congés, absences, arrêts et autres déclarations refusés ; modification impossible après validation (annuler puis refaire, annulation d'une déclaration validée réservée à la RH).
- **Paie : non connectée.** Les heures approuvées (et leur taux) sont prêtes à être lues par la paie ; aucun élément variable n'est écrit automatiquement.

## Avances et acomptes

- Demande (avance ou acompte), montant, motif facultatif, **modalités de régularisation** (nombre de mensualités, premier mois de retenue). Validation par le moteur « Validations » (le montant est visible dans la page Validations) ; brouillon modifiable, puis figé.
- **Historique des remboursements** : saisie manuelle par la RH (reste calculé, jamais stocké ; un remboursement ne peut pas dépasser le reste, vérifié sous verrou). Une avance avec remboursement ne s'annule plus.
- **Pas de double déduction** : la table des remboursements porte une période de paie (AAAA-MM) **unique par avance** ; la future retenue sur bulletin utilisera cette contrainte.
- **Paie : retenue automatique non livrée** (voir « Non livré »).

## Sanctions disciplinaires (confidentiel)

- Registre de **suivi de procédure** : dossier numéroté `DIS-AAAA-NNNN`, faits, manquement, étapes (constat, demande d'explications, convocation, audition…), décision, notification, observations, pièces (GED restreinte), historique, **consultations tracées**, fiche PDF, export. Aucune suppression : classement sans suite ou annulation (motif obligatoire).
- **Types de sanction configurables** par l'entreprise (rien de préchargé) avec l'option « audition préalable exigée avant la décision » : si elle est cochée, la décision est refusée tant qu'aucune étape d'audition n'existe à la date de la décision ou avant. Les procédures, délais et sanctions admissibles sont **ceux de votre règlement intérieur et de la loi : à valider avec votre conseil**.
- **Jamais de sanction automatique** : aucun retard, aucune absence répétée, aucun arrêt ne crée ou ne propose de dossier (vérifié par un test). Accès réservé aux profils « sanctions » : ni le salarié concerné, ni un responsable d'équipe ne le voient.

## Visites médicales (suivi administratif)

- Types : embauche, périodique, reprise, autre visite réglementaire. Date prévue, réalisation, organisme / service de santé au travail, **prochaine échéance** (saisie à la réalisation : aucune périodicité n'est présumée), statut du **document d'aptitude** (attendu / reçu / sans objet ; le document est dans la GED restreinte).
- **Aucun résultat médical** n'est enregistré (aucune colonne : vérifié par un test).
- **Rappels** (seuil réglable, 30 jours par défaut) : visites prévues en retard ou proches, et salariés dont l'échéance approche sans visite programmée (« à programmer »). Indicateur sur la vue d'ensemble RH.

## Équipements et EPI

- Remise (désignation, référence, quantité, date, état, remplacement prévu, responsable, observations), **fiche de remise PDF** à signer, restitution (date, état), historique par salarié, export.
- **Alertes** : remplacement proche ou dépassé (seuil réglable) et équipement **non restitué par un salarié sorti**.
- **Lien au stock** (facultatif, module Stock actif et droits de mouvement) : produit + entrepôt → une *sortie de stock* est enregistrée dans la même transaction que la remise (stock insuffisant : rien n'est enregistré) ; la restitution peut remettre en stock (mouvement de retour). Sans lien, aucune écriture de stock.

## Liaison RH → paie (désactivée par défaut)

Réglage : **Paie › Éléments RH** (droit « gérer la paie »). Chaque option est indépendante et **désactivée tant que l'entreprise ne l'active pas** ; aucune règle de retenue ou de majoration n'est présumée.

| Option | Effet sur la campagne de paie (au calcul) |
|---|---|
| Permissions non rémunérées | Les permissions *validées* marquées non rémunérées réduisent le temps payé (jours ; une permission horaire est convertie en jours d'après la journée de référence). |
| Absences « retenue sur salaire » | Seuls les motifs d'absence explicitement marqués « retenue sur salaire » (réservé à la paie) sont déduits ; aucune autre absence. |
| Heures supplémentaires | Heures *approuvées avec un taux affecté* : montant = (salaire de base ÷ heures mensuelles de référence) × coefficient × heures. Les heures mensuelles de référence sont à fixer par l'entreprise (sans elles, l'option est refusée). Sans taux affecté : non payées, avec avertissement. |
| Avances et acomptes | Mensualité = montant ÷ nombre de mensualités à partir du premier mois prévu (rattrape les mois manqués, la dernière solde le reste, jamais plus que le reste dû). |

Garde-fous :
- La page de la campagne affiche l'**aperçu** des éléments RH intégrés (par salarié) avant validation ; le calcul d'un brouillon est rejouable.
- La **consommation** n'est enregistrée qu'à la **validation** de la campagne, à partir de ce qui a été calculé : heures marquées payées pour la période, retenues d'avance enregistrées comme remboursements « paie » (unique par avance et par période). Si une déclaration ou un remboursement a changé entre-temps, la validation est refusée (« recalculez »).
- **Annulation d'une campagne validée** : les heures redeviennent payables et les retenues d'avance sont retirées. Une campagne payée ne s'annule plus (régularisation sur la paie suivante).
- **Arrêts maladie : jamais retenus ni indemnisés par la paie** (les règles de maintien de salaire sont à valider avant toute automatisation).
- Aucune retenue sur départ (solde d'une avance), aucune règle de plafond de retenue : à traiter manuellement.

## Alertes et échéances, rapports

- **Alertes et échéances** (`/app/hr/alertes`) : contrats arrivant à échéance (60 j), reprises d'arrêts maladie, visites médicales (en retard / proches / à programmer), équipements à remplacer ou non restitués, dossiers d'accident à compléter, absences injustifiées répétées, retards récurrents, demandes à valider. Une section n'apparaît que si l'utilisateur a le droit du registre. Ce sont des signaux : jamais d'action ni de sanction automatique.
- **Rapports RH** (`/app/hr/rapports`) : rapport mensuel consolidé (une ligne par salarié : congés, permissions, absences dont injustifiées, arrêts maladie, retards, heures supplémentaires approuvées, accidents) avec totaux et export Excel/PDF/CSV ; les colonnes dépendent des droits de l'utilisateur sur chaque registre. Export **Soldes de congés** (`hr-soldes-conges`) par année.
- **Congés** : la fiche salarié (onglet Congés) affiche l'**historique des droits** des 4 dernières années (droit, report reçu, pris, en attente, reste) ; le suivi des congés (calendrier collectif, soldes, circuit d'approbation) existait déjà et est conservé.

## Paramètres RH

Bouton « Paramètres » (droit `hr.holiday.manage`) : horaire de référence, pause, tolérance de retard, seuils de récurrence, **délai d'alerte de déclaration d'accident** (vide par défaut = aucune alerte de délai), alerte de reprise d'un arrêt maladie, rappels de visites médicales et de remplacement d'équipement.

## Règles à faire valider juridiquement

1. **Délai et formalités de déclaration d'accident du travail / de trajet à la CNPS** : le logiciel ne présume aucun délai ; l'entreprise fixe son alerte.
2. **Qualification de l'accident de trajet** (conditions de reconnaissance) : décision de l'organisme compétent.
3. **Durées de permissions exceptionnelles** (mariage, décès, naissance…) selon la convention collective applicable : à saisir par l'entreprise.
4. **Traitement des absences injustifiées et des retards** (retenue, sanction) : procédure et prescriptions à valider ; aucune action automatique.
5. **Conservation et confidentialité des données de santé** (accidents, arrêts maladie, futures visites médicales) : durées de conservation, habilitations, information des salariés ; consulter le conseil / l'autorité de protection des données.
6. **Arrêts maladie** : maintien de salaire, indemnisation, justificatif et délais de transmission, règles de reprise (visite) : à valider avant toute liaison avec la paie.
7. **Heures supplémentaires** : coefficients de majoration, plafonds et contingent, contrepartie (à saisir dans les taux de l'entreprise).
8. **Avances et acomptes** : plafonds, retenues sur salaire (quotité cessible), régularisation en cas de départ.
9. **Sanctions disciplinaires** : types, procédure (audition, délais, forme de la notification), prescription des faits.
10. **Visites médicales** : périodicité par poste, conservation du document d'aptitude.
11. **Horaires de référence** (durée du travail, pauses) : par défaut 08:00–17:00, simples valeurs modifiables.

## Non livré à ce stade

Pièces justificatives rattachées directement à une demande de congé (le calendrier collectif et le circuit existent), notifications supplémentaires, lettre de notification de sanction générée, tableau de bord RH graphique complet (indicateurs et alertes présents, pas de graphiques par service), retenue d'avance au départ du salarié, règles d'indemnisation des arrêts maladie, pages « Contrats » et « Documents administratifs » du menu cible (les contrats et les pièces restent dans la fiche salarié).
