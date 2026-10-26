import { describe, expect, it } from "vitest";
import { checkEnv } from "@/core/env";
import { parseInvoiceState, parseIpnToken, paydunyaConfig } from "@/modules/billing/paydunya";

describe("PayDunya : configuration", () => {
  it("inactive sans les trois clés ; mode « test » par défaut, « live » uniquement s'il est demandé", () => {
    expect(paydunyaConfig({})).toBeNull();
    expect(paydunyaConfig({ PAYDUNYA_MASTER_KEY: "m", PAYDUNYA_PRIVATE_KEY: "p" })).toBeNull();
    const all = { PAYDUNYA_MASTER_KEY: "m", PAYDUNYA_PRIVATE_KEY: "p", PAYDUNYA_TOKEN: "t" };
    expect(paydunyaConfig(all)?.mode).toBe("test");
    expect(paydunyaConfig({ ...all, PAYDUNYA_MODE: "live" })?.mode).toBe("live");
    expect(paydunyaConfig({ ...all, PAYDUNYA_MODE: "prod" })?.mode).toBe("test");
  });

  it("le contrôle de configuration signale une configuration partielle ou restée en bac à sable", () => {
    const base = { DATABASE_URL: "x", AUTH_SECRET: "a".repeat(32), ENCRYPTION_KEY: "a".repeat(64), APP_URL: "https://x.test", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };
    const msgs = (env: Record<string, string>) => checkEnv({ ...base, ...env }).map((p) => p.message).join(" | ");
    expect(msgs({ PAYDUNYA_MASTER_KEY: "m" })).toMatch(/PayDunya incomplet : PAYDUNYA_PRIVATE_KEY, PAYDUNYA_TOKEN/);
    const full = { PAYDUNYA_MASTER_KEY: "m", PAYDUNYA_PRIVATE_KEY: "p", PAYDUNYA_TOKEN: "t", NODE_ENV: "production" };
    expect(msgs(full)).toMatch(/bac à sable/);
    expect(msgs({ ...full, PAYDUNYA_MODE: "live" })).not.toMatch(/PayDunya|bac à sable/);
    expect(msgs({})).not.toMatch(/PayDunya/);
  });
});

describe("PayDunya : notification (IPN)", () => {
  it("extrait le jeton d'un corps form-urlencoded à clés imbriquées", () => {
    const body = "data%5Bresponse_code%5D=00&data%5Bstatus%5D=completed&data%5Binvoice%5D%5Btoken%5D=test_RHICF0HboN&data%5Bhash%5D=abc";
    expect(parseIpnToken(body, "application/x-www-form-urlencoded")).toBe("test_RHICF0HboN");
    expect(parseIpnToken("data[invoice][token]=test_RHICF0HboN", null)).toBe("test_RHICF0HboN");
  });

  it("accepte aussi le JSON, et rejette tout jeton absent ou suspect", () => {
    expect(parseIpnToken(JSON.stringify({ data: { invoice: { token: "test_RHICF0HboN" } } }), "application/json")).toBe("test_RHICF0HboN");
    expect(parseIpnToken("{pas du json", "application/json")).toBeNull();
    expect(parseIpnToken("data[status]=completed", "application/x-www-form-urlencoded")).toBeNull();
    expect(parseIpnToken("data[invoice][token]=../../etc/passwd", null)).toBeNull();
    expect(parseIpnToken("data[invoice][token]=abc", null)).toBeNull(); // trop court
    expect(parseIpnToken("", null)).toBeNull();
  });
});

describe("PayDunya : état d'une facture", () => {
  it("normalise les statuts ; tout statut inconnu reste « en attente », jamais « payé »", () => {
    const st = (status: unknown) => parseInvoiceState({ status }).status;
    expect(st("completed")).toBe("completed");
    expect(st("COMPLETED")).toBe("completed");
    expect(st("cancelled")).toBe("cancelled");
    expect(st("canceled")).toBe("cancelled");
    expect(st("failed")).toBe("failed");
    expect(st("pending")).toBe("pending");
    expect(st("paid")).toBe("pending");
    expect(st(undefined)).toBe("pending");
  });

  it("lit montant, données personnalisées et reçu ; valeurs invalides ignorées", () => {
    const s = parseInvoiceState({ status: "completed", invoice: { total_amount: "25000" }, custom_data: { payment_id: "p1" }, receipt_url: "https://r", fail_reason: 3 });
    expect(s).toMatchObject({ totalAmount: 25000, customData: { payment_id: "p1" }, receiptUrl: "https://r", failReason: null });
    expect(parseInvoiceState({ invoice: { total_amount: "abc" } }).totalAmount).toBeNull();
    expect(parseInvoiceState({}).customData).toEqual({});
  });
});
