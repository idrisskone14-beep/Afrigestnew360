import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPermissionsDoc } from "@/core/rbac/doc";

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

describe("documentation", () => {
  it("docs/PERMISSIONS.md correspond au catalogue de permissions et au registre de modules (npm run docs:gen)", () => {
    expect(read("docs/PERMISSIONS.md")).toBe(renderPermissionsDoc());
  });

  it("les documents d'exploitation existent et ne contiennent aucun secret réel", () => {
    for (const f of ["README.md", "docs/ARCHITECTURE.md", "docs/DEPLOIEMENT.md", "docs/SECURITE.md", "docs/EXPLOITATION.md", "docs/CONTRIBUER.md", "CHANGELOG.md"]) {
      const text = read(f);
      expect(text.length, f).toBeGreaterThan(500);
      // aucune URL de base avec mot de passe, aucune clé Resend, aucune clé privée
      expect(text, f).not.toMatch(/postgres(ql)?:\/\/[^\s:@]+:(?!CHANGE_ME|MOT_DE_PASSE|motdepasse|password|postgres|test_app_pw|\.\.\.|<)[^\s@]{6,}@/i);
      expect(text, f).not.toMatch(/re_[A-Za-z0-9]{20,}/);
      expect(text, f).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    }
  });
});
