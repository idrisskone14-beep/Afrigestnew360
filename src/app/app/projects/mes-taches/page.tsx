import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/app/page-header";
import { Status } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { requireModulePage } from "@/core/tenant/guards";
import { forbidden } from "next/navigation";
import { fmtDate } from "@/lib/format";
import { myTasks } from "@/modules/projects/service";
import { PRIORITIES } from "@/modules/projects/schemas";
import { MyTaskStatus } from "@/modules/projects/ui/my-task-status";

export const metadata: Metadata = { title: "Mes tâches" };

export default async function MyTasksPage() {
  const ctx = await requireModulePage("projects");
  if (!ctx.can("project.task.manage")) forbidden();
  const tasks = await myTasks(ctx);
  const today = new Date();
  return tasks.length === 0 ? <EmptyState icon={<ListChecks className="size-8" />} title="Aucune tâche en cours" description="Les tâches qui vous sont confiées apparaissent ici. Si vous n'en voyez pas, votre compte n'est peut-être pas lié à une fiche salarié." /> : (
    <Card className="divide-y p-0">
      {tasks.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t.title}</p>
            <p className="text-xs text-muted-foreground">{ctx.can("project.project.read") ? <Link href={`/app/projects/projets/${t.project.id}?onglet=taches`} className="hover:text-foreground">{t.project.code} — {t.project.name}</Link> : `${t.project.code} — ${t.project.name}`} · {PRIORITIES.find((p) => p.value === t.priority)?.label}{t.dueDate ? ` · échéance ${fmtDate(t.dueDate)}` : ""}</p>
          </div>
          {t.dueDate && t.dueDate < today && <span className="text-xs font-medium text-destructive">En retard</span>}
          <Status value={t.status} />
          <MyTaskStatus id={t.id} status={t.status} />
        </div>
      ))}
    </Card>
  );
}
