import type { MetadataRoute } from "next";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const PAGES = ["", "/fonctionnalites", "/solutions", "/tarifs", "/contact", "/demo", "/connexion", "/inscription", "/conditions-utilisation", "/confidentialite", "/mentions-legales"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({ url: `${BASE}${p}`, changeFrequency: "monthly", priority: p === "" ? 1 : 0.7 }));
}
