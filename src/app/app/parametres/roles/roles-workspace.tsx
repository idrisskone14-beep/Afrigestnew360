"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Copy, Lock, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, runAction } from "@/components/app/form-kit";
import { MODULES } from "@/core/modules/registry";
import { PERMISSIONS } from "@/core/rbac/catalog";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "@/modules/settings/actions";
import { cn } from "@/lib/utils";

interface RoleRow { id: string; name: string; description: string | null; isAdmin: boolean; isSystem: boolean; members: number; permissions: number }

export function RolesWorkspace({ roles, selectedId, selectedKeys, canManage, actorIsAdmin, actorPermissions, enabledModules }: {
  roles: RoleRow[]; selectedId: string | null; selectedKeys: string[]; canManage: boolean; actorIsAdmin: boolean;
  actorPermissions: string[] | null; enabledModules: string[];
}) {
  const router = useRouter();
  const selected = roles.find((r) => r.id === selectedId) ?? null;
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Rôles ({roles.length})</h2>
          {canManage && <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Nouveau</Button>}
        </div>
        <ul className="space-y-1">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => router.push(`/app/parametres/roles?role=${r.id}`)}
                aria-current={r.id === selectedId}
                className={cn("flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/60", r.id === selectedId && "border-brand/60 bg-accent/60")}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">{r.name}{r.isAdmin && <Lock className="size-3 text-muted-foreground" />}</span>
                  <span className="block text-xs text-muted-foreground">{r.members} membre{r.members > 1 ? "s" : ""} · {r.isAdmin ? "toutes les permissions" : `${r.permissions} permissions`}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {selected ? (
        <RoleEditor
          key={selected.id}
          role={selected}
          initialKeys={selectedKeys}
          canManage={canManage}
          actorIsAdmin={actorIsAdmin}
          actorPermissions={actorPermissions}
          enabledModules={enabledModules}
          allRoles={roles}
        />
      ) : null}

      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} roles={roles} actorIsAdmin={actorIsAdmin} onCreated={(id) => router.push(`/app/parametres/roles?role=${id}`)} />
    </div>
  );
}

function RoleEditor({ role, initialKeys, canManage, actorIsAdmin, actorPermissions, enabledModules }: {
  role: RoleRow; initialKeys: string[]; canManage: boolean; actorIsAdmin: boolean; actorPermissions: string[] | null;
  enabledModules: string[]; allRoles: RoleRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [keys, setKeys] = useState<Set<string>>(new Set(initialKeys));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const actorSet = useMemo(() => (actorPermissions ? new Set(actorPermissions) : null), [actorPermissions]);
  const readOnly = !canManage || (role.isAdmin && !actorIsAdmin);
  // anti-escalade : un non-admin ne peut cocher que ce qu'il détient (et peut toujours décocher)
  const canToggle = (key: string) => !readOnly && !role.isAdmin && (actorSet === null || actorSet.has(key) || keys.has(key));

  const groups = useMemo(() => {
    const byModule = new Map<string, { id: string; label: string; perms: typeof PERMISSIONS[number][] }[]>();
    for (const p of PERMISSIONS) {
      const list = byModule.get(p.module) ?? [];
      const id = p.key.slice(0, p.key.lastIndexOf("."));
      let res = list.find((r) => r.id === id);
      if (!res) {
        res = { id, label: p.label.split(" — ")[1] ?? p.resource, perms: [] };
        list.push(res);
      }
      res.perms.push(p);
      byModule.set(p.module, list);
    }
    return MODULES.map((m) => ({ module: m, resources: byModule.get(m.key) ?? [] })).filter((g) => g.resources.length > 0);
  }, []);

  const toggle = (k: string, on: boolean) =>
    setKeys((prev) => { const n = new Set(prev); if (on) n.add(k); else n.delete(k); return n; });
  const toggleMany = (ks: string[], on: boolean) =>
    setKeys((prev) => { const n = new Set(prev); ks.filter(canToggle).forEach((k) => (on ? n.add(k) : n.delete(k))); return n; });

  const dirty = name !== role.name || description !== (role.description ?? "") || keys.size !== initialKeys.length || initialKeys.some((k) => !keys.has(k));

  const save = () =>
    start(async () => {
      const res = await runAction(updateRoleAction({ roleId: role.id, name, description, permissionKeys: role.isAdmin ? [] : [...keys] }), { success: "Rôle enregistré" });
      if (res.ok) router.refresh();
    });

  const remove = () =>
    start(async () => {
      const res = await runAction(deleteRoleAction({ roleId: role.id }), { success: "Rôle supprimé" });
      if (res.ok) { setConfirmDelete(false); router.push("/app/parametres/roles"); router.refresh(); }
    });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">{role.isAdmin ? "Administrateur" : "Informations du rôle"}</CardTitle>
            {role.isAdmin && <p className="mt-1 text-sm text-muted-foreground">Ce rôle système dispose automatiquement de toutes les permissions des modules actifs, y compris celles qui seront ajoutées plus tard.</p>}
          </div>
          {canManage && !role.isSystem && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" /> Supprimer</Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom" htmlFor="role-name"><Input id="role-name" value={name} disabled={readOnly || role.isSystem} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description" htmlFor="role-desc"><Textarea id="role-desc" rows={1} value={description} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} /></Field>
        </CardContent>
      </Card>

      {!role.isAdmin && (
        <div className="space-y-4">
          {groups.map(({ module, resources }) => {
            const enabled = enabledModules.includes(module.key);
            const all = resources.flatMap((r) => r.perms.map((p) => p.key));
            const checked = all.filter((k) => keys.has(k)).length;
            return (
              <Card key={module.key} className={cn(!enabled && "opacity-60")}>
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">{module.name}</CardTitle>
                    {!enabled && <Badge variant="secondary">Module non activé</Badge>}
                  </div>
                  {!readOnly && (
                    <Button variant="ghost" size="sm" onClick={() => toggleMany(all, checked !== all.length)}>
                      {checked === all.length ? "Tout retirer" : "Tout cocher"}
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {resources.map((r) => (
                    <div key={r.id} className="grid gap-2 sm:grid-cols-[14rem_1fr] sm:items-center">
                      <p className="text-sm text-muted-foreground">{r.label}</p>
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {r.perms.map((p) => (
                          <label key={p.key} className={cn("flex items-center gap-2 text-sm", !canToggle(p.key) && "opacity-60")} title={p.key}>
                            <Checkbox checked={keys.has(p.key)} disabled={!canToggle(p.key)} onCheckedChange={(v) => toggle(p.key, v === true)} />
                            {p.label.split(" — ")[0]}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!readOnly && (
        <div className="sticky bottom-4 flex justify-end">
          <Button disabled={pending || !dirty} onClick={save} className="shadow-lg"><Save className="size-4" /> Enregistrer le rôle</Button>
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer le rôle « {role.name} » ?</DialogTitle>
            <DialogDescription>{role.members > 0 ? `${role.members} membre(s) utilisent ce rôle : réaffectez-les avant de le supprimer.` : "Cette action est définitive."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Annuler</Button>
            <Button variant="destructive" disabled={pending} onClick={remove}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateRoleDialog({ open, onOpenChange, roles, actorIsAdmin, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; roles: RoleRow[]; actorIsAdmin: boolean; onCreated: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [error, setError] = useState<string | undefined>();

  const submit = () =>
    start(async () => {
      setError(undefined);
      const res = await runAction(createRoleAction({ name, copyFromRoleId: copyFrom || undefined }), { silentError: true });
      if (!res.ok) return setError(res.error.fieldErrors?.name?.[0] ?? res.error.message);
      toast.success("Rôle créé");
      onOpenChange(false); setName(""); setCopyFrom("");
      router.refresh();
      onCreated(res.data.id);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau rôle</DialogTitle>
          <DialogDescription>Créez un rôle propre à votre entreprise, éventuellement à partir d'un rôle existant.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Nom du rôle" htmlFor="new-role" error={error}><Input id="new-role" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="ex. Responsable logistique" /></Field>
          <Field label="Copier les permissions de (optionnel)">
            <div className="flex flex-wrap gap-2">
              {roles.filter((r) => actorIsAdmin || !r.isAdmin).map((r) => (
                <Button key={r.id} type="button" size="sm" variant={copyFrom === r.id ? "default" : "outline"} onClick={() => setCopyFrom(copyFrom === r.id ? "" : r.id)}>
                  {copyFrom === r.id && <Copy className="size-3.5" />}{r.name}
                </Button>
              ))}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button disabled={pending || name.trim().length < 2} onClick={submit}>Créer le rôle</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
