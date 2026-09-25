/*
 * Greenlit — Reigns, but game development.
 *
 * You run a studio from a 1984 garage onward. Every project starts with a
 * pitch (a binary choice between two genres, each with its own taste for the
 * four quality categories — Audio, Graphics, Story, Gameplay) and a set
 * budget from the publisher. Then the deck takes over: two random decision
 * cards from the studio's deck are dealt as one Reigns-style swipe card, and
 * the player keeps one. Each decision card is invisibly tied to one category:
 * picking it spends some of the budget and raises that category by a hidden
 * amount. The card only ever says so in generalities ("Slightly improves
 * Graphics", "Reduced Cost"), and the four meters at the top never fill —
 * like Reigns, leaning toward a side drops a dot over the meter it will move,
 * sized by how much, and that is all the player gets. When the budget runs
 * dry the game ships: pick one of four randomly generated titles, then a
 * summary finally shows the real quality values, the review, and the profit
 * (revenue — driven by the quality against the genre and the year's market
 * expectations — minus what the project actually cost).
 *
 * Between projects the studio spends profit in a tech shop that adds new
 * decision cards to the deck, and shelves outdated ones so they stop being
 * dealt. Every release moves the calendar forward YEARS_PER_RELEASE years,
 * and new technology (cards) arrives on its historical-ish year. Card labels
 * are always relative to *now* — magnitude against brand-new tech this year,
 * cost against the current budget — so an old card visibly ages from
 * "Greatly improves" down to "Slightly improves" as the industry moves on.
 *
 * Structure: Career is the whole model (no DOM, deterministic apart from
 * Math.random) and Greenlit is the DOM view on top of it. Like Indie Grind
 * this is a plain HTML/CSS overlay, not a Phaser scene.
 * window.launchGreenlit() builds it; window.greenlitGame is the handle, its
 * destroy() takes no arguments, and window.greenlitGame.career exposes the
 * model for headless assertions. The best-ever single release is kept in
 * localStorage (BEST_KEY); the career itself resets when the game is torn
 * down.
 */
(function () {
  "use strict";

  /* ---------- tuning ---------- */

  const BEST_KEY = "greenlit-best-hit";

  const START_YEAR = 1984;
  const YEARS_PER_RELEASE = 2;
  // The market, expectations and new-card stats all grow per era step (one
  // release). Past this year growth stops, so an endless career settles into
  // a stable late game instead of expectations outrunning every card forever.
  const GROWTH_CAP_YEAR = 2030;

  const MARKET_BASE = 60000; // market size (and base budget) for a 1984 game
  const MARKET_GROWTH = 1.12;
  const EXPECT_BASE = 25; // effective quality a 1984 audience calls "average"
  const EXPECT_GROWTH = 1.03;
  // Each era's new tech is a little stronger than expectations rise, so a
  // studio that keeps buying current cards climbs from garage games to hits,
  // while an old card loses ground every release it sits in the deck.
  const CARD_POWER_BASE = 3;
  const CARD_POWER_GROWTH = 1.075;
  // A card's dev cost is a share of the *current* market, not a fixed price:
  // salaries inflate with everything else, so every project gets roughly the
  // same handful of decisions and an outdated card is simply weaker for the
  // money rather than a cheap way to pad out a big budget.
  // Small cards give the most quality per dollar, big ones the most per pick.
  const TIER_POWER = [1, 1.7, 2.6];
  const TIER_COST = [0.1, 0.19, 0.32];
  // Shop price = today's dev cost x PRICE_MULT x how strong the card still is
  // next to brand-new tech of its tier (older tech is marked down).
  const PRICE_MULT = 1.25;
  const PRICE_FLOOR = 0.25;

  // Budget = market x (BUDGET_FLOOR + BUDGET_REP x last review/100): hits earn
  // bigger budgets, flops smaller ones.
  const BUDGET_FLOOR = 0.85;
  const BUDGET_REP = 0.3;
  const START_REP = 0.5;

  // When a card with a natural rival (2D vs 3D) is dealt and its rival is
  // still in the pile, deal them together this often.
  const RIVAL_PAIR_CHANCE = 0.6;
  const MIN_ACTIVE_DECK = 6;

  // A review is judged on weighted quality, then docked up to this share for
  // neglecting a category relative to what the genre asks for.
  const BALANCE_WEIGHT = 0.25;
  const REVIEW_NOISE = 3;
  const REVENUE_LUCK = 0.1; // +/- share of revenue down to market luck

  // Magnitude labels compare a card's power to brand-new mid-tier tech this
  // year, so a new card always reads by its tier and an old one visibly ages
  // ("Greatly improves" -> "Improves" -> "Slightly improves").
  const MAGNITUDES = [
    { max: 0.75, text: "Slightly improves" },
    { max: 1.3, text: "Improves" },
    { max: 2.0, text: "Greatly improves" },
    { max: Infinity, text: "Massively improves" },
  ];
  // Cost labels compare a card's dev cost to the current budget.
  const COSTS = [
    { max: 0.06, text: "Minimal Cost" },
    { max: 0.13, text: "Reduced Cost" },
    { max: 0.23, text: "Moderate Cost" },
    { max: 0.36, text: "High Cost" },
    { max: Infinity, text: "Very High Cost" },
  ];

  const FLY_MS = 380;
  const STAMP_MS = 1100;

  /* ---------- content ---------- */

  const CATS = [
    { id: "audio", label: "Audio", icon: "🎵", color: "#4fb8f0" },
    { id: "graphics", label: "Graphics", icon: "🎨", color: "#f06a9a" },
    { id: "story", label: "Story", icon: "📖", color: "#f2a73b" },
    { id: "gameplay", label: "Gameplay", icon: "🎮", color: "#5ccf7a" },
  ];
  const CAT_MAP = {};
  CATS.forEach((c) => {
    CAT_MAP[c.id] = c;
  });

  // Raw genre weights; normalized below so each genre's four sum to 4.
  const GENRES = [
    { id: "rpg", name: "RPG", icon: "⚔️", blurb: "Stats, swords and a hundred-hour quest.", w: { audio: 0.7, graphics: 0.9, story: 1.6, gameplay: 1.2 } },
    { id: "platformer", name: "Platformer", icon: "🍄", blurb: "Run, jump, repeat until perfect.", w: { audio: 0.9, graphics: 1.2, story: 0.5, gameplay: 1.6 } },
    { id: "shooter", name: "Shooter", icon: "🎯", blurb: "Point. Click. Explode.", w: { audio: 1.0, graphics: 1.4, story: 0.5, gameplay: 1.5 } },
    { id: "adventure", name: "Adventure", icon: "🗺️", blurb: "Use everything on everything.", w: { audio: 0.8, graphics: 1.1, story: 1.7, gameplay: 0.6 } },
    { id: "horror", name: "Horror", icon: "👻", blurb: "Something is behind you. Probably.", w: { audio: 1.6, graphics: 1.1, story: 1.2, gameplay: 0.7 } },
    { id: "racing", name: "Racing", icon: "🏎️", blurb: "Faster. No, faster than that.", w: { audio: 1.0, graphics: 1.6, story: 0.3, gameplay: 1.4 } },
    { id: "puzzle", name: "Puzzle", icon: "🧩", blurb: "Just one more level. Then bed.", w: { audio: 0.9, graphics: 0.8, story: 0.4, gameplay: 1.9 } },
    { id: "rhythm", name: "Rhythm", icon: "🥁", blurb: "Hit the notes. Feel the beat.", w: { audio: 2.0, graphics: 1.0, story: 0.3, gameplay: 1.3 } },
    { id: "strategy", name: "Strategy", icon: "♟️", blurb: "One more turn. One more turn.", w: { audio: 0.6, graphics: 0.8, story: 1.1, gameplay: 1.9 } },
  ];
  const GENRE_MAP = {};
  GENRES.forEach((g) => {
    const sum = CATS.reduce((s, c) => s + g.w[c.id], 0);
    CATS.forEach((c) => {
      g.w[c.id] = (g.w[c.id] * 4) / sum;
    });
    g.w2 = CATS.reduce((s, c) => s + g.w[c.id] * g.w[c.id], 0);
    const sorted = CATS.slice().sort((a, b) => g.w[b.id] - g.w[a.id]);
    g.loves = sorted[0];
    g.shrugs = sorted[sorted.length - 1];
    GENRE_MAP[g.id] = g;
  });

  // Every decision card. tier: 1 small / 2 mid / 3 big. vs: its natural
  // rival (mutual). eff / costMul: per-card tweaks on the tier formula.
  const CARDS = [
    // 1984 — the garage (the starting deck)
    { id: "sprites2d", year: 1984, cat: "graphics", tier: 1, vs: "wire3d", icon: "👾", name: "2D Sprites", text: "Flat, cheap and charming." },
    { id: "wire3d", year: 1984, cat: "graphics", tier: 3, vs: "sprites2d", icon: "📐", name: "Wireframe 3D", text: "Spinning green lines. The future!" },
    { id: "titlescreen", year: 1984, cat: "graphics", tier: 2, icon: "🖼️", name: "Hand-Pixeled Title Screen", text: "First impressions matter." },
    { id: "beeper", year: 1984, cat: "audio", tier: 1, vs: "chiptune", icon: "🔈", name: "PC Speaker Beeps", text: "Beep. Boop. Done." },
    { id: "chiptune", year: 1984, cat: "audio", tier: 2, vs: "beeper", icon: "🎹", name: "Chiptune Soundtrack", text: "Three channels of pure earworm." },
    { id: "sfx", year: 1984, cat: "audio", tier: 1, icon: "💥", name: "Crunchy Sound Effects", text: "Every jump goes 'bwoop'." },
    { id: "textcrawl", year: 1984, cat: "story", tier: 1, icon: "📜", name: "Opening Text Crawl", text: "In a world..." },
    { id: "lorebook", year: 1984, cat: "story", tier: 2, icon: "📘", name: "Lore-Packed Manual", text: "Forty pages nobody will skip." },
    { id: "textscenes", year: 1984, cat: "story", tier: 3, icon: "⌨️", name: "Branching Text Scenes", text: "> GO NORTH" },
    { id: "controls", year: 1984, cat: "gameplay", tier: 2, icon: "🕹️", name: "Tight Controls", text: "It does exactly what you press." },
    { id: "highscores", year: 1984, cat: "gameplay", tier: 1, costMul: 0.55, icon: "🏅", name: "High Score Table", text: "Three letters of eternal glory." },
    { id: "editor", year: 1984, cat: "gameplay", tier: 3, icon: "🧱", name: "Built-in Level Editor", text: "Let the players make the rest." },
    // 1986
    { id: "parallax", year: 1986, cat: "graphics", tier: 2, icon: "🏞️", name: "Parallax Scrolling", text: "Mountains that move slower. Magic." },
    { id: "fmsynth", year: 1986, cat: "audio", tier: 2, icon: "🎛️", name: "FM Synth Score", text: "Twangy, punchy, unmistakable." },
    { id: "saves", year: 1986, cat: "gameplay", tier: 1, icon: "💾", name: "Battery Save Games", text: "Progress that survives dinner." },
    { id: "stills", year: 1986, cat: "story", tier: 2, icon: "🎞️", name: "Still-Frame Cutscenes", text: "A picture and a paragraph." },
    // 1988
    { id: "sprites16", year: 1988, cat: "graphics", tier: 3, icon: "🎨", name: "16-Bit Sprites", text: "Twice the bits. Twice the art." },
    { id: "bosses", year: 1988, cat: "gameplay", tier: 3, icon: "🐉", name: "Epic Boss Fights", text: "It fills the whole screen." },
    { id: "mascot", year: 1988, cat: "story", tier: 1, icon: "🦊", name: "Lovable Mascot", text: "Attitude. Sneakers. Merch." },
    // 1990
    { id: "mode7", year: 1990, cat: "graphics", tier: 2, icon: "🌀", name: "Rotating Floor Effects", text: "The ground spins. Everyone gasps." },
    { id: "sampled", year: 1990, cat: "audio", tier: 2, icon: "🎺", name: "Sampled Instruments", text: "Real(ish) trumpets!" },
    { id: "coop", year: 1990, cat: "gameplay", tier: 2, icon: "👯", name: "Two-Player Co-op", text: "Friendship, tested." },
    { id: "worldmap", year: 1990, cat: "story", tier: 1, icon: "🧭", name: "Overworld Map", text: "Here there be dragons." },
    // 1992
    { id: "midi", year: 1992, cat: "audio", tier: 1, vs: "cdaudio", icon: "🎼", name: "General MIDI Score", text: "Sounds great on *your* sound card." },
    { id: "cdaudio", year: 1992, cat: "audio", tier: 3, vs: "midi", icon: "💿", name: "CD-Quality Soundtrack", text: "Real musicians. Real studio." },
    { id: "fmv", year: 1992, cat: "story", tier: 3, eff: 0.9, costMul: 1.2, icon: "📼", name: "Full-Motion Video", text: "Actual actors! Mostly." },
    { id: "isometric", year: 1992, cat: "graphics", tier: 2, icon: "🔷", name: "Isometric Engine", text: "Three-quarters of a dimension." },
    // 1994
    { id: "polygons", year: 1994, cat: "graphics", tier: 3, vs: "prerender", icon: "🔺", name: "Polygonal 3D", text: "Blocky, bold, fully 3D." },
    { id: "prerender", year: 1994, cat: "graphics", tier: 2, vs: "polygons", icon: "🏛️", name: "Pre-Rendered Backgrounds", text: "Gorgeous, as long as you don't move the camera." },
    { id: "netplay", year: 1994, cat: "gameplay", tier: 3, icon: "🌐", name: "Online Deathmatch", text: "Frag your friends over dial-up." },
    // 1996
    { id: "voice", year: 1996, cat: "audio", tier: 3, icon: "🎙️", name: "Full Voice Acting", text: "Every line, spoken aloud." },
    { id: "analog", year: 1996, cat: "gameplay", tier: 2, icon: "🎮", name: "Analog Stick Controls", text: "Walk, jog, or sprint — your call." },
    { id: "cgi", year: 1996, cat: "story", tier: 3, icon: "🎬", name: "CGI Cinematics", text: "The intro alone sells the box." },
    // 1998
    { id: "gpu", year: 1998, cat: "graphics", tier: 3, icon: "🖥️", name: "Hardware 3D Acceleration", text: "Smooth, filtered, blazing." },
    { id: "dynmusic", year: 1998, cat: "audio", tier: 2, icon: "🎚️", name: "Dynamic Music", text: "The score reacts to the fight." },
    { id: "journal", year: 1998, cat: "story", tier: 1, icon: "📓", name: "Quest Journal", text: "Never forget why you're here." },
    // 2000
    { id: "physics", year: 2000, cat: "gameplay", tier: 3, icon: "🧊", name: "Physics Engine", text: "Stack it. Knock it. Throw it." },
    { id: "surround", year: 2000, cat: "audio", tier: 2, icon: "🔊", name: "Surround Sound", text: "It came from behind you." },
    { id: "dialogue", year: 2000, cat: "story", tier: 2, icon: "🌳", name: "Dialogue Trees", text: "Pick your words carefully." },
    // 2002
    { id: "shaders", year: 2002, cat: "graphics", tier: 3, icon: "✨", name: "Programmable Shaders", text: "Everything is shiny now." },
    { id: "morality", year: 2002, cat: "story", tier: 2, icon: "⚖️", name: "Morality System", text: "Save the kitten or don't." },
    { id: "leaderboards", year: 2002, cat: "gameplay", tier: 1, icon: "📈", name: "Online Leaderboards", text: "Global bragging rights." },
    // 2004
    { id: "openworld", year: 2004, cat: "gameplay", tier: 3, vs: "linear", eff: 1.1, costMul: 1.2, icon: "🌍", name: "Open World", text: "See that mountain? You can climb it." },
    { id: "linear", year: 2004, cat: "gameplay", tier: 2, vs: "openworld", icon: "🎢", name: "Linear Set Pieces", text: "A rollercoaster, perfectly paced." },
    { id: "ragdoll", year: 2004, cat: "graphics", tier: 1, icon: "🤸", name: "Ragdoll Physics", text: "Falling down, beautifully." },
    // 2006
    { id: "hd", year: 2006, cat: "graphics", tier: 3, icon: "📺", name: "HD Textures", text: "You can count the pores." },
    { id: "orchestra", year: 2006, cat: "audio", tier: 3, vs: "licensed", icon: "🎻", name: "Orchestral Score", text: "Seventy players and a choir." },
    { id: "licensed", year: 2006, cat: "audio", tier: 2, vs: "orchestra", icon: "📻", name: "Licensed Soundtrack", text: "Songs you already love." },
    { id: "achievements", year: 2006, cat: "gameplay", tier: 1, costMul: 0.55, icon: "🏆", name: "Achievements", text: "Ding! You opened a door." },
    // 2008
    { id: "mocap", year: 2008, cat: "story", tier: 3, icon: "🎭", name: "Performance Capture", text: "Real actors, every twitch." },
    { id: "crafting", year: 2008, cat: "gameplay", tier: 2, icon: "🔨", name: "Crafting System", text: "Two sticks make a better stick." },
    // 2010
    { id: "procgen", year: 2010, cat: "gameplay", tier: 2, vs: "handmade", costMul: 0.75, icon: "🎲", name: "Procedural Generation", text: "Infinite levels, some of them good." },
    { id: "handmade", year: 2010, cat: "gameplay", tier: 3, vs: "procgen", icon: "✏️", name: "Handcrafted Levels", text: "Every corner placed with love." },
    { id: "lighting", year: 2010, cat: "graphics", tier: 2, icon: "💡", name: "Deferred Lighting", text: "A thousand lights, one frame." },
    // 2012
    { id: "pbr", year: 2012, cat: "graphics", tier: 3, icon: "🪙", name: "Physically Based Rendering", text: "Metal looks like metal." },
    { id: "emergent", year: 2012, cat: "story", tier: 2, icon: "🧬", name: "Emergent Storytelling", text: "Stories nobody wrote." },
    { id: "foley", year: 2012, cat: "audio", tier: 1, icon: "👟", name: "Foley Sessions", text: "Celery snaps for bone breaks." },
    // 2014
    { id: "spatial", year: 2014, cat: "audio", tier: 2, icon: "🎧", name: "3D Spatial Audio", text: "Footsteps, above and to the left." },
    { id: "roguelite", year: 2014, cat: "gameplay", tier: 2, icon: "🔁", name: "Roguelite Meta-Progression", text: "Die. Upgrade. Again." },
    { id: "envstory", year: 2014, cat: "story", tier: 2, icon: "🏚️", name: "Environmental Storytelling", text: "A skeleton in a bathtub says it all." },
    // 2016
    { id: "vr", year: 2016, cat: "gameplay", tier: 3, eff: 0.9, costMul: 1.15, icon: "🥽", name: "VR Support", text: "Look around. Look down. Uh oh." },
    { id: "photogrammetry", year: 2016, cat: "graphics", tier: 3, icon: "📷", name: "Photogrammetry", text: "Scan a real rock. Ship a real rock." },
    // 2018
    { id: "raytracing", year: 2018, cat: "graphics", tier: 3, icon: "🌈", name: "Ray Tracing", text: "Puddles have never looked so good." },
    { id: "liveorch", year: 2018, cat: "audio", tier: 3, icon: "🎼", name: "Live Orchestra Recording", text: "Abbey Road, baby." },
    { id: "branching", year: 2018, cat: "story", tier: 3, icon: "🔀", name: "Branching Cinematic Story", text: "Every choice films a new ending." },
    // 2020
    { id: "haptics", year: 2020, cat: "gameplay", tier: 1, icon: "📳", name: "Haptic Feedback", text: "Feel the rain in your hands." },
    { id: "upscaling", year: 2020, cat: "graphics", tier: 1, eff: 1.2, costMul: 0.55, icon: "🔍", name: "Neural Upscaling", text: "4K from a 1080p budget." },
    // 2022
    { id: "celebvoice", year: 2022, cat: "audio", tier: 3, costMul: 1.25, eff: 1.1, icon: "🌟", name: "Celebrity Voice Cast", text: "Is that... it is!" },
    { id: "sandbox", year: 2022, cat: "gameplay", tier: 3, icon: "🧪", name: "Systemic Sandbox", text: "Fire spreads. Guards gossip. Chaos." },
    // 2024
    { id: "ainpc", year: 2024, cat: "story", tier: 3, icon: "🤖", name: "Conversational NPCs", text: "Ask the blacksmith anything." },
    { id: "genaudio", year: 2024, cat: "audio", tier: 2, icon: "🌊", name: "Generative Soundscape", text: "No two forests sound alike." },
    // 2026
    { id: "neural", year: 2026, cat: "graphics", tier: 3, icon: "🧠", name: "Neural Rendering", text: "It dreams the frames." },
    { id: "persistent", year: 2026, cat: "gameplay", tier: 3, icon: "🪐", name: "Persistent Shared World", text: "The world keeps going while you sleep." },
    // 2028
    { id: "holo", year: 2028, cat: "graphics", tier: 3, eff: 1.1, icon: "💠", name: "Holographic Displays", text: "It's on your coffee table." },
    { id: "biometric", year: 2028, cat: "gameplay", tier: 2, icon: "💓", name: "Biometric Tuning", text: "The game knows when you're scared." },
    // 2030
    { id: "dreamscore", year: 2030, cat: "audio", tier: 3, icon: "🌙", name: "Dream-Adaptive Score", text: "Music that knows how you feel." },
    { id: "livingstory", year: 2030, cat: "story", tier: 3, icon: "♾️", name: "Infinite Living Story", text: "It never ends. Nobody minds." },
  ];
  const CARD_MAP = {};
  CARDS.forEach((c) => {
    c.power = round1(newTechPower(c.tier, c.year) * (c.eff || 1));
    CARD_MAP[c.id] = c;
  });
  const STARTER_DECK = CARDS.filter((c) => c.year === START_YEAR).map((c) => c.id);

  const SPEAKERS = {
    producer: { name: "Producer", icon: "📋", lines: ["We can only afford one of these.", "Two ideas on the whiteboard. Pick one.", "The schedule has room for one more thing.", "Budget says one. Which?"] },
    graphics: { name: "Art Lead", icon: "🖌️", lines: ["I've got two directions for the look.", "Which one ends up on the box art?", "Let's talk visuals."] },
    audio: { name: "Sound Designer", icon: "🎚️", lines: ["Which sound are we going for?", "Headphones on. Pick one.", "Let the ears decide."] },
    story: { name: "Writer", icon: "✒️", lines: ["Where does the story go from here?", "I drafted two directions.", "Every good game needs a hook."] },
    gameplay: { name: "Game Designer", icon: "🎲", lines: ["Which feature makes the cut?", "Fun first. Which one?", "I prototyped both. You choose."] },
    intern: { name: "Intern", icon: "🧃", lines: ["Um, I made a list? It has two things on it.", "Is it okay if I suggest something?", "I brought coffee and two ideas."] },
    publisher: { name: "Publisher", icon: "💼", lines: ["The board wants to know where the money's going.", "Make it sell. Which one?", "Our focus groups are split."] },
    marketing: { name: "Marketing", icon: "📣", lines: ["It needs a name. Something that pops on a shelf."] },
  };
  const MIXED_SPEAKERS = ["producer", "intern", "publisher"];
  const PITCH_LINES = ["It's {year}. New year, new budget. What's next?", "The money's there. What are we making in {year}?", "Players want something new for {year}. Pitch me."];

  const TITLE_WORDS = {
    rpg: { adj: ["Eternal", "Forgotten", "Crystal", "Final", "Ancient", "Shattered"], noun: ["Saga", "Crown", "Oath", "Chronicle", "Legend", "Realm", "Blade"], place: ["Eldermoor", "the Silver Isles", "Varnholt", "the Ashen Throne"], hero: ["Aria", "Kael", "Rowan"] },
    platformer: { adj: ["Super", "Mega", "Turbo", "Hyper", "Bouncy"], noun: ["Jump", "Dash", "Hop", "Leap", "Bounce", "Quest"], place: ["Mushroom Hills", "Cloud Kingdom", "Pipe Town"], hero: ["Pip", "Zippy", "Bolt", "Mo"] },
    shooter: { adj: ["Tactical", "Black", "Iron", "Zero", "Red", "Rogue"], noun: ["Strike", "Protocol", "Vector", "Ops", "Front", "Salvo"], place: ["Sector 9", "Kessler Base", "the Red Zone"], hero: ["Sgt. Hammer", "Viper", "Ghost"] },
    adventure: { adj: ["Lost", "Hidden", "Secret", "Curious", "Sunken"], noun: ["Island", "Voyage", "Mystery", "Map", "Lantern", "Key"], place: ["Tallow Bay", "the Whispering Woods", "Gull's Rest"], hero: ["Nell", "Otis", "Captain Marlowe"] },
    horror: { adj: ["Silent", "Dead", "Hollow", "Pale", "Rotting", "Dark"], noun: ["Asylum", "Whisper", "Silence", "Harvest", "Manor", "Signal"], place: ["Blackwater", "Hollow Creek", "Room 13"], hero: ["Edith", "the Caretaker", "Jonah"] },
    racing: { adj: ["Midnight", "Nitro", "Redline", "Turbo", "Neon", "Wild"], noun: ["Rush", "Drift", "Circuit", "Rally", "Velocity", "Grand Prix"], place: ["Tokyo Bay", "Route 66", "Monte Vista"], hero: ["Max", "Dash", "Flash"] },
    puzzle: { adj: ["Tiny", "Clever", "Infinite", "Pocket", "Quantum", "Gentle"], noun: ["Blocks", "Tiles", "Gems", "Logic", "Cubes", "Tangle"], place: ["Puzzle Town", "the Grid", "Cube Island"], hero: ["Professor Pip", "Dot", "Mr. Square"] },
    rhythm: { adj: ["Neon", "Funky", "Electric", "Groovy", "Loud"], noun: ["Beat", "Groove", "Tempo", "Drop", "Rhythm", "Jam"], place: ["Disco City", "the Dancefloor", "Bassline Boulevard"], hero: ["DJ Dash", "Lola", "MC Metronome"] },
    strategy: { adj: ["Grand", "Total", "Iron", "Imperial", "Eternal"], noun: ["Empire", "Dominion", "Command", "Conquest", "Frontier", "Siege"], place: ["the Old World", "Nine Kingdoms", "the Steppes"], hero: ["Emperor Alric", "General Moss", "Queen Isolde"] },
  };
  const ERA_SUFFIXES = [
    { until: 1991, words: ["Deluxe", "Plus", "Challenge", "Adventure"] },
    { until: 1999, words: ["64", "Turbo", "3D", "Championship Edition"] },
    { until: 2009, words: ["Reloaded", "Online", "Evolution", "Unleashed"] },
    { until: 2019, words: ["Remastered", "Simulator", "Legends", "Origins"] },
    { until: Infinity, words: ["Infinite", "Reborn", "Battle Royale", "Definitive Edition"] },
  ];
  const ROMAN = ["", "", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const TITLE_TEMPLATES = [
    (w) => w.adj + " " + w.noun,
    (w) => "The " + w.adj + " " + w.noun,
    (w) => w.noun + " of " + w.place,
    (w) => w.hero + "'s " + w.noun,
    (w) => w.noun + " " + w.suffix,
    (w) => w.adj + " " + w.noun + " " + pick(["II", "III", "Zero"]),
    (w) => w.hero + ": " + w.adj + " " + w.noun2,
  ];

  const OUTLETS = ["Pixel Gazette", "Cartridge Quarterly", "Joypad Journal", "The Loading Screen", "Respawn Review", "Critical Hit Monthly", "Save Point Weekly"];
  const PRAISE = {
    audio: ["The soundtrack lives in my head rent-free.", "Put headphones on. Trust us."],
    graphics: ["Every frame could hang in a gallery.", "An absolute looker."],
    story: ["We cried. Twice.", "A story that stays with you."],
    gameplay: ["We couldn't put the controller down.", "Pure, tight, addictive fun."],
  };
  const GRIPES = {
    audio: ["The audio sounds like a dial-up modem.", "We played it on mute."],
    graphics: ["Looks like it was drawn with a potato.", "Our eyes filed a complaint."],
    story: ["The plot makes no sense. None.", "Story? What story?"],
    gameplay: ["Plays like wading through soup.", "Fun was not detected."],
  };

  /* ---------- helpers ---------- */

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function roundTo(n, step) {
    return Math.round(n / step) * step;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function pick(arr) {
    return arr[randInt(0, arr.length - 1)];
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function fmtMoney(n) {
    const sign = n < 0 ? "−" : "";
    const a = Math.abs(n);
    let s;
    if (a >= 1e9) s = (a / 1e9).toFixed(2) + "B";
    else if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2) + "M";
    else if (a >= 1e4) s = Math.round(a / 1e3) + "k";
    else if (a >= 1e3) s = (a / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    else s = String(Math.round(a));
    return sign + "$" + s;
  }

  function fmtSigned(n) {
    return (n >= 0 ? "+" : "") + fmtMoney(n);
  }

  /* ---------- economy / scoring (pure) ---------- */

  function eraStep(year) {
    return (Math.min(year, GROWTH_CAP_YEAR) - START_YEAR) / YEARS_PER_RELEASE;
  }

  function marketSize(year) {
    return MARKET_BASE * Math.pow(MARKET_GROWTH, eraStep(year));
  }

  function expectation(year) {
    return EXPECT_BASE * Math.pow(EXPECT_GROWTH, eraStep(year));
  }

  // Power of brand-new tech of a tier in a given year.
  function newTechPower(tier, year) {
    return CARD_POWER_BASE * Math.pow(CARD_POWER_GROWTH, eraStep(year)) * TIER_POWER[tier - 1];
  }

  function cardCost(card, year) {
    return roundTo(marketSize(year) * TIER_COST[card.tier - 1] * (card.costMul || 1), 500);
  }

  function cardPrice(card, year) {
    const fresh = Math.max(PRICE_FLOOR, card.power / newTechPower(card.tier, year));
    return roundTo(cardCost(card, year) * PRICE_MULT * fresh, 500);
  }

  function magnitudeIndex(card, year) {
    const r = card.power / newTechPower(2, year);
    return MAGNITUDES.findIndex((m) => r < m.max);
  }

  function costIndex(card, year, budget) {
    const r = cardCost(card, year) / budget;
    return COSTS.findIndex((c) => r < c.max);
  }

  function effectText(card, year) {
    return MAGNITUDES[magnitudeIndex(card, year)].text + " " + CAT_MAP[card.cat].label;
  }

  function costText(card, year, budget) {
    return COSTS[costIndex(card, year, budget)].text;
  }

  // Quality is judged on the sum of each category weighted by what the
  // genre's fans care about, then docked (up to BALANCE_WEIGHT) for the
  // category that fell furthest below its genre-proportional share. The
  // result is compared to the year's expectation: ratio 1 reviews at ~58.
  function scoreProject(q, genre, year) {
    let total = 0;
    let weighted = 0;
    CATS.forEach((c) => {
      total += q[c.id];
      weighted += q[c.id] * genre.w[c.id];
    });
    const cov = {};
    let floor = total > 0 ? 1 : 0;
    CATS.forEach((c) => {
      cov[c.id] = total > 0 ? q[c.id] / ((total * genre.w[c.id]) / 4) : 0;
      floor = Math.min(floor, cov[c.id]);
    });
    const effective = weighted * (1 - BALANCE_WEIGHT + BALANCE_WEIGHT * Math.sqrt(Math.max(0, floor)));
    const expect = expectation(year);
    const ratio = effective / expect;
    const review = 100 * (1 - Math.pow(0.5, ratio * 1.25));
    // What each category would need to be for an exactly-average game with a
    // genre-proportional spread — the "expected" marker on the summary bars.
    const expected = {};
    CATS.forEach((c) => {
      expected[c.id] = (expect * genre.w[c.id]) / genre.w2;
    });
    const byCov = CATS.slice().sort((a, b) => cov[b.id] - cov[a.id]);
    return { effective, ratio, review, floor, cov, expected, strongest: byCov[0].id, second: byCov[1].id, weakest: byCov[byCov.length - 1].id };
  }

  // Break-even (revenue = a fully spent budget) lands around a 52 review.
  function salesMult(review) {
    return 0.1 + 3.6 * Math.pow(review / 100, 2);
  }

  function verdictFor(review) {
    if (review >= 90) return "Masterpiece!";
    if (review >= 75) return "Critical darling";
    if (review >= 60) return "Solid hit";
    if (review >= 45) return "Mixed reviews";
    return "Panned by critics";
  }

  function reviewColor(review) {
    if (review >= 90) return "#ffd23f";
    if (review >= 75) return "#6fe39a";
    if (review >= 60) return "#b7e36f";
    if (review >= 45) return "#f0c020";
    return "#e0553f";
  }

  function nextNumeral(title) {
    const m = title.match(/^(.*) (II|III|IV|V|VI|VII|VIII|IX|X)$/);
    if (m) {
      const i = ROMAN.indexOf(m[2]);
      if (i > 0 && i < ROMAN.length - 1) return m[1] + " " + ROMAN[i + 1];
      return title + ": Reboot";
    }
    return title + " II";
  }

  /* ---------- model ---------- */

  class Career {
    constructor() {
      this.year = START_YEAR;
      this.cash = 0;
      this.rep = START_REP;
      this.owned = STARTER_DECK.slice();
      this.shelved = new Set();
      this.releases = [];
      this.newTech = [];
      this.gift = null;
      this.project = null;
    }

    activeDeck() {
      return this.owned.filter((id) => !this.shelved.has(id));
    }

    nextBudget() {
      return roundTo(marketSize(this.year) * (BUDGET_FLOOR + BUDGET_REP * this.rep), 1000);
    }

    offerGenres() {
      const a = pick(GENRES);
      let b = pick(GENRES);
      while (b === a) b = pick(GENRES);
      return [a, b];
    }

    startProject(genreId) {
      this.project = {
        genre: GENRE_MAP[genreId],
        budget: this.nextBudget(),
        spent: 0,
        q: { audio: 0, graphics: 0, story: 0, gameplay: 0 },
        picks: [],
        pile: shuffle(this.activeDeck()),
        pair: null,
        over: null,
      };
      if (!this.drawPair()) this.project.over = "ideas";
      return this.project;
    }

    remaining() {
      return this.project ? this.project.budget - this.project.spent : 0;
    }

    drawPair() {
      const p = this.project;
      if (p.pile.length < 2) {
        p.pair = null;
        return null;
      }
      const a = p.pile.splice(randInt(0, p.pile.length - 1), 1)[0];
      let bIdx = -1;
      const rival = CARD_MAP[a].vs;
      if (rival && Math.random() < RIVAL_PAIR_CHANCE) bIdx = p.pile.indexOf(rival);
      if (bIdx < 0) bIdx = randInt(0, p.pile.length - 1);
      const b = p.pile.splice(bIdx, 1)[0];
      p.pair = Math.random() < 0.5 ? [a, b] : [b, a];
      return p.pair;
    }

    // Keep the card on `side` (0 left, 1 right). The kept card is used up for
    // this project; the other goes back in the pile to be dealt again, unless
    // it was the kept card's rival — choosing 3D settles "2D vs 3D" for good.
    pick(side) {
      const p = this.project;
      if (!p || !p.pair || p.over) return null;
      const id = p.pair[side];
      const other = p.pair[1 - side];
      const card = CARD_MAP[id];
      p.spent += cardCost(card, this.year);
      p.q[card.cat] = round1(p.q[card.cat] + card.power);
      p.picks.push(id);
      if (other !== card.vs) p.pile.push(other);
      if (card.vs) p.pile = p.pile.filter((x) => x !== card.vs);
      p.pair = null;
      if (p.spent >= p.budget) p.over = "budget";
      else if (!this.drawPair()) p.over = "ideas";
      return { card, over: p.over };
    }

    titleOptions() {
      const p = this.project;
      const words = TITLE_WORDS[p.genre.id];
      const suffixes = ERA_SUFFIXES.find((e) => this.year <= e.until).words;
      const out = [];
      // A hit in the same genre earns a sequel slot.
      const hit = this.releases.filter((r) => r.genre.id === p.genre.id && r.review >= 70).sort((a, b) => b.review - a.review)[0];
      if (hit) {
        let t = nextNumeral(hit.title);
        while (this.releases.some((r) => r.title === t)) t = nextNumeral(t);
        out.push({ title: t, sequel: true });
      }
      let guard = 0;
      while (out.length < 4 && guard++ < 200) {
        const noun = pick(words.noun);
        let noun2 = pick(words.noun);
        while (noun2 === noun) noun2 = pick(words.noun);
        const t = pick(TITLE_TEMPLATES)({ adj: pick(words.adj), noun, noun2, place: pick(words.place), hero: pick(words.hero), suffix: pick(suffixes) });
        if (!out.some((o) => o.title === t) && !this.releases.some((r) => r.title === t)) out.push({ title: t, sequel: false });
      }
      return shuffle(out);
    }

    release(title) {
      const p = this.project;
      const score = scoreProject(p.q, p.genre, this.year);
      const review = clamp(Math.round(score.review + randInt(-REVIEW_NOISE, REVIEW_NOISE)), 1, 99);
      const luck = 1 - REVENUE_LUCK + Math.random() * REVENUE_LUCK * 2;
      const revenue = roundTo(marketSize(this.year) * salesMult(review) * luck, 100);
      const result = {
        title,
        genre: p.genre,
        year: this.year,
        q: Object.assign({}, p.q),
        expected: score.expected,
        review,
        revenue,
        budget: p.budget,
        spent: p.spent,
        profit: revenue - p.spent,
        picks: p.picks.slice(),
        quotes: this.quotesFor(review, score),
        over: p.over,
      };
      // The studio can't go into debt: a loss bigger than the bank is eaten by
      // the publisher (and the flop still shrinks the next budget via rep).
      result.absorbed = Math.max(0, -(this.cash + result.profit));
      this.cash = Math.max(0, this.cash + result.profit);
      this.rep = review / 100;
      this.releases.push(result);
      const prevYear = this.year;
      this.year += YEARS_PER_RELEASE;
      this.newTech = CARDS.filter((c) => c.year > prevYear && c.year <= this.year).map((c) => c.id);
      // Safety net: a studio that can't afford a single card would otherwise
      // be stuck with an ageing deck that only makes worse games, so the
      // publisher lends it one piece of the newest tech on the market.
      this.gift = null;
      const shop = this.shopCards();
      if (shop.length && shop.every((c) => cardPrice(c, this.year) > this.cash)) {
        const newest = shop[0].year;
        this.gift = pick(shop.filter((c) => c.year === newest)).id;
        this.owned.push(this.gift);
      }
      this.project = null;
      return result;
    }

    quotesFor(review, score) {
      const outlets = shuffle(OUTLETS);
      const first = review >= 45 ? pick(PRAISE[score.strongest]) : pick(GRIPES[score.weakest]);
      let second;
      if (score.floor < 0.75) second = pick(GRIPES[score.weakest].filter((g) => g !== first));
      else second = pick(PRAISE[score.second].filter((g) => g !== first));
      return [
        { text: first, outlet: outlets[0], bad: review < 45 },
        { text: second, outlet: outlets[1], bad: score.floor < 0.75 },
      ];
    }

    shopCards() {
      return CARDS.filter((c) => c.year <= this.year && this.owned.indexOf(c.id) < 0).sort((a, b) => b.year - a.year || a.cat.localeCompare(b.cat));
    }

    price(id) {
      return cardPrice(CARD_MAP[id], this.year);
    }

    buy(id) {
      const card = CARD_MAP[id];
      if (!card || card.year > this.year || this.owned.indexOf(id) >= 0) return false;
      const price = cardPrice(card, this.year);
      if (this.cash < price) return false;
      this.cash -= price;
      this.owned.push(id);
      return true;
    }

    canShelve(id) {
      return !this.shelved.has(id) && this.activeDeck().length > MIN_ACTIVE_DECK;
    }

    toggleShelve(id) {
      if (this.owned.indexOf(id) < 0) return false;
      if (this.shelved.has(id)) this.shelved.delete(id);
      else if (this.canShelve(id)) this.shelved.add(id);
      else return false;
      return true;
    }
  }

  /* ---------- best hit (localStorage) ---------- */

  function loadBest() {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      const v = raw ? JSON.parse(raw) : null;
      return v && typeof v.profit === "number" ? v : null;
    } catch (e) {
      return null;
    }
  }

  function saveBest(best) {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(best));
    } catch (e) {
      /* storage blocked — the record just won't persist */
    }
  }

  /* ---------- view ---------- */

  const HTML =
    '<div class="gl-app">' +
    '<div class="gl-topbar">' +
    '<button class="gl-menubtn" type="button" data-act="menu" aria-label="Return to menu">≡</button>' +
    '<div class="gl-title">GREENLIT</div>' +
    '<div class="gl-chips">' +
    '<div class="gl-chip" id="gl-year">📅 1984</div>' +
    '<div class="gl-chip gl-chip--cash" id="gl-cash">💰 $0</div>' +
    "</div>" +
    "</div>" +
    '<div class="gl-view" id="gl-view"></div>' +
    "</div>";

  const CSS =
    "#gl-root{position:absolute;inset:0;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f4ecd8;" +
    "background:radial-gradient(ellipse at 50% -10%,rgba(92,207,122,.22),transparent 60%),linear-gradient(180deg,#14202e 0%,#0b121c 60%,#05080e 100%);}" +
    ".gl-app{position:absolute;inset:0;display:flex;flex-direction:column;}" +
    ".gl-topbar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;" +
    "background:rgba(5,8,14,.55);border-bottom:2px solid rgba(111,227,154,.22);}" +
    ".gl-menubtn{flex:0 0 auto;width:36px;height:36px;border-radius:10px;border:2px solid rgba(255,224,138,.6);background:rgba(255,255,255,.06);color:#ffe7a3;font-size:18px;cursor:pointer;}" +
    ".gl-menubtn:active{transform:translateY(2px);}" +
    ".gl-title{font-family:'Cooper Black','Bookman Old Style',Georgia,serif;font-size:clamp(17px,4.4vw,24px);letter-spacing:.08em;" +
    "background:linear-gradient(180deg,#e9ffe9 0%,#8ff0b0 45%,#3fae6a 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;}" +
    ".gl-chips{display:flex;gap:6px;}" +
    ".gl-chip{padding:5px 10px;border-radius:16px;border:2px solid rgba(255,224,138,.45);background:rgba(255,255,255,.06);font-weight:700;font-size:clamp(12px,3.3vw,15px);white-space:nowrap;font-variant-numeric:tabular-nums;}" +
    ".gl-chip--neg{color:#ff9d8a;border-color:rgba(255,120,100,.6);}" +
    ".gl-chip.gl-pulse{animation:gl-chip-pulse .5s ease;}" +
    "@keyframes gl-chip-pulse{0%,100%{transform:scale(1);}40%{transform:scale(1.18);}}" +
    ".gl-view{position:relative;flex:1 1 auto;min-height:0;}" +
    /* play screen */
    ".gl-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:10px 12px 12px;}" +
    ".gl-hud{width:100%;max-width:440px;flex:0 0 auto;}" +
    ".gl-meters{display:flex;align-items:flex-end;justify-content:space-between;gap:6px;}" +
    ".gl-meter{position:relative;flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;}" +
    ".gl-meter--budget{flex:1.7 1 0;}" +
    ".gl-dot{height:16px;display:flex;align-items:center;justify-content:center;}" +
    ".gl-dot::before{content:'';display:block;width:0;height:0;border-radius:50%;background:#f4ecd8;transition:width .15s ease,height .15s ease;box-shadow:0 0 8px rgba(255,255,255,.6);}" +
    ".gl-meter--budget .gl-dot::before{background:#ff8a7a;box-shadow:0 0 8px rgba(255,120,100,.7);}" +
    ".gl-dot[data-size='1']::before{width:6px;height:6px;}" +
    ".gl-dot[data-size='2']::before{width:9px;height:9px;}" +
    ".gl-dot[data-size='3']::before{width:12px;height:12px;}" +
    ".gl-dot[data-size='4']::before{width:15px;height:15px;}" +
    ".gl-dot[data-size='5']::before{width:15px;height:15px;border-radius:3px;}" +
    ".gl-meter-icon{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:21px;" +
    "border:2px solid var(--c);background:rgba(0,0,0,.25);box-shadow:inset 0 0 10px rgba(0,0,0,.4);transition:box-shadow .2s ease;}" +
    ".gl-meter.gl-hint .gl-meter-icon{box-shadow:0 0 16px var(--c),inset 0 0 10px rgba(0,0,0,.4);}" +
    ".gl-meter.gl-bump .gl-meter-icon{animation:gl-bump .55s ease;}" +
    "@keyframes gl-bump{0%{transform:scale(1);}35%{transform:scale(1.28);box-shadow:0 0 22px var(--c);}100%{transform:scale(1);}}" +
    ".gl-meter-label{font-size:10px;letter-spacing:.04em;text-transform:uppercase;opacity:.75;white-space:nowrap;}" +
    ".gl-pips{display:flex;gap:2px;height:5px;justify-content:center;}" +
    ".gl-pips i{display:block;width:5px;height:5px;border-radius:50%;background:var(--c);}" +
    ".gl-budget{width:100%;height:18px;margin:13px 0 11px;border-radius:9px;background:rgba(0,0,0,.35);border:2px solid rgba(255,224,138,.5);overflow:hidden;}" +
    ".gl-budget-fill{height:100%;width:100%;background:linear-gradient(90deg,#3fae6a,#8ff0b0);transition:width .5s cubic-bezier(.2,.8,.2,1),background .3s;}" +
    ".gl-budget.gl-low .gl-budget-fill{background:linear-gradient(90deg,#d0632f,#ffb648);}" +
    ".gl-budget-label{font-variant-numeric:tabular-nums;opacity:.9;}" +
    ".gl-projline{margin-top:10px;text-align:center;font-size:13px;color:#cfe8d6;min-height:1.3em;}" +
    ".gl-projline b{color:#ffe7a3;}" +
    ".gl-stage{position:relative;flex:1 1 auto;width:100%;max-width:440px;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(10px,3vh,26px);}" +
    ".gl-prompt{max-width:380px;min-height:2.5em;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 8px;" +
    "font-family:'Palatino Linotype',Palatino,Georgia,serif;font-style:italic;font-size:clamp(17px,4.8vw,22px);line-height:1.25;color:#f4ecd8;text-shadow:0 2px 6px rgba(0,0,0,.6);}" +
    ".gl-slot{position:relative;width:min(360px,92vw);}" +
    ".gl-pile{position:absolute;inset:0;pointer-events:none;}" +
    ".gl-back{position:absolute;inset:0;border-radius:18px;border:2px solid #2f7a4d;" +
    "background:repeating-linear-gradient(45deg,#1f5a39 0 10px,#246442 10px 20px);box-shadow:0 6px 16px rgba(0,0,0,.5);}" +
    ".gl-card{position:relative;width:100%;border-radius:18px;background:#f4ecd8;color:#2a2230;border:2px solid #d9c9a3;" +
    "box-shadow:0 14px 34px rgba(0,0,0,.55);padding:12px;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;" +
    "transition:transform .28s cubic-bezier(.2,.8,.2,1);animation:gl-deal .36s cubic-bezier(.2,.8,.2,1);}" +
    ".gl-card.gl-dragging{transition:none;cursor:grabbing;}" +
    "@keyframes gl-deal{0%{transform:translateY(26px) scale(.92);opacity:0;}100%{transform:none;opacity:1;}}" +
    ".gl-speaker{display:flex;align-items:center;justify-content:center;gap:9px;padding:0 2px 9px;border-bottom:2px dashed #d9c9a3;}" +
    ".gl-avatar{flex:0 0 auto;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;background:#2a2230;box-shadow:inset 0 0 0 3px #d9c9a3;}" +
    ".gl-speaker-name{font-weight:800;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b5a3a;}" +
    ".gl-opts{display:flex;gap:8px;margin-top:10px;}" +
    ".gl-opt{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center;gap:5px;padding:10px 6px 9px;border-radius:13px;" +
    "background:#fffaf0;border:2px solid #e3d5b3;cursor:pointer;transition:transform .15s ease,opacity .15s ease,border-color .15s ease,box-shadow .15s ease;outline:none;}" +
    ".gl-opt:focus-visible{box-shadow:0 0 0 3px #3fae6a;}" +
    ".gl-opt.gl-lean{transform:scale(1.04);border-color:var(--c);box-shadow:0 0 0 2px var(--c),0 6px 16px rgba(0,0,0,.18);}" +
    ".gl-opt.gl-dim{opacity:.45;}" +
    ".gl-opt-art{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:27px;background:var(--c);box-shadow:inset 0 -4px 0 rgba(0,0,0,.18);}" +
    ".gl-opt-side{font-size:10px;font-weight:800;letter-spacing:.08em;color:#9a8660;}" +
    ".gl-opt-name{font-weight:800;font-size:14px;line-height:1.15;}" +
    ".gl-opt-text{font-size:11.5px;line-height:1.25;color:#5d5140;font-style:italic;flex:1 1 auto;}" +
    ".gl-tag{display:inline-block;font-size:11px;font-weight:800;line-height:1.2;padding:4px 7px;border-radius:8px;}" +
    ".gl-tag--cat{color:#fff;background:var(--c);text-shadow:0 1px 1px rgba(0,0,0,.35);}" +
    ".gl-tag--cost{color:#5a3f00;background:#ffe7a3;}" +
    ".gl-tag--over{color:#fff;background:#c9402d;}" +
    ".gl-tag--muted{color:#6b5a3a;background:#ece0c4;}" +
    ".gl-tag--sequel{color:#fff;background:#8a5cf0;margin-left:6px;vertical-align:middle;}" +
    ".gl-titles{display:flex;flex-direction:column;gap:8px;margin-top:10px;}" +
    ".gl-title-btn{display:flex;align-items:center;gap:10px;padding:12px;border-radius:12px;border:2px solid #e3d5b3;background:#fffaf0;cursor:pointer;text-align:left;" +
    "font-family:'Cooper Black','Bookman Old Style',Georgia,serif;font-size:17px;color:#2a2230;transition:transform .08s ease,border-color .15s ease;}" +
    ".gl-title-btn:hover{border-color:#3fae6a;}" +
    ".gl-title-btn:active{transform:scale(.98);}" +
    ".gl-title-key{flex:0 0 auto;width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "font-size:12px;font-weight:800;color:#f4ecd8;background:#2a2230;}" +
    ".gl-foot{flex:0 0 auto;width:100%;max-width:440px;display:flex;justify-content:space-between;align-items:center;padding-top:8px;font-size:12px;color:#9fb8a8;}" +
    ".gl-stamp{position:absolute;left:50%;top:50%;z-index:5;padding:10px 20px;border:5px solid #ff6b5a;border-radius:12px;color:#ff6b5a;background:rgba(20,10,10,.55);" +
    "font-family:'Cooper Black','Bookman Old Style',Georgia,serif;font-size:clamp(26px,8vw,40px);letter-spacing:.06em;white-space:nowrap;pointer-events:none;" +
    "transform:translate(-50%,-50%) rotate(-8deg);animation:gl-stamp .42s cubic-bezier(.3,1.6,.5,1);}" +
    ".gl-stamp--ideas{border-color:#ffd23f;color:#ffd23f;}" +
    "@keyframes gl-stamp{0%{transform:translate(-50%,-50%) rotate(-8deg) scale(2.4);opacity:0;}100%{transform:translate(-50%,-50%) rotate(-8deg) scale(1);opacity:1;}}" +
    /* scrolling screens */
    ".gl-scroll{position:absolute;inset:0;overflow-y:auto;padding:16px 12px 34px;display:flex;flex-direction:column;align-items:center;gap:14px;}" +
    ".gl-sheet{width:100%;max-width:460px;border-radius:18px;background:#f4ecd8;color:#2a2230;border:2px solid #d9c9a3;box-shadow:0 14px 34px rgba(0,0,0,.5);padding:18px 16px;animation:gl-deal .36s cubic-bezier(.2,.8,.2,1);}" +
    ".gl-kicker{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b5a3a;font-weight:800;text-align:center;}" +
    ".gl-sum-title{font-family:'Cooper Black','Bookman Old Style',Georgia,serif;font-size:clamp(24px,7vw,32px);text-align:center;margin:4px 0 8px;line-height:1.1;}" +
    ".gl-review{display:flex;align-items:center;justify-content:center;gap:12px;}" +
    ".gl-review-score{width:74px;height:74px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:900;color:#1b1320;" +
    "box-shadow:inset 0 -5px 0 rgba(0,0,0,.2);animation:gl-pop .5s cubic-bezier(.3,1.6,.5,1);}" +
    "@keyframes gl-pop{0%{transform:scale(0);}100%{transform:scale(1);}}" +
    ".gl-verdict{font-weight:800;font-size:17px;}" +
    ".gl-verdict small{display:block;font-weight:600;font-size:12px;color:#6b5a3a;}" +
    ".gl-quotes{margin:14px 0 4px;display:flex;flex-direction:column;gap:6px;}" +
    ".gl-quote{font-size:13px;font-style:italic;padding:8px 10px;border-radius:10px;background:#fffaf0;border-left:4px solid #3fae6a;}" +
    ".gl-quote--bad{border-left-color:#c9402d;}" +
    ".gl-quote cite{display:block;font-style:normal;font-size:11px;color:#6b5a3a;margin-top:2px;font-weight:700;}" +
    ".gl-h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b5a3a;font-weight:800;margin:16px 0 8px;}" +
    ".gl-qrow{display:grid;grid-template-columns:92px 1fr 44px;align-items:center;gap:8px;font-size:13px;font-weight:700;margin-bottom:7px;opacity:0;animation:gl-row-in .35s ease forwards;}" +
    ".gl-qbar{position:relative;height:12px;border-radius:6px;background:#e3d5b3;overflow:visible;}" +
    ".gl-qfill{height:100%;border-radius:6px;background:var(--c);width:0;transition:width .8s cubic-bezier(.2,.8,.2,1);}" +
    ".gl-qmark{position:absolute;left:50%;top:-3px;bottom:-3px;width:2px;background:#2a2230;opacity:.55;}" +
    ".gl-qval{text-align:right;font-variant-numeric:tabular-nums;}" +
    ".gl-legend{font-size:11px;color:#6b5a3a;margin-top:2px;}" +
    ".gl-ledger{margin-top:14px;display:flex;flex-direction:column;gap:6px;}" +
    ".gl-lrow{display:flex;justify-content:space-between;gap:10px;font-size:14px;padding:8px 10px;border-radius:9px;background:#fffaf0;opacity:0;animation:gl-row-in .35s ease forwards;}" +
    ".gl-lrow span:last-child{font-weight:800;font-variant-numeric:tabular-nums;}" +
    ".gl-lrow small{display:block;font-size:11px;color:#8a765a;}" +
    ".gl-lrow--profit{font-size:17px;font-weight:900;border:2px solid #d9c9a3;}" +
    ".gl-pos{color:#1f8a4a;}.gl-neg{color:#c9402d;}" +
    "@keyframes gl-row-in{0%{opacity:0;transform:translateX(-8px);}100%{opacity:1;transform:none;}}" +
    ".gl-big-btn{display:block;width:100%;margin-top:16px;padding:14px 16px;border-radius:14px;border:2px solid #c9ffd9;cursor:pointer;" +
    "font-family:'Cooper Black','Bookman Old Style',Georgia,serif;font-size:clamp(17px,4.8vw,21px);color:#0d3a1f;" +
    "background:linear-gradient(180deg,#b9ffcf 0%,#4fc47a 100%);box-shadow:0 5px 0 #1f6b3c,0 0 20px rgba(111,227,154,.35);transition:transform .06s ease,box-shadow .06s ease;}" +
    ".gl-big-btn:active{transform:translateY(3px);box-shadow:0 2px 0 #1f6b3c;}" +
    ".gl-hero{width:100%;max-width:460px;text-align:center;}" +
    ".gl-hero-year{font-family:'Cooper Black','Bookman Old Style',Georgia,serif;font-size:clamp(44px,14vw,64px);line-height:1;color:#ffe7a3;text-shadow:0 3px 0 rgba(74,38,0,.6);}" +
    ".gl-hero-sub{margin-top:6px;font-size:13px;color:#cfe8d6;}" +
    ".gl-hero-sub b{color:#ffe7a3;}" +
    ".gl-news{width:100%;max-width:460px;padding:10px 12px;border-radius:12px;background:rgba(255,210,63,.1);border:2px solid rgba(255,210,63,.45);font-size:13px;color:#ffe7a3;}" +
    ".gl-panel{width:100%;max-width:460px;border:2px solid rgba(111,227,154,.25);border-radius:14px;background:rgba(5,8,14,.45);padding:12px;}" +
    ".gl-panel h2{font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:#8ff0b0;}" +
    ".gl-panel-sub{font-size:12px;color:#9fb8a8;margin:3px 0 10px;}" +
    ".gl-list{display:flex;flex-direction:column;gap:7px;}" +
    ".gl-row{display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:11px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-left:4px solid var(--c);}" +
    ".gl-row.gl-shelved{opacity:.45;}" +
    ".gl-row-icon{flex:0 0 auto;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;background:rgba(0,0,0,.3);}" +
    ".gl-row-body{flex:1 1 auto;min-width:0;}" +
    ".gl-row-name{font-size:13px;font-weight:800;}" +
    ".gl-row-name em{font-style:normal;font-weight:600;font-size:11px;color:#9fb8a8;margin-left:4px;}" +
    ".gl-row-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;}" +
    ".gl-row .gl-tag{font-size:10.5px;padding:3px 6px;}" +
    ".gl-new{display:inline-block;font-size:9px;font-weight:900;letter-spacing:.08em;color:#1b1320;background:#ffd23f;border-radius:5px;padding:1px 5px;margin-left:5px;vertical-align:middle;}" +
    ".gl-row-btn{flex:0 0 auto;padding:7px 10px;border-radius:9px;border:none;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap;color:#0d3a1f;" +
    "background:linear-gradient(180deg,#b9ffcf,#4fc47a);box-shadow:0 3px 0 #1f6b3c;}" +
    ".gl-row-btn:active:not(:disabled){transform:translateY(2px);box-shadow:0 1px 0 #1f6b3c;}" +
    ".gl-row-btn:disabled{cursor:default;filter:grayscale(.8);opacity:.5;}" +
    ".gl-row-btn--ghost{background:rgba(255,255,255,.1);color:#f4ecd8;box-shadow:0 3px 0 rgba(0,0,0,.4);}" +
    ".gl-empty{font-size:12px;color:#9fb8a8;font-style:italic;padding:4px 2px;}" +
    ".gl-hist{display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.04);}" +
    ".gl-hist b{font-weight:800;}" +
    ".gl-best{width:100%;max-width:460px;text-align:center;font-size:12px;color:#ffe7a3;opacity:.9;}" +
    "@media(max-height:640px){.gl-meter-icon{width:36px;height:36px;font-size:17px;}.gl-opt-art{width:40px;height:40px;font-size:21px;}.gl-opt-text{display:none;}.gl-prompt{font-size:16px;}}";

  class Greenlit {
    constructor(root) {
      this.root = root;
      this.career = new Career();
      this.timers = [];
      this.mode = "idle";
      this.locked = false;
      this.best = loadBest();
      this.el = {
        year: root.querySelector("#gl-year"),
        cash: root.querySelector("#gl-cash"),
        view: root.querySelector("#gl-view"),
      };
      root.querySelector('[data-act="menu"]').addEventListener("click", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
      this.onKey = (e) => this.handleKey(e);
      window.addEventListener("keydown", this.onKey);
      this.updateTopbar(false);
      this.showPitch();
    }

    later(fn, ms) {
      const id = setTimeout(() => {
        this.timers = this.timers.filter((t) => t !== id);
        fn();
      }, ms);
      this.timers.push(id);
    }

    updateTopbar(pulse) {
      const c = this.career;
      this.el.year.textContent = "📅 " + c.year;
      this.el.cash.textContent = "💰 " + fmtMoney(c.cash);
      this.el.cash.classList.toggle("gl-chip--neg", c.cash < 0);
      if (pulse) {
        this.el.cash.classList.remove("gl-pulse");
        void this.el.cash.offsetWidth;
        this.el.cash.classList.add("gl-pulse");
      }
    }

    /* ----- play screen ----- */

    buildPlay() {
      const meters = CATS.map(
        (c) =>
          '<div class="gl-meter" data-cat="' + c.id + '" style="--c:' + c.color + '">' +
          '<span class="gl-dot"></span>' +
          '<div class="gl-meter-icon">' + c.icon + "</div>" +
          '<div class="gl-meter-label">' + c.label + "</div>" +
          '<div class="gl-pips"></div>' +
          "</div>"
      ).join("");
      this.el.view.innerHTML =
        '<div class="gl-play">' +
        '<div class="gl-hud">' +
        '<div class="gl-meters">' + meters +
        '<div class="gl-meter gl-meter--budget" data-cat="budget">' +
        '<span class="gl-dot"></span>' +
        '<div class="gl-budget"><div class="gl-budget-fill"></div></div>' +
        '<div class="gl-meter-label gl-budget-label"></div>' +
        '<div class="gl-pips"></div>' +
        "</div>" +
        "</div>" +
        '<div class="gl-projline"></div>' +
        "</div>" +
        '<div class="gl-stage"><div class="gl-prompt"></div><div class="gl-slot"><div class="gl-pile"></div></div></div>' +
        '<div class="gl-foot"><span class="gl-hint">← swipe or tap a side →</span><span class="gl-pilecount"></span></div>' +
        "</div>";
      const v = this.el.view;
      this.el.meters = {};
      v.querySelectorAll(".gl-meter").forEach((m) => {
        this.el.meters[m.dataset.cat] = m;
      });
      this.el.budget = v.querySelector(".gl-budget");
      this.el.budgetFill = v.querySelector(".gl-budget-fill");
      this.el.budgetLabel = v.querySelector(".gl-budget-label");
      this.el.projline = v.querySelector(".gl-projline");
      this.el.stage = v.querySelector(".gl-stage");
      this.el.prompt = v.querySelector(".gl-prompt");
      this.el.pile = v.querySelector(".gl-pile");
      this.el.slot = v.querySelector(".gl-slot");
      this.el.pileCount = v.querySelector(".gl-pilecount");
      this.el.hint = v.querySelector(".gl-hint");
    }

    setBudget(remaining, budget) {
      const frac = clamp(remaining / budget, 0, 1);
      this.el.budgetFill.style.width = frac * 100 + "%";
      this.el.budget.classList.toggle("gl-low", frac < 0.25);
      this.el.budgetLabel.textContent = remaining >= 0 ? fmtMoney(remaining) + " left" : fmtMoney(-remaining) + " over";
    }

    setPile(n) {
      const backs = Math.min(3, Math.max(0, n));
      let html = "";
      for (let i = backs; i >= 1; i--) {
        html += '<div class="gl-back" style="transform:translateY(' + i * 6 + "px) rotate(" + (i % 2 ? -1.4 : 1.2) * i + 'deg)"></div>';
      }
      this.el.pile.innerHTML = html;
      this.el.pileCount.textContent = n + (n === 1 ? " idea" : " ideas") + " in the pile";
    }

    renderPips() {
      const p = this.career.project;
      CATS.forEach((c) => {
        const n = p ? p.picks.filter((id) => CARD_MAP[id].cat === c.id).length : 0;
        this.el.meters[c.id].querySelector(".gl-pips").innerHTML = new Array(n + 1).join("<i></i>");
      });
    }

    clearPreview() {
      Object.keys(this.el.meters).forEach((k) => {
        const m = this.el.meters[k];
        m.querySelector(".gl-dot").removeAttribute("data-size");
        m.classList.remove("gl-hint");
      });
    }

    // Reigns' tell: a dot over each meter the leaned-toward choice will move,
    // sized by how much. Never the value itself.
    preview(opt) {
      this.clearPreview();
      if (!opt) return;
      if (opt.card) {
        const year = this.career.year;
        this.el.meters[opt.card.cat].querySelector(".gl-dot").setAttribute("data-size", String(magnitudeIndex(opt.card, year) + 1));
        this.el.meters.budget.querySelector(".gl-dot").setAttribute("data-size", String(costIndex(opt.card, year, this.career.project.budget) + 1));
      } else if (opt.genre) {
        this.el.meters[opt.genre.loves.id].classList.add("gl-hint");
      }
    }

    showPitch() {
      this.mode = "pitch";
      this.locked = false;
      this.buildPlay();
      const c = this.career;
      const budget = c.nextBudget();
      this.setBudget(budget, budget);
      this.setPile(c.activeDeck().length);
      this.renderPips();
      this.el.projline.innerHTML = "New project · <b>" + fmtMoney(budget) + "</b> budget from the publisher";
      const genres = c.offerGenres();
      const line = c.releases.length === 0 ? "It's " + c.year + ". I'll bankroll one game. What are we making?" : pick(PITCH_LINES).replace("{year}", c.year);
      const opts = genres.map((g) => ({
        genre: g,
        art: g.icon,
        color: g.loves.color,
        name: g.name,
        text: g.blurb,
        tags: [
          { cls: "cat", color: g.loves.color, text: "Fans love " + g.loves.label },
          { cls: "muted", text: "Fans shrug at " + g.shrugs.label },
        ],
      }));
      this.dealCard(SPEAKERS.publisher, line, opts);
    }

    showDecision() {
      this.mode = "decide";
      this.locked = false;
      const c = this.career;
      const p = c.project;
      const cards = p.pair.map((id) => CARD_MAP[id]);
      const remaining = c.remaining();
      const opts = cards.map((card) => {
        const cat = CAT_MAP[card.cat];
        const tags = [
          { cls: "cat", color: cat.color, text: effectText(card, c.year) },
          { cls: "cost", text: costText(card, c.year, p.budget) },
        ];
        if (cardCost(card, c.year) > remaining) tags.push({ cls: "over", text: "⚠ Over budget" });
        return { card, art: card.icon, color: cat.color, name: card.name, text: card.text, tags };
      });
      let speakerKey = cards[0].cat === cards[1].cat ? cards[0].cat : pick(MIXED_SPEAKERS);
      const sp = SPEAKERS[speakerKey];
      this.dealCard(sp, pick(sp.lines), opts);
      this.setPile(p.pile.length);
      this.el.projline.innerHTML =
        p.genre.icon + " <b>" + p.genre.name + "</b> · fans love " + p.genre.loves.label + " · decision " + (p.picks.length + 1);
    }

    dealCard(speaker, line, opts) {
      const card = document.createElement("div");
      card.className = "gl-card";
      card.innerHTML =
        '<div class="gl-speaker"><div class="gl-avatar">' + speaker.icon + '</div><div class="gl-speaker-name">' + esc(speaker.name) + "</div></div>" +
        '<div class="gl-opts">' +
        opts
          .map(
            (o, i) =>
              '<div class="gl-opt" role="button" tabindex="0" data-side="' + i + '" style="--c:' + o.color + '">' +
              '<div class="gl-opt-side">' + (i === 0 ? "← LEFT" : "RIGHT →") + "</div>" +
              '<div class="gl-opt-art">' + o.art + "</div>" +
              '<div class="gl-opt-name">' + esc(o.name) + "</div>" +
              '<div class="gl-opt-text">' + esc(o.text) + "</div>" +
              o.tags.map((t) => '<span class="gl-tag gl-tag--' + t.cls + '"' + (t.color ? ' style="--c:' + t.color + '"' : "") + ">" + esc(t.text) + "</span>").join("") +
              "</div>"
          )
          .join("") +
        "</div>";
      this.placeCard(card, line);
      this.card = card;
      this.opts = opts;
      this.clearPreview();
      this.bindSwipe(card);
      card.querySelectorAll(".gl-opt").forEach((el) => {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.commit(+el.dataset.side);
          }
        });
      });
    }

    // Swap the card in the slot (the pile of backs stays) and put the
    // speaker's line above it, Reigns-style.
    placeCard(card, line) {
      this.el.slot.querySelectorAll(".gl-card").forEach((old) => old.remove());
      this.el.slot.appendChild(card);
      this.el.prompt.textContent = "“" + line + "”";
    }

    lean(side) {
      if (!this.card) return;
      this.card.querySelectorAll(".gl-opt").forEach((el) => {
        const s = +el.dataset.side;
        el.classList.toggle("gl-lean", side === s);
        el.classList.toggle("gl-dim", side !== null && side !== s);
      });
      this.preview(side === null ? null : this.opts[side]);
    }

    bindSwipe(card) {
      let start = null;
      let dx = 0;
      let dragging = false;
      const threshold = () => Math.min(110, card.offsetWidth * 0.28);
      card.addEventListener("pointerdown", (e) => {
        if (this.locked || (e.pointerType === "mouse" && e.button !== 0)) return;
        start = { x: e.clientX, id: e.pointerId, opt: e.target.closest("[data-side]") };
        dx = 0;
        dragging = false;
        try {
          card.setPointerCapture(e.pointerId);
        } catch (err) {
          /* capture is a nicety */
        }
      });
      card.addEventListener("pointermove", (e) => {
        if (!start) {
          if (e.pointerType === "mouse" && !this.locked) {
            const o = e.target.closest("[data-side]");
            this.lean(o ? +o.dataset.side : null);
          }
          return;
        }
        if (e.pointerId !== start.id) return;
        dx = e.clientX - start.x;
        if (!dragging && Math.abs(dx) > 8) {
          dragging = true;
          card.classList.add("gl-dragging");
        }
        if (dragging) {
          card.style.transform = "translateX(" + dx + "px) rotate(" + dx * 0.05 + "deg)";
          this.lean(Math.abs(dx) > 16 ? (dx < 0 ? 0 : 1) : null);
        }
      });
      const end = (e) => {
        if (!start || e.pointerId !== start.id) return;
        const s = start;
        start = null;
        card.classList.remove("gl-dragging");
        if (this.locked) return;
        if (dragging) {
          if (Math.abs(dx) >= threshold()) {
            this.commit(dx < 0 ? 0 : 1);
          } else {
            card.style.transform = "";
            this.lean(null);
          }
        } else if (e.type === "pointerup" && s.opt) {
          this.commit(+s.opt.dataset.side);
        }
      };
      card.addEventListener("pointerup", end);
      card.addEventListener("pointercancel", end);
      card.addEventListener("pointerleave", (e) => {
        if (!start && e.pointerType === "mouse" && !this.locked) this.lean(null);
      });
    }

    flyOff(side) {
      const card = this.card;
      if (!card) return;
      card.classList.remove("gl-dragging");
      card.style.transition = "transform " + FLY_MS + "ms ease-in, opacity " + FLY_MS + "ms ease-in";
      card.style.transform = "translateX(" + (side === 0 ? -130 : 130) + "vw) rotate(" + (side === 0 ? -26 : 26) + "deg)";
      card.style.opacity = "0";
      this.card = null;
    }

    commit(side) {
      if (this.locked || !this.card) return;
      if (this.mode !== "pitch" && this.mode !== "decide") return;
      this.locked = true;
      this.lean(side);
      const mode = this.mode;
      this.flyOff(side);
      this.clearPreview();
      const c = this.career;
      if (mode === "pitch") {
        c.startProject(this.opts[side].genre.id);
        this.later(() => this.showDecisionOrShip(), FLY_MS);
        return;
      }
      const res = c.pick(side);
      const m = this.el.meters[res.card.cat];
      m.classList.remove("gl-bump");
      void m.offsetWidth;
      m.classList.add("gl-bump");
      this.setBudget(c.remaining(), c.project.budget);
      this.renderPips();
      this.later(() => this.showDecisionOrShip(), FLY_MS);
    }

    showDecisionOrShip() {
      const p = this.career.project;
      if (!p.over) {
        this.showDecision();
        return;
      }
      // A deck too thin to ever deal a pair ends before the first decision.
      this.mode = "stamp";
      this.setPile(p.pile.length);
      const stamp = document.createElement("div");
      stamp.className = "gl-stamp" + (p.over === "ideas" ? " gl-stamp--ideas" : "");
      stamp.textContent = p.over === "ideas" ? "OUT OF IDEAS" : "BUDGET SPENT";
      this.el.stage.appendChild(stamp);
      this.el.projline.innerHTML = p.over === "ideas" ? "No more ideas in the pile — time to ship." : "The money's gone — time to ship.";
      this.later(() => this.showTitlePick(), STAMP_MS);
    }

    showTitlePick() {
      this.mode = "title";
      this.locked = false;
      const stamp = this.el.stage.querySelector(".gl-stamp");
      if (stamp) stamp.remove();
      this.titles = this.career.titleOptions();
      const sp = SPEAKERS.marketing;
      const card = document.createElement("div");
      card.className = "gl-card";
      card.style.cursor = "default";
      card.innerHTML =
        '<div class="gl-speaker"><div class="gl-avatar">' + sp.icon + '</div><div class="gl-speaker-name">' + sp.name + "</div></div>" +
        '<div class="gl-titles">' +
        this.titles
          .map(
            (t, i) =>
              '<button class="gl-title-btn" type="button" data-idx="' + i + '"><span class="gl-title-key">' + (i + 1) + "</span><span>" + esc(t.title) +
              (t.sequel ? '<span class="gl-tag gl-tag--sequel">SEQUEL</span>' : "") + "</span></button>"
          )
          .join("") +
        "</div>";
      this.placeCard(card, sp.lines[0]);
      this.card = null;
      this.setPile(0);
      this.el.pileCount.textContent = "";
      this.el.hint.textContent = "pick a title · keys 1–4";
      card.querySelectorAll(".gl-title-btn").forEach((b) => {
        b.addEventListener("click", () => this.chooseTitle(+b.dataset.idx));
      });
    }

    chooseTitle(i) {
      if (this.mode !== "title" || !this.titles[i]) return;
      this.mode = "summary";
      const result = this.career.release(this.titles[i].title);
      if (result.profit > 0 && (!this.best || result.profit > this.best.profit)) {
        this.best = { title: result.title, profit: result.profit, review: result.review, year: result.year };
        saveBest(this.best);
        result.newBest = true;
      }
      this.updateTopbar(true);
      this.showSummary(result);
    }

    /* ----- summary ----- */

    showSummary(r) {
      this.mode = "summary";
      const maxRatio = 2;
      const qrows = CATS.map((c, i) => {
        const frac = clamp(r.q[c.id] / (r.expected[c.id] * maxRatio), 0, 1);
        return (
          '<div class="gl-qrow" style="--c:' + c.color + ";animation-delay:" + (0.15 + i * 0.1) + 's">' +
          "<span>" + c.icon + " " + c.label + "</span>" +
          '<div class="gl-qbar"><div class="gl-qfill" data-w="' + frac * 100 + '"></div><div class="gl-qmark"></div></div>' +
          '<span class="gl-qval">' + Math.round(r.q[c.id]) + "</span>" +
          "</div>"
        );
      }).join("");
      const overBy = r.spent - r.budget;
      const costNote = overBy > 0 ? "Over budget by " + fmtMoney(overBy) : overBy < 0 ? "Under budget by " + fmtMoney(-overBy) : "Right on budget";
      const profitNote = r.absorbed > 0 ? "The publisher ate " + fmtMoney(r.absorbed) + " of the loss" : r.newBest ? "🏆 Your biggest hit yet!" : "";
      const rows = [
        { label: "Revenue", sub: "Sales at " + r.review + "/100 in the " + r.year + " market", val: fmtSigned(r.revenue), cls: "gl-pos" },
        { label: "Development cost", sub: costNote, val: fmtSigned(-r.spent), cls: "gl-neg" },
      ];
      let delay = 0.6;
      const ledger =
        rows
          .map((row) => {
            delay += 0.12;
            return '<div class="gl-lrow" style="animation-delay:' + delay + 's"><span>' + row.label + "<small>" + esc(row.sub) + '</small></span><span class="' + row.cls + '">' + row.val + "</span></div>";
          })
          .join("") +
        '<div class="gl-lrow gl-lrow--profit" style="animation-delay:' + (delay + 0.15) + 's"><span>Profit' + (profitNote ? "<small>" + profitNote + "</small>" : "") +
        '</span><span class="' + (r.profit >= 0 ? "gl-pos" : "gl-neg") + '">' + fmtSigned(r.profit) + "</span></div>";
      this.el.view.innerHTML =
        '<div class="gl-scroll"><div class="gl-sheet">' +
        '<div class="gl-kicker">' + r.year + " · " + r.genre.icon + " " + esc(r.genre.name) + "</div>" +
        '<div class="gl-sum-title">' + esc(r.title) + "</div>" +
        '<div class="gl-review"><div class="gl-review-score" style="background:' + reviewColor(r.review) + '">' + r.review + "</div>" +
        '<div class="gl-verdict">' + verdictFor(r.review) + "<small>" + r.picks.length + " decisions · reviews are in</small></div></div>" +
        '<div class="gl-quotes">' +
        r.quotes.map((q) => '<div class="gl-quote' + (q.bad ? " gl-quote--bad" : "") + '">“' + esc(q.text) + "”<cite>— " + esc(q.outlet) + "</cite></div>").join("") +
        "</div>" +
        '<div class="gl-h3">Final quality</div>' + qrows +
        '<div class="gl-legend">The line marks what ' + esc(r.genre.name) + " fans expected in " + r.year + ".</div>" +
        '<div class="gl-ledger">' + ledger + "</div>" +
        '<button class="gl-big-btn" type="button" data-act="studio">Back to the studio →</button>' +
        "</div></div>";
      this.el.view.querySelector('[data-act="studio"]').addEventListener("click", () => this.showStudio());
      // Let the bars grow in after they've faded in.
      this.later(() => {
        this.el.view.querySelectorAll(".gl-qfill").forEach((f) => {
          f.style.width = f.dataset.w + "%";
        });
      }, 250);
    }

    /* ----- studio (between projects) ----- */

    showStudio() {
      this.mode = "studio";
      const c = this.career;
      let news = c.newTech.length
        ? '<div class="gl-news">📰 <b>' + c.year + ":</b> new tech hits the market — " + c.newTech.map((id) => esc(CARD_MAP[id].name)).join(", ") + ".</div>"
        : "";
      if (c.gift) news += '<div class="gl-news">📦 Money\'s tight, so the publisher lent you <b>' + esc(CARD_MAP[c.gift].name) + "</b>. It's in your deck.</div>";
      const hist = c.releases
        .slice(-5)
        .reverse()
        .map(
          (r) =>
            '<div class="gl-hist"><span>' + r.year + " · " + r.genre.icon + " <b>" + esc(r.title) + "</b></span>" +
            '<span><span style="color:' + reviewColor(r.review) + '">' + r.review + '</span> · <span class="' + (r.profit >= 0 ? "gl-pos" : "gl-neg") + '" style="filter:brightness(1.6)">' +
            fmtSigned(r.profit) + "</span></span></div>"
        )
        .join("");
      const best = this.best
        ? '<div class="gl-best">🏆 Biggest hit ever: “' + esc(this.best.title) + "” (" + this.best.year + ") — " + fmtSigned(this.best.profit) + "</div>"
        : "";
      this.el.view.innerHTML =
        '<div class="gl-scroll">' +
        '<div class="gl-hero"><div class="gl-hero-year">' + c.year + "</div>" +
        '<div class="gl-hero-sub">' + c.releases.length + (c.releases.length === 1 ? " game" : " games") + " shipped · next budget <b>" + fmtMoney(c.nextBudget()) + "</b></div>" +
        '<button class="gl-big-btn" type="button" data-act="start">🎬 Greenlight the next project</button></div>' +
        news +
        '<section class="gl-panel"><h2>Tech shop</h2><div class="gl-panel-sub">New decisions for your deck. Bought cards are yours for good, but every idea loses its shine as the industry moves on.</div><div class="gl-list" data-list="shop"></div></section>' +
        '<section class="gl-panel"><h2 data-deck-head></h2><div class="gl-panel-sub">Shelve outdated ideas so they stop being dealt (at least ' + MIN_ACTIVE_DECK + " stay in).</div>" +
        '<div class="gl-list" data-list="deck"></div></section>' +
        '<section class="gl-panel"><h2>Releases</h2><div class="gl-list">' + (hist || '<div class="gl-empty">Nothing shipped yet.</div>') + "</div></section>" +
        best +
        "</div>";
      this.el.view.querySelector('[data-act="start"]').addEventListener("click", () => this.showPitch());
      this.renderStudioLists();
    }

    cardRow(card, extraName, tagsBudget) {
      const cat = CAT_MAP[card.cat];
      return (
        '<div class="gl-row" style="--c:' + cat.color + '" data-id="' + card.id + '">' +
        '<div class="gl-row-icon">' + card.icon + "</div>" +
        '<div class="gl-row-body"><div class="gl-row-name">' + esc(card.name) + extraName + "</div>" +
        '<div class="gl-row-tags"><span class="gl-tag gl-tag--cat" style="--c:' + cat.color + '">' + effectText(card, this.career.year) + "</span>" +
        '<span class="gl-tag gl-tag--cost">' + costText(card, this.career.year, tagsBudget) + "</span></div></div>"
      );
    }

    renderStudioLists() {
      const c = this.career;
      const budget = c.nextBudget();
      const shopEl = this.el.view.querySelector('[data-list="shop"]');
      const deckEl = this.el.view.querySelector('[data-list="deck"]');
      const shop = c.shopCards();
      shopEl.innerHTML = shop.length
        ? shop
            .map((card) => {
              const isNew = c.newTech.indexOf(card.id) >= 0;
              const price = cardPrice(card, c.year);
              const afford = c.cash >= price;
              return (
                this.cardRow(card, isNew ? '<span class="gl-new">NEW</span>' : "<em>" + card.year + "</em>", budget) +
                '<button class="gl-row-btn" type="button" data-buy="' + card.id + '"' + (afford ? "" : " disabled") + ">Buy " + fmtMoney(price) + "</button></div>"
              );
            })
            .join("")
        : '<div class="gl-empty">You own every idea on the market. New tech arrives as the years go by.</div>';
      const deck = c.owned.map((id) => CARD_MAP[id]).sort((a, b) => b.year - a.year || a.cat.localeCompare(b.cat));
      deckEl.innerHTML = deck
        .map((card) => {
          const shelved = c.shelved.has(card.id);
          const can = shelved || c.canShelve(card.id);
          return (
            this.cardRow(card, "<em>" + card.year + "</em>", budget).replace('class="gl-row"', 'class="gl-row' + (shelved ? " gl-shelved" : "") + '"') +
            '<button class="gl-row-btn gl-row-btn--ghost" type="button" data-shelf="' + card.id + '"' + (can ? "" : " disabled") + ">" + (shelved ? "Unshelve" : "Shelve") + "</button></div>"
          );
        })
        .join("");
      this.el.view.querySelector("[data-deck-head]").textContent = "Your deck · " + c.activeDeck().length + " active / " + c.owned.length;
      shopEl.querySelectorAll("[data-buy]").forEach((b) => {
        b.addEventListener("click", () => {
          if (c.buy(b.dataset.buy)) {
            this.updateTopbar(true);
            this.renderStudioLists();
          }
        });
      });
      deckEl.querySelectorAll("[data-shelf]").forEach((b) => {
        b.addEventListener("click", () => {
          if (c.toggleShelve(b.dataset.shelf)) this.renderStudioLists();
        });
      });
    }

    handleKey(e) {
      if (this.locked) return;
      if (this.mode === "pitch" || this.mode === "decide") {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
          e.preventDefault();
          this.commit(0);
        } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
          e.preventDefault();
          this.commit(1);
        }
      } else if (this.mode === "title") {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 4) this.chooseTitle(n - 1);
      } else if (this.mode === "summary" && e.key === "Enter") {
        e.preventDefault();
        this.showStudio();
      }
    }

    destroy() {
      this.timers.forEach((t) => clearTimeout(t));
      this.timers = [];
      window.removeEventListener("keydown", this.onKey);
    }
  }

  /* ---------- boot ---------- */

  function injectStyle() {
    if (document.getElementById("gl-style")) return;
    const s = document.createElement("style");
    s.id = "gl-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function launchGreenlit() {
    if (window.greenlitGame) return window.greenlitGame;

    injectStyle();
    const root = document.createElement("div");
    root.id = "gl-root";
    root.innerHTML = HTML;
    document.getElementById("game-container").appendChild(root);

    const game = new Greenlit(root);
    const handle = {
      root: root,
      game: game,
      career: game.career,
      destroy: function () {
        game.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
    window.greenlitGame = handle;
    return handle;
  }

  if (typeof window !== "undefined") window.launchGreenlit = launchGreenlit;
  // Lets a Node script drive the model directly for balance sweeps.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Career, CARDS, CARD_MAP, GENRES, CATS, scoreProject, expectation, marketSize, magnitudeIndex, costIndex, cardCost, cardPrice, salesMult };
  }
})();
