// Harness : Ruffle dans Chromium headless exécute rasterizer.swf, récupère l'atlas ARGB + les métadonnées,
// écrit PNG / JSON / .pf. Un seul navigateur, une page par rendu, file d'attente avec concurrence limitée.
import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { toPf } from "./pf.mjs";
import { dedupeAtlas, encodePng } from "./atlas.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");
const RUFFLE = path.dirname(require.resolve("@ruffle-rs/ruffle/package.json"));
const MIME = { ".js": "text/javascript", ".wasm": "application/wasm", ".swf": "application/x-shockwave-flash", ".html": "text/html", ".map": "application/json" };

export class Raster {
  /**
   * @param {object} o
   * @param {string} o.lib       dossier local OU URL http(s) du new_lib (ex. http://01static.chapatiz.com/fr/swf/new_lib/)
   * @param {string} o.cacheDir  cache disque (SWF téléchargés + rendus)
   * @param {number} [o.concurrency=2]
   * @param {"2d"|"row"} [o.pack]  rangement de l'atlas (lib/atlas.mjs) : "2d" compact ≤ 2048 px de large (défaut),
   *                               "row" une rangée comme le rasterizer d'origine. Défaut : RASTER_PACK ou "2d".
   */
  constructor({ lib, cacheDir = ".cache", concurrency = 2, timeoutMs = 30000, pack = process.env.RASTER_PACK || "2d" }) {
    this.pack = pack === "row" ? "row" : "2d";
    this.lib = lib;
    this.remote = /^https?:\/\//.test(lib);
    this.cacheDir = cacheDir;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
    this.active = 0;
    this.queue = [];
    this.inflight = new Map();
    // Recyclage des lecteurs : le rasterizer.swf garde en mémoire Flash chaque SWF d'item rendu (jamais libéré),
    // donc la RAM de Chromium monte lentement avec le temps. Au bout de maxRenders rendus, on ferme la page (tout
    // le tas Flash est libéré) et on rouvre un lecteur neuf à chaud. 0 = jamais (ancien comportement).
    this.maxRenders = process.env.RASTER_MAX_RENDERS != null ? Number(process.env.RASTER_MAX_RENDERS) : 500;
  }

  async start() {
    await fs.mkdir(path.join(this.cacheDir, "lib"), { recursive: true });
    await fs.mkdir(path.join(this.cacheDir, "out"), { recursive: true });
    this.http = http.createServer((q, r) => this.#serve(q, r).catch((e) => { r.writeHead(500); r.end(String(e)); }));
    await new Promise((res) => this.http.listen(0, "127.0.0.1", res));
    this.base = `http://127.0.0.1:${this.http.address().port}`;
    await this.#launch();
    return this;
  }

  // RASTER_GPU=auto (défaut) : essaie le vrai GPU, repli sur SwiftShader (GPU logiciel) si WebGL est absent.
  // RASTER_GPU=off : SwiftShader directement. RASTER_HEADFUL=1 : fenêtre visible (GPU garanti, mais une fenêtre s'ouvre).
  async #launch() {
    const mode = process.env.RASTER_GPU || "auto";
    const headless = !process.env.RASTER_HEADFUL;
    const soft = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
    const hard = ["--ignore-gpu-blocklist", "--enable-gpu", "--enable-unsafe-webgpu"];
    if (mode !== "off") {
      this.browser = await chromium.launch({ headless, args: hard, executablePath: process.env.CHROMIUM_PATH || undefined });
      this.gpu = await this.#probe();
      if (this.gpu && !/swiftshader|llvmpipe|software/i.test(this.gpu)) return;
      await this.browser.close();
    }
    this.browser = await chromium.launch({ headless, args: soft, executablePath: process.env.CHROMIUM_PATH || undefined });
    this.gpu = (await this.#probe()) || "aucun WebGL";
  }

  async #probe() {
    const page = await this.browser.newPage();
    try {
      return await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
        if (!gl) return null;
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      });
    } catch { return null; } finally { await page.close(); }
  }

  async stop() {
    await this.browser?.close();
    this.http?.close();
  }

  async #serve(req, res) {
    const u = new URL(req.url, this.base);
    let file;
    if (u.pathname.startsWith("/ruffle/")) file = path.join(RUFFLE, path.basename(u.pathname));
    else if (u.pathname.startsWith("/lib/")) file = await this.#libFile(path.basename(u.pathname));
    else file = path.join(PUBLIC, path.basename(u.pathname) || "page.html");
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  }

  // SWF d'items : lus en local, ou téléchargés une fois puis gardés en cache disque.
  async #libFile(name) {
    if (!/^[\w.-]+\.swf$/.test(name)) throw new Error("bad name");
    if (!this.remote) return path.join(this.lib, name);
    const local = path.join(this.cacheDir, "lib", name);
    try { await fs.access(local); return local; } catch {}
    const r = await fetch(new URL(name, this.lib.endsWith("/") ? this.lib : this.lib + "/"));
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    await fs.writeFile(local, Buffer.from(await r.arrayBuffer()));
    return local;
  }

  /**
   * Forme canonique d'un ad, pour que deux tenues qui donnent le même rendu partagent la même entrée de cache :
   * 14 champs, valeurs non numériques ou "00" -> "0", index 11 (ignoré par le rasterizer) -> "0",
   * items dont le SWF est absent de la lib locale -> "0" (le rasterizer les ignore de toute façon).
   * La base (index 0) et la teinte (index 12) ne sont jamais retirées.
   */
  normalizeAd(ad) {
    const a = String(ad).split(";").slice(0, 14).map((v) => v.trim());
    while (a.length < 14) a.push("0");
    return a
      .map((v, i) => {
        if (!/^\d+$/.test(v) || /^0+$/.test(v)) return i === 0 ? v : "0";
        if (i === 11) return "0";
        if (i > 0 && i !== 12 && !this.remote && !fsSync.existsSync(path.join(this.lib, v + ".swf"))) return "0";
        return v;
      })
      .join(";");
  }

  /** Le rendu est-il déjà en cache (sans rien lancer) ? */
  isCached(ad, { zoom = 1, mode = "avatar" } = {}) {
    ad = mode === "avatar" ? this.normalizeAd(ad) : String(ad).split(";")[0].trim();
    return fsSync.existsSync(path.join(this.cacheDir, "out", Raster.key(ad, zoom, mode, "", this.pack) + ".pf"));
  }

  static key(ad, zoom, mode, anims = "", pack = "row") {
    // "row" garde les clés d'avant : les rendus déjà en cache restent utilisables dans ce mode.
    // Aperçus de la penderie (anims) : préfixe « p- », pour que le nettoyage du cache les reconnaisse (jetables).
    const h = crypto.createHash("sha1").update(`${mode}|${zoom}|${ad}${anims ? "|" + anims : ""}${pack === "row" ? "" : "|" + pack}`).digest("hex");
    return anims ? "p-" + h : h;
  }
  /** Clés de cache d'un rendu complet (avatar ou humeurs) aux zooms donnés, pour les protéger du nettoyage. */
  keysOf(ad, { mode = "avatar", zooms = [1, 2] } = {}) {
    ad = mode === "avatar" ? this.normalizeAd(ad) : String(ad).split(";")[0].trim();
    return zooms.map((z) => Raster.key(ad, z, mode, "", this.pack));
  }

  // Rendu servi depuis le cache : la date du .pf est remise à maintenant (au plus une fois par heure et par rendu),
  // le nettoyage garde ainsi ce qui sert encore, même après un redémarrage.
  #touched = new Map();
  touch(key, file) {
    const t = Date.now();
    if (t - (this.#touched.get(key) || 0) < 3600000) return;
    this.#touched.set(key, t);
    if (this.#touched.size > 50000) this.#touched.clear();
    fs.utimes(file, t / 1000, t / 1000).catch(() => {});
  }

  /**
   * Nettoyage du cache de rendus (.cache/out). Un rendu = <clé>.png + .json + .pf, traités ensemble ; aussi les
   * icon-*.png et still-*.png. Sa date = la plus récente de ses fichiers (le .pf est « touché » à chaque usage).
   * Jamais supprimés : `protect` (clés : tenues des comptes, des joueurs connectés, des bots, humeurs…) et les rendus
   * en cours. Supprimés : aperçus de la penderie (p-…) plus vieux que previewMs, le reste plus vieux que ttlMs, puis,
   * si le cache dépasse maxBytes, les plus anciens d'abord (pas ceux utilisés depuis moins d'une heure).
   * Le .pf part en premier : c'est lui qui dit « en cache », un rendu à moitié effacé est donc refait.
   */
  async gc({ maxBytes = 2000 * 2 ** 20, ttlMs = 14 * 86400000, previewMs = 86400000, protect = new Set() } = {}) {
    const dir = path.join(this.cacheDir, "out"), t = Date.now();
    const groups = new Map();
    for (const name of await fs.readdir(dir)) {
      const k = name.replace(/\.(png|json|pf|tmp)$/, "");
      let st; try { st = await fs.stat(path.join(dir, name)); } catch { continue; }
      if (!st.isFile()) continue;
      const g = groups.get(k) || { k, files: [], size: 0, at: 0 };
      g.files.push(name); g.size += st.size; g.at = Math.max(g.at, st.mtimeMs);
      groups.set(k, g);
    }
    let total = 0;
    for (const g of groups.values()) total += g.size;
    const before = { n: groups.size, bytes: total };
    const keep = (g) => protect.has(g.k) || this.inflight.has(g.k);
    let removed = 0, freed = 0;
    const drop = async (g) => {
      g.files.sort((a, b) => b.endsWith(".pf") - a.endsWith(".pf"));
      for (const f of g.files) { try { await fs.unlink(path.join(dir, f)); } catch { return; } } // fichier ouvert (Windows) : on réessaiera
      removed++; freed += g.size; total -= g.size; groups.delete(g.k);
    };
    for (const g of [...groups.values()]) {
      if (keep(g)) continue;
      const age = t - g.at;
      if (age > (g.k.startsWith("p-") ? previewMs : ttlMs)) await drop(g);
    }
    if (total > maxBytes) {
      const old = [...groups.values()].filter((g) => !keep(g) && t - g.at > 3600000).sort((a, b) => a.at - b.at);
      for (const g of old) { if (total <= maxBytes) break; await drop(g); }
    }
    return { before, removed, freed, after: { n: groups.size, bytes: total } };
  }

  /** Rendu avec cache disque + dédoublonnage des requêtes identiques en cours. */
  // anims : sous-ensemble d'animations ("Right" ou "Inactive,Sit") pour un aperçu rapide.
  // Priorité : high (l'avatar du joueur lui-même) > normale > low (icônes, humeurs, atlas en arrière-plan).
  // cachedOnly : ne rend rien, répond seulement si le rendu est déjà en cache (erreur code NOT_CACHED sinon).
  async get(ad, { zoom = 1, mode = "avatar", low = false, high = false, anims = "", cachedOnly = false } = {}) {
    const prio = high ? 0 : low ? 2 : 1;
    ad = mode === "avatar" ? this.normalizeAd(ad) : String(ad).split(";")[0].trim();
    anims = mode === "avatar" && anims ? String(anims).split(",").filter((a) => /^\w+$/.test(a)).sort().join(",") : "";
    const key = Raster.key(ad, zoom, mode, anims, this.pack);
    const dir = path.join(this.cacheDir, "out");
    const paths = { png: path.join(dir, key + ".png"), json: path.join(dir, key + ".json"), pf: path.join(dir, key + ".pf") };
    try { await fs.access(paths.pf); this.touch(key, paths.pf); return { key, paths, cached: true }; } catch {}
    if (cachedOnly) throw Object.assign(new Error("pas en cache"), { code: "NOT_CACHED" });
    if (!this.inflight.has(key)) {
      const p = this.#enqueue(key, () => this.#render(ad, zoom, mode, paths, anims), prio).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    } else this.#promote(key, prio); // déjà en file : une demande plus urgente la fait remonter
    await this.inflight.get(key);
    return { key, paths, cached: false };
  }

  // File triée par priorité (0, 1, 2), dans l'ordre d'arrivée à priorité égale.
  #enqueue(key, job, prio = 1) {
    return new Promise((resolve, reject) => {
      this.#insert({ key, job, resolve, reject, prio, low: prio === 2 });
      this.#pump();
    });
  }
  #insert(entry) {
    const i = this.queue.findIndex((q) => q.prio > entry.prio);
    i < 0 ? this.queue.push(entry) : this.queue.splice(i, 0, entry);
  }
  #promote(key, prio) {
    const i = this.queue.findIndex((q) => q.key === key);
    if (i < 0 || this.queue[i].prio <= prio) return;
    const [entry] = this.queue.splice(i, 1);
    entry.prio = prio; entry.low = prio === 2;
    this.#insert(entry);
  }
  /** Rendus en attente / en cours (pour les logs et l'état du serveur). */
  get load() { return { queued: this.queue.length, active: this.active, players: this.concurrency }; }

  // Lecteurs réservés, pour qu'un rendu urgent n'attende jamais derrière un rendu long qu'on ne peut pas interrompre
  // (un atlas d'humeurs = ~300 frames) :
  //   - à partir de 3 lecteurs, un lecteur est gardé pour la priorité haute (avatar nu affiché en attendant la tenue) ;
  //   - les tâches basses (icônes, humeurs, atlas en arrière-plan) n'occupent jamais plus de max(1, lecteurs - 2).
  active = 0;
  activeLow = 0;
  activeHigh = 0;
  #pump() {
    const C = this.concurrency;
    const capNotHigh = C >= 3 ? C - 1 : C, capLow = Math.max(1, C - 2);
    while (this.active < C && this.queue.length) {
      const notHigh = this.active - this.activeHigh;
      // la file est triée : on prend la première tâche dont la classe a encore de la place
      const i = this.queue.findIndex((q) => q.prio === 0 || (notHigh < capNotHigh && (q.prio === 1 || this.activeLow < capLow)));
      if (i < 0) return;
      const { job, resolve, reject, prio } = this.queue.splice(i, 1)[0];
      this.active++;
      if (prio === 0) this.activeHigh++;
      if (prio === 2) this.activeLow++;
      job().then(resolve, reject).finally(() => {
        this.active--;
        if (prio === 0) this.activeHigh--;
        if (prio === 2) this.activeLow--;
        this.#pump();
      });
    }
  }

  // Lecteurs gardés ouverts : une page par niveau de concurrence, Ruffle + rasterizer.swf déjà chargés,
  // SWF d'items gardés en mémoire côté Flash. Une page en erreur est jetée et recréée.
  #idle = [];

  async #openPlayer() {
    const page = await this.browser.newPage();
    const logs = [];
    page.on("console", (m) => { logs.push(m.text()); if (logs.length > 50) logs.shift(); });
    await page.goto(this.base + "/page.html");
    await page.evaluate((t) => window.boot(t), this.timeoutMs);
    return { page, logs, renders: 0 };
  }

  async #player() {
    return this.#idle.pop() || this.#openPlayer();
  }

  async #render(ad, zoom, mode, paths, anims = "") {
    const pl = await this.#player();
    let ok = false;
    try {
      const T0 = Date.now();
      const out = await pl.page.evaluate(
        ([params, t]) => window.renderAvatar(params, t),
        [{ ad, lib: "/lib/", zoom: String(zoom), mode, anims }, this.timeoutMs],
      );
      const T1 = Date.now();
      const meta = JSON.parse(out.meta);
      const bytes = Buffer.from(out.b64, "base64");
      // "png" : déjà encodé par le lecteur ; "argb" : repli, pixels bruts à convertir.
      let png = bytes, info = "";
      if (out.format !== "png") {
        const argb = out.format === "argb-zlib" ? zlib.inflateSync(bytes) : bytes;
        // Frames identiques dédoublonnées (meta.anims[].frames[].position mis à jour), puis PNG sans perte.
        const d = dedupeAtlas(argb, out.w, out.h, meta, { pack: this.pack });
        png = await encodePng(d.rgba, d.w, d.h);
        info = `${out.w}x${out.h} -> ${d.w}x${d.h}, ${d.unique}/${d.frames} frames uniques`;
      }
      await fs.writeFile(paths.png, png);
      if (process.env.RASTER_DEBUG) console.log(`[raster] flash ${T1 - T0} ms, png ${Date.now() - T1} ms (${png.length >> 10} Ko), ${info}`, JSON.stringify(meta.timings));
      await fs.writeFile(paths.json, JSON.stringify(meta, null, 1));
      await fs.writeFile(paths.pf, toPf(meta));
      ok = true;
      return meta;
    } catch (e) {
      // Erreur rapportée par le rasterizer (SWF absent…) : le lecteur reste sain, on le garde.
      if (!/timeout|closed|crash|detached/i.test(e.message)) ok = true;
      e.message += pl.logs.length ? `\n--- ruffle console ---\n${pl.logs.slice(-20).join("\n")}` : "";
      throw e;
    } finally {
      if (!ok) pl.page.close().catch(() => {});
      else if (this.maxRenders > 0 && ++pl.renders >= this.maxRenders) {
        // lecteur arrivé à son quota : on le ferme (libère le tas Flash) et on rouvre un remplaçant à chaud
        pl.page.close().catch(() => {});
        this.#openPlayer().then((np) => this.#idle.push(np)).catch(() => {});
      } else this.#idle.push(pl);
    }
  }

  /** Ouvre les lecteurs à l'avance (évite l'attente au premier rendu). */
  async warm() {
    const n = this.concurrency - this.#idle.length;
    const pls = await Promise.all(Array.from({ length: Math.max(0, n) }, () => this.#openPlayer()));
    this.#idle.push(...pls);
  }
}
