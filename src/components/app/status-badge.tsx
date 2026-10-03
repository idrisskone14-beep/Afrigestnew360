import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-brand/10 text-brand",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

export function StatusBadge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", TONES[tone], className)}>{children}</span>;
}

/** Table de correspondance statut → libellé + couleur, partagée par les modules. */
export const STATUS: Record<string, { label: string; tone: Tone }> = {
  // CRM
  NEW: { label: "Nouveau", tone: "info" }, CONTACTED: { label: "Contacté", tone: "info" }, QUALIFIED: { label: "Qualifié", tone: "success" },
  LOST: { label: "Perdu", tone: "danger" }, CONVERTED: { label: "Converti", tone: "success" }, OPEN: { label: "En cours", tone: "info" }, WON: { label: "Gagné", tone: "success" },
  // Documents
  DRAFT: { label: "Brouillon", tone: "neutral" }, SENT: { label: "Envoyé", tone: "info" }, ACCEPTED: { label: "Accepté", tone: "success" },
  REJECTED: { label: "Refusé", tone: "danger" }, EXPIRED: { label: "Expiré", tone: "warning" }, CONVERTED_DOC: { label: "Converti", tone: "success" },
  CONFIRMED: { label: "Confirmée", tone: "info" }, PARTIALLY_DELIVERED: { label: "Livrée en partie", tone: "warning" }, DELIVERED: { label: "Livrée", tone: "success" },
  INVOICED: { label: "Facturée", tone: "success" }, CANCELLED: { label: "Annulée", tone: "danger" },
  ISSUED: { label: "Émise", tone: "info" }, PARTIALLY_PAID: { label: "Payée en partie", tone: "warning" }, PAID: { label: "Payée", tone: "success" }, OVERDUE: { label: "Échue", tone: "danger" },
  // Achats
  SUBMITTED: { label: "Soumise", tone: "info" }, PENDING_APPROVAL: { label: "À valider", tone: "warning" }, APPROVED: { label: "Approuvée", tone: "success" },
  ORDERED: { label: "Commandée", tone: "info" }, PARTIALLY_RECEIVED: { label: "Reçue en partie", tone: "warning" }, RECEIVED: { label: "Reçue", tone: "success" }, BILLED: { label: "Facturée", tone: "success" },
  POSTED: { label: "Validée", tone: "success"}, EXPENSE_APPROVED: { label: "À payer", tone: "warning" },
  // RH, paie, projets
  ACTIVE: { label: "En activité", tone: "success" }, SUSPENDED: { label: "Suspendu", tone: "warning" }, TERMINATED: { label: "Sorti", tone: "neutral" }, PENDING: { label: "En attente", tone: "warning" },
  CALCULATED: { label: "Calculée", tone: "info" }, VALIDATED: { label: "Validée", tone: "success" }, PLANNED: { label: "Planifié", tone: "neutral" }, ON_HOLD: { label: "En pause", tone: "warning" }, DONE: { label: "Terminé", tone: "success" },
  // Flotte
  IN_MAINTENANCE: { label: "En maintenance", tone: "warning" }, OUT_OF_SERVICE: { label: "Hors service", tone: "danger" }, SOLD: { label: "Vendu", tone: "neutral" }, LEFT: { label: "Parti", tone: "neutral" },
  TO_PAY: { label: "À payer", tone: "warning" }, CONTESTED: { label: "Contestée", tone: "info" },
  TODO: { label: "À faire", tone: "neutral" }, IN_PROGRESS: { label: "En cours", tone: "info" }, REVIEW: { label: "En revue", tone: "warning" },
};

export function statusOf(status: string) {
  return STATUS[status] ?? { label: status, tone: "neutral" as Tone };
}

export function Status({ value }: { value: string }) {
  const s = statusOf(value);
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}
