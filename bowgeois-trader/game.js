/* Bowgeois Trader — prototype engine.
 *
 * A round of play is a loop:
 *   London  →  lade English wares, refit  →  westward passage (2 decisions)
 *           →  the factor settles for your cargo, lade colonial wares
 *           →  eastward passage (2 decisions)
 *           →  the Custom House settles, and the funds come in.
 *
 * The prologue runs the same passage machinery with scripted beats instead of
 * choices, because the expedition that wins the partner cannot fail.
 *
 * All prose, prices and events live in data.js. This file is the rules.
 */
(function () {
  'use strict';

  var D = window.BT_DATA;

  /* ------------------------------------------------------------ tuning ---- */
  var START_MONEY = 520;        // pounds sterling left after the lawyers
  var HOLD_TUNS = 40;           // capacity of the ship's hold
  var PROV_MAX = 200;           // victuals the ship can stow
  var PROV_PER_DAY = 2;         // eaten per day at sea by a full crew
  var CREW_FULL = 18;
  var CREW_FLOOR = 6;           // fewer hands than this and she cannot be worked
  var EVENTS_PER_CROSSING = 2;  // decisions put to the player on each passage
  var CROSSING_SECONDS = 15;    // real seconds an animated crossing takes
  var EVENT_MARKS = [0.30, 0.68];
  var REPAIR_COST = 4;          // £ per point of hull
  var PROV_COST = { london: 1.6, colony: 2.4 };
  var PROV_BLOCK = 25;
  var LIBERTY_COST = 45;   // a night ashore, and the only cure for a sullen crew
  var DEFAULT_PAYS = 2.1;       // what a colonial factor gives for English wares

  var LONDON = { x: 843, y: 152, name: 'London' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  /* ------------------------------------------------------------ helpers --- */
  function $(id) { return document.getElementById(id); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function money(n) { return '£' + Math.round(n).toLocaleString('en-GB'); }

  function ord(n) {
    if (n > 3 && n < 21) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  function fmtDate(day) {
    var t = new Date(Date.UTC(1687, 3, 12));
    t.setUTCDate(t.getUTCDate() + Math.floor(day));
    return ord(t.getUTCDate()) + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
  }

  function weighted(list) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].w;
    var roll = Math.random() * total;
    for (i = 0; i < list.length; i++) {
      roll -= list[i].w;
      if (roll <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  var GOODS = {};
  D.ENGLISH_GOODS.forEach(function (g) { GOODS[g.id] = g; });
  D.COLONIAL_GOODS.forEach(function (g) { GOODS[g.id] = g; });

  /* ------------------------------------------------------------- state ---- */
  var S = null;
  var timer = null;      // the voyage clock
  var lastFrame = 0;

  function newGame() {
    S = {
      day: 0,
      money: START_MONEY,
      ship: { name: 'Marigold', hull: 86, crew: 18, morale: 68, prov: 152 },
      partner: null,
      port: null,
      hold: {},
      log: [],
      market: {},
      voyage: null,
      voyages: 0,
      hunger: 0,
      lifetime: 0,
      startOfVoyage: 0,
      moneyAtStart: START_MONEY,
      pendingEnd: null,
      revealed: false,
      over: false
    };
  }

  function heldTuns() {
    var n = 0;
    for (var k in S.hold) n += S.hold[k];
    return n;
  }

  function logIt(text) {
    S.log.unshift({ day: S.day, text: text });
    if (S.log.length > 40) S.log.pop();
    renderLog();
  }

  /* ------------------------------------------------------------ rendering - */
  function render() {
    renderHead();
    renderStats();
    renderHold();
    renderLog();
  }

  function renderHead() {
    $('bt-date').textContent = fmtDate(S.day);
    $('bt-money').textContent = money(S.money);
    /* The destination is drawn when the expedition sails but is not shown
     * anywhere until landfall — the whole point of the voyage is finding it. */
    $('bt-partner').textContent = S.revealed ? S.port.name : 'None';
    $('bt-house').textContent = S.revealed
      ? 'A shipping house of London, in partnership with ' + S.partner.house
      : 'A shipping house of London';
    $('bt-shipname').textContent = 'The ' + S.ship.name;
  }

  function meter(label, value, max, cls, readout) {
    var pct = clamp(value / max * 100, 0, 100);
    var low = pct < 30 ? ' low' : '';
    return '<div class="bt-stat">' +
      '<div class="row"><span>' + label + '</span><b>' + readout + '</b></div>' +
      '<div class="bt-meter ' + cls + low + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '</div>';
  }

  function renderStats() {
    var s = S.ship;
    $('bt-stats').innerHTML =
      meter('Hull', s.hull, 100, 'hull', Math.round(s.hull) + '/100') +
      meter('Victuals', s.prov, PROV_MAX, 'prov', Math.round(s.prov) + ' units') +
      meter('Crew morale', s.morale, 100, 'morale', Math.round(s.morale) + '/100') +
      '<div class="bt-stat"><div class="row"><span>Hands aboard</span><b>' + s.crew + '</b></div></div>';
  }

  function renderHold() {
    var box = $('bt-hold'), rows = '', any = false;
    for (var id in S.hold) {
      if (S.hold[id] <= 0) continue;
      any = true;
      rows += '<div class="line"><span>' + GOODS[id].name + '</span><b>' + S.hold[id] + ' tun</b></div>';
    }
    var used = heldTuns();
    box.innerHTML = (any ? rows : '<p class="bt-empty">Empty. She is sailing in ballast.</p>') +
      '<div class="bt-holdbar">' +
      meter('Stowage', used, HOLD_TUNS, 'hull', used + '/' + HOLD_TUNS + ' tun') +
      '</div>';
  }

  function renderLog() {
    $('bt-log').innerHTML = S.log.map(function (e) {
      return '<p><em>' + fmtDate(e.day) + '</em>' + e.text + '</p>';
    }).join('') || '<p class="bt-empty">Nothing entered yet.</p>';
  }

  function setCaption(text, stat) {
    $('bt-chartcap').textContent = text;
    $('bt-chartstat').textContent = stat || '';
  }

  /* -------------------------------------------------------------- chart --- */
  function buildRhumbs() {
    var g = $('bt-rhumbs'), out = '', nodes = [[556, 438], [430, 170]], i, j;
    for (j = 0; j < nodes.length; j++) {
      for (i = 0; i < 16; i++) {
        var a = i * Math.PI / 8;
        out += '<line x1="' + nodes[j][0] + '" y1="' + nodes[j][1] +
          '" x2="' + (nodes[j][0] + Math.cos(a) * 900) +
          '" y2="' + (nodes[j][1] + Math.sin(a) * 900) + '"/>';
      }
    }
    g.innerHTML = out;
  }

  function pin(p, label, sub, cls) {
    return '<g>' +
      '<circle cx="' + p.x + '" cy="' + p.y + '" r="9" fill="var(--wax)" opacity=".28" class="' + (cls || '') + '"/>' +
      '<circle cx="' + p.x + '" cy="' + p.y + '" r="4.5" fill="var(--wax)" stroke="#f3e6c8" stroke-width="1.4"/>' +
      '<text x="' + (p.x + 12) + '" y="' + (p.y + 1) + '" class="bt-portlabel">' + label + '</text>' +
      (sub ? '<text x="' + (p.x + 12) + '" y="' + (p.y + 14) + '" class="bt-portsub">' + sub + '</text>' : '') +
      '</g>';
  }

  function renderPins() {
    var out = pin(LONDON, 'London', 'the Pool, below the Bridge');
    if (S.revealed) out += pin(S.port, S.port.name, S.port.colony, 'bt-ping');
    $('bt-pins').innerHTML = out;
  }

  function routeD(a, b, bulge) {
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return 'M ' + a.x + ' ' + a.y + ' Q ' + mx + ' ' + (my + bulge) + ' ' + b.x + ' ' + b.y;
  }

  /* The westward passage is dragged south to pick up the trades; the eastward
   * one arcs north onto the Gulf Stream. Both are how it was actually sailed,
   * and they keep the two legs visually distinct. */
  function setRoute(leg) {
    var d = leg === 'home' ? routeD(S.port, LONDON, -118) : routeD(LONDON, S.port, 126);
    $('bt-route').setAttribute('d', d);
    var wake = $('bt-wake');
    wake.setAttribute('d', d);
    var len = wake.getTotalLength();
    wake.style.strokeDasharray = len;
    wake.style.strokeDashoffset = len;
    return len;
  }

  function placeShip(progress) {
    var path = $('bt-route'), len = path.getTotalLength();
    var p = path.getPointAtLength(len * clamp(progress, 0, 1));
    var q = path.getPointAtLength(len * clamp(progress + 0.006, 0, 1));
    var ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
    var ship = $('bt-ship');
    ship.style.display = '';
    ship.setAttribute('transform', 'translate(' + p.x + ' ' + p.y + ') rotate(' + (ang + 90) + ')');
    var wake = $('bt-wake');
    wake.style.strokeDashoffset = wake.getTotalLength() * (1 - clamp(progress, 0, 1));
  }

  function hideShip() {
    $('bt-ship').style.display = 'none';
    $('bt-wake').setAttribute('d', '');
    $('bt-route').setAttribute('d', '');
  }

  /* ------------------------------------------------------------- overlay -- */
  function showCard(html) {
    $('bt-cardbody').innerHTML = html;
    $('bt-overlay').hidden = false;
    $('bt-cardbody').scrollTop = 0;
  }

  function hideCard() { $('bt-overlay').hidden = true; }

  function onClick(id, fn) {
    var node = $(id);
    if (node) node.addEventListener('click', fn);
  }

  /* --------------------------------------------------------------- prices - */
  /* Prices are re-rolled every time a market is entered, so no two ladings are
   * quite the same and a good run of luck is worth noticing. */
  function rollMarket() {
    S.market = {};
    for (var id in GOODS) S.market[id] = rnd(0.86, 1.18);
  }

  function buyPrice(id) {                       // what a market charges you
    return Math.round(GOODS[id].base * S.market[id]);
  }

  function factorPays(id) {                     // colonial factor, English wares
    var mult = (S.port.pays && S.port.pays[id]) || DEFAULT_PAYS;
    return Math.round(GOODS[id].base * mult * S.market[id]);
  }

  function customHousePays(id) {                // London, colonial wares
    return Math.round(GOODS[id].base * GOODS[id].sells * S.market[id]);
  }

  /* ---------------------------------------------------------------- stage - */
  function stage(html) { $('bt-stage').innerHTML = html; }

  function wareRow(id, price, qty, kind) {
    var g = GOODS[id];
    return '<div class="bt-ware' + (qty ? ' has' : '') + '">' +
      '<div class="info"><div class="nm">' + g.name + '</div>' +
      '<div class="pr"><b>' + money(price) + '</b> the tun · ' + g.note + '</div></div>' +
      '<button class="btn step" data-buy="' + kind + ':' + id + ':-1">−</button>' +
      '<div class="qty">' + qty + '</div>' +
      '<button class="btn step" data-buy="' + kind + ':' + id + ':1">+</button>' +
      '</div>';
  }

  /* A lading screen: London sells English wares, a colonial port sells its own.
   * Buying is the only trade the player makes by hand — selling is settled for
   * them on arrival, which is where the funds come in. */
  function ladingScreen(opts) {
    var list = opts.goods.map(function (id) {
      return wareRow(id, buyPrice(id), S.hold[id] || 0, 'buy');
    }).join('');

    var provPrice = PROV_COST[opts.where];
    var repairNeed = Math.round(100 - S.ship.hull);

    var refit = '<div class="bt-refit">' +
      '<button class="btn small" id="bt-buyprov">Take on victuals · ' + PROV_BLOCK +
      ' units for ' + money(PROV_BLOCK * provPrice) + '</button>' +
      (repairNeed > 0
        ? '<button class="btn small" id="bt-repair">Careen and repair · ' + repairNeed +
          ' points for ' + money(repairNeed * REPAIR_COST) + '</button>'
        : '<button class="btn small" disabled>Hull is sound</button>') +
      (S.ship.crew < CREW_FULL
        ? '<button class="btn small" id="bt-hire">Ship ' + (CREW_FULL - S.ship.crew) +
          ' hands · ' + money((CREW_FULL - S.ship.crew) * 22) + '</button>'
        : '') +
      (S.ship.morale < 100
        ? '<button class="btn small" id="bt-liberty">Liberty ashore · ' + money(LIBERTY_COST) + '</button>'
        : '') +
      '</div>';

    var days = passageDays(opts.leg);

    stage(
      '<h2>' + opts.title + '</h2>' +
      '<p class="sub">' + opts.sub + '</p>' +
      '<div class="bt-market">' + list + '</div>' +
      refit +
      '<div class="bt-totals">' +
      '<span>Stowed <b>' + heldTuns() + '</b> of ' + HOLD_TUNS + ' tun</span>' +
      '<span>Capital <b>' + money(S.money) + '</b></span>' +
      '<span>Victuals for <b>' + Math.floor(S.ship.prov / (PROV_PER_DAY * S.ship.crew / CREW_FULL)) +
      '</b> days at sea</span>' +
      '<span>Passage reckoned at <b>' + days + '</b> days</span>' +
      '</div>' +
      '<div class="bt-actions">' +
      '<button class="btn primary" id="bt-sail">' + opts.sail + '</button>' +
      '<span class="bt-label" id="bt-warn"></span>' +
      '</div>');

    $('bt-stage').querySelectorAll('[data-buy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-buy').split(':');
        adjust(parts[1], parseInt(parts[2], 10), opts);
      });
    });

    onClick('bt-buyprov', function () {
      var cost = PROV_BLOCK * provPrice;
      if (S.money < cost || S.ship.prov >= PROV_MAX) return;
      S.money -= cost;
      S.ship.prov = clamp(S.ship.prov + PROV_BLOCK, 0, PROV_MAX);
      render();
      ladingScreen(opts);
    });

    onClick('bt-repair', function () {
      var cost = repairNeed * REPAIR_COST;
      if (S.money < cost) return;
      S.money -= cost;
      S.ship.hull = 100;
      logIt('Careened and repaired at a cost of ' + money(cost) + '.');
      render();
      ladingScreen(opts);
    });

    onClick('bt-hire', function () {
      var need = CREW_FULL - S.ship.crew, cost = need * 22;
      if (S.money < cost) return;
      S.money -= cost;
      S.ship.crew = CREW_FULL;
      S.ship.morale = clamp(S.ship.morale + 4, 0, 100);
      logIt('Shipped ' + need + ' fresh hands for ' + money(cost) + '.');
      render();
      ladingScreen(opts);
    });

    onClick('bt-liberty', function () {
      if (S.money < LIBERTY_COST) return;
      S.money -= LIBERTY_COST;
      S.ship.morale = clamp(S.ship.morale + 26, 0, 100);
      logIt('Gave the hands their liberty ashore. It cost ' + money(LIBERTY_COST) +
        ' and two of them had to be carried back aboard.');
      render();
      ladingScreen(opts);
    });

    onClick('bt-sail', function () { beginCrossing(opts.leg); });

    var warn = [];
    if (heldTuns() === 0) warn.push('She sails in ballast — there is nothing aboard to sell.');
    if (S.ship.prov < (days + 12) * PROV_PER_DAY) {
      warn.push('Victuals are thin for a passage of this length — the sea has a habit of ' +
        'adding days of its own.');
    }
    $('bt-warn').textContent = warn.join('  ');
  }

  function adjust(id, delta, opts) {
    var have = S.hold[id] || 0;
    if (delta > 0) {
      if (heldTuns() >= HOLD_TUNS) return;
      var price = buyPrice(id);
      if (S.money < price) return;
      S.money -= price;
      S.hold[id] = have + 1;
    } else {
      if (have <= 0) return;
      S.money += Math.round(buyPrice(id) * 0.9);   // the market buys back at a loss
      S.hold[id] = have - 1;
    }
    render();
    ladingScreen(opts);
  }

  function londonStage() {
    rollMarket();

    /* Safety valve: a house with an empty hold and not enough capital to buy a
     * single tun cannot start a voyage at all, which is a dead end rather than
     * a defeat. The attorney advances against the next freight. */
    var cheapest = Math.min.apply(null, D.ENGLISH_GOODS.map(function (g) { return buyPrice(g.id); }));
    if (heldTuns() === 0 && S.money < cheapest) {
      S.money += 150;
      logIt('Halliwell advanced ' + money(150) + ' against the next freight. He was distinctly ' +
        'not pleased about it.');
      render();
    }

    ladingScreen({
      where: 'london',
      leg: 'out',
      goods: D.ENGLISH_GOODS.map(function (g) { return g.id; }),
      title: 'Lading at the Legal Quays',
      sub: 'Wharfingers, lightermen, and a customs officer who insists on his fee. Buy what ' +
        S.port.name + ' will want, and do not forget that the passage west is the long one.',
      sail: 'Drop down river and sail for ' + S.port.name
    });
  }

  function portStage() {
    ladingScreen({
      where: 'colony',
      leg: 'home',
      goods: S.port.wares,
      title: 'Lading at ' + S.port.name,
      sub: S.partner.name + ' has the warehouse doors open and the lighters alongside. Take on ' +
        'a homeward cargo — the Custom House in London will eagerly buy the lot.',
      sail: 'Weigh anchor and sail for London'
    });
  }

  /* ------------------------------------------------------------- passages - */
  /* A worn hull, a thin crew or a sullen one all cost days. That is where the
   * consequences of the sea events bite beyond the immediate loss. */
  function passageDays(leg) {
    var base = leg === 'home' ? S.port.homeDays : S.port.outDays;
    var short = Math.max(0, CREW_FULL - S.ship.crew);
    return Math.round(base +
      short * 0.9 +
      (S.ship.morale < 40 ? 3 : 0) +
      (S.ship.hull < 50 ? 2 : 0));
  }

  function drawEvents(leg) {
    var pool = D.EVENTS.filter(function (e) { return e.leg === 'any' || e.leg === leg; });
    var out = [];
    while (out.length < EVENTS_PER_CROSSING && pool.length) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out;
  }

  function beginCrossing(leg) {
    var days = passageDays(leg);
    S.voyage = {
      leg: leg,
      baseDays: days,
      extra: 0,
      progress: 0,
      sailed: 0,
      paused: false,
      fired: 0,
      events: drawEvents(leg),
      scripted: null
    };
    setRoute(leg);
    placeShip(0);
    renderPins();
    logIt('Sailed from ' + (leg === 'home' ? S.port.name : 'London') + ' for ' +
      (leg === 'home' ? 'London' : S.port.name) + ', reckoned at ' + days + ' days.');
    sailingStage();
    startLoop();
  }

  /* The prologue crossing: same animation, narration instead of decisions. */
  function beginScripted(leg, beats, done) {
    S.voyage = {
      leg: leg,
      baseDays: leg === 'home' ? S.port.homeDays : S.port.outDays,
      extra: 0,
      progress: 0,
      sailed: 0,
      paused: false,
      fired: 0,
      events: [],
      scripted: beats,
      onDone: done,
      fast: true
    };
    setRoute(leg);
    placeShip(0);
    sailingStage();
    startLoop();
  }

  function sailingStage() {
    var v = S.voyage;
    stage('<h2>At Sea</h2>' +
      '<p class="sub">' + (v.leg === 'home'
        ? 'Homeward bound with the brisk westerlies on the quarter.'
        : 'Westward, close-hauled, with every single mile bitterly argued for.') + '</p>' +
      '<div class="bt-totals">' +
      '<span>Passage <b id="bt-vday">day 0</b></span>' +
      '<span>Reckoned <b id="bt-vtot">' + v.baseDays + ' days</b></span>' +
      '<span>Decisions put to you <b id="bt-vev">' + v.fired + ' of ' +
      (v.scripted ? 0 : EVENTS_PER_CROSSING) + '</b></span>' +
      '</div>');
  }

  /* A plain interval rather than requestAnimationFrame: a crossing is a slow
   * crawl across a chart, 25 ticks a second is ample for it, and an interval
   * keeps running when the tab is not the one being looked at. rAF would stall
   * the voyage the moment the player switched away. */
  function startLoop() {
    lastFrame = 0;
    stopLoop();
    timer = setInterval(function () { step(performance.now()); }, 40);
  }

  function stopLoop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function step(ts) {
    if (!lastFrame) { lastFrame = ts; return; }
    var dt = Math.min((ts - lastFrame) / 1000, 0.25);
    lastFrame = ts;

    var v = S.voyage;
    if (!v || v.paused || S.over) return;

    var span = v.fast ? CROSSING_SECONDS * 0.6 : CROSSING_SECONDS;
    v.progress = clamp(v.progress + dt / span, 0, 1);
    placeShip(v.progress);

    var nowDays = v.baseDays * v.progress;
    consume(nowDays - v.sailed);
    v.sailed = nowDays;

    var dayEl = $('bt-vday');
    if (dayEl) {
      dayEl.textContent = 'day ' + Math.floor(nowDays + v.extra);
      $('bt-vtot').textContent = (v.baseDays + v.extra) + ' days';
    }
    setCaption(v.leg === 'home' ? 'Homeward bound.' : 'Outward bound.',
      'Day ' + Math.floor(nowDays + v.extra) + ' of about ' + (v.baseDays + v.extra));

    // narration beats (prologue) or decisions (a trading voyage)
    var marks = v.scripted ? v.scripted.map(function (b, i) { return (i + 1) / (v.scripted.length + 1); })
      : EVENT_MARKS;
    if (v.fired < marks.length && v.progress >= marks[v.fired]) {
      var idx = v.fired++;
      v.paused = true;
      if (v.scripted) showBeat(v.scripted[idx]);
      else showEvent(v.events[idx]);
      return;
    }

    if (v.progress >= 1) arrive();
  }

  function consume(days) {
    if (days <= 0) return;
    var rate = PROV_PER_DAY * (S.ship.crew / CREW_FULL);
    S.ship.prov -= rate * days;
    if (S.ship.prov < 0) {
      S.hunger += -S.ship.prov / rate;
      S.ship.prov = 0;
      S.ship.morale = clamp(S.ship.morale - days * 2.5, 0, 100);
    }
    S.day += days;
    renderStats();
    renderHead();
  }

  /* -------------------------------------------------------------- events -- */
  function showEvent(ev) {
    var html = '<div class="kicker">A decision for the owner</div>' +
      '<h2>' + ev.title + '</h2>' +
      '<p class="lead">' + ev.text + '</p>' +
      '<div class="bt-rule"></div>';
    ev.options.forEach(function (o, i) {
      html += '<button class="bt-choice" data-opt="' + i + '">' + o.label + '</button>';
    });
    showCard(html);
    $('bt-cardbody').querySelectorAll('[data-opt]').forEach(function (b) {
      b.addEventListener('click', function () {
        resolveOption(ev, ev.options[parseInt(b.getAttribute('data-opt'), 10)]);
      });
    });
  }

  /* The consequences are rolled and applied the instant the player commits —
   * nothing about the outcome table is shown before the choice is made. */
  function resolveOption(ev, opt) {
    var outcome = weighted(opt.outcomes);
    var tags = applyFx(outcome.fx || {});

    logIt('<b>' + ev.title + '</b> — ' + opt.label + '.');

    var html = '<div class="kicker">' + ev.title + '</div>' +
      '<h2>' + opt.label + '</h2>' +
      '<p class="lead">' + outcome.text + '</p>' +
      '<div class="bt-fx">' + tags.map(function (t, i) {
        return '<span class="bt-tag ' + t.dir + '" style="animation-delay:' + (i * 70) + 'ms">' +
          t.text + '</span>';
      }).join('') + '</div>' +
      '<div class="bt-actions"><button class="btn primary" id="bt-go">' +
      (S.pendingEnd ? 'And that is the end of it' : 'Sail on') + '</button></div>';
    showCard(html);

    onClick('bt-go', function () {
      hideCard();
      if (S.pendingEnd) { endRun(S.pendingEnd); return; }
      S.voyage.paused = false;
      var evEl = $('bt-vev');
      if (evEl) evEl.textContent = S.voyage.fired + ' of ' + EVENTS_PER_CROSSING;
      lastFrame = 0;
    });
  }

  function tag(dir, text) { return { dir: dir, text: text }; }

  function applyFx(fx) {
    var out = [], s = S.ship;

    if (fx.days) {
      S.voyage.extra += fx.days;
      S.day += fx.days;
      consume(fx.days);
      out.push(tag(fx.days > 0 ? 'down' : 'up',
        (fx.days > 0 ? '+' : '−') + Math.abs(fx.days) +
        (Math.abs(fx.days) === 1 ? ' day' : ' days') + ' at sea'));
    }
    if (fx.prov) {
      s.prov = clamp(s.prov + fx.prov, 0, PROV_MAX);
      out.push(tag(fx.prov > 0 ? 'up' : 'down',
        (fx.prov > 0 ? '+' : '−') + Math.abs(fx.prov) + ' victuals'));
    }
    if (fx.hull) {
      s.hull = clamp(s.hull + fx.hull, 0, 100);
      out.push(tag(fx.hull > 0 ? 'up' : 'down',
        (fx.hull > 0 ? '+' : '−') + Math.abs(fx.hull) + ' hull'));
    }
    if (fx.morale) {
      s.morale = clamp(s.morale + fx.morale, 0, 100);
      out.push(tag(fx.morale > 0 ? 'up' : 'down',
        (fx.morale > 0 ? '+' : '−') + Math.abs(fx.morale) + ' morale'));
    }
    if (fx.crew) {
      s.crew = Math.max(0, s.crew + fx.crew);
      out.push(tag(fx.crew > 0 ? 'up' : 'down',
        Math.abs(fx.crew) + ' hand' + (Math.abs(fx.crew) === 1 ? '' : 's') +
        (fx.crew > 0 ? ' shipped' : ' lost')));
    }
    if (fx.money) {
      var delta = fx.money < 0 ? -Math.min(S.money, -fx.money) : fx.money;
      S.money += delta;
      if (delta > 0) S.lifetime += delta;
      out.push(tag(delta > 0 ? 'up' : 'down',
        (delta > 0 ? '+' : '−') + money(Math.abs(delta))));
    }
    if (fx.cargo) {
      var lost = 0;
      for (var id in S.hold) {
        var n = Math.min(S.hold[id], Math.ceil(S.hold[id] * fx.cargo));
        S.hold[id] -= n;
        lost += n;
        if (S.hold[id] <= 0) delete S.hold[id];
      }
      if (lost) out.push(tag('down', lost + ' tun of cargo gone'));
    }

    render();

    /* A fatal outcome is only flagged here. The player still gets to read what
     * their choice did before the run ends — showing the ending immediately
     * would paint over the outcome card. */
    if (s.hull <= 0) S.pendingEnd = 'founder';
    else if (s.crew < CREW_FLOOR) S.pendingEnd = 'crew';
    return out;
  }

  /* ------------------------------------------------------------- arrival -- */
  function arrive() {
    var v = S.voyage;
    S.voyage = null;
    stopLoop();

    var hungry = Math.floor(S.hunger);
    if (hungry > 0) {
      S.hunger = 0;
      S.ship.morale = clamp(S.ship.morale - 6, 0, 100);
      logIt('Made port on desperately short commons — ' + hungry + ' days with absolutely nothing in the ' +
        'bread room.');
    }

    if (v.scripted) { v.onDone(); return; }
    if (v.leg === 'out') arriveColony(v); else arriveLondon(v);
  }

  function settlement(rows, total, opts) {
    var html = '<div class="kicker">' + opts.kicker + '</div><h2>' + opts.title + '</h2>' +
      '<p>' + opts.text + '</p><table class="bt-ledger">';
    if (!rows.length) {
      html += '<tr><td class="muted" colspan="2">Nothing landed. She came in with a hollow ' +
        'hold.</td></tr>';
    }
    rows.forEach(function (r) {
      html += '<tr><td>' + r.name + ' <span class="muted">· ' + r.qty + ' tun at ' +
        money(r.price) + '</span></td><td>' + money(r.total) + '</td></tr>';
    });
    html += '<tr class="sum"><td>' + opts.sumLabel + '</td><td><b>' + money(total) +
      '</b></td></tr></table>' +
      (opts.footer || '') +
      '<div class="bt-actions"><button class="btn primary" id="bt-next">' + opts.next + '</button></div>';
    showCard(html);
    onClick('bt-next', opts.onNext);
  }

  function sellHold(priceFn) {
    var rows = [], total = 0;
    for (var id in S.hold) {
      var qty = S.hold[id];
      if (qty <= 0) continue;
      var price = priceFn(id), sum = price * qty;
      rows.push({ name: GOODS[id].name, qty: qty, price: price, total: sum });
      total += sum;
    }
    S.hold = {};
    S.money += total;
    S.lifetime += total;
    return { rows: rows, total: total };
  }

  function arriveColony() {
    hideShip();
    setCaption('Come to anchor off ' + S.port.name + '.', '');
    rollMarket();
    var sale = sellHold(factorPays);
    logIt('Came to anchor at ' + S.port.name + '. The factor eagerly took the cargo for ' +
      money(sale.total) + '.');
    render();

    settlement(sale.rows, sale.total, {
      kicker: 'Landfall',
      title: S.port.name + ' Roads',
      text: S.partner.name + ' comes off in a swift boat before the anchor is properly down, ' +
        'eagerly counts the tiers, and settles for the English cargo right on the spot.',
      sumLabel: 'Paid by the factor',
      next: 'Go ashore and lade for home',
      onNext: function () { hideCard(); portStage(); render(); }
    });
  }

  function arriveLondon() {
    hideShip();
    setCaption('Moored safely in the Pool of London.', '');
    rollMarket();
    var sale = sellHold(customHousePays);
    S.voyages++;
    var elapsed = Math.floor(S.day - S.startOfVoyage);
    var net = S.money - S.moneyAtStart;

    logIt('Moored in the Pool. The Custom House clerks settled for ' + money(sale.total) + '.');
    render();

    settlement(sale.rows, sale.total, {
      kicker: 'Voyage ' + S.voyages + ' complete',
      title: 'The Custom House',
      text: 'She warps in above Wapping with her yards smartly squared, and the funds are paid ' +
        'over the very same afternoon—less the King’s duty, which nobody mentions twice.',
      sumLabel: 'Received',
      footer: '<div class="bt-rule"></div><p class="muted" style="font-size:14px">' +
        'Voyage of <b>' + elapsed + ' days</b>. The house is ' +
        (net >= 0 ? '<b style="color:var(--good)">' + money(net) + ' better off</b>'
                  : '<b style="color:var(--bad)">' + money(-net) + ' worse off</b>') +
        ' than when she sailed.</p>',
      next: 'Lade her again',
      onNext: function () { hideCard(); startVoyage(); }
    });
  }

  function startVoyage() {
    S.startOfVoyage = S.day;
    S.moneyAtStart = S.money;
    setCaption('At her moorings in the Pool of London.', '');
    renderPins();
    londonStage();
    render();
  }

  /* --------------------------------------------------------------- ending - */
  function endRun(why) {
    S.over = true;
    stopLoop();
    S.voyage = null;
    hideShip();

    var text = why === 'founder'
      ? 'She quietly opens up in the night and goes down by the head before the boats can even ' +
        'be cleared away. What the hungry sea does not take, the London underwriters will ' +
        'bitterly argue over for a year.'
      : 'There are not enough hands left aboard to safely work her. She is brought in by a ' +
        'passing Bristol man on a brutal salvage claim that will eat the house whole.';

    showCard('<div class="kicker">The end of the house</div>' +
      '<h2>The ' + S.ship.name + ' is lost</h2>' +
      '<p class="lead">' + text + '</p>' +
      '<p>Uncle Gerard, when the grim news reaches him, is said to have taken it surprisingly ' +
        'well.</p>' +
      '<div class="bt-rule"></div>' +
      '<table class="bt-ledger">' +
      '<tr><td>Voyages completed</td><td>' + S.voyages + '</td></tr>' +
      '<tr><td>Taken in all</td><td>' + money(S.lifetime) + '</td></tr>' +
      '<tr class="sum"><td>Left in the strongbox</td><td><b>' + money(S.money) + '</b></td></tr>' +
      '</table>' +
      '<div class="bt-actions"><button class="btn primary" id="bt-again">Begin again</button></div>');
    onClick('bt-again', function () { hideCard(); boot(); });
  }

  /* -------------------------------------------------------------- prologue */
  function makePartner(port) {
    var last = pick(D.PARTNER_LAST);
    return {
      name: pick(D.PARTNER_FIRST) + ' ' + last,
      house: pick(D.HOUSE_STYLE).replace('{L}', last)
    };
  }

  function theLetter() {
    showCard(
      '<div class="kicker">Bowgeois &amp; Co. · Thames Street · April 1687</div>' +
      '<h2>A Letter, Delivered Before Breakfast</h2>' +
      '<p class="lead">Sir — It is my profound and melancholy duty to inform you that your ' +
        'uncle, Mr. Gerard Bowgeois, has these past two weeks become thoroughly entangled in a ' +
        'scandal of the most unsavoury nature involving a colonial family. The delicate—and ' +
        'frankly shocking—particulars I must decline to commit to paper.</p><p>The Company of ' +
        'Merchants has permanently withdrawn his licence, the partners have rapidly withdrawn ' +
        'themselves, and the grand counting-house on Thames Street stands utterly empty but ' +
        'for a nervous clerk and a cat. By the strict articles of the house, control of the ' +
        'whole troubled concern therefore falls to ' +
        '<b>you</b>.</p><p>What you inherit, I should say plainly, is exactly one ship—the ' +
        '<i>Marigold</i>, sound enough if you do not look too hard at her timbers—some five ' +
        'hundred pounds, and not a single trading partner anywhere in the world. Every factor ' +
        'your uncle dealt with has already burnt his correspondence.</p><p>There is one door still cracked open. ' +
        'A group expedition sails for the American plantations within the week and will carry ' +
        'any ship that can pay her own way. A house with no partners must go and cross the ' +
        'ocean to find one.</p>' +
      '<p class="sign">Your obedient servant,<br>J. Halliwell, attorney</p>' +
      '<div class="bt-actions"><button class="btn primary" id="bt-accept">Take the house, and sail with them</button></div>');
    onClick('bt-accept', function () { hideCard(); expedition(); });
  }

  function expedition() {
    // The destination is drawn now but stays hidden until landfall.
    S.port = pick(D.PORTS);
    S.partner = makePartner(S.port);

    logIt('Took control of Bowgeois &amp; Co. and boldly joined the expedition to the ' +
      'plantations.');
    setCaption('Five sail in company, confidently standing down Channel.', '');
    render();

    beginScripted('out', [
      {
        kicker: 'The expedition · outward bound',
        title: 'Down Channel in Company',
        text: 'Five sail keep loose company past the Lizard: two Bristol ships, a ' +
          'Dutchman flying English colours with a completely straight face, an armed ' +
          'ketch, and the <i>Marigold</i> trailing astern of the lot of them. You are ' +
          'here on pure sufferance and everyone aboard knows it. The commodore’s only ' +
          'instruction, shouted across the water, was simply to keep up.',
        button: 'Keep up'
      },
      {
        kicker: 'The expedition · mid-ocean',
        title: 'Nothing But Water',
        text: 'Three relentless weeks of it. The ketch loses a topmast in a blow and is left ' +
          'to catch up; the Dutchman vanishes one morning and nobody says where. Your mate, ' +
          'who has survived this run before, spends the long evenings teaching you which of ' +
          'the men can be trusted ' +
          'with a night watch, and which merely say so.',
        button: 'Stand on'
      }
    ], expeditionLandfall);
  }

  function expeditionLandfall() {
    hideShip();
    S.revealed = true;
    renderPins();
    renderHead();
    setCaption('Landfall on the American seaboard.', '');
    S.ship.prov = Math.max(S.ship.prov, 120);   // the expedition victuals ashore
    S.ship.morale = clamp(S.ship.morale + 20, 0, 100);
    render();

    showCard(
      '<div class="kicker">Landfall · ' + fmtDate(S.day) + '</div>' +
      '<h2>' + S.port.name + '</h2>' +
      '<p class="lead">' + S.port.blurb + '</p>' +
      '<p>The expedition scatters to its own secretive business the moment the anchors are ' +
        'properly down. You spend four exhausting days ashore in ' + S.port.name + ', in ' + S.port.colony +
      ', being painfully agreeable to people who have no particular reason to be agreeable ' +
        'back—and on the fifth, you are finally introduced to <b>' + S.partner.name + '</b>.</p>' +
      '<p>' + S.partner.name.split(' ')[0] + ' wants English goods and wants them with utter ' +
        'reliability, has a fine warehouse on the water, and no London house worth the name. ' +
        'The binding articles are signed in a smoky tavern and witnessed by its landlord. <b>' + S.partner.house + '</b> ' +
      'is now the sole correspondent of Bowgeois &amp; Co.</p>' +
      '<div class="bt-rule"></div>' +
      '<p class="muted" style="font-size:14px">' + S.port.name + ' ships ' +
      S.port.wares.map(function (w) { return GOODS[w].name.toLowerCase(); }).join(', ') +
      '. The passage home runs an easy ' + S.port.homeDays + ' days; westward, fighting against ' +
        'the ' +
      'wind, nearer ' + S.port.outDays + '.</p>' +
      '<div class="bt-actions"><button class="btn primary" id="bt-home">Sail for home</button></div>');

    onClick('bt-home', function () {
      hideCard();
      logIt('Articles signed with ' + S.partner.house + ' of ' + S.port.name + '.');
      beginScripted('home', [
        {
          kicker: 'The expedition · homeward',
          title: 'A Fair Wind and a Signed Paper',
          text: 'The westerlies push you home in half the time they took to fight through, ' +
            'which is the very first piece of real luck the house has had this year. You spend ' +
            'the long passage doing eager arithmetic in the margin of the articles, arriving, ' +
            'each time, at the exact same encouraging figure.',
          button: 'Raise the Lizard'
        }
      ], function () {
        hideShip();
        setCaption('Home. And now there is actually somewhere profitable to sail to.', '');
        showCard('<div class="kicker">Home · ' + fmtDate(S.day) + '</div>' +
          '<h2>The House Has a Trade</h2>' +
          '<p class="lead">The <i>Marigold</i> comes up the river on the strong tide and ' +
          'moors safely in the Pool with absolutely nothing in her hold, but something ' +
          'rather better locked in the strongbox: a signed correspondence with a house ' +
          'in ' + S.port.name + '.</p>' +
          '<p>From here on, it is simply the trade. Lade her with what ' + S.port.name +
          ' wants, sail west, sell to ' + S.partner.name + ', lade her with what London ' +
          'hungers for, and sail home. The ocean naturally gets a cruel say in it twice each ' +
            'way.</p>' +
          '<div class="bt-actions"><button class="btn primary" id="bt-begin">Open the ledger</button></div>');
        onClick('bt-begin', function () { hideCard(); startVoyage(); });
      });
    });
  }

  function showBeat(beat) {
    showCard('<div class="kicker">' + beat.kicker + '</div>' +
      '<h2>' + beat.title + '</h2>' +
      '<p class="lead">' + beat.text + '</p>' +
      '<div class="bt-actions"><button class="btn primary" id="bt-beat">' + beat.button + '</button></div>');
    onClick('bt-beat', function () {
      hideCard();
      S.voyage.paused = false;
      lastFrame = 0;
    });
  }

  /* ----------------------------------------------------------------- boot - */
  function boot() {
    newGame();
    buildRhumbs();
    hideShip();
    renderPins();
    render();
    stage('<h2>Bowgeois &amp; Co.</h2>' +
      '<p class="sub">Thames Street, London. One ship, no partners, and a very troubling ' +
        'letter on the mat.</p>');
    theLetter();
  }

  boot();
})();
