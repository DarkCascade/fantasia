/* Bowgeois Trader — content tables.
 *
 * Everything a designer would want to tune lives here: the wares, the ports of
 * the American seaboard, the merchant houses, and the pool of voyage events.
 * `game.js` holds no prose and no prices.
 *
 * Period: the game opens in the spring of 1687, so every port below is one that
 * actually existed and actually traded by then.
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- wares --
   * English wares are bought in London and sold to the factor at the far end.
   * `base` is the London price per tun; a port's `pays` table multiplies it.
   */
  var ENGLISH_GOODS = [
    { id: 'broadcloth', name: 'Kersey Broadcloth', base: 18, note: 'Stout West Country woollens, woven to keep the Atlantic damp from a man’s bones.' },
    { id: 'ironware', name: 'Wrought Ironware', base: 14, note: 'Sturdy Birmingham iron—heavy hinges, barrel hoops, and locks for untrusting men.' },
    { id: 'tools', name: 'Axes, Saws & Nails', base: 10, note: 'The very foundation of a settlement; wood cannot be worked nor houses built without them.' },
    { id: 'powder', name: 'Gunpowder & Shot', base: 22, note: 'Kegged dry and kept well clear of the cook’s fires. A necessity for both hunting and survival.' },
    { id: 'glass', name: 'Glassware & Bottles', base: 16, note: 'Packed tight in straw and prayed over at every heavy swell.' },
    { id: 'pewter', name: 'Pewter Plate', base: 20, note: 'The gleaming mark of a colonial household doing rather well for itself.' },
    { id: 'salt', name: 'Cheshire Salt', base: 6, note: 'Cheap, immensely heavy, and desperately wanted by every fishery on the seaboard.' },
    { id: 'brandy', name: 'Brandy & Canary Wine', base: 24, note: 'Fetches a premium anywhere. Tends to vanish mysteriously if the watch goes thirsty.' },
    { id: 'books', name: 'Books & Writing Paper', base: 12, note: 'Bibles to save their souls, and ledgers to tally their earthly fortunes.' },
    { id: 'physic', name: 'Physic & Apothecary Wares', base: 26, note: 'Jesuit’s bark, sharp lancets, quicksilver, and no small amount of hope.' }
  ];

  /* Colonial wares are bought at the far port and sold at the London Custom
   * House on the way home. `base` is the colonial price; `sells` is the London
   * multiple. Bulky staples carry a fat multiple, luxuries a slim one.
   */
  var COLONIAL_GOODS = [
    { id: 'cod', name: 'Dried Cod', base: 9, sells: 2.5, note: 'Split, heavily salted, and stacked up like roofing shingles. Smells of honest money.' },
    { id: 'staves', name: 'Barrel Staves', base: 7, sells: 2.7, note: 'Stout oak bound for the wine islands. A reliable freight that is always in demand.' },
    { id: 'whaleoil', name: 'Whale Oil', base: 26, sells: 2.0, note: 'The murky gold that keeps the streets of London brightly lit and relatively safe.' },
    { id: 'beaver', name: 'Beaver Pelts', base: 34, sells: 1.9, note: 'Rich fur for which the master hatters of Southwark will fiercely bid against one another.' },
    { id: 'deerskin', name: 'Deerskins', base: 28, sells: 2.0, note: 'Traded from the deep interior and shipped down the rivers in heavy, fragrant bales.' },
    { id: 'tobacco', name: 'Tobacco', base: 20, sells: 2.3, note: 'The sweet-scented leaf upon which the entire Chesapeake economy currently floats.' },
    { id: 'rice', name: 'Carolina Rice', base: 15, sells: 2.4, note: 'A newly cultivated crop in the low country that is already making men staggeringly rich.' },
    { id: 'indigo', name: 'Indigo Cakes', base: 40, sells: 1.9, note: 'A brilliant blue dye worth considerably more than its weight in standard cargo.' },
    { id: 'pitch', name: 'Pitch & Tar', base: 11, sells: 2.6, note: 'Essential naval stores. The Navy Board will gladly buy every barrel you can land.' },
    { id: 'timber', name: 'Ship Timber', base: 8, sells: 2.8, note: 'Stout masts and ship’s knees; raw materials that have grown perilously scarce back home.' },
    { id: 'flour', name: 'Wheat Flour', base: 12, sells: 2.3, note: 'Milled and barrelled at the falls, then barged downriver to feed the wider world.' },
    { id: 'maize', name: 'Indian Corn', base: 8, sells: 2.5, note: 'Cheap, remarkably filling, and resistant to rot. A staple of every working larder.' },
    { id: 'molasses', name: 'Molasses & Rum', base: 16, sells: 2.4, note: 'Sticky sweetness and liquid fire hauled north from the sweltering sugar islands.' },
    { id: 'sassafras', name: 'Sassafras Root', base: 14, sells: 2.4, note: 'Sold to eager apothecaries as a sovereign cure for very nearly every ailment known to man.' },
    { id: 'pigiron', name: 'Pig Iron', base: 13, sells: 2.3, note: 'Rough-smelted from marshy bog ore at the head of the bay. Heavy but essential.' },
    { id: 'salpork', name: 'Salt Pork', base: 13, sells: 2.2, note: 'Hardy victuals that sustain both merchantmen at sea and armies on the march.' }
  ];

  /* ---------------------------------------------------------------- ports --
   * x / y are positions on the chart in `index.html` (viewBox 0 0 1000 560),
   * traced onto the real engraved coastline of chart-bg.png rather than
   * invented. The seaboard runs diagonally on that chart, north-east to
   * south-west, roughly along:
   *   (300,95) (265,112) (240,130) (222,150) (205,172) (187,193) (168,213)
   *   (150,232) (135,250) (120,268) (110,288) (100,307) (92,330) (80,350)
   *   (66,370) (55,388) (48,405)
   * Each port sits a few units seaward of that line so the pin reads as
   * standing at the water's edge and its label runs out over open ocean.
   * Move a port and you must re-check it against the drawing, not just the
   * numbers.
   * outDays is the westward passage — beating against the prevailing
   * westerlies, so it is long; homeDays rides the Gulf Stream back and is much
   * shorter. That asymmetry is real and it is the reason the return leg feels
   * different to sail.
   */
  var PORTS = [
    {
      id: 'boston', name: 'Boston', colony: 'the Massachusetts Bay', founded: 1630,
      x: 260, y: 118, outDays: 46, homeDays: 30,
      blurb: 'A stern, crowded harbor bristling with wharves, where half the town holds a share in some merchant hull or other.',
      pays: { salt: 2.9, ironware: 2.5, brandy: 2.0, books: 2.6, broadcloth: 2.3 },
      wares: ['cod', 'staves', 'whaleoil', 'timber']
    },
    {
      id: 'salem', name: 'Salem', colony: 'the Massachusetts Bay', founded: 1626,
      x: 303, y: 95, outDays: 45, homeDays: 30,
      blurb: 'Endless racks of drying fish scent the air, while a strict meeting-house keeps a watchful eye on every soul.',
      pays: { salt: 3.0, tools: 2.5, physic: 2.4, glass: 2.3 },
      wares: ['cod', 'sassafras', 'beaver', 'staves']
    },
    {
      id: 'newport', name: 'Newport', colony: 'the Rhode Island colony', founded: 1639,
      x: 235, y: 142, outDays: 46, homeDays: 31,
      blurb: 'A deep, tolerant anchorage that asks refreshingly few questions about a man’s cargo, and even fewer about his creed.',
      pays: { brandy: 2.6, pewter: 2.4, broadcloth: 2.3, powder: 2.4 },
      wares: ['whaleoil', 'molasses', 'staves', 'salpork']
    },
    {
      id: 'newhaven', name: 'New Haven', colony: 'the Connecticut colony', founded: 1638,
      x: 211, y: 168, outDays: 47, homeDays: 32,
      blurb: 'Nine tidy squares laid out by ambitious men who meant to build a second London and settled for a very good one.',
      pays: { ironware: 2.6, books: 2.7, tools: 2.5, salt: 2.6 },
      wares: ['timber', 'salpork', 'beaver', 'maize']
    },
    {
      id: 'newyork', name: 'New York', colony: 'the Province of New York', founded: 1624,
      x: 187, y: 196, outDays: 48, homeDays: 32,
      blurb: 'A bustling mix of Dutch gables and English customs men, fed by a mighty river carrying wealth from the deep interior.',
      pays: { broadcloth: 2.5, pewter: 2.5, glass: 2.4, brandy: 2.3 },
      wares: ['beaver', 'flour', 'deerskin', 'timber']
    },
    {
      id: 'philadelphia', name: 'Philadelphia', colony: 'the province of Pennsylvania', founded: 1682,
      x: 161, y: 224, outDays: 50, homeDays: 33,
      blurb: 'Barely five years old and rigorously gridded, yet already loading more grain than anyone thought the Delaware could bear.',
      pays: { tools: 2.8, ironware: 2.6, glass: 2.5, books: 2.4 },
      wares: ['flour', 'staves', 'salpork', 'maize']
    },
    {
      id: 'annapolis', name: 'Anne Arundel Town', colony: 'the province of Maryland', founded: 1649,
      x: 136, y: 252, outDays: 51, homeDays: 34,
      blurb: 'A prime landing at the head of the bay, where endless hogsheads of the sweet-scented leaf roll down from the plantations.',
      pays: { broadcloth: 2.6, physic: 2.5, pewter: 2.4, brandy: 2.4 },
      wares: ['tobacco', 'pigiron', 'maize', 'staves']
    },
    {
      id: 'jamestown', name: 'Jamestown', colony: 'the colony of Virginia', founded: 1607,
      x: 117, y: 280, outDays: 52, homeDays: 34,
      blurb: 'The oldest of them all, half-burnt twice over, yet still the heart of where Virginia cargoes are fiercely haggled upon.',
      pays: { tools: 2.6, physic: 2.6, ironware: 2.4, powder: 2.5 },
      wares: ['tobacco', 'sassafras', 'timber', 'maize']
    },
    {
      id: 'norfolk', name: 'Norfolk', colony: 'the colony of Virginia', founded: 1680,
      x: 103, y: 308, outDays: 52, homeDays: 34,
      blurb: 'A raw new town on a deep roadstead, wringing its wealth from the endless pine barrens and boiling pitch.',
      pays: { salt: 2.8, powder: 2.5, brandy: 2.4, ironware: 2.4 },
      wares: ['pitch', 'timber', 'tobacco', 'staves']
    },
    {
      id: 'charlestown', name: 'Charles Town', colony: 'the province of Carolina', founded: 1670,
      x: 63, y: 380, outDays: 55, homeDays: 36,
      blurb: 'Hot, low-lying, and rich; where the rugged deerskin trade of the interior meets elegant ships bound for the world.',
      pays: { broadcloth: 2.2, powder: 2.7, physic: 2.7, glass: 2.5 },
      wares: ['deerskin', 'rice', 'indigo', 'pitch']
    }
  ];

  /* ------------------------------------------------------- merchant houses -
   * The partner won on the expedition is a name plus a house style.
   */
  var PARTNER_FIRST = ['Josiah', 'Ezekiel', 'Hannah', 'Increase', 'Tabitha', 'Barnabas',
    'Mercy', 'Cornelius', 'Thomasin', 'Obadiah', 'Prudence', 'Silas'];
  var PARTNER_LAST = ['Thorne', 'Wicke', 'Standish', 'Vanderlyn', 'Ashcombe', 'Poyntz',
    'Larkin', 'Bulkeley', 'Ravensworth', 'Guest', 'Hollingshead', 'Deane'];
  var HOUSE_STYLE = ['{L} & Sons', '{L}, Coote & Co.', 'The House of {L}', '{L} and Nephew',
    '{L} & Partners', 'the Old {L} Wharf Company'];

  /* --------------------------------------------------------------- events --
   * The heart of the prototype. Each event offers actions whose consequences
   * are NOT shown at the time of choosing: every option carries a weighted
   * table of outcomes, one of which is rolled and applied the instant the
   * player commits.
   *
   * fx keys, all optional and all applied immediately:
   *   prov   provisions, in units          hull   hull integrity, 0-100
   *   crew   hands aboard                  morale crew morale, 0-100
   *   days   days added to the passage     money  pounds sterling
   *   cargo  fraction of the hold spoiled, thrown over, or taken
   *
   * `leg` limits an event to the westward ('out') or eastward ('home')
   * passage; 'any' may fire on either.
   */
  var EVENTS = [
    {
      id: 'spoilage', title: 'The Cooper’s Report', leg: 'any',
      text: 'The cooper approaches the quarterdeck, his hat nervously twisting in his hands. Three casks of salt beef are weeping foul brine into the hold. The one he cracked open is green at the seams and reeks of a stagnant tide, and there is no telling how deep the rot has run into the tier behind them.',
      options: [
        {
          label: 'Strike the doubtful casks over the side',
          outcomes: [
            { w: 3, text: 'The casks go over on a line and vanish into the depths. The rest of the tier proves sound, and the ship smells like a ship once more—but that is a fortnight of dinners left on the ocean floor.', fx: { prov: -34, morale: -4 } },
            { w: 2, text: 'Once the hands begin heaving, they find the rot has clawed much deeper than the cooper feared. Half the beef tier follows the first three casks over the rail, a grim sight for a hungry crew.', fx: { prov: -56, morale: -8 } }
          ]
        },
        {
          label: 'Re-brine the tier and ration it out',
          outcomes: [
            { w: 2, text: 'Fresh brine, a punishing scrub, and a very heavy hand with the salt. It makes for miserable eating, but it is still beef, and nobody perishes from the flavor.', fx: { prov: -12, morale: -5 } },
            { w: 3, text: 'Within four days, the bloody flux is raging through the forecastle. Watches go short-handed, the ship is worked with sluggish misery, and she loses precious sea-room in the night.', fx: { prov: -18, morale: -14, days: 5 } }
          ]
        },
        {
          label: 'Bear away for the Western Islands to buy fresh stores',
          outcomes: [
            { w: 4, text: 'Six days lost to the southward, dealing with a Portuguese victualler in Fayal who senses exactly how desperate you are. Still—the beef is sound, the water sweet, and the crew enjoyed a lively night ashore.', fx: { days: 6, prov: 60, money: -55, morale: 8 } },
            { w: 2, text: 'The islands are caught in a howling blow, forcing you to stand off for two agonizing days before a boat can go in. The stores are bitterly dear, and the delay is dearer still.', fx: { days: 9, prov: 44, money: -70, morale: 2 } }
          ]
        }
      ]
    },
    {
      id: 'fever', title: 'Fever Below Decks', leg: 'any',
      text: 'Two hands are burning to the touch and loudly conversing with people who are nowhere near the forecastle. The mate has seen this before and stubbornly refuses to say what it is—which tells you exactly what it is.',
      options: [
        {
          label: 'Quarantine them forward and fiercely scrub the forecastle with vinegar',
          outcomes: [
            { w: 4, text: 'The sickness remains contained in the two of them and slowly burns itself out. Working the ship two hands short for a week costs you sleep and some sea-room, but nothing more.', fx: { days: 3, morale: -3, prov: -6 } },
            { w: 1, text: 'It creeps anyway, slowly and spitefully, through the larboard watch. The ship crawls across the ocean while half her crew lies groaning on their backs.', fx: { days: 7, crew: -1, morale: -10 } }
          ]
        },
        {
          label: 'Let the surgeon bleed them',
          outcomes: [
            { w: 2, text: 'Whether by the sharp edge of the lancet or pure blind luck, both men are back on their feet inside the week. The crew credits the surgeon with a genuine miracle.', fx: { days: 2, morale: 6 } },
            { w: 3, text: 'The surgeon aggressively bleeds them white. One is sewn tightly into his hammock by Thursday, and the entire ship watches in silence as he goes over the side.', fx: { crew: -1, morale: -16, days: 4 } }
          ]
        },
        {
          label: 'Physic them from the medicine chest and work the ship as she is',
          outcomes: [
            { w: 3, text: 'A heavy dose of Jesuit’s bark and a warm berth break the fever. The medicine chest is now nearly bare, but you have not surrendered a single hour of the passage.', fx: { morale: 3 } },
            { w: 2, text: 'The chest’s contents prove entirely useless. Four more men go down, the remaining watches are worked to exhaustion, and the ship drifts aimlessly all week.', fx: { crew: -1, morale: -12, days: 6, prov: -10 } }
          ]
        }
      ]
    },
    {
      id: 'plank', title: 'A Sprung Plank', leg: 'any',
      text: 'She takes a heavy green sea on the bow in the middle watch and comes up sluggishly. The carpenter discovers the cause below the waterline forward: a plank has started at the butt, and the well is filling faster than one pump can handle.',
      options: [
        {
          label: 'Heave to and fother a sail over the leak',
          outcomes: [
            { w: 4, text: 'A studding sail thickly bedded with oakum is drawn under the bow and sucked securely into the seam. The pumps gain on the water, then win. Slow, wet, but properly seamanlike work.', fx: { days: 3, hull: 8, morale: 2 } },
            { w: 2, text: 'It takes three desperate attempts in a rising sea to get the canvas to bite, and she rolls her guts out the entire time, causing distress below.', fx: { days: 5, hull: 4, morale: -6, cargo: 0.06 } }
          ]
        },
        {
          label: 'Run before it and keep the pumps going',
          outcomes: [
            { w: 3, text: 'You actually gain a day on the passage, though the weary crew spend all of it cursing at the pump brakes. She holds—but the injured seam looks far worse than before.', fx: { hull: -12, morale: -8 } },
            { w: 2, text: 'The seam groans and opens further under the relentless strain. Bitter seawater gets in among the cargo before anyone can climb down to shift it.', fx: { hull: -18, cargo: 0.14, morale: -10 } }
          ]
        },
        {
          label: 'Put the carpenter over the side on a stage and let him at it',
          outcomes: [
            { w: 3, text: 'Lashed precariously to a plank in a lumpy sea, the man drives home a wedged patch and is hauled up shivering, bruised, and thoroughly cheerful. It will comfortably hold to port and beyond.', fx: { days: 2, hull: 12, morale: 6 } },
            { w: 2, text: 'A surging sea takes the staging right out from under him. He is fished out moments later with a shattered arm, leaving the rough patch only half-driven.', fx: { days: 4, hull: 3, crew: -1, morale: -9 } }
          ]
        }
      ]
    },
    {
      id: 'sail', title: 'A Sail to Windward', leg: 'any',
      text: 'A strange sail lifts over the weather horizon at first light and steadily holds the exact same course as you—something honest men rarely do for six hours together. She stubbornly shows no colours.',
      options: [
        {
          label: 'Crowd on everything and run',
          outcomes: [
            { w: 4, text: 'You flee all day with the yards groaning in protest, finally losing her in the gathering dusk. The ship is severely strained and the passage lengthened, but the hold remains untouched.', fx: { days: 4, hull: -5, morale: -2 } },
            { w: 2, text: 'She proves the better sailer. By late afternoon she is looming under your quarter; a Sallee rover who gleefully takes his pick of your hold and lets you go purely for the joke of it.', fx: { cargo: 0.3, morale: -14, days: 2 } }
          ]
        },
        {
          label: 'Hoist colours and hail her',
          outcomes: [
            { w: 3, text: 'She answers in English—a Bristol merchantman forty days out and desperate for water. You graciously give him a butt; he gives you fresh news and a fine keg of his own brandy.', fx: { prov: -14, morale: 10, money: 20 } },
            { w: 2, text: 'The colours she eventually hoists in reply are distinctly not the ones you hoped for. A well-armed boarding party goes through the hold with dreadful, smiling politeness, taking whatever catches their fancy.', fx: { cargo: 0.24, money: -40, morale: -12 } }
          ]
        },
        {
          label: 'Clear for action and stand on',
          outcomes: [
            { w: 2, text: 'You run out what pitiful guns you have and aggressively hold your course. She reconsiders her chances and hauls her wind. The crew swaggers about the deck for a week.', fx: { morale: 14 } },
            { w: 2, text: 'She confidently closes. A short, incredibly ugly exchange puts two heavy round shot right through your bulwarks and sends one man to the surgeon’s table before she finally sheers off.', fx: { hull: -14, crew: -1, morale: -4, days: 1 } },
            { w: 1, text: 'She closes—and surprisingly comes off worse. You seize her boat, her fresh water, and a locked chest her master would very much rather you had not found.', fx: { hull: -8, money: 140, morale: 12 } }
          ]
        }
      ]
    },
    {
      id: 'becalmed', title: 'Becalmed', leg: 'out',
      text: 'The wind abruptly dies at noon and simply does not come back. The sea turns to flat oil, the limp sails slat themselves to pieces against the masts, and the black pitch literally runs out of the deck seams. Three days of this purgatory so far.',
      options: [
        {
          label: 'Put the boats out and tow',
          outcomes: [
            { w: 3, text: 'Sweating, cursing men in two small boats manage to drag four hundred tons a mile an hour toward a breeze the mate swears he can see. Miraculously, he is eventually right.', fx: { days: 2, prov: -14, morale: -6 } },
            { w: 2, text: 'A brutal day and a half at the heavy oars for nothing at all. The men climb back aboard with their hands ruined and their resentful opinions fully formed.', fx: { days: 4, prov: -18, morale: -14 } }
          ]
        },
        {
          label: 'Wait it out and put the hands to work on the rigging',
          outcomes: [
            { w: 3, text: 'Five idle, sweltering days pass, but she is re-rove, re-tarred, and far better found than she was when the wind finally blesses you from the south-west.', fx: { days: 5, prov: -12, hull: 6 } },
            { w: 2, text: 'Eight miserable days. The water runs short, tempers run shorter, and two exhausted men have to be forcefully separated with a heavy handspike.', fx: { days: 8, prov: -22, morale: -12 } }
          ]
        },
        {
          label: 'Broach a cask and let them swim',
          outcomes: [
            { w: 3, text: 'A joyous afternoon over the side followed by a generously wet cask of brandy. The wind returns at dusk to a cheerful crew who would gladly sail her round the world for you.', fx: { days: 3, prov: -16, morale: 16 } },
            { w: 2, text: 'The swimming is fine. What follows the brandy is undeniably not; a man slips over the side in the dark before anyone is sober enough to notice him go.', fx: { days: 3, prov: -16, crew: -1, morale: -6 } }
          ]
        }
      ]
    },
    {
      id: 'rats', title: 'Rats in the Hold', leg: 'any',
      text: 'The steward has kept quietly optimistic about it for a week. He is not quiet now: there are fresh droppings in the bread room, a heavy bag of biscuit chewed straight through, and something wicked has been at the trade bales.',
      options: [
        {
          label: 'Smoke the hold with brimstone',
          outcomes: [
            { w: 3, text: 'The hold is securely battened, the foul pots are lit, and everyone spends a thoroughly miserable night coughing on deck. In the morning, they sweep up dead rats by the bucketful.', fx: { days: 1, prov: -8, morale: -3 } },
            { w: 1, text: 'A burning pot goes over in the swell. The fire is caught early—early enough—but not before doing very real harm to both the ship’s timbers and the cargo.', fx: { hull: -16, cargo: 0.1, morale: -8, days: 2 } }
          ]
        },
        {
          label: 'Set the ship’s cat and the terrier to it, and shift the stores',
          outcomes: [
            { w: 3, text: 'Two exhausting days of restowing accompanied by a great deal of enthusiastic murder from the terrier. The stores come off remarkably lightly.', fx: { days: 2, prov: -10, morale: 4 } },
            { w: 2, text: 'The dog does her very best. Sadly, it is nowhere near enough, and the bread room is effectively a total loss by the time you finally make your landfall.', fx: { prov: -30, morale: -4 } }
          ]
        },
        {
          label: 'Say nothing and keep the passage',
          outcomes: [
            { w: 2, text: 'They eat what they eat, and you make your port without delay. A dangerously cheap answer, this once.', fx: { prov: -16 } },
            { w: 3, text: 'By the second week they are greedily into the bales as well as the bread. What eventually comes out of the hold is chewed, badly stained, and worth a good deal less.', fx: { prov: -26, cargo: 0.12, morale: -6 } }
          ]
        }
      ]
    },
    {
      id: 'water', title: 'The Water Is Foul', leg: 'any',
      text: 'The butt broached this morning is thick, deeply green, and smells violently of the bilge. Whoever filled these casks at Deptford drew them from the wrong end of the river, and there are eleven more of them brooding below.',
      options: [
        {
          label: 'Ration the sound water to two pints a man',
          outcomes: [
            { w: 3, text: 'A hard, dangerously thirsty fortnight, sourly borne by all. You make port with dry casks and a parched crew who will not quickly forgive you.', fx: { prov: -10, morale: -14 } },
            { w: 2, text: 'The rationing barely holds until the second week, when a hand is caught sneaking at the scuttlebutt. The whole affair rapidly devolves into a vicious shouting match on the quarterdeck.', fx: { prov: -14, morale: -20, days: 2 } }
          ]
        },
        {
          label: 'Cut the foul water with brandy and boil the rest',
          outcomes: [
            { w: 4, text: 'Boiled, aggressively cut, and served unpleasantly warm. It is a truly filthy drink, but nobody is poisoned and nobody is quite sober enough to launch a proper complaint.', fx: { prov: -18, morale: 4 } },
            { w: 2, text: 'It goes down rather well. Too well, in fact. The brandy tier runs completely dry a month before it should, leaving that much less to trade with at the far end.', fx: { prov: -22, cargo: 0.08, morale: 2 } }
          ]
        },
        {
          label: 'Stand in for the nearest land and fill the casks',
          outcomes: [
            { w: 3, text: 'A successful watering party at a brisk stream mouth on a coast nobody can accurately name. The result is clean, sweet water in every single butt aboard.', fx: { days: 5, prov: 30, morale: 6 } },
            { w: 2, text: 'The boat spends three agonizing days finding water barely fit to drink, while the ship dangerously rolls at anchor on a rocky lee shore with the master visibly white about the mouth.', fx: { days: 7, prov: 20, hull: -8, morale: -4 } }
          ]
        }
      ]
    },
    {
      id: 'grumble', title: 'A Deputation Aft', leg: 'any',
      text: 'Four men come aft together, which is never a comforting number. They carry a paper. It details complaints about the beer, the watches, and the glaring fact that the last ship out of this house paid a cargo share, while this one emphatically does not.',
      options: [
        {
          label: 'Seize up the ringleader and give him a dozen',
          outcomes: [
            { w: 2, text: 'It is done quickly at the gangway before all hands. Not a single man comes aft again, and the ship is henceforth worked with a silent, terrifyingly exact obedience.', fx: { morale: -10, days: -1 } },
            { w: 3, text: 'You flogged the wrong man, and absolutely everyone aboard knows it. The daily work goes slack in ways that cannot be explicitly punished, and she makes six knots where she once made eight.', fx: { morale: -20, days: 5 } }
          ]
        },
        {
          label: 'Broach a cask of the brandy and hear them out',
          outcomes: [
            { w: 4, text: 'An hour of airing grievances, a pint apiece, and a grand promise about the watch-bill that ultimately costs you nothing. They go forward exceedingly pleased with themselves, and with you.', fx: { prov: -8, cargo: 0.03, morale: 16 } },
            { w: 2, text: 'The hearing goes well enough. The brandy goes far better. Consequently, the middle watch is entirely unfit to hand a reef when a vicious squall tears through at two in the morning.', fx: { prov: -10, hull: -8, morale: 8, days: 1 } }
          ]
        },
        {
          label: 'Advance them a month’s wages out of your own chest',
          outcomes: [
            { w: 4, text: 'Hard coin in the hand ends a mariner’s argument faster than anything else on earth. They are entirely yours for the rest of the voyage, and they know that you know it.', fx: { money: -60, morale: 20 } },
            { w: 2, text: 'They cheerfully take the money and stubbornly keep the grievance. You are out sixty pounds and have not moved an inch further forward.', fx: { money: -60, morale: 4 } }
          ]
        }
      ]
    },
    {
      id: 'overboard', title: 'Man Overboard', leg: 'any',
      text: 'A sudden cry forward in a grey, rapidly rising sea: the boy who was sent out on the jibboom is abruptly astern of you and going fast, with a squall building heavily on the quarter.',
      options: [
        {
          label: 'Down helm, back the mainyard, get a boat away',
          outcomes: [
            { w: 3, text: 'The boat has him safely inside twenty minutes, coughing seawater but alive. She lies hove to in a howling squall for half a day, but every man aboard would now sail to hell with you.', fx: { days: 2, morale: 18, hull: -4 } },
            { w: 2, text: 'The boat is away in four frantic minutes, searches until pitch dark, and finds only a floating hat. The crew do not blame you, but they remain eerily quiet for a week all the same.', fx: { days: 2, crew: -1, morale: -6, hull: -4 } }
          ]
        },
        {
          label: 'Heave a spar over and hold your course',
          outcomes: [
            { w: 3, text: 'You grimly mark the spot in the log and stand on. Nobody says a word to you about it. In truth, nobody says much of anything for a very long fortnight.', fx: { crew: -1, morale: -22 } },
            { w: 2, text: 'He miraculously gets a grip on the spar and a freak following sea does the rest—he is hauled aboard over the stern, more astonished than anyone. Pure luck, and the ship’s entire allotment is now spent.', fx: { morale: 6 } }
          ]
        }
      ]
    },
    {
      id: 'fog', title: 'Fog on the Banks', leg: 'home',
      text: 'You run into the heavy fog off the Grand Bank at dawn, and it closes shut like a cellar door. Somewhere out there are two hundred sail of Frenchmen fishing, all ringing bells, and none of them quite where their bells suggest.',
      options: [
        {
          label: 'Stand south and go round the whole of it',
          outcomes: [
            { w: 4, text: 'A long, remarkably dull, yet perfectly safe detour into clear air. You lose the better part of a week, but not a single splinter of the ship.', fx: { days: 6, prov: -10 } },
            { w: 2, text: 'South, unfortunately, is exactly where the wind is not. You spend nine infuriating days working round the edge of the fog bank with the sails slack and slapping.', fx: { days: 9, prov: -16, morale: -6 } }
          ]
        },
        {
          label: 'Shorten sail, sound every glass, and creep through',
          outcomes: [
            { w: 3, text: 'Two incredibly tense days of ringing your own bell into the oppressive white. You emerge out the other side with the leadsman hoarse and the ship wonderfully whole.', fx: { days: 2, morale: -4 } },
            { w: 2, text: 'A heavy shallop looms up directly under the bow with no warning whatsoever. You clip her quarter, entirely carry away your own headrails, and are loudly cursed in French for a mile astern.', fx: { days: 3, hull: -14, money: -30, morale: -6 } }
          ]
        },
        {
          label: 'Fish it — heave to, put lines over, and take cod while you wait',
          outcomes: [
            { w: 3, text: 'Three profitable days hove to on the bank, and the hold actually gains a fresh tier of excellent fish for the mild price of some salt and a little patience.', fx: { days: 3, prov: 30, morale: 8 } },
            { w: 2, text: 'The fishing proves remarkably poor, and worse, the fog abruptly lifts into a vicious gale that had been secretly building behind it the entire time.', fx: { days: 4, prov: 8, hull: -10, morale: -6 } }
          ]
        }
      ]
    },
    {
      id: 'derelict', title: 'A Derelict', leg: 'any',
      text: 'A snow lies wallowing under bare poles with her foremast draped over the side and absolutely no answer to your hail. Her boats are untouched on the chocks, which is the part the mate most explicitly dislikes.',
      options: [
        {
          label: 'Board her and see what is worth taking',
          outcomes: [
            { w: 3, text: 'Not a soul aboard, and no hint as to why. However, her valuable cargo of logwood and a very heavy strongbox from the master’s cabin come across in four sweaty boatloads.', fx: { days: 2, money: 190, morale: 8 } },
            { w: 2, text: 'You find out exactly why her boats are still aboard when the boarding party returns bearing the sickness. Two stout men are dead before the week is out.', fx: { days: 4, money: 90, crew: -1, morale: -16 } }
          ]
        },
        {
          label: 'Give her a wide berth',
          outcomes: [
            { w: 4, text: 'You pass a safe cable’s length off and dutifully log her position for the underwriters in London. The crew stare at her all the way past, and nobody utters a single word.', fx: { morale: -4 } },
            { w: 2, text: 'A decidedly wide berth, followed by a week of the forecastle eagerly telling each other what fabulous wealth was certainly aboard her. The mate angrily reckons it was a fortune.', fx: { morale: -10 } }
          ]
        }
      ]
    },
    {
      id: 'stowaway', title: 'A Stowaway', leg: 'out',
      text: 'Something has been quietly stealing the bread again, and this time it has clumsily left a shoe. They drag a boy of about fourteen out from behind the water casks—Wapping-thin, trembling, and yet entirely unrepentant.',
      options: [
        {
          label: 'Rate him boy and put him in the mate’s watch',
          outcomes: [
            { w: 4, text: 'He proves astonishingly quick aloft and quicker still with a bucket, and the crew practically adopt him inside a week. Another mouth to feed, but well worth it.', fx: { prov: -10, morale: 10 } },
            { w: 2, text: 'He is painfully willing but entirely useless, and predictably falls out of the rigging on the fourth day. The surgeon sets the arm; the boy simply eats and does nothing for a month.', fx: { prov: -14, morale: -2 } }
          ]
        },
        {
          label: 'Clap him in irons and hand him to the magistrates at the far end',
          outcomes: [
            { w: 3, text: 'He sits miserably in the cable tier, eating your bread and fiercely glaring. The crew, feeling a pang of sympathy, like you rather less for every day he suffers.', fx: { prov: -8, morale: -12 } },
            { w: 2, text: 'He slips cleanly out of the irons and drops over the side into a shore boat on the very first night in soundings—taking a heavy coil of your very best line under his arm.', fx: { prov: -8, money: -25, morale: -8 } }
          ]
        }
      ]
    }
  ];

  window.BT_DATA = {
    ENGLISH_GOODS: ENGLISH_GOODS,
    COLONIAL_GOODS: COLONIAL_GOODS,
    PORTS: PORTS,
    PARTNER_FIRST: PARTNER_FIRST,
    PARTNER_LAST: PARTNER_LAST,
    HOUSE_STYLE: HOUSE_STYLE,
    EVENTS: EVENTS
  };
})();
