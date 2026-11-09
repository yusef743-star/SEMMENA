// SEMMENA - moteur de règles (jeu de colonisation 3 à 6 joueurs, pions Menhir en 5-6 joueurs)
(function (root) {
'use strict';

const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const RNAME = { wood: 'bois', brick: 'argile', sheep: 'mouton', wheat: 'blé', ore: 'minerai' };
const COST = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
};
const COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#e67e22', '#9b59b6'];
const LIMITS = { roads: 15, settle: 5, cities: 4 };
const WIN_VP = 10;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const emptyRes = () => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
const total = (r) => RES.reduce((s, k) => s + r[k], 0);
const canPay = (r, c) => Object.keys(c).every((k) => r[k] >= c[k]);
const ok = () => ({ ok: true });
const err = (m) => ({ err: m });

// ---------- Plateau ----------
function buildBoard(ext) {
  const rows = ext ? [3, 4, 5, 6, 5, 4, 3] : [3, 4, 5, 4, 3];
  const w = Math.sqrt(3), h = 1.5;
  const hexes = [];
  rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      hexes.push({ id: hexes.length, x: (i - (n - 1) / 2) * w, y: (r - (rows.length - 1) / 2) * h, res: null, num: null, verts: [] });
    }
  });
  const types = ext
    ? [['wood', 6], ['wheat', 6], ['sheep', 6], ['brick', 5], ['ore', 5], ['desert', 2]]
    : [['wood', 4], ['wheat', 4], ['sheep', 4], ['brick', 3], ['ore', 3], ['desert', 1]];
  const tiles = [];
  types.forEach(([t, c]) => { for (let i = 0; i < c; i++) tiles.push(t); });
  shuffle(tiles);

  const verts = [], edges = [], vmap = {}, emap = {};
  hexes.forEach((hx) => {
    hx.res = tiles[hx.id];
    const vs = [];
    for (let k = 0; k < 6; k++) {
      const a = ((30 + 60 * k) * Math.PI) / 180;
      const px = hx.x + Math.cos(a), py = hx.y + Math.sin(a);
      const key = Math.round(px * 1000) + ',' + Math.round(py * 1000);
      let v = vmap[key];
      if (v == null) {
        v = verts.length; vmap[key] = v;
        verts.push({ id: v, x: px, y: py, hexes: [], nb: [], edges: [], owner: -1, type: 0, port: null });
      }
      verts[v].hexes.push(hx.id);
      vs.push(v);
    }
    hx.verts = vs;
    for (let k = 0; k < 6; k++) {
      const a = vs[k], b = vs[(k + 1) % 6];
      const ek = a < b ? a + '_' + b : b + '_' + a;
      if (emap[ek] == null) {
        const id = edges.length;
        emap[ek] = id;
        edges.push({ id, a: Math.min(a, b), b: Math.max(a, b), owner: -1, hexes: [hx.id] });
        verts[a].nb.push(b); verts[b].nb.push(a);
        verts[a].edges.push(id); verts[b].edges.push(id);
      } else edges[emap[ek]].hexes.push(hx.id);
    }
  });

  // numéros: pas de 6 / 8 côte à côte
  const nums = ext
    ? [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12]
    : [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  const land = hexes.filter((x) => x.res !== 'desert');
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1.9;
  for (let tries = 0; tries < 2000; tries++) {
    const ns = shuffle(nums.slice());
    land.forEach((hx, i) => { hx.num = ns[i]; });
    let bad = false;
    for (let i = 0; i < land.length && !bad; i++) {
      if (land[i].num !== 6 && land[i].num !== 8) continue;
      for (let j = i + 1; j < land.length; j++) {
        if ((land[j].num === 6 || land[j].num === 8) && near(land[i], land[j])) { bad = true; break; }
      }
    }
    if (!bad) break;
  }

  // ports
  const coast = edges.filter((e) => e.hexes.length === 1).map((e) => {
    const A = verts[e.a], B = verts[e.b];
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    return { e, mx, my, ang: Math.atan2(my, mx) };
  }).sort((p, q) => p.ang - q.ang);
  // 4 ports génériques (5 en 5-6 joueurs) + 5 ports spécialisés
  const portTypes = shuffle((ext ? ['any'] : []).concat(['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore']));
  const ports = [];
  const P = portTypes.length;
  for (let i = 0; i < P; i++) {
    const c = coast[Math.floor((i * coast.length) / P)];
    const len = Math.hypot(c.mx, c.my) || 1;
    ports.push({ type: portTypes[i], edge: c.e.id, x: c.mx, y: c.my, ox: c.mx / len, oy: c.my / len });
    verts[c.e.a].port = portTypes[i];
    verts[c.e.b].port = portTypes[i];
  }
  return { hexes, verts, edges, ports, emap };
}

// ---------- Création ----------
function createGame(names) {
  const n = names.length;
  const ext = n >= 5;
  const B = buildBoard(ext);
  const deck = [];
  const add = (k, c) => { for (let i = 0; i < c; i++) deck.push({ k, t: -1 }); };
  add('knight', ext ? 20 : 14); add('vp', 5); add('road', ext ? 3 : 2); add('yop', ext ? 3 : 2); add('mono', ext ? 3 : 2);
  shuffle(deck);
  const bankN = ext ? 24 : 19;
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 1; i >= 0; i--) order.push(i);
  const G = {
    n, ext,
    hexes: B.hexes, verts: B.verts, edges: B.edges, ports: B.ports, emap: B.emap,
    players: names.map((nm, i) => ({ id: i, name: nm, color: COLORS[i], res: emptyRes(), dev: [], knights: 0, roads: 0, settle: 0, cities: 0 })),
    bank: { wood: bankN, brick: bankN, sheep: bankN, wheat: bankN, ore: bankN },
    deck,
    robber: B.hexes.find((h) => h.res === 'desert').id,
    phase: 'setup',
    setup: { order, idx: 0, step: 'settlement', last: null },
    turn: null, pending: null, trade: null, dice: null,
    longest: { holder: null, len: 0 }, army: { holder: null, n: 0 },
    winner: null, log: [], turnCounter: 0,
  };
  log(G, "C'est parti ! " + G.players[0].name + ' place sa première colonie.');
  return G;
}

function log(G, t) { G.log.push(t); if (G.log.length > 40) G.log.shift(); }
const pname = (G, i) => G.players[i].name;
const setupCur = (G) => G.setup.order[G.setup.idx];
const activeOf = (G) => (G.phase === 'setup' ? setupCur(G) : G.turn ? G.turn.active : -1);

// ---------- Légalité ----------
function vertexFree(G, v) {
  const V = G.verts[v];
  return V.owner < 0 && V.nb.every((u) => G.verts[u].owner < 0);
}
function legalSettlements(G, pid) {
  const out = [];
  G.verts.forEach((V) => {
    if (!vertexFree(G, V.id)) return;
    if (G.phase === 'setup') out.push(V.id);
    else if (V.edges.some((e) => G.edges[e].owner === pid)) out.push(V.id);
  });
  return out;
}
function legalCities(G, pid) {
  return G.verts.filter((V) => V.owner === pid && V.type === 1).map((V) => V.id);
}
function legalRoads(G, pid) {
  const out = [];
  if (G.phase === 'setup') {
    const V = G.verts[G.setup.last];
    return V ? V.edges.filter((e) => G.edges[e].owner < 0) : [];
  }
  G.edges.forEach((E) => {
    if (E.owner >= 0) return;
    const conn = [E.a, E.b].some((v) => {
      const V = G.verts[v];
      if (V.owner === pid) return true;
      if (V.owner >= 0) return false;
      return V.edges.some((e) => e !== E.id && G.edges[e].owner === pid);
    });
    if (conn) out.push(E.id);
  });
  return out;
}
function roadLen(G, pid) {
  let best = 0;
  const used = new Set();
  function dfs(v, len) {
    if (len > best) best = len;
    for (const eid of G.verts[v].edges) {
      const e = G.edges[eid];
      if (e.owner !== pid || used.has(eid)) continue;
      const u = e.a === v ? e.b : e.a;
      used.add(eid);
      const blocked = G.verts[u].owner >= 0 && G.verts[u].owner !== pid;
      if (blocked) { if (len + 1 > best) best = len + 1; } else dfs(u, len + 1);
      used.delete(eid);
    }
  }
  G.verts.forEach((V) => {
    if (V.edges.some((e) => G.edges[e].owner === pid)) dfs(V.id, 0);
  });
  return best;
}
function updateLongest(G) {
  const lens = G.players.map((p) => roadLen(G, p.id));
  const max = Math.max(...lens);
  const prev = G.longest.holder;
  let holder = prev;
  if (max < 5) holder = null;
  else {
    const top = lens.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
    if (prev != null && lens[prev] === max) holder = prev;
    else if (top.length === 1) holder = top[0];
    else holder = null;
  }
  G.longest = { holder, len: holder == null ? 0 : lens[holder] };
  if (holder !== prev && holder != null) log(G, pname(G, holder) + ' a la route la plus longue (' + lens[holder] + ').');
  G.players.forEach((p) => { p.roadLen = lens[p.id]; });
}
function vp(G, pid, hidden) {
  const p = G.players[pid];
  let s = p.settle + 2 * p.cities + (G.longest.holder === pid ? 2 : 0) + (G.army.holder === pid ? 2 : 0);
  if (hidden) s += p.dev.filter((c) => c.k === 'vp').length;
  return s;
}
function ratio(G, pid, r) {
  let best = 4;
  G.verts.forEach((V) => {
    if (V.owner !== pid || !V.port) return;
    if (V.port === 'any') best = Math.min(best, 3);
    else if (V.port === r) best = Math.min(best, 2);
  });
  return best;
}
function checkWin(G) {
  const a = activeOf(G);
  if (a >= 0 && vp(G, a, true) >= WIN_VP) {
    G.winner = a;
    log(G, '🏆 ' + pname(G, a) + ' gagne la partie !');
  }
}

// ---------- Tour ----------
function startTurn(G, m1) {
  G.turn = { m1, m2: G.ext ? (m1 + 2) % G.n : null, active: m1, stage: 'roll', devPlayed: false };
  G.dice = null;
  log(G, 'Tour de ' + pname(G, m1) + (G.ext ? ' (Menhir 1) — ' + pname(G, G.turn.m2) + ' a le Menhir 2' : '') + '.');
}
function endTurn(G) {
  G.turnCounter++;
  G.trade = null;
  const T = G.turn;
  if (G.ext && T.active === T.m1) {
    T.active = T.m2; T.stage = 'main'; T.devPlayed = false;
    log(G, pname(G, T.m2) + ' joue avec le Menhir 2 (pas de dés).');
  } else startTurn(G, (T.m1 + 1) % G.n);
}
function produce(G, sum) {
  const gain = G.players.map(() => emptyRes());
  G.hexes.forEach((hx) => {
    if (hx.num !== sum || hx.id === G.robber) return;
    hx.verts.forEach((v) => {
      const V = G.verts[v];
      if (V.owner >= 0) gain[V.owner][hx.res] += V.type === 2 ? 2 : 1;
    });
  });
  RES.forEach((r) => {
    const takers = G.players.filter((p) => gain[p.id][r] > 0);
    const need = takers.reduce((s, p) => s + gain[p.id][r], 0);
    if (need === 0) return;
    if (need <= G.bank[r]) takers.forEach((p) => { p.res[r] += gain[p.id][r]; G.bank[r] -= gain[p.id][r]; });
    else if (takers.length === 1) { const g = G.bank[r]; takers[0].res[r] += g; G.bank[r] = 0; }
    // sinon: personne ne reçoit cette ressource
  });
  const msgs = [];
  G.players.forEach((p) => {
    const parts = RES.filter((r) => gain[p.id][r] > 0).map((r) => gain[p.id][r] + ' ' + RNAME[r]);
    if (parts.length) msgs.push(p.name + ': ' + parts.join(', '));
  });
  if (msgs.length) log(G, 'Production — ' + msgs.join(' | '));
}
function startRobber(G) {
  G.pending = { type: 'robber' };
}
function afterRoll7(G) {
  const need = {};
  G.players.forEach((p) => { const t = total(p.res); if (t > 7) need[p.id] = Math.floor(t / 2); });
  if (Object.keys(need).length) { G.pending = { type: 'discard', need }; log(G, 'Un 7 ! Défaussez la moitié de vos cartes si vous en avez plus de 7.'); }
  else startRobber(G);
}
function stealRandom(G, from, to) {
  const cards = [];
  RES.forEach((r) => { for (let i = 0; i < G.players[from].res[r]; i++) cards.push(r); });
  if (!cards.length) return;
  const r = cards[Math.floor(Math.random() * cards.length)];
  G.players[from].res[r]--; G.players[to].res[r]++;
  log(G, pname(G, to) + ' vole une carte à ' + pname(G, from) + '.');
}
function placeRoad(G, pid, e) {
  G.edges[e].owner = pid; G.players[pid].roads++;
  updateLongest(G);
}
function placeSettlement(G, pid, v) {
  G.verts[v].owner = pid; G.verts[v].type = 1; G.players[pid].settle++;
  updateLongest(G);
}

// ---------- Actions ----------
function act(G, pid, m) {
  if (!G || G.winner != null) return err('Partie terminée');
  const P = G.players[pid];
  if (!P) return err('Joueur inconnu');
  const act_ = activeOf(G);
  const pend = G.pending;

  // --- échanges: réponse des autres joueurs (hors tour) ---
  if (m.t === 'accept') {
    const tr = G.trade;
    if (!tr || tr.from === pid) return err("Pas d'offre à accepter");
    const A = G.players[tr.from];
    if (!canPay(P.res, tr.get)) return err("Il vous manque des ressources");
    if (!canPay(A.res, tr.give)) { G.trade = null; return err("L'offre n'est plus valide"); }
    RES.forEach((r) => { A.res[r] += (tr.get[r] || 0) - (tr.give[r] || 0); P.res[r] += (tr.give[r] || 0) - (tr.get[r] || 0); });
    log(G, P.name + ' accepte l\'échange avec ' + A.name + '.');
    G.trade = null;
    return ok();
  }
  if (m.t === 'discard') {
    if (!pend || pend.type !== 'discard' || !pend.need[pid]) return err('Rien à défausser');
    const need = pend.need[pid];
    const res = m.res || {};
    let sum = 0;
    for (const r of RES) {
      const c = res[r] | 0;
      if (c < 0 || c > P.res[r]) return err('Sélection invalide');
      sum += c;
    }
    if (sum !== need) return err('Défaussez exactement ' + need + ' cartes');
    RES.forEach((r) => { const c = res[r] | 0; P.res[r] -= c; G.bank[r] += c; });
    delete pend.need[pid];
    log(G, P.name + ' défausse ' + need + ' cartes.');
    if (!Object.keys(pend.need).length) startRobber(G);
    return ok();
  }

  if (act_ !== pid) return err("Ce n'est pas votre tour");

  // --- installation ---
  if (G.phase === 'setup') {
    const S = G.setup;
    if (m.t === 'settlement') {
      if (S.step !== 'settlement') return err('Placez une route');
      if (!legalSettlements(G, pid).includes(m.v)) return err('Emplacement interdit');
      placeSettlement(G, pid, m.v);
      S.last = m.v; S.step = 'road';
      if (S.idx >= G.n) {
        const got = [];
        G.verts[m.v].hexes.forEach((h) => {
          const r = G.hexes[h].res;
          if (r !== 'desert' && G.bank[r] > 0) { P.res[r]++; G.bank[r]--; got.push(RNAME[r]); }
        });
        if (got.length) log(G, P.name + ' reçoit: ' + got.join(', ') + '.');
      }
      return ok();
    }
    if (m.t === 'road') {
      if (S.step !== 'road') return err('Placez une colonie');
      if (!legalRoads(G, pid).includes(m.e)) return err('Route interdite');
      placeRoad(G, pid, m.e);
      S.step = 'settlement'; S.idx++;
      if (S.idx >= S.order.length) { G.phase = 'play'; startTurn(G, 0); }
      else log(G, pname(G, setupCur(G)) + ' place sa ' + (S.idx >= G.n ? 'deuxième' : 'première') + ' colonie.');
      return ok();
    }
    return err('Phase de placement');
  }

  const T = G.turn;

  // --- actions en attente (voleur, vol, route gratuite) ---
  if (pend) {
    if (pend.type === 'robber') {
      if (m.t !== 'robber') return err('Déplacez le voleur');
      if (m.h === G.robber || !G.hexes[m.h]) return err('Choisissez une autre tuile');
      G.robber = m.h;
      const cand = [];
      G.hexes[m.h].verts.forEach((v) => {
        const o = G.verts[v].owner;
        if (o >= 0 && o !== pid && total(G.players[o].res) > 0 && !cand.includes(o)) cand.push(o);
      });
      log(G, P.name + ' déplace le voleur.');
      if (cand.length === 0) G.pending = null;
      else if (cand.length === 1) { stealRandom(G, cand[0], pid); G.pending = null; }
      else G.pending = { type: 'steal', cand };
      return ok();
    }
    if (pend.type === 'steal') {
      if (m.t !== 'steal' || !pend.cand.includes(m.p)) return err('Choisissez une victime');
      stealRandom(G, m.p, pid);
      G.pending = null;
      return ok();
    }
    if (pend.type === 'roadbuilding') {
      if (m.t !== 'road') return err('Placez vos routes gratuites');
      if (!legalRoads(G, pid).includes(m.e)) return err('Route interdite');
      placeRoad(G, pid, m.e);
      pend.left--;
      if (pend.left <= 0 || P.roads >= LIMITS.roads || legalRoads(G, pid).length === 0) G.pending = null;
      checkWin(G);
      return ok();
    }
    return err('Action en attente');
  }

  const main = T.stage === 'main';
  switch (m.t) {
    case 'roll': {
      if (T.stage !== 'roll') return err('Déjà lancé');
      const d1 = 1 + Math.floor(Math.random() * 6), d2 = 1 + Math.floor(Math.random() * 6);
      G.dice = [d1, d2]; T.stage = 'main';
      log(G, P.name + ' lance les dés: ' + d1 + ' + ' + d2 + ' = ' + (d1 + d2));
      if (d1 + d2 === 7) afterRoll7(G); else produce(G, d1 + d2);
      return ok();
    }
    case 'road': {
      if (!main) return err('Lancez les dés d\'abord');
      if (P.roads >= LIMITS.roads) return err('Plus de routes');
      if (!canPay(P.res, COST.road)) return err('Ressources insuffisantes');
      if (!legalRoads(G, pid).includes(m.e)) return err('Route interdite');
      pay(G, P, COST.road); placeRoad(G, pid, m.e);
      checkWin(G);
      return ok();
    }
    case 'settlement': {
      if (!main) return err('Lancez les dés d\'abord');
      if (P.settle >= LIMITS.settle) return err('Plus de colonies');
      if (!canPay(P.res, COST.settlement)) return err('Ressources insuffisantes');
      if (!legalSettlements(G, pid).includes(m.v)) return err('Emplacement interdit');
      pay(G, P, COST.settlement); placeSettlement(G, pid, m.v);
      log(G, P.name + ' construit une colonie.');
      checkWin(G);
      return ok();
    }
    case 'city': {
      if (!main) return err('Lancez les dés d\'abord');
      if (P.cities >= LIMITS.cities) return err('Plus de villes');
      if (!canPay(P.res, COST.city)) return err('Ressources insuffisantes');
      if (!legalCities(G, pid).includes(m.v)) return err('Pas une de vos colonies');
      pay(G, P, COST.city);
      G.verts[m.v].type = 2; P.settle--; P.cities++;
      log(G, P.name + ' construit une ville.');
      checkWin(G);
      return ok();
    }
    case 'buy': {
      if (!main) return err('Lancez les dés d\'abord');
      if (!G.deck.length) return err('Plus de cartes');
      if (!canPay(P.res, COST.dev)) return err('Ressources insuffisantes');
      pay(G, P, COST.dev);
      const c = G.deck.pop(); c.t = G.turnCounter;
      P.dev.push(c);
      log(G, P.name + ' achète une carte développement.');
      checkWin(G);
      return ok();
    }
    case 'bank': {
      if (!main) return err('Lancez les dés d\'abord');
      if (!RES.includes(m.give) || !RES.includes(m.get) || m.give === m.get) return err('Échange invalide');
      const r = ratio(G, pid, m.give);
      if (P.res[m.give] < r) return err('Il faut ' + r + ' ' + RNAME[m.give]);
      if (G.bank[m.get] < 1) return err('La banque n\'a plus de ' + RNAME[m.get]);
      P.res[m.give] -= r; G.bank[m.give] += r; P.res[m.get]++; G.bank[m.get]--;
      log(G, P.name + ' échange ' + r + ' ' + RNAME[m.give] + ' contre 1 ' + RNAME[m.get] + ' (banque).');
      return ok();
    }
    case 'offer': {
      if (!main) return err('Lancez les dés d\'abord');
      if (G.ext && pid !== T.m1) return err('Pas d\'échange entre joueurs avec le Menhir 2');
      const give = {}, get = {};
      let g1 = 0, g2 = 0;
      RES.forEach((r) => { give[r] = Math.max(0, (m.give && m.give[r]) | 0); get[r] = Math.max(0, (m.get && m.get[r]) | 0); g1 += give[r]; g2 += get[r]; });
      if (!g1 || !g2) return err('Choisissez ce que vous donnez et recevez');
      if (!canPay(P.res, give)) return err('Vous n\'avez pas ces ressources');
      for (const r of RES) if (give[r] && get[r]) return err('Pas la même ressource des deux côtés');
      G.tradeSeq = (G.tradeSeq || 0) + 1;
      G.trade = { from: pid, give, get, id: G.tradeSeq };
      log(G, P.name + ' propose un échange.');
      return ok();
    }
    case 'cancel': {
      G.trade = null;
      return ok();
    }
    case 'knight': case 'roadbuilding': case 'yop': case 'mono': {
      if (T.devPlayed) return err('Une seule carte par tour');
      const kind = m.t === 'knight' ? 'knight' : m.t === 'roadbuilding' ? 'road' : m.t;
      const idx = P.dev.findIndex((c) => c.k === kind && c.t < G.turnCounter);
      if (idx < 0) return err('Carte indisponible (achetée ce tour ?)');
      if (m.t === 'yop') {
        if (!RES.includes(m.a) || !RES.includes(m.b)) return err('Choisissez 2 ressources');
        const need = emptyRes(); need[m.a]++; need[m.b]++;
        if (!RES.every((r) => G.bank[r] >= need[r])) return err('La banque n\'a pas assez');
        P.res[m.a]++; P.res[m.b]++; G.bank[m.a]--; G.bank[m.b]--;
        log(G, P.name + ' joue Invention: ' + RNAME[m.a] + ' + ' + RNAME[m.b] + '.');
      } else if (m.t === 'mono') {
        if (!RES.includes(m.r)) return err('Choisissez une ressource');
        let got = 0;
        G.players.forEach((q) => { if (q.id !== pid) { got += q.res[m.r]; q.res[m.r] = 0; } });
        P.res[m.r] += got;
        log(G, P.name + ' joue Monopole sur ' + RNAME[m.r] + ' (' + got + ' cartes).');
      } else if (m.t === 'roadbuilding') {
        const left = Math.min(2, LIMITS.roads - P.roads);
        if (left <= 0 || legalRoads(G, pid).length === 0) return err('Aucune route possible');
        G.pending = { type: 'roadbuilding', left };
        log(G, P.name + ' joue Construction de routes.');
      } else {
        P.knights++;
        log(G, P.name + ' joue un chevalier.');
        if (P.knights >= 3 && P.knights > G.army.n) {
          if (G.army.holder !== pid) log(G, P.name + ' a la plus grande armée.');
          G.army = { holder: pid, n: P.knights };
        }
        G.pending = { type: 'robber' };
      }
      P.dev.splice(idx, 1);
      T.devPlayed = true;
      checkWin(G);
      return ok();
    }
    case 'end': {
      if (!main) return err('Lancez les dés d\'abord');
      endTurn(G);
      return ok();
    }
  }
  return err('Action inconnue');
}
function pay(G, p, c) { for (const k in c) { p.res[k] -= c[k]; G.bank[k] += c[k]; } }

// ---------- Vues ----------
function staticBoard(G) {
  return {
    ext: G.ext,
    hexes: G.hexes.map((h) => ({ id: h.id, x: h.x, y: h.y, res: h.res, num: h.num, verts: h.verts })),
    verts: G.verts.map((v) => ({ x: v.x, y: v.y })),
    edges: G.edges.map((e) => ({ a: e.a, b: e.b })),
    ports: G.ports.map((p) => ({ type: p.type, x: p.x, y: p.y, ox: p.ox, oy: p.oy })),
  };
}
function viewFor(G, pid) {
  const me = G.players[pid];
  const act_ = activeOf(G);
  const T = G.turn;
  const mine = act_ === pid && G.winner == null;
  const pend = G.pending;
  const main = G.phase === 'play' && T && T.stage === 'main' && !pend;
  const legal = { settlement: [], city: [], road: [], hex: [] };
  const can = {};
  if (mine) {
    if (G.phase === 'setup') {
      if (G.setup.step === 'settlement') legal.settlement = legalSettlements(G, pid);
      else legal.road = legalRoads(G, pid);
    } else if (pend && pend.type === 'robber') {
      legal.hex = G.hexes.filter((h) => h.id !== G.robber).map((h) => h.id);
    } else if (pend && pend.type === 'roadbuilding') {
      legal.road = legalRoads(G, pid);
    } else if (main) {
      if (me.roads < LIMITS.roads && canPay(me.res, COST.road)) legal.road = legalRoads(G, pid);
      if (me.settle < LIMITS.settle && canPay(me.res, COST.settlement)) legal.settlement = legalSettlements(G, pid);
      if (me.cities < LIMITS.cities && canPay(me.res, COST.city)) legal.city = legalCities(G, pid);
    }
  }
  can.roll = mine && G.phase === 'play' && T.stage === 'roll' && !pend;
  can.end = mine && main;
  can.road = legal.road.length > 0 && main;
  can.settlement = legal.settlement.length > 0 && main;
  can.city = legal.city.length > 0 && main;
  can.buy = mine && main && G.deck.length > 0 && canPay(me.res, COST.dev);
  can.bank = mine && main;
  can.offer = mine && main && (!G.ext || pid === T.m1);
  const devs = me.dev.map((c) => ({
    k: c.k,
    playable: mine && c.k !== 'vp' && c.t < G.turnCounter && !T.devPlayed && !pend && G.phase === 'play',
  }));
  let pendingView = null;
  if (pend) {
    if (pend.type === 'discard') pendingView = { type: 'discard', need: pend.need[pid] || 0, waiting: Object.keys(pend.need).map(Number) };
    else if (pend.type === 'steal') pendingView = { type: 'steal', cand: pend.cand };
    else pendingView = { type: pend.type, left: pend.left };
  }
  const ratios = {};
  RES.forEach((r) => { ratios[r] = ratio(G, pid, r); });
  return {
    me: pid, n: G.n, ext: G.ext, phase: G.phase,
    setupStep: G.phase === 'setup' ? G.setup.step : null,
    active: act_, m1: T ? T.m1 : null, m2: T ? T.m2 : null, stage: T ? T.stage : null,
    dice: G.dice, robber: G.robber,
    vo: G.verts.map((v) => v.owner), vt: G.verts.map((v) => v.type), eo: G.edges.map((e) => e.owner),
    players: G.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, rc: total(p.res), dc: p.dev.length,
      knights: p.knights, roadLen: p.roadLen || 0, vp: vp(G, p.id, false),
      longest: G.longest.holder === p.id, army: G.army.holder === p.id,
    })),
    res: me.res, dev: devs, myVp: vp(G, pid, true),
    legal, can, pending: pendingView, ratios,
    trade: G.trade ? { from: G.trade.from, give: G.trade.give, get: G.trade.get, id: G.trade.id } : null,
    bank: G.bank, deck: G.deck.length,
    log: G.log.slice(-6), winner: G.winner,
    winnerVp: G.winner != null ? G.players.map((p) => vp(G, p.id, true)) : null,
  };
}

root.Semmena = { createGame, act, viewFor, staticBoard, RES, RNAME, COST, COLORS, total, canPay };
if (typeof module !== 'undefined') module.exports = root.Semmena;
})(typeof window !== 'undefined' ? window : globalThis);
