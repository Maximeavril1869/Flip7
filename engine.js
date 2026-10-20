/* Flip 7 — moteur de jeu (sans DOM, utilisable dans le navigateur et sous Node) */
(function (root) {
  'use strict';

  /* ---------- Paquet : 94 cartes ---------- */
  function makeDeck() {
    const d = [];
    let id = 0;
    for (let n = 0; n <= 12; n++) {
      const copies = n === 0 ? 1 : n;
      for (let i = 0; i < copies; i++) d.push({ id: id++, t: 'num', v: n });
    }
    [2, 4, 6, 8, 10].forEach(v => d.push({ id: id++, t: 'mod', k: 'plus', v }));
    d.push({ id: id++, t: 'mod', k: 'x2' });
    ['freeze', 'freeze', 'freeze', 'flip3', 'flip3', 'flip3', 'second', 'second', 'second']
      .forEach(k => d.push({ id: id++, t: 'act', k }));
    return d;
  }

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function freshHand() {
    return { nums: [], mods: [], second: null, bustCard: null, status: 'active', flip7: false, roundScore: 0 };
  }

  class Aborted extends Error {}

  class Game {
    /**
     * cfg : { players:[{name,human}], target }
     * ui  : { notify(game,ev), chooseHitStay(game,p,canStay), chooseTarget(game,p,kind,eligIds), roundEnd(game,results,winner) }
     */
    constructor(cfg, ui, rng) {
      this.rng = rng || Math.random;
      this.ui = ui;
      this.target = cfg.target || 200;
      this.players = cfg.players.map((p, i) => Object.assign(
        { id: i, name: p.name, human: !!p.human, total: 0, aggr: 0.85 + this.rng() * 0.4 },
        freshHand()
      ));
      this.deck = shuffle(makeDeck(), this.rng);
      this.discard = [];
      this.dealer = Math.floor(this.rng() * this.players.length);
      this.round = 0;
      this.roundEnded = false;
      this.current = -1;
      this.lastEvent = null;
      this.aborted = false;
    }

    abort() { this.aborted = true; }

    async ev(type, data) {
      if (this.aborted) throw new Aborted();
      this.lastEvent = Object.assign({ type }, data || {});
      if (this.ui && this.ui.notify) await this.ui.notify(this, this.lastEvent);
      if (this.aborted) throw new Aborted();
    }

    /* ---------- Score ---------- */
    scoreOf(p) {
      if (p.status === 'busted') return 0;
      let s = p.nums.reduce((a, c) => a + c.v, 0);
      if (p.mods.some(m => m.k === 'x2')) s *= 2;
      s += p.mods.filter(m => m.k === 'plus').reduce((a, m) => a + m.v, 0);
      if (p.flip7) s += 15;
      return s;
    }

    countCards() {
      let n = this.deck.length + this.discard.length;
      for (const p of this.players) {
        n += p.nums.length + p.mods.length + (p.second ? 1 : 0) + (p.bustCard ? 1 : 0);
      }
      return n;
    }

    /* ---------- Pioche ---------- */
    async draw() {
      if (!this.deck.length && this.discard.length) {
        this.deck = shuffle(this.discard, this.rng);
        this.discard = [];
        await this.ev('reshuffle');
      }
      return this.deck.pop() || null;
    }

    /* ---------- Donner une carte à un joueur ---------- */
    async give(p, card, deferred) {
      if (card.t === 'num') {
        if (p.nums.some(c => c.v === card.v)) {
          if (p.second) {
            this.discard.push(card, p.second);
            p.second = null;
            await this.ev('secondUsed', { p, card });
          } else {
            p.bustCard = card;
            p.status = 'busted';
            await this.ev('bust', { p, card });
          }
        } else {
          p.nums.push(card);
          await this.ev('draw', { p, card });
          if (p.nums.length === 7) {
            p.flip7 = true;
            this.roundEnded = true;
            await this.ev('flip7', { p });
          }
        }
        return;
      }
      if (card.t === 'mod') {
        p.mods.push(card);
        await this.ev('draw', { p, card });
        return;
      }
      // cartes action
      if (card.k === 'second') {
        if (!p.second) {
          p.second = card;
          await this.ev('draw', { p, card });
        } else {
          await this.ev('draw', { p, card });
          const elig = this.players.filter(q => q.id !== p.id && q.status === 'active' && !q.second);
          if (!elig.length) {
            this.discard.push(card);
          } else {
            const t = await this.pickTarget(p, 'second', elig);
            t.second = card;
            await this.ev('giveSecond', { p, t, card });
          }
        }
        return;
      }
      // Gel / Triple pioche
      await this.ev('draw', { p, card });
      if (deferred) deferred.push(card);
      else await this.resolveAct(p, card);
    }

    async pickTarget(p, kind, elig) {
      if (elig.length === 1) return elig[0];
      let id;
      if (p.human) id = await this.ui.chooseTarget(this, p, kind, elig.map(q => q.id));
      else id = Bots.target(this, p, kind, elig);
      if (this.aborted) throw new Aborted();
      return this.players[id] || elig[0];
    }

    async resolveAct(p, card) {
      const elig = this.players.filter(q => q.status === 'active');
      if (!elig.length) { this.discard.push(card); return; }
      const t = await this.pickTarget(p, card.k, elig);
      if (card.k === 'freeze') {
        t.status = 'frozen';
        this.discard.push(card);
        await this.ev('freeze', { p, t, card });
      } else {
        this.discard.push(card);
        await this.ev('flip3', { p, t, card });
        await this.flipThree(t);
      }
    }

    async flipThree(t) {
      const deferred = [];
      for (let i = 0; i < 3; i++) {
        if (t.status !== 'active' || this.roundEnded) break;
        const c = await this.draw();
        if (!c) { this.roundEnded = true; break; }
        await this.give(t, c, deferred);
      }
      for (const c of deferred) {
        if (t.status !== 'active' || this.roundEnded) { this.discard.push(c); continue; }
        await this.resolveAct(t, c);
      }
    }

    /* ---------- Manche ---------- */
    collectHands() {
      for (const p of this.players) {
        this.discard.push(...p.nums, ...p.mods);
        if (p.second) this.discard.push(p.second);
        if (p.bustCard) this.discard.push(p.bustCard);
        Object.assign(p, freshHand());
      }
    }

    async playRound() {
      this.collectHands();
      this.round++;
      this.roundEnded = false;
      this.current = -1;
      const n = this.players.length;
      await this.ev('roundStart', { dealer: this.players[this.dealer] });

      // distribution initiale
      for (let k = 1; k <= n; k++) {
        const p = this.players[(this.dealer + k) % n];
        if (this.roundEnded) break;
        if (p.status !== 'active') continue;
        const c = await this.draw();
        if (!c) { this.roundEnded = true; break; }
        await this.give(p, c, null);
      }

      // tours de table
      let guard = 0;
      while (!this.roundEnded && this.players.some(p => p.status === 'active') && guard++ < 400) {
        for (let k = 1; k <= n; k++) {
          const p = this.players[(this.dealer + k) % n];
          if (this.roundEnded) break;
          if (p.status !== 'active') continue;
          this.current = p.id;
          const canStay = p.nums.length + p.mods.length > 0;
          let choice;
          if (p.human) {
            await this.ev('turn', { p });
            choice = await this.ui.chooseHitStay(this, p, canStay);
            if (this.aborted) throw new Aborted();
          } else {
            choice = canStay && !Bots.wantsHit(this, p) ? 'stay' : 'hit';
          }
          if (choice === 'stay' && canStay) {
            p.status = 'stayed';
            await this.ev('stay', { p });
          } else {
            const c = await this.draw();
            if (!c) { this.roundEnded = true; break; }
            await this.give(p, c, null);
          }
        }
      }
      this.current = -1;

      // décompte
      const results = this.players.map(p => {
        p.roundScore = this.scoreOf(p);
        p.total += p.roundScore;
        return { p, round: p.roundScore, total: p.total, busted: p.status === 'busted', flip7: p.flip7 };
      });
      const max = Math.max(...this.players.map(p => p.total));
      let winner = null;
      if (max >= this.target) {
        const top = this.players.filter(p => p.total === max);
        if (top.length === 1) winner = top[0];
      }
      this.dealer = (this.dealer + 1) % n;
      return { results, winner };
    }

    async run() {
      try {
        for (;;) {
          const { results, winner } = await this.playRound();
          await this.ev('roundEnd', {});
          await this.ui.roundEnd(this, results, winner);
          if (winner) return winner;
        }
      } catch (e) {
        if (e instanceof Aborted) return null;
        throw e;
      }
    }
  }

  /* ---------- Ordinateur ---------- */
  const Bots = {
    wantsHit(g, p) {
      if (!p.nums.length && !p.mods.length) return true;
      if (p.second) return true;
      if (!g.deck.length) return false;
      const have = new Set(p.nums.map(c => c.v));
      let dup = 0;
      for (const c of g.deck) if (c.t === 'num' && have.has(c.v)) dup++;
      const pb = dup / g.deck.length;
      const score = g.scoreOf(p);
      if (g.scoreOf(p) + p.total >= g.target && score > 0) return false;
      if (score < 8) return true;
      let gain = 6;
      if (p.nums.length === 6) gain += 15 * (1 - pb);
      return (1 - pb) * gain * p.aggr > pb * score;
    },

    target(g, p, kind, elig) {
      const others = elig.filter(q => q.id !== p.id);
      if (kind === 'second') {
        // donner à celui qui a le moins de points au total
        return others.slice().sort((a, b) => a.total - b.total)[0].id;
      }
      if (kind === 'freeze') {
        if (!others.length) return p.id;
        const mine = g.scoreOf(p);
        if (mine >= 18 && p.status === 'active') return p.id;
        return others.slice().sort((a, b) =>
          (g.scoreOf(b) + b.total * 0.3) - (g.scoreOf(a) + a.total * 0.3))[0].id;
      }
      // flip3
      if (!others.length) return p.id;
      const risk = q => (q.second ? -5 : 0) + q.nums.length;
      return others.slice().sort((a, b) => risk(b) - risk(a))[0].id;
    }
  };

  const api = { Game, makeDeck, Bots, Aborted };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Flip7Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
