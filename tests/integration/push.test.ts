import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformDb } from "@/core/db/client";
import { notify } from "@/core/notifications";
import { countSubscriptions, flushPendingPush, isAllowedEndpoint, saveSubscription } from "@/core/push/service";
import { addMember, ctxFor, makeCompany, makeUser } from "../helpers";

type Sent = { endpoint: string; body: { title: string; body?: string; url?: string; tag?: string } };
const sent: Sent[] = [];
const failures = new Map<string, number>(); // endpoint → code HTTP à simuler

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      const code = failures.get(sub.endpoint);
      if (code) throw Object.assign(new Error(`push ${code}`), { statusCode: code });
      sent.push({ endpoint: sub.endpoint, body: JSON.parse(payload) });
    },
  },
}));

const FCM = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;
const KEYS = { p256dh: "BPcxXm9hFV8pQ0wKJf3m2nQy1k5oR7sT9uVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuV", auth: "abcdEFGH1234abcd" };

beforeEach(() => {
  process.env.VAPID_PUBLIC_KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
  process.env.VAPID_PRIVATE_KEY = "tUkHswTi3d_AfmBJ0hMGTAbdc2Y1JkSeW7S8yo9-jnA";
  sent.length = 0;
  failures.clear();
});

async function setup() {
  const co = await makeCompany("PUSH");
  const ctx = await ctxFor(co.owner.id, co.company.id);
  const other = await addMember(co.company.id, "sales_rep");
  const send = (userIds: string[], title = "Facture échue", over: Record<string, unknown> = {}) =>
    notify(ctx.db, { companyId: co.company.id, userIds, type: "due_date", title, body: "3 factures à relancer", link: "/app/sales/relances", ...over });
  return { ...co, ctx, other, send };
}

describe("adresses de service push", () => {
  it("n'accepte que les services push connus, en HTTPS", () => {
    for (const ok of [FCM("abc"), "https://updates.push.services.mozilla.com/wpush/v2/xyz", "https://wns2-par02p.notify.windows.com/w/?token=1", "https://web.push.apple.com/QGx", "https://fcm.googleapis.com:443/fcm/send/a"]) expect(isAllowedEndpoint(ok), ok).toBe(true);
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/a", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/x",
      "https://fcm.googleapis.com.evil.example/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "ftp://fcm.googleapis.com/x", "pas une adresse", `https://fcm.googleapis.com/${"a".repeat(1100)}`,
    ]) expect(isAllowedEndpoint(bad), bad).toBe(false);
  });
});

describe("inscription des appareils", () => {
  it("enregistre un appareil, le reprend si un autre compte s'en sert, refuse les adresses et clés invalides", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await saveSubscription(a.id, { endpoint: FCM("dev1"), keys: KEYS }, "Chrome Android");
    expect(await countSubscriptions(a.id)).toBe(1);
    await saveSubscription(a.id, { endpoint: FCM("dev1"), keys: KEYS }); // idempotent
    expect(await countSubscriptions(a.id)).toBe(1);
    await saveSubscription(b.id, { endpoint: FCM("dev1"), keys: KEYS }); // même appareil, autre compte
    expect(await countSubscriptions(a.id)).toBe(0);
    expect(await countSubscriptions(b.id)).toBe(1);
    await expect(saveSubscription(a.id, { endpoint: "https://internal.example/x", keys: KEYS })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveSubscription(a.id, { endpoint: FCM("dev2"), keys: { p256dh: "court", auth: "x" } })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("distribution", () => {
  it("une notification crée une ligne « push en attente » qui part sur tous les appareils du destinataire, une seule fois", async () => {
    const s = await setup();
    await saveSubscription(s.owner.id, { endpoint: FCM("tel"), keys: KEYS });
    await saveSubscription(s.owner.id, { endpoint: FCM("pc"), keys: KEYS });
    await saveSubscription(s.other.user.id, { endpoint: FCM("autre"), keys: KEYS });
    await s.send([s.owner.id]);
    const row = await platformDb.notification.findFirstOrThrow({ where: { userId: s.owner.id, companyId: s.company.id } });
    expect(row.pushPending).toBe(true);

    const r = await flushPendingPush();
    expect(r.notifications).toBeGreaterThanOrEqual(1);
    const mine = sent.filter((x) => x.endpoint === FCM("tel") || x.endpoint === FCM("pc"));
    expect(mine).toHaveLength(2);
    expect(sent.some((x) => x.endpoint === FCM("autre"))).toBe(false); // l'autre utilisateur n'est pas concerné
    expect(mine[0]!.body).toMatchObject({ title: "Facture échue", url: "/app/sales/relances", tag: "due_date" });
    expect(mine[0]!.body.body).toContain("3 factures à relancer");
    expect(mine[0]!.body.body).toContain(s.company.legalName); // l'entreprise est nommée : un utilisateur peut en avoir plusieurs
    expect((await platformDb.notification.findUniqueOrThrow({ where: { id: row.id } })).pushPending).toBe(false);

    sent.length = 0;
    await flushPendingPush();
    expect(sent).toHaveLength(0); // déjà distribuée
  });

  it("deux distributions simultanées n'envoient chaque notification qu'une fois", async () => {
    const s = await setup();
    await saveSubscription(s.owner.id, { endpoint: FCM("solo"), keys: KEYS });
    await s.send([s.owner.id], "Alerte unique");
    await Promise.all([flushPendingPush(), flushPendingPush(), flushPendingPush()]);
    expect(sent.filter((x) => x.body.title === "Alerte unique")).toHaveLength(1);
  });

  it("respecte la préférence : push désactivé pour ce type = pas de push, mais la notification reste dans l'application", async () => {
    const s = await setup();
    await saveSubscription(s.owner.id, { endpoint: FCM("pref"), keys: KEYS });
    await platformDb.notificationPreference.create({ data: { companyId: s.company.id, userId: s.owner.id, type: "due_date", inApp: true, email: false, push: false } });
    await s.send([s.owner.id], "Sans push");
    const row = await platformDb.notification.findFirstOrThrow({ where: { userId: s.owner.id, title: "Sans push" } });
    expect(row.pushPending).toBe(false);
    expect(row.status).toBe("UNREAD");
    await flushPendingPush();
    expect(sent.some((x) => x.body.title === "Sans push")).toBe(false);
  });

  it("sans clés VAPID, rien n'est mis en attente (pas de file qui grossit pour rien)", async () => {
    const s = await setup();
    delete process.env.VAPID_PRIVATE_KEY;
    await s.send([s.owner.id], "Sans clés");
    expect((await platformDb.notification.findFirstOrThrow({ where: { userId: s.owner.id, title: "Sans clés" } })).pushPending).toBe(false);
  });

  it("retire un appareil que le service push déclare disparu (410) et garde celui qui a une panne passagère", async () => {
    const s = await setup();
    await saveSubscription(s.owner.id, { endpoint: FCM("mort"), keys: KEYS });
    await saveSubscription(s.owner.id, { endpoint: FCM("panne"), keys: KEYS });
    await saveSubscription(s.owner.id, { endpoint: FCM("vivant"), keys: KEYS });
    failures.set(FCM("mort"), 410);
    failures.set(FCM("panne"), 503);
    await s.send([s.owner.id], "Test erreurs");
    const r = await flushPendingPush();
    expect(r.removed).toBeGreaterThanOrEqual(1);
    const left = (await platformDb.pushSubscription.findMany({ where: { userId: s.owner.id } })).map((x) => x.endpoint).sort();
    expect(left).toEqual([FCM("panne"), FCM("vivant")].sort());
    expect(sent.filter((x) => x.body.title === "Test erreurs").map((x) => x.endpoint)).toEqual([FCM("vivant")]);
  });

  it("un utilisateur sans appareil : la notification est consommée sans envoi", async () => {
    const s = await setup();
    await s.send([s.other.user.id], "Sans appareil");
    await flushPendingPush();
    expect(sent.filter((x) => x.body.title === "Sans appareil")).toHaveLength(0);
    expect((await platformDb.notification.findFirstOrThrow({ where: { userId: s.other.user.id, title: "Sans appareil" } })).pushPending).toBe(false);
  });
});
