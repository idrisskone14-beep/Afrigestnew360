import type { Metadata } from "next";
import { LegalPage, Val } from "@/components/marketing/legal-page";
import { TO_COMPLETE, legalInfo } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Mentions légales",
  description: "Éditeur, hébergeur et contact du service KAKO Gestion.",
  alternates: { canonical: "/mentions-legales" },
};
export const dynamic = "force-dynamic";

export default function LegalNoticePage() {
  const L = legalInfo();
  return (
    <LegalPage title="Mentions légales" intro="Informations sur l'éditeur et l'hébergeur du service KAKO Gestion.">
      <section>
        <h2>Éditeur du service</h2>
        <ul>
          <li>Dénomination : <Val>{L.company}</Val></li>
          <li>Forme juridique et capital : <Val>{L.form}</Val></li>
          <li>Siège social : <Val>{L.address}</Val></li>
          <li>Immatriculation : <Val>{L.registration}</Val></li>
          <li>Directeur de la publication : <Val>{L.publisher}</Val></li>
          <li>Contact : <Val>{L.email}</Val>{L.phone !== TO_COMPLETE ? ` · ${L.phone}` : ""}</li>
        </ul>
      </section>
      <section>
        <h2>Hébergement</h2>
        <p>Le service, ses données et les fichiers téléversés sont hébergés par : <Val>{L.host}</Val>.</p>
      </section>
      <section>
        <h2>Propriété intellectuelle</h2>
        <p>Le logiciel KAKO Gestion, son interface, sa marque, son logo et ses contenus sont protégés par le droit de la propriété intellectuelle. Toute reproduction ou représentation, totale ou partielle, sans autorisation écrite de l&apos;éditeur est interdite. Les données saisies par les clients dans leur espace leur appartiennent (voir les <a href="/conditions-utilisation">conditions d&apos;utilisation</a>).</p>
      </section>
      <section>
        <h2>Données personnelles et cookies</h2>
        <p>Le traitement des données personnelles et l&apos;usage des cookies sont décrits dans la <a href="/confidentialite">politique de confidentialité</a>.</p>
      </section>
      <section>
        <h2>Droit applicable</h2>
        <p>Les présentes mentions sont soumises au droit de <Val>{L.country}</Val>.</p>
      </section>
    </LegalPage>
  );
}
