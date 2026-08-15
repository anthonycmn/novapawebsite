/* Sweeney Todd: School Edition — scene-by-scene production breakdown.
 *
 * WHERE THIS COMES FROM
 * ---------------------
 * Every item carries a `src`:
 *
 *   src:'script'   Named in the Production Element Breakdown of the 8-week
 *                  rehearsal workbook ("Sweeney Todd (School Edition) -
 *                  8-Week Rehearsal Schedule", Drive). Treat as confirmed —
 *                  the show does not work without it.
 *
 *   src:'proposed' Follows from the scene's location, action or period, or
 *                  from the purchase-planning pass. CONFIRM AGAINST THE
 *                  SCRIPT before anybody spends money; tick "Confirmed" in
 *                  the dashboard and the badge clears.
 *
 * THE HARD RULES, printed here because this file feeds the buy list:
 *   - No sharpened blade ever enters the building. Razors blunted or
 *     retractable, locked storage, signed in and out by one named tracker.
 *   - Chair and chute are stage combat: crash mat, named spotter, every run.
 *   - No flame anywhere. The oven glows with LEDs.
 */
window.SWEENEYSCENES = {
  cast: ['Sweeney Todd', 'Mrs. Lovett', 'Anthony', 'Johanna', 'Toby',
         'Judge Turpin', 'Beadle', 'Beggar Woman', 'Pirelli', 'Fogg',
         'Young Lucy', 'Ensemble'],

  // Elements that live across the whole show rather than one scene.
  // Sourced once, used everywhere — kept separate so they are not costed
  // nine times over.
  standing: [
    { id: 'ST-x1', cat: 'prop', who: 'Sweeney Todd',
      name: 'Todd\'s razor case with silver razors — HERO PROP',
      note: 'Blunted or fully retractable only; no sharpened blade ever enters the building. Locked storage, counted in and out of every call by one named tracker from 9/19.', qty: 1, src: 'script' },
    { id: 'ST-x2', cat: 'prop', who: 'Crew',
      name: 'Rehearsal razor set + lockbox',
      note: 'The working set for slow-tempo violence staging from 9/20. Spares included.', qty: 4, src: 'script' },
    { id: 'ST-x3', cat: 'set', who: 'Company',
      name: 'Two-level unit: tonsorial parlor above, pie shop and bakehouse below',
      note: 'THE build — the whole show hangs on this vertical. Load-rated stair, handrail, glow tape. Taped floor plan 8/29; built by 9/26.', qty: 1, src: 'script' },
    { id: 'ST-x4', cat: 'set', who: 'Company',
      name: 'Fleet Street facade with practical doors + signage + barber pole',
      note: 'Grimy London brick that reads at night. Mrs. Lovett\'s Meat Pies · Sweeney Todd Tonsorial Parlor.', qty: 1, src: 'script' },
    { id: 'ST-x5', cat: 'set', who: 'Company',
      name: 'Street lamps / gas standards (practical)',
      note: 'Dimmable, warm, flickerable — practical circuits coordinated with lighting.', qty: 4, src: 'script' },
    { id: 'ST-x6', cat: 'prop', who: 'Crew',
      name: 'Blood rig — tube-and-bulb or blood-loaded razor, plus stage blood stock',
      note: 'Pick ONE method and rehearse it slowly from 9/20. Test on costume fabric before it goes near a performer.', qty: 2, src: 'script' },
    { id: 'ST-x7', cat: 'prop', who: 'Crew',
      name: 'Towels — white practical stock plus blood-stained set',
      note: 'Budget a full laundry cycle per performance.', qty: 24, src: 'script' },
    { id: 'ST-x8', cat: 'prop', who: 'Crew',
      name: 'Body doubles / weighted shrouded dummies',
      note: 'Weight-matched for the chute; stored offstage on the trap side.', qty: 2, src: 'script' },
    { id: 'ST-x9', cat: 'prop', who: 'Stage management',
      name: 'Weapons & blood tracking sheet + first aid, eye wash, spare towels at the trap',
      note: 'Sign in/out at every call from 9/19. Blood plus eyes is this show\'s most likely incident.', qty: 1, src: 'script' },
    { id: 'ST-c1', cat: 'costume', who: 'Sweeney Todd',
      name: 'Todd — sailor\'s coat look, barber\'s waistcoat + razor holster, blooded bakehouse duplicate',
      note: 'Holster must hold a razor silently and release fast. Duplicates for the blood.', qty: 3, src: 'script' },
    { id: 'ST-c2', cat: 'costume', who: 'Mrs. Lovett',
      name: 'Lovett — floured work dress, improved Act II dress, striped bathing costume',
      note: 'Bathing look layers over/under the Act II dress — the fastest change in the show.', qty: 3, src: 'script' },
    { id: 'ST-c3', cat: 'costume', who: 'Johanna',
      name: 'Johanna — day dress, sailor-boy disguise, asylum shift',
      note: 'Hair must go under the cap — build the wig plan around the II.4 quick change.', qty: 3, src: 'script' },
    { id: 'ST-c4', cat: 'costume', who: 'Toby',
      name: 'Toby — rags, Pirelli\'s livery, pie-shop apron + blood duplicate',
      note: '', qty: 3, src: 'script' },
    { id: 'ST-c5', cat: 'costume', who: 'Judge Turpin',
      name: 'Judge — judicial robe, wig, tricorn; dressing gown for the shave',
      note: 'Neck exposed and reachable for the razor pass.', qty: 2, src: 'script' },
    { id: 'ST-c6', cat: 'costume', who: 'Beggar Woman',
      name: 'Beggar Woman — layered rags, tattered shawl, broken boots',
      note: 'Must survive being handled and thrown about nightly. The shawl must match Young Lucy\'s — it carries the reveal.', qty: 1, src: 'script' },
    { id: 'ST-c7', cat: 'costume', who: 'Ensemble',
      name: 'Ensemble — London street garb, asylum shifts, customer coats, gravedigger aprons',
      note: 'Four tracks, layered and grimy; must move for choreography.', qty: 14, src: 'script' },
    { id: 'ST-c8', cat: 'costume', who: 'Company',
      name: 'Wigs: Todd\'s white streak, judicial, Beadle, Pirelli, Young Lucy blonde + consumables',
      note: 'Two shows\' worth of caps, pins, spirit gum, sponges. Blood makeup tested on costume fabric first.', qty: 5, src: 'script' }
  ],

  scenes: [
    { id: 'I.P', act: 'I', sc: 'Prologue', pp: '', when: 'Thu 8/20',
      loc: 'A graveyard, London',
      songs: '"The Ballad of Sweeney Todd"',
      tech: 'Hard, cold, front-lit Ballad specials — a different world from the scenes. The factory whistle is the show\'s signature cue: get it in the room by 9/26 so the cast can act to it.',
      cast: ['Ensemble', 'Sweeney Todd', 'Mrs. Lovett', 'Anthony', 'Johanna', 'Toby', 'Judge Turpin', 'Beadle', 'Beggar Woman', 'Pirelli', 'Fogg'],
      items: [
        { id: 'I.P-s1', cat: 'set', name: 'Graveyard elements: gravestones, mounded earth, shrouded shapes', note: 'Lightweight for fast shifts; reused at every Ballad reprise.', src: 'script' },
        { id: 'I.P-p1', cat: 'prop', name: 'Shovels and spades', note: 'Blunt edges, taped handles.', src: 'script' },
        { id: 'I.P-p2', cat: 'prop', name: 'Hand lanterns (battery practicals)', note: 'Battery only — no flame. Reused II.7.', src: 'script' },
        { id: 'I.P-p3', cat: 'prop', name: 'Shrouded bundle / body form', note: 'Doubles as a victim dummy later.', src: 'script' }
      ] },

    { id: 'I.1', act: 'I', sc: '1', pp: '', when: 'Thu 8/20',
      loc: 'London harbour, then Fleet Street',
      songs: '"No Place Like London"; "The Barber and His Wife"',
      tech: 'Ship\'s bell; harbour ambience into street.',
      cast: ['Sweeney Todd', 'Anthony', 'Beggar Woman'],
      items: [
        { id: 'I.1-s1', cat: 'set', name: 'Harbour / dock: ship\'s rail, crate, coil of rope, bollard, gangplank', note: '', src: 'script' },
        { id: 'I.1-s2', cat: 'set', name: 'Beggar Woman\'s bench or doorway nook', note: 'Reused I.4, I.7; II.1, II.7.', src: 'script' },
        { id: 'I.1-p1', cat: 'prop', name: 'Anthony\'s sea chest or duffel', note: 'Must be carried one-handed.', src: 'script' },
        { id: 'I.1-p2', cat: 'prop', name: 'Todd\'s small bundle of belongings', note: '', src: 'script' },
        { id: 'I.1-p3', cat: 'prop', name: 'Beggar Woman\'s begging tin', note: 'Should rattle.', src: 'script' },
        { id: 'I.1-p4', cat: 'prop', name: 'Coins and coin purses (several)', note: 'Soft or taped so they do not scatter. Used through both acts.', src: 'script' }
      ] },

    { id: 'I.2', act: 'I', sc: '2', pp: '', when: 'Thu 8/20',
      loc: 'Mrs. Lovett\'s pie shop; the parlor above; the Poor Thing flashback',
      songs: '"The Worst Pies in London"; "Poor Thing"; "My Friends"',
      tech: 'CLOSED-CALL FLASHBACK: the Poor Thing assault is staged with the full consent protocol — choreographed exactly, consent asked before every call, parents told before the first rehearsal of it. Pie shop door bell.',
      cast: ['Mrs. Lovett', 'Sweeney Todd', 'Young Lucy', 'Ensemble'],
      items: [
        { id: 'I.2-s1', cat: 'set', name: 'Pie shop interior: counter, pie case, tables, chairs, shelving', note: 'Counter must take Lovett\'s weight in The Worst Pies.', src: 'script' },
        { id: 'I.2-s2', cat: 'set', name: 'Practical bake oven with opening door and interior glow', note: 'LED/gel glow only, no flame; extinguisher on the deck.', src: 'script' },
        { id: 'I.2-s3', cat: 'set', name: 'Barber\'s work table and washstand: basin, pitcher, mirror, strop hook, towel rail', note: 'Shatterproof mirror only.', src: 'script' },
        { id: 'I.2-p1', cat: 'prop', name: 'Rolling pin', note: 'Comic weapon — light wood.', src: 'script' },
        { id: 'I.2-p2', cat: 'prop', name: 'Flour, dough, pie tins, baking tray', note: 'Allergy-safe flour substitute; agree the mess plan with stage management.', src: 'script' },
        { id: 'I.2-p3', cat: 'prop', name: 'Loose floorboard with hidden box (the razors)', note: 'Practical lift; quiet.', src: 'script' },
        { id: 'I.2-p4', cat: 'prop', name: 'Gin bottle and glass; dishrag, apron, broom', note: 'Coloured water, plastic bottle.', src: 'script' },
        { id: 'I.2-p5', cat: 'prop', name: 'Meat cleaver and knives', note: 'Dulled, rubber-tipped, on the weapons plot.', src: 'script' },
        { id: 'I.2-c1', cat: 'costume', who: 'Young Lucy', name: 'Young Lucy — pale ball gown, blonde wig, masquerade mask, wedding ring', note: 'Her shawl must visually match the Beggar Woman\'s — it carries the II.9 reveal. Quick in/out inside the number: pre-set her entrance.', src: 'script' }
      ] },

    { id: 'I.3', act: 'I', sc: '3', pp: '', when: 'Sat 8/22',
      loc: 'Judge Turpin\'s house; Johanna\'s window; the street below',
      songs: '"Green Finch and Linnet Bird"; "Ah, Miss"; "Johanna" (Anthony)',
      tech: 'Moonlight special on Johanna\'s window.',
      cast: ['Johanna', 'Anthony', 'Beggar Woman', 'Ensemble'],
      items: [
        { id: 'I.3-s1', cat: 'set', name: 'Johanna\'s window or balcony unit with grille', note: 'Practical opening; safe rail height.', src: 'script' },
        { id: 'I.3-s2', cat: 'set', name: 'Judge Turpin\'s house: door, desk, chair, kneeler, full-length mirror', note: 'Kneeler stays even though Mea Culpa is cut. Shatterproof mirror.', src: 'script' },
        { id: 'I.3-s3', cat: 'set', name: 'Bird Seller\'s cart with hanging cages', note: 'No live birds.', src: 'script' },
        { id: 'I.3-p1', cat: 'prop', name: 'Bird cage with artificial bird', note: '', src: 'script' },
        { id: 'I.3-p2', cat: 'prop', name: 'Johanna\'s embroidery hoop or sewing', note: '', src: 'script' },
        { id: 'I.3-p3', cat: 'prop', name: 'Judge\'s keys and prayer book', note: '', src: 'script' }
      ] },

    { id: 'I.4', act: 'I', sc: '4', pp: '', when: 'Sat 8/22',
      loc: 'St. Dunstan\'s marketplace — Pirelli\'s pitch and the shaving contest',
      songs: '"Pirelli\'s Miracle Elixir"; "The Contest"',
      tech: 'Market crowd ambience. First razor pass of the show — murder snap + whistle vocabulary starts here.',
      cast: ['Pirelli', 'Toby', 'Sweeney Todd', 'Mrs. Lovett', 'Beadle', 'Ensemble'],
      items: [
        { id: 'I.4-s1', cat: 'set', name: 'Pirelli\'s market wagon or stall with steps and painted banner', note: 'Must take Pirelli standing on it; casters lock.', src: 'script' },
        { id: 'I.4-p1', cat: 'prop', name: 'Elixir bottles — crate plus tray of 24', note: 'Plastic, coloured liquid, sealed.', src: 'script' },
        { id: 'I.4-p2', cat: 'prop', name: 'Toby\'s handbell or horn', note: 'Pitch checked with the music director.', src: 'script' },
        { id: 'I.4-p3', cat: 'prop', name: 'Shaving kit: basin, pitcher, lather mug, brush, strop', note: 'Foam that will not stain costumes.', src: 'script' },
        { id: 'I.4-p4', cat: 'prop', name: 'Beadle\'s staff of office and pocket watch', note: 'The watch times the contest.', src: 'script' },
        { id: 'I.4-p5', cat: 'prop', name: 'Pirelli\'s purse and silver card case with calling card', note: 'The card is a plot point — readable from the front row.', src: 'script' },
        { id: 'I.4-p6', cat: 'prop', name: 'Contest stool or chair for the volunteer', note: '', src: 'script' },
        { id: 'I.4-c1', cat: 'costume', who: 'Pirelli', name: 'Pirelli — flamboyant suit, sash, cape, hat, wig', note: 'Then straight into an Ensemble track for Act II: wig off, full look change.', src: 'script' }
      ] },

    { id: 'I.5', act: 'I', sc: '5', pp: '', when: 'Sat 8/29',
      loc: 'The tonsorial parlor and pie shop — Pirelli\'s visit',
      songs: '(scene; underscore)',
      tech: 'First kill. Chair-to-trunk sequence rehearsed at slow tempo; spotter named.',
      cast: ['Sweeney Todd', 'Mrs. Lovett', 'Toby', 'Pirelli'],
      items: [
        { id: 'I.5-p1', cat: 'prop', name: 'Trunk or chest (Pirelli\'s body)', note: 'Big enough for a person; hinge stops so the lid cannot fall. In the room by 9/19.', src: 'script' },
        { id: 'I.5-p2', cat: 'prop', name: 'Kettle and tea things', note: 'Reused II.5.', src: 'script' }
      ] },

    { id: 'I.6', act: 'I', sc: '6', pp: '', when: 'Sat 8/29',
      loc: 'Judge Turpin\'s house',
      songs: '"Ladies in their Sensitivities" (per score)',
      tech: '',
      cast: ['Judge Turpin', 'Beadle'],
      items: [
        { id: 'I.6-p1', cat: 'prop', name: 'Judge\'s letter to Johanna; writing set', note: 'Two copies — one sealed, one open. Writing set reused II.2.', src: 'script' }
      ] },

    { id: 'I.7', act: 'I', sc: '7', pp: '', when: 'Sat 9/5',
      loc: 'Outside the Judge\'s house; the street',
      songs: '"Kiss Me"; "Ladies in their Sensitivities" (quartet per score)',
      tech: '',
      cast: ['Johanna', 'Anthony', 'Judge Turpin', 'Beadle', 'Beggar Woman'],
      items: [
        { id: 'I.7-p1', cat: 'prop', name: 'Johanna\'s travelling case', note: 'Reused II.2.', src: 'script' }
      ] },

    { id: 'I.8', act: 'I', sc: '8', pp: '', when: 'Sat 9/12',
      loc: 'The tonsorial parlor — the Judge in the chair; Epiphany',
      songs: '"Pretty Women"; "Epiphany"',
      tech: 'THE chair scene. Epiphany isolation special — Todd addresses the house; decide whether the audience is lit. Murder snap + whistle. Chair operator and trap spotter: two named people, every run.',
      cast: ['Sweeney Todd', 'Judge Turpin', 'Anthony', 'Mrs. Lovett'],
      items: [
        { id: 'I.8-s1', cat: 'set', name: 'Barber chair — tilting trick chair with release lever or pedal', note: 'THE key build. Rehearsal unit by 9/19, slow-tempo staging from 9/20, certified operator, weight-tested, padded landing. Final by 10/3.', src: 'script' },
        { id: 'I.8-s2', cat: 'set', name: 'Chute or trap from parlor to bakehouse, with landing mattress', note: 'Crash mat, trap guard, dedicated spotter on every single run. Alternative: blackout + body double.', src: 'script' },
        { id: 'I.8-p1', cat: 'prop', name: 'Hand mirror; Judge\'s wig on a stand', note: 'Shatterproof; check sightline glare with lighting.', src: 'script' },
        { id: 'I.8-c1', cat: 'costume', who: 'Judge Turpin', name: 'Judge\'s dressing gown and open shirt for the shave', note: 'Neck exposed and reachable.', src: 'script' }
      ] },

    { id: 'I.9', act: 'I', sc: '9', pp: '', when: 'Sat 9/12',
      loc: 'The pie shop — A Little Priest',
      songs: '"A Little Priest"',
      tech: 'Act I button. Lovett\'s comic timing carries it — keep props light.',
      cast: ['Sweeney Todd', 'Mrs. Lovett'],
      items: [
        { id: 'I.9-p1', cat: 'prop', name: 'Practical pies — edible hero pies and foam stunt pies', note: 'Allergy check the whole company; hero pies fresh each performance. Used heavily II.1.', src: 'script' }
      ] },

    { id: 'II.1', act: 'II', sc: '1', pp: '', when: 'Sat 9/19',
      loc: 'The pie shop, months later — God, That\'s Good!',
      songs: '"God, That\'s Good!"',
      tech: 'Oven glow from below through the trap if the build allows. Toby sings carrying a full tray — rehearse loaded from 9/14.',
      cast: ['Toby', 'Mrs. Lovett', 'Sweeney Todd', 'Ensemble'],
      items: [
        { id: 'II.1-p1', cat: 'prop', name: 'Pie trays, serving harness, bones bucket, order slate, cash box', note: '', src: 'script' },
        { id: 'II.1-p2', cat: 'prop', name: 'Tankards, ale jugs, plates, forks, napkins', note: 'Metal or pewter look; nothing glass.', src: 'script' }
      ] },

    { id: 'II.2', act: 'II', sc: '2', pp: '', when: 'Sat 9/19',
      loc: 'Fleet Street; the parlor',
      songs: '"Johanna" (quartet)',
      tech: '',
      cast: ['Anthony', 'Sweeney Todd', 'Johanna', 'Beggar Woman'],
      items: [
        { id: 'II.2-p1', cat: 'prop', name: 'Anthony\'s pistol — DECIDE BY 9/14', note: 'Check the script first: some editions cut it. If used: non-firing replica, weapons plot, locked storage, school policy check before anything else.', src: 'proposed' },
        { id: 'II.2-p2', cat: 'prop', name: 'Letter, envelope, quill, ink, sealing wax', note: 'Shared with II.4.', src: 'script' }
      ] },

    { id: 'II.3', act: 'II', sc: '3', pp: '', when: 'Sat 9/26',
      loc: 'Mrs. Lovett\'s seaside fantasy',
      songs: '"By the Sea"',
      tech: 'The one warm cue in the show — bright sunny wash; make it hurt. Fantasy dressing flies or rolls in fast and out again.',
      cast: ['Mrs. Lovett', 'Sweeney Todd'],
      items: [
        { id: 'II.3-s1', cat: 'set', name: 'Seaside dressing: painted flat or drop, deck chairs, striped awning', note: 'Fast on and off for one number.', src: 'script' },
        { id: 'II.3-p1', cat: 'prop', name: 'Parasol, sunhat, fan, picnic hamper, postcards', note: '', src: 'script' }
      ] },

    { id: 'II.4', act: 'II', sc: '4', pp: '', when: 'Sat 9/26',
      loc: 'The wig-maker\'s parlor; the street — the Letter',
      songs: '"Wigmaker Sequence"; "The Letter" (quintet)',
      tech: 'Johanna\'s sailor-boy quick change: hair, cap, shoes — time it at the 10/10 tech, one dresser assigned.',
      cast: ['Sweeney Todd', 'Anthony', 'Johanna', 'Ensemble'],
      items: [
        { id: 'II.4-s1', cat: 'set', name: 'Wig-maker\'s parlor dressing: wig blocks, stands, shelves', note: '', src: 'script' },
        { id: 'II.4-p1', cat: 'prop', name: 'Prop wigs, wig blocks, shears, combs, hair clippings', note: 'Separate from the show\'s real wig stock.', src: 'script' }
      ] },

    { id: 'II.5', act: 'II', sc: '5', pp: '', when: 'Sat 10/3',
      loc: 'The pie shop parlor — Parlor Songs',
      songs: '"Parlor Songs"; "Not While I\'m Around"',
      tech: 'The Beadle PLAYS the harmonium — the instrument must be real, playable, and in the room by 9/18. Confirm who tunes it.',
      cast: ['Beadle', 'Mrs. Lovett', 'Toby'],
      items: [
        { id: 'II.5-p1', cat: 'prop', name: 'Harmonium or portable organ (practical, playable)', note: 'Rental decision early — the Beadle plays it live.', src: 'script' },
        { id: 'II.5-p2', cat: 'prop', name: 'Sheet music and songbook, period cover; laundry basket, Lovett\'s keys', note: '', src: 'script' }
      ] },

    { id: 'II.6', act: 'II', sc: '6', pp: '', when: 'Sat 10/3',
      loc: 'Fogg\'s Asylum — City on Fire',
      songs: '"Fogg\'s Passacaglia"; "City on Fire!"',
      tech: 'Asylum bar shadows or gobo; City on Fire red wash and chase. Restraints must release instantly — no actual binding of an actor.',
      cast: ['Fogg', 'Johanna', 'Anthony', 'Toby', 'Ensemble'],
      items: [
        { id: 'II.6-s1', cat: 'set', name: 'Fogg\'s Asylum: barred cell or cage unit with gate, straw', note: 'Gate opens from both sides; no pinch points.', src: 'script' },
        { id: 'II.6-p1', cat: 'prop', name: 'Asylum keys on a ring, restraint straps, keeper\'s lantern, bell', note: 'Straps release instantly.', src: 'script' }
      ] },

    { id: 'II.7', act: 'II', sc: '7', pp: '', when: 'Sun 10/4',
      loc: 'The streets — Searching',
      songs: '"Searching" (per score)',
      tech: 'Search lanterns; thunder if staged.',
      cast: ['Anthony', 'Johanna', 'Beggar Woman', 'Sweeney Todd', 'Ensemble'],
      items: [
        { id: 'II.7-p1', cat: 'prop', name: 'Search torches or lanterns (battery practicals)', note: '', src: 'script' },
        { id: 'II.7-p2', cat: 'prop', name: 'The Beggar Woman\'s shawl — THE REVEAL PROP', note: 'Must match Young Lucy\'s flashback costume exactly. Hair and face reveal at II.9 kept simple and lit.', src: 'script' }
      ] },

    { id: 'II.8', act: 'II', sc: '8', pp: '', when: 'Sun 10/4',
      loc: 'The parlor — the Judge returns',
      songs: '"Pretty Women" (reprise per score)',
      tech: 'Chair sequence again, at performance tempo only after the Sun 10/4 full safety review clears it. Murder snap + whistle.',
      cast: ['Sweeney Todd', 'Judge Turpin', 'Beggar Woman'],
      items: [] },

    { id: 'II.9', act: 'II', sc: '9', pp: '', when: 'Sun 10/4',
      loc: 'The bakehouse — the reveal, the oven, the finale',
      songs: '"Final Sequence"; "The Ballad of Sweeney Todd" (reprise)',
      tech: 'Bakehouse and oven glow from below; final tableau special on Todd, Lucy and Toby. Blood laundry and reset plan: duplicate shirts, aprons, towels; a wash cycle between performances.',
      cast: ['Sweeney Todd', 'Mrs. Lovett', 'Toby', 'Beggar Woman', 'Young Lucy', 'Judge Turpin', 'Ensemble'],
      items: [
        { id: 'II.9-s1', cat: 'set', name: 'Bakehouse: chopping block, meat grinder practical, boiling vat, iron door', note: 'Grinder is hand-crank with no exposed mechanism; blades dummy only.', src: 'script' },
        { id: 'II.9-p1', cat: 'prop', name: 'Bakehouse gore kit: blood towels, bone, grinder handle, oven paddle', note: '', src: 'script' }
      ] }
  ]
};
