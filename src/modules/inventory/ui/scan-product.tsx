"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { BarcodeScannerDialog } from "@/components/app/barcode-scanner";
import { Button } from "@/components/ui/button";
import { findProductByCodeAction } from "../actions";

/** Scan d'un produit : le code lu ouvre la fiche du produit (code-barres ou référence) ; sinon on propose de chercher dans la liste. */
export function ScanProductDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [missing, setMissing] = useState<string | null>(null);

  const onDetected = (code: string) => start(async () => {
    const res = await findProductByCodeAction({ code });
    if (!res.ok) { toast.error(res.error.message); return; }
    if (!res.data) { setMissing(code); return; }
    setMissing(null);
    onOpenChange(false);
    toast.success(res.data.name);
    router.push(`/app/inventory/produits/${res.data.id}`);
  });

  return (
    <BarcodeScannerDialog
      open={open && missing === null}
      onOpenChange={(o) => { onOpenChange(o); if (!o) setMissing(null); }}
      onDetected={onDetected}
      title="Scanner un produit"
      description="Le code-barres ou la référence ouvre directement la fiche du produit."
    />
  );
}

/** Bouton de la liste des produits : le code scanné remplit la recherche. */
export function ScanToSearchButton() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" className="h-10 bg-card" onClick={() => setOpen(true)}><ScanBarcode className="size-4" /> Scanner</Button>
      <BarcodeScannerDialog
        open={open} onOpenChange={setOpen}
        onDetected={(code) => {
          const p = new URLSearchParams(sp.toString());
          p.set("q", code); p.delete("page");
          setOpen(false);
          router.push(`${pathname}?${p}`);
        }}
        title="Rechercher par code-barres"
      />
    </>
  );
}
