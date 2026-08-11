/* ═══════════════════════════════════════════════════════════════════════
   Snail Race Fundraiser — Newcomb & District Cricket Club
   Zero dependencies. Runs from file://. All state stays on this device.

   HOW THE RACE IS DECIDED (read this before anyone asks you on the night):
   The finishing order is drawn by a seeded shuffle the instant you press
   Start, before a single snail moves. The seed is printed on screen. The
   animation that follows is decorative — it cannot change the result, and
   the draw never reads the donations. See drawRace() and the fairness
   notes above it.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────────────────── Configuration ─────────────────────────── */

  var STORE_KEY = 'ndcc-snailrace-v2';
  var MIN_FIELD = 4;
  var MAX_FIELD = 8;

  /* Where the snail's nose sits inside its token, as a fraction of token
     width (the SVG nose is at x=122 of a 132-wide viewBox). Everything in
     the geometry hangs off this one number. */
  var NOSE = 0.924;

  /* Lane colours spread across hue AND lightness so they stay distinct
     through projector gamma and for colour-blind viewers. Lane number and
     name pill carry the same identity, so colour is never the only cue. */
  var PALETTE = [
    { shell: '#ff4d3d', dark: '#a52418', body: '#ffd9c2' },
    { shell: '#ffb020', dark: '#a86800', body: '#ffe9c4' },
    { shell: '#26c6a6', dark: '#0b6b58', body: '#c8f2e8' },
    { shell: '#4c8dff', dark: '#1c4699', body: '#d3e2ff' },
    { shell: '#c46bff', dark: '#6f2ba3', body: '#ecd8ff' },
    { shell: '#b7e43b', dark: '#5f7d0d', body: '#eef8cf' },
    { shell: '#ff7ab8', dark: '#a32f68', body: '#ffdcec' },
    { shell: '#00c2d1', dark: '#046b75', body: '#c6f2f6' }
  ];

  var DEFAULT_NAMES = ['Speedy', 'Turbo', 'Lightning', 'Flash', 'Rocket', 'Bolt', 'Comet', 'Dasher'];

  var NAME_POOL = [
    'Speedy', 'Turbo', 'Lightning', 'Flash', 'Rocket', 'Bolt', 'Comet', 'Dasher',
    'Escar-go', 'Slime Shady', 'Sheldon', 'Usain Bolt-ish', 'Shellby', 'Gary',
    'Slugger', 'Snailsy', 'The Gastropod', 'Slow Burn', 'Mollusc Magic',
    'Shell Warne', 'Slime Ponting', 'Adam Gil-crawl', 'Snail Bradman',
    'Mitchell Starch', 'Pat Slummins', 'Nathan Slyon', 'Steve Smithereens',
    'Trundler', 'Nightwatchman', 'Silly Mid-Off', 'The Yorker', 'Golden Duck'
  ];

  var QUICK_AMOUNTS = [5, 10, 20, 50, 100];

  var COMMENTARY = {
    early: ['{a} out of the gate first!', 'They\'re away — {a} shows early pace.', '{a} leads them out.'],
    mid: ['{a} hits the front!', '{b} is reeling in {a}!', 'Nothing between {a} and {b}!',
          '{a} kicks clear!', '{b} finds another gear!', '{a} under pressure from {b}!'],
    late: ['{a} into the final straight!', '{b} is closing fast!', 'This is going to be tight!',
           '{a} holding on!', '{b} charging home!']
  };

  /* ───────────────────────────── State ───────────────────────────────── */

  function freshState() {
    return {
      version: 2,
      clubName: 'Newcomb & District Cricket Club',
      eventName: 'Snail Racing Fundraiser',
      fieldSize: 6,
      names: DEFAULT_NAMES.slice(),
      goal: 1000,
      goalShow: true,
      raceSpeed: 10000,
      raceType: 'Heat',
      raceNumber: 0,
      ledger: [],
      history: [],
      theme: 'day',
      calm: false,
      sound: true,
      drawerOpen: true,
      startedAt: Date.now()
    };
  }

  var state = freshState();

  /* Live race state — never persisted. */
  var race = {
    running: false,
    countdown: null,
    rafId: 0,
    snails: [],
    raceT: 0,
    last: 0,
    slow: 1,
    placed: 0,
    slowmoUsed: false,
    tMax: 0,
    seed: 0,
    results: [],
    commentaryAt: 0,
    lastLeader: -1
  };

  var travelPx = 0;
  var els = {};
  var laneEls = [];

  /* ────────────────────────── Small utilities ────────────────────────── */

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  var AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
  var AUD0 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
  function money(n) { return AUD.format(n || 0); }
  function moneyShort(n) { return (n % 1 === 0) ? AUD0.format(n || 0) : AUD.format(n || 0); }
  function cents(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function timeOfDay(ts) {
    return new Date(ts).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  }

  /* ──────────────────────────── Persistence ──────────────────────────── */

  var saveTimer = null;
  var storageOk = true;

  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 250);
  }

  function writeNow() {
    saveTimer = null;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      storageOk = true;
      els.savedStamp.textContent = 'Saved ' + timeOfDay(Date.now());
      els.savedStamp.classList.remove('warn');
    } catch (err) {
      storageOk = false;
      els.savedStamp.textContent = 'NOT SAVING — use “Save backup” before closing';
      els.savedStamp.classList.add('warn');
    }
  }

  function load() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (err) { return false; }
    if (!raw) return false;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      state = mergeState(parsed);
      return true;
    } catch (err) { return false; }
  }

  function mergeState(parsed) {
    var base = freshState();
    Object.keys(base).forEach(function (k) {
      if (parsed[k] !== undefined && parsed[k] !== null) base[k] = parsed[k];
    });
    base.fieldSize = clamp(parseInt(base.fieldSize, 10) || 6, MIN_FIELD, MAX_FIELD);
    if (!Array.isArray(base.names)) base.names = DEFAULT_NAMES.slice();
    while (base.names.length < MAX_FIELD) base.names.push(DEFAULT_NAMES[base.names.length]);
    if (!Array.isArray(base.ledger)) base.ledger = [];
    if (!Array.isArray(base.history)) base.history = [];
    return base;
  }

  /* ───────────────────────── Derived money views ─────────────────────── */

  function liveEntries() {
    return state.ledger.filter(function (e) { return !e.void; });
  }
  function nightTotal() {
    return liveEntries().reduce(function (s, e) { return s + e.amount; }, 0);
  }
  /* Donations backing a given race number. Nothing is ever wiped: every
     dollar stays attributed to a snail and a race for the whole night. */
  function entriesForRace(n) {
    return liveEntries().filter(function (e) { return e.race === n; });
  }
  function nextRaceNo() { return state.raceNumber + 1; }

  function potBySnail(raceNo) {
    var out = [];
    for (var i = 0; i < state.fieldSize; i++) out.push({ lane: i, amount: 0, backers: 0, names: [] });
    entriesForRace(raceNo).forEach(function (e) {
      if (e.lane < 0 || e.lane >= state.fieldSize) return;
      out[e.lane].amount += e.amount;
      out[e.lane].backers++;
      if (e.name) out[e.lane].names.push(e.name);
    });
    return out;
  }

  /* ───────────────────────────── Sound ───────────────────────────────── */

  var audio = null;

  function ensureAudio() {
    if (audio) return audio;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { audio = new Ctx(); } catch (err) { audio = null; }
    return audio;
  }

  function tone(freq, startIn, dur, type, peak) {
    if (!state.sound) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var t0 = ctx.currentTime + startIn;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak || 0.16, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  var SFX = {
    tick: function () { tone(660, 0, 0.16, 'square', 0.09); },
    go: function () { tone(990, 0, 0.4, 'square', 0.14); },
    coin: function () { tone(880, 0, 0.1, 'triangle', 0.12); tone(1320, 0.07, 0.16, 'triangle', 0.1); },
    fanfare: function () {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, i * 0.13, 0.42, 'triangle', 0.17); });
    },
    milestone: function () { [659.25, 880].forEach(function (f, i) { tone(f, i * 0.1, 0.3, 'sine', 0.14); }); }
  };

  /* ───────────────────── Seeded RNG (mulberry32) ─────────────────────── */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedToHex(seed) { return (seed >>> 0).toString(16).toUpperCase().padStart(8, '0'); }
  function hexToSeed(hex) {
    var v = parseInt(String(hex).trim().replace(/^0x/i, ''), 16);
    return isFinite(v) ? (v >>> 0) : null;
  }

  /* Fisher–Yates over lane indices. order[0] is the winner, order[1] second,
     and so on. Its only inputs are the seed and the size of the field —
     the donation ledger is not in scope here and is never consulted. */
  function drawOrder(seed, n) {
    var rnd = mulberry32(seed);
    var order = [];
    for (var i = 0; i < n; i++) order.push(i);
    for (var j = n - 1; j > 0; j--) {
      var k = Math.floor(rnd() * (j + 1));
      var tmp = order[j]; order[j] = order[k]; order[k] = tmp;
    }
    return { order: order, rnd: rnd };
  }

  /* ─────────────────────── Building the racers ───────────────────────── */

  function snailSvg() {
    return $('tplSnail').content.firstElementChild.cloneNode(true);
  }

  function paintLane(node, i) {
    var c = PALETTE[i % PALETTE.length];
    node.style.setProperty('--shell', c.shell);
    node.style.setProperty('--shell-dk', c.dark);
    node.style.setProperty('--body', c.body);
    node.style.setProperty('--shell-glow', c.shell);
    node.style.setProperty('--lane', String(i));
  }

  function buildLanes() {
    els.track.innerHTML = '';
    laneEls = [];
    var tpl = $('tplLane');
    for (var i = 0; i < state.fieldSize; i++) {
      var lane = tpl.content.firstElementChild.cloneNode(true);
      lane.dataset.lane = String(i);
      paintLane(lane, i);
      lane.querySelector('.lane-badge').textContent = String(i + 1);
      lane.querySelector('.name-pill').textContent = state.names[i];
      lane.querySelector('.token').appendChild(snailSvg());
      lane.classList.add('idle');
      els.track.appendChild(lane);
      laneEls.push({
        root: lane,
        token: lane.querySelector('.token'),
        trail: lane.querySelector('.trail'),
        chip: lane.querySelector('.pos-chip'),
        label: lane.querySelector('.label'),
        pill: lane.querySelector('.name-pill'),
        field: lane.querySelector('.field'),
        labelW: 0
      });
    }
    measure();
  }

  var tokenW = 0, fieldW = 0;

  function measure() {
    if (!laneEls.length) return;
    fieldW = laneEls[0].field.clientWidth;
    tokenW = laneEls[0].token.offsetWidth;
    travelPx = Math.max(10, fieldW - NOSE * tokenW);
    laneEls.forEach(function (L) { L.labelW = L.label.offsetWidth; });
  }

  function paintPositions() {
    for (var i = 0; i < laneEls.length; i++) {
      var L = laneEls[i];
      var s = race.snails[i];
      var p = s ? s.p : 0;
      var x = p * travelPx;

      L.token.style.setProperty('--x', x.toFixed(2) + 'px');
      L.trail.style.setProperty('--tp', p.toFixed(4));

      /* Keep the name pill inside its lane. Without this a long name is
         sliced in half by the finish line at the exact moment it matters. */
      var centre = x + tokenW / 2;
      var half = L.labelW / 2;
      var lx = 0;
      if (half * 2 < fieldW) {
        if (centre - half < 0) lx = half - centre;
        if (centre + half + lx > fieldW) lx = fieldW - centre - half;
      }
      L.label.style.setProperty('--lx', lx.toFixed(1) + 'px');
    }
  }

  /* ─────────────────────────── The race ──────────────────────────────── */

  /* Draw the whole result before the first frame, then animate a path that
     is mathematically incapable of changing it.

     Fairness, in four lines:
       1. The finishing order is one Fisher–Yates shuffle of the lane
          indices, seeded by `seed` and nothing else. Donations are not read.
       2. Each snail i is given a finish time T[i]; T is a strictly
          increasing relabelling of the shuffled order.
       3. Position is p(t) = base(u) + A·sin(πu)·noise, u = t/T[i]. The
          envelope sin(πu) is exactly 0 at u=1, so p(T[i]) = 1 exactly, and
          a ceiling clamp keeps p < 1 for every u < 1. No snail can arrive
          early or late no matter what the noise does.
       4. Therefore arrival order == shuffle order, and every lane wins with
          probability exactly 1/N.
     The wobble is decoration. The result is a draw, and the seed on screen
     lets anyone re-run it afterwards. */
  function drawRace(seed, n, duration) {
    var d = drawOrder(seed, n);
    var order = d.order;
    var rnd = d.rnd;

    var photo = rnd() < 0.25;              // one race in four is a genuine squeaker
    var T = new Array(n);
    T[order[0]] = duration;
    for (var j = 1; j < n; j++) {
      var gap = (j === 1 && photo) ? 60 + rnd() * 90 : 180 + rnd() * 520;
      T[order[j]] = Math.min(T[order[j - 1]] + gap, duration + 3000);
    }

    var snails = [];
    for (var i = 0; i < n; i++) {
      snails.push({
        lane: i,
        name: state.names[i],
        T: T[i],
        A: 0.055 + rnd() * 0.045,
        w1: 0.6 + rnd() * 0.8,
        w2: 1.3 + rnd() * 1.0,
        ph1: rnd() * Math.PI * 2,
        ph2: rnd() * Math.PI * 2,
        p: 0, prevP: 0, rate: 0, done: false, place: 0, finishMs: 0
      });
    }

    /* Authored drama. Which snail gets which role is decided purely by the
       shuffle above, so this adds theatre without touching the odds. */
    snails[order[0]].ph1 = Math.PI;        // winner starts sluggish, comes home
    snails[order[0]].A = 0.10;
    snails[order[n - 1]].ph1 = 0;          // back marker bolts early, burns out
    snails[order[n - 1]].A = 0.10;

    return { snails: snails, order: order, photo: photo, T: T };
  }

  function startRace() {
    if (race.running || race.countdown) return;
    if (!laneEls.length) return;

    ensureAudio();
    closeOverlay(true);

    var duration = Number(state.raceSpeed) || 10000;
    var seed = ((Date.now() ^ (Math.random() * 4294967296)) >>> 0);
    var drawn = drawRace(seed, state.fieldSize, duration);

    race.seed = seed;
    race.snails = drawn.snails;
    race.raceT = 0;
    race.last = 0;
    race.slow = 1;
    race.placed = 0;
    race.slowmoUsed = false;
    race.results = [];
    race.commentaryAt = 0;
    race.lastLeader = -1;
    race.tMax = Math.max.apply(null, drawn.T) + 1500;

    els.seedLabel.textContent = 'Seed ' + seedToHex(seed);
    els.raceLabel.textContent = state.raceType + ' ' + nextRaceNo();
    els.photoBanner.hidden = true;
    els.trackWrap.classList.remove('final-straight');

    laneEls.forEach(function (L) {
      L.root.classList.remove('idle', 'finished', 'surging', 'pos-1', 'pos-2', 'pos-3');
      L.chip.textContent = '';
    });
    paintPositions();

    els.startRace.disabled = true;
    els.startRace.textContent = 'Racing…';
    setStatus('On your marks…');
    say('Race ' + nextRaceNo() + ' starting.');

    runCountdown(function () {
      race.running = true;
      laneEls.forEach(function (L) { L.root.classList.add('racing'); });
      setStatus('And they\'re off!');
      measure();
      race.rafId = requestAnimationFrame(frame);
    });
  }

  function runCountdown(done) {
    var steps = ['3', '2', '1', 'GO!'];
    var i = 0;
    els.countdown.classList.add('on');
    var step = function () {
      if (i >= steps.length) {
        els.countdown.classList.remove('on');
        els.countdown.innerHTML = '';
        race.countdown = null;
        done();
        return;
      }
      els.countdown.innerHTML = '';
      els.countdown.appendChild(el('span', null, steps[i]));
      if (i === steps.length - 1) SFX.go(); else SFX.tick();
      i++;
      race.countdown = setTimeout(step, 700);
    };
    step();
  }

  function frame(now) {
    if (!race.running) return;
    if (!race.last) race.last = now;
    var dt = now - race.last;
    race.last = now;
    if (dt > 100) dt = 100;                // survive GC pauses and tab returns
    race.raceT += dt * race.slow;

    var i, s;
    for (i = 0; i < race.snails.length; i++) {
      s = race.snails[i];
      if (s.done) continue;

      var u = Math.min(race.raceT / s.T, 1);
      var base = u * u * (3 - 2 * u);                       // smoothstep
      var env = Math.sin(Math.PI * u);                      // 0 at both ends
      var tSec = race.raceT / 1000;
      var n = 0.62 * Math.sin(s.w1 * tSec + s.ph1) + 0.38 * Math.sin(s.w2 * tSec + s.ph2);

      var p = base + s.A * env * n;
      var ceil = base + (1 - base) * 0.9;                   // never close >90% of the gap
      if (p > ceil) p = ceil;
      if (p < 0) p = 0;
      if (p < s.p) p = s.p;                                 // monotone: no reversing

      s.rate = (p - s.prevP) / (dt || 16);
      s.prevP = p;
      s.p = p;

      if (u >= 1) {
        s.p = 1;
        s.done = true;
        s.place = ++race.placed;
        s.finishMs = Math.round(race.raceT);
        onCross(s);
      }
    }

    /* Two orderings, deliberately. byP drives the drama cues; `ranked`
       drives what the crowd reads. Once a snail is home its place is
       settled — ranking it by p would put every finisher on 1.0 and shuffle
       the chips into an order that contradicts the announced result. */
    var byP = race.snails.slice().sort(function (a, b) { return b.p - a.p; });
    var ranked = race.snails.slice().sort(function (a, b) {
      if (a.done && b.done) return a.place - b.place;
      if (a.done) return -1;
      if (b.done) return 1;
      return b.p - a.p;
    });

    if (!race.slowmoUsed && byP.length > 1 && !byP[0].done &&
        byP[0].p > 0.88 && (byP[0].p - byP[1].p) < 0.04) {
      race.slow = 0.28;
      race.slowmoUsed = true;
      els.photoBanner.hidden = false;
      setStatus('PHOTO FINISH!');
    }

    if (byP[0].p > 0.8) els.trackWrap.classList.add('final-straight');

    /* Effort cue for anyone moving well above the field average */
    var mean = 0;
    for (i = 0; i < race.snails.length; i++) mean += race.snails[i].rate;
    mean /= race.snails.length || 1;
    for (i = 0; i < race.snails.length; i++) {
      s = race.snails[i];
      laneEls[i].root.classList.toggle('surging', !s.done && mean > 0 && s.rate > mean * 1.15);
    }

    for (i = 0; i < ranked.length; i++) {
      var lane = laneEls[ranked[i].lane];
      var label = ordinal(i + 1);
      if (lane.chip.textContent !== label) lane.chip.textContent = label;
    }

    paintPositions();
    callRace(byP);

    if (race.placed < race.snails.length && race.raceT < race.tMax) {
      race.rafId = requestAnimationFrame(frame);
    } else {
      finishRace();
    }
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function onCross(s) {
    race.results.push({ lane: s.lane, name: state.names[s.lane], place: s.place, finishMs: s.finishMs });
    var L = laneEls[s.lane];
    L.root.classList.add('finished');
    L.root.classList.remove('surging');
    if (s.place <= 3) L.root.classList.add('pos-' + s.place);
    if (s.place === 1) {
      els.finishFlash.classList.remove('fire');
      void els.finishFlash.offsetWidth;
      els.finishFlash.classList.add('fire');
    }
  }

  function callRace(ranked) {
    if (race.raceT - race.commentaryAt < 1600) return;
    race.commentaryAt = race.raceT;
    var lead = ranked[0], second = ranked[1];
    if (!lead) return;
    var phase = lead.p < 0.3 ? 'early' : lead.p < 0.72 ? 'mid' : 'late';
    var pool = COMMENTARY[phase];
    var line = pool[Math.floor(Math.random() * pool.length)];
    els.commentary.textContent = line
      .replace('{a}', state.names[lead.lane])
      .replace('{b}', second ? state.names[second.lane] : state.names[lead.lane]);
    race.lastLeader = lead.lane;
  }

  /* The single cleanup path. Both the normal exit and the watchdog land
     here, so the UI can never be left stuck mid-race. */
  function finishRace() {
    stopLoop();

    /* Watchdog case: force any straggler home in current order. */
    race.snails.slice().sort(function (a, b) { return b.p - a.p; }).forEach(function (s) {
      if (!s.done) {
        s.done = true;
        s.p = 1;
        s.place = ++race.placed;
        s.finishMs = Math.round(race.raceT);
        onCross(s);
      }
    });

    paintPositions();
    laneEls.forEach(function (L) { L.root.classList.remove('racing', 'surging'); L.root.classList.add('idle'); });
    els.trackWrap.classList.remove('final-straight');
    els.photoBanner.hidden = true;
    els.startRace.disabled = false;
    els.startRace.innerHTML = 'Start race <kbd>Space</kbd>';

    var results = race.results.slice().sort(function (a, b) { return a.place - b.place; });

    /* Repaint the chips from the settled result so the track can never
       disagree with the announcement. */
    results.forEach(function (r) { laneEls[r.lane].chip.textContent = ordinal(r.place); });

    var raceNo = nextRaceNo();
    var pots = potBySnail(raceNo);
    var pot = pots.reduce(function (s, x) { return s + x.amount; }, 0);
    var backers = pots.reduce(function (s, x) { return s + x.backers; }, 0);

    state.raceNumber = raceNo;
    state.history.unshift({
      raceNumber: raceNo,
      ts: Date.now(),
      seed: seedToHex(race.seed),
      type: state.raceType,
      field: state.names.slice(0, state.fieldSize),
      results: results,
      pot: cents(pot),
      backers: backers
    });
    save();

    var winner = results[0];
    setStatus(winner.name + ' wins ' + state.raceType.toLowerCase() + ' ' + raceNo + '!');
    els.commentary.textContent = results.slice(1, 3).map(function (r) {
      return ordinal(r.place) + ' ' + r.name;
    }).join(' · ');
    say(winner.name + ' wins race ' + raceNo + '. ' +
        results.slice(1, 3).map(function (r) { return ordinal(r.place) + ' ' + r.name; }).join(', ') + '.', true);

    showWinner(winner, results, pots);
    renderAll();
  }

  function stopLoop() {
    race.running = false;
    if (race.rafId) cancelAnimationFrame(race.rafId);
    race.rafId = 0;
    if (race.countdown) { clearTimeout(race.countdown); race.countdown = null; }
    els.countdown.classList.remove('on');
    els.countdown.innerHTML = '';
  }

  function resetRace() {
    stopLoop();
    race.snails = [];
    race.results = [];
    race.placed = 0;
    laneEls.forEach(function (L) {
      L.root.classList.remove('racing', 'finished', 'surging', 'pos-1', 'pos-2', 'pos-3');
      L.root.classList.add('idle');
      L.chip.textContent = '';
      L.token.style.setProperty('--x', '0px');
      L.trail.style.setProperty('--tp', '0');
    });
    els.trackWrap.classList.remove('final-straight');
    els.photoBanner.hidden = true;
    els.startRace.disabled = false;
    els.startRace.innerHTML = 'Start race <kbd>Space</kbd>';
    closeOverlay(true);
    setStatus('Ready to race');
    els.commentary.textContent = '';
  }

  /* ─────────────────────── Winner presentation ───────────────────────── */

  function showWinner(winner, results, pots) {
    var c = PALETTE[winner.lane % PALETTE.length];
    els.winnerCard.style.setProperty('--win-colour', c.shell);
    els.winnerEyebrow.textContent = state.raceType + ' ' + state.raceNumber + ' winner';
    els.winnerName.textContent = winner.name;

    els.winnerSnail.innerHTML = '';
    paintLane(els.winnerSnail, winner.lane);
    els.winnerSnail.appendChild(snailSvg());

    var pot = pots[winner.lane];
    els.winnerMoney.textContent = pot && pot.amount
      ? money(pot.amount) + ' from ' + pot.backers + (pot.backers === 1 ? ' backer' : ' backers')
      : 'No backers on this one — bad luck!';

    els.winnerBackers.innerHTML = '';
    if (pot) {
      pot.names.slice(0, 12).forEach(function (nm) {
        els.winnerBackers.appendChild(el('li', null, nm));
      });
      if (pot.names.length > 12) {
        els.winnerBackers.appendChild(el('li', null, '+' + (pot.names.length - 12) + ' more'));
      }
    }

    els.podium.innerHTML = '';
    [2, 1, 3].forEach(function (place) {
      var r = results.find(function (x) { return x.place === place; });
      if (!r) return;
      var step = el('div', 'podium-step');
      step.dataset.place = String(place);
      paintLane(step, r.lane);
      step.appendChild(snailSvg());
      step.appendChild(el('p', 'podium-name', r.name));
      step.appendChild(el('div', 'podium-block', ordinal(place)));
      els.podium.appendChild(step);
    });

    els.overlay.hidden = false;
    els.overlayClose.focus();

    if (!state.calm && !prefersReducedMotion()) {
      confettiBurst(c.shell);
      SFX.fanfare();
    }

    clearTimeout(showWinner._t);
    showWinner._t = setTimeout(function () { closeOverlay(); }, 14000);
  }

  function closeOverlay(silent) {
    clearTimeout(showWinner._t);
    if (els.overlay.hidden) return;
    els.overlay.hidden = true;
    stopConfetti();
    if (!silent) els.startRace.focus();
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ──────────────────────────── Confetti ─────────────────────────────── */

  var confetti = { raf: 0, parts: [], until: 0 };

  function confettiBurst(highlight) {
    var cv = els.confetti;
    var ctx = cv.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = window.innerWidth * dpr;
    cv.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cv.classList.add('on');

    var colours = PALETTE.slice(0, state.fieldSize).map(function (c) { return c.shell; });
    colours.push('#ffc53d', highlight, highlight);

    confetti.parts = [];
    for (var i = 0; i < 150; i++) {
      confetti.parts.push({
        x: window.innerWidth * (0.15 + Math.random() * 0.7),
        y: window.innerHeight * (0.35 + Math.random() * 0.2),
        vx: (Math.random() - 0.5) * 620,
        vy: -260 - Math.random() * 620,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        w: 6 + Math.random() * 8,
        h: 9 + Math.random() * 12,
        c: colours[Math.floor(Math.random() * colours.length)]
      });
    }

    confetti.until = 4600;
    var elapsed = 0, last = 0;
    var step = function (now) {
      if (!last) last = now;
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now; elapsed += dt * 1000;
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (var j = 0; j < confetti.parts.length; j++) {
        var p = confetti.parts[j];
        p.vy += 900 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = elapsed > 3200 ? Math.max(0, 1 - (elapsed - 3200) / 1400) : 1;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (elapsed < confetti.until) confetti.raf = requestAnimationFrame(step);
      else stopConfetti();
    };
    confetti.raf = requestAnimationFrame(step);
  }

  function stopConfetti() {
    if (confetti.raf) cancelAnimationFrame(confetti.raf);
    confetti.raf = 0;
    confetti.parts = [];
    var cv = els.confetti;
    cv.classList.remove('on');
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
  }

  /* ───────────────────────────── Donations ───────────────────────────── */

  function addDonation(lane, name, amount) {
    amount = cents(amount);
    if (!isFinite(amount) || amount <= 0) { flash('Enter an amount above $0.'); return false; }
    if (amount > 100000) { flash('That looks like a typo — over $100,000.'); return false; }
    if (lane < 0 || lane >= state.fieldSize) { flash('Pick a snail first.'); return false; }

    state.ledger.push({
      id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      ts: Date.now(),
      lane: lane,
      name: (name || '').trim().slice(0, 40),
      amount: amount,
      race: nextRaceNo(),
      type: state.raceType,
      void: false
    });
    save();
    SFX.coin();
    checkMilestone();
    renderAll();
    flash(money(amount) + ' on ' + state.names[lane] + '. Thanks' + (name ? ', ' + name.trim() : '') + '!');
    return true;
  }

  function voidEntry(id) {
    var e = state.ledger.find(function (x) { return x.id === id; });
    if (!e || e.void) return;
    e.void = true;
    save();
    renderAll();
    flash('Voided ' + money(e.amount) + ' on ' + state.names[e.lane] + '.');
  }

  function undoLast() {
    for (var i = state.ledger.length - 1; i >= 0; i--) {
      if (!state.ledger[i].void) { voidEntry(state.ledger[i].id); return; }
    }
    flash('Nothing to undo.');
  }

  var lastMilestone = 0;
  function checkMilestone() {
    if (!state.goal || state.goal <= 0) return;
    var pct = nightTotal() / state.goal;
    [0.25, 0.5, 0.75, 1].forEach(function (m) {
      if (pct >= m && lastMilestone < m) {
        lastMilestone = m;
        if (!state.calm) SFX.milestone();
        flash(m >= 1 ? '🎉 Goal reached — ' + money(nightTotal()) + '!' :
          (m * 100) + '% of the way to ' + moneyShort(state.goal) + '!');
      }
    });
  }

  /* ───────────────────────────── Rendering ───────────────────────────── */

  function setStatus(text) {
    els.status.textContent = text;
  }

  var flashTimer = null;
  function flash(msg) {
    els.commentary.textContent = msg;
    say(msg);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      if (!race.running) els.commentary.textContent = '';
    }, 4000);
  }

  function say(msg, assertive) {
    var target = assertive ? els.srAlert : els.srLive;
    target.textContent = '';
    setTimeout(function () { target.textContent = msg; }, 30);
  }

  function renderHeader() {
    var total = nightTotal();
    var prev = renderHeader._prev;
    els.totalRaised.textContent = money(total);
    if (prev !== undefined && total !== prev && !state.calm) {
      els.totalRaised.classList.remove('bump');
      void els.totalRaised.offsetWidth;
      els.totalRaised.classList.add('bump');
    }
    renderHeader._prev = total;

    els.goal.hidden = !state.goalShow;
    var pct = state.goal > 0 ? clamp((total / state.goal) * 100, 0, 100) : 0;
    els.goalFill.style.width = pct.toFixed(1) + '%';
    els.goalBar.setAttribute('aria-valuenow', String(Math.round(pct)));
    els.goalText.textContent = 'Goal ' + moneyShort(state.goal) + ' · ' + Math.round(pct) + '%';

    if (!race.running) els.raceLabel.textContent = 'Next: ' + state.raceType + ' ' + nextRaceNo();
    els.clubName.textContent = state.clubName;
    els.eventName.textContent = state.eventName;
  }

  function renderTote() {
    var raceNo = nextRaceNo();
    var pots = potBySnail(raceNo);
    var total = pots.reduce(function (s, x) { return s + x.amount; }, 0);
    var max = pots.reduce(function (m, x) { return Math.max(m, x.amount); }, 0);

    els.toteTitle.textContent = state.raceType + ' ' + raceNo + ' pot';
    els.totePot.textContent = moneyShort(total);

    var sorted = pots.slice().sort(function (a, b) { return b.amount - a.amount || a.lane - b.lane; });

    els.toteList.innerHTML = '';
    var tpl = $('tplTote');
    sorted.forEach(function (row, idx) {
      var li = tpl.content.firstElementChild.cloneNode(true);
      paintLane(li, row.lane);
      li.querySelector('.tote-rank').textContent = String(row.lane + 1);
      li.querySelector('.tote-name').textContent = state.names[row.lane];
      li.querySelector('.tote-amount').textContent = moneyShort(row.amount);
      li.querySelector('.tote-backers').textContent =
        row.backers ? row.backers + (row.backers === 1 ? ' backer' : ' backers') : 'no backers';
      li.querySelector('.tote-bar > i').style.width = (max > 0 ? (row.amount / max) * 100 : 0) + '%';
      if (idx === 0 && row.amount > 0) li.classList.add('lead');
      els.toteList.appendChild(li);
    });

    els.toteFoot.textContent = total > 0
      ? 'Winner announced after the race. Donations do not affect the draw.'
      : 'Back a snail to put it on the board.';
  }

  function renderLedger() {
    var live = liveEntries();
    els.ledgerCount.textContent = live.length + (live.length === 1 ? ' entry' : ' entries') +
      ' · ' + money(nightTotal());
    els.ledger.innerHTML = '';
    if (!state.ledger.length) {
      els.ledger.appendChild(el('p', 'empty', 'No donations yet.'));
      return;
    }
    state.ledger.slice(-25).reverse().forEach(function (e) {
      var row = el('div', 'ledger-row' + (e.void ? ' voided' : ''));
      var dot = el('span', 'ledger-dot');
      dot.style.background = PALETTE[e.lane % PALETTE.length].shell;
      row.appendChild(dot);
      row.appendChild(el('span', 'ledger-when', timeOfDay(e.ts)));
      row.appendChild(el('span', 'ledger-who',
        (e.name ? e.name + ' → ' : '') + (state.names[e.lane] || 'Lane ' + (e.lane + 1)) +
        ' · ' + e.type + ' ' + e.race));
      row.appendChild(el('span', 'ledger-amt', money(e.amount)));
      if (!e.void) {
        var b = el('button', 'link-btn', 'void');
        b.type = 'button';
        b.setAttribute('aria-label', 'Void ' + money(e.amount) + ' donation');
        b.addEventListener('click', function () { voidEntry(e.id); });
        row.appendChild(b);
      } else {
        row.appendChild(el('span', 'ledger-when', 'voided'));
      }
      els.ledger.appendChild(row);
    });
  }

  function renderHistory() {
    els.history.innerHTML = '';
    if (!state.history.length) {
      els.history.appendChild(el('p', 'empty', 'No races run yet.'));
      return;
    }
    state.history.slice(0, 25).forEach(function (h) {
      var row = el('div', 'history-row');
      var podium = h.results.slice(0, 3).map(function (r) {
        return ordinal(r.place) + ' ' + r.name;
      }).join(' · ');
      row.appendChild(el('span', 'place', h.type + ' ' + h.raceNumber + ':'));
      row.appendChild(el('span', null, podium));
      row.appendChild(el('span', 'history-seed', h.seed));
      row.appendChild(el('span', 'pot', moneyShort(h.pot)));
      els.history.appendChild(row);
    });
  }

  function renderRacerInputs() {
    els.nameInputs.innerHTML = '';
    for (var i = 0; i < state.fieldSize; i++) {
      (function (idx) {
        var wrap = el('label');
        var sw = el('span', 'swatch');
        sw.style.background = PALETTE[idx % PALETTE.length].shell;
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.value = state.names[idx];
        inp.maxLength = 24;
        inp.setAttribute('aria-label', 'Name for snail ' + (idx + 1));
        inp.addEventListener('input', function () {
          state.names[idx] = inp.value.slice(0, 24) || ('Snail ' + (idx + 1));
          if (laneEls[idx]) laneEls[idx].pill.textContent = state.names[idx];
          measure();
          paintPositions();
          save();
          renderTote();
          renderDonateOptions();
        });
        wrap.appendChild(sw);
        wrap.appendChild(inp);
        els.nameInputs.appendChild(wrap);
      })(i);
    }
  }

  function renderDonateOptions() {
    var keep = els.donateSnail.value;
    els.donateSnail.innerHTML = '';
    for (var i = 0; i < state.fieldSize; i++) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = (i + 1) + '. ' + state.names[i];
      els.donateSnail.appendChild(o);
    }
    if (keep !== '' && Number(keep) < state.fieldSize) els.donateSnail.value = keep;
  }

  function renderTonight() {
    var races = state.history.length;
    var best = state.history.reduce(function (m, h) { return h.pot > (m ? m.pot : -1) ? h : m; }, null);
    els.roundNote.innerHTML = '';
    els.roundNote.appendChild(el('span',
      null,
      races + (races === 1 ? ' race' : ' races') + ' run · ' + money(nightTotal()) + ' raised' +
      (best ? ' · biggest pot ' + moneyShort(best.pot) + ' (' + best.type + ' ' + best.raceNumber + ')' : '')));
  }

  function renderAll() {
    renderHeader();
    renderTote();
    renderLedger();
    renderHistory();
    renderTonight();
  }

  /* ───────────────────────── Report & exports ────────────────────────── */

  function buildReport() {
    var live = liveEntries();
    var total = nightTotal();
    var perSnail = {};
    live.forEach(function (e) {
      var key = state.names[e.lane] || ('Lane ' + (e.lane + 1));
      if (!perSnail[key]) perSnail[key] = { amount: 0, backers: 0 };
      perSnail[key].amount += e.amount;
      perSnail[key].backers++;
    });

    var wins = {};
    state.history.forEach(function (h) {
      var w = h.results[0];
      if (w) wins[w.name] = (wins[w.name] || 0) + 1;
    });

    var html = '';
    html += '<p><strong>' + esc(state.clubName) + '</strong> — ' + esc(state.eventName) + '<br>' +
            new Date(state.startedAt).toLocaleDateString('en-AU', { dateStyle: 'full' }) + '</p>';
    html += '<p class="grand">Total raised: ' + money(total) + '</p>';
    html += '<p>' + live.length + ' donations · ' + state.history.length + ' races · goal ' +
            moneyShort(state.goal) + '</p>';

    html += '<h2>Races</h2>';
    if (!state.history.length) html += '<p>No races run.</p>';
    else {
      html += '<table><thead><tr><th>Race</th><th>Time</th><th>1st</th><th>2nd</th><th>3rd</th>' +
              '<th class="n">Pot</th><th class="n">Backers</th><th>Seed</th></tr></thead><tbody>';
      state.history.slice().sort(function (a, b) { return a.raceNumber - b.raceNumber; }).forEach(function (h) {
        var g = function (pl) { var r = h.results.find(function (x) { return x.place === pl; }); return r ? esc(r.name) : '—'; };
        html += '<tr><td>' + esc(h.type) + ' ' + h.raceNumber + '</td><td>' + timeOfDay(h.ts) + '</td>' +
                '<td>' + g(1) + '</td><td>' + g(2) + '</td><td>' + g(3) + '</td>' +
                '<td class="n">' + money(h.pot) + '</td><td class="n">' + h.backers + '</td>' +
                '<td>' + esc(h.seed) + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<h2>By snail</h2>';
    var keys = Object.keys(perSnail).sort(function (a, b) { return perSnail[b].amount - perSnail[a].amount; });
    if (!keys.length) html += '<p>No donations recorded.</p>';
    else {
      html += '<table><thead><tr><th>Snail</th><th class="n">Raised</th><th class="n">Backers</th><th class="n">Wins</th></tr></thead><tbody>';
      keys.forEach(function (k) {
        html += '<tr><td>' + esc(k) + '</td><td class="n">' + money(perSnail[k].amount) + '</td>' +
                '<td class="n">' + perSnail[k].backers + '</td><td class="n">' + (wins[k] || 0) + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<h2>Donations</h2>';
    if (!state.ledger.length) html += '<p>No donations recorded.</p>';
    else {
      html += '<table><thead><tr><th>Time</th><th>Backer</th><th>Snail</th><th>Race</th>' +
              '<th class="n">Amount</th><th>Status</th></tr></thead><tbody>';
      state.ledger.forEach(function (e) {
        html += '<tr><td>' + timeOfDay(e.ts) + '</td><td>' + esc(e.name || '—') + '</td>' +
                '<td>' + esc(state.names[e.lane] || ('Lane ' + (e.lane + 1))) + '</td>' +
                '<td>' + esc(e.type) + ' ' + e.race + '</td>' +
                '<td class="n">' + money(e.amount) + '</td>' +
                '<td>' + (e.void ? 'VOID' : 'counted') + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<h2>Sign off</h2><p>Counted by ______________________ &nbsp;&nbsp; ' +
            'Checked by ______________________ &nbsp;&nbsp; Date ____________</p>';

    els.reportBody.innerHTML = html;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    /* Neutralise spreadsheet formula injection from operator-typed names. */
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function buildCsv() {
    var rows = [];
    rows.push(['SECTION', 'Donations']);
    rows.push(['Timestamp', 'Backer', 'Snail', 'Lane', 'Race type', 'Race number', 'Amount AUD', 'Status']);
    state.ledger.forEach(function (e) {
      rows.push([new Date(e.ts).toISOString(), e.name || '', state.names[e.lane] || '', e.lane + 1,
        e.type, e.race, e.amount.toFixed(2), e.void ? 'VOID' : 'counted']);
    });
    rows.push([]);
    rows.push(['SECTION', 'Race results']);
    rows.push(['Race type', 'Race number', 'Timestamp', 'Seed', 'Place', 'Snail', 'Finish ms', 'Race pot AUD']);
    state.history.slice().sort(function (a, b) { return a.raceNumber - b.raceNumber; }).forEach(function (h) {
      h.results.forEach(function (r) {
        rows.push([h.type, h.raceNumber, new Date(h.ts).toISOString(), h.seed, r.place, r.name,
          r.finishMs, h.pot.toFixed(2)]);
      });
    });
    rows.push([]);
    rows.push(['SECTION', 'Summary']);
    rows.push(['Total raised AUD', nightTotal().toFixed(2)]);
    rows.push(['Goal AUD', Number(state.goal || 0).toFixed(2)]);
    rows.push(['Races run', state.history.length]);
    rows.push(['Donations counted', liveEntries().length]);
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
      flash('Saved ' + filename);
    } catch (err) {
      flash('Download blocked by the browser — open the report and print instead.');
    }
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /* ──────────────────────────── UI wiring ────────────────────────────── */

  function applyChrome() {
    document.documentElement.dataset.theme = state.theme === 'night' ? 'night' : 'day';
    document.body.classList.toggle('calm', !!state.calm);
    document.body.classList.toggle('setup', !!state.drawerOpen);
    els.themeToggle.setAttribute('aria-pressed', String(state.theme === 'night'));
    els.calmToggle.setAttribute('aria-pressed', String(!!state.calm));
    els.soundToggle.setAttribute('aria-pressed', String(!!state.sound));
    els.soundToggle.querySelector('span[aria-hidden]').textContent = state.sound ? '🔊' : '🔇';
    els.drawerToggle.setAttribute('aria-expanded', String(!!state.drawerOpen));
    els.raceSpeed.value = String(state.raceSpeed);
    els.raceType.value = state.raceType;
    els.fieldSize.value = String(state.fieldSize);
    els.goalInput.value = String(state.goal);
    els.goalShow.checked = !!state.goalShow;
  }

  function toggleDrawer(open) {
    state.drawerOpen = open === undefined ? !state.drawerOpen : open;
    applyChrome();
    save();
    if (state.drawerOpen) els.donateAmount.focus();
  }

  function isTyping(target) {
    return !!(target && target.closest &&
      target.closest('input, select, textarea, button, [contenteditable="true"]'));
  }

  function wire() {
    /* — Donations — */
    els.donateForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var lane = parseInt(els.donateSnail.value, 10);
      if (addDonation(lane, els.donateName.value, els.donateAmount.value)) {
        els.donateName.value = '';
        els.donateAmount.value = '10';
        els.donateName.focus();
      }
    });

    QUICK_AMOUNTS.forEach(function (amt) {
      var b = el('button', null, moneyShort(amt));
      b.type = 'button';
      b.addEventListener('click', function () {
        var lane = parseInt(els.donateSnail.value, 10);
        if (addDonation(lane, els.donateName.value, amt)) {
          els.donateName.value = '';
        }
      });
      els.quickAmounts.appendChild(b);
    });

    els.undoLast.addEventListener('click', undoLast);

    /* — Race — */
    els.startRace.addEventListener('click', startRace);
    els.resetRace.addEventListener('click', resetRace);

    els.raceSpeed.addEventListener('change', function () {
      state.raceSpeed = Number(els.raceSpeed.value) || 10000; save();
    });
    els.raceType.addEventListener('change', function () {
      state.raceType = els.raceType.value; save(); renderAll();
    });

    /* — Racers — */
    els.fieldSize.addEventListener('change', function () {
      if (race.running) return;
      state.fieldSize = clamp(parseInt(els.fieldSize.value, 10) || 6, MIN_FIELD, MAX_FIELD);
      save();
      buildLanes();
      renderRacerInputs();
      renderDonateOptions();
      renderAll();
    });

    els.shuffleNames.addEventListener('click', function () {
      var pool = NAME_POOL.slice();
      for (var i = 0; i < state.fieldSize; i++) {
        var k = Math.floor(Math.random() * pool.length);
        state.names[i] = pool.splice(k, 1)[0];
      }
      save();
      buildLanes();
      renderRacerInputs();
      renderDonateOptions();
      renderAll();
      flash('New names drawn.');
    });

    /* — Goal — */
    els.goalInput.addEventListener('change', function () {
      state.goal = Math.max(0, Number(els.goalInput.value) || 0);
      lastMilestone = 0;
      save(); renderHeader();
    });
    els.goalShow.addEventListener('change', function () {
      state.goalShow = els.goalShow.checked; save(); renderHeader();
    });

    /* — Tonight — */
    els.newRound.addEventListener('click', function () {
      var pending = entriesForRace(nextRaceNo());
      if (!pending.length) { flash('Nothing pending on the next race.'); return; }
      var sum = pending.reduce(function (s, e) { return s + e.amount; }, 0);
      if (!confirm('Void all ' + pending.length + ' donations on ' + state.raceType + ' ' +
                   nextRaceNo() + ' (' + money(sum) + ')?\n\nThe night total will drop by that amount. ' +
                   'Races already run are not affected.')) return;
      pending.forEach(function (e) { e.void = true; });
      save(); renderAll();
      flash('Voided ' + money(sum) + ' pending on the next race.');
    });

    /* — Chrome toggles — */
    els.themeToggle.addEventListener('click', function () {
      state.theme = state.theme === 'night' ? 'day' : 'night'; applyChrome(); save();
    });
    els.calmToggle.addEventListener('click', function () {
      state.calm = !state.calm; applyChrome(); save();
      flash(state.calm ? 'Calm mode on — decorative motion stopped.' : 'Calm mode off.');
    });
    els.soundToggle.addEventListener('click', function () {
      state.sound = !state.sound; applyChrome(); save();
      if (state.sound) { ensureAudio(); SFX.tick(); }
    });
    els.fullscreenToggle.addEventListener('click', function () {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    });
    document.addEventListener('fullscreenchange', function () {
      els.fullscreenToggle.setAttribute('aria-pressed', String(!!document.fullscreenElement));
    });

    els.drawerToggle.addEventListener('click', function () { toggleDrawer(true); });
    els.drawerClose.addEventListener('click', function () { toggleDrawer(false); });

    /* — Overlay — */
    els.overlayClose.addEventListener('click', function () { closeOverlay(); });
    els.overlayScrim.addEventListener('click', function () { closeOverlay(); });

    /* — Books — */
    els.showReport.addEventListener('click', function () {
      buildReport();
      els.report.hidden = false;
      els.closeReport.focus();
    });
    els.closeReport.addEventListener('click', function () {
      els.report.hidden = true;
      els.showReport.focus();
    });
    els.printReport.addEventListener('click', function () { window.print(); });

    els.exportCsv.addEventListener('click', function () {
      download('snail-race-' + stamp() + '.csv', buildCsv(), 'text/csv');
    });
    els.exportJson.addEventListener('click', function () {
      download('snail-race-backup-' + stamp() + '.json', JSON.stringify(state, null, 2), 'application/json');
    });
    els.importJsonBtn.addEventListener('click', function () { els.importJson.click(); });
    els.importJson.addEventListener('change', function () {
      var file = els.importJson.files && els.importJson.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result));
          if (!confirm('Replace everything on screen with the backup file?\n\nCurrent total ' +
                       money(nightTotal()) + ' will be discarded.')) return;
          state = mergeState(parsed);
          save();
          applyChrome();
          buildLanes();
          renderRacerInputs();
          renderDonateOptions();
          renderAll();
          resetRace();
          flash('Backup restored — ' + money(nightTotal()) + '.');
        } catch (err) {
          flash('That file could not be read as a backup.');
        }
      };
      reader.readAsText(file);
      els.importJson.value = '';
    });

    els.verifyBtn.addEventListener('click', function () {
      var hex = els.verifySeed.value.trim();
      var seed = hexToSeed(hex);
      if (seed === null) { els.verifyOut.textContent = 'That is not a seed. Copy it from the results list.'; return; }
      var past = state.history.find(function (h) { return h.seed.toUpperCase() === hex.toUpperCase(); });
      var n = past ? past.field.length : state.fieldSize;
      var names = past ? past.field : state.names.slice(0, n);
      var order = drawOrder(seed, n).order;
      var line = order.map(function (lane, idx) { return ordinal(idx + 1) + ' ' + names[lane]; }).join(' · ');
      els.verifyOut.textContent = 'Seed ' + hex.toUpperCase() + ' draws: ' + line +
        (past ? '  — matches the recorded result for ' + past.type + ' ' + past.raceNumber + '.' : '');
    });

    els.wipeAll.addEventListener('click', function () {
      if (!confirm('Start a brand new event?\n\nThis clears ' + money(nightTotal()) +
                   ' of donations and ' + state.history.length + ' race results from this device. ' +
                   'Save a backup first if you have not already.')) return;
      var keep = { theme: state.theme, calm: state.calm, sound: state.sound };
      state = freshState();
      state.theme = keep.theme; state.calm = keep.calm; state.sound = keep.sound;
      lastMilestone = 0;
      save();
      applyChrome();
      buildLanes();
      renderRacerInputs();
      renderDonateOptions();
      renderAll();
      resetRace();
      flash('New event started.');
    });

    /* — Keyboard. Every shortcut bails out if the operator is typing. — */
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.repeat) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
        e.preventDefault(); undoLast(); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (!els.report.hidden) { els.report.hidden = true; return; }
        if (!els.overlay.hidden) { closeOverlay(); return; }
        if (state.drawerOpen && isTyping(e.target)) { toggleDrawer(false); return; }
        resetRace();
        return;
      }

      if (isTyping(e.target)) return;

      switch (e.key) {
        case ' ': case 'Spacebar':
          e.preventDefault();
          if (!els.overlay.hidden) closeOverlay(); else startRace();
          break;
        case 'm': case 'M': e.preventDefault(); toggleDrawer(); break;
        case 'n': case 'N': els.themeToggle.click(); break;
        case 'c': case 'C': els.calmToggle.click(); break;
        case 's': case 'S': els.soundToggle.click(); break;
        case 'f': case 'F': els.fullscreenToggle.click(); break;
      }
    });

    /* — Layout & lifecycle — */
    if (window.ResizeObserver) {
      new ResizeObserver(function () { measure(); paintPositions(); })
        .observe(els.track);
    }
    window.addEventListener('resize', function () { measure(); paintPositions(); });

    document.addEventListener('visibilitychange', function () {
      if (!race.running) return;
      if (document.hidden) {
        if (race.rafId) cancelAnimationFrame(race.rafId);
        race.rafId = 0;
      } else {
        race.last = 0;                      // resume where we left off, no teleport
        race.rafId = requestAnimationFrame(frame);
      }
    });

    window.addEventListener('beforeunload', function (e) {
      if (nightTotal() > 0 && !storageOk) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /* ──────────────────────────────  Boot  ─────────────────────────────── */

  function boot() {
    [
      'track', 'toteList', 'totePot', 'toteTitle', 'toteFoot', 'totalRaised', 'goal', 'goalFill',
      'goalBar', 'goalText', 'raceLabel', 'seedLabel', 'clubName', 'eventName', 'raceStatus',
      'commentary', 'countdown', 'photoBanner', 'finishFlash', 'winnerOverlay', 'winnerCard',
      'winnerEyebrow', 'winnerSnail', 'winnerName', 'winnerMoney', 'winnerBackers', 'podium',
      'overlayClose', 'overlayScrim', 'confetti', 'drawer', 'drawerToggle', 'drawerClose',
      'savedStamp', 'donateForm', 'donateSnail', 'donateName', 'donateAmount', 'quickAmounts',
      'startRace', 'resetRace', 'raceSpeed', 'raceType', 'fieldSize', 'nameInputs', 'shuffleNames',
      'roundNote', 'newRound', 'goalInput', 'goalShow', 'undoLast', 'ledger', 'ledgerCount',
      'history', 'showReport', 'exportCsv', 'exportJson', 'importJson', 'importJsonBtn',
      'verifySeed', 'verifyBtn', 'verifyOut', 'wipeAll', 'report', 'reportBody', 'printReport',
      'closeReport', 'themeToggle', 'calmToggle', 'soundToggle', 'fullscreenToggle',
      'srLive', 'srAlert'
    ].forEach(function (id) { els[id] = $(id); });

    /* Friendlier aliases for the few names that differ from their ids */
    els.status = els.raceStatus;
    els.overlay = els.winnerOverlay;
    els.trackWrap = document.querySelector('.track-wrap');

    var restored = load();

    applyChrome();
    buildLanes();
    renderRacerInputs();
    renderDonateOptions();
    renderAll();
    wire();

    if (restored && (state.ledger.length || state.history.length)) {
      setStatus('Ready to race');
      flash('Picked up where you left off — ' + money(nightTotal()) + ' raised, ' +
            state.history.length + ' races run.');
    } else {
      setStatus('Ready to race');
    }
    writeNow();

    /* Test/debug hook — also handy if you ever need to inspect a night. */
    window.SnailRace = {
      get state() { return state; },
      get race() { return race; },
      drawOrder: drawOrder,
      addDonation: addDonation,
      start: startRace,
      reset: resetRace,
      total: nightTotal,
      travel: function () { return travelPx; }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
