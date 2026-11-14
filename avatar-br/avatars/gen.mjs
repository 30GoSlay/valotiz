// Génère un roster d'avatars ANIMÉS (feuilles de sprites) pour le jeu, depuis le rasterizer Ruffle/Chromium.
// Pour chaque avatar : une feuille horizontale de frames [idle, down×2, up×2, right×3] (left = right en miroir au jeu),
// toutes alignées sur le même repère (pieds), + un manifeste dans roster.json.
// C'est la SEULE chose gardée de Chapaland : la génération d'avatar depuis une chaîne « ad ».
//
// Usage : LIB=/chemin/new_lib CATALOG=/chemin/items.json RASTER_GPU=off \
//           CHROMIUM_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())") \
//           node avatars/gen.mjs [nombre]
// Variables : LIB (new_lib ou URL, obligatoire), CATALOG (items.json), OUT (défaut ../game/avatars), ZOOM (défaut 2).

import { Raster } from "./lib/raster.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// charge un .env (sans dépendance) : cherché dans le dossier courant puis à la racine du projet.
// Les variables déjà définies (ligne de commande, --env-file) gardent la priorité.
for (const envPath of [path.join(process.cwd(), ".env"), path.join(HERE, "..", ".env")]) {
  if (!fs.existsSync(envPath)) continue;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line[0] === "#") continue;
    const eq = line.indexOf("="); if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");   // enlève guillemets éventuels
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
  break;   // on s'arrête au premier .env trouvé
}
const LIB = process.env.LIB || "";
const CATALOG = process.env.CATALOG || "";
const OUT = process.env.OUT || path.join(HERE, "..", "fps", "avatars");
const ZOOM = Number(process.env.ZOOM) || 2;
const COUNT = Number(process.argv[2]) || 12;
if (!LIB) { console.error("LIB manquant (dossier new_lib ou URL distante)."); process.exit(1); }

// --- catalogue d'items (tenues variées valides) ---
const remote = /^https?:\/\//.test(LIB);
let catalogItems = [];
if (CATALOG && fs.existsSync(CATALOG)) {
  const files = remote ? null : new Set(fs.existsSync(LIB) ? fs.readdirSync(LIB) : []);
  const has = (i) => remote || files.has(i.subType === 1 ? `converted_${i.id}.swf` : `${i.id}.swf`);
  catalogItems = JSON.parse(fs.readFileSync(CATALOG, "utf8")).filter((i) => i.type === 1)
    .map((i) => [i.id, i.name.trim(), i.subType, i.compat, i.rarity, has(i) ? 1 : 0]);
}
const DEFAULT_SHOES = 1586;
const reservedOnly = (it) => it[4] === "RESERVED" && it[2] !== 1 && it[2] !== 13 && it[0] !== DEFAULT_SHOES && it[0] !== 1587;
const avail = catalogItems.filter((i) => i[5]);
const pickOf = (a) => a[Math.floor(Math.random() * a.length)];
function randomAd() {
  if (!avail.length) return "2742;0;0;1586;0;0;0;0;0;0;0;2698;0;0";
  const bases = avail.filter((i) => i[2] === 1);
  let baseId = "2742", compat = 7;
  if (bases.length) { const b = pickOf(bases); baseId = b[0]; compat = b[3]; }
  const ad = Array(14).fill("0"); ad[0] = String(baseId);
  for (const st of [2, 3, 4, 5, 6, 7, 8, 9, 11, 14]) {
    if (Math.random() < 0.4) continue;
    const c = avail.filter((i) => i[2] === st && (i[3] & compat) && !reservedOnly(i));
    if (c.length) ad[st - 1] = String(pickOf(c)[0]);
  }
  if (ad[3] === "0") ad[3] = String(DEFAULT_SHOES);
  return ad.join(";");
}

const raster = new Raster({ lib: LIB, cacheDir: path.join(OUT, ".cache"), concurrency: 3 });
await raster.start();

// Compose une frame (corps + visage) dans le repère ORIGINE (0,0 = ancre aux pieds). Renvoie pixels + bornes.
// NB : le corps contient DÉJÀ la tête (chapeau/cheveux) ; on n'ajoute donc PAS « head_front » (overlay redondant qui
// salissait l'avatar). Le visage (yeux/bouche) n'est posé que de face (pas sur le dos « Up »), via facePos propre à l'anim.
function composeFrame(av, mo, bodyAnim, fi, face) {
  const bf = bodyAnim.frames[fi], fp = bodyAnim.misc.facePos;
  const parts = [[av.png, bf, 0, 0]];
  if (face && fp) parts.push([mo.png, face.frames[0], fp.x, fp.y]);
  const box = parts.map(([, f, ox, oy]) => [Math.round(ox + f.bounds.x), Math.round(oy + f.bounds.y), f.position.w, f.position.h]);
  const x0 = Math.min(...box.map((b) => b[0])), y0 = Math.min(...box.map((b) => b[1]));
  const W = Math.max(...box.map((b) => b[0] + b[2])) - x0, H = Math.max(...box.map((b) => b[1] + b[3])) - y0;
  const px = new PNG({ width: W, height: H });
  parts.forEach(([src, f], i) => {
    const [bx, by, w, h] = box[i];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = ((f.position.y + y) * src.width + f.position.x + x) * 4, di = ((by - y0 + y) * W + bx - x0 + x) * 4;
      const sa = src.data[si + 3] / 255; if (!sa) continue;
      const da = px.data[di + 3] / 255, oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) px.data[di + c] = Math.round((src.data[si + c] * sa + px.data[di + c] * da * (1 - sa)) / oa);
      px.data[di + 3] = Math.round(oa * 255);
    }
  });
  return { px, x0, y0, W, H }; // x0,y0 = coin haut-gauche en coords origine
}

async function sheet(ad) {
  const load = (p) => ({ meta: JSON.parse(fs.readFileSync(p.json, "utf8")), png: PNG.sync.read(fs.readFileSync(p.png)) });
  const av = load((await raster.get(ad, { zoom: ZOOM })).paths);
  const mo = await raster.get(String(ad).split(";")[0], { zoom: ZOOM, mode: "moods" }).then((r) => load(r.paths)).catch(() => null);
  const anim = (s, k) => s?.meta.anims.find((x) => x.key === k && x.frames.length);
  const face = anim(mo, "mood.Normal");
  const idle = anim(av, "Inactive") || anim(av, "Down"); if (!idle) throw new Error("pas de pose");
  const build = [["idle", idle, [0]]];
  for (const k of ["Down", "Up", "Right"]) { const a = anim(av, k); if (a) build.push([k.toLowerCase(), a, a.frames.map((_, i) => i)]); }
  const frames = [];
  const dirs = { idle: 0, down: [], up: [], right: [] };
  for (const [key, a, idxs] of build) for (const i of idxs) { const f = composeFrame(av, mo, a, i, key === "up" ? null : face); const n = frames.length; frames.push(f); if (key === "idle") dirs.idle = n; else dirs[key].push(n); }
  if (!dirs.down.length) dirs.down = [dirs.idle];
  if (!dirs.up.length) dirs.up = dirs.down;
  if (!dirs.right.length) dirs.right = dirs.down;
  // bornes globales (alignement commun sur l'origine)
  const GX0 = Math.min(...frames.map((f) => f.x0)), GY0 = Math.min(...frames.map((f) => f.y0));
  const GX1 = Math.max(...frames.map((f) => f.x0 + f.W)), GY1 = Math.max(...frames.map((f) => f.y0 + f.H));
  const cw = GX1 - GX0, ch = GY1 - GY0, anchorY = Math.round(-GY0), anchorX = Math.round(-GX0);
  if (cw <= 0 || ch <= 0 || cw > 330 || ch > 440 || frames.length > 12) throw new Error("dims " + cw + "x" + ch + " n" + frames.length);
  const sheetW = cw * frames.length, out = new PNG({ width: sheetW, height: ch });
  frames.forEach((f, i) => { PNG.bitblt(f.px, out, 0, 0, f.W, f.H, i * cw + (f.x0 - GX0), f.y0 - GY0); });
  return { buf: PNG.sync.write(out), cw, ch, n: frames.length, anchorX, anchorY, dirs };
}

fs.mkdirSync(OUT, { recursive: true });
const roster = [], seen = new Set();
for (let i = 0; i < COUNT * 3 && roster.length < COUNT; i++) {
  const ad = randomAd(); if (seen.has(ad)) continue; seen.add(ad);
  try {
    const s = await sheet(ad);
    const name = `av${String(roster.length).padStart(2, "0")}`;
    fs.writeFileSync(path.join(OUT, name + ".png"), s.buf);
    roster.push({ name, ad, cw: s.cw, ch: s.ch, n: s.n, anchorX: s.anchorX, anchorY: s.anchorY, dirs: s.dirs });
    fs.writeFileSync(path.join(OUT, "roster.json"), JSON.stringify(roster)); // écrit au fil de l'eau (robuste aux coupures)
    console.log(name, `cell ${s.cw}x${s.ch}`, `${s.n} frames`, (s.buf.length >> 10) + "Ko");
  } catch (e) { console.log("skip:", e.message); }
}
fs.writeFileSync(path.join(OUT, "roster.json"), JSON.stringify(roster));
console.log(`\n${roster.length} avatars animés -> ${OUT}`);
await raster.stop();
process.exit(0);
