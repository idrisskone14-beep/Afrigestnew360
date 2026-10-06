// Proxy TCP qui ajoute un délai fixe à chaque paquet dans chaque sens : simule une base distante (mesures de performance).
//   node scripts/latency-proxy.mjs [portLocal=54340] [portBase=54329] [delaiMsParSens=15]   (15 ms par sens ≈ 30 ms d aller-retour)
// Puis lancer l application avec DATABASE_URL pointant sur le port local du proxy.
import net from "node:net";
const [listen = 54340, target = 54329, delay = 15] = process.argv.slice(2).map(Number);

net.createServer((client) => {
  const upstream = net.connect(target, "127.0.0.1");
  const pipe = (from, to) => from.on("data", (chunk) => setTimeout(() => { if (!to.destroyed) to.write(chunk); }, delay));
  pipe(client, upstream);
  pipe(upstream, client);
  const close = () => { client.destroy(); upstream.destroy(); };
  client.on("error", close); upstream.on("error", close);
  client.on("close", close); upstream.on("close", close);
}).listen(listen, "127.0.0.1", () => console.log(`proxy ${listen} -> ${target}, +${delay} ms par sens`));
