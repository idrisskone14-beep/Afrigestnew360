import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate, todayInput } from "@/lib/format";
import { param, type SearchParams } from "@/lib/list-params";
import { attendanceBoard, attendanceMonth } from "@/modules/hr/people";
import { AttendanceBoard } from "@/modules/hr/ui/attendance-board";

export const metadata: Metadata = { title: "Présences" };
const DAY = 86_400_000;

export default async function AttendancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePagePermission("hr.attendance.read");
  const sp = await searchParams;
  const raw = param(sp, "date");
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayInput();
  const d = new Date(`${date}T00:00:00.000Z`);
  const [board, month] = await Promise.all([attendanceBoard(ctx, d), attendanceMonth(ctx, d.getUTCFullYear(), d.getUTCMonth() + 1)]);
  const prev = new Date(d.getTime() - DAY).toISOString().slice(0, 10);
  const next = new Date(d.getTime() + DAY).toISOString().slice(0, 10);
  const weekday = d.getUTCDay();
  const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild><Link href={`/app/hr/presences?date=${prev}`}>← Veille</Link></Button>
        <p className="text-sm font-medium">{fmtDate(d)}</p>
        <Button variant="outline" size="sm" asChild><Link href={`/app/hr/presences?date=${next}`}>Lendemain →</Link></Button>
        <Button variant="ghost" size="sm" asChild><Link href="/app/hr/presences">Aujourd'hui</Link></Button>
      </div>
      <AttendanceBoard key={date} date={date} canManage={ctx.can("hr.attendance.manage")} isWeekend={weekday === 0 || weekday === 6} isFuture={date > todayInput()}
        rows={board.map((r) => ({ employeeId: r.employeeId, number: r.number, name: r.name, jobTitle: r.jobTitle, status: r.status, checkIn: r.checkIn ?? "", checkOut: r.checkOut ?? "", onLeave: r.onLeave }))} />
      <section aria-label="Récapitulatif mensuel" className="space-y-2">
        <h3 className="text-base font-semibold">Récapitulatif de {MONTHS[d.getUTCMonth()]} {d.getUTCFullYear()}</h3>
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Salarié</TableHead><TableHead className="text-right">Présent</TableHead><TableHead className="text-right">Télétravail</TableHead><TableHead className="text-right">Retards</TableHead><TableHead className="text-right">Demi-journées</TableHead><TableHead className="text-right">Absences</TableHead></TableRow></TableHeader>
            <TableBody>
              {month.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Aucun salarié.</TableCell></TableRow>}
              {month.map((m) => (
                <TableRow key={m.employeeId}>
                  <TableCell className="text-sm font-medium">{m.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{m.number}</span></TableCell>
                  <TableCell className="text-right text-sm tabular">{m.present}</TableCell><TableCell className="text-right text-sm tabular">{m.remote}</TableCell><TableCell className="text-right text-sm tabular">{m.late}</TableCell><TableCell className="text-right text-sm tabular">{m.half}</TableCell>
                  <TableCell className={`text-right text-sm tabular ${m.absent ? "font-medium text-destructive" : ""}`}>{m.absent}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}
