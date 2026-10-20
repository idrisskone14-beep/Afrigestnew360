import { describe, expect, it } from "vitest";
import { ENTITIES, fieldsFor, suggestMapping } from "@/modules/data/entities";
import { IMPORT_SOURCES, detectSource, suggestBySource } from "@/modules/data/sources";

const ctx = { can: () => true, hasModule: () => true } as never;

describe("reprise des factures ouvertes (soldes d'ouverture)", () => {
  const lk = {
    parties: new Map([["quincaillerie koffi".replace(/\s/g, ""), [{ id: "c1", name: "Quincaillerie Koffi", terms: 30 }]], ["doublon", [{ id: "c2", name: "Doublon", terms: 30 }, { id: "c3", name: "DOUBLON", terms: 30 }]]]),
    numbers: new Set<string>(), prefix: "FAC",
  };
  const row = (over: Record<string, string> = {}) => ({ number: "FA-2025-0123", party: "Quincaillerie Koffi", date: "15/09/2025", total: "1 180 000", subtotal: "1 000 000", ...over });
  const prep = (over: Record<string, string> = {}) => ENTITIES.invoices.prepare(ctx, row(over), lk);

  it("facture non réglée : montants HT / TVA / TTC repris, échéance = émission + délai du client", () => {
    const p = prep();
    expect(p.errors).toEqual([]);
    expect(p.input).toMatchObject({ number: "FA-2025-0123", partyId: "c1", date: "2025-09-15", dueDate: "2025-10-15", subtotal: 1_000_000, taxTotal: 180_000, total: 1_180_000, amountPaid: 0 });
    expect(p.identity).toBe("n:fa-2025-0123");
  });

  it("sans total HT : la TVA n'est pas détaillée ; échéance du fichier prioritaire", () => {
    const p = prep({ subtotal: "", dueDate: "31/12/2025" });
    expect(p.input).toMatchObject({ subtotal: 1_180_000, taxTotal: 0, dueDate: "2025-12-31" });
  });

  it("« Reste à payer » : le déjà réglé s'en déduit ; « Déjà réglé » est prioritaire", () => {
    expect(prep({ balance: "300 000" }).input).toMatchObject({ amountPaid: 880_000 });
    expect(prep({ amountPaid: "100000", balance: "300000" }).input).toMatchObject({ amountPaid: 100_000 });
  });

  it("refuse : facture soldée, client inconnu ou ambigu, HT > TTC, numéro proche de la numérotation automatique", () => {
    expect(prep({ balance: "0" }).errors.join(" ")).toContain("déjà soldée");
    expect(prep({ amountPaid: "1180000" }).errors.join(" ")).toContain("déjà soldée");
    expect(prep({ party: "Inconnu SARL" }).errors.join(" ")).toContain("introuvable");
    expect(prep({ party: "Doublon" }).errors.join(" ")).toContain("Plusieurs clients");
    expect(prep({ subtotal: "2000000" }).errors.join(" ")).toContain("Total HT");
    expect(prep({ number: "FAC-2025-00001" }).errors.join(" ")).toContain("numérotation automatique");
    expect(prep({ number: "", date: "", total: "" }).errors).toEqual(expect.arrayContaining(["N° de facture : valeur requise.", "Date de la facture : valeur requise.", "Total TTC : valeur requise."]));
  });

  it("factures fournisseurs : numéro d'origine conservé, identité par fournisseur", () => {
    const blk = { parties: new Map([["cimenterie", [{ id: "s1", name: "Cimenterie", terms: 45 }]]]), refs: new Set(["s1|ff-884"]) };
    const p = ENTITIES.bills.prepare(ctx, { number: "FF-884", party: "Cimenterie", date: "2025-09-02", total: "590000" }, blk);
    expect(p.errors).toEqual([]);
    expect(p.input).toMatchObject({ partyId: "s1", dueDate: "2025-10-17", total: 590_000 });
    expect(ENTITIES.bills.exists(blk, p)).toBe(true); // déjà repris : ignoré
  });
});

describe("plan comptable et écritures", () => {
  it("plan : espaces et points retirés du code, classe 9 et libellé court refusés", () => {
    const ok = ENTITIES.ledger.prepare(ctx, { code: "411 100", name: "Clients — marchandises" }, {});
    expect(ok.errors).toEqual([]);
    expect(ok.input).toEqual({ code: "411100", name: "Clients — marchandises" });
    expect(ENTITIES.ledger.prepare(ctx, { code: "9100", name: "Analytique" }, {}).errors.join(" ")).toContain("N° de compte");
    expect(ENTITIES.ledger.exists({ codes: new Set(["411100"]) }, ok)).toBe(true);
  });

  const lk = {
    accounts: new Map([["411100", { id: "a411", code: "411100", isActive: true }], ["701000", { id: "a701", code: "701000", isActive: true }], ["999000", { id: "a999", code: "999000", isActive: false }]]),
    journals: new Map([["od", { id: "jod", code: "OD", name: "Opérations diverses", type: "MISC" }], ["an", { id: "jan", code: "AN", name: "À-nouveaux", type: "OPENING" }]]),
    misc: { id: "jod", code: "OD", name: "Opérations diverses", type: "MISC" }, pieces: new Set<string>(),
  };
  const line = (over: Record<string, string> = {}) => ENTITIES.entries.prepare(ctx, { piece: "BAL-1", date: "01/01/2026", account: "411100", debit: "1180000", ...over }, lk);

  it("une ligne : compte et journal résolus, journal par défaut OD, une seule colonne de montant", () => {
    const p = line();
    expect(p.errors).toEqual([]);
    expect(p.input).toMatchObject({ journalId: "jod", date: "2026-01-01", reference: "BAL-1", line: { ledgerAccountId: "a411", debit: 1_180_000, credit: 0 } });
    expect(p.group).toBe("bal-1|2026-01-01|");
  });

  it("refuse : compte inconnu ou désactivé, journal d'à-nouveaux, débit ET crédit, aucun montant", () => {
    expect(line({ account: "123456" }).errors.join(" ")).toContain("introuvable");
    expect(line({ account: "999000" }).errors.join(" ")).toContain("désactivé");
    expect(line({ journal: "AN" }).errors.join(" ")).toContain("à-nouveaux");
    expect(line({ credit: "5" }).errors.join(" ")).toContain("débit ou au crédit");
    expect(line({ debit: "" }).errors.join(" ")).toContain("montant est requis");
  });

  it("pièce : équilibrée en débit/crédit, au moins deux lignes", () => {
    const { check } = ENTITIES.entries.group!;
    const a = line().input, b = line({ account: "701000", debit: "", credit: "1180000" }).input;
    expect(check([a, b])).toBeNull();
    expect(check([a])).toContain("au moins deux lignes");
    expect(check([a, line({ account: "701000", debit: "", credit: "1000000" }).input])).toContain("déséquilibrée");
  });
});

describe("applications d'origine reconnues", () => {
  const fields = (entity: keyof typeof ENTITIES) => fieldsFor({ can: () => true, hasModule: () => true } as never, ENTITIES[entity]);

  it("export Odoo de contacts : colonnes anglaises reconnues, application détectée", () => {
    const headers = ["Name", "Email", "Phone", "Street", "City", "Country", "Tax ID"];
    const s = suggestBySource("customers", headers, fields("customers"));
    expect(detectSource(s)).toBe("odoo");
    expect(s.odoo).toMatchObject({ name: 0, email: 1, phone: 2, address: 3, city: 4, country: 5, taxId: 6 });
  });

  it("export Sage de factures impayées : tiers, échéance, reste à payer", () => {
    const headers = ["N° pièce", "Date pièce", "Intitulé du tiers", "Date échéance", "Montant HT", "Montant TTC", "Reste à payer"];
    const s = suggestBySource("invoices", headers, fields("invoices"));
    expect(s.sage).toMatchObject({ number: 0, date: 1, party: 2, dueDate: 3, subtotal: 4, total: 5, balance: 6 });
    expect(detectSource(s)).not.toBeUndefined();
  });

  it("fichier au modèle KAKO Gestion : détecté comme générique ; l'application choisie peut être changée", () => {
    const headers = ["Raison sociale", "E-mail", "Téléphone", "Ville"];
    const s = suggestBySource("customers", headers, fields("customers"));
    expect(detectSource(s)).toBe("excel");
    expect(Object.keys(s).sort()).toEqual(IMPORT_SOURCES.map((x) => x.key).sort());
    expect(suggestMapping(headers, fields("customers"))).toMatchObject({ name: 0, email: 1, phone: 2, city: 3 });
  });

  it("une colonne n'alimente qu'un champ, même avec des intitulés d'application", () => {
    const s = suggestBySource("ledger", ["Numéro de compte", "Intitulé"], fields("ledger"));
    expect(s.sage).toEqual({ code: 0, name: 1 });
  });
});
