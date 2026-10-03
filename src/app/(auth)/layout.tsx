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
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#0a1236] via-[#18268a] to-[#5b3df5] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
        <div className="pointer-events-none absolute -right-32 -top-32 size-[30rem] animate-float rounded-full bg-brand/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-[28rem] animate-float rounded-full bg-brand-green/30 blur-3xl [animation-delay:-3.5s]" aria-hidden />
        <div className="pointer-events-none absolute right-1/4 top-1/2 size-48 animate-float rounded-full bg-fuchsia-500/25 blur-3xl [animation-delay:-5s]" aria-hidden />
        <Link href="/" className="relative z-10 animate-fade-in text-white">
          <Logo />
        </Link>
        <div className="relative z-10 max-w-md space-y-8">
          <h2 className="animate-fade-up text-4xl font-bold leading-tight tracking-tight">
            Toute votre entreprise. <span className="bg-gradient-to-r from-white via-indigo-200 to-brand-green bg-clip-text text-transparent">Une seule plateforme.</span>
          </h2>
          <ul className="stagger space-y-3 text-sm text-indigo-100/90">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur-sm transition-all duration-300 hover:translate-x-1 hover:bg-white/[0.12]">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-green to-teal-600 shadow-lg shadow-teal-500/30"><Icon className="size-4 text-white" /></span>
                <span className="pt-1">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-xs text-indigo-200/60">© {new Date().getFullYear()} AfriGest 360</p>
      </aside>
      <main className="flex min-h-dvh flex-col justify-center px-5 py-10 sm:px-10">
        <Link href="/" className="mb-8 lg:hidden"><Logo /></Link>
        <div className="mx-auto w-full max-w-[26rem] animate-fade-up rounded-3xl border border-border/60 bg-card/80 p-6 shadow-soft backdrop-blur sm:p-8">{children}</div>
      </main>
    </div>
  );
}
