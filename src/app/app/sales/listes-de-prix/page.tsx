import type { Metadata } from "next";
import Link from "next/link";
import { Tags } from "lucide-react";
import { EmptyState } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/core/tenant/guards";
import { listPriceLists } from "@/modules/sales/price-lists";
import { NewPriceListDialog } from "@/modules/sales/ui/price-list-ui";

export const metadata: Metadata = { title: "Listes de prix" };

export default async function PriceListsPage() {
  const ctx = await requirePagePermission("sales.pricelist.manage");
  const rows = await listPriceLists(ctx);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">Un tarif par produit pour un groupe de clients (grossistes, revendeurs, contrats-cadres). À la saisie d&apos;un devis, d&apos;une commande ou d&apos;une facture, le prix de la liste du client est proposé ; il reste modifiable. Rattachez une liste à un client depuis sa fiche.</p>
        <NewPriceListDialog />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Tags className="size-8" />} title="Aucune liste de prix" description="Créez une liste, indiquez ses prix, puis rattachez-la à vos clients." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Liste</TableHead><TableHead className="text-right">Produits tarifés</TableHead><TableHead className="text-right">Clients</TableHead><TableHead>État</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-normal"><Link href={`/app/sales/listes-de-prix/${l.id}`} className="text-sm font-medium hover:text-brand">{l.name}</Link>{l.description && <span className="block text-xs text-muted-foreground">{l.description}</span>}</TableCell>
                  <TableCell className="text-right text-sm tabular">{l._count.items}</TableCell>
                  <TableCell className="text-right text-sm tabular">{l._count.customers}</TableCell>
                  <TableCell><StatusBadge tone={l.isActive ? "success" : "neutral"}>{l.isActive ? "Active" : "Désactivée"}</StatusBadge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
