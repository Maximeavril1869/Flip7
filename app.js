/* Flip 7 — interface (PWA locale) */
(function () {
  'use strict';
  const { Game } = window.Flip7Engine;
  const $ = s => document.querySelector(s);
  const KEY = 'flip7.setup.v1';
  const COLORS = ['#6b7280', '#e4572e', '#f08a24', '#d9a900', '#8aa61a', '#3a9d4f', '#12a38a', '#1b9bb8', '#2f7fd8', '#4c63d9', '#7a4fd6', '#b04fc4', '#d6458f'];

  /* ---------- Réglages ---------- */
  const defaults = () => ({
    n: 2, face: false, target: 200,
    players: [
      { name: 'Joueur 1', human: true }, { name: 'Joueur 2', human: false }, { name: 'Joueur 3', human: false },
      { name: 'Joueur 4', human: false }, { name: 'Joueur 5', human: false }, { name: 'Joueur 6', human: false }
    ]
  });
  let setup = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.players && s.players.length === 6) setup = Object.assign(defaults(), s);
  } catch (e) { /* ignore */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(setup)); } catch (e) { /* ignore */ } };

  let game = null;
  let pending = null;
  let roundResolve = null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Menu ---------- */
  function renderSetup() {
    const rows = setup.players.slice(0, setup.n).map((p, i) => `
      <div class="prow">
        <input data-name="${i}" value="${esc(p.name)}" maxlength="14" aria-label="Nom du joueur ${i + 1}">
        <button class="kind ${p.human ? 'human' : 'bot'}" data-kind="${i}">${p.human ? '👤 Humain' : '🤖 Ordi'}</button>
      </div>`).join('');
    $('#setup').innerHTML = `
      <div class="setup-card">
        <div class="logo">Flip <b>7</b></div>
        <div class="field"><label>Nombre de joueurs</label>
          <div class="pills">${[2, 3, 4, 5, 6].map(n => `<button class="pill ${setup.n === n ? 'on' : ''}" data-n="${n}">${n}</button>`).join('')}</div>
        </div>
        <div class="field"><label>Joueurs</label>${rows}</div>
        <div class="switch" data-face>
          <div><b>Face à face</b><small>iPad posé à plat : chacun joue de son côté</small></div>
          <div class="toggle ${setup.face ? 'on' : ''}"></div>
        </div>
        <div class="field"><label>Objectif</label>
          <div class="pills">${[100, 200, 300].map(t => `<button class="pill ${setup.target === t ? 'on' : ''}" data-target="${t}">${t} pts</button>`).join('')}</div>
        </div>
        <button class="big" id="btnStart">Jouer</button>
        <button class="ghost" id="btnRules2">Règles du jeu</button>
      </div>`;
  }

  $('#setup').addEventListener('click', e => {
    const t = e.target.closest('button, .switch');
    if (!t) return;
    if (t.dataset.n) setup.n = +t.dataset.n;
    else if (t.dataset.kind !== undefined) setup.players[+t.dataset.kind].human = !setup.players[+t.dataset.kind].human;
    else if (t.dataset.target) setup.target = +t.dataset.target;
    else if (t.hasAttribute('data-face')) setup.face = !setup.face;
    else if (t.id === 'btnStart') { save(); startGame(); return; }
    else if (t.id === 'btnRules2') { showRules(); return; }
    else return;
    save(); renderSetup();
  });
  $('#setup').addEventListener('input', e => {
    if (e.target.dataset.name !== undefined) {
      setup.players[+e.target.dataset.name].name = e.target.value;
      save();
    }
  });

  /* ---------- Partie ---------- */
  function startGame() {
    const players = setup.players.slice(0, setup.n).map((p, i) => ({
      name: (p.name || '').trim() || 'Joueur ' + (i + 1), human: p.human
    }));
    if (game) game.abort();
    pending = null;
    game = new Game({ players, target: setup.target }, ui);
    $('#setup').hidden = true;
    $('#game').hidden = false;
    $('#overlay').hidden = true;
    $('#board').className = 'board' + (setup.face ? ' face' : '');
    $('#board').dataset.n = setup.n;
    const g = game;
    g.run().catch(err => { console.error(err); });
  }

  function goHome() {
    if (game) game.abort();
    game = null; pending = null;
    if (roundResolve) { roundResolve(); roundResolve = null; }
    $('#overlay').hidden = true;
    $('#game').hidden = true;
    $('#setup').hidden = false;
    renderSetup();
  }

  const DELAYS = { roundStart: 800, draw: 650, bust: 1200, stay: 500, freeze: 1000, flip3: 1000, flip7: 1600, secondUsed: 1000, giveSecond: 900, reshuffle: 900, turn: 0, roundEnd: 600 };
  const ui = {
    async notify(g, ev) {
      if (g !== game) return;
      render();
      const d = DELAYS[ev.type] || 0;
      if (d) await sleep(d);
    },
    chooseHitStay(g, p, canStay) {
      return new Promise(res => { pending = { mode: 'hs', pid: p.id, canStay, res }; render(); });
    },
    chooseTarget(g, p, kind, elig) {
      return new Promise(res => { pending = { mode: 'target', pid: p.id, kind, elig, res }; render(); });
    },
    roundEnd(g, results, winner) {
      return new Promise(res => {
        roundResolve = () => { $('#overlay').hidden = true; res(); };
        showRoundEnd(g, results, winner);
      });
    }
  };

  function answer(v) {
    if (!pending) return;
    const p = pending; pending = null;
    render();
    p.res(v);
  }

  /* ---------- Rendu ---------- */
  function cardLabel(c) {
    if (c.t === 'num') return String(c.v);
    if (c.t === 'mod') return c.k === 'x2' ? '×2' : '+' + c.v;
    return { freeze: 'Gel ❄', flip3: 'Triple pioche', second: 'Seconde chance' }[c.k];
  }

  function cardHtml(c, extra) {
    const cls = ['card', extra || ''];
    let style = '', txt;
    if (c.t === 'num') { style = `--c:${COLORS[c.v]}`; txt = c.v; }
    else if (c.t === 'mod') { cls.push('mod'); txt = c.k === 'x2' ? '×2' : '+' + c.v; }
    else { cls.push('second'); txt = '♥'; }
    if (game.lastEvent && game.lastEvent.type === 'draw' && game.lastEvent.card && game.lastEvent.card.id === c.id) cls.push('new');
    return `<div class="${cls.join(' ')}" style="${style}" title="${esc(cardLabel(c))}">${txt}</div>`;
  }

  function msgText() {
    const g = game, ev = g.lastEvent;
    if (pending && pending.mode === 'hs') return `${g.players[pending.pid].name}, tu pioches ou tu restes ?`;
    if (pending && pending.mode === 'target') {
      const n = g.players[pending.pid].name;
      return { freeze: `${n}, qui veux-tu geler ? ❄`, flip3: `${n}, qui doit piocher trois cartes ?`, second: `${n}, à qui donner la Seconde chance ? ♥` }[pending.kind];
    }
    if (!ev) return '';
    switch (ev.type) {
      case 'roundStart': return `Manche ${g.round} — ${ev.dealer.name} distribue`;
      case 'draw': return `${ev.p.name} pioche : ${cardLabel(ev.card)}`;
      case 'bust': return `💥 ${ev.p.name} saute ! (second ${ev.card.v})`;
      case 'secondUsed': return `♥ ${ev.p.name} utilise sa Seconde chance`;
      case 'giveSecond': return `${ev.p.name} offre une Seconde chance à ${ev.t.name}`;
      case 'stay': return `${ev.p.name} reste`;
      case 'freeze': return `❄ ${ev.p.name} gèle ${ev.t.id === ev.p.id ? 'sa propre main' : ev.t.name}`;
      case 'flip3': return `${ev.p.name} envoie Triple pioche à ${ev.t.id === ev.p.id ? 'lui-même' : ev.t.name}`;
      case 'flip7': return `🎉 FLIP 7 ! ${ev.p.name} gagne 15 points`;
      case 'reshuffle': return 'La défausse est remélangée';
      case 'turn': return `${ev.p.name}, à toi !`;
      default: return '';
    }
  }

  function zoneHtml(p) {
    const g = game;
    const cards = [
      ...p.nums.slice().sort((a, b) => a.v - b.v).map(c => cardHtml(c)),
      ...p.mods.map(c => cardHtml(c)),
      p.second ? cardHtml(p.second) : '',
      p.bustCard ? cardHtml(p.bustCard, 'dup') : ''
    ].join('');
    let badge = '';
    if (p.status === 'busted') badge = '<span class="badge busted">Sauté</span>';
    else if (p.status === 'frozen') badge = '<span class="badge frozen">Gelé ❄</span>';
    else if (p.status === 'stayed') badge = '<span class="badge stayed">Reste</span>';
    if (p.flip7) badge = '<span class="badge flip7">FLIP 7 !</span>';
    const sc = g.scoreOf(p);
    const targetable = pending && pending.mode === 'target' && pending.elig.includes(p.id);
    const isTurn = pending && pending.mode === 'hs' && pending.pid === p.id;
    const cls = ['zone', 's-' + p.status, (g.current === p.id || isTurn) && p.status === 'active' ? 'turn' : '', targetable ? 'targetable' : ''];
    const actions = isTurn ? `
      <div class="zactions">
        <button class="btn-hit" data-act="hit">Piocher</button>
        <button class="btn-stay" data-act="stay" ${pending.canStay ? '' : 'disabled'}>Rester${sc ? ' (' + sc + ')' : ''}</button>
      </div>` : '';
    return `<div class="${cls.join(' ')}" data-pid="${p.id}">
      <div class="zhead"><span class="name">${esc(p.name)} ${p.human ? '' : '<small>🤖</small>'}</span><span class="total">${p.total}</span></div>
      <div class="zstat">${badge}<span class="pts">${p.status === 'busted' ? '' : '+' + sc + ' cette manche'}</span></div>
      <div class="cards">${cards}</div>
      ${actions}
    </div>`;
  }

  function render() {
    if (!game) return;
    const g = game, n = g.players.length;
    $('#info').innerHTML = `Manche <b>${Math.max(g.round, 1)}</b> · Pioche <b>${g.deck.length}</b> · Objectif <b>${g.target}</b>`;
    const msg = msgText();
    const sub = pending ? '' : '';
    let rowsHtml;
    if (setup.face && n >= 2) {
      const b = Math.ceil(n / 2);
      const bottom = g.players.slice(0, b);
      const top = g.players.slice(b).reverse();
      rowsHtml = `
        <div class="row top">${top.map(zoneHtml).join('')}</div>
        <div class="center"><div class="msg flip">${esc(msg)}</div><div class="msg">${esc(msg)}</div></div>
        <div class="row bottom">${bottom.map(zoneHtml).join('')}</div>`;
    } else {
      rowsHtml = `
        <div class="center"><div class="msg">${esc(msg)}</div>${sub}</div>
        <div class="row bottom">${g.players.map(zoneHtml).join('')}</div>`;
    }
    $('#board').innerHTML = rowsHtml;
  }

  $('#board').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (btn && pending && pending.mode === 'hs') { answer(btn.dataset.act); return; }
    const z = e.target.closest('.zone.targetable');
    if (z && pending && pending.mode === 'target') answer(+z.dataset.pid);
  });

  /* ---------- Fin de manche ---------- */
  function showRoundEnd(g, results, winner) {
    const sorted = results.slice().sort((a, b) => b.total - a.total);
    const rows = sorted.map(r => `
      <tr class="${winner && r.p.id === winner.id ? 'win' : ''}">
        <td>${esc(r.p.name)}${r.flip7 ? ' 🎉' : ''}${r.busted ? ' 💥' : ''}</td>
        <td>${r.busted ? '0' : '+' + r.round}</td>
        <td>${r.total}</td>
      </tr>`).join('');
    const title = winner ? `🏆 ${esc(winner.name)} gagne la partie !` : `Fin de la manche ${g.round}`;
    const label = winner ? 'Nouvelle partie' : 'Manche suivante';
    const tie = !winner && Math.max(...g.players.map(p => p.total)) >= g.target
      ? '<p class="small-txt">Égalité en tête : on rejoue une manche pour départager.</p>' : '';
    const btn = (cls) => `<button class="big ${cls}" data-next>${label}</button>`;
    const ov = $('#overlay');
    ov.innerHTML = `
      ${setup.face ? btn('flip') : ''}
      <div class="panel">
        <h2>${title}</h2>
        <table class="res"><tr><th>Joueur</th><th>Manche</th><th>Total</th></tr>${rows}</table>
        ${tie}
      </div>
      ${btn('')}`;
    ov.hidden = false;
    ov.onclick = e => {
      if (!e.target.closest('[data-next]')) return;
      ov.onclick = null;
      ov.hidden = true;
      const r = roundResolve; roundResolve = null;
      if (winner) { r && r(); startGame(); } else r && r();
    };
  }

  /* ---------- Règles & confirmation ---------- */
  function showRules() {
    const m = $('#modal');
    m.innerHTML = `<div class="panel">
      <h2>Règles de Flip 7</h2>
      <p>Tu pioches des cartes une à une pour faire le plus de points possible, sans tomber deux fois sur le même numéro.</p>
      <h3>Ton tour</h3>
      <ul>
        <li><b>Piocher</b> : tu ajoutes une carte à ta main.</li>
        <li><b>Rester</b> : tu mets tes points de côté et tu sors de la manche.</li>
        <li>Si tu pioches un <b>numéro que tu as déjà</b>, tu sautes : 0 point pour la manche.</li>
      </ul>
      <h3>Les cartes</h3>
      <ul>
        <li><b>Numéros 0 à 12</b> : valent leur valeur (il y a autant d'exemplaires que le numéro).</li>
        <li><b>+2 / +4 / +6 / +8 / +10</b> : points en plus. <b>×2</b> double tes numéros.</li>
        <li><b>Gel ❄</b> : un joueur actif de ton choix (toi compris) est gelé : il empoche ses points et sort.</li>
        <li><b>Triple pioche</b> : un joueur actif de ton choix (toi compris) pioche 3 cartes d'affilée.</li>
        <li><b>Seconde chance ♥</b> : annule un doublon (une seule à la fois ; une deuxième est offerte à un autre joueur).</li>
      </ul>
      <h3>Flip 7</h3>
      <p>7 numéros différents dans ta main : <b>+15 points</b> et la manche s'arrête aussitôt.</p>
      <h3>Fin de partie</h3>
      <p>La partie se termine à la fin de la manche où quelqu'un atteint l'objectif (200 par défaut). Le plus haut total gagne.</p>
      <div class="confirm"><button data-close>Fermer</button></div>
    </div>`;
    m.hidden = false;
    m.onclick = e => { if (e.target.closest('[data-close]') || e.target === m) m.hidden = true; };
  }
  $('#btnRules').onclick = showRules;

  $('#btnHome').onclick = () => {
    const m = $('#modal');
    m.innerHTML = `<div class="panel"><h2>Quitter la partie ?</h2>
      <p class="small-txt">La partie en cours sera perdue.</p>
      <div class="confirm"><button data-close>Continuer</button><button class="danger" data-quit>Quitter</button></div></div>`;
    m.hidden = false;
    m.onclick = e => {
      if (e.target.closest('[data-quit]')) { m.hidden = true; goHome(); }
      else if (e.target.closest('[data-close]') || e.target === m) m.hidden = true;
    };
  };

  /* ---------- Démarrage ---------- */
  renderSetup();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
