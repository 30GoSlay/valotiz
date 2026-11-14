// Serveur multijoueur WebSocket pour Avatar Tactique — ZÉRO dépendance (handshake + trames RFC6455 à la main).
//   node server.mjs            → écoute ws://0.0.0.0:8091
// Rôle : matchmaking 5v5, lobby, élection d'un « hôte » (son client simule les bots + les manches), et RELAIS des
// messages entre joueurs d'une même partie. La logique de jeu reste côté client (l'hôte fait autorité sur bots/manches).
// Les joueurs d'un même réseau se rejoignent ; si une partie n'est pas pleine au bout du compte à rebours, l'hôte
// complète les emplacements vides avec des bots.
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.WS_PORT) || 8091;
const TEAM_SIZE = 5;                 // 5v5
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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
const clients = new Map();            // id -> { id, sock, name, team, avatar, roomId }
let rooms = new Map();                // roomId -> { id, memberIds:[], started:bool, hostId }
let nextRoom = 1;

const send = (c, obj) => { try { c.sock.write(encode(JSON.stringify(obj))); } catch {} };
const roomMembers = (room) => room.memberIds.map((id) => clients.get(id)).filter(Boolean);
function roomPublic(room) {
  return roomMembers(room).map((c) => ({ id: c.id, name: c.name, team: c.team, avatar: c.avatar, host: c.id === room.hostId }));
}
function broadcast(room, obj, exceptId) { for (const c of roomMembers(room)) if (c.id !== exceptId) send(c, obj); }
function pushRoom(room) { for (const c of roomMembers(room)) send(c, { t: "room", you: c.id, players: roomPublic(room), size: TEAM_SIZE }); }

function findRoom() {                  // une partie non démarrée avec de la place, sinon on en crée une
  for (const room of rooms.values()) if (!room.started && room.memberIds.length < TEAM_SIZE * 2) return room;
  const room = { id: nextRoom++, memberIds: [], started: false, hostId: null }; rooms.set(room.id, room); return room;
}
function assignTeam(room) {             // équilibre les deux équipes
  let att = 0, def = 0; for (const c of roomMembers(room)) (c.team === "att" ? att++ : def++);
  return att <= def ? "att" : "def";
}
function joinRoom(c, name, avatar) {
  const room = findRoom();
  c.name = (name || ("Joueur" + c.id)).slice(0, 16); c.avatar = avatar | 0; c.roomId = room.id;
  c.team = assignTeam(room); room.memberIds.push(c.id);
  if (!room.hostId) room.hostId = c.id;  // 1er arrivé = hôte
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

const server = http.createServer((req, res) => { res.writeHead(200); res.end("Avatar Tactique — serveur WS. Connecte un client sur ws://<ip>:" + PORT); });
server.on("upgrade", (req, sock) => {
  const key = req.headers["sec-websocket-key"]; if (!key) { sock.destroy(); return; }
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept(key) + "\r\n\r\n");
  const id = nextId++; const c = { id, sock, name: "", team: "att", avatar: 0, roomId: null }; clients.set(id, c);
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
    case "join": joinRoom(c, m.name, m.avatar); break;
    case "start": if (room && c.id === room.hostId) startRoom(room); break;   // seul l'hôte lance
    case "relay": if (room) broadcast(room, { t: "relay", from: c.id, d: m.d }, c.id); break; // relais générique (état, tir, hit, world…)
    case "leave": leaveRoom(c); c.roomId = null; break;
  }
}

server.listen(PORT, () => console.log("Avatar Tactique — serveur WS sur ws://0.0.0.0:" + PORT + "  (5v5, complété par des bots)"));
