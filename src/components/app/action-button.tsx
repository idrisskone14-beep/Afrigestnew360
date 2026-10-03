"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/core/errors";

/**
 * Bouton qui déclenche une Server Action (référence passée depuis un composant serveur), avec
 * confirmation optionnelle, toast et rafraîchissement / redirection au succès.
 */
export function ActionButton<I, R>({
  action, input, label, icon, variant = "outline", size, confirm, success, redirectTo, redirectToNew, className, disabled, ariaLabel,
}: {
  action: (input: I) => Promise<ActionResult<R>>;
  input: I;
  label: string;
  icon?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  confirm?: { title: string; description?: string; confirmLabel?: string };
  success?: string;
  /** Redirection après succès : chemin fixe, ou `redirectToNew` = chemin de base auquel l'identifiant créé est ajouté. */
  redirectTo?: string;
  redirectToNew?: string;
  className?: string;
  disabled?: boolean;
  /** Nom accessible d'un bouton réduit à son icône (label vide). */
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  const run = () => start(async () => {
    const res = await action(input);
    if (!res.ok) { toast.error(res.error.message); setOpen(false); return; }
    if (success) toast.success(success);
    setOpen(false);
    const created = (res.data as { id?: string } | undefined)?.id;
    const to = redirectToNew && created ? `${redirectToNew}/${created}` : redirectTo;
    if (to) router.push(to);
    router.refresh();
  });

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} disabled={disabled || pending} aria-label={ariaLabel} onClick={() => (confirm ? setOpen(true) : run())}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : icon}
        {label}
      </Button>
      {confirm && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{confirm.title}</DialogTitle>{confirm.description && <DialogDescription>{confirm.description}</DialogDescription>}</DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
              <Button variant={variant === "destructive" ? "destructive" : "default"} disabled={pending} onClick={run}>{confirm.confirmLabel ?? label}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
