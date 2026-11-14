// Écrit le format .pf de Chapatiz : haxe.Serializer d'un StringMap
//   { anim: { frames: [{ position: Rectangle, bounds: Rectangle }], misc: { headPos: Point, facePos: Point, mirrorName } } }
// Les noms de classes "flash.geom.Rectangle" / "flash.geom.Point" sont gardés pour que leur avatar.js
// (haxe_Unserializer + resolver flash.geom.Rectangle -> com.geom.SimpleRect) le relise tel quel.

class Ser {
  constructor() { this.buf = ""; this.scache = new Map(); }
  str(s) {
    const r = this.scache.get(s);
    if (r !== undefined) { this.buf += "R" + r; return; }
    this.scache.set(s, this.scache.size);
    const e = encodeURIComponent(s);
    this.buf += "y" + e.length + ":" + e;
  }
  num(n) {
    if (n === 0) this.buf += "z";
    else if (Number.isInteger(n) && n >= -2147483648 && n <= 2147483647) this.buf += "i" + n;
    else this.buf += "d" + n;
  }
  cls(name, fields) {
    this.buf += "c"; this.str(name);
    for (const [k, v] of fields) { this.str(k); this.num(v); }
    this.buf += "g";
  }
  rect(r) { this.cls("flash.geom.Rectangle", [["y", r.y], ["width", r.w], ["height", r.h], ["x", r.x]]); }
  point(p) { if (p == null) this.buf += "n"; else this.cls("flash.geom.Point", [["y", p.y], ["x", p.x]]); }
}

export function toPf(meta) {
  const s = new Ser();
  s.buf += "b";
  for (const a of meta.anims) {
    s.str(a.key);
    s.buf += "o"; s.str("frames"); s.buf += "a";
    for (const f of a.frames) {
      s.buf += "o"; s.str("position"); s.rect(f.position); s.str("bounds"); s.rect(f.bounds); s.buf += "g";
    }
    s.buf += "h"; s.str("misc");
    if (a.misc == null) s.buf += "n";
    else {
      s.buf += "o";
      s.str("headPos"); s.point(a.misc.headPos);
      s.str("facePos"); s.point(a.misc.facePos);
      s.str("mirrorName"); s.str(a.misc.mirrorName || "");
      s.buf += "g";
    }
    s.buf += "g";
  }
  s.buf += "h";
  return s.buf;
}
