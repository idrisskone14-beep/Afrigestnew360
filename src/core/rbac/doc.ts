import { MODULES } from "@/core/modules/registry";
import { PERMISSIONS, ROLE_TEMPLATES, expandPatterns } from "./catalog";

const KIND_LABEL = { CORE: "Cœur", STANDARD: "Standard", EXTENSION: "Extension" } as const;
const STATUS_LABEL = { available: "Livré", planned: "Prévu" } as const;
const esc = (s: string) => s.replace(/\|/g, "\\|");

/**
 * Génère docs/PERMISSIONS.md à partir du catalogue de permissions et du registre de modules (source de vérité du code).
 * Un test vérifie que le fichier commité correspond à cette sortie : la documentation ne peut pas dériver.
 * Régénérer : `npm run docs:gen`.
 */
export function renderPermissionsDoc(): string {
  const out: string[] = [];
  out.push("# Modules, permissions et rôles");
  out.push("");
  out.push("> Document **généré** depuis `src/core/rbac/catalog.ts` et `src/core/modules/registry.ts` — ne pas l'éditer à la main (`npm run docs:gen`).");
  out.push("");
  out.push("## Modules");
  out.push("");
  out.push("| Clé | Module | Type | État | Description |");
  out.push("|---|---|---|---|---|");
  for (const m of MODULES) out.push(`| \`${m.key}\` | ${esc(m.name)} | ${KIND_LABEL[m.kind]} | ${STATUS_LABEL[m.status]} | ${esc(m.description)} |`);
  out.push("");
  out.push("Une permission n'est effective que si son module est actif pour l'entreprise (offre + surcharges) **et** que le rôle de l'utilisateur la détient. Un module désactivé est invisible et répond 403 par URL directe.");
  out.push("");
  out.push(`## Permissions (${PERMISSIONS.length})`);
  out.push("");
  for (const m of MODULES) {
    const perms = PERMISSIONS.filter((p) => p.module === m.key);
    if (perms.length === 0) continue;
    out.push(`### ${m.name} (\`${m.key}\`) — ${perms.length}`);
    out.push("");
    out.push("| Clé | Libellé |");
    out.push("|---|---|");
    for (const p of perms) out.push(`| \`${p.key}\` | ${esc(p.label)} |`);
    out.push("");
  }
  out.push("## Rôles modèles");
  out.push("");
  out.push("Copiés dans chaque nouvelle entreprise, puis **librement modifiables** (les rôles sont propres à chaque entreprise). Motifs : `a.b.c` exact, `a.*` préfixe, `*.read` suffixe.");
  out.push("");
  out.push("| Rôle | Description | Permissions | Motifs |");
  out.push("|---|---|---|---|");
  for (const r of ROLE_TEMPLATES) {
    const n = expandPatterns(r.patterns).length;
    const patterns = r.patterns.length > 8 ? `${r.patterns.slice(0, 8).map((p) => `\`${p}\``).join(", ")}, …` : r.patterns.map((p) => `\`${p}\``).join(", ");
    out.push(`| ${esc(r.name)}${r.isAdmin ? " (administrateur)" : ""} | ${esc(r.description)} | ${n} / ${PERMISSIONS.length} | ${patterns} |`);
  }
  out.push("");
  return out.join("\n");
}
