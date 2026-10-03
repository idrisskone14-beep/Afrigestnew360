import type { Metadata } from "next";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { num } from "@/core/money";
import { requirePagePermission } from "@/core/tenant/guards";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/reference-data";
import { listItems } from "@/modules/payroll/service";
import { BASES, CATEGORIES, ITEM_TYPES, MODES } from "@/modules/payroll/schemas";
import { ItemActiveSwitch, ItemDialog, SampleItemsButton, type ItemInit } from "@/modules/payroll/ui/item-dialogs";

export const metadata: Metadata = { title: "Rubriques de paie" };

export default async function ItemsPage() {
  const ctx = await requirePagePermission("hr.payroll.manage");
  const items = await listItems(ctx);
  const cur = ctx.company.currency;
  const today = new Date();
  const describe = (i: (typeof items)[number]) => {
    if (i.mode === "FIXED") return formatMoney(num(i.value), cur);
    if (i.mode === "RATE") return `${num(i.value)} % de ${BASES.find((b) => b.value === i.base)!.label.toLowerCase()}${i.ceiling ? ` (plafond ${formatMoney(num(i.ceiling), cur)})` : ""}`;
    const br = (i.brackets as { upTo: number | null; rate: number }[] | null) ?? [];
    return `Barème : ${br.map((b) => `${b.upTo === null ? "au-delà" : `≤ ${new Intl.NumberFormat("fr-FR").format(b.upTo)}`} → ${b.rate} %`).join(" · ")}`;
  };
  const toInit = (i: (typeof items)[number]): ItemInit => ({ code: i.code, name: i.name, type: i.type, category: i.category, mode: i.mode, base: i.base, value: num(i.value), ceiling: i.ceiling ? num(i.ceiling) : null, brackets: (i.brackets as { upTo: number | null; rate: number }[] | null) ?? [{ upTo: null, rate: 0 }], taxable: i.taxable, deductibleForTax: i.deductibleForTax, sortOrder: i.sortOrder, effectiveFrom: new Date().toISOString().slice(0, 10) });

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">Aucun taux ni barème légal n'est prédéfini : les rubriques ci-dessous sont à renseigner selon la réglementation de votre pays et votre convention collective. Le modèle indicatif ne contient que des <strong>taux d'exemple</strong>. Faites valider votre paramétrage par votre expert-comptable ou votre conseil social.</p>
      <div className="flex flex-wrap items-center justify-end gap-2">{items.length === 0 && <SampleItemsButton />}<ItemDialog /></div>
      {items.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Aucune rubrique. Le bulletin ne comportera que le salaire de base.</p> : (
        <Card className="divide-y p-0">
          {items.map((i) => {
            const current = i.effectiveFrom <= today && (!i.effectiveTo || i.effectiveTo >= today);
            return (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{i.name}<span className="text-xs font-normal text-muted-foreground">{i.code}</span>
                    <Badge variant="secondary">{ITEM_TYPES.find((t) => t.value === i.type)!.label}</Badge>{i.type !== "EARNING" && <Badge variant="outline">{CATEGORIES.find((c) => c.value === i.category)!.label}</Badge>}{current && i.isActive && <Badge className="bg-success/15 text-success hover:bg-success/15">En vigueur</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">{MODES.find((m) => m.value === i.mode)!.label} — {describe(i)}</p>
                  <p className="text-xs text-muted-foreground">Du {fmtDate(i.effectiveFrom)}{i.effectiveTo ? ` au ${fmtDate(i.effectiveTo)}` : " (sans fin)"} · ordre {i.sortOrder}</p>
                </div>
                <ItemDialog item={toInit(i)} trigger={<Button size="sm" variant="ghost"><Pencil className="size-4" /> Nouvelle version</Button>} />
                <ItemActiveSwitch id={i.id} isActive={i.isActive} label={`Rubrique ${i.code} du ${fmtDate(i.effectiveFrom)} active`} />
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
