"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/app/page-header";
import { runAction } from "@/components/app/form-kit";
import { applyCountAction } from "../actions";

interface Row { productId: string; name: string; sku: string; unit: string; theoretical: number }

/** Feuille d'inventaire physique : saisissez les quantités comptées ; seuls les écarts génèrent des ajustements. */
export function CountSheet({ warehouses, warehouseId, rows }: { warehouses: { id: string; name: string }[]; warehouseId: string | null; rows: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const entries = rows.filter((r) => counted[r.productId] !== undefined && counted[r.productId] !== "");
  const gaps = entries.filter((r) => Number(counted[r.productId]) !== r.theoretical);

  if (!warehouseId) return <EmptyState icon={<ClipboardCheck className="size-8" />} title="Aucun entrepôt" description="Créez un entrepôt pour faire un inventaire." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={warehouseId} onValueChange={(v) => router.push(`/app/inventory/inventaire?entrepot=${v}`)}>
          <SelectTrigger className="w-56" aria-label="Entrepôt"><SelectValue /></SelectTrigger>
          <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">Renseignez la quantité réellement comptée. Les lignes vides sont ignorées.</p>
      </div>
      {rows.length === 0 ? <EmptyState icon={<ClipboardCheck className="size-8" />} title="Aucun produit suivi en stock" /> : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Produit</TableHead><TableHead className="text-right">Théorique</TableHead><TableHead className="w-40 text-right">Compté</TableHead><TableHead className="w-24 text-right">Écart</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => {
                const v = counted[r.productId];
                const gap = v === undefined || v === "" ? null : Number(v) - r.theoretical;
                return (
                  <TableRow key={r.productId}>
                    <TableCell><span className="block truncate text-sm font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{r.sku}</span></TableCell>
                    <TableCell className="text-right text-sm tabular">{r.theoretical} {r.unit}</TableCell>
                    <TableCell className="text-right"><Input type="number" min={0} step="any" className="ml-auto h-8 w-28 text-right" value={v ?? ""} aria-label={`Quantité comptée ${r.name}`} onChange={(e) => setCounted({ ...counted, [r.productId]: e.target.value })} /></TableCell>
                    <TableCell className={`text-right text-sm tabular ${gap ? (gap < 0 ? "font-medium text-destructive" : "font-medium text-success") : "text-muted-foreground"}`}>{gap === null ? "" : gap > 0 ? `+${gap}` : gap}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Motif (optionnel)" aria-label="Motif" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button disabled={pending || entries.length === 0} onClick={() => start(async () => {
          const r = await runAction(applyCountAction({ warehouseId, reason, lines: entries.map((e) => ({ productId: e.productId, counted: Number(counted[e.productId]) })) }));
          if (r.ok) { toast.success(`${r.data.adjusted} écart(s) corrigé(s)`); setCounted({}); router.refresh(); }
        })}><ClipboardCheck className="size-4" /> Valider l'inventaire ({gaps.length} écart{gaps.length > 1 ? "s" : ""})</Button>
      </div>
    </div>
  );
}
