"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Clock, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormAlert, runAction } from "@/components/app/form-kit";
import { todayInput } from "@/lib/format";
import { createProjectAction, createTaskAction, logTimeAction, setProjectStatusAction, updateProjectAction, updateTaskAction } from "../actions";
import { PRIORITIES, PROJECT_STATUSES, TASK_STATUSES } from "../schemas";

const errText = (e: { message: string; fieldErrors?: Record<string, string[]> }) => (e.fieldErrors ? Object.values(e.fieldErrors).flat()[0] ?? e.message : e.message);
const NONE = "__none";
type Opt = { id: string; name: string };

function Pick({ label, value, onChange, options, none = "— Aucun —" }: { label: string; value: string; onChange: (v: string) => void; options: Opt[]; none?: string }) {
  return (
    <Field label={label}>
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={NONE}>{none}</SelectItem>{options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
      </Select>
    </Field>
  );
}

export interface ProjectInit { id?: string; name: string; description: string; customerId: string; managerId: string; status: string; startDate: string; endDate: string; budget: number; billRate: number; branchId: string; costCenterId: string }
const BLANK: ProjectInit = { name: "", description: "", customerId: "", managerId: "", status: "PLANNED", startDate: "", endDate: "", budget: 0, billRate: 0, branchId: "", costCenterId: "" };

export function ProjectFormDialog({ project, customers, employees, branches, costCenters }: { project?: ProjectInit; customers: Opt[]; employees: Opt[]; branches: Opt[]; costCenters: Opt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = project ?? BLANK;
  const [f, setF] = useState(init);
  const set = <K extends keyof ProjectInit>(k: K, v: ProjectInit[K]) => setF((s) => ({ ...s, [k]: v }));
  const submit = () => start(async () => {
    setError(null);
    const payload = { ...f, status: f.status as "ACTIVE", budget: Number(f.budget || 0), billRate: Number(f.billRate || 0) };
    const res = project ? await updateProjectAction({ ...payload, id: project.id! }) : await createProjectAction(payload);
    if (!res.ok) return setError(errText(res.error));
    toast.success(project ? "Projet mis à jour" : "Projet créé");
    setOpen(false);
    if (!project && res.data) router.push(`/app/projects/projets/${(res.data as { id: string }).id}`); else router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild>{project ? <Button variant="outline"><Pencil className="size-4" /> Modifier</Button> : <Button><Plus className="size-4" /> Nouveau projet</Button>}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{project ? "Modifier le projet" : "Nouveau projet"}</DialogTitle><DialogDescription>Le code projet est attribué automatiquement.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Nom *" htmlFor="pj-name" className="sm:col-span-2"><Input id="pj-name" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Pick label="Client" value={f.customerId} onChange={(v) => set("customerId", v)} options={customers} none="— Projet interne —" />
          <Pick label="Chef de projet" value={f.managerId} onChange={(v) => set("managerId", v)} options={employees} />
          <Field label="Statut"><Select value={f.status} onValueChange={(v) => set("status", v)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PROJECT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></Field>
          <div />
          <Field label="Début" htmlFor="pj-start"><Input id="pj-start" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
          <Field label="Fin prévue" htmlFor="pj-end"><Input id="pj-end" type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
          <Field label="Budget de coûts" htmlFor="pj-budget" hint="Temps + dépenses + achats rattachés"><Input id="pj-budget" type="number" min={0} step="any" value={f.budget} onChange={(e) => set("budget", Number(e.target.value))} /></Field>
          <Field label="Taux horaire facturé" htmlFor="pj-rate" hint="Pour facturer le temps passé"><Input id="pj-rate" type="number" min={0} step="any" value={f.billRate} onChange={(e) => set("billRate", Number(e.target.value))} /></Field>
          {branches.length > 0 && <Pick label="Agence" value={f.branchId} onChange={(v) => set("branchId", v)} options={branches} />}
          {costCenters.length > 0 && <Pick label="Centre de coûts" value={f.costCenterId} onChange={(v) => set("costCenterId", v)} options={costCenters} />}
          <Field label="Description" htmlFor="pj-desc" className="sm:col-span-2"><Textarea id="pj-desc" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Button className="sm:col-span-2" disabled={pending || f.name.trim().length < 2} onClick={submit}>{project ? "Enregistrer" : "Créer le projet"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectStatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select value={status} disabled={pending} onValueChange={(v) => start(async () => { const r = await runAction(setProjectStatusAction({ id, status: v as "ACTIVE" }), { success: "Statut mis à jour" }); if (r.ok) router.refresh(); })}>
      <SelectTrigger className="w-40" aria-label="Statut du projet"><SelectValue /></SelectTrigger>
      <SelectContent>{PROJECT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export interface TaskInit { id?: string; projectId: string; title: string; description: string; status: string; priority: string; assigneeId: string; startDate: string; dueDate: string; estimateHours: number; dependsOnId: string }

export function TaskDialog({ task, projectId, employees, tasks, trigger }: { task?: TaskInit; projectId: string; employees: Opt[]; tasks: Opt[]; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init: TaskInit = task ?? { projectId, title: "", description: "", status: "TODO", priority: "MEDIUM", assigneeId: "", startDate: "", dueDate: "", estimateHours: 0, dependsOnId: "" };
  const [f, setF] = useState(init);
  const set = <K extends keyof TaskInit>(k: K, v: TaskInit[K]) => setF((s) => ({ ...s, [k]: v }));
  const submit = () => start(async () => {
    setError(null);
    const common = { title: f.title, description: f.description, status: f.status as "TODO", priority: f.priority as "MEDIUM", assigneeId: f.assigneeId, startDate: f.startDate, dueDate: f.dueDate, estimateHours: Number(f.estimateHours || 0), dependsOnId: f.dependsOnId };
    const res = task ? await updateTaskAction({ ...common, id: task.id! }) : await createTaskAction({ ...common, projectId });
    if (!res.ok) return setError(errText(res.error));
    toast.success(task ? "Tâche mise à jour" : "Tâche créée"); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm"><Plus className="size-4" /> Tâche</Button>}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{task ? "Modifier la tâche" : "Nouvelle tâche"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          <Field label="Titre *" htmlFor="tk-title" className="sm:col-span-2"><Input id="tk-title" value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Pick label="Responsable" value={f.assigneeId} onChange={(v) => set("assigneeId", v)} options={employees} none="— Non assignée —" />
          <Field label="Priorité"><Select value={f.priority} onValueChange={(v) => set("priority", v)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Statut"><Select value={f.status} onValueChange={(v) => set("status", v)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Estimation (heures)" htmlFor="tk-est"><Input id="tk-est" type="number" min={0} step="any" value={f.estimateHours} onChange={(e) => set("estimateHours", Number(e.target.value))} /></Field>
          <Field label="Début" htmlFor="tk-start"><Input id="tk-start" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
          <Field label="Échéance" htmlFor="tk-due"><Input id="tk-due" type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></Field>
          <Pick label="Commence après la tâche" value={f.dependsOnId} onChange={(v) => set("dependsOnId", v)} options={tasks.filter((t) => t.id !== task?.id)} none="— Aucune dépendance —" />
          <Field label="Description" htmlFor="tk-desc" className="sm:col-span-2"><Textarea id="tk-desc" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Button className="sm:col-span-2" disabled={pending || f.title.trim().length < 2} onClick={submit}>{task ? "Enregistrer" : "Créer la tâche"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TimeDialog({ projects, employees, tasks, defaultProjectId, defaultEmployeeId, fixedEmployee }: {
  projects: Opt[]; employees: Opt[]; tasks: (Opt & { projectId: string })[]; defaultProjectId?: string; defaultEmployeeId?: string; fixedEmployee?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const init = { projectId: defaultProjectId ?? projects[0]?.id ?? "", taskId: "", employeeId: defaultEmployeeId ?? employees[0]?.id ?? "", date: todayInput(), hours: "1", billable: true, description: "" };
  const [f, setF] = useState(init);
  const submit = () => start(async () => {
    setError(null);
    const res = await logTimeAction({ ...f, hours: Number(f.hours) });
    if (!res.ok) return setError(errText(res.error));
    toast.success("Temps enregistré"); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setF(init); } }}>
      <DialogTrigger asChild><Button><Clock className="size-4" /> Saisir du temps</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Saisir du temps</DialogTitle><DialogDescription>Le coût horaire est figé à la saisie ; le temps facturable pourra être facturé au client.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormAlert message={error} /></div>
          {!defaultProjectId && <Field label="Projet" className="sm:col-span-2"><Select value={f.projectId} onValueChange={(v) => setF({ ...f, projectId: v, taskId: "" })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></Field>}
          {!fixedEmployee && employees.length > 1 && <Field label="Salarié" className="sm:col-span-2"><Select value={f.employeeId} onValueChange={(v) => setF({ ...f, employeeId: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select></Field>}
          <Pick label="Tâche" value={f.taskId} onChange={(v) => setF({ ...f, taskId: v })} options={tasks.filter((t) => t.projectId === f.projectId)} none="— Sans tâche —" />
          <Field label="Date" htmlFor="tm-date"><Input id="tm-date" type="date" value={f.date} max={todayInput()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Durée (heures)" htmlFor="tm-hours"><Input id="tm-hours" type="number" min={0.25} max={24} step="0.25" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><Switch checked={f.billable} onCheckedChange={(v) => setF({ ...f, billable: v })} aria-label="Facturable" /> Facturable</label>
          <Field label="Commentaire" htmlFor="tm-desc" className="sm:col-span-2"><Input id="tm-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Button className="sm:col-span-2" disabled={pending || !f.projectId || !f.employeeId || !(Number(f.hours) > 0)} onClick={submit}>Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
