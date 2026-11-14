// Post-traitement de l'atlas renvoyé par le rasterizer : frames identiques dédoublonnées, rangement, encodage PNG.
//
// Le rasterizer dessine chaque frame à sa place (une rangée, `pad` px d'écart, retour à la ligne après MAX_ROW).
// Beaucoup de frames sont identiques au pixel près (poses tenues dans Jump, nage, etc.) : on ne garde qu'une copie
// de chacune, et toutes les frames concernées pointent vers le même rectangle. Le format .pf le permet tel quel
// (position = rectangle dans l'atlas), les `bounds` ne changent pas.
//
// Rangement :
//   "row" : une rangée comme le rasterizer (et comme leur atlas). Sans doublon, disposition identique à l'originale.
//   "2d"  : étagères compactes, largeur ≤ MAX_2D (texture acceptée par tous les GPU, y compris mobiles),
//           2 px d'écart (assez pour un filtrage bilinéaire sans débordement entre frames).
import crypto from "node:crypto";

const MAX_ROW = 8000; // même valeur que Rasterizer.MAX_ROW
const MAX_2D = 2048;
const PAD_2D = 2;

/**
 * @param {Buffer} argb  pixels ARGB non prémultipliés (BitmapData.getPixels), W×H
 * @param {object} meta  métadonnées du rasterizer ({ anims: [{ key, frames: [{ position, bounds }], misc }] }), modifiées sur place
 * @param {{ pack?: "row"|"2d", pad?: number }} [opt]  pad = écart utilisé par le rasterizer (rangement "row")
 * @returns {{ rgba: Buffer, w: number, h: number, frames: number, unique: number }}
 */
export function dedupeAtlas(argb, W, H, meta, { pack = "row", pad = 5 } = {}) {
  // 1) Frames uniques, dans l'ordre d'apparition.
  const seen = new Map(); // empreinte -> index dans uniques
  const uniques = []; // [{ src, dst }]
  const refs = []; // [frame, index unique]
  for (const a of meta.anims)
    for (const f of a.frames) {
      const key = hashRect(argb, W, f.position);
      let u = seen.get(key);
      if (u === undefined) {
        u = uniques.length;
        seen.set(key, u);
        uniques.push({ src: f.position, dst: null });
      }
      refs.push([f, u]);
    }

  // 2) Placement.
  const { w: nw, h: nh } = pack === "2d" ? packShelves(uniques) : packRow(uniques, pad);
  for (const [f, u] of refs) f.position = { ...uniques[u].dst };

  // 3) Copie des frames retenues, ARGB -> RGBA au passage.
  const rgba = Buffer.alloc(nw * nh * 4);
  for (const { src, dst } of uniques)
    for (let y = 0; y < src.h; y++) {
      let i = ((src.y + y) * W + src.x) * 4;
      let o = ((dst.y + y) * nw + dst.x) * 4;
      for (let x = 0; x < src.w; x++, i += 4, o += 4) {
        rgba[o] = argb[i + 1];
        rgba[o + 1] = argb[i + 2];
        rgba[o + 2] = argb[i + 3];
        rgba[o + 3] = argb[i];
      }
    }
  return { rgba, w: nw, h: nh, frames: refs.length, unique: uniques.length };
}

// Même algorithme que Rasterizer.pack (y compris la largeur, qui inclut l'écart après la dernière frame).
function packRow(uniques, pad) {
  let cx = 0, cy = 0, rowH = 0, w = 1, h = 1;
  for (const u of uniques) {
    const { w: fw, h: fh } = u.src;
    if (cx > 0 && cx + fw > MAX_ROW) { cx = 0; cy += rowH + pad; rowH = 0; }
    u.dst = { x: cx, y: cy, w: fw, h: fh };
    cx += fw + pad;
    if (fh > rowH) rowH = fh;
    if (cx > w) w = cx;
    if (cy + fh > h) h = cy + fh;
  }
  return { w, h };
}

// Étagères : frames triées par hauteur décroissante, largeur cible ≈ racine de la surface (atlas à peu près carré),
// bornée par la plus large frame et par MAX_2D. Les frames d'avatar ont des hauteurs proches : peu de perte.
function packShelves(uniques) {
  if (!uniques.length) return { w: 1, h: 1 };
  const order = uniques.map((u, i) => i).sort((a, b) => uniques[b].src.h - uniques[a].src.h || uniques[b].src.w - uniques[a].src.w || a - b);
  let area = 0, maxW = 0;
  for (const u of uniques) {
    area += (u.src.w + PAD_2D) * (u.src.h + PAD_2D);
    maxW = Math.max(maxW, u.src.w);
  }
  const target = Math.min(Math.max(maxW, Math.ceil(Math.sqrt(area * 1.1))), Math.max(maxW, MAX_2D));
  let cx = 0, cy = 0, shelfH = 0, w = 1, h = 1;
  for (const i of order) {
    const u = uniques[i], { w: fw, h: fh } = u.src;
    if (cx > 0 && cx + fw > target) { cx = 0; cy += shelfH + PAD_2D; shelfH = 0; }
    u.dst = { x: cx, y: cy, w: fw, h: fh };
    cx += fw + PAD_2D;
    if (fh > shelfH) shelfH = fh;
    if (cx - PAD_2D > w) w = cx - PAD_2D;
    if (cy + fh > h) h = cy + fh;
  }
  return { w, h };
}

function hashRect(buf, W, r) {
  const h = crypto.createHash("sha1");
  h.update(`${r.w}x${r.h}:`);
  const row = r.w * 4;
  for (let y = 0; y < r.h; y++) {
    const s = ((r.y + y) * W + r.x) * 4;
    h.update(buf.subarray(s, s + row));
  }
  return h.digest("base64");
}

// --- Encodage PNG : sharp (libvips, natif) si installé, sinon pngjs. Sans perte dans les deux cas. ---
let sharp;
try { sharp = (await import("sharp")).default; } catch { sharp = null; }
const { PNG } = await import("pngjs");

export const pngEncoder = sharp ? "sharp" : "pngjs";

/** RGBA non prémultiplié -> PNG. */
export async function encodePng(rgba, w, h) {
  if (sharp)
    return sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
      // Mesuré sur des atlas réels : niveau 6 sans filtrage adaptatif = 7× plus rapide que pngjs et 3× plus petit.
      // (niveau 9 : -2 % de taille pour 5× le temps ; le filtrage adaptatif grossit ces atlas très transparents.)
      .png({ compressionLevel: 6, adaptiveFiltering: false })
      .toBuffer();
  const png = new PNG({ width: w, height: h });
  rgba.copy(png.data);
  return PNG.sync.write(png);
}
