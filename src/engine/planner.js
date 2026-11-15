'use strict';
// Rota planlayıcı: formatlar düğüm, dönüştürücü kenarları ağırlıklı ok.
// En ucuz zinciri Dijkstra ile bulur (en çok 3 adım). Yeni bir motor eklemek
// başka hiçbir koda dokunmadan yeni rotalar açar (Filee'deki fikir, daha yalın hâli).

const MAX_STEPS = 3;

class Planner {
  constructor(converters) {
    this.converters = converters;
    this.edges = new Map(); // from → [{to, cost, conv}]
    for (const conv of converters) {
      for (const [froms, tos, cost = 10, flags = {}] of conv.edges) {
        for (const f of froms) for (const t of tos) {
          if (!this.edges.has(f)) this.edges.set(f, []);
          // flags.directOnly: yalnızca tek adımlık rota olabilir. flags.terminal: arkasından adım gelemez.
          this.edges.get(f).push({ to: t, cost, conv, directOnly: !!flags.directOnly, terminal: !!flags.terminal || !!flags.directOnly });
        }
      }
    }
  }

  /** from → to rotası: [{conv, from, to}] ya da null. Aynı format için yeniden kodlama kenarı varsa onu kullanır. */
  plan(from, to, { exclude = [] } = {}) {
    if (!from || !to) return null;
    const ok = (e) => !exclude.includes(e.conv.id);
    if (from === to) {
      const self = (this.edges.get(from) || []).filter((e) => e.to === to && ok(e)).sort((a, b) => a.cost - b.cost)[0];
      return self ? [{ conv: self.conv, from, to }] : null;
    }
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const steps = new Map([[from, 0]]);
    const closed = new Set(); // terminal kenarla varılan düğümlerden devam edilmez
    const queue = [[0, from]];
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [d, node] = queue.shift();
      if (node === to) break;
      if (d > dist.get(node)) continue;
      if (steps.get(node) >= MAX_STEPS || closed.has(node)) continue;
      for (const e of this.edges.get(node) || []) {
        if (e.to === node || !ok(e)) continue;
        if (e.directOnly && node !== from) continue;
        const nd = d + e.cost;
        if (nd < (dist.has(e.to) ? dist.get(e.to) : Infinity)) {
          dist.set(e.to, nd); prev.set(e.to, { node, e }); steps.set(e.to, steps.get(node) + 1);
          if (e.terminal) closed.add(e.to); else closed.delete(e.to);
          queue.push([nd, e.to]);
        }
      }
    }
    if (!prev.has(to)) return null;
    const route = [];
    for (let n = to; n !== from;) { const p = prev.get(n); route.unshift({ conv: p.e.conv, from: p.node, to: n }); n = p.node; }
    return route;
  }

  /** Bir formattan ulaşılabilen tüm hedefler (maliyet sıralı). */
  targets(from) {
    const out = [];
    const seen = new Set([from]);
    let frontier = [[from, 0]];
    for (let depth = 0; depth < MAX_STEPS; depth++) {
      const next = [];
      for (const [node, cost] of frontier) {
        for (const e of this.edges.get(node) || []) {
          if (seen.has(e.to) || (e.directOnly && depth > 0)) continue;
          seen.add(e.to); out.push({ id: e.to, cost: cost + e.cost });
          if (!e.terminal) next.push([e.to, cost + e.cost]);
        }
      }
      frontier = next;
    }
    if ((this.edges.get(from) || []).some((e) => e.to === from)) out.unshift({ id: from, cost: 0, same: true });
    return out.sort((a, b) => a.cost - b.cost);
  }
}

module.exports = { Planner, MAX_STEPS };
