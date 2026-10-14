import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/core/tenant/guards";
import { enumParam, type SearchParams } from "@/lib/list-params";
import { listHolidays, loadWorkDays } from "@/modules/hr/calendar";
import { HOLIDAY_RULES } from "@/modules/hr/leave-calc";
import { HolidaysPanel } from "@/modules/hr/ui/holidays-panel";

export const metadata: Metadata = { title: "Jours fériés" };

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("hr.employee.read");
  const now = new Date().getUTCFullYear();
  const sp = await searchParams;
  const years = [now - 1, now, now + 1];
  const year = years.find((y) => String(y) === enumParam(sp, "annee", years.map(String) as readonly string[])) ?? now;
  const [rows, workDays] = await Promise.all([listHolidays(ctx, year), loadWorkDays(ctx.db)]);
  const country = ctx.company.country in HOLIDAY_RULES ? ctx.company.country : "COMMON";
  const fmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <div className="space-y-4">
      <nav aria-label="Année" className="flex gap-2">
        {years.map((y) => <Link key={y} href={`/app/hr/feries?annee=${y}`} aria-current={y === year ? "page" : undefined} className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${y === year ? "border-brand bg-accent" : "bg-card text-muted-foreground hover:text-foreground"}`}>{y}</Link>)}
      </nav>
      <HolidaysPanel
        year={year} workDays={workDays} canManage={ctx.can("hr.holiday.manage")} defaultCountry={country}
        countries={Object.entries(HOLIDAY_RULES).map(([code, d]) => ({ code, label: d.label }))}
        rows={rows.map((h) => ({ id: h.id, date: h.date.toISOString().slice(0, 10), label: fmt.format(h.date), name: h.name }))}
      />
    </div>
  );
}
