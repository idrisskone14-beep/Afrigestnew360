/**
 * Génère les fichiers de marque KAKO Gestion à partir du logo source (assets/brand/kako-logo-source.jpg) :
 *  - public/brand/kako-mark.png : le « K » seul, fond transparent (barre latérale, icônes de l'application)
 *  - public/brand/kako-logo.png : logo complet (« K » + nom), fond transparent
 * Le fond blanc est retiré par remplissage depuis les bords (le blanc intérieur du « K » est conservé), puis le liseré
 * anti-crénelage est « dématté » pour ne pas laisser de halo blanc sur fond sombre.
 * Usage : node scripts/make-brand-assets.mjs
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "assets/brand/kako-logo-source.jpg");
const OUT = path.join(root, "public/brand");
const BG_MIN = 236; // un pixel dont tous les canaux dépassent ce seuil est du fond
const EDGE_MIN = 170; // en dessous, le pixel est franchement coloré : alpha = 1

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const minCh = (i) => Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);

// 1) fond = pixels clairs reliés aux bords de l'image
const bg = new Uint8Array(W * H);
const stack = [];
const push = (x, y) => { const i = y * W + x; if (!bg[i] && minCh(i) >= BG_MIN) { bg[i] = 1; stack.push(i); } };
for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
while (stack.length) {
  const i = stack.pop(), x = i % W, y = (i - x) / W;
  if (x > 0) push(x - 1, y); if (x < W - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < H - 1) push(x, y + 1);
}

// 2) alpha : 0 sur le fond, rampe sur le liseré (2 px autour du fond), 1 ailleurs ; couleur dématée
const rgba = Buffer.alloc(W * H * 4);
const nearBg = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && bg[yy * W + xx]) return true; } return false; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, o = i * 4;
  let a = 1;
  if (bg[i]) a = 0;
  else if (nearBg(x, y, 2)) { const m = minCh(i); a = m <= EDGE_MIN ? 1 : Math.max(0, Math.min(1, (255 - m) / (255 - EDGE_MIN))); }
  for (let c = 0; c < 3; c++) {
    const v = data[i * 3 + c];
    rgba[o + c] = a > 0 && a < 1 ? Math.max(0, Math.min(255, Math.round((v - 255 * (1 - a)) / a))) : v;
  }
  rgba[o + 3] = Math.round(a * 255);
}

// 3) le « K » : tout ce qui se trouve au-dessus du nom (le nom commence vers y = 860)
const NAME_TOP = 860;
let x0 = W, x1 = 0, y0 = H, y1 = 0;
for (let y = 0; y < NAME_TOP; y++) for (let x = 0; x < W; x++) if (rgba[(y * W + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
const pad = 8, side = Math.max(x1 - x0, y1 - y0) + 2 * pad;
const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
const left = Math.max(0, cx - Math.round(side / 2)), top = Math.max(0, cy - Math.round(side / 2));
const full = sharp(rgba, { raw: { width: W, height: H, channels: 4 } });

const PNG = { palette: true, quality: 90, effort: 10, colours: 256, compressionLevel: 9 }; // dégradés fidèles, fichier léger
const markPng = await full.clone().extract({ left, top, width: Math.min(side, W - left), height: Math.min(side, H - top) }).resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png(PNG).toBuffer();
fs.writeFileSync(path.join(OUT, "kako-mark.png"), markPng);
await full.clone().trim({ threshold: 1 }).resize({ width: 900 }).png(PNG).toFile(path.join(OUT, "kako-logo.png"));
// Le « K » est aussi embarqué en base64 : les icônes générées (favicon, PWA) n'ont pas à relire public/ au moment de la requête.
fs.writeFileSync(
  path.join(root, "src/lib/brand-mark-data.ts"),
  `// Généré par scripts/make-brand-assets.mjs : ne pas modifier à la main.\n/** Le « K » de KAKO Gestion (PNG 512 px, fond transparent) en data URI. */\nexport const BRAND_MARK_DATA_URI = "data:image/png;base64,${markPng.toString("base64")}";\n`,
);
console.log("Marque générée :", { mark: [left, top, side], bbox: [x0, y0, x1, y1] });
