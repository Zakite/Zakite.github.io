/* --------------------------------------------------------------------------
   pieces.js — which entries in the Writing list have a document behind them.

   This is the only file to edit when a piece becomes readable. Paste the
   Google Doc's id into `doc` and that entry turns into a link on the home
   page and renders at piece.html?id=<key>. Leave `doc` as null and the entry
   stays plain text, so an unwritten piece can never produce a dead link.

   The id is the long string in the document's own URL:
     docs.google.com/document/d/  1AbC...XyZ  /edit
                                  ^^^^^^^^^^ this part

   The document must be shared as "anyone with the link" -> **Viewer**. Viewer
   matters: this file is public, so the id is public, and anyone who reads the
   page can reach the document with whatever access the link grants. Viewer
   gives them the same read-only copy the page already shows them. Editor
   would let them rewrite it.

   `title` and `meta` are what the piece's own page shows in its header. They
   are kept here rather than scraped so the page has something to display
   while the document is still loading, and so a heading inside the document
   is not required to match the site.
-------------------------------------------------------------------------- */
window.PIECES = {
  'helical-sense': {
    doc: null,
    title: 'Cation Radius Selects Helical Sense in the Self-Assembly of an Achiral Nucleobase',
    meta: '2026 · In prep, JACS'
  },

  'mineral-succession': {
    doc: null,
    title: 'Mineral Succession in Pseudoalteromonas haloplanktis',
    meta: '2026 · In prep'
  },

  'micp-microplastic': {
    doc: null,
    title: 'MICP for Microplastic Sequestration Below the Biofouling Limit',
    meta: '2026 · In prep'
  },

  'finesst-guanine': {
    doc: null,
    title: "Guanine, Nature's First Chemical Engineer",
    meta: '2026 · NASA FINESST'
  },

  'before-the-biomineral': {
    doc: null,
    title: 'Before the Biomineral: How Ions Steer Guanine and Urate Self-Assembly',
    meta: '2026 · GRC Biomineralization'
  }
};
