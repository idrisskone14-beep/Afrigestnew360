/**
 * Régénère la documentation dérivée du code (docs/PERMISSIONS.md).
 *   npm run docs:gen
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { renderPermissionsDoc } from "../src/core/rbac/doc";

const target = path.resolve(process.cwd(), "docs/PERMISSIONS.md");
writeFileSync(target, renderPermissionsDoc(), "utf8");
console.log(`Écrit : ${target}`);
