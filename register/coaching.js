// College audition coaching catalog — the single source of truth for what the
// registration system shows under "Coaching".
//
// Prices, names, and descriptions were lifted from /coaching.html (and
// /press-submit.html for the August weekend) when coaching moved off the
// Regpack embed and into our own registration system on Jul 31 2026.
//
// The `id` on each service is its row id in the Supabase `activities` table
// (see db/coaching-activities.sql). /register/ checks the live catalog and
// only links a service to checkout once its row exists; anything missing
// falls back to an email booking link, so a half-seeded catalog still reads
// correctly to a parent.
//
// Coaching is priced flat: no sibling, tier, bundle, or combo discount, no
// tuition insurance, pay in full at checkout. reg-config.mjs enforces that
// server-side (COACHING_IDS).
window.NOVACOACHING = {
  // ids live in the 9701xx–9705xx block, grouped by section
  groups: [
    {
      key: 'season',
      title: 'Full Season Support',
      blurb: 'The whole audition year handled end to end, for students who want one plan and one team.',
      items: [
        {
          id: 970101,
          name: 'Full Audition Package Support',
          price: 325000,
          note: 'Approx. 30 hours of support across the season',
          desc: 'Everything a college audition season needs, from the first school list to the last submitted application. Includes six private coaching sessions, three filmed and edited pre-screen videos, dance pre-screen coaching, essay and artistic statement work, a finished resume, and a full mock audition. This is the most complete package we offer.',
          feats: [
            'Tailored college spreadsheet and GetAcceptd support',
            'Six 1-on-1 coaching sessions',
            'Three pre-screen videos, filmed and edited',
            'Audition room readiness and mock panel',
            'Industry standard resume creation',
            'Essay and artistic statement support',
            'Dance pre-screen coaching and filming'
          ]
        },
        {
          id: 970102,
          name: 'Press Submit Weekend',
          price: 169500,
          note: 'Final weekend of August · Leesburg, VA · 12 students',
          desc: 'Three days that take a student from nothing submitted to one application fully in. We film pre-screens for every school on the list, shoot professional headshots, coach essays and artistic statements, finish the resume and audition book, and run a parent workshop. Seats are capped at twelve and registration closes when it fills.',
          feats: [
            'Pre-screen filming for every school',
            'Professional headshots included',
            'Essay and artistic statement coaching',
            'Resume and audition book finalized',
            'Parent workshop and Q&A',
            'First application submitted live'
          ],
          more: '/press-submit.html'
        }
      ]
    },
    {
      key: 'services',
      title: 'Coaching Services',
      blurb: 'Individual pieces of the process. Take one, or build your own combination.',
      items: [
        {
          id: 970208,
          name: 'Consultation Session',
          price: 9000,
          note: '1 hour · in person or on Google Meet',
          desc: 'A full hour to map out where a student stands and what the season should look like. Useful when fifteen minutes is not going to cover it. The free 15-minute consult is always available first if you would rather start there.',
          feats: ['Where the student is now', 'What the season needs to look like', 'Which services actually fit']
        },
        {
          id: 970201,
          name: 'Tailored College Spreadsheet + GetAcceptd Support',
          price: 52500,
          note: '5–7 hours · highest return of any single service',
          desc: 'A college list built around one student, not pulled off a generic ranking. Every school comes with its deadlines, prescreen requirements, and acceptance rates in one tracker you actually use. Includes GetAcceptd setup and support through the submission window.',
          feats: [
            'Fully customized college program list',
            'Deadlines, requirements, and acceptance rates',
            'Organized application tracker included',
            'GetAcceptd setup and ongoing support'
          ]
        },
        {
          id: 970202,
          name: 'Audition Room Readiness',
          price: 39000,
          note: 'Full mock audition experience',
          desc: 'A real mock audition in front of a panel, run the way the schools run it. Slate, material, Q&A, and interview, then detailed written feedback the student can work from. The point is that audition day is not the first time it happens.',
          feats: ['Slate practice and material performance', 'Panel Q&A simulation', 'Interview prep', 'Detailed written feedback']
        },
        {
          id: 970203,
          name: 'Essay & Artistic Statement Support',
          price: 52500,
          note: 'Approx. 4 hours · up to 3 essays · 2 rounds of edits',
          desc: 'Help getting the Common App essay, school-specific prompts, and the artistic statement to sound like the student and not like a template. Up to three essays with two full rounds of edits on each.',
          feats: ['Common App essay support', 'School-specific prompts and artistic statements', 'Two full rounds of edits', 'Up to 3 essays per package']
        },
        {
          id: 970204,
          name: 'Audition Book Creation + Audition Package',
          price: 32500,
          note: 'Approx. 3–4 hours',
          desc: 'A school-ready audition binder built and organized so nothing goes missing on the day. Repertoire sheets, labeled cuts, and tabbed sections for each school on the list.',
          feats: ['Polished school-ready audition binder', 'Repertoire sheets and cut labels', 'School-specific tabbed sections', 'Everything organized for audition day']
        },
        {
          id: 970205,
          name: 'Industry Standard Resume Support & Creation',
          price: 19500,
          note: 'Approx. 2 hours · one full revision included',
          desc: 'A performing arts resume in the format college panels expect, built from what the student has actually done. One full revision round is included so it stays current through the season.',
          feats: ['Industry standard performing arts format', 'Tailored to college audition expectations', 'One full revision round included']
        },
        {
          id: 970206,
          name: 'Parent Support Session',
          price: 9000,
          note: '30 minutes, for the parent',
          desc: 'A session for the parent, not the student. We walk the timeline, what the next few months actually look like, and how to help without taking over. Families often book this again in the spring when decisions land.',
          feats: ['Process overview and timeline guidance', 'Emotional support navigation', 'Final decision strategy support']
        },
        {
          id: 970207,
          name: 'Single Session Support',
          price: 12000,
          note: 'per session · in person or on Google Meet',
          desc: 'One session on whatever is in front of the student right now. Material, a deadline, a school-specific requirement, or a nerve that needs settling. No package required.',
          feats: ['Any topic, any stage of prep', 'Flexible scheduling', 'In person or virtual via Google Meet']
        }
      ]
    },
    {
      key: 'prescreen',
      title: 'Pre-Screen Videos',
      blurb: 'Filmed, edited, and labeled the way each school asks for them.',
      items: [
        {
          id: 970301,
          name: 'Pre-Screen Video',
          price: 21900,
          note: '1 video + 1 coaching session',
          desc: 'One pre-screen package: a coaching session on the material, then a professionally filmed and edited take. Delivered labeled and ready to upload to the schools that want it.',
          feats: ['1 coaching session included', 'Professionally filmed and edited', 'Correctly labeled for your schools']
        },
        {
          id: 970302,
          name: 'Pre-Screen Videos (2)',
          price: 42500,
          note: '2 videos + coaching support',
          desc: 'Two complete pre-screen packages with coaching, filming, and editing included. Most schools ask for a song and a monologue, which is what this covers.',
          feats: ['2 complete pre-screen packages', 'Coaching, filming, and editing included', 'Correctly labeled for your schools']
        },
        {
          id: 970303,
          name: 'Pre-Screen Videos (3)',
          price: 60000,
          note: '3 videos + coaching support',
          desc: 'Three complete pre-screen packages with coaching, filming, and editing included. This is the usual answer for a musical theatre list: two contrasting songs and a monologue.',
          feats: ['3 complete pre-screen packages', 'Coaching, filming, and editing included', 'Correctly labeled for your schools']
        },
        {
          id: 970304,
          name: 'Pre-Screen Videos (4)',
          price: 79000,
          note: '4 videos + coaching support',
          desc: 'Four complete pre-screen packages with coaching, filming, and editing included. Built for wide lists where schools ask for different material from each other.',
          feats: ['4 complete pre-screen packages', 'Coaching, filming, and editing included', 'Correctly labeled for your schools']
        },
        {
          id: 970305,
          name: 'Dance Pre-Screen Video',
          price: 40000,
          note: 'Custom choreography + 2 hours of support + filming',
          desc: 'Custom choreography set on the student, two hours of coaching to get it in the body, then a professionally filmed and edited take. Labeled for whichever schools require a dance call on video.',
          feats: ['Custom choreography provided', '2 hours of coaching and teaching support', 'Professionally filmed, edited, and labeled']
        }
      ]
    },
    {
      key: 'acting',
      title: 'Acting Coaching Sessions',
      blurb: 'Private 50-minute sessions. The packs cost less per session the more you take.',
      items: [
        {
          id: 970401,
          name: '1 Acting Coaching Session',
          price: 12000,
          note: '50 minutes',
          desc: 'One private fifty minute session on a monologue or a song. We work technique and specificity, then how it reads in an audition room.',
          feats: ['Monologue or song work', 'Technique and specificity focus', 'Audition presentation coaching']
        },
        {
          id: 970402,
          name: '3-Pack Acting Coaching Sessions',
          price: 35000,
          note: '3 × 50 minutes · about $117 each',
          desc: 'Three private sessions at a slightly better rate than booking them one at a time. Sessions can be combined back to back when a deadline is close.',
          feats: ['3 private 50-minute sessions', 'Sessions combinable back to back', 'Better rate than the single session']
        },
        {
          id: 970403,
          name: '6-Pack Acting Coaching Sessions',
          price: 66000,
          note: '6 × 50 minutes · $110 each',
          desc: 'Six private sessions, enough to carry a student through a full audition cycle. Best per session rate short of the ten pack.',
          feats: ['6 private 50-minute sessions', 'Consistent support across the season', 'Better per-session rate than the 3-pack']
        },
        {
          id: 970404,
          name: '10-Pack Acting Coaching Sessions',
          price: 105000,
          note: '10 × 50 minutes · $105 each',
          desc: 'Ten private sessions and the lowest per session rate we offer. Room to build several pieces across styles, then revisit and sharpen them before audition day.',
          feats: ['10 private 50-minute sessions', 'Multiple pieces across styles and schools', 'Prepare, revisit, and perfect before audition day']
        }
      ]
    },
    {
      key: 'brand',
      title: 'Digital Presence & Brand Support',
      blurb: 'For students and working artists who need the professional side to match the work.',
      items: [
        {
          id: 970501,
          name: 'Logo Design',
          price: 35000,
          note: 'Includes intake and design delivery',
          desc: 'A custom logo built from an intake session about the artist and the work. Delivered as packaged files ready for a website, a headshot back, or a program.',
          feats: ['Brief intake session', 'Custom logo design', 'Packaged logo files delivered']
        },
        {
          id: 970502,
          name: 'Business Card Design + Logo Design',
          price: 52500,
          note: 'Logo + business card + branding packet',
          desc: 'A custom logo and a matching business card, delivered as one branding packet. What you hand across the table at a conference or a callback.',
          feats: ['Custom logo design', 'Business card design', 'Packaged branding packet included']
        },
        {
          id: 970503,
          name: 'Brand Evaluation + Social Media Support',
          price: 52500,
          note: 'Approx. 4 hours · 15 post templates included',
          desc: 'A full audit of how an artist currently reads online, refreshed bio copy, and a content strategy that fits the actual career. Fifteen ready to use post templates come with it.',
          feats: ['Full profile audit', 'Refreshed bio copy', 'Tailored content strategy', '15 ready-to-use post templates']
        },
        {
          id: 970504,
          name: 'Portfolio Website + Custom Domain',
          price: 129700,
          note: 'Up to 3 pages · custom domain · full handoff',
          desc: 'A portfolio site with bio, gallery, resume, reel, and contact, on a custom domain. Up to three pages, handed off in full so the artist can manage it after launch.',
          feats: ['Bio, gallery, resume, reel, and contact', 'Custom domain included', 'Up to 3 pages', 'Full handoff so you manage it yourself']
        },
        {
          id: 970505,
          name: 'Full Brand Package',
          price: 199700,
          note: 'Website + logo + business card + social media',
          desc: 'Everything on this list in one build: portfolio website, logo, business card, and social media strategy with templates. One visual identity that holds together across every platform.',
          feats: ['Custom portfolio website', 'Logo creation and branding packet', 'Business card design', 'Social media strategy and templates', 'Unified visual identity across all platforms']
        }
      ]
    }
  ]
};
window.NOVACOACHING.ids = window.NOVACOACHING.groups.reduce(function(a, g){
  return a.concat(g.items.map(function(it){ return it.id; }));
}, []);
