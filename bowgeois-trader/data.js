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
    { id: 'broadcloth', name: 'Kersey Broadcloth', base: 18, note: 'Coarse woollen cloth out of the West Country.' },
    { id: 'ironware', name: 'Wrought Ironware', base: 14, note: 'Pots, hinges, hoops and locks from Birmingham.' },
    { id: 'tools', name: 'Axes, Saws & Nails', base: 10, note: 'What a colony wants before it wants anything else.' },
    { id: 'powder', name: 'Gunpowder & Shot', base: 22, note: 'Kegged dry and stowed far from the galley.' },
    { id: 'glass', name: 'Glassware & Bottles', base: 16, note: 'Packed in straw and prayed over.' },
    { id: 'pewter', name: 'Pewter Plate', base: 20, note: 'The mark of a household doing well for itself.' },
    { id: 'salt', name: 'Cheshire Salt', base: 6, note: 'Cheap, heavy, and wanted by every fishery.' },
    { id: 'brandy', name: 'Brandy & Canary', base: 24, note: 'Sells anywhere. Vanishes if the crew are left alone with it.' },
    { id: 'books', name: 'Books & Writing Paper', base: 12, note: 'Bibles, primers, ledgers and almanacks.' },
    { id: 'physic', name: 'Physic & Apothecary Wares', base: 26, note: 'Bark, mercury, lancets, and hope.' }
  ];

  /* Colonial wares are bought at the far port and sold at the London Custom
   * House on the way home. `base` is the colonial price; `sells` is the London
   * multiple. Bulky staples carry a fat multiple, luxuries a slim one.
   */
  var COLONIAL_GOODS = [
    { id: 'cod', name: 'Dried Cod', base: 9, sells: 2.5, note: 'Split, salted and stacked like shingles.' },
    { id: 'staves', name: 'Barrel Staves', base: 7, sells: 2.7, note: 'Oak for the wine islands, always wanted.' },
    { id: 'whaleoil', name: 'Whale Oil', base: 26, sells: 2.0, note: 'Lamp oil for London streets.' },
    { id: 'beaver', name: 'Beaver Pelts', base: 34, sells: 1.9, note: 'Hatters in Southwark will bid against each other.' },
    { id: 'deerskin', name: 'Deerskins', base: 28, sells: 2.0, note: 'Traded up-country and shipped down in bales.' },
    { id: 'tobacco', name: 'Tobacco', base: 20, sells: 2.3, note: 'The whole Chesapeake floats on it.' },
    { id: 'rice', name: 'Carolina Rice', base: 15, sells: 2.4, note: 'New to the low country and already a fortune.' },
    { id: 'indigo', name: 'Indigo Cakes', base: 40, sells: 1.9, note: 'Dye worth more than its weight in most things.' },
    { id: 'pitch', name: 'Pitch & Tar', base: 11, sells: 2.6, note: 'Naval stores. The Navy Board buys all of it.' },
    { id: 'timber', name: 'Ship Timber', base: 8, sells: 2.8, note: 'Masts and knees, scarce at home.' },
    { id: 'flour', name: 'Wheat Flour', base: 12, sells: 2.3, note: 'Barrelled at the falls and shipped down river.' },
    { id: 'maize', name: 'Indian Corn', base: 8, sells: 2.5, note: 'Cheap, filling, and it keeps.' },
    { id: 'molasses', name: 'Molasses & Rum', base: 16, sells: 2.4, note: 'Come north from the sugar islands.' },
    { id: 'sassafras', name: 'Sassafras Root', base: 14, sells: 2.4, note: 'Sold as a cure for very nearly everything.' },
    { id: 'pigiron', name: 'Pig Iron', base: 13, sells: 2.3, note: 'Smelted from bog ore at the head of the bay.' },
    { id: 'salpork', name: 'Salt Pork', base: 13, sells: 2.2, note: 'Victuals for ships and for armies.' }
  ];

  /* ---------------------------------------------------------------- ports --
   * x / y are positions on the chart in `index.html` (viewBox 0 0 1000 560).
   * outDays is the westward passage — beating against the prevailing
   * westerlies, so it is long; homeDays rides the Gulf Stream back and is much
   * shorter. That asymmetry is real and it is the reason the return leg feels
   * different to sail.
   */
  var PORTS = [
    {
      id: 'boston', name: 'Boston', colony: 'the Massachusetts Bay', founded: 1630,
      x: 214, y: 188, outDays: 46, homeDays: 30,
      blurb: 'A hard, pious, wharf-crowded harbour where half the town owns a share in some hull or other.',
      pays: { salt: 2.9, ironware: 2.5, brandy: 2.0, books: 2.6, broadcloth: 2.3 },
      wares: ['cod', 'staves', 'whaleoil', 'timber']
    },
    {
      id: 'salem', name: 'Salem', colony: 'the Massachusetts Bay', founded: 1626,
      x: 206, y: 176, outDays: 45, homeDays: 30,
      blurb: 'Fish flakes to the horizon and a meeting-house that keeps a close account of everyone in it.',
      pays: { salt: 3.0, tools: 2.5, physic: 2.4, glass: 2.3 },
      wares: ['cod', 'sassafras', 'beaver', 'staves']
    },
    {
      id: 'newport', name: 'Newport', colony: 'the Rhode Island colony', founded: 1639,
      x: 224, y: 204, outDays: 46, homeDays: 31,
      blurb: 'A deep, tolerant harbour that asks few questions about a cargo and fewer about a creed.',
      pays: { brandy: 2.6, pewter: 2.4, broadcloth: 2.3, powder: 2.4 },
      wares: ['whaleoil', 'molasses', 'staves', 'salpork']
    },
    {
      id: 'newhaven', name: 'New Haven', colony: 'the Connecticut colony', founded: 1638,
      x: 230, y: 217, outDays: 47, homeDays: 32,
      blurb: 'Nine tidy squares laid out by men who meant to build a second London and settled for a good one.',
      pays: { ironware: 2.6, books: 2.7, tools: 2.5, salt: 2.6 },
      wares: ['timber', 'salpork', 'beaver', 'maize']
    },
    {
      id: 'newyork', name: 'New York', colony: 'the Province of New York', founded: 1624,
      x: 239, y: 231, outDays: 48, homeDays: 32,
      blurb: 'Dutch gables, English customs men, and a river that carries pelts down out of the country beyond.',
      pays: { broadcloth: 2.5, pewter: 2.5, glass: 2.4, brandy: 2.3 },
      wares: ['beaver', 'flour', 'deerskin', 'timber']
    },
    {
      id: 'philadelphia', name: 'Philadelphia', colony: 'the province of Pennsylvania', founded: 1682,
      x: 247, y: 251, outDays: 50, homeDays: 33,
      blurb: 'Five years old, gridded, and already loading more grain than anyone thought the Delaware could carry.',
      pays: { tools: 2.8, ironware: 2.6, glass: 2.5, books: 2.4 },
      wares: ['flour', 'staves', 'salpork', 'maize']
    },
    {
      id: 'annapolis', name: 'Anne Arundel Town', colony: 'the province of Maryland', founded: 1649,
      x: 253, y: 277, outDays: 51, homeDays: 34,
      blurb: 'A landing at the head of the bay where the sweet-scented leaf comes down from the plantations.',
      pays: { broadcloth: 2.6, physic: 2.5, pewter: 2.4, brandy: 2.4 },
      wares: ['tobacco', 'pigiron', 'maize', 'staves']
    },
    {
      id: 'jamestown', name: 'Jamestown', colony: 'the colony of Virginia', founded: 1607,
      x: 262, y: 299, outDays: 52, homeDays: 34,
      blurb: 'The oldest of them, half-burnt twice over, and still where a Virginia cargo is finally agreed upon.',
      pays: { tools: 2.6, physic: 2.6, ironware: 2.4, powder: 2.5 },
      wares: ['tobacco', 'sassafras', 'timber', 'maize']
    },
    {
      id: 'norfolk', name: 'Norfolk', colony: 'the colony of Virginia', founded: 1680,
      x: 268, y: 314, outDays: 52, homeDays: 34,
      blurb: 'A new town on a deep road, living off the pine barrens and everything that can be boiled out of them.',
      pays: { salt: 2.8, powder: 2.5, brandy: 2.4, ironware: 2.4 },
      wares: ['pitch', 'timber', 'tobacco', 'staves']
    },
    {
      id: 'charlestown', name: 'Charles Town', colony: 'the province of Carolina', founded: 1670,
      x: 272, y: 370, outDays: 55, homeDays: 36,
      blurb: 'Hot, low and rich, where the deerskin trade out of the interior meets ships bound for anywhere.',
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
      text: 'The cooper comes aft with his hat in his hands. Three casks of salt beef are weeping brine through the staves, and what he prised the lid off of was green at the edges and smelt like a low tide. He does not know how far the rot has run into the tier behind them.',
      options: [
        {
          label: 'Strike the doubtful casks over the side',
          outcomes: [
            { w: 3, text: 'The casks go over on a line and sink. The rest of the tier is sound and the ship smells like a ship again — but that is a fortnight of dinners on the bottom of the sea.', fx: { prov: -34, morale: -4 } },
            { w: 2, text: 'Once the men start heaving they find the rot has run further than the cooper thought. Half the beef tier follows the first three casks over the rail.', fx: { prov: -56, morale: -8 } }
          ]
        },
        {
          label: 'Rebrine the tier and ration it out',
          outcomes: [
            { w: 2, text: 'Fresh brine, a hard scrub and a heavy hand with the salt. It is not good beef, but it is beef, and nobody is any the worse for it.', fx: { prov: -12, morale: -5 } },
            { w: 3, text: 'Within four days the bloody flux is through the forecastle. Watches go short-handed, the ship is worked slack, and she loses her way in the night.', fx: { prov: -18, morale: -14, days: 5 } }
          ]
        },
        {
          label: 'Bear away for the Western Islands and buy fresh stores',
          outcomes: [
            { w: 4, text: 'Six days lost to the southward, and a Portuguese victualler in Fayal who knows exactly how badly you need him. Still — sound beef, sweet water, and a crew that has had a night ashore.', fx: { days: 6, prov: 60, money: -55, morale: 8 } },
            { w: 2, text: 'The islands are under a hard blow and you stand off two days before a boat can go in. The stores are dear and the delay is dearer.', fx: { days: 9, prov: 44, money: -70, morale: 2 } }
          ]
        }
      ]
    },
    {
      id: 'fever', title: 'Fever Below Decks', leg: 'any',
      text: 'Two hands are hot to the touch and speaking to people who are not in the forecastle. The mate has seen it before and will not say what it was, which tells you what it was.',
      options: [
        {
          label: 'Quarantine them forward and scrub the forecastle with vinegar',
          outcomes: [
            { w: 4, text: 'The sickness stays in the two of them and burns itself out. Working the ship two hands short for a week costs you sea-room and sleep, and nothing else.', fx: { days: 3, morale: -3, prov: -6 } },
            { w: 1, text: 'It spreads anyway, slowly, through the larboard watch. The ship crawls while half of her is on her back.', fx: { days: 7, crew: -1, morale: -10 } }
          ]
        },
        {
          label: 'Let the surgeon bleed them',
          outcomes: [
            { w: 2, text: 'Whether it was the lancet or the luck, both men are on their feet inside the week and the crew credit the surgeon with a miracle.', fx: { days: 2, morale: 6 } },
            { w: 3, text: 'The surgeon bleeds them white. One is sewn into his hammock on the Thursday, and the whole ship watches it done.', fx: { crew: -1, morale: -16, days: 4 } }
          ]
        },
        {
          label: 'Physic them from the medicine chest and work the ship as she is',
          outcomes: [
            { w: 3, text: 'Jesuit’s bark, a warm berth, and the fever breaks. The chest is nearly bare now, but you have not lost an hour of the passage.', fx: { morale: 3 } },
            { w: 2, text: 'The chest does nothing at all. Four more go down, the watches are worked ragged, and the ship makes leeway all week.', fx: { crew: -1, morale: -12, days: 6, prov: -10 } }
          ]
        }
      ]
    },
    {
      id: 'plank', title: 'A Sprung Plank', leg: 'any',
      text: 'She takes a sea on the bow in the middle watch and comes up sluggish. The carpenter finds it below the waterline forward: a plank started at the butt, and the well filling faster than one pump likes.',
      options: [
        {
          label: 'Heave to and fother a sail over the leak',
          outcomes: [
            { w: 4, text: 'A studding sail bedded with oakum is drawn under the bow and sucked into the seam. The pumps gain, then win. Slow, wet, seamanlike work.', fx: { days: 3, hull: 8, morale: 2 } },
            { w: 2, text: 'It takes three attempts in a rising sea to get the sail to bite, and she rolls her guts out the whole time.', fx: { days: 5, hull: 4, morale: -6, cargo: 0.06 } }
          ]
        },
        {
          label: 'Run before it and keep the pumps going',
          outcomes: [
            { w: 3, text: 'You gain a day on the passage and the crew spend all of it at the brakes. She holds — but the seam is worse than it was.', fx: { hull: -12, morale: -8 } },
            { w: 2, text: 'The seam opens further under the strain and the water gets in among the cargo before anyone can shift it.', fx: { hull: -18, cargo: 0.14, morale: -10 } }
          ]
        },
        {
          label: 'Put the carpenter over the side on a stage and let him at it',
          outcomes: [
            { w: 3, text: 'Lashed to a plank in a lumpy sea, the man drives home a wedged patch and comes up blue and cheerful. It will hold to port and beyond.', fx: { days: 2, hull: 12, morale: 6 } },
            { w: 2, text: 'A sea takes the stage out from under him. He is fished out with a broken arm and the patch half-driven.', fx: { days: 4, hull: 3, crew: -1, morale: -9 } }
          ]
        }
      ]
    },
    {
      id: 'sail', title: 'A Sail to Windward', leg: 'any',
      text: 'A sail lifts over the weather horizon at first light and holds the same course as you, which honest men rarely do for six hours together. She shows no colours.',
      options: [
        {
          label: 'Crowd on everything and run',
          outcomes: [
            { w: 4, text: 'You run all day with the yards groaning and lose her by dusk. The ship is strained and the passage longer for the detour, but the hold is untouched.', fx: { days: 4, hull: -5, morale: -2 } },
            { w: 2, text: 'She is the better sailer. By afternoon she is under your quarter, and it is a Sallee rover who takes his pick of the hold and lets you go for the joke of it.', fx: { cargo: 0.3, morale: -14, days: 2 } }
          ]
        },
        {
          label: 'Hoist colours and hail her',
          outcomes: [
            { w: 3, text: 'She answers English — a Bristol man forty days out and short of water. You give him a butt and he gives you the news and a keg of his own brandy.', fx: { prov: -14, morale: 10, money: 20 } },
            { w: 2, text: 'The colours she hoists in reply are not the ones you hoped for. A boarding party goes through the hold with dreadful politeness and takes what it fancies.', fx: { cargo: 0.24, money: -40, morale: -12 } }
          ]
        },
        {
          label: 'Clear for action and stand on',
          outcomes: [
            { w: 2, text: 'You run out what guns you have and hold your course. She thinks better of it and hauls her wind. The crew swagger for a week.', fx: { morale: 14 } },
            { w: 2, text: 'She closes. A short, ugly exchange puts two round shot through the bulwarks and one man on the surgeon’s table before she sheers off.', fx: { hull: -14, crew: -1, morale: -4, days: 1 } },
            { w: 1, text: 'She closes, and comes off worse. You take her boat, her water, and a chest her master would rather you had not found.', fx: { hull: -8, money: 140, morale: 12 } }
          ]
        }
      ]
    },
    {
      id: 'becalmed', title: 'Becalmed', leg: 'out',
      text: 'The wind dies at noon and does not come back. The sea goes to oil, the sails slat themselves to pieces against the masts, and the pitch runs out of the deck seams. Three days of it so far.',
      options: [
        {
          label: 'Put the boats out and tow',
          outcomes: [
            { w: 3, text: 'Sweating men in two boats drag four hundred tons a mile an hour toward a breeze the mate swears he can see. He is right, eventually.', fx: { days: 2, prov: -14, morale: -6 } },
            { w: 2, text: 'A day and a half at the oars for nothing at all. The men come back aboard with their hands ruined and their opinions formed.', fx: { days: 4, prov: -18, morale: -14 } }
          ]
        },
        {
          label: 'Wait it out and put the hands to work on the rigging',
          outcomes: [
            { w: 3, text: 'Five idle days, but she is re-rove, re-tarred and better found than she was when the wind finally comes in from the south-west.', fx: { days: 5, prov: -12, hull: 6 } },
            { w: 2, text: 'Eight days. The water goes short, tempers go shorter, and two men have to be separated with a handspike.', fx: { days: 8, prov: -22, morale: -12 } }
          ]
        },
        {
          label: 'Broach a cask and let them swim',
          outcomes: [
            { w: 3, text: 'An afternoon over the side and a wet cask of brandy. The wind comes at dusk to a crew who would sail her round the world for you.', fx: { days: 3, prov: -16, morale: 16 } },
            { w: 2, text: 'The swimming is fine. What follows the brandy is not, and a man is lost over the side in the dark before anyone is sober enough to notice.', fx: { days: 3, prov: -16, crew: -1, morale: -6 } }
          ]
        }
      ]
    },
    {
      id: 'rats', title: 'Rats in the Hold', leg: 'any',
      text: 'The steward has been quiet about it for a week. He is not quiet about it now: there are droppings in the bread room, a bag of biscuit chewed through, and something has been at the bales.',
      options: [
        {
          label: 'Smoke the hold with brimstone',
          outcomes: [
            { w: 3, text: 'The hold is battened, the pots are lit, and everyone spends a miserable night on deck. In the morning they sweep up rats by the bucket.', fx: { days: 1, prov: -8, morale: -3 } },
            { w: 1, text: 'A pot goes over in the swell. The fire is caught early — early enough — but not before it has done real harm to the ship and the cargo.', fx: { hull: -16, cargo: 0.1, morale: -8, days: 2 } }
          ]
        },
        {
          label: 'Set the ship’s cat and the terrier to it, and shift the stores',
          outcomes: [
            { w: 3, text: 'Two days of restowing and a great deal of enthusiastic murder by the terrier. The stores come off lightly.', fx: { days: 2, prov: -10, morale: 4 } },
            { w: 2, text: 'The dog does her best. It is not enough, and the bread room is a loss by the time you make your landfall.', fx: { prov: -30, morale: -4 } }
          ]
        },
        {
          label: 'Say nothing and keep the passage',
          outcomes: [
            { w: 2, text: 'They eat what they eat and you make your port. A cheap answer, this once.', fx: { prov: -16 } },
            { w: 3, text: 'By the second week they are into the bales as well as the bread. What comes out of the hold is chewed, stained, and worth a good deal less.', fx: { prov: -26, cargo: 0.12, morale: -6 } }
          ]
        }
      ]
    },
    {
      id: 'water', title: 'The Water Is Foul', leg: 'any',
      text: 'The butt broached this morning is green and thick and smells of the bilge. Whoever filled these casks at Deptford filled them from the wrong end of the river, and there are eleven more of them below.',
      options: [
        {
          label: 'Ration the water to two pints a man',
          outcomes: [
            { w: 3, text: 'A hard, thirsty fortnight, sourly borne. You make port with dry casks and a crew who will remember it.', fx: { prov: -10, morale: -14 } },
            { w: 2, text: 'Rationing holds until the second week, when a hand is caught at the scuttlebutt and the whole thing turns into a shouting match on the quarterdeck.', fx: { prov: -14, morale: -20, days: 2 } }
          ]
        },
        {
          label: 'Cut the water with brandy and boil the rest',
          outcomes: [
            { w: 4, text: 'Boiled, cut, and served warm. It is a filthy drink, but nobody is poisoned and nobody is sober enough to complain.', fx: { prov: -18, morale: 4 } },
            { w: 2, text: 'It goes down well. Too well. The brandy tier is dry a month before it should be, and there is that much less to trade with at the far end.', fx: { prov: -22, cargo: 0.08, morale: 2 } }
          ]
        },
        {
          label: 'Stand in for the nearest land and fill the casks',
          outcomes: [
            { w: 3, text: 'A watering party at a stream mouth on a coast nobody can name, and clean sweet water in every butt aboard.', fx: { days: 5, prov: 30, morale: 6 } },
            { w: 2, text: 'The boat is three days finding water fit to drink, and she rolls at anchor on a lee shore the whole time with the master white about the mouth.', fx: { days: 7, prov: 20, hull: -8, morale: -4 } }
          ]
        }
      ]
    },
    {
      id: 'grumble', title: 'A Deputation Aft', leg: 'any',
      text: 'Four men come aft together, which is never a good number. They have a paper. It is about the beer, and the watches, and the fact that the last ship out of this house paid a share of the cargo and this one does not.',
      options: [
        {
          label: 'Seize up the ringleader and give him a dozen',
          outcomes: [
            { w: 2, text: 'It is done at the gangway before all hands. Nobody comes aft again, and the ship is worked with a silent, exact obedience.', fx: { morale: -10, days: -1 } },
            { w: 3, text: 'The wrong man, and everyone aboard knows it. The work goes slack in the way that cannot be pointed at, and she makes six knots where she made eight.', fx: { morale: -20, days: 5 } }
          ]
        },
        {
          label: 'Broach a cask of the brandy and hear them out',
          outcomes: [
            { w: 4, text: 'An hour of grievances, a pint apiece, and a promise about the watch-bill that costs you nothing. They go forward pleased with themselves and with you.', fx: { prov: -8, cargo: 0.03, morale: 16 } },
            { w: 2, text: 'The hearing goes well. The brandy goes better, and the middle watch is not fit to hand a reef when the squall comes through at two in the morning.', fx: { prov: -10, hull: -8, morale: 8, days: 1 } }
          ]
        },
        {
          label: 'Advance them a month’s wages out of your own chest',
          outcomes: [
            { w: 4, text: 'Coin in the hand ends an argument faster than anything else at sea. They are yours for the rest of the voyage, and they know that you know it.', fx: { money: -60, morale: 20 } },
            { w: 2, text: 'They take the money and keep the grievance. You are out sixty pounds and no further forward.', fx: { money: -60, morale: 4 } }
          ]
        }
      ]
    },
    {
      id: 'overboard', title: 'Man Overboard', leg: 'any',
      text: 'A cry forward in a grey, rising sea: the boy who was sent out on the jibboom is astern of you and going fast, and there is a squall coming up on the quarter.',
      options: [
        {
          label: 'Down helm, back the mainyard, get a boat away',
          outcomes: [
            { w: 3, text: 'The boat has him inside twenty minutes, coughing and alive. She lies hove to in a squall for half a day, and every man aboard would sail with you again.', fx: { days: 2, morale: 18, hull: -4 } },
            { w: 2, text: 'The boat is away in four minutes and searches until dark, and finds a hat. The crew do not blame you. They are quiet for a week all the same.', fx: { days: 2, crew: -1, morale: -6, hull: -4 } }
          ]
        },
        {
          label: 'Heave a spar over and hold your course',
          outcomes: [
            { w: 3, text: 'You mark the spot in the log and stand on. Nobody says anything to you about it. Nobody says much of anything for a fortnight.', fx: { crew: -1, morale: -22 } },
            { w: 2, text: 'He gets a grip on the spar and a following sea does the rest — hauled aboard over the stern, more astonished than anyone. Pure luck, and it is spent.', fx: { morale: 6 } }
          ]
        }
      ]
    },
    {
      id: 'fog', title: 'Fog on the Banks', leg: 'home',
      text: 'You run into the fog off the Grand Bank at dawn and it closes like a door. Somewhere in it are two hundred sail of Frenchmen fishing, all of them ringing bells, none of them where the bells say they are.',
      options: [
        {
          label: 'Stand south and go round the whole of it',
          outcomes: [
            { w: 4, text: 'A long, dull, safe detour into clear air. You lose the better part of a week and not one splinter.', fx: { days: 6, prov: -10 } },
            { w: 2, text: 'South is where the wind is not. You spend nine days working round the edge of the fog with the sails slatting.', fx: { days: 9, prov: -16, morale: -6 } }
          ]
        },
        {
          label: 'Shorten sail, sound every glass, and creep through',
          outcomes: [
            { w: 3, text: 'Two days of ringing your own bell into the white, and out the other side with the leadsman hoarse and the ship whole.', fx: { days: 2, morale: -4 } },
            { w: 2, text: 'A shallop looms up under the bow with no warning at all. You clip her quarter, carry away your own headrails, and are cursed in French for a mile astern.', fx: { days: 3, hull: -14, money: -30, morale: -6 } }
          ]
        },
        {
          label: 'Fish it — heave to, put lines over, and take cod while you wait',
          outcomes: [
            { w: 3, text: 'Three days hove to on the bank, and the hold gains a tier of good fish for the price of some salt and some patience.', fx: { days: 3, prov: 30, morale: 8 } },
            { w: 2, text: 'The fishing is poor and the fog lifts into a gale that had been building behind it the whole while.', fx: { days: 4, prov: 8, hull: -10, morale: -6 } }
          ]
        }
      ]
    },
    {
      id: 'derelict', title: 'A Derelict', leg: 'any',
      text: 'A snow lies wallowing under bare poles with her foremast over the side and no answer to your hail. Her boats are still on the chocks, which is the part the mate does not like.',
      options: [
        {
          label: 'Board her and see what is worth taking',
          outcomes: [
            { w: 3, text: 'Nobody aboard, and no sign why. Her cargo of logwood and a strongbox in the master’s cabin come across in four boatloads.', fx: { days: 2, money: 190, morale: 8 } },
            { w: 2, text: 'You find out why her boats are still aboard when the boarding party comes back with the sickness in them. Two are down before the week is out.', fx: { days: 4, money: 90, crew: -1, morale: -16 } }
          ]
        },
        {
          label: 'Give her a wide berth',
          outcomes: [
            { w: 4, text: 'You pass a cable off and log her position for the underwriters. The crew look at her all the way past and nobody says a word.', fx: { morale: -4 } },
            { w: 2, text: 'A wide berth, and a week of the forecastle telling each other what was certainly aboard her. The mate reckons it was a fortune.', fx: { morale: -10 } }
          ]
        }
      ]
    },
    {
      id: 'stowaway', title: 'A Stowaway', leg: 'out',
      text: 'Something has been at the bread again, and this time it has left a shoe. They drag a boy of about fourteen out from behind the water casks, Wapping-thin and entirely unrepentant.',
      options: [
        {
          label: 'Rate him boy and put him in the mate’s watch',
          outcomes: [
            { w: 4, text: 'He is quick aloft and quicker with a bucket, and the crew adopt him inside a week. Another mouth, and worth it.', fx: { prov: -10, morale: 10 } },
            { w: 2, text: 'He is willing and useless, and falls out of the rigging on the fourth day. The surgeon sets the arm; the boy eats and does nothing for a month.', fx: { prov: -14, morale: -2 } }
          ]
        },
        {
          label: 'Clap him in irons and hand him to the magistrates at the far end',
          outcomes: [
            { w: 3, text: 'He sits in the cable tier eating your bread and glaring, and the crew like you rather less for every day of it.', fx: { prov: -8, morale: -12 } },
            { w: 2, text: 'He is out of the irons and over the side into a shore boat the first night in soundings, with a coil of your best line under his arm.', fx: { prov: -8, money: -25, morale: -8 } }
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
