import "server-only";

/**
 * Enregistrement des abonnés aux événements métier. Importé par les services émetteurs
 * (ventes, achats, finance) pour garantir que tous les modules actifs sont branchés.
 * Les phases suivantes y ajoutent finance/ et accounting/.
 */
import "./inventory/events";
import "./purchasing/events";
import "./finance/events";
import "./accounting/events";
import "./hr/events";
import "./projects/events";
import "./notifications/events";
