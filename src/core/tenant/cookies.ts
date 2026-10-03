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
