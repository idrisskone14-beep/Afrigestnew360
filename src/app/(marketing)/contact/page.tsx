import type { Metadata } from "next";
import { Clock, Mail, MessageSquare } from "lucide-react";
import { DemoForm } from "@/components/marketing/demo-form";
import { Section } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contactez l'équipe AfriGest 360 : question commerciale, devis sur mesure ou support.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <Section className="py-12 sm:py-16">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand">Contact</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Parlons de votre entreprise</h1>
          <p className="mt-4 text-lg text-muted-foreground">Question, devis sur mesure, partenariat : écrivez-nous, nous répondons rapidement.</p>
          <ul className="mt-8 space-y-5 text-sm">
            <li className="flex gap-3"><Mail className="mt-0.5 size-5 text-brand" /><span><span className="block font-medium">Réponse par e-mail</span><span className="text-muted-foreground">Vous recevez une confirmation immédiate de votre demande.</span></span></li>
            <li className="flex gap-3"><Clock className="mt-0.5 size-5 text-brand" /><span><span className="block font-medium">Sous 24 h ouvrées</span><span className="text-muted-foreground">Du lundi au vendredi.</span></span></li>
            <li className="flex gap-3"><MessageSquare className="mt-0.5 size-5 text-brand" /><span><span className="block font-medium">Déjà client ?</span><span className="text-muted-foreground">Indiquez le nom de votre entreprise AfriGest 360 pour un traitement prioritaire.</span></span></li>
          </ul>
        </div>
        <DemoForm source="contact" submitLabel="Envoyer le message" messageLabel="Votre message *" />
      </div>
    </Section>
  );
}
