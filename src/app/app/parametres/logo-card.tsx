"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoPicker } from "@/components/app/logo-uploader";
import { uploadCompanyLogoAction } from "@/modules/settings/logo-actions";

export function LogoCard({ canEdit, currentUrl }: { canEdit: boolean; currentUrl: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);

  const save = () => start(async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("logo", file);
    const res = await uploadCompanyLogoAction(fd);
    if (!res.ok) return void toast.error(res.error.message);
    toast.success("Logo enregistré");
    setFile(null);
    router.refresh();
  });

  return (
    <Card className="mb-6 max-w-4xl">
      <CardHeader><CardTitle className="text-base">Logo</CardTitle><CardDescription>Affiché dans l'application et sur vos documents (devis, factures, bulletins).</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <LogoPicker value={file} onChange={setFile} currentUrl={currentUrl} disabled={!canEdit} />
        {canEdit && file && <Button disabled={pending} onClick={save}>Enregistrer le logo</Button>}
      </CardContent>
    </Card>
  );
}
