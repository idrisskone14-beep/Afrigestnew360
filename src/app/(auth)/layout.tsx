import Link from "next/link";
import { BarChart3, ShieldCheck, Users } from "lucide-react";
import { Logo } from "@/components/brand/logo";

const POINTS = [
  { icon: BarChart3, text: "Finances, ventes, stocks, RH et projets réunis dans un même outil." },
  { icon: Users, text: "Un seul compte pour plusieurs entreprises, avec des droits distincts pour chacune." },
  { icon: ShieldCheck, text: "Données isolées par entreprise, accès contrôlés, journal d'audit complet." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-forest text-[#f5eedf] lg:flex">
        <div className="motif-strip" aria-hidden />
        <div className="pattern-mudcloth pattern-drift pointer-events-none absolute inset-0 top-[10px]" aria-hidden />
        <div className="relative z-10 flex flex-1 flex-col justify-between p-12">
          <Link href="/" className="animate-fade-in text-[#f5eedf]"><Logo /></Link>
          <div className="max-w-md space-y-9">
            <h2 className="animate-fade-up font-display text-5xl font-semibold leading-[1.05] tracking-tight">
              Toute votre entreprise. <span className="italic text-brand-2">Une seule plateforme.</span>
            </h2>
            <ul className="stagger space-y-4 text-sm text-[#f5eedf]/85">
              {POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-4 border-t border-[#f5eedf]/20 pt-4">
                  <Icon className="mt-0.5 size-5 shrink-0 text-brand-2" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-[#f5eedf]/55">© {new Date().getFullYear()} AfriGest 360</p>
        </div>
      </aside>
      <main className="flex min-h-dvh flex-col justify-center px-5 py-10 sm:px-10">
        <Link href="/" className="mb-8 lg:hidden"><Logo /></Link>
        <div className="mx-auto w-full max-w-[26rem] animate-fade-up rounded-xl border border-foreground/20 bg-card p-6 shadow-offset sm:p-8">{children}</div>
      </main>
    </div>
  );
}
