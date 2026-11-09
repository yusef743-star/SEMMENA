// SEMMENA - interface + connexion en ligne (PeerJS, l'hôte fait office de serveur)
(function () {
'use strict';
const S = window.Semmena;
const RES = S.RES;
const EM = { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰️', desert: '🏜️' };
const RN = S.RNAME;
const TILE = { wood: '#2f7d3a', brick: '#b8573a', sheep: '#9fd35f', wheat: '#e8c94a', ore: '#8b929c', desert: '#dcc9a0' };
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

// ---------- état global ----------
let peer = null, isHost = false, conn = null, code = '', myName = '';
let members = []; // hôte: [{name, conn, connected}]
let G = null; // hôte seulement
let B = null; // plateau statique
let V = null; // vue du joueur
let me = 0;
let userMode = null;
let modalKey = null;
let ignoredTrade = -1;
let started = false;

function toast(t) {
  const el = $('toast');
  el.textContent = t; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}
function show(id) {
  ['menu', 'lobby', 'game'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
}
function menuMsg(t) { $('menuMsg').textContent = t || ''; }

// ---------- menu ----------
$('name').value = store('semmena_name') || '';
$('code').value = store('semmena_code') || '';
function getName() {
  const n = $('name').value.trim().replace(/\s+/g, ' ').slice(0, 14);
  if (!n) { menuMsg('Entre ton prénom'); return null; }
  store('semmena_name', n);
  return n;
}
function needPeer() {
  if (typeof Peer === 'undefined') { menuMsg('Connexion indisponible (PeerJS manquant)'); return false; }
  return true;
}
$('btnHost').onclick = () => { const n = getName(); if (n && needPeer()) hostGame(n); };
$('btnJoin').onclick = () => {
  const n = getName(); if (!n || !needPeer()) return;
  const c = $('code').value.trim().toUpperCase();
  if (c.length < 4) { menuMsg('Entre le code de la partie'); return; }
  joinGame(n, c);
};
$('btnShare').onclick = () => {
  const text = 'Rejoins ma partie SEMMENA ! Code: ' + code;
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Code copié'));
};
$('btnStart').onclick = () => startGame();

// ---------- hôte ----------
function genCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
function hostGame(name) {
  isHost = true; myName = name; menuMsg('Création…');
  code = genCode();
  peer = new Peer('semmena-' + code, { config: ICE });
  peer.on('open', () => {
    members = [{ name, conn: null, connected: true }];
    me = 0;
    $('lobbyCode').textContent = code;
    show('lobby'); renderLobby();
  });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { try { peer.destroy(); } catch (x) {} hostGame(name); return; }
    toast('Erreur réseau: ' + e.type);
  });
  peer.on('connection', (c) => {
    c.on('data', (d) => onHostData(c, d));
    c.on('close', () => onHostClose(c));
    c.on('error', () => onHostClose(c));
  });
}
function uniqueName(n) {
  let base = n, k = 2;
  while (members.some((m) => m.name.toLowerCase() === n.toLowerCase())) n = base + k++;
  return n;
}
function onHostData(c, d) {
  if (!d || !d.t) return;
  if (d.t === 'join') {
    const nm = String(d.name || 'Joueur').slice(0, 14);
    if (started) {
      const m = members.find((x) => x.name.toLowerCase() === nm.toLowerCase());
      if (!m) { c.send({ t: 'err', m: 'Partie déjà commencée' }); return; }
      m.conn = c; m.connected = true;
      c.send({ t: 'board', b: S.staticBoard(G) });
      pushAll();
      return;
    }
    if (members.length >= 6) { c.send({ t: 'err', m: 'La partie est pleine (6 joueurs)' }); return; }
    members.push({ name: uniqueName(nm), conn: c, connected: true });
    broadcastLobby();
    return;
  }
  if (d.t === 'act') {
    const i = members.findIndex((m) => m.conn === c);
    if (i < 0 || !G) return;
    const r = S.act(G, i, d.m || {});
    if (r.err) c.send({ t: 'err', m: r.err });
    pushAll();
  }
}
function onHostClose(c) {
  const m = members.find((x) => x.conn === c);
  if (!m) return;
  if (!started) { members = members.filter((x) => x !== m); broadcastLobby(); }
  else { m.connected = false; toast(m.name + ' a perdu la connexion'); }
}
function lobbyNames() { return members.map((m) => m.name); }
function broadcastLobby() {
  members.forEach((m, i) => { if (m.conn && m.connected) m.conn.send({ t: 'lobby', names: lobbyNames(), you: i }); });
  renderLobby();
}
function renderLobby() {
  const names = isHost ? lobbyNames() : lobbyNames.cur || [];
  $('lobbyList').innerHTML = names.map((n, i) => '<div class="lp"><span class="dot" style="background:' + S.COLORS[i] + '"></span>' + esc(n) + (i === 0 ? ' 👑' : '') + '</div>').join('');
  const st = $('btnStart');
  if (isHost) {
    st.classList.remove('hidden');
    st.disabled = names.length < 3;
    $('lobbyMsg').textContent = names.length < 3 ? 'Il faut au moins 3 joueurs (' + names.length + '/6)' : names.length + '/6 joueurs. Prêt à lancer !';
  } else {
    st.classList.add('hidden');
    $('lobbyMsg').textContent = "En attente de l'hôte…";
  }
}
function startGame() {
  if (members.length < 3) return;
  started = true;
  G = S.createGame(lobbyNames());
  B = S.staticBoard(G);
  members.forEach((m) => { if (m.conn && m.connected) m.conn.send({ t: 'board', b: B }); });
  pushAll();
}
function pushAll() {
  members.forEach((m, i) => {
    const v = S.viewFor(G, i);
    if (i === 0) render(v);
    else if (m.conn && m.connected) m.conn.send({ t: 'state', v });
  });
}

// ---------- client ----------
function joinGame(name, c) {
  isHost = false; myName = name; code = c; menuMsg('Connexion…');
  store('semmena_code', c);
  peer = new Peer(undefined, { config: ICE });
  let opened = false;
  const to = setTimeout(() => { if (!opened) menuMsg('Impossible de se connecter. Vérifie le code et ta connexion.'); }, 20000);
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') menuMsg('Code introuvable. Vérifie-le auprès de l\'hôte.');
    else menuMsg('Erreur réseau: ' + e.type);
  });
  peer.on('open', () => {
    conn = peer.connect('semmena-' + c, { reliable: true });
    conn.on('open', () => {
      opened = true; clearTimeout(to);
      conn.send({ t: 'join', name });
      menuMsg('');
    });
    conn.on('data', onClientData);
    conn.on('close', () => { toast('Connexion perdue. Relance l\'app et rejoins avec le même prénom.'); });
  });
}
function onClientData(d) {
  if (!d || !d.t) return;
  if (d.t === 'lobby') { lobbyNames.cur = d.names; me = d.you; $('lobbyCode').textContent = code; show('lobby'); renderLobby(); }
  else if (d.t === 'board') { B = d.b; }
  else if (d.t === 'state') { render(d.v); }
  else if (d.t === 'err') { toast(d.m); menuMsg(d.m); }
}

// ---------- envoi d'actions ----------
function send(m) {
  if (isHost) {
    const r = S.act(G, 0, m);
    if (r.err) toast(r.err);
    pushAll();
  } else if (conn) conn.send({ t: 'act', m });
}

// ---------- rendu ----------
function autoMode() {
  if (!V || V.active !== V.me || V.winner != null) return null;
  if (V.phase === 'setup') return V.setupStep;
  if (V.pending) {
    if (V.pending.type === 'robber') return 'robber';
    if (V.pending.type === 'roadbuilding') return 'road';
  }
  return null;
}
function effMode() {
  const a = autoMode();
  if (a) return a;
  if (userMode && V && V.legal[userMode] && V.legal[userMode].length) return userMode;
  return null;
}
function legalFor(mode) {
  if (!V) return [];
  if (mode === 'robber') return V.legal.hex;
  return V.legal[mode] || [];
}

function render(v) {
  V = v; me = v.me;
  if (!B) return;
  if (userMode && !(v.legal[userMode] && v.legal[userMode].length && v.can[userMode])) userMode = null;
  show('game');
  renderPlayers(); renderStatus(); renderRes(); renderActions(); renderTradeBar();
  $('logbar').innerHTML = v.log.slice(-2).map(esc).join('<br>');
  layout(); draw();
  syncModals();
}
function renderPlayers() {
  $('players').innerHTML = V.players.map((p) => {
    const mk = V.ext && V.phase === 'play' ? (p.id === V.m1 ? ' 🗿1' : p.id === V.m2 ? ' 🗿2' : '') : '';
    return '<div class="pc' + (p.id === V.me ? ' me' : '') + (p.id === V.active ? ' act' : '') + '" style="border-left:6px solid ' + p.color + '">' +
      '<b>' + esc(p.name) + mk + '</b>⭐ ' + (p.id === V.me ? V.myVp : p.vp) + ' · 🃏 ' + p.rc + ' · 🎴 ' + p.dc +
      '<br>⚔️' + p.knights + (p.army ? '✔' : '') + ' 🛣️' + p.roadLen + (p.longest ? '✔' : '') + '</div>';
  }).join('');
}
function nameOf(i) { return V.players[i].name; }
function renderStatus() {
  const mine = V.active === V.me;
  let t = '';
  if (V.winner != null) t = '🏆 ' + nameOf(V.winner) + ' a gagné !';
  else if (V.phase === 'setup') t = mine ? (V.setupStep === 'settlement' ? 'Place ta colonie 🏠' : 'Place ta route 🛣️') : nameOf(V.active) + ' place ses pièces…';
  else if (V.pending && V.pending.type === 'discard') t = 'Défausse en cours (plus de 7 cartes)…';
  else if (V.pending && V.pending.type === 'robber') t = mine ? 'Touche une tuile pour y mettre le voleur' : nameOf(V.active) + ' déplace le voleur';
  else if (V.pending && V.pending.type === 'steal') t = mine ? 'Choisis qui voler' : nameOf(V.active) + ' vole une carte';
  else if (V.pending && V.pending.type === 'roadbuilding') t = mine ? 'Place ' + V.pending.left + ' route(s) gratuite(s)' : nameOf(V.active) + ' place des routes';
  else if (mine) {
    if (V.stage === 'roll') t = 'À toi : lance les dés 🎲';
    else t = V.ext && V.me === V.m2 ? 'À toi (Menhir 2 🗿 : pas de dés, pas d\'échange entre joueurs)' : 'À toi de jouer';
  } else t = 'Tour de ' + nameOf(V.active);
  if (V.dice) t += '  🎲 ' + V.dice[0] + '+' + V.dice[1] + '=' + (V.dice[0] + V.dice[1]);
  $('status').textContent = t;
}
function renderRes() {
  $('res').innerHTML = RES.map((r) => '<div class="rc">' + EM[r] + '<span>' + V.res[r] + '</span></div>').join('');
}
function costTxt(c) { return Object.keys(c).map((k) => EM[k].repeat(c[k])).join(''); }
function renderActions() {
  const c = V.can, el = $('actions');
  if (V.phase === 'setup' || V.winner != null) {
    el.innerHTML = '<div class="hint">' + (V.phase === 'setup' ? 'Phase de placement : touche un point en surbrillance sur le plateau.' : 'Partie terminée') + '</div>';
    return;
  }
  const m = effMode();
  const pend = V.pending && V.active === V.me;
  let h = '';
  const btn = (id, label, sub, enabled, on) => '<button data-a="' + id + '"' + (enabled ? '' : ' disabled') + (on ? ' class="on"' : '') + '>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</button>';
  if (pend && (V.pending.type === 'robber' || V.pending.type === 'roadbuilding')) {
    h += '<div class="hint">Touche le plateau</div>';
  } else {
    h += btn('roll', '🎲 Lancer', 'les dés', c.roll);
    h += btn('road', '🛣️ Route', costTxt(S.COST.road), c.road, m === 'road');
    h += btn('settlement', '🏠 Colonie', costTxt(S.COST.settlement), c.settlement, m === 'settlement');
    h += btn('city', '🏰 Ville', costTxt(S.COST.city), c.city, m === 'city');
    h += btn('buy', '🃏 Carte dév.', costTxt(S.COST.dev), c.buy);
    h += btn('trade', '🔄 Échange', V.ext && V.me === V.m2 ? 'banque seulement' : 'banque / joueurs', c.bank || c.offer);
    h += btn('dev', '🎴 Mes cartes', V.dev.length + ' en main', V.dev.length > 0);
    h += btn('end', '✅ Fin du tour', '', c.end);
  }
  el.innerHTML = h;
}
$('actions').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const a = b.dataset.a;
  if (a === 'roll') send({ t: 'roll' });
  else if (a === 'road' || a === 'settlement' || a === 'city') { userMode = userMode === a ? null : a; render(V); if (userMode) toast('Touche un emplacement en surbrillance'); }
  else if (a === 'buy') send({ t: 'buy' });
  else if (a === 'end') { userMode = null; send({ t: 'end' }); }
  else if (a === 'trade') showTrade();
  else if (a === 'dev') showDev();
});
function renderTradeBar() {
  const tb = $('tradebar');
  if (V.trade && V.trade.from === V.me) {
    tb.classList.remove('hidden');
    tb.innerHTML = '<span>Offre en cours : ' + resTxt(V.trade.give) + ' ➜ ' + resTxt(V.trade.get) + '</span><button id="tbCancel">Annuler</button>';
    $('tbCancel').onclick = () => send({ t: 'cancel' });
  } else tb.classList.add('hidden');
}
function resTxt(o) { return RES.filter((r) => o[r] > 0).map((r) => EM[r].repeat(o[r])).join('') || '—'; }

// ---------- modales ----------
function openModal(key, html) {
  modalKey = key;
  $('modalbox').innerHTML = html;
  $('modal').classList.remove('hidden');
}
function closeModal() { modalKey = null; $('modal').classList.add('hidden'); $('modalbox').innerHTML = ''; }
$('modal').addEventListener('click', (e) => { if (e.target === $('modal') && modalKey && modalKey.startsWith('u:')) closeModal(); });

function syncModals() {
  const v = V;
  if (v.winner != null) { if (modalKey !== 'win') showWin(); return; }
  if (v.pending && v.pending.type === 'discard' && v.pending.need > 0) { if (modalKey !== 'discard') showDiscard(v.pending.need); return; }
  if (v.pending && v.pending.type === 'steal' && v.active === v.me) { if (modalKey !== 'steal') showSteal(); return; }
  if (v.trade && v.trade.from !== v.me && v.trade.id !== ignoredTrade) {
    const k = 'in:' + v.trade.id;
    if (modalKey !== k) showIncoming();
    return;
  }
  if (modalKey && !modalKey.startsWith('u:')) closeModal();
}
function stepper(id, name, max) {
  return '<div class="step"><span class="n">' + name + '</span><button data-s="' + id + '" data-d="-1">−</button><span class="c" id="c_' + id + '">0</span><button data-s="' + id + '" data-d="1">+</button></div>';
}
function bindSteppers(vals, max, onChange) {
  $('modalbox').querySelectorAll('button[data-s]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.s, d = +b.dataset.d;
      const nv = Math.max(0, Math.min(max[id] == null ? 9 : max[id], (vals[id] || 0) + d));
      vals[id] = nv; $('c_' + id).textContent = nv;
      if (onChange) onChange();
    };
  });
}
function showDiscard(need) {
  const vals = {};
  let h = '<h3>Défausse ' + need + ' cartes</h3><div>Un 7 a été lancé : tu as plus de 7 cartes.</div>';
  RES.forEach((r) => { h += stepper(r, EM[r] + ' ' + RN[r]); });
  h += '<button class="full primary" id="dOk" disabled>Défausser (<span id="dN">0</span>/' + need + ')</button>';
  openModal('discard', h);
  const upd = () => {
    const s = RES.reduce((a, r) => a + (vals[r] || 0), 0);
    $('dN').textContent = s; $('dOk').disabled = s !== need;
  };
  bindSteppers(vals, V.res, upd);
  $('dOk').onclick = () => { send({ t: 'discard', res: vals }); };
}
function showSteal() {
  let h = '<h3>Qui voler ?</h3><div class="row">';
  V.pending.cand.forEach((i) => { h += '<button data-p="' + i + '" style="border-left:8px solid ' + V.players[i].color + '">' + esc(nameOf(i)) + '</button>'; });
  h += '</div>';
  openModal('steal', h);
  $('modalbox').querySelectorAll('button[data-p]').forEach((b) => { b.onclick = () => send({ t: 'steal', p: +b.dataset.p }); });
}
function showIncoming() {
  const t = V.trade;
  const afford = RES.every((r) => V.res[r] >= (t.get[r] || 0));
  let h = '<h3>' + esc(nameOf(t.from)) + ' propose un échange</h3>' +
    '<div style="font-size:26px;margin:10px 0">Tu reçois ' + resTxt(t.give) + '<br>Tu donnes ' + resTxt(t.get) + '</div>' +
    '<button class="full primary" id="tAcc"' + (afford ? '' : ' disabled') + '>' + (afford ? 'Accepter' : 'Tu n\'as pas assez') + '</button>' +
    '<button class="full" id="tNo">Refuser</button>';
  openModal('in:' + t.id, h);
  $('tAcc').onclick = () => send({ t: 'accept' });
  $('tNo').onclick = () => { ignoredTrade = t.id; closeModal(); };
}
function showWin() {
  let h = '<h3>🏆 ' + esc(nameOf(V.winner)) + ' gagne !</h3>';
  V.players.map((p, i) => ({ p, s: V.winnerVp[i] })).sort((a, b) => b.s - a.s).forEach((x) => {
    h += '<div class="score"><span><span class="dot" style="display:inline-block;background:' + x.p.color + '"></span> ' + esc(x.p.name) + '</span><b>⭐ ' + x.s + '</b></div>';
  });
  h += '<button class="full primary" onclick="location.reload()">Retour au menu</button>';
  openModal('win', h);
}

function showTrade(tab) {
  tab = tab || (V.can.offer ? 'players' : 'bank');
  const tabs = '<div class="tabs"><button data-t="bank"' + (tab === 'bank' ? ' class="sel"' : '') + '>🏦 Banque</button>' +
    '<button data-t="players"' + (tab === 'players' ? ' class="sel"' : '') + (V.can.offer ? '' : ' disabled') + '>👥 Joueurs</button></div>';
  let h = '<h3>Échange</h3>' + tabs;
  const vals = { give: {}, get: {} };
  if (tab === 'bank') {
    let give = null, get = null;
    h += '<div>Je donne (taux)</div><div class="row">' + RES.map((r) => '<button data-g="' + r + '"' + (V.res[r] >= V.ratios[r] ? '' : ' disabled') + '>' + EM[r] + '<small style="font-size:12px;display:block">×' + V.ratios[r] + '</small></button>').join('') + '</div>' +
      '<div>Je reçois (1)</div><div class="row">' + RES.map((r) => '<button data-r="' + r + '">' + EM[r] + '</button>').join('') + '</div>' +
      '<button class="full primary" id="bOk" disabled>Échanger</button>';
    openModal('u:trade', h);
    const upd = () => { $('bOk').disabled = !(give && get && give !== get); };
    $('modalbox').querySelectorAll('button[data-g]').forEach((b) => { b.onclick = () => { give = b.dataset.g; $('modalbox').querySelectorAll('button[data-g]').forEach((x) => x.classList.toggle('sel', x === b)); upd(); }; });
    $('modalbox').querySelectorAll('button[data-r]').forEach((b) => { b.onclick = () => { get = b.dataset.r; $('modalbox').querySelectorAll('button[data-r]').forEach((x) => x.classList.toggle('sel', x === b)); upd(); }; });
    $('bOk').onclick = () => { send({ t: 'bank', give, get }); closeModal(); };
  } else {
    h += '<div>Je donne</div>' + RES.map((r) => stepper('g_' + r, EM[r] + ' ' + RN[r])).join('') +
      '<div style="margin-top:8px">Je veux</div>' + RES.map((r) => stepper('w_' + r, EM[r] + ' ' + RN[r])).join('') +
      '<button class="full primary" id="oOk">Proposer à tous</button>';
    openModal('u:trade', h);
    const vv = {}, mx = {};
    RES.forEach((r) => { mx['g_' + r] = V.res[r]; });
    bindSteppers(vv, mx);
    $('oOk').onclick = () => {
      const give = {}, get = {};
      RES.forEach((r) => { give[r] = vv['g_' + r] || 0; get[r] = vv['w_' + r] || 0; });
      send({ t: 'offer', give, get }); closeModal();
    };
  }
  $('modalbox').querySelectorAll('button[data-t]').forEach((b) => { b.onclick = () => { if (!b.disabled) showTrade(b.dataset.t); }; });
}
const DEVN = { knight: ['⚔️', 'Chevalier', 'Déplace le voleur et vole une carte'], road: ['🛣️', 'Construction de routes', '2 routes gratuites'], yop: ['🎁', 'Invention', 'Prends 2 ressources de la banque'], mono: ['💰', 'Monopole', 'Prends toutes les cartes d\'un type'], vp: ['⭐', 'Point de victoire', 'Compte automatiquement'] };
function showDev() {
  let h = '<h3>Mes cartes développement</h3>';
  if (!V.dev.length) h += '<div>Aucune carte.</div>';
  V.dev.forEach((d, i) => {
    const x = DEVN[d.k];
    h += '<div class="dv"><span>' + x[0] + ' <b>' + x[1] + '</b><br><small>' + x[2] + '</small></span>' +
      (d.k === 'vp' ? '' : '<button data-d="' + d.k + '"' + (d.playable ? '' : ' disabled') + '>' + (d.playable ? 'Jouer' : 'Pas encore') + '</button>') + '</div>';
  });
  openModal('u:dev', h);
  $('modalbox').querySelectorAll('button[data-d]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.d;
      if (k === 'knight') { closeModal(); send({ t: 'knight' }); }
      else if (k === 'road') { closeModal(); send({ t: 'roadbuilding' }); }
      else if (k === 'yop') showYop();
      else if (k === 'mono') showMono();
    };
  });
}
function showYop() {
  const picks = [];
  let h = '<h3>Invention : choisis 2 ressources</h3><div class="row">' + RES.map((r) => '<button data-r="' + r + '">' + EM[r] + '</button>').join('') + '</div><div id="yp" style="font-size:24px;min-height:34px"></div><button class="full primary" id="yOk" disabled>Valider</button>';
  openModal('u:yop', h);
  $('modalbox').querySelectorAll('button[data-r]').forEach((b) => {
    b.onclick = () => {
      if (picks.length >= 2) picks.shift();
      picks.push(b.dataset.r);
      $('yp').textContent = picks.map((r) => EM[r]).join(' ');
      $('yOk').disabled = picks.length !== 2;
    };
  });
  $('yOk').onclick = () => { closeModal(); send({ t: 'yop', a: picks[0], b: picks[1] }); };
}
function showMono() {
  let h = '<h3>Monopole : quelle ressource ?</h3><div class="row">' + RES.map((r) => '<button data-r="' + r + '">' + EM[r] + '</button>').join('') + '</div>';
  openModal('u:mono', h);
  $('modalbox').querySelectorAll('button[data-r]').forEach((b) => { b.onclick = () => { closeModal(); send({ t: 'mono', r: b.dataset.r }); }; });
}

// ---------- plateau (canvas) ----------
const cv = $('board');
const ctx = cv.getContext('2d');
let sc = 1, ox = 0, oy = 0, W = 0, H = 0, dpr = 1;
function layout() {
  if (!B) return;
  const wrap = $('boardwrap');
  const r = wrap.getBoundingClientRect();
  if (!r.width || !r.height) return;
  dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  }
  W = r.width; H = r.height;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  B.verts.forEach((v) => { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
  B.ports.forEach((p) => { const px = p.x + p.ox * 0.8, py = p.y + p.oy * 0.8; x0 = Math.min(x0, px - 0.4); x1 = Math.max(x1, px + 0.4); y0 = Math.min(y0, py - 0.3); y1 = Math.max(y1, py + 0.3); });
  sc = Math.min(W / (x1 - x0 + 0.2), H / (y1 - y0 + 0.2));
  ox = W / 2 - ((x0 + x1) / 2) * sc; oy = H / 2 - ((y0 + y1) / 2) * sc;
}
const X = (x) => ox + x * sc, Y = (y) => oy + y * sc;
let raf = 0;
function draw() {
  if (!B || !V || !W) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // tuiles
  B.hexes.forEach((hx) => {
    ctx.beginPath();
    hx.verts.forEach((vi, k) => { const v = B.verts[vi]; if (k) ctx.lineTo(X(v.x), Y(v.y)); else ctx.moveTo(X(v.x), Y(v.y)); });
    ctx.closePath();
    ctx.fillStyle = TILE[hx.res]; ctx.fill();
    ctx.strokeStyle = '#0b3b52'; ctx.lineWidth = Math.max(1, sc * 0.04); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = Math.round(sc * 0.42) + 'px sans-serif';
    ctx.fillStyle = '#000';
    ctx.fillText(EM[hx.res], X(hx.x), Y(hx.y - (hx.num ? 0.5 : 0)));
    if (hx.num) {
      ctx.beginPath(); ctx.arc(X(hx.x), Y(hx.y + 0.18), sc * 0.3, 0, 7);
      ctx.fillStyle = '#f6ecd0'; ctx.fill();
      ctx.strokeStyle = '#5c4a1c'; ctx.lineWidth = 1; ctx.stroke();
      const hot = hx.num === 6 || hx.num === 8;
      ctx.fillStyle = hot ? '#c0211a' : '#222';
      ctx.font = 'bold ' + Math.round(sc * (hot ? 0.34 : 0.3)) + 'px sans-serif';
      ctx.fillText(hx.num, X(hx.x), Y(hx.y + 0.16));
    }
  });
  // ports
  B.ports.forEach((p) => {
    const px = p.x + p.ox * 0.75, py = p.y + p.oy * 0.75;
    ctx.strokeStyle = '#f6ecd0'; ctx.lineWidth = Math.max(1, sc * 0.03); ctx.setLineDash([sc * 0.08, sc * 0.06]);
    ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(px), Y(py)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#0b2e42'; ctx.strokeStyle = '#f6ecd0';
    const rw = sc * 0.36, rh = sc * 0.26;
    ctx.beginPath(); ctx.ellipse(X(px), Y(py), rw, rh, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(sc * 0.2) + 'px sans-serif';
    ctx.fillText(p.type === 'any' ? '3:1' : '2:1', X(px), Y(py - 0.07));
    if (p.type !== 'any') { ctx.font = Math.round(sc * 0.18) + 'px sans-serif'; ctx.fillText(EM[p.type], X(px), Y(py + 0.1)); }
  });
  // routes
  V.eo.forEach((o, i) => {
    if (o < 0) return;
    const e = B.edges[i], a = B.verts[e.a], b = B.verts[e.b];
    ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y));
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = sc * 0.19; ctx.stroke();
    ctx.strokeStyle = V.players[o].color; ctx.lineWidth = sc * 0.12; ctx.stroke();
  });
  // bâtiments
  V.vo.forEach((o, i) => {
    if (o < 0) return;
    const v = B.verts[i], u = sc * 0.14;
    const pts = V.vt[i] === 2
      ? [[-1.5, 1], [-1.5, -0.2], [-0.4, -0.2], [-0.4, -1.0], [0.3, -1.7], [1.0, -1.0], [1.0, -0.2], [1.5, -0.2], [1.5, 1]]
      : [[-1, 1], [-1, -0.2], [0, -1.3], [1, -0.2], [1, 1]];
    ctx.beginPath();
    pts.forEach((p, k) => { const x = X(v.x) + p[0] * u, y = Y(v.y) + p[1] * u; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = V.players[o].color; ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.5, sc * 0.03); ctx.stroke();
  });
  // voleur
  const rb = B.hexes[V.robber];
  if (rb) {
    const x = X(rb.x + 0.5), y = Y(rb.y + 0.15);
    ctx.fillStyle = '#1b1b1b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(x, y + sc * 0.12, sc * 0.17, sc * 0.22, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - sc * 0.17, sc * 0.11, 0, 7); ctx.fill(); ctx.stroke();
  }
  // surbrillance
  const mode = effMode();
  if (mode) {
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
    const col = V.players[V.me].color;
    legalFor(mode).forEach((id) => {
      let x, y, r;
      if (mode === 'road') { const e = B.edges[id], a = B.verts[e.a], b = B.verts[e.b]; x = X((a.x + b.x) / 2); y = Y((a.y + b.y) / 2); r = sc * (0.17 + 0.05 * pulse); }
      else if (mode === 'robber') { const h = B.hexes[id]; x = X(h.x); y = Y(h.y); r = sc * (0.55 + 0.05 * pulse); }
      else { const v = B.verts[id]; x = X(v.x); y = Y(v.y); r = sc * (0.19 + 0.05 * pulse); }
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
      ctx.fillStyle = mode === 'robber' ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.55)'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = sc * 0.05; ctx.stroke();
    });
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }
}
cv.addEventListener('click', (e) => {
  const mode = effMode();
  if (!mode || !V) return;
  const r = cv.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  let best = null, bd = 1e9;
  legalFor(mode).forEach((id) => {
    let x, y;
    if (mode === 'road') { const ed = B.edges[id], a = B.verts[ed.a], b = B.verts[ed.b]; x = X((a.x + b.x) / 2); y = Y((a.y + b.y) / 2); }
    else if (mode === 'robber') { const h = B.hexes[id]; x = X(h.x); y = Y(h.y); }
    else { const v = B.verts[id]; x = X(v.x); y = Y(v.y); }
    const d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = id; }
  });
  const lim = sc * (mode === 'robber' ? 0.9 : 0.5);
  if (best == null || bd > lim) return;
  const msg = { road: { t: 'road', e: best }, settlement: { t: 'settlement', v: best }, city: { t: 'city', v: best }, robber: { t: 'robber', h: best } }[mode];
  userMode = null;
  send(msg);
});
window.__semmena = { send: (m) => send(m), view: () => V, board: () => B };
window.addEventListener('resize', () => { layout(); draw(); });
window.addEventListener('orientationchange', () => setTimeout(() => { layout(); draw(); }, 250));
})();
