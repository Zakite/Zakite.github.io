/* minerals.js - which formation energy is used for a mineral.
 *
 * The engine (engine.js) turns one species with a formation energy into a redox value. This file decides which
 * species that is, for every name on the IMA list:
 *   1. a measured value under that name, if the database entry has the mineral's ideal formula   (lookup, sameCompound, oneFor)
 *   2. a measured value of the same mineral at another water content or a nearby composition,
 *      brought to the ideal formula                                                              (oneFor)
 *   3. the measured value of another mineral with the same formula                               (fallback)
 *   4. an estimate from the formula                                                              (fallback, estimator.js)
 * resolve() makes that choice for a list of names and evaluate() runs the engine on the result. Nothing in this
 * file touches the web page: the same code runs on its own under Node (tests/make_table.js).
 */
(function (root) {
  "use strict";
  var MR = root.MineralRedox;
  // Everything read from the data files, and the conditions of the calculation.
  var S = { base: [], user: [], db: [], water: null, elements: [], byName: Object.create(null), byBase: Object.create(null), pH: 7, solutes: 1,
            model: null, lib: [], libByName: Object.create(null), libByBase: Object.create(null), libByComp: Object.create(null),
            cross: Object.create(null), ima: Object.create(null), imaList: [], imaExtra: [] };

  // ------------------------------------------------------------- names
  // Published databases the second tier of measured values is read from (see How it is calculated).
  var DB_NAMES = { Thermoddem: "Thermoddem V1.10 (Blanc et al. 2012)", ThermoChimie: "ThermoChimie v10a (Giffaut et al. 2014)",
                   SUPCRTBL: "SUPCRTBL (Zimmer et al. 2016, minerals of Holland & Powell 2011)", MINES16: "MINES database, 2016 version (Gysi 2017)",
                   AQ17: "AQ17 (Miron et al. 2017, minerals of Holland & Powell 1998)", SUPCRT16: "SUPCRT slop16 file (Johnson et al. 1992 and updates)",
                   SUPCRT92: "SUPCRT92 minerals (Helgeson et al. 1978)", LLNL: "LLNL thermo.com.V8.R6.230 (llnl.dat of PHREEQC)",
                   HERACLES: "HERACLES database (Paul Scherrer Institut)", WATEQ4F: "WATEQ4F (Ball & Nordstrom 1991)", MINTEQ: "MINTEQA2 version 4 (US EPA)",
                   "CRC Handbook": "CRC Handbook of Chemistry and Physics" };
  // Spellings a mineral list may use, mapped to the name the database uses for the same phase.
  var ALIASES = { baryte: "barite", celestine: "celestite", titanite: "sphene", sulphur: "sulfur",
                  lollingite: "loellingite", hubnerite: "huebnerite", bohmite: "boehmite", mercury: "quicksilver",
                  aluminium: "aluminum", hydroxylapatite: "hydroxyapatite", clinoenstatite: "enstatite,clino",
                  protoenstatite: "enstatite,proto", cobaltpentlandite: "Co-pentlandite", "bixbyite(mn)": "bixbyite" };
  var LETTERS = { "\u03b1": "alpha", "\u03b2": "beta", "\u03b3": "gamma", "\u03b4": "delta", "\u00df": "ss", "\u00f8": "o", "\u00d8": "O",
    "\u0142": "l", "\u0141": "L", "\u0111": "d", "\u00e6": "ae", "\u0153": "oe", "\u2032": "", "'": "", "\u2019": "" };
  function plain(t) {            // a name in plain letters: Achavalite for Ach\u00e1valite, Domeykite-beta for Domeykite-\u03b2
    return String(t).replace(/[\u03b1-\u03b4\u00df\u00f8\u00d8\u0142\u0141\u0111\u00e6\u0153\u2032'\u2019]/g, function (ch) { return LETTERS[ch]; })
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function norm(t) {
    return plain(t).toLowerCase().replace(/[\s_\-()]+/g, "");
  }
  function count(v) { return String(parseFloat(v.toPrecision(3))); }
  function cond() { return new MR.Conditions(S.elements.length ? S.db.concat(S.elements) : S.db, S.water, S.pH, S.solutes); }
  function byG(list) { return list.slice().sort(function (a, b) { return a.G - b.G; }); }
  // ------------------------------------- measured values from the other databases
  function compKey(comp) {
    var els = Object.keys(comp).sort(), n = 0;
    els.forEach(function (e) { n += comp[e]; });
    return els.map(function (e) { return e + (comp[e] / n).toFixed(4); }).join("|");
  }
  function atomsOf(comp) { return Object.keys(comp).reduce(function (a, e) { return a + comp[e]; }, 0); }
  function sortLib(list) {   // critically evaluated sources first, then the most stable per atom
    return list.slice().sort(function (a, b) {
      return (b.lib.evaluated - a.lib.evaluated) || (a.G / atomsOf(a.comp) - b.G / atomsOf(b.comp));
    });
  }

  // -------------------------------------------- reading the data files
  function table(text) {            // a CSV file with a header line, as a list of { column: value }; lines that start with # are notes
    var lines = String(text || "").split(/\r?\n/).filter(function (l) { return l && l.charAt(0) !== "#"; });
    var head = lines.length ? MR.splitCSVLine(lines[0]) : [];
    return lines.slice(1).map(function (line) { var f = MR.splitCSVLine(line), row = {}; head.forEach(function (h, i) { row[h] = f[i]; }); return row; });
  }
  function loadLibrary(text) {            // measured_library.csv: measured values from the databases other than the base one
    table(text).forEach(function (f) {
      var sp;
      try { sp = MR.makeSpecies(f.name, f.formula, "cr", parseFloat(f.dGf_kJ_mol), f.database, "", ""); }
      catch (e) { return; }
      if (!isFinite(sp.G)) return;
      sp.lib = { u: parseFloat(f.uncertainty_kJ_mol), db: f.database, n: parseInt(f.databases, 10),
                 ind: parseInt(f.independent_values, 10), lo: parseFloat(f.range_low_kJ), hi: parseFloat(f.range_high_kJ),
                 evaluated: f.evaluated === "yes", conversion: f.conversion || "", note: f.source_note || "", all: f.all_values || "" };
      sp.citation = (DB_NAMES[sp.lib.db] || sp.lib.db) + (sp.lib.conversion ? "; " + sp.lib.conversion : "") + (sp.lib.note ? "; " + sp.lib.note : "");
      S.lib.push(sp);
      var k = norm(sp.name), b = norm(sp.name.split(/[,(\[]/)[0]), c = compKey(sp.comp);
      (S.libByName[k] = S.libByName[k] || []).push(sp);
      if (b && b !== k) (S.libByBase[b] = S.libByBase[b] || []).push(sp);
      (S.libByComp[c] = S.libByComp[c] || []).push(sp);
    });
  }
  function loadIma(text) {            // ima_minerals.csv: name, approved formula, the formula computed, oxidation states, note
    S.ima = Object.create(null); S.imaList = [];
    String(text || "").split(/\r?\n/).slice(1).forEach(function (line) {
      if (!line) return;
      var c = MR.splitCSVLine(line), e = { name: c[0], ima: c[1], formula: c[2], states: c[3] || "", note: c[4] || "" };
      if (!e.name) return;
      e.older = /older name/.test(e.note);            // a name the current IMA list no longer carries
      if (!e.older || !S.ima[norm(e.name)]) S.ima[norm(e.name)] = e;
      S.imaList.push(e);
    });
  }
  function loadCross(text) {            // base_crosscheck.csv: what the other databases say about a mineral of the base database
    table(text).forEach(function (f) {
      var u = parseFloat(f.uncertainty_kJ_mol);
      if (!isFinite(u)) return;
      S.cross[f.mineral] = { u: u, n: parseInt(f.databases_listing_it, 10), ind: parseInt(f.independent_values, 10),
                             shift: parseFloat(f.that_value_minus_base_kJ), from: f.from_database };
    });
  }
  function crossOf(sp) { return sp.ref !== "user" && sp.ref !== "moved" && !sp.lib && sp.state === "cr" ? S.cross[sp.name] : null; }
  // The database in use: the base database, with any values added by hand on this page in place of the entries they replace.
  function index() {
    var over = Object.create(null);
    S.user.forEach(function (u) { over[norm(u.sp.name)] = true; });
    S.db = S.base.filter(function (s) { return !(s.state === "cr" && over[norm(s.name)]); })
      .concat(S.user.map(function (u) { return u.sp; }));
    S.byName = Object.create(null); S.byBase = Object.create(null);
    S.db.forEach(function (s) {
      if (s.state !== "cr") return;
      var k = norm(s.name), b = norm(s.name.split(",")[0]);
      (S.byName[k] = S.byName[k] || []).push(s);
      (S.byBase[b] = S.byBase[b] || []).push(s);
    });
    S.imaExtra = S.imaList.filter(function (e) { var k = norm(e.name); return !S.byName[k] && !S.libByName[k]; });
  }

  // -------------------------------- finding a mineral in the databases
  function imaFind(text) {            // an IMA entry by name; also Oldsite for Oldsite-(K), and a name with its polytype suffix
    var k = norm(text), e = S.ima[k];
    if (e || !k) return e;
    var stem = norm(String(text).replace(/-[A-Z]?\d[A-Za-z0-9]*$/, ""));
    if (stem !== k && S.ima[stem]) return S.ima[stem];
    var hits = S.imaList.filter(function (x) { return x.name.indexOf("-(") > 0 && norm(x.name.slice(0, x.name.indexOf("-("))) === k; });
    return hits.length === 1 ? hits[0] : undefined;
  }
  // Find a mineral by name, formula, alternative spelling, or the part of a name before a comma.
  function lookup(text) {
    text = String(text || "").trim();
    var out = { hits: [], by: "", readable: false, error: "" };
    if (!text) return out;
    try {
      var hits = MR.find(S.db, text).filter(function (h) { return !/_liq$/.test(h.name); });      // liquid sulfur is not a mineral
      out.readable = true;
      if (hits.length) {
        var bare = text.replace(/\((aq|g|gas|cr|s|liq|l)\)$/i, "").trim().toLowerCase();
        out.hits = hits;
        out.by = hits.some(function (h) { return h.name.toLowerCase() === bare; }) ? "name" : "formula";
        if (out.by === "formula" && hits[0].state === "cr") {      // minerals of the same formula in the other databases
          var more = S.libByComp[compKey(hits[0].comp)];
          if (more) out.hits = hits.concat(sortLib(more));
        }
        return out;
      }
    } catch (err) { out.error = err.message; }
    var key = norm(text), alias = Object.prototype.hasOwnProperty.call(ALIASES, key) ? norm(ALIASES[key]) : null;
    if (alias && S.byName[alias]) { out.hits = byG(S.byName[alias]); out.by = "synonym"; }
    else if (S.byName[key]) { out.hits = byG(S.byName[key]); out.by = "name"; }
    else if (S.byBase[key]) { out.hits = byG(S.byBase[key]); out.by = "name"; }
    if (!out.hits.length && S.lib.length) {                        // not in the base database: the other databases
      var named = S.libByName[key] || (alias && S.libByName[alias]);
      if (named) { out.hits = sortLib(named); out.by = "name"; }
      else if (out.readable) {
        try { var same = S.libByComp[compKey(MR.parseFormula(text).comp)]; if (same) { out.hits = sortLib(same); out.by = "formula"; } }
        catch (e) { /* not a formula after all */ }
      }
      if (!out.hits.length && S.libByBase[key]) { out.hits = sortLib(S.libByBase[key]); out.by = "name"; }
    }
    return out;
  }
  // A database entry is used for an IMA mineral of the same name only if it is that compound. Petrological databases reuse
  // mineral names for other phases (their "hollandite" is KAlSi3O8), and some list a simpler or drier formula.
  var REE = { La: 1, Ce: 1, Pr: 1, Nd: 1, Sm: 1, Eu: 1, Gd: 1, Tb: 1, Dy: 1, Ho: 1, Er: 1, Tm: 1, Yb: 1, Lu: 1, Y: 1 };
  function heavyOf(comp) {
    var o = {}, tot = 0;
    Object.keys(comp).forEach(function (e) { if (e === "O" || e === "H") return; var k = REE[e] ? "REE" : e; o[k] = (o[k] || 0) + comp[e]; tot += comp[e]; });
    Object.keys(o).forEach(function (k) { o[k] /= tot || 1; });
    return o;
  }
  function imaComp(e) {
    if (e._comp === undefined) {
      try { e._comp = MR.parseFormula(e.formula).comp; } catch (err) { e._comp = null; }
      var all = function (text) { var o = {}; (text.match(/[A-Z][a-z]?/g) || []).forEach(function (x) { o[REE[x] ? "REE" : x] = 1; }); return o; };
      e._allowed = all(e.ima);
      if (/REE|Ln/.test(e.ima)) e._allowed.REE = 1;
      var core = e.ima, before;                      // what is left when every mixed site "(A,B)" is taken out: the elements the mineral must have
      do { before = core; core = core.replace(/\([^()\[\]{}]*,[^()\[\]{}]*\)|\[[^()\[\]{}]*,[^()\[\]{}]*\]|\{[^()\[\]{}]*,[^()\[\]{}]*\}/g, " "); } while (core !== before);
      core = core.replace(/\(\?\)|\[[^\]]*[<>≈=][^\]]*\]|\([^)]*[<>≈=][^)]*\)/g, " ")
        .replace(/[A-Z][a-z]?(?:\d[+\-])?(?=(?:\d*\.?\d*[\-+])?\d*\.?\d*[xyzn](?![a-z]))/g, " ")              // an amount that depends on x can be zero
        .replace(/[A-Z][a-z]?(?:\d[+\-])?(?=0(?:\.0+)?-\d|\d*\.?\d+-0(?:\.0+)?(?!\d))/g, " ");                 // so can a range that reaches zero
      e._must = all(core);
    }
    return e._comp;
  }
  function sameCompound(sp, e) {
    var B0 = imaComp(e);
    if (!B0) return true;
    var A = heavyOf(sp.comp), B = heavyOf(B0), fixed = function (k) { return k === "REE" || k in MR.FIXED; };
    if (!Object.keys(A).length || !Object.keys(B).length) return Object.keys(A).length === Object.keys(B).length;
    if (!!sp.comp.O !== !!B0.O) return false;                         // an oxide is not a chloride
    var strayFixed = 0, strayFree = 0, lostFree = 0, lostMust = 0, k;
    for (k in A) if (!e._allowed[k]) { if (fixed(k)) strayFixed += A[k]; else strayFree += A[k]; }
    for (k in B) if (!(k in A)) {
      if (!fixed(k)) lostFree += B[k];                                   // an element that can change oxidation state is missing
      else if (e._must[k]) lostMust += B[k];                             // an element the mineral must have is missing
    }
    return strayFree < 0.01 && strayFixed < 0.05 && lostFree < 0.03 && lostMust < 0.12;
  }
  // Hits for a name that is also an IMA mineral: only those that are that mineral.
  function imaHits(text, r) {
    var e = imaFind(text);
    if (!e || !e.formula || !r.hits.length || r.by === "formula") return null;
    var keep = r.hits.filter(function (h) { return sameCompound(h, e); });
    if (keep.length === r.hits.length) return null;
    var dropped = r.hits.filter(function (h) { return keep.indexOf(h) < 0; });
    r.hits = keep;
    return dropped;
  }

  // --------------------------------------------- one entry per mineral
  // One value per mineral, for its ideal IMA formula. A database can list a mineral several times: other compositions of a
  // solid solution, a natural and a synthetic sample, two forms of the same formula. The entry with the ideal composition is
  // used as it stands (the first of them in database order: base database, then evaluated sources, then the most stable).
  // If the nearest entry is only close, its measured value is moved to the ideal formula: the measured value keeps its own
  // offset from the formula model, and the model supplies the difference between the two formulas. Tested on measured
  // pairs of the same mineral (tests/move_test.js): 68% within 9 kJ/mol when under 0.05 apart, within 20 up to 0.2 apart.
  // Farther apart the move does worse than a fresh estimate, so the ideal formula is then estimated on its own.
  var SAME = 0.002, NEAR = 0.05, FAR = 0.2, MOVE_NEAR = 9, MOVE_FAR = 20;
  function apart(a, b) {            // summed difference of atom fractions: 0 for the same formula, 2 for nothing in common
    var na = atomsOf(a), nb = atomsOf(b), d = 0, k;
    for (k in a) d += Math.abs(a[k] / na - (b[k] || 0) / nb);
    for (k in b) if (!(k in a)) d += b[k] / nb;
    return d;
  }
  // Two formulas that differ only in water: how much water the second has over the first, and the scale between their formula units.
  function waterOnly(from, to) {
    var ha = 0, hb = 0, k;
    for (k in from) if (k !== "H" && k !== "O") ha += from[k];
    for (k in to) if (k !== "H" && k !== "O") hb += to[k];
    if (!ha || !hb) return null;
    var sc = hb / ha;
    for (k in from) if (k !== "H" && k !== "O" && Math.abs(from[k] * sc - (to[k] || 0)) > 1e-3 * hb) return null;
    for (k in to) if (k !== "H" && k !== "O" && !(k in from)) return null;
    var dH = (to.H || 0) - sc * (from.H || 0), dO = (to.O || 0) - sc * (from.O || 0);
    return Math.abs(dH - 2 * dO) < 1e-3 * hb ? { n: dO, scale: sc } : null;
  }
  function oneFor(e, hits) {
    var ideal = imaComp(e), M = root.MineralEstimator;
    if (!ideal || !hits.length) return { sp: hits[0], basis: "" };
    var best = null, bd = Infinity;
    hits.forEach(function (h) { var d = apart(h.comp, ideal); if (d < SAME && bd >= SAME || d < bd - 1e-9 && d >= SAME) { bd = d; best = h; } });
    if (bd < SAME) return { sp: best, basis: "" };
    var rec = recipeOf(e.states), hints = rec ? rec.hints : e.states || null, was = best.name + " (" + best.formula + ")";
    // A value that came from a solubility constant does not depend on how much water is written into the formula (water is
    // the solvent), so an entry that differs from the ideal formula only in water is exact once that water is added as liquid water.
    var wet = null, wfrom = null;
    if (!rec) hits.some(function (h) {
      var w = h.lib && /^from log K/.test(h.lib.conversion) ? waterOnly(h.comp, ideal) : null;
      if (w) { wet = w; wfrom = h; }
      return !!w;
    });
    if (wet) {
      return { sp: attachStates(MR.makeSpecies(e.name, e.formula, "cr", wfrom.G * wet.scale + wet.n * S.water.G, "moved",
                 "measured solubility of " + wfrom.name + " (" + wfrom.formula + "), with the water of the ideal formula counted as liquid water", ""), hints),
               basis: "moved", how: "water", from: wfrom, u: wfrom.lib.u * wet.scale, flags: [] };
    }
    if (bd < FAR && S.model && M && !rec) {            // a hand recipe on the mineral's own row comes before a moved value
      var a = null, b = null;
      try { a = M.estimate(best.formula, best.comp, S.model, null); b = M.estimate(e.formula, ideal, S.model, hints); } catch (err) { a = b = null; }
      if (a && b && a.dG !== null && b.dG !== null && a.cls !== "element" && b.cls !== "element") {
        var G = (best.G - a.dG) * atomsOf(ideal) / atomsOf(best.comp) + b.dG;
        var own = best.lib ? best.lib.u : crossOf(best) ? crossOf(best).u : 0;
        return { sp: attachStates(MR.makeSpecies(e.name, e.formula, "cr", G, "moved", "measured value of " + was + ", moved to the ideal formula with the formula model", ""), hints),
                 basis: "moved", from: best, u: Math.max(own || 0, bd < NEAR ? MOVE_NEAR : MOVE_FAR), flags: [] };
      }
    }
    var fb = fallback(e.name, e.formula, e.states);
    if (fb.sp) {
      fb.flags = (fb.flags || []).concat([rec ? "the database entry for " + best.formula + " was not used, as its note says"
        : "the databases list this mineral as " + best.formula + ", too far from the ideal formula to carry its measured value over, so that value was not used"]);
      return { sp: fb.sp, basis: fb.basis, u: fb.u, flags: fb.flags, twin: fb.twin, fb: fb };
    }
    return { sp: best, basis: "", flags: ["the database formula " + best.formula + " is not the ideal formula " + e.formula + ", which could not be estimated"] };
  }

  // --------------------------- when nothing is measured under the name
  function oxalates(formula) {            // oxalate groups per formula unit: what the formula has with the C2O4 groups, minus what it has without them
    try {
      var all = MR.makeSpecies("x", formula, "cr", 0).comp.C || 0, rest = formula.replace(/\(C2O4\)/g, "(O4)").replace(/C2O4/g, "O4");
      return (all - (MR.makeSpecies("x", rest, "cr", 0).comp.C || 0)) / 2;
    } catch (e) { return 0; }
  }
  function attachStates(sp, hints) {            // oxidation states read from the IMA formula
    var h = hints && root.MineralEstimator ? root.MineralEstimator.parseHints(hints) : null;
    if (h && !h.organic && !h.reduced && !h.unbalanced && !h.nostate && Object.keys(h.states).length) { sp.states = h.states; sp.nh4 = h.nh4; }
    else if (h && h.organic && !h.reduced && !h.unbalanced && !h.nostate) {       // an oxalate: its carbon is +3
      var ox = (sp.formula.match(/C2O4/g) || []).length ? oxalates(sp.formula) : 0;
      if (ox > 0 && Math.abs((sp.comp.C || 0) - 2 * ox - (h.states["C4+"] || 0)) < 1e-6) {
        sp.states = Object.assign({}, h.states); sp.states["C3+"] = 2 * ox; sp.nh4 = h.nh4;
      }
    }
    return sp;
  }
  // What a mineral would do, worked out from its formula alone: with a formation energy far too
  // high to be its own end state, the products and the electron count depend only on composition.
  function shapeOf(label, formula) {
    try {
      var sp = MR.makeSpecies(label, formula, "cr", 1e7, "none", "", "");
      var c = cond(), ox = c.equilibrate(sp, c.E_O2), red = c.equilibrate(sp, c.E_H2);
      return { fuel: ox.n > 0 ? ox.n : 0, oxidant: red.n < 0 ? -red.n : 0, inert: ox.n === 0 && red.n === 0 };
    } catch (err) { return null; }
  }
  // Where no measured value exists: the measured value of a mineral with the same formula stands
  // in, and failing that the formula-based estimate. The species made here is used only in its
  // own calculation; it never enters the database, so it cannot become a product elsewhere.
  // A hand recipe on a mineral's own row of the list, for the few kinds no model covers: "parts=TiO*3|Ti*7|Fe*3;pm=300" values it
  // as a sum of measured compounds (elements count zero; ions, gases and water at their own energies). REST sends whatever is
  // left of the formula to the formula model. pm is the give-or-take in kJ/mol, set by hand with the recipe.
  function recipeOf(hints) {
    var m = /(?:^|;)parts=([^;]+)/.exec(hints || ""), u = /(?:^|;)pm=([\d.]+)/.exec(hints || "");
    var d = /(?:^|;)dG=(-?[\d.]+)/.exec(hints || "");      // dG=: a formation energy worked out by hand from a measured heat of formation
    if (!m && !d) return null;
    return { parts: m ? m[1].split("|").map(function (t) { var q = t.split("*"); return [q[0], q.length > 1 ? parseFloat(q[1]) : 1]; }) : [],
             dG: d ? parseFloat(d[1]) : null,
             pm: u ? parseFloat(u[1]) : 100, hints: hints.replace(/(?:^|;)(?:parts|pm|dG)=[^;]*/g, "").replace(/^;/, "") };
  }
  function partOf(text) {
    if (/^([A-Z][a-z]?|N2|H2|O2)$/.test(text)) return { G: 0, comp: MR.parseFormula(text).comp, name: text };
    var hits = [], ion = /[+-]\d*$/.test(text);
    try { hits = MR.find(S.db, text); } catch (e) { hits = []; }
    if (ion) hits = hits.filter(function (t) { return t.state === "aq" && t.formula === text; });
    else if (text === "H2O") hits = S.db.filter(function (t) { return t.formula === "H2O" && t.state !== "gas" && t.state !== "aq" && t.state !== "cr"; });
    else if (!/\)$/.test(text) || /\)\d*$/.test(text) && !/\((aq|g|gas|cr|s|liq|l)\)$/i.test(text)) {
      hits = hits.filter(function (t) { return t.state === "cr"; }).sort(function (a, b) { return a.G - b.G; });
      if (!hits.length) { try { var lib = S.libByComp[compKey(MR.parseFormula(text).comp)]; if (lib) hits = sortLib(lib); } catch (e) { hits = []; } }
    }
    return hits.length ? { G: hits[0].G, comp: hits[0].comp, name: text } : null;
  }
  function fallback(name, formula, hints) {
    var out = { sp: null, basis: "", u: null, flags: [], reason: "", twin: "", shape: null, formula: formula };
    var parsed, label = name || formula;
    try { parsed = MR.parseFormula(formula); } catch (err) { out.reason = "the formula " + formula + " could not be read"; return out; }
    var rec = recipeOf(hints);
    if (rec) hints = rec.hints;
    var twins = [];
    try { twins = MR.find(S.db, formula).filter(function (t) { return t.state === "cr"; }); } catch (e) { twins = []; }
    if (!twins.length && S.libByComp[compKey(parsed.comp)]) twins = sortLib(S.libByComp[compKey(parsed.comp)]);
    if (twins.length) {
      var atoms = atomsOf;
      var G = twins[0].G * atoms(parsed.comp) / atoms(twins[0].comp);
      out.sp = attachStates(MR.makeSpecies(label, formula, "cr", G, "stand-in", "measured value of " + twins[0].name + ", which has the same formula", ""), hints);
      out.basis = "proxy"; out.twin = twins[0].name;
      out.u = S.model ? S.model.uncertainty.polymorph.p68 : 12.4;
      return out;
    }
    if (rec && rec.dG !== null) {
      out.sp = attachStates(MR.makeSpecies(label, formula, "cr", rec.dG, "estimate", "formation energy worked out by hand from published numbers, not measured", ""), hints);
      out.basis = "estimate"; out.u = rec.pm;
      out.flags = ["low confidence: formation energy worked out by hand from published numbers, as its note says"];
      return out;
    }
    if (rec) {
      var sum = 0, left = {}, said = [], bad = "", restU = 0;
      Object.keys(parsed.comp).forEach(function (e) { left[e] = parsed.comp[e]; });
      rec.parts.forEach(function (q) {
        if (q[0] === "REST" || bad) return;
        var part = partOf(q[0]);
        if (!part) { bad = "a building block of its recipe was not found: " + q[0]; return; }
        sum += q[1] * part.G; said.push((Math.abs(q[1] - 1) < 1e-9 ? "" : MR.g4(q[1]) + " ") + part.name);
        Object.keys(part.comp).forEach(function (e) { left[e] = (left[e] || 0) - q[1] * part.comp[e]; });
      });
      Object.keys(left).forEach(function (e) { if (Math.abs(left[e]) < 1e-6) delete left[e]; });
      if (!bad && rec.parts.some(function (q) { return q[0] === "REST"; })) {
        var re = S.model && root.MineralEstimator ? root.MineralEstimator.estimate("", left, S.model, rec.hints || null) : null;
        if (!re || re.dG === null) bad = "the rest of its recipe could not be estimated";
        else { sum += re.dG; restU = re.uncertainty || 0; said.push("the rest of the formula by the formula model"); }
      } else if (!bad && Object.keys(left).length) bad = "its recipe does not add up to the formula (" + Object.keys(left).join(", ") + " left over)";
      if (bad) { out.reason = bad; out.shape = shapeOf(label, formula); return out; }
      out.sp = attachStates(MR.makeSpecies(label, formula, "cr", sum, "estimate", "valued as a sum of measured compounds, not measured", ""), hints);
      out.basis = "estimate"; out.u = Math.sqrt(rec.pm * rec.pm + restU * restU);
      out.flags = ["low confidence: no model covers this kind of mineral, so it is valued as the sum of " + said.join(" + ") + ", with nothing added for combining them"];
      return out;
    }
    if (S.model && root.MineralEstimator) {
      var est = root.MineralEstimator.estimate(formula, parsed.comp, S.model, hints || null);
      if (est.cls === "element") {
        out.sp = MR.makeSpecies(label, formula, "cr", 0, "element", "element in its reference state, formation energy zero by definition", "");
        out.basis = "element"; out.u = 0;
        return out;
      }
      if (est.dG !== null) {
        out.sp = attachStates(MR.makeSpecies(label, formula, "cr", est.dG, "estimate", "estimated from the formula, not measured", ""), hints);
        out.basis = "estimate"; out.u = est.uncertainty; out.flags = est.flags; out.est = est;
        return out;
      }
      out.reason = est.status.replace(/^(not covered|no estimate): /, "");
    } else {
      out.reason = "the estimator did not load";
    }
    out.shape = shapeOf(label, formula);
    return out;
  }

  // ------------------------------- a list of names to a list of values
  // Every name or formula on a list becomes one row: which species is computed, and on what basis. This is the whole
  // decision behind a published value; evaluate() below then runs the engine on each row.
  function resolve(entries) {
    var rows = [];
    entries.forEach(function (e) {
      if (e.problem) { rows.push({ input: e.input, status: "not computed", reason: e.problem }); return; }
      if (e.sp) { rows.push({ input: e.input, sp: e.sp, by: "added by hand", basis: "measured" }); return; }
      var key = e.name || e.formula, r = lookup(key), other = imaHits(key, r);
      var e1 = r.hits.length && r.by !== "formula" && !(e.name && e.formula && e.formula !== e.name) ? imaFind(key) : null;
      if (e1 && e1.formula) {                    // an IMA mineral: one row, for its ideal formula
        var one = oneFor(e1, r.hits), sp1 = one.sp, f1 = one.flags || [];
        if (e1.note && r.hits.indexOf(sp1) < 0) f1 = f1.concat(["IMA formula " + e1.ima + ": " + e1.note]);
        rows.push(one.basis === "moved" ? { input: e.input, sp: sp1, by: "moved", basis: "moved", how: one.how, u: one.u, flags: f1, from: one.from }
          : one.basis ? { input: e.input, sp: sp1, by: one.basis === "proxy" ? "same formula" : "formula estimate", basis: one.basis, u: one.u, flags: f1, twin: one.twin }
          : sp1.lib ? { input: e.input, sp: sp1, by: r.by, basis: "library", u: sp1.lib.u, flags: f1, show: e1.formula }
          : { input: e.input, sp: sp1, by: r.by, basis: "measured", u: crossOf(sp1) ? crossOf(sp1).u : undefined, flags: f1, show: e1.formula });
        return;
      }
      if (r.hits.length) {
        r.hits.forEach(function (sp) {
          rows.push(sp.lib ? { input: e.input, sp: sp, by: r.by, basis: "library", u: sp.lib.u }
            : { input: e.input, sp: sp, by: r.by, basis: "measured", u: crossOf(sp) ? crossOf(sp).u : undefined });
        });
        return;
      }
      var named = e.name && e.formula && e.formula !== e.name;
      var ima = named ? null : imaFind(key);
      if (ima && !ima.formula) { rows.push({ input: e.input || ima.name, status: "no data", reason: (ima.note || "IMA formula could not be read") + ": " + ima.ima }); return; }
      var formula = named ? e.formula : ima ? ima.formula : (r.readable ? key : "");
      if (!formula) { rows.push({ input: e.input, status: "no data", reason: "name not in the database and no formula given" }); return; }
      var fb = fallback(named ? e.name : ima ? ima.name : "", formula, ima ? ima.states : null);
      if (ima && ima.note && fb.sp) fb.flags = (fb.flags || []).concat(["IMA formula " + ima.ima + ": " + ima.note]);
      if (other && other.length && fb.sp) fb.flags = (fb.flags || []).concat(["the databases list " + other[0].name + " as " + other[0].formula + ", which is not the IMA mineral, so that value was not used"]);
      if (fb.sp) {
        rows.push({ input: e.input, sp: fb.sp, by: fb.basis === "proxy" ? "same formula" : "formula estimate", basis: fb.basis, u: fb.u, flags: fb.flags, twin: fb.twin });
      } else if (fb.shape && fb.shape.inert) {
        rows.push({ input: e.input, status: "computed", inertOnly: true, basis: "inert", formula: formula });
      } else {
        rows.push({ input: e.input, status: "no data", reason: fb.reason + (fb.shape ? "; from its formula it is " +
          (fb.shape.fuel ? "a fuel giving up " + count(fb.shape.fuel) : "an oxidant taking " + count(fb.shape.oxidant)) + " electrons" : "") });
      }
    });
    return rows;
  }
  // Runs the engine on every row: the redox value, and its plus-or-minus where the formation energy has an uncertainty.
  function evaluate(rows, c, cache) {            // cache: pass the same Map when a list is evaluated in several pieces
    cache = cache || new Map();
    rows.forEach(function (r) {
      if (!r.sp || r.inertOnly) return;
      var hit = cache.get(r.sp);
      if (!hit) {
        try { hit = { res: MR.analyze(r.sp, c) }; } catch (err) { hit = { error: err.message }; }
        cache.set(r.sp, hit);
      }
      var blind = hit.res && hit.res.role === "inert" && !hit.res.deep ? hit.res.notes.filter(function (n) { return /^no data for /.test(n); })[0] : null;
      if (hit.error) { r.status = "not computed"; r.reason = hit.error; }
      else if (blind) { r.status = "no data"; r.reason = blind.replace(/, so .*$/, ""); r.formula = r.sp.formula; }
      else {
        r.status = "computed"; r.res = hit.res;
        if (r.u > 0) { if (hit.range === undefined || hit.u !== r.u) { hit.range = rangeOf(r.sp, r.u, hit.res, c); hit.u = r.u; } r.range = hit.range; }
      }
    });
    return rows;
  }
  // How much of the formation-energy uncertainty reaches the value. A mineral that changes in water takes its value
  // from what it turns into, so its own energy only matters once the uncertainty is larger than that change.
  function placeholder(flags) {            // formation energy set to zero for want of any model: energies built on it mean nothing
    return (flags || []).some(function (f) { return /formation energy zero/.test(f); });
  }
  function shifted(sp, d) {            // the same mineral with its formation energy moved by d
    var s2 = MR.makeSpecies(sp.name, sp.formula, sp.state, sp.G + d);
    if (sp.states) { s2.states = sp.states; s2.nh4 = sp.nh4; }
    return s2;
  }
  function scoreOf(res) { return res.fuel || res.oxidant || res.deep ? res.number : 0; }
  // How far the value moves when the formation energy is shifted by its uncertainty either way. Unlike u / n this
  // also sees a mineral change role (locked or oxidizable), which is where the sign can turn.
  function rangeOf(sp, u, res, c) {
    if (!(u > 0)) return null;
    var v = scoreOf(res), lo, hi;
    try { lo = scoreOf(MR.analyze(shifted(sp, -u), c)); hi = scoreOf(MR.analyze(shifted(sp, u), c)); } catch (e) { return null; }
    var pos = lo > 1e-9 || v > 1e-9 || hi > 1e-9, neg = lo < -1e-9 || v < -1e-9 || hi < -1e-9;
    return { pm: Math.max(Math.abs(lo - v), Math.abs(hi - v)), lo: lo, hi: hi, flip: pos && neg };
  }
  function uEff(u, res) {
    if (!(u >= 0)) return u;
    var bd = res && res.breakdown;
    return bd && bd.known ? Math.max(0, u - Math.max(0, -bd.dG)) : u;
  }

  var api = { S: S, DB_NAMES: DB_NAMES, plain: plain, norm: norm, count: count, cond: cond, byG: byG, compKey: compKey, atomsOf: atomsOf, sortLib: sortLib, loadLibrary: loadLibrary, loadIma: loadIma, loadCross: loadCross, crossOf: crossOf, index: index, imaFind: imaFind, lookup: lookup, imaComp: imaComp, sameCompound: sameCompound, imaHits: imaHits, apart: apart, oneFor: oneFor, attachStates: attachStates, recipeOf: recipeOf, fallback: fallback, resolve: resolve, evaluate: evaluate, placeholder: placeholder, shifted: shifted, scoreOf: scoreOf, rangeOf: rangeOf, uEff: uEff };
  root.MineralData = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
