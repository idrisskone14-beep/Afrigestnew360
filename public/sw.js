/* Service worker d'AfriGest 360.
 * Rôles : (1) afficher une page claire quand le réseau manque, (2) recevoir les notifications push et ouvrir la bonne page au clic.
 * Il ne met AUCUNE page ni donnée d'entreprise en cache : les écrans de l'application contiennent des données confidentielles
 * et doivent toujours venir du serveur (une session fermée ne doit rien laisser sur l'appareil). */
const OFFLINE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hors connexion · AfriGest 360</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#fff;color:#0b1f44;padding:24px;text-align:center}
main{max-width:360px}h1{font-size:22px;margin:0 0 8px}p{color:#51607a;line-height:1.5;margin:0 0 20px}
button{background:#f97316;color:#0b1f44;border:0;border-radius:8px;padding:12px 20px;font-weight:700;font-size:16px}</style></head>
<body><main><h1>Pas de connexion</h1><p>AfriGest 360 a besoin d'internet pour afficher vos données en toute sécurité. Vérifiez votre réseau, puis réessayez.</p>
<button onclick="location.reload()">Réessayer</button></main></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "AfriGest 360", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "AfriGest 360";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/pwa/icon-192.png",
    badge: "/pwa/icon-192.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/app/notifications" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/app/notifications", self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) { await c.focus(); if ("navigate" in c) await c.navigate(target); return; }
    }
    await self.clients.openWindow(target);
  })());
});
