/* Dear Evan Hansen — scene-by-scene production breakdown.
 *
 * WHERE THIS COMES FROM, AND WHAT THAT MEANS FOR YOU
 * --------------------------------------------------
 * Every item carries a `src`:
 *
 *   src:'script'   Named in the Scene & Song Breakdown built from the script
 *                  (DEH_Rehearsal_Schedule_Aug3-14_2026_v2.xlsx). Treat as
 *                  confirmed — the show does not work without it.
 *
 *   src:'proposed' NOT lifted from the script. It follows from the scene's
 *                  location, action, or period, and it is here so the design
 *                  session on Mon 8/3 has something to argue with rather than
 *                  a blank page. CONFIRM EACH ONE AGAINST THE SCRIPT before
 *                  anybody spends money. Tick "Confirmed" in the dashboard as
 *                  you go and the badge clears.
 *
 * The script PDF itself was not reachable when this was built (it lives on
 * CJ's desktop and is not in Drive), so nothing here should be mistaken for a
 * line-by-line read of the libretto. Drop the PDF into Drive and this file can
 * be rebuilt properly.
 *
 * Costume items carry `who`. Quantities default to 1 unless `qty` says
 * otherwise. Sourcing state (status, vendor, link, price) is entered in the
 * dashboard and stored per item id — do not renumber ids or that state
 * detaches from the item it belongs to.
 */
window.DEHSCENES = {
  cast: ['Evan', 'Heidi', 'Connor', 'Zoe', 'Cynthia', 'Larry', 'Alana', 'Jared', 'Company'],

  // Looks that live across the whole show rather than one scene. Sourced once,
  // used everywhere — kept separate so they are not costed nine times over.
  standing: [
    { id: 'ST-c1', cat: 'costume', who: 'Evan', name: 'Evan — striped polo and khakis (Act I base look)',
      note: 'His armour. Reads as "trying to be invisible". Needs a duplicate for the shaving cream scene.', qty: 2, src: 'proposed' },
    { id: 'ST-c2', cat: 'costume', who: 'Evan', name: 'Evan — arm cast, signable, Act I only',
      note: 'CRITICAL PROP. Connor signs it in outsized scrawl in I.2 and it must read from the house. Build several: one per performance plus rehearsal spares.', qty: 6, src: 'script' },
    { id: 'ST-c3', cat: 'costume', who: 'Evan', name: 'Evan — Act II look, cast OFF',
      note: 'CONTINUITY: the cast is gone from II.2 onward. Costume and props both need to catch this.', src: 'script' },
    { id: 'ST-c4', cat: 'costume', who: 'Connor', name: 'Connor — the clothes he died in',
      note: 'He wears this every time he appears after I.1. It never changes, which is the point.', src: 'script' },
    { id: 'ST-c5', cat: 'costume', who: 'Connor', name: 'Connor — long hair (wig or the performer\'s own)',
      note: 'Decide at fittings. If a wig, it needs a block, a dresser, and a quick-change plan.', src: 'proposed' },
    { id: 'ST-c6', cat: 'costume', who: 'Zoe', name: 'Zoe — indigo hair streaks and star-marked jeans',
      note: 'Design details taken from the script. Streaks are a per-performance consumable.', qty: 1, src: 'script' },
    { id: 'ST-c7', cat: 'costume', who: 'Heidi', name: 'Heidi — nurse\'s aide scrubs',
      note: 'Her work look, from I.2. She is almost never out of work clothes, which is the character.', src: 'script' },
    { id: 'ST-c8', cat: 'costume', who: 'Heidi', name: 'Heidi — home clothes for the "So Big/So Small" scene',
      note: 'The one time we see her off shift. Should feel softer and older than the scrubs.', src: 'proposed' },
    { id: 'ST-c9', cat: 'costume', who: 'Cynthia', name: 'Cynthia — affluent suburban mother, full track',
      note: 'Murphy money should read instantly against Heidi. Multiple looks across the show.', qty: 3, src: 'proposed' },
    { id: 'ST-c10', cat: 'costume', who: 'Larry', name: 'Larry — business casual, softening to weekend dad',
      note: 'The garage scene needs something he can get shaving cream on.', qty: 3, src: 'proposed' },
    { id: 'ST-c11', cat: 'costume', who: 'Alana', name: 'Alana — layered, effortful, school-president',
      note: 'Every button and pin she wears is a small campaign.', qty: 2, src: 'proposed' },
    { id: 'ST-c12', cat: 'costume', who: 'Jared', name: 'Jared — graphic tee and hoodie track',
      note: 'Comic relief that is actually armour. Should not read as a costume.', qty: 2, src: 'proposed' },
    { id: 'ST-c13', cat: 'costume', who: 'Company', name: 'Ensemble school-day base looks',
      note: 'Sixteen ensemble students. Personal clothes pulled and approved is cheapest; budget for gaps.', qty: 16, src: 'proposed' },
    { id: 'ST-c14', cat: 'costume', who: 'Company', name: 'The Connor Project t-shirts / wristbands / buttons',
      note: 'Merch the characters make. Also the visual engine of "You Will Be Found". Needs real quantity.', qty: 30, src: 'script' },
    { id: 'ST-s1', cat: 'set', name: 'Projection surfaces — the show\'s primary scenic element',
      note: 'HIGHEST TECH RISK. Screens proliferate through I.12 and the letter fills the stage in II.8. Confirm hardware, throw distance, and a content designer.', src: 'script' },
    { id: 'ST-s2', cat: 'set', name: 'Platforms and deck framing',
      note: 'Built in week 1. Carries the split-scene staging that runs through the whole show.', src: 'script' },
    { id: 'ST-p1', cat: 'prop', name: 'Laptops / devices — practical, one per online character',
      note: 'Evan, Jared, Alana, Cynthia at minimum. Screens must be dressable for projection or blackout.', qty: 5, src: 'script' },
    { id: 'ST-p2', cat: 'prop', name: 'Mic and cable stock for the projection/sound rig',
      note: 'Not scenic, but it comes out of the same build budget. Confirm channel count against the cast size.', src: 'proposed' }
  ],

  scenes: [
    { id: 'I.1', act: 'I', sc: '1', pp: '12-20', when: 'Mon 8/3',
      loc: 'Evan bedroom / Murphy kitchen / school',
      songs: '"Anybody Have a Map?"; "Waving Through a Window"',
      tech: 'Pre-show soundscape; many light shifts; split-scene simultaneous singing; Connor shoves Evan; props: laptop, cast, $20',
      cast: ['Evan', 'Heidi', 'Cynthia', 'Larry', 'Connor', 'Zoe', 'Alana', 'Jared', 'Company'],
      items: [
        { id: 'I.1-s1', cat: 'set', name: 'Evan\'s bed and bedroom unit', note: 'Has to strike or turn fast — the scene is split three ways.', src: 'proposed' },
        { id: 'I.1-s2', cat: 'set', name: 'Murphy kitchen: table and four chairs', note: 'The affluent kitchen. Reused in I.10 and II.9.', src: 'script' },
        { id: 'I.1-s3', cat: 'set', name: 'Hansen kitchen: smaller table, two chairs', note: 'Deliberately poorer than the Murphys\'. The contrast is the point.', src: 'proposed' },
        { id: 'I.1-s4', cat: 'set', name: 'School hallway lockers or locker flat', note: 'Where Connor shoves Evan.', src: 'proposed' },
        { id: 'I.1-p1', cat: 'prop', name: 'Evan\'s laptop', note: 'Named in the script breakdown. He writes the letter on it.', src: 'script' },
        { id: 'I.1-p2', cat: 'prop', name: '$20 bill', note: 'Named in the script breakdown. Heidi leaves it for him.', src: 'script' },
        { id: 'I.1-p3', cat: 'prop', name: 'Evan\'s letter — printed sheet', note: 'MUST match the folded letter revealed in I.4. Same paper, same fold, or the reveal dies.', src: 'script' },
        { id: 'I.1-p4', cat: 'prop', name: 'Breakfast dressing for the Murphy table', note: 'Bowls, mugs, cereal. Consumables if anything is actually eaten.', src: 'proposed' },
        { id: 'I.1-p5', cat: 'prop', name: 'School backpacks', note: 'One per student character who enters from school.', qty: 6, src: 'proposed' },
        { id: 'I.1-c1', cat: 'costume', who: 'Company', name: 'First-day-of-school looks, full company', note: 'Establishes every ensemble track in one number.', src: 'proposed' }
      ] },

    { id: 'I.2', act: 'I', sc: '2', pp: '20-22', when: 'Mon 8/3',
      loc: 'Heidi at work / computer lab',
      songs: '"Waving Through a Window (Reprise)"',
      tech: 'CRITICAL PROP: Connor signs cast in outsized scrawl — must read from the house',
      cast: ['Heidi', 'Evan', 'Connor'],
      items: [
        { id: 'I.2-s1', cat: 'set', name: 'Computer lab: desks and monitors', note: 'Where the letter gets printed and taken.', src: 'proposed' },
        { id: 'I.2-p1', cat: 'prop', name: 'Sharpie for signing the cast', note: 'CRITICAL. Must write huge and legibly from the back row. Test on the real cast material.', qty: 4, src: 'script' },
        { id: 'I.2-p2', cat: 'prop', name: 'Printed letter — the copy Connor takes', note: 'Same sheet, same fold as I.1 and I.4. Build a matched set of at least six.', qty: 6, src: 'script' },
        { id: 'I.2-p3', cat: 'prop', name: 'Practical printer or printer sound cue', note: 'Decide with Colton: real machine or sound only.', src: 'proposed' },
        { id: 'I.2-c1', cat: 'costume', who: 'Heidi', name: 'Heidi in scrubs, on shift', note: 'First time we see the work look.', src: 'script' }
      ] },

    { id: 'I.3', act: 'I', sc: '3', pp: '23', when: 'Mon 8/3',
      loc: 'Online', songs: '"WTAW (Reprise #2)"',
      tech: 'Blackout isolates Alana in a pin spot',
      cast: ['Evan', 'Jared', 'Alana'],
      items: [
        { id: 'I.3-s1', cat: 'set', name: 'Pin-spot position for Alana', note: 'LX, not scenic, but it has to be plotted and focused. Recurs in I.5.', src: 'script' },
        { id: 'I.3-p1', cat: 'prop', name: 'Phones — Evan, Jared, Alana', note: 'Practical screens. Should light faces.', qty: 3, src: 'proposed' }
      ] },

    { id: 'I.4', act: 'I', sc: '4', pp: '24-26', when: 'Tue 8/4',
      loc: 'Principal\'s office', songs: '(none — plays in silence)',
      tech: 'No underscoring; the cast reveal must land visually; folded letter must match the Sc 2 sheet',
      cast: ['Evan', 'Cynthia', 'Larry'],
      items: [
        { id: 'I.4-s1', cat: 'set', name: 'Principal\'s office: desk and three chairs', note: 'Plays in total silence, so every squeak in this furniture is heard.', src: 'script' },
        { id: 'I.4-p1', cat: 'prop', name: 'The folded letter', note: 'MUST match I.2 exactly. This is the prop the whole plot turns on.', src: 'script' },
        { id: 'I.4-p2', cat: 'prop', name: 'Office dressing: files, desk lamp, framed photos', note: 'Silence means the audience studies the room.', src: 'proposed' },
        { id: 'I.4-c1', cat: 'costume', who: 'Cynthia', name: 'Cynthia — grief, dressed carefully', note: 'She has pulled herself together to be here.', src: 'proposed' },
        { id: 'I.4-c2', cat: 'costume', who: 'Larry', name: 'Larry — straight from work', note: 'He has not stopped. That reads in the suit.', src: 'proposed' }
      ] },

    { id: 'I.5', act: 'I', sc: '5', pp: '26-27', when: 'Tue 8/4',
      loc: 'Online', songs: '(none)',
      tech: 'Pin spot for Alana; social-media post projections',
      cast: ['Evan', 'Jared', 'Alana'],
      items: [
        { id: 'I.5-pr1', cat: 'set', name: 'Projection content: escalating social-media posts', note: 'Content design job, not a purchase. Starts the visual build toward I.12.', src: 'script' },
        { id: 'I.5-p1', cat: 'prop', name: 'Phones / laptops (continuing)', note: 'Same units as I.3.', src: 'proposed' }
      ] },

    { id: 'I.6', act: 'I', sc: '6', pp: '27-31', when: 'Tue 8/4',
      loc: 'Murphy dining room', songs: '"For Forever"',
      tech: 'Bowl of apples center table is the plot trigger; ends on Cynthia\'s hard hug',
      cast: ['Evan', 'Larry', 'Cynthia', 'Zoe'],
      items: [
        { id: 'I.6-s1', cat: 'set', name: 'Murphy dining table and four chairs', note: 'Dressed for a real dinner. Bigger and better than the Hansen table.', src: 'script' },
        { id: 'I.6-p1', cat: 'prop', name: 'Bowl of apples, centre table', note: 'THE PLOT TRIGGER. Place it deliberately. Real fruit is a per-performance consumable; artificial reads fine at distance.', src: 'script' },
        { id: 'I.6-p2', cat: 'prop', name: 'Full dinner service: plates, glasses, cutlery, serving dishes', qty: 4, note: 'Four places. Sound-dampen the deck under it.', src: 'proposed' },
        { id: 'I.6-p3', cat: 'prop', name: 'Practical food for the dinner', note: 'Consumable. Decide whether anyone actually eats.', src: 'proposed' },
        { id: 'I.6-s2', cat: 'set', name: 'Orchard imagery for "For Forever"', note: 'The invented memory. Sets up the real orchard reveal in II.9 — they should rhyme.', src: 'proposed' }
      ] },

    { id: 'I.7', act: 'I', sc: '7', pp: '31-33', when: 'Wed 8/5',
      loc: 'Online / Evan\'s bedroom', songs: '(none)',
      tech: 'Light-driven shift, no set change; props: scholarship papers, pill bottle',
      cast: ['Jared', 'Evan', 'Heidi'],
      items: [
        { id: 'I.7-p1', cat: 'prop', name: 'Scholarship papers', note: 'Named in the script breakdown.', src: 'script' },
        { id: 'I.7-p2', cat: 'prop', name: 'Pill bottle', note: 'Named in the script breakdown. Content-sensitive — handle in the Monday conversation.', src: 'script' },
        { id: 'I.7-p3', cat: 'prop', name: 'Evan\'s laptop (continuing)', src: 'proposed' }
      ] },

    { id: 'I.8', act: 'I', sc: '8', pp: '34-37', when: 'Wed 8/5',
      loc: 'Spotlight / Jared\'s space', songs: '"Sincerely, Me"',
      tech: 'Comic showstopper; Connor in the clothes he died in; split-syllable three-way unison — tight choreo',
      cast: ['Connor', 'Evan', 'Jared'],
      items: [
        { id: 'I.8-s1', cat: 'set', name: 'Isolated spotlight special for Connor\'s materialisation', note: 'He appears from nowhere. The light does the trick.', src: 'script' },
        { id: 'I.8-p1', cat: 'prop', name: 'The fake emails — printed, handled through the number', note: 'They accumulate into the stack used in I.9.', qty: 20, src: 'script' },
        { id: 'I.8-c1', cat: 'costume', who: 'Connor', name: 'Connor in the clothes he died in', note: 'Established here and never changed after.', src: 'script' }
      ] },

    { id: 'I.9', act: 'I', sc: '9', pp: '38-41', when: 'Wed 8/5',
      loc: 'Murphy living room / Connor\'s bedroom', songs: '"Requiem"',
      tech: 'Three areas lit at once; literal 3-part counterpoint; prop: large stack of emails',
      cast: ['Evan', 'Cynthia', 'Larry', 'Zoe'],
      items: [
        { id: 'I.9-s1', cat: 'set', name: 'Murphy living room: sofa and side furniture', note: 'The room the family cannot sit in together. Reused in II.6 and II.9.', src: 'script' },
        { id: 'I.9-s2', cat: 'set', name: 'Connor\'s bedroom unit', note: 'Lit simultaneously with the living room. Also carries I.11.', src: 'script' },
        { id: 'I.9-p1', cat: 'prop', name: 'Large stack of printed emails', note: 'Named in the script breakdown. Needs real bulk to read.', src: 'script' },
        { id: 'I.9-p2', cat: 'prop', name: 'Connor\'s belongings dressing the bedroom', note: 'Whatever the family has not been able to move.', src: 'proposed' }
      ] },

    { id: 'I.10', act: 'I', sc: '10', pp: '42-43', when: 'Thu 8/6',
      loc: 'Online / bedroom / Murphy kitchen', songs: '(none)',
      tech: 'Alana must VANISH on laptop close; hard light snap between the two mothers',
      cast: ['Alana', 'Evan', 'Heidi', 'Cynthia'],
      items: [
        { id: 'I.10-p1', cat: 'prop', name: 'Alana\'s laptop — the vanish cue', note: 'The lid closing kills her light. Rehearse the timing as a unit with LX.', src: 'script' },
        { id: 'I.10-s1', cat: 'set', name: 'Two-mother light snap positions', note: 'Heidi and Cynthia in hard alternation. Plot both.', src: 'script' }
      ] },

    { id: 'I.11', act: 'I', sc: '11', pp: '43-47', when: 'Thu 8/6',
      loc: 'Connor\'s bedroom', songs: '"If I Could Tell Her"',
      tech: 'INTIMACY: Evan kisses Zoe, she pulls away. Closed call, Tony directing.',
      cast: ['Evan', 'Zoe'],
      items: [
        { id: 'I.11-s1', cat: 'set', name: 'Connor\'s bed (continuing from I.9)', src: 'script' },
        { id: 'I.11-p1', cat: 'prop', name: 'Personal items Evan invents stories about', note: 'Whatever he points to has to be findable in the room.', src: 'proposed' },
        { id: 'I.11-c1', cat: 'costume', who: 'Zoe', name: 'Zoe — the star-marked jeans in a close scene', note: 'The detail gets seen properly here. Closed intimacy call: costume must be settled before it.', src: 'script' }
      ] },

    { id: 'I.12', act: 'I', sc: '12', pp: '47-60', when: 'Thu 8/6 + Fri 8/7',
      loc: 'Online / school / Murphy kitchen / AUDITORIUM',
      songs: '"Disappear"; "You Will Be Found" (ACT I FINALE)',
      tech: 'LARGEST TECH SEQUENCE: major projection, screens proliferate, Virtual Community; Connor appears and vanishes; INTIMACY: Zoe kisses Evan',
      cast: ['Evan', 'Jared', 'Alana', 'Connor', 'Cynthia', 'Larry', 'Zoe', 'Heidi', 'Company'],
      items: [
        { id: 'I.12-s1', cat: 'set', name: 'Auditorium / assembly setting', note: 'The scene has to become a public room. Biggest scenic shift in Act I.', src: 'script' },
        { id: 'I.12-s2', cat: 'set', name: 'Proliferating screens — the Virtual Community', note: 'THE tech centrepiece of Act I. Multiple surfaces, content-designed, cued to the number.', src: 'script' },
        { id: 'I.12-p1', cat: 'prop', name: 'Note cards for the assembly speech', note: 'They drop. Build a lot and reset them every performance.', qty: 40, src: 'script' },
        { id: 'I.12-p2', cat: 'prop', name: 'The Connor Project merch on stage: shirts, wristbands, buttons', note: 'Same stock as the standing item — this is where it is seen.', src: 'script' },
        { id: 'I.12-p3', cat: 'prop', name: 'Podium or lectern', src: 'proposed' },
        { id: 'I.12-c1', cat: 'costume', who: 'Company', name: 'Full company assembly looks', note: 'Everyone on stage. Quick-change plan needed off the back of Act I Sc 1.', src: 'proposed' }
      ] },

    { id: 'II.1', act: 'II', sc: '1', pp: '60-61', when: 'Fri 8/7',
      loc: 'Alana + Evan bedrooms (online)', songs: '(none — promo video)',
      tech: 'Two projected images required: abandoned orchard, then architectural rendering',
      cast: ['Alana', 'Evan'],
      items: [
        { id: 'II.1-s1', cat: 'set', name: 'Projection: the abandoned orchard', note: 'Must set up the real reveal in II.9. Same orchard, before and after.', src: 'script' },
        { id: 'II.1-s2', cat: 'set', name: 'Projection: architectural rendering of the restored orchard', note: 'Content design job. Named in the script breakdown.', src: 'script' }
      ] },

    { id: 'II.2', act: 'II', sc: '2', pp: '62-65', when: 'Fri 8/7',
      loc: 'Spotlight / Jared / Evan bedroom', songs: '"Sincerely, Me (Reprise)"',
      tech: 'Jared must vanish instantly; CONTINUITY: Evan\'s cast is now OFF; sharp music cutout',
      cast: ['Connor', 'Jared', 'Evan', 'Heidi'],
      items: [
        { id: 'II.2-s1', cat: 'set', name: 'Instant-vanish position for Jared', note: 'Light or masking. Solve it in the room, not at cue-to-cue.', src: 'script' },
        { id: 'II.2-c1', cat: 'costume', who: 'Evan', name: 'Evan with the cast OFF', note: 'CONTINUITY GATE. Everyone downstream of this scene works cast-free.', src: 'script' }
      ] },

    { id: 'II.3', act: 'II', sc: '3', pp: '65-69', when: 'Mon 8/10',
      loc: 'Murphy garage', songs: '"To Break in a Glove"',
      tech: 'PRACTICAL MESS: real shaving cream onstage — drop cloth, cleanup, costume protection',
      cast: ['Larry', 'Evan', 'Zoe'],
      items: [
        { id: 'II.3-s1', cat: 'set', name: 'Murphy garage: workbench and shelving', note: 'Only scene in the garage. Should feel like Larry\'s room.', src: 'script' },
        { id: 'II.3-p1', cat: 'prop', name: 'Baseball glove', note: 'The object of the whole number.', qty: 2, src: 'script' },
        { id: 'II.3-p2', cat: 'prop', name: 'Shaving cream — REAL, per performance', note: 'CONSUMABLE. One can per run including every dress. Decide whether dress rehearsals use the real product.', qty: 12, src: 'script' },
        { id: 'II.3-p3', cat: 'prop', name: 'Drop cloth and cleanup kit', note: 'Mandatory. Deck safety and the next scene both depend on it.', src: 'script' },
        { id: 'II.3-c1', cat: 'costume', who: 'Evan', name: 'Costume protection / duplicate for the cream', note: 'Whatever he wears gets covered. Budget a second of it.', src: 'script' },
        { id: 'II.3-p4', cat: 'prop', name: 'Baseball, twine, glove oil — garage dressing', src: 'proposed' }
      ] },

    { id: 'II.4', act: 'II', sc: '4', pp: '69-72', when: 'Mon 8/10',
      loc: 'Evan\'s bedroom', songs: '"Only Us"',
      tech: 'Two performers alone; the projection world drops away for an isolation wash',
      cast: ['Evan', 'Zoe'],
      items: [
        { id: 'II.4-s1', cat: 'set', name: 'Evan\'s bedroom, stripped back', note: 'The projections go away here. That absence is the design.', src: 'script' }
      ] },

    { id: 'II.5', act: 'II', sc: '5', pp: '72-74', when: 'Mon 8/10',
      loc: 'School', songs: '(none)',
      tech: 'Revolving-door entrances; INTIMACY: public kiss and hand-hold',
      cast: ['Evan', 'Alana', 'Jared', 'Zoe'],
      items: [
        { id: 'II.5-s1', cat: 'set', name: 'School entrances for the revolving-door staging', note: 'Traffic problem more than a build problem. Needs enough openings.', src: 'script' },
        { id: 'II.5-p1', cat: 'prop', name: 'Backpacks and school dressing (continuing)', src: 'proposed' }
      ] },

    { id: 'II.6', act: 'II', sc: '6', pp: '74-78', when: 'Mon 8/10',
      loc: 'Murphy living room', songs: '(none)',
      tech: 'Longest five-hander; practical wine service; dense crosstalk; held silent button',
      cast: ['Larry', 'Cynthia', 'Heidi', 'Zoe', 'Evan'],
      items: [
        { id: 'II.6-s1', cat: 'set', name: 'Murphy living room, dressed for guests (continuing from I.9)', src: 'script' },
        { id: 'II.6-p1', cat: 'prop', name: 'Wine service: bottle, glasses, opener', note: 'PRACTICAL. Non-alcoholic substitute, and glasses that will not shatter on the deck.', qty: 6, src: 'script' },
        { id: 'II.6-p2', cat: 'prop', name: 'Non-alcoholic wine substitute', note: 'Consumable, one bottle per run.', qty: 12, src: 'script' },
        { id: 'II.6-c1', cat: 'costume', who: 'Heidi', name: 'Heidi dressed to visit the Murphys', note: 'She has tried. That is what makes the scene hurt.', src: 'proposed' }
      ] },

    { id: 'II.7', act: 'II', sc: '7', pp: '78-81', when: 'Tue 8/11',
      loc: 'Hansen living room → School', songs: '"Good for You"',
      tech: 'Mid-song location change; three performers converge and surround Evan',
      cast: ['Heidi', 'Evan', 'Alana', 'Jared'],
      items: [
        { id: 'II.7-s1', cat: 'set', name: 'Hansen living room', note: 'Must transform mid-number. Design the change, do not stage around it.', src: 'script' },
        { id: 'II.7-s2', cat: 'set', name: 'Mid-song transition to school', note: 'The hardest transition in Act II. Cued to music, not to a scene break.', src: 'script' }
      ] },

    { id: 'II.8', act: 'II', sc: '8', pp: '81-86', when: 'Tue 8/11',
      loc: 'Limbo / bedrooms / online / Murphy home',
      songs: '"For Forever (Reprise)"; "You Will Be Found (Reprise)"',
      tech: 'Full-stage projection of the letter; voices deliberately do NOT blend — distinct sound design',
      cast: ['Evan', 'Connor', 'Alana', 'Zoe', 'Cynthia', 'Larry', 'Company'],
      items: [
        { id: 'II.8-s1', cat: 'set', name: 'Full-stage projection of the letter', note: 'The letter becomes the set. Largest single projection cue in the show.', src: 'script' },
        { id: 'II.8-s2', cat: 'set', name: 'Limbo space — no room, no walls', note: 'Defined by light and projection only.', src: 'script' },
        { id: 'II.8-p1', cat: 'prop', name: 'Sound design: voices that deliberately do not blend', note: 'Design note, not a purchase, but it needs to be built and cued.', src: 'script' }
      ] },

    { id: 'II.9', act: 'II', sc: '9', pp: '86-95', when: 'Tue 8/11',
      loc: 'Murphy living room → Hansen living room → ORCHARD',
      songs: '"Words Fail"; "So Big/So Small"; "Finale"',
      tech: 'BIGGEST SCENIC MOMENT: full-stage orchard reveal, sky opens; staggered company entrance (quick changes); Connor\'s slow final fade; hard blackout',
      cast: ['Evan', 'Cynthia', 'Larry', 'Zoe', 'Heidi', 'Company'],
      items: [
        { id: 'II.9-s1', cat: 'set', name: 'THE ORCHARD REVEAL — full stage, sky opens', note: 'The single biggest scenic build in the show. Start it in week 1 and rehearse it as a mechanical unit before it ever carries an actor.', src: 'script' },
        { id: 'II.9-s2', cat: 'set', name: 'Hansen living room for "So Big/So Small"', note: 'Two people on a bed. After the orchard, the smallness is the effect.', src: 'script' },
        { id: 'II.9-s3', cat: 'set', name: 'Sky / cyc treatment for the opening', note: 'LX and scenic together. Confirm what the venue can actually hang.', src: 'proposed' },
        { id: 'II.9-c1', cat: 'costume', who: 'Company', name: 'Finale looks — staggered company entrance', note: 'QUICK CHANGES. Every ensemble track changes into this. Build the run sheet before tech, not during.', src: 'script' },
        { id: 'II.9-p1', cat: 'prop', name: 'Connor\'s final fade — practical or lighting solution', note: 'The last image of the show. Solve it early.', src: 'script' }
      ] }
  ]
};

/* Flattened for the dashboard: every item with its scene attached. */
window.DEHSCENES.allItems = (function () {
  var out = window.DEHSCENES.standing.map(function (it) {
    return Object.assign({}, it, { scene: 'Whole show', sceneId: 'ALL' });
  });
  window.DEHSCENES.scenes.forEach(function (s) {
    s.items.forEach(function (it) {
      out.push(Object.assign({}, it, { scene: 'Act ' + s.act + ' Sc ' + s.sc, sceneId: s.id }));
    });
  });
  return out;
})();
