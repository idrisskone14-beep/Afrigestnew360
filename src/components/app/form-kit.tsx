"use client";

import { Loader2 } from "lucide-react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActionError, ActionResult } from "@/core/errors";
import { cn } from "@/lib/utils";

export function Field({
  label, htmlFor, error, hint, className, children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormAlert({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

export function SubmitButton({
  pending, children, className, variant, size,
}: {
  pending?: boolean;
  children: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  return (
    <Button type="submit" disabled={pending} className={className} variant={variant} size={size}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}

/** Reporte les erreurs de champ du serveur dans react-hook-form ; renvoie le message global le cas échéant. */
export function applyServerErrors<T extends FieldValues>(error: ActionError, setError: UseFormSetError<T>): string | null {
  let mapped = false;
  for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
    if (messages?.[0]) {
      setError(field as Path<T>, { type: "server", message: messages[0] });
      mapped = true;
    }
  }
  return mapped && error.code === "VALIDATION" ? null : error.message;
}

/** Exécute une action serveur avec toast de succès/erreur ; renvoie le résultat. */
export async function runAction<T>(
  promise: Promise<ActionResult<T>>,
  opts: { success?: string; silentError?: boolean } = {},
): Promise<ActionResult<T>> {
  const result = await promise;
  if (result.ok) {
    if (opts.success) toast.success(opts.success);
  } else if (!opts.silentError) {
    toast.error(result.error.message);
  }
  return result;
}
