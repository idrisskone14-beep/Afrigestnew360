// Mesure (build de production : `npm run build && npx next start`) : durée de rendu et nombre de transactions SQL par page.
//   PERF_BASE=http://localhost:3101 node scripts/perf-pages.mjs [chemin ...]   — session démo locale (DEMO_PASSWORD du seed)
import "dotenv/config";
import pg from "pg";

const BASE = process.env.PERF_BASE ?? "http://localhost:3100";
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const keep = (res) => { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };

const csrf = await fetch(`${BASE}/api/auth/csrf`); keep(csrf);
const { csrfToken } = await csrf.json();
const body = new URLSearchParams({ csrfToken, email: "idrissa@afrigest360.demo", password: process.env.DEMO_PASSWORD ?? "Demo#Afrigest2026", json: "true" });
const login = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() }, body, redirect: "manual" });
keep(login);
console.log("connexion:", login.status, [...jar.keys()].join(","));

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
await db.connect();
const xacts = async () => Number((await db.query("select xact_commit + xact_rollback n from pg_stat_database where datname = current_database()")).rows[0].n);

const pages = process.argv.slice(2).length ? process.argv.slice(2) : ["/app/dashboard", "/app/sales/factures", "/app/crm/clients", "/app/fleet/vehicules", "/app/finance", "/app/parametres/roles"];
for (const p of pages) {
  const times = [];
  let tx = 0;
  for (let i = 0; i < 3; i++) {
    const before = await xacts();
    const t0 = performance.now();
    const r = await fetch(BASE + p, { headers: { cookie: cookieHeader() }, redirect: "manual" });
    await r.text();
    const ms = Math.round(performance.now() - t0);
    times.push(ms);
    await new Promise((r2) => setTimeout(r2, 300));
    tx = (await xacts()) - before - 1; // -1 : la requête de mesure elle-même
    if (r.status !== 200) { console.log(p, "statut", r.status); break; }
  }
  console.log(`${p.padEnd(26)} rendu ${times.join(" / ")} ms | transactions SQL ≈ ${tx}`);
}
await db.end();
