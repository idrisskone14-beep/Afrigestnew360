import type { Metadata } from "next";
import { LegalPage, Val } from "@/components/marketing/legal-page";
import { legalInfo } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Comment KAKO Gestion traite les données personnelles et utilise les cookies.",
  alternates: { canonical: "/confidentialite" },
};
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const L = legalInfo();
  return (
    <LegalPage title="Politique de confidentialité" intro="Elle explique quelles données personnelles KAKO Gestion traite, pourquoi, pendant combien de temps, et quels sont vos droits.">
      <section>
        <h2>1. Qui est responsable ?</h2>
        <p>Deux situations coexistent :</p>
        <ul>
          <li><strong>Données de votre compte et de votre relation avec nous</strong> (identité, e-mail, connexion, demandes de démonstration ou de contact) : <Val>{L.company}</Val> est responsable de traitement.</li>
          <li><strong>Données que votre entreprise saisit dans le Service</strong> (salariés, clients, fournisseurs, factures…) : votre entreprise est responsable de traitement ; <Val>{L.company}</Val> agit en sous-traitant et ne les traite que pour fournir le Service et sur ses instructions.</li>
        </ul>
        <p>Pour toute question sur vos données : <Val>{L.email}</Val> (adresse : <Val>{L.address}</Val>).</p>
      </section>
      <section>
        <h2>2. Données traitées et finalités</h2>
        <ul>
          <li><strong>Compte et accès</strong> : nom, e-mail, téléphone (facultatif), mot de passe (stocké sous forme chiffrée irréversible), secret de double authentification (chiffré), appartenance aux entreprises et rôles. Finalité : créer et sécuriser l&apos;accès, fournir le Service.</li>
          <li><strong>Sécurité et traçabilité</strong> : adresse IP, appareil et dates de connexion, journal des actions effectuées (qui a fait quoi, quand). Finalité : sécurité, détection des abus, preuve en cas de litige.</li>
          <li><strong>Demandes de démonstration et de contact</strong> : identité, entreprise, coordonnées, message. Finalité : vous répondre.</li>
          <li><strong>Notifications</strong> : préférences, adresse e-mail et, si vous les activez, l&apos;inscription technique de votre appareil aux notifications. Finalité : vous alerter sur les événements de votre activité.</li>
          <li><strong>Données de votre entreprise</strong> : celles que vous saisissez ou importez. Finalité : fournir les fonctions du Service.</li>
        </ul>
        <p>Nous ne vendons pas vos données et ne les utilisons pas à des fins publicitaires.</p>
      </section>
      <section>
        <h2>3. Bases légales</h2>
        <p>L&apos;exécution du contrat ou des mesures précontractuelles (compte, Service, réponse à vos demandes), notre intérêt légitime à sécuriser le Service, le respect de nos obligations légales, et votre consentement lorsqu&apos;il est requis (par exemple les notifications sur votre appareil).</p>
      </section>
      <section>
        <h2>4. Destinataires et sous-traitants</h2>
        <p>Vos données sont accessibles à l&apos;Éditeur pour l&apos;exploitation du Service et aux prestataires techniques strictement nécessaires : hébergement de l&apos;application et de la base de données, stockage des fichiers et envoi des e-mails. Hébergeur : <Val>{L.host}</Val>. Ces prestataires n&apos;ont pas le droit d&apos;utiliser les données pour leur propre compte. Les données d&apos;une entreprise ne sont jamais visibles d&apos;une autre entreprise.</p>
      </section>
      <section>
        <h2>5. Transferts hors de votre pays</h2>
        <p>Les prestataires d&apos;hébergement peuvent être situés hors de <Val>{L.country}</Val> (notamment en Europe). Lorsque c&apos;est le cas, nous recourons à des prestataires qui offrent des garanties appropriées de protection des données.</p>
      </section>
      <section>
        <h2>6. Durées de conservation</h2>
        <ul>
          <li>Compte et données de l&apos;entreprise : pendant la durée de l&apos;abonnement, puis suppression ou anonymisation dans un délai de 90 jours après la fin du contrat (hors obligations légales de conservation).</li>
          <li>Journal de sécurité et d&apos;audit : conservé tant que le compte est actif, puis selon les obligations légales.</li>
          <li>Demandes de démonstration et de contact : 3 ans maximum après le dernier échange.</li>
          <li>Les documents comptables que votre entreprise doit conserver relèvent de ses propres obligations : exportez-les avant la fin du contrat.</li>
        </ul>
      </section>
      <section>
        <h2>7. Sécurité</h2>
        <p>Isolation des données de chaque entreprise au niveau de la base de données, contrôle des droits par rôle, mots de passe chiffrés, double authentification disponible, sessions révocables, connexions chiffrées, limitation des tentatives de connexion et journal d&apos;audit non modifiable. En cas de violation de données susceptible de vous porter préjudice, nous vous en informons ainsi que, le cas échéant, l&apos;autorité compétente.</p>
      </section>
      <section>
        <h2>8. Vos droits</h2>
        <p>Vous pouvez demander l&apos;accès à vos données, leur rectification, leur effacement, la limitation ou l&apos;opposition à leur traitement, ainsi que leur portabilité, et retirer votre consentement à tout moment. Écrivez à <Val>{L.email}</Val> ; une pièce justificative d&apos;identité peut être demandée. Si vous êtes salarié ou client d&apos;une entreprise utilisatrice, adressez-vous d&apos;abord à elle : elle est responsable de vos données. Vous pouvez aussi saisir <Val>{L.authority}</Val>.</p>
      </section>
      <section>
        <h2>9. Cookies et traceurs</h2>
        <p>Le Service n&apos;utilise <strong>aucun cookie publicitaire ni outil de mesure d&apos;audience</strong>. Seuls des traceurs strictement nécessaires au fonctionnement sont déposés, sans consentement requis :</p>
        <ul>
          <li><code>authjs.session-token</code> : session de connexion ;</li>
          <li><code>afg_company</code> : entreprise active (si vous en gérez plusieurs) ;</li>
          <li><code>afg_year</code> : année affichée ;</li>
          <li>préférence de thème clair/sombre, conservée dans votre navigateur.</li>
        </ul>
      </section>
      <section>
        <h2>10. Modifications</h2>
        <p>Cette politique peut évoluer ; la date de dernière mise à jour figure en haut de la page. Les changements importants vous sont signalés.</p>
      </section>
    </LegalPage>
  );
}
