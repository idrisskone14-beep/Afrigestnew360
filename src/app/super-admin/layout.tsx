import type { Metadata } from "next";
import { platformDb } from "@/core/db/client";
import { requirePlatformAdmin } from "@/core/tenant/guards";
import { PlatformShell } from "./platform-shell";

export const metadata: Metadata = { title: { default: "Super Admin", template: "%s · Super Admin" }, robots: { index: false, follow: false } };

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformAdmin();
  const newDemos = await platformDb.demoRequest.count({ where: { status: "NEW" } });
  return (
    <PlatformShell user={{ name: session.user.name, email: session.user.email }} newDemos={newDemos}>
      {children}
    </PlatformShell>
  );
}
