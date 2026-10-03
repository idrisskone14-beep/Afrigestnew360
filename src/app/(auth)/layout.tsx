import Link from "next/link";
import { BarChart3, ShieldCheck, Users } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-brand/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-brand-green/20 blur-3xl" />
        <Link href="/" className="relative z-10 text-white">
          <Logo />
        </Link>
        <div className="relative z-10 max-w-md space-y-8">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Toute votre entreprise. Une seule plateforme.</h2>
          <ul className="space-y-4 text-sm text-slate-300">
            <li className="flex gap-3"><BarChart3 className="mt-0.5 size-4 shrink-0 text-brand-green" />Finances, ventes, stocks, RH et projets réunis dans un même outil.</li>
            <li className="flex gap-3"><Users className="mt-0.5 size-4 shrink-0 text-brand-green" />Un seul compte pour plusieurs entreprises, avec des droits distincts pour chacune.</li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-green" />Données isolées par entreprise, accès contrôlés, journal d'audit complet.</li>
          </ul>
        </div>
        <p className="relative z-10 text-xs text-slate-400">© {new Date().getFullYear()} AfriGest 360</p>
      </aside>
      <main className="flex min-h-dvh flex-col justify-center px-5 py-10 sm:px-10">
        <Link href="/" className="mb-8 lg:hidden"><Logo /></Link>
        <div className="mx-auto w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
  );
}
