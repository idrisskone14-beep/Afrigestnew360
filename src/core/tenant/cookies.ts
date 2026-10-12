import "server-only";
import { cookies, headers } from "next/headers";
import { ACTIVE_COMPANY_COOKIE } from "./context";

export async function setActiveCompanyCookie(companyId: string) {
  const secure = (await headers()).get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export const YEAR_COOKIE = "afg_year";

/** Année d'affichage choisie dans la barre du haut (préférence d'interface, pas un droit d'accès). */
export async function setYearCookie(year: number) {
  const secure = (await headers()).get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  (await cookies()).set(YEAR_COOKIE, String(year), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 365 });
}
