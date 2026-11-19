/* --------------------------------------------------------------------------
   pieces.js: which entries in the Writing list have something behind them.

   Each entry is either a document or a write-up. An entry with `abstract` is
   written here, in this file, and renders at piece.html?id=<key> with no
   fetch at all. An entry with a Google Doc id in `doc` renders that document
   live instead. An entry with neither stays plain text, so an unwritten piece
   can never produce a dead link.

   Unpublished work is written as a short project summary: the goal and the
   approach, and no results. Findings stay off the site until the work is
   published. Its `meta` says it is active. A talk keeps a conference abstract.
   Both use the same `abstract` field.

   Paste a Google Doc's id into `doc` to make an entry readable as a document:
     docs.google.com/document/d/  1AbC...XyZ  /edit
                                  ^^^^^^^^^^ this part

   The document must be shared as "anyone with the link" -> **Viewer**. Viewer
   matters: this file is public, so the id is public, and anyone who reads the
   page can reach the document with whatever access the link grants. Viewer
   gives them the same read-only copy the page already shows them. Editor
   would let them rewrite it.

   `abstract.body` is a list. A string is a paragraph; an object { h: '...' }
   is a section heading. Inside text, *asterisks* italicise and [text](url)
   makes a link. Text is always inserted as text, never as markup.

   `title` and `meta` are what the piece's own page shows in its header. They
   are kept here rather than scraped so the page has something to display
   while a document is still loading, and so a heading inside the document
   is not required to match the site.
-------------------------------------------------------------------------- */
window.PIECES = {
  'helical-sense': {
    doc: null,
    title: 'Cation Radius Selects Helical Sense in the Self-Assembly of an Achiral Nucleobase',
    meta: '2026 · Active project · JACS',
    abstract: {
      authors: 'Zakaria Jibrin',
      affiliation: 'Department of Earth and Planetary Sciences, Rutgers University, Piscataway, NJ',
      body: [
        { h: 'Goal' },
        'Establish whether an achiral nucleobase can acquire supramolecular handedness from the cation that templates its assembly, with no chiral input.',
        { h: 'Approach' },
        'Circular dichroism of guanine assemblies, compared across a series of cations.'
      ]
    }
  },

  'mineral-succession': {
    doc: null,
    title: 'Mineral Succession in *Pseudoalteromonas haloplanktis*',
    meta: '2026 · Active project',
    abstract: {
      authors: 'Zakaria Jibrin',
      affiliation: 'Department of Earth and Planetary Sciences, Rutgers University, Piscataway, NJ',
      body: [
        { h: 'Goal' },
        'Characterize the sequence of minerals that *Pseudoalteromonas haloplanktis* precipitates, and how each precipitation step changes the solution that the next one forms from.'
      ]
    }
  },

  'micp-microplastic': {
    doc: null,
    title: 'Microplastic Sequestration Below the Biofouling Limit',
    meta: '2026 · Active proposal',
    abstract: {
      authors: 'Zakaria Jibrin',
      affiliation: 'Department of Earth and Planetary Sciences, Rutgers University, Piscataway, NJ',
      body: [
        { h: 'Goal' },
        'Mineralize and settle microplastic particles that are too small for conventional biofouling-based sequestration, using microbially induced carbonate precipitation (MICP).'
      ]
    }
  },

  'before-the-biomineral': {
    doc: null,
    title: 'Before the Biomineral: How Ions Steer Guanine and Urate Self-Assembly',
    meta: '2026 · GRC Biomineralization',
    abstract: {
      authors: 'Zakaria Jibrin',
      affiliation: 'Department of Earth and Planetary Sciences, Rutgers University, Piscataway, NJ',
      body: [
        { h: 'Abstract' },
        'Using guanine as a model system, I investigate how cation identity and solution chemistry govern molecular self-assembly, beginning with ion-mediated G-wire formation and bundling. I then follow the development of these precursors into crystals through crystallization by particle attachment (CPA), followed by Ostwald ripening during crystal maturation. Parallel uric acid experiments serve as a comparative control. By isolating these processes in completely abiotic systems, I aim to identify fundamental mechanisms of particle assembly and crystal maturation with potential relevance across diverse biomineral systems.'
      ]
    }
  },

  'mineral-redox-atlas': {
    doc: null,
    title: 'The Mineral Redox Atlas',
    meta: '2026 · Active proposal',
    abstract: {
      authors: 'Zakaria Jibrin',
      affiliation: 'Department of Earth and Planetary Sciences, Rutgers University, Piscataway, NJ',
      body: [
        { h: 'Goal' },
        'Build a standardized, mineral-centric thermodynamic database and calculator that connects mineral identity to reaction energetics, giving mineralogy and microbial bioenergetics a common thermodynamic basis.',
        { h: 'Approach' },
        'Compile phase-specific thermodynamic properties from experimental measurements and established databases, treating polymorphs as distinct phases. A standard oxidation and reduction convention defines reference reactions for each mineral. Users pick a mineral, an electron donor or acceptor and a product, and the calculator balances the reaction and returns its Gibbs free-energy change under chosen temperature, pressure, pH and activities.',
        { h: 'Applications' },
        'Microbial bioenergetics, mineral evolution and geochemistry, and biomineralization and astrobiology.',
        'A working version is live: [Mineral Redox Calculator](redox.html).'
      ]
    }
  }
};
