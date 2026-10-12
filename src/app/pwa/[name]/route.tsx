import { type NextRequest } from "next/server";
import { brandIcon } from "@/lib/pwa-icon";

const ICONS: Record<string, { size: number; maskable: boolean }> = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
};

/** Icônes du manifeste de l'application installable (générées, mises en cache longtemps). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const icon = ICONS[name];
  if (!icon) return new Response(null, { status: 404 });
  const res = brandIcon(icon.size, { maskable: icon.maskable });
  res.headers.set("Cache-Control", "public, max-age=86400, immutable");
  return res;
}
