"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MoreHorizontal, Send, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, runAction } from "@/components/app/form-kit";
import { EmptyState } from "@/components/app/page-header";
import {
  changeMemberRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction, setMemberStatusAction,
} from "@/modules/settings/actions";
import { initials } from "@/lib/utils";

interface Member { id: string; userId: string; name: string; email: string; roleId: string; roleName: string; roleIsAdmin: boolean; isOwner: boolean; status: "ACTIVE" | "SUSPENDED"; twoFactor: boolean; lastLogin: string }
interface Role { id: string; name: string; isAdmin: boolean }
interface Invitation { id: string; email: string; roleName: string; expires: string }

export function MembersPanel({ members, invitations, roles, currentUserId, isAdmin, can, usage }: {
  members: Member[]; invitations: Invitation[]; roles: Role[]; currentUserId: string; isAdmin: boolean;
  can: { invite: boolean; update: boolean; remove: boolean }; usage: { used: number; max: number };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<string>("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const assignable = roles.filter((r) => isAdmin || !r.isAdmin);
  const act = (p: Promise<Awaited<ReturnType<typeof inviteMemberAction>>>, success: string) =>
    start(async () => { const res = await runAction(p, { success }); if (res.ok) router.refresh(); });

  const submitInvite = () =>
    start(async () => {
      setInviteError(null);
      const res = await runAction(inviteMemberAction({ email, roleId }), { silentError: true });
      if (!res.ok) return setInviteError(res.error.fieldErrors?.email?.[0] ?? res.error.message);
      toast.success(`Invitation envoyée à ${email}`);
      setInviteOpen(false); setEmail(""); setRoleId("");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {usage.used} utilisateur{usage.used > 1 ? "s" : ""} sur {usage.max === -1 ? "illimité" : usage.max} inclus dans votre offre (invitations en attente comprises).
        </p>
        {can.invite && <Button onClick={() => setInviteOpen(true)}><UserPlus className="size-4" /> Inviter un membre</Button>}
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Membre</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead className="hidden md:table-cell">Dernière connexion</TableHead>
              <TableHead className="hidden sm:table-cell">Statut</TableHead>
              <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const protectedAdmin = m.roleIsAdmin && !isAdmin;
              const showMenu = (can.update || can.remove) && !protectedAdmin && m.userId !== currentUserId;
              return (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8"><AvatarFallback className="text-xs">{initials(m.name)}</AvatarFallback></Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.name}{m.userId === currentUserId && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(vous)</span>}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      {m.roleName}
                      {m.isOwner && <Badge variant="secondary">Propriétaire</Badge>}
                      {m.twoFactor && <span title="2FA activée"><ShieldCheck className="size-3.5 text-success" /></span>}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{m.lastLogin}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant={m.status === "ACTIVE" ? "secondary" : "destructive"}>{m.status === "ACTIVE" ? "Actif" : "Suspendu"}</Badge>
                  </TableCell>
                  <TableCell>
                    {showMenu && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions pour ${m.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {can.update && (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>Changer le rôle</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                <DropdownMenuLabel className="text-xs text-muted-foreground">Rôle de {m.name}</DropdownMenuLabel>
                                {assignable.map((r) => (
                                  <DropdownMenuItem key={r.id} disabled={r.id === m.roleId} onSelect={() => act(changeMemberRoleAction({ membershipId: m.id, roleId: r.id }), "Rôle mis à jour")}>
                                    {r.name}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          )}
                          {can.update && !m.isOwner && (
                            <DropdownMenuItem onSelect={() => act(setMemberStatusAction({ membershipId: m.id, status: m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }), m.status === "ACTIVE" ? "Accès suspendu" : "Accès réactivé")}>
                              {m.status === "ACTIVE" ? "Suspendre l'accès" : "Réactiver l'accès"}
                            </DropdownMenuItem>
                          )}
                          {can.remove && !m.isOwner && (<><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmRemove(m)}>Retirer de l'entreprise</DropdownMenuItem></>)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Invitations en attente</h2>
        {invitations.length === 0 ? (
          <EmptyState icon={<Send className="size-7" />} title="Aucune invitation en attente" description="Invitez des collaborateurs par e-mail ; ils choisissent leur mot de passe à l'acceptation." />
        ) : (
          <Card className="divide-y p-0">
            {invitations.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.email}</p>
                  <p className="text-xs text-muted-foreground">Rôle « {i.roleName} » · expire le {i.expires}</p>
                </div>
                {can.invite && <Button variant="ghost" size="sm" disabled={pending} onClick={() => act(revokeInvitationAction({ invitationId: i.id }), "Invitation révoquée")}>Révoquer</Button>}
              </div>
            ))}
          </Card>
        )}
      </section>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inviter un membre</DialogTitle>
            <DialogDescription>Un e-mail contenant un lien d'invitation valable 7 jours sera envoyé.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Adresse e-mail" htmlFor="invite-email" error={inviteError ?? undefined}>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="collaborateur@entreprise.com" autoFocus />
            </Field>
            <Field label="Rôle">
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choisir un rôle…" /></SelectTrigger>
                <SelectContent>{assignable.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Annuler</Button>
            <Button disabled={pending || !email || !roleId} onClick={submitInvite}>Envoyer l'invitation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRemove !== null} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retirer {confirmRemove?.name} ?</DialogTitle>
            <DialogDescription>Cette personne perdra immédiatement l'accès à l'entreprise. Son compte et ses autres entreprises ne sont pas affectés.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(null)}>Annuler</Button>
            <Button variant="destructive" disabled={pending} onClick={() => { const m = confirmRemove!; setConfirmRemove(null); act(removeMemberAction({ membershipId: m.id }), "Membre retiré"); }}>Retirer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
