/**
 * Génère les fichiers de marque Global Gest à partir de l'image source (assets/brand/global-gest-logo-source.webp : logo vert sur
 * fond marine quadrillé) :
 *  - public/brand/global-gest-mark.png     : le « G » seul, vert, fond transparent (barre latérale, icônes de l'application)
 *  - public/brand/global-gest-wordmark.png : le nom « Global Gest », BLANC sur fond transparent. Il sert de MASQUE CSS (couleur du
 *                                            texte courant) : il prend donc la couleur du thème, clair ou sombre, sans second fichier
 *  - public/brand/og-global-gest.jpg       : image d'aperçu au partage (1200 × 630)
 *  - src/lib/brand-mark-data.ts            : le « G » en data URI (icônes générées par ImageResponse, hors navigateur)
 *
 * Le fond est retiré par seuillage sur la couleur (le logo est d'un vert vif, le fond d'un marine très sombre, le quadrillage d'un
 * vert-bleu terne) : l'alpha est la « quantité de vert » de chaque pixel, calculée seulement près du logo, jamais sur le quadrillage.
 * Le « G » est ensuite agrandi puis ses bords raffermis, pour rester net à 512 px alors que la source ne fait que 221 px de côté.
 * Usage : node scripts/make-brand-assets.mjs
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "assets/brand/global-gest-logo-source.webp");
const OUT = path.join(root, "public/brand");
fs.mkdirSync(OUT, { recursive: true });

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const R = (x, y) => data[(y * W + x) * 3], G = (x, y) => data[(y * W + x) * 3 + 1], B = (x, y) => data[(y * W + x) * 3 + 2];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ── 1) le « G » : pixels d'un vert vif = cœur du logo (à gauche du nom)
const isCore = (x, y) => { const g = G(x, y), r = R(x, y); return g > 170 && r < 90 && B(x, y) > 100 && g - r > 100; };
let x0 = W, x1 = 0, y0 = H, y1 = 0;
const coreG = [];
for (let y = 0; y < H; y++) for (let x = 0; x < Math.round(W * 0.34); x++) {
  if (!isCore(x, y)) continue;
  x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); coreG.push([R(x, y), G(x, y), B(x, y)]);
}
const med = (i) => coreG.map((c) => c[i]).sort((a, b) => a - b)[Math.floor(coreG.length / 2)];
const GREEN = [med(0), med(1), med(2)];
const BG_G = 16; // niveau de vert du fond marine
console.log("Cœur du logo :", x1 - x0 + 1, "×", y1 - y0 + 1, "px, vert", "#" + GREEN.map((v) => v.toString(16).padStart(2, "0")).join(""));

const PAD = 12;
const side = Math.max(x1 - x0, y1 - y0) + 1 + 2 * PAD;
const left = Math.round((x0 + x1) / 2 - side / 2), top = Math.round((y0 + y1) / 2 - side / 2);
// zone d'influence : à 3 px au plus du cœur (le quadrillage, plus loin, n'est jamais pris)
const near = new Uint8Array(side * side);
for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
  const X = left + x, Y = top + y;
  for (let dy = -3; dy <= 3 && !near[y * side + x]; dy++) for (let dx = -3; dx <= 3; dx++) {
    const xx = X + dx, yy = Y + dy;
    if (xx >= 0 && yy >= 0 && xx < W && yy < H && isCore(xx, yy)) { near[y * side + x] = 1; break; }
  }
}
const alpha = Buffer.alloc(side * side);
for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
  if (!near[y * side + x]) continue;
  alpha[y * side + x] = Math.round(255 * clamp01((G(left + x, top + y) - BG_G) / (GREEN[1] - BG_G)));
}

// ── 2) netteté : agrandissement ×4 (lanczos) puis raffermissement des bords (courbe de contraste), puis réduction à 512 px
const BIG = side * 4;
const { data: bigA, info: bigInfo } = await sharp(alpha, { raw: { width: side, height: side, channels: 1 } }).resize(BIG, BIG, { kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
const stride = bigInfo.channels; // sharp peut renvoyer plusieurs canaux par pixel : on lit le premier
const rgba = Buffer.alloc(BIG * BIG * 4);
for (let i = 0; i < BIG * BIG; i++) {
  const a = clamp01(((bigA[i * stride] / 255 - 0.5) * 2.4) + 0.5); // bord ≈ 1 px à l'échelle ×4
  rgba[i * 4] = GREEN[0]; rgba[i * 4 + 1] = GREEN[1]; rgba[i * 4 + 2] = GREEN[2]; rgba[i * 4 + 3] = Math.round(a * 255);
}
const PNG = { palette: true, quality: 95, effort: 10, colours: 64, compressionLevel: 9 }; // aplat : très peu de couleurs, fichier léger
const markPng = await sharp(rgba, { raw: { width: BIG, height: BIG, channels: 4 } }).resize(512, 512, { kernel: "lanczos3" }).png(PNG).toBuffer();
fs.writeFileSync(path.join(OUT, "global-gest-mark.png"), markPng);

// ── 3) le nom : blanc, alpha = « blancheur » (canal minimum : le quadrillage vert-bleu, sans rouge, reste à 0)
const tx0 = x1 + Math.round((x1 - x0) * 0.1); // juste à droite du « G »
let wx0 = W, wx1 = 0, wy0 = H, wy1 = 0;
for (let y = 0; y < H; y++) for (let x = tx0; x < W; x++) {
  if (R(x, y) > 200 && G(x, y) > 200 && B(x, y) > 200) { wx0 = Math.min(wx0, x); wx1 = Math.max(wx1, x); wy0 = Math.min(wy0, y); wy1 = Math.max(wy1, y); }
}
const wp = 6, ww = wx1 - wx0 + 1 + 2 * wp, wh = wy1 - wy0 + 1 + 2 * wp;
const word = Buffer.alloc(ww * wh * 4);
for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
  const X = wx0 - wp + x, Y = wy0 - wp + y;
  const m = Math.min(R(X, Y), G(X, Y), B(X, Y));
  const a = clamp01((m - 30) / 215);
  const o = (y * ww + x) * 4;
  word[o] = 255; word[o + 1] = 255; word[o + 2] = 255; word[o + 3] = Math.round(a * 255);
}
const wordPng = await sharp(word, { raw: { width: ww, height: wh, channels: 4 } }).png({ compressionLevel: 9, effort: 10 }).toBuffer();
fs.writeFileSync(path.join(OUT, "global-gest-wordmark.png"), wordPng);
console.log("Nom :", ww, "×", wh, "px (rapport", (ww / wh).toFixed(3) + ")");

// ── 4) image d'aperçu au partage : la bannière recadrée au format 1200 × 630 (logo au centre)
await sharp(SRC).resize(1200, 630, { fit: "cover", position: "centre" }).jpeg({ quality: 88, mozjpeg: true }).toFile(path.join(OUT, "og-global-gest.jpg"));

// ── 5) data URI du « G » pour les icônes générées côté serveur (ImageResponse)
const dataUri = "data:image/png;base64," + markPng.toString("base64");
fs.writeFileSync(
  path.join(root, "src/lib/brand-mark-data.ts"),
  `// Généré par scripts/make-brand-assets.mjs : ne pas modifier à la main.\n/** Le « G » de Global Gest (PNG 512 px, fond transparent) en data URI. */\nexport const BRAND_MARK_DATA_URI = "${dataUri}";\n`,
);
console.log("Fichiers écrits dans public/brand/ et src/lib/brand-mark-data.ts");
