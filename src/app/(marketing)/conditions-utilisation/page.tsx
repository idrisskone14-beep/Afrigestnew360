import type { Metadata } from "next";
import { LegalPage, Val } from "@/components/marketing/legal-page";
import { legalInfo } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Conditions d'utilisation",
  description: "Conditions générales d'utilisation du service KAKO Gestion.",
  alternates: { canonical: "/conditions-utilisation" },
};
export const dynamic = "force-dynamic";

export default function TermsPage() {
  const L = legalInfo();
  return (
    <LegalPage title="Conditions d'utilisation" intro="Elles encadrent l'accès et l'utilisation du service KAKO Gestion. En créant un compte, vous les acceptez.">
      <section>
        <h2>1. Objet et définitions</h2>
        <p>Le service KAKO Gestion (« le Service ») est un logiciel de gestion d&apos;entreprise accessible en ligne : ventes, achats, stocks, finance, comptabilité, ressources humaines, projets, documents et extensions. Il est édité par <Val>{L.company}</Val> (« l&apos;Éditeur »). Le « Client » est l&apos;entreprise qui utilise le Service ; l&apos;« Utilisateur » est toute personne qu&apos;elle autorise à y accéder.</p>
      </section>
      <section>
        <h2>2. Compte et accès</h2>
        <ul>
          <li>La création d&apos;un compte suppose des informations exactes et à jour. Selon la configuration, l&apos;inscription est confirmée par e-mail ou validée par l&apos;Éditeur, qui peut la refuser.</li>
          <li>Chaque Utilisateur protège ses identifiants (mot de passe, double authentification) et ne les partage pas. Toute action réalisée avec ses identifiants lui est imputée.</li>
          <li>Le Client administre les accès de ses Utilisateurs et leurs droits (rôles et permissions) et en répond.</li>
        </ul>
      </section>
      <section>
        <h2>3. Description du Service et disponibilité</h2>
        <p>L&apos;Éditeur met en œuvre les moyens raisonnables pour assurer l&apos;accès continu au Service, sans garantie d&apos;absence d&apos;interruption (maintenance, incident, force majeure, défaillance d&apos;un prestataire). Les fonctions disponibles dépendent de l&apos;offre souscrite. Le Service évolue : l&apos;Éditeur peut ajouter, modifier ou retirer des fonctions en préservant l&apos;essentiel de celles de l&apos;offre souscrite.</p>
      </section>
      <section>
        <h2>4. Outil d&apos;aide à la gestion : responsabilité du Client</h2>
        <p>Le Service est un outil d&apos;aide. Il ne remplace ni un expert-comptable, ni un conseil juridique, fiscal ou social. En particulier :</p>
        <ul>
          <li>le plan comptable fourni est simplifié et les états financiers ne constituent pas la liasse officielle : le Client les fait valider par un professionnel ;</li>
          <li>aucun taux, plafond ou barème légal de paie n&apos;est garanti : le Client paramètre la paie selon sa législation et la fait valider avant toute utilisation ;</li>
          <li>le Client reste seul responsable de l&apos;exactitude des données qu&apos;il saisit ou importe, de ses déclarations et de ses obligations légales.</li>
        </ul>
      </section>
      <section>
        <h2>5. Données du Client</h2>
        <ul>
          <li>Le Client reste propriétaire de ses données. Il concède à l&apos;Éditeur le droit de les héberger et de les traiter pour fournir le Service.</li>
          <li>Le Client garantit avoir le droit de traiter les données personnelles de ses salariés, clients et fournisseurs saisies dans le Service. Il en est responsable de traitement ; l&apos;Éditeur agit en sous-traitant (voir la <a href="/confidentialite">politique de confidentialité</a>).</li>
          <li>Le Client peut exporter ses données (Excel, CSV, PDF) à tout moment depuis Paramètres → Import / export.</li>
        </ul>
      </section>
      <section>
        <h2>6. Utilisation acceptable</h2>
        <p>Il est interdit de : tenter d&apos;accéder aux données d&apos;un autre Client, contourner les mesures de sécurité ou les limites de l&apos;offre, perturber le Service, y déposer des contenus illicites ou des logiciels malveillants, ou le revendre sans accord écrit. L&apos;Éditeur peut suspendre un compte en cas de manquement grave ou de risque pour la sécurité, en prévenant le Client dès que possible.</p>
      </section>
      <section>
        <h2>7. Offres, prix et paiement</h2>
        <p>Les offres, leurs limites (utilisateurs, modules) et leurs prix sont ceux affichés sur la page <a href="/tarifs">Tarifs</a> ou convenus par écrit. Sauf mention contraire, l&apos;abonnement est facturé d&apos;avance, par période, et se renouvelle tacitement. Le défaut de paiement peut entraîner la suspension de l&apos;accès après relance. Les modalités précises (moyens de paiement, taxes, délais) sont précisées dans l&apos;offre ou le devis accepté.</p>
      </section>
      <section>
        <h2>8. Durée et résiliation</h2>
        <p>Le Client peut résilier à tout moment pour la fin de la période en cours. L&apos;Éditeur peut résilier en cas de manquement non corrigé après mise en demeure. À la fin du contrat, le Client dispose d&apos;un délai pour exporter ses données ; passé ce délai, elles sont supprimées ou anonymisées, sous réserve des obligations légales de conservation.</p>
      </section>
      <section>
        <h2>9. Sécurité</h2>
        <p>L&apos;Éditeur met en œuvre des mesures de sécurité adaptées : isolation des données de chaque entreprise, contrôle des droits, journal d&apos;audit, chiffrement des secrets de double authentification, connexions chiffrées. Aucune mesure ne garantit une sécurité absolue ; chaque partie signale sans délai tout incident dont elle a connaissance.</p>
      </section>
      <section>
        <h2>10. Responsabilité</h2>
        <p>Dans la limite permise par la loi, la responsabilité de l&apos;Éditeur est limitée aux dommages directs et prévisibles, et plafonnée au montant payé par le Client pour le Service sur les douze mois précédant le fait générateur. L&apos;Éditeur n&apos;est pas responsable des dommages indirects (perte d&apos;exploitation, de clientèle ou de profit), ni des conséquences d&apos;une utilisation non conforme, d&apos;une saisie erronée ou d&apos;un paramétrage inadapté à la législation du Client.</p>
      </section>
      <section>
        <h2>11. Modification des conditions</h2>
        <p>L&apos;Éditeur peut modifier ces conditions ; les Utilisateurs en sont informés par le Service ou par e-mail avant l&apos;entrée en vigueur des changements significatifs. La poursuite de l&apos;usage vaut acceptation.</p>
      </section>
      <section>
        <h2>12. Droit applicable et litiges</h2>
        <p>Les présentes conditions sont régies par le droit de <Val>{L.country}</Val>. Les parties recherchent d&apos;abord une solution amiable ; à défaut, les tribunaux compétents de ce pays sont seuls compétents, sauf règle impérative contraire.</p>
      </section>
      <section>
        <h2>13. Contact</h2>
        <p>Pour toute question : <Val>{L.email}</Val>.</p>
      </section>
    </LegalPage>
  );
}
