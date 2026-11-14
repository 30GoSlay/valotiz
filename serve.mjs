// Mini serveur statique local : sert tout le projet sur http://localhost:8090
// (ouvrir les index.html en file:// ne marche pas : les jeux chargent avatars/roster.json via fetch).
//   /        → menu (Battle Royale / FPS)
//   /game/   → Battle Royale
//   /fps/    → FPS tactique
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8090;
const NO_EDITOR = !!process.env.NO_EDITOR;   // sur le VPS public : NO_EDITOR=1 → l'éditeur n'est pas servi
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css" };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  if (NO_EDITOR && /(^|\/)editor\.html$/.test(p)) { res.writeHead(404); return res.end("404"); }   // éditeur masqué sur le VPS
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Avatar Games → http://localhost:${PORT}  (/game = Battle Royale, /fps = FPS)`));
