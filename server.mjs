// Serveur multijoueur WebSocket pour VALOTIZ — ZÉRO dépendance (handshake + trames RFC6455 à la main).
//   node server.mjs            → écoute ws://0.0.0.0:8091
// Rôle : matchmaking 5v5 (+ codes de salon), lobby, élection d'un « hôte » (son client simule bots + manches),
// RELAIS des messages entre joueurs, et PERSISTANCE (stats + ELO) dans data.json (zéro dépendance).
// L'hôte fait autorité sur bots/manches ; à la fin du match il envoie un « result » → le serveur met à jour ELO/stats.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.WS_PORT) || 8091;
const TEAM_SIZE = 5;                 // 5v5
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// ---- persistance (data.json) : stats + ELO par joueur (clé = pid du navigateur) ----
const DB_FILE = process.env.DB_FILE || fileURLToPath(new URL("./data.json", import.meta.url));
let DB = { players: {} };
try { DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); DB.players = DB.players || {}; } catch { DB = { players: {} }; }
let saveT = null;
function save() { if (saveT) return; saveT = setTimeout(() => { saveT = null; try { fs.writeFileSync(DB_FILE, JSON.stringify(DB)); } catch (e) { console.error("save data.json:", e.message); } }, 500); }
function player(pid, name) {
  let p = DB.players[pid];
  if (!p) p = DB.players[pid] = { name: name || "Joueur", elo: 1000, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0, games: 0 };
  if (name) p.name = String(name).slice(0, 14);
  return p;
}

// ---- trames WebSocket ----
function accept(key) { return crypto.createHash("sha1").update(key + GUID).digest("base64"); }
function encode(str) {                // trame texte serveur→client (non masquée)
  const data = Buffer.from(str, "utf8"); const len = data.length;
  let header;
  if (len < 126) { header = Buffer.from([0x81, len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, data]);
}
function decode(buf) {                 // → { frames:[{opcode,payload}], rest:Buffer } (client→server, masqués)
  const frames = []; let off = 0;
  while (off + 2 <= buf.length) {
    const b1 = buf[off + 1], opcode = buf[off] & 0x0f, masked = b1 & 0x80; let len = b1 & 0x7f; let p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    let mask = null; if (masked) { if (p + 4 > buf.length) break; mask = buf.slice(p, p + 4); p += 4; }
    if (p + len > buf.length) break;
    const payload = Buffer.from(buf.slice(p, p + len)); if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    frames.push({ opcode, payload }); off = p + len;
  }
  return { frames, rest: buf.slice(off) };
}

// ---- état des parties ----
let nextId = 1;
const clients = new Map();            // id -> { id, sock, name, team, avatar, pid, roomId }
let rooms = new Map();                // roomId -> { id, memberIds:[], started:bool, hostId, code }
let nextRoom = 1;

const send = (c, obj) => { try { c.sock.write(encode(JSON.stringify(obj))); } catch {} };
const roomMembers = (room) => room.memberIds.map((id) => clients.get(id)).filter(Boolean);
function roomPublic(room) {
  return roomMembers(room).map((c) => ({ id: c.id, name: c.name, team: c.team, avatar: c.avatar, host: c.id === room.hostId, elo: c.pid ? player(c.pid).elo : 1000 }));
}
function broadcast(room, obj, exceptId) { for (const c of roomMembers(room)) if (c.id !== exceptId) send(c, obj); }
function pushRoom(room) { for (const c of roomMembers(room)) send(c, { t: "room", you: c.id, players: roomPublic(room), size: TEAM_SIZE, code: room.code || null }); }

function findRoom(code) {               // salon par code, sinon matchmaking ouvert ; crée si besoin
  for (const room of rooms.values()) {
    if (room.started) continue;
    if (code) { if (room.code === code && room.memberIds.length < TEAM_SIZE * 2) return room; }
    else if (!room.code && room.memberIds.length < TEAM_SIZE * 2) return room;
  }
  const room = { id: nextRoom++, memberIds: [], started: false, hostId: null, code: code || null }; rooms.set(room.id, room); return room;
}
function assignTeam(room) { let att = 0, def = 0; for (const c of roomMembers(room)) (c.team === "att" ? att++ : def++); return att <= def ? "att" : "def"; }
function joinRoom(c, name, avatar, pid, code) {
  const room = findRoom(code && String(code).slice(0, 12).toUpperCase());
  c.name = (name || ("Joueur" + c.id)).slice(0, 14); c.avatar = avatar | 0; c.pid = (pid && String(pid).slice(0, 40)) || null; c.roomId = room.id;
  c.team = assignTeam(room); room.memberIds.push(c.id);
  if (!room.hostId) room.hostId = c.id;  // 1er arrivé = hôte
  if (c.pid) { const p = player(c.pid, c.name); send(c, { t: "me", elo: p.elo, wins: p.wins, losses: p.losses, kills: p.kills, deaths: p.deaths }); }
  pushRoom(room);
}
function leaveRoom(c) {
  const room = rooms.get(c.roomId); if (!room) return;
  room.memberIds = room.memberIds.filter((id) => id !== c.id);
  if (room.hostId === c.id) room.hostId = room.memberIds[0] || null;  // réélire un hôte
  broadcast(room, { t: "left", id: c.id });
  if (!room.memberIds.length) rooms.delete(room.id); else pushRoom(room);
}
function startRoom(room) {
  if (room.started) return; room.started = true;
  const players = roomPublic(room);
  const botsAtt = TEAM_SIZE - players.filter((p) => p.team === "att").length;
  const botsDef = TEAM_SIZE - players.filter((p) => p.team === "def").length;
  const seed = (Math.random() * 1e9) | 0;
  for (const c of roomMembers(room)) send(c, { t: "start", seed, players, hostId: room.hostId, botsAtt, botsDef });
}

// ---- fin de match : l'hôte envoie le résultat → stats + ELO ----
function applyResult(room, m) {
  const members = roomMembers(room);
  const winTeam = m.winTeam === "def" ? "def" : "att";
  const stats = m.stats || {};
  // stats brutes pour tous les humains de la partie (pid connu côté serveur)
  for (const c of members) {
    if (!c.pid) continue;
    const s = stats[c.id] || {}; const p = player(c.pid, c.name);
    p.kills += s.k | 0; p.deaths += s.d | 0; p.assists += s.a | 0; p.games++;
    (c.team === winTeam) ? p.wins++ : p.losses++;
  }
  // ELO uniquement si CHAQUE équipe a au moins 1 humain (sinon c'est de l'entraînement vs bots → ELO gelé)
  const att = members.filter((c) => c.team === "att" && c.pid), def = members.filter((c) => c.team === "def" && c.pid);
  if (att.length && def.length) {
    const avg = (arr) => arr.reduce((s, c) => s + player(c.pid).elo, 0) / arr.length;
    const aA = avg(att), aD = avg(def);
    const eA = 1 / (1 + Math.pow(10, (aD - aA) / 400)), sA = winTeam === "att" ? 1 : 0, K = 32;
    for (const c of att) { const p = player(c.pid); p.elo = Math.max(100, Math.round(p.elo + K * (sA - eA))); }
    for (const c of def) { const p = player(c.pid); p.elo = Math.max(100, Math.round(p.elo + K * ((1 - sA) - (1 - eA)))); }
  }
  save();
  room.resultDone = true;
}
function leaderboard() {
  return Object.values(DB.players).sort((a, b) => b.elo - a.elo).slice(0, 20)
    .map((p) => ({ name: p.name, elo: p.elo, wins: p.wins, losses: p.losses, kills: p.kills, deaths: p.deaths }));
}

const server = http.createServer((req, res) => { res.writeHead(200); res.end("VALOTIZ — serveur WS. Connecte un client sur ws://<ip>:" + PORT); });
server.on("upgrade", (req, sock) => {
  const key = req.headers["sec-websocket-key"]; if (!key) { sock.destroy(); return; }
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept(key) + "\r\n\r\n");
  const id = nextId++; const c = { id, sock, name: "", team: "att", avatar: 0, pid: null, roomId: null }; clients.set(id, c);
  send(c, { t: "welcome", id });
  let acc = Buffer.alloc(0);
  sock.on("data", (chunk) => {
    acc = Buffer.concat([acc, chunk]);
    const { frames, rest } = decode(acc); acc = rest;
    for (const { opcode, payload } of frames) {
      if (opcode === 8) { sock.end(); return; }                                  // close
      else if (opcode === 9) sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); // ping→pong
      else if (opcode === 1) handle(c, payload.toString("utf8"));                // texte
    }
  });
  const bye = () => { clients.delete(id); leaveRoom(c); };
  sock.on("close", bye); sock.on("error", bye);
});

function handle(c, text) {
  let m; try { m = JSON.parse(text); } catch { return; }
  const room = rooms.get(c.roomId);
  switch (m.t) {
    case "join": joinRoom(c, m.name, m.avatar, m.pid, m.room); break;
    case "start": if (room && c.id === room.hostId) startRoom(room); break;        // seul l'hôte lance
    case "result": if (room && c.id === room.hostId && !room.resultDone) applyResult(room, m); break;  // fin de match (hôte)
    case "leaderboard": send(c, { t: "leaderboard", rows: leaderboard() }); break;
    case "relay": if (room) broadcast(room, { t: "relay", from: c.id, d: m.d }, c.id); break; // relais générique
    case "leave": leaveRoom(c); c.roomId = null; break;
  }
}

server.listen(PORT, () => console.log("VALOTIZ — serveur WS sur ws://0.0.0.0:" + PORT + "  (5v5, codes de salon, ELO/stats → " + DB_FILE + ")"));
