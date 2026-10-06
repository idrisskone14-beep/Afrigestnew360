# Modules, permissions et rôles

> Document **généré** depuis `src/core/rbac/catalog.ts` et `src/core/modules/registry.ts` — ne pas l'éditer à la main (`npm run docs:gen`).

## Modules

| Clé | Module | Type | État | Description |
|---|---|---|---|---|
| `core` | Cœur | Cœur | Livré | Tableau de bord, utilisateurs, rôles, paramètres, audit. |
| `finance` | Finance | Standard | Livré | Recettes, dépenses, banques, caisses, budgets, échéances. |
| `accounting` | Comptabilité | Standard | Livré | Plan comptable SYSCOHADA, journaux, écritures, états financiers. |
| `sales` | Ventes & Facturation | Standard | Livré | Devis, commandes, livraisons, factures, avoirs, paiements. |
| `crm` | CRM & Clients | Standard | Livré | Prospects, clients, opportunités, pipeline, activités. |
| `purchases` | Achats & Fournisseurs | Standard | Livré | Demandes, commandes, réceptions, factures fournisseur. |
| `inventory` | Stock & Inventaire | Standard | Livré | Produits, entrepôts, mouvements, inventaires, alertes. |
| `hr` | Ressources humaines | Standard | Livré | Employés, présences, congés, contrats, évaluations. |
| `payroll` | Paie | Standard | Livré | Périodes, rubriques configurables, bulletins PDF. |
| `projects` | Projets & Tâches | Standard | Livré | Projets, tâches, Kanban, Gantt, temps et budgets. |
| `documents` | Documents (GED) | Standard | Livré | Dossiers, versions, partage, liens vers les entités. |
| `reports` | Rapports & Analytics | Standard | Livré | Reporting transversal, exports PDF/Excel. |
| `fleet` | Transport & Flotte | Extension | Livré | Véhicules, chauffeurs, missions, entretiens, contraventions. |
| `construction` | Gestion de chantiers | Extension | Livré | Chantiers, équipes, matériaux, rapports terrain. |
| `intelligence` | AfriGest Intelligence | Extension | Prévu | Assistant d'analyse limité aux données autorisées. |

Une permission n'est effective que si son module est actif pour l'entreprise (offre + surcharges) **et** que le rôle de l'utilisateur la détient. Un module désactivé est invisible et répond 403 par URL directe.

## Permissions (148)

### Cœur (`core`) — 21

| Clé | Libellé |
|---|---|
| `dashboard.dashboard.read` | Consulter — Tableau de bord |
| `settings.company.read` | Consulter — Paramètres de l'entreprise |
| `settings.company.update` | Modifier — Paramètres de l'entreprise |
| `settings.billing.read` | Consulter — Abonnement et utilisation |
| `settings.tax.manage` | Gérer — Taxes |
| `settings.numbering.manage` | Gérer — Numérotation des documents |
| `users.member.read` | Consulter — Membres |
| `users.member.invite` | Inviter — Membres |
| `users.member.update` | Modifier — Membres |
| `users.member.remove` | Retirer — Membres |
| `roles.role.read` | Consulter — Rôles et permissions |
| `roles.role.manage` | Gérer — Rôles et permissions |
| `org.structure.read` | Consulter — Agences, sites, départements, centres de coûts |
| `org.structure.manage` | Gérer — Agences, sites, départements, centres de coûts |
| `audit.log.read` | Consulter — Journal d'audit |
| `workflow.request.read` | Consulter — Demandes d'approbation |
| `workflow.request.create` | Créer — Demandes d'approbation |
| `workflow.request.approve` | Approuver — Demandes d'approbation |
| `workflow.policy.manage` | Gérer — Règles d'approbation |
| `data.import.manage` | Gérer — Imports de données |
| `data.export.run` | Exécuter — Exports de données |

### Finance (`finance`) — 11

| Clé | Libellé |
|---|---|
| `finance.category.manage` | Gérer — Catégories financières |
| `finance.expense.read` | Consulter — Dépenses |
| `finance.expense.create` | Créer — Dépenses |
| `finance.expense.update` | Modifier — Dépenses |
| `finance.expense.delete` | Supprimer — Dépenses |
| `finance.expense.approve` | Approuver — Dépenses |
| `finance.account.read` | Consulter — Comptes bancaires et caisses |
| `finance.account.manage` | Gérer — Comptes bancaires et caisses |
| `finance.transfer.create` | Créer — Transferts |
| `finance.budget.read` | Consulter — Budgets et prévisions |
| `finance.budget.manage` | Gérer — Budgets et prévisions |

### Comptabilité (`accounting`) — 7

| Clé | Libellé |
|---|---|
| `accounting.ledger.read` | Consulter — Grand livre et balance |
| `accounting.entry.read` | Consulter — Écritures comptables |
| `accounting.entry.create` | Créer — Écritures comptables |
| `accounting.entry.validate` | Valider — Écritures comptables |
| `accounting.period.manage` | Gérer — Exercices et périodes |
| `accounting.chart.read` | Consulter — Plan comptable |
| `accounting.chart.manage` | Gérer — Plan comptable |

### Ventes & Facturation (`sales`) — 23

| Clé | Libellé |
|---|---|
| `finance.invoice.read` | Consulter — Factures |
| `finance.invoice.create` | Créer — Factures |
| `finance.invoice.update` | Modifier — Factures |
| `finance.invoice.delete` | Supprimer — Factures |
| `finance.invoice.send` | Envoyer — Factures |
| `finance.credit_note.read` | Consulter — Avoirs |
| `finance.credit_note.create` | Créer — Avoirs |
| `finance.credit_note.update` | Modifier — Avoirs |
| `finance.payment.read` | Consulter — Encaissements |
| `finance.payment.create` | Créer — Encaissements |
| `finance.payment.validate` | Valider — Encaissements |
| `sales.quote.read` | Consulter — Devis |
| `sales.quote.create` | Créer — Devis |
| `sales.quote.update` | Modifier — Devis |
| `sales.quote.delete` | Supprimer — Devis |
| `sales.order.read` | Consulter — Commandes clients |
| `sales.order.create` | Créer — Commandes clients |
| `sales.order.update` | Modifier — Commandes clients |
| `sales.order.delete` | Supprimer — Commandes clients |
| `sales.delivery.read` | Consulter — Bons de livraison |
| `sales.delivery.create` | Créer — Bons de livraison |
| `sales.delivery.update` | Modifier — Bons de livraison |
| `sales.discount.approve` | Approuver — Remises |

### CRM & Clients (`crm`) — 16

| Clé | Libellé |
|---|---|
| `crm.customer.read` | Consulter — Clients |
| `crm.customer.create` | Créer — Clients |
| `crm.customer.update` | Modifier — Clients |
| `crm.customer.delete` | Supprimer — Clients |
| `crm.lead.read` | Consulter — Prospects |
| `crm.lead.create` | Créer — Prospects |
| `crm.lead.update` | Modifier — Prospects |
| `crm.lead.delete` | Supprimer — Prospects |
| `crm.opportunity.read` | Consulter — Opportunités |
| `crm.opportunity.create` | Créer — Opportunités |
| `crm.opportunity.update` | Modifier — Opportunités |
| `crm.opportunity.delete` | Supprimer — Opportunités |
| `crm.activity.read` | Consulter — Activités commerciales |
| `crm.activity.create` | Créer — Activités commerciales |
| `crm.activity.update` | Modifier — Activités commerciales |
| `crm.pipeline.manage` | Gérer — Pipeline commercial |

### Achats & Fournisseurs (`purchases`) — 22

| Clé | Libellé |
|---|---|
| `purchases.supplier.read` | Consulter — Fournisseurs |
| `purchases.supplier.create` | Créer — Fournisseurs |
| `purchases.supplier.update` | Modifier — Fournisseurs |
| `purchases.supplier.delete` | Supprimer — Fournisseurs |
| `purchases.request.read` | Consulter — Demandes d'achat |
| `purchases.request.create` | Créer — Demandes d'achat |
| `purchases.request.approve` | Approuver — Demandes d'achat |
| `purchases.order.read` | Consulter — Commandes fournisseur |
| `purchases.order.create` | Créer — Commandes fournisseur |
| `purchases.order.update` | Modifier — Commandes fournisseur |
| `purchases.order.delete` | Supprimer — Commandes fournisseur |
| `purchases.order.approve` | Approuver — Commandes fournisseur |
| `purchases.receipt.read` | Consulter — Réceptions |
| `purchases.receipt.create` | Créer — Réceptions |
| `purchases.bill.read` | Consulter — Factures fournisseur |
| `purchases.bill.create` | Créer — Factures fournisseur |
| `purchases.bill.update` | Modifier — Factures fournisseur |
| `purchases.bill.approve` | Approuver — Factures fournisseur |
| `purchases.payment.read` | Consulter — Paiements fournisseurs |
| `purchases.payment.create` | Créer — Paiements fournisseurs |
| `purchases.return.read` | Consulter — Retours fournisseur |
| `purchases.return.create` | Créer — Retours fournisseur |

### Stock & Inventaire (`inventory`) — 10

| Clé | Libellé |
|---|---|
| `inventory.product.read` | Consulter — Produits et services |
| `inventory.product.create` | Créer — Produits et services |
| `inventory.product.update` | Modifier — Produits et services |
| `inventory.product.delete` | Supprimer — Produits et services |
| `inventory.stock.read` | Consulter — Stocks |
| `inventory.stock.adjust` | Ajuster — Stocks |
| `inventory.movement.read` | Consulter — Mouvements de stock |
| `inventory.movement.create` | Créer — Mouvements de stock |
| `inventory.warehouse.manage` | Gérer — Entrepôts |
| `inventory.count.manage` | Gérer — Inventaires |

### Ressources humaines (`hr`) — 11

| Clé | Libellé |
|---|---|
| `hr.employee.read` | Consulter — Employés |
| `hr.employee.create` | Créer — Employés |
| `hr.employee.update` | Modifier — Employés |
| `hr.employee.delete` | Supprimer — Employés |
| `hr.contract.manage` | Gérer — Contrats |
| `hr.attendance.read` | Consulter — Présences |
| `hr.attendance.manage` | Gérer — Présences |
| `hr.leave.read` | Consulter — Congés |
| `hr.leave.request` | Demander — Congés |
| `hr.leave.approve` | Approuver — Congés |
| `hr.evaluation.manage` | Gérer — Évaluations et formations |

### Paie (`payroll`) — 2

| Clé | Libellé |
|---|---|
| `hr.payroll.manage` | Gérer — Paie |
| `hr.payslip.read` | Consulter — Bulletins |

### Projets & Tâches (`projects`) — 6

| Clé | Libellé |
|---|---|
| `project.project.read` | Consulter — Projets |
| `project.project.create` | Créer — Projets |
| `project.project.update` | Modifier — Projets |
| `project.project.delete` | Supprimer — Projets |
| `project.task.manage` | Gérer — Tâches |
| `project.time.manage` | Gérer — Temps passé |

### Documents (GED) (`documents`) — 5

| Clé | Libellé |
|---|---|
| `documents.document.read` | Consulter — Documents |
| `documents.document.create` | Créer — Documents |
| `documents.document.update` | Modifier — Documents |
| `documents.document.delete` | Supprimer — Documents |
| `documents.document.share` | Partager — Documents |

### Rapports & Analytics (`reports`) — 2

| Clé | Libellé |
|---|---|
| `reports.report.read` | Consulter — Rapports |
| `reports.export.run` | Exécuter — Exports de rapports |

### Transport & Flotte (`fleet`) — 8

| Clé | Libellé |
|---|---|
| `fleet.vehicle.read` | Consulter — Véhicules |
| `fleet.vehicle.manage` | Gérer — Véhicules |
| `fleet.driver.manage` | Gérer — Chauffeurs |
| `fleet.trip.manage` | Gérer — Missions et trajets |
| `fleet.fuel.manage` | Gérer — Carburant |
| `fleet.maintenance.manage` | Gérer — Entretiens |
| `fleet.fine.read` | Consulter — Contraventions |
| `fleet.fine.manage` | Gérer — Contraventions |

### Gestion de chantiers (`construction`) — 3

| Clé | Libellé |
|---|---|
| `construction.site.read` | Consulter — Chantiers |
| `construction.site.manage` | Gérer — Chantiers |
| `construction.report.manage` | Gérer — Rapports terrain |

### AfriGest Intelligence (`intelligence`) — 1

| Clé | Libellé |
|---|---|
| `intelligence.assistant.use` | Utiliser — Assistant AfriGest Intelligence |

## Rôles modèles

Copiés dans chaque nouvelle entreprise, puis **librement modifiables** (les rôles sont propres à chaque entreprise). Motifs : `a.b.c` exact, `a.*` préfixe, `*.read` suffixe.

| Rôle | Description | Permissions | Motifs |
|---|---|---|---|
| Administrateur (administrateur) | Accès complet à l'entreprise. | 148 / 148 | `*` |
| Directeur Général | Vision globale et validations. | 49 / 148 | `*.read`, `workflow.request.*`, `reports.*`, `data.export.run`, `intelligence.*` |
| Directeur Financier | Finance, comptabilité, budgets, approbations. | 43 / 148 | `dashboard.dashboard.read`, `workflow.request.read`, `workflow.request.create`, `finance.*`, `accounting.*`, `reports.*`, `workflow.request.approve`, `sales.discount.approve`, … |
| Comptable | Saisie et suivi comptable. | 23 / 148 | `dashboard.dashboard.read`, `workflow.request.read`, `workflow.request.create`, `finance.invoice.read`, `finance.payment.*`, `finance.expense.*`, `finance.category.manage`, `finance.account.read`, … |
| RH | Employés, présences, congés, paie. | 24 / 148 | `dashboard.dashboard.read`, `workflow.request.read`, `workflow.request.create`, `hr.*`, `workflow.request.approve`, `reports.report.read`, `documents.document.*`, `org.structure.read` |
| Responsable Commercial | Pilotage des ventes et du CRM. | 43 / 148 | `dashboard.dashboard.read`, `workflow.request.read`, `workflow.request.create`, `crm.*`, `sales.*`, `finance.invoice.*`, `finance.credit_note.*`, `inventory.product.read`, … |
| Commercial | Prospection et devis. | 24 / 148 | `dashboard.dashboard.read`, `workflow.request.read`, `workflow.request.create`, `crm.customer.read`, `crm.customer.create`, `crm.customer.update`, `crm.lead.*`, `crm.opportunity.*`, … |
| Responsable Stock | Produits, entrepôts, mouvements. | 20 / 148 | `dashboard.dashboard.read`, `workflow.request.read`, `workflow.request.create`, `inventory.*`, `purchases.supplier.read`, `purchases.receipt.*`, `sales.delivery.*`, `reports.report.read` |
| Chef de Projet | Projets, tâches, temps et budgets. | 19 / 148 | `dashboard.dashboard.read`, `workflow.request.read`, `workflow.request.create`, `project.*`, `documents.document.*`, `construction.*`, `reports.report.read`, `hr.employee.read` |
| Responsable Flotte | Véhicules, chauffeurs, entretiens, contraventions. | 18 / 148 | `dashboard.dashboard.read`, `workflow.request.read`, `workflow.request.create`, `fleet.*`, `documents.document.*`, `finance.expense.read`, `reports.report.read` |
| Employé | Accès de base : congés et tâches. | 7 / 148 | `dashboard.dashboard.read`, `workflow.request.read`, `workflow.request.create`, `hr.leave.request`, `hr.leave.read`, `project.task.manage`, `hr.payslip.read` |
| Consultation uniquement | Lecture seule. | 44 / 148 | `*.read` |
