/* estimator.js - estimate the Gibbs energy of formation of a mineral from its formula alone.
 *
 * Used only where no measured value exists. The formula is split into building blocks: each
 * cation with its oxidation state (oxygen follows from charge balance), hydroxyl H, molecular
 * H2O, F and Cl.
 *   entropy   S  = sum of block entropies
 *   enthalpy  dH = sum of block enthalpies - an acid-base term
 *   Gibbs     dG = dH - T (S - entropies of the elements)
 * Sulfides, arsenides and related minerals use one block per element.
 * Block values (estimator_model.json) were fitted to the measured solids of twelve published
 * databases and tested blind; each mineral family has its own values where that did better.
 * Minerals read from the IMA list arrive with their oxidation states already worked out
 * (hints): those are used as given. Ammonium minerals are estimated as the potassium mineral
 * plus a fixed step per NH4, measured from NH4/K pairs in the databases. Alloys, carbides,
 * nitrides, phosphides and organic molecules have no fitted model: they are taken as their
 * elements (formation energy zero) with a wide, stated uncertainty.
 */
(function (root) {
  "use strict";
  var T = 298.15, MIN_SEEN = 3;
  var ANIONS = { O: -2, F: -1, Cl: -1 };
  var CHALC = { S: 1, Se: 1, Te: 1, As: 1, Sb: 1 };
  var NH4_STEP = 203.9, NH4_SPREAD = 5.2;     // kJ per NH4: ammonium mineral minus its potassium twin (6 measured pairs)
  // kJ/mol, aqueous ions from OBIGT. Used to step from a mineral the model covers to its twin with another anion.
  var AQ = { F: -281.751, Cl: -131.290, Br: -104.056, I: -51.923, NO3: -110.905, SO4: -744.459, CO3: -527.983, S2O3: -522.582,
    IO3: -128.030, BF4: -1486.994, SiF6: -2199.529, formate: -350.879, acetate: -369.322, oxalate: -674.042,
    PO4: -1018.804, SCN: 92.717, glycolate: -506.975, glycolic: -528.858, citrate: -1161.855, urea: -203.844, NH3: -26.706,
    methane: -50.720,                       // the gas, for methane held in a silica cage
    // Triazolate is not in OBIGT. Built from the measured heat of formation of solid 1,2,4-triazole (108.7 kJ/mol, NIST
    // WebBook), an estimated entropy (100 J/K/mol), its high solubility and its pKa of 10.2. Good to about 10 kJ/mol.
    triazolate: 280 };
  // Organic anions and molecules with a known dissolved energy. An anion is swapped for an inorganic twin of the same charge
  // that the model covers; a neutral molecule is lifted out and counted at its dissolved (or gas) energy.
  var NITRATE = { name: "nitrate", atoms: { N: 1, O: 3 }, state: "N5+", aq: "NO3" };
  var ORGANIC = [
    { name: "oxalate", rx: "C2O4", atoms: { C: 2, O: 4 }, aq: "oxalate", twin: { name: "carbonate", atoms: { C: 1, O: 3 }, state: "C4+", aq: "CO3" },
      spread: 15, checked: "10 measured oxalates, typical miss 14 kJ/mol" },
    { name: "acetate", rx: "CH3COO", atoms: { C: 2, H: 3, O: 2 }, aq: "acetate", twin: NITRATE },
    { name: "formate", rx: "HCOO|CHOO", atoms: { C: 1, H: 1, O: 2 }, aq: "formate", twin: NITRATE },
    { name: "glycolate", rx: "C2H3O3", atoms: { C: 2, H: 3, O: 3 }, aq: "glycolate", twin: NITRATE },
    { name: "citrate", rx: "C6H5O7", atoms: { C: 6, H: 5, O: 7 }, aq: "citrate", twin: { name: "phosphate", atoms: { P: 1, O: 4 }, state: "P5+", aq: "PO4" }, spread: 36 },
    { name: "thiocyanate", rx: "SCN", atoms: { S: 1, C: 1, N: 1 }, aq: "SCN", twin: NITRATE },
    { name: "triazolate", rx: "N3C2H2", atoms: { N: 3, C: 2, H: 2 }, aq: "triazolate", twin: NITRATE, err: 10 },
    { name: "glycolic acid", rx: "C2H4O3", atoms: { C: 2, H: 4, O: 3 }, aq: "glycolic" },
    { name: "urea", rx: "CO\\(NH2\\)2", atoms: { C: 1, O: 1, N: 2, H: 4 }, aq: "urea" },
    { name: "ammonia", rx: "NH3", atoms: { N: 1, H: 3 }, aq: "NH3" }
  ];
  var SWAP_SPREAD = 30;                       // kJ per swapped inorganic anion
  // kJ per organic group. The same step was run on organic salts whose formation energy has been measured (organic_check.js):
  // 10 oxalates miss by 14 kJ/mol (root mean square), sodium acetate and formate by 21 and 10, potassium thiocyanate by 13,
  // calcium citrate by 36 per citrate. Oxalate and citrate carry their own figure; the rest take this one.
  var ORGANIC_SPREAD = 20;
  var AS_ELEMENTS = 40;                       // kJ per mole of atoms: give or take for a mineral taken as its elements

  /* "Fe2+:3;Fe3+:2;H2O:8;NH4:1;organic" -> { states, water, nh4, organic, reduced, unbalanced, nostate } */
  function parseHints(text) {
    if (!text) return null;
    var h = { states: {}, water: 0, nh4: 0, organic: false, reduced: "", unbalanced: false, nostate: "" };
    String(text).split(";").forEach(function (t) {
      var p = t.split(":"), k = p[0], v = p[1];
      if (!k) return;
      if (k === "organic") h.organic = true;
      else if (k === "unbalanced") h.unbalanced = true;
      else if (k === "reduced") h.reduced = v;
      else if (k === "nostate") h.nostate = v;
      else if (k === "H2O") h.water = parseFloat(v);
      else if (k === "NH4") h.nh4 = parseFloat(v);
      else h.states[k] = parseFloat(v);
    });
    return h;
  }

  function waterMolecules(formula) {
    formula = String(formula).replace(/ /g, "").replace(/[:\u00B7\u2022]/g, "*");   // CaSO4:2H2O and dot marks
    var n = 0, m = /\*(\d*\.?\d*)H2O$/.exec(formula) || /\.(\d*)H2O$/.exec(formula);
    if (m) n += m[1] ? parseFloat(m[1]) : 1;
    var re = /\(H2O\)(\d*\.?\d*)/g, g;
    while ((g = re.exec(formula)) !== null) n += g[1] ? parseFloat(g[1]) : 1;
    return n;
  }

  function blocks(formula, comp, model, hints) {
    var fixed = model.fixed, variable = model.variable, els = Object.keys(comp);
    if (els.length === 1) return { cls: "element", blocks: {} };
    var hasO = "O" in comp, hasHalide = "F" in comp || "Cl" in comp || "Br" in comp || "I" in comp;
    var chalc = els.some(function (e) { return CHALC[e]; });
    var molecule = els.every(function (e) { return e === "C" || e === "H" || e === "N" || e === "O"; }) && "C" in comp;
    if (molecule && (!hints || hints.organic || !hasO)) return { cls: "elements", blocks: {}, why: "an organic molecule" };
    if (!hasO && !hasHalide) {
      if (!chalc) return { cls: "elements", blocks: {}, why: "an alloy, carbide, nitride, phosphide or silicide" };
      var b = {};
      els.forEach(function (e) { b[e + "|s"] = comp[e]; });
      return { cls: "sulfide", blocks: b };
    }
    // a halide, with or without water of hydration: cations, halogens and H2O only
    var nh4h = hints ? (hints.nh4 || 0) : 0;
    var waterOnly = !chalc && !("C" in comp) && Math.abs((comp.H || 0) - 2 * (comp.O || 0) - 4 * nh4h) < 1e-6 &&
      Math.abs((comp.N || 0) - nh4h) < 1e-6 && hasHalide;
    if (waterOnly) {
      var hc = {}, ok = true, q = 0;
      if (hints && !hints.unbalanced && !hints.nostate) {
        Object.keys(hints.states).forEach(function (k) { if (hints.states[k] > 1e-9) hc[k] = hints.states[k]; });
      } else {
        els.forEach(function (x) {
          if (x === "O" || x === "H" || x === "F" || x === "Cl" || x === "Br" || x === "I") return;
          var z = x in fixed ? fixed[x] : x in variable ? variable[x][0] : null;
          if (z === null) ok = false; else hc[x + z + "+"] = comp[x];
        });
      }
      if (nh4h > 1e-9) hc["K1+"] = (hc["K1+"] || 0) + nh4h;
      Object.keys(hc).forEach(function (k) { q += parseFloat(k.replace(/\+$/, "").slice(-1)) * hc[k]; });
      ["F", "Cl", "Br", "I"].forEach(function (a) { q -= comp[a] || 0; });
      if (ok && Math.abs(q) < 0.02) return { cls: "halide", blocks: hc, water: comp.O || 0, nh4: nh4h };
      if (!hasO) return { cls: null, reason: "the charges of this halide do not balance with the oxidation states on file" };
    }
    if (!hasO) {
      var sh = {};
      els.forEach(function (e) { sh[e + "|s"] = comp[e]; });
      return { cls: "sulfide", blocks: sh };
    }
    if (hints && hints.organic) return { cls: null, reason: "salts of organic acids are not covered" };
    if (hints && hints.nostate) return { cls: null, reason: "no oxidation states listed for " + hints.nostate };
    var sulf = null, sulfComp = null;
    if (hints && hints.reduced) {                // a sulfide part and an oxide part in one mineral
      var red = hints.reduced.split(",");
      if (!red.every(function (x) { return x === "S" || x === "Se" || x === "Te"; })) {
        return { cls: null, reason: "a reduced anion other than sulfide together with oxygen is not covered" };
      }
      var st = {}, need = 0;
      Object.keys(hints.states).forEach(function (k) { if (hints.states[k] > 1e-9) st[k] = hints.states[k]; });
      sulfComp = {};
      red.forEach(function (x) {
        var pos = 0;
        Object.keys(st).forEach(function (k) { if (k.replace(/\d\+$/, "") === x) pos += st[k]; });
        var nx = (comp[x] || 0) - pos;
        if (nx > 1e-9) { sulfComp[x] = nx; need += 2 * nx; }
      });
      var pref = ["Ag", "Hg", "Cu", "Pb", "Tl", "Bi", "Sb", "As", "Cd", "Zn", "Fe", "Co", "Ni", "Mn", "Sn", "Mo", "Ge", "In", "Ga", "W", "V"];
      var never = { S: 1, Se: 1, Te: 1, C: 1, N: 1, P: 1, Si: 1, B: 1 };
      var rank = function (k) { var i = pref.indexOf(k.replace(/\d\+$/, "")); return i < 0 ? 99 : i; };
      Object.keys(st).sort(function (a, c) { return rank(a) - rank(c) || (a < c ? -1 : 1); }).forEach(function (k) {
        var e = k.replace(/\d\+$/, ""), z = parseFloat(k.slice(e.length));
        if (need < 1e-9 || never[e] || !(z > 0)) return;
        var take = Math.min(st[k], need / z);
        sulfComp[e] = (sulfComp[e] || 0) + take; st[k] -= take; need -= take * z;
      });
      if (need > 1e-6) return { cls: null, reason: "the sulfide part of this mineral could not be separated from the oxide part" };
      sulf = {};
      Object.keys(sulfComp).forEach(function (e) { sulf[e + "|s"] = sulfComp[e]; });
      hints = { states: st, water: hints.water, nh4: hints.nh4, unbalanced: false };
    }
    if (hints) {                                 // oxidation states worked out when the IMA formula was read
      var hb = {}, nh4 = hints.nh4 || 0, hw = hints.water || 0;
      Object.keys(hints.states).forEach(function (k) { if (hints.states[k] > 1e-9) hb[k] = hints.states[k]; });
      if (nh4 > 1e-9) hb["K1+"] = (hb["K1+"] || 0) + nh4;
      var hh = (comp.H || 0) - 2 * hw - 4 * nh4;
      if (hw > 1e-9) hb.H2O = hw;
      if (hh > 1e-6) hb["H+"] = hh;
      if ("Br" in comp || "I" in comp) {
        var odd = ["Br", "I"].filter(function (a) { return a in comp && !Object.keys(hints.states).some(function (k) { return k.replace(/\d\+$/, "") === a; }); });
        if (odd.length) return { cls: null, reason: "no building block for " + odd.join(", ") + " as a halide" };
      }
      ["F", "Cl"].forEach(function (a) { if (a in comp) hb[a + "-"] = comp[a]; });
      var hx = (hb["F-"] || 0) + (hb["Cl-"] || 0);
      if (hx > 2 * ((comp.O || 0) - hw)) return { cls: null, reason: "halide-rich oxysalts are not covered" };
      if (sulf) return { cls: "mixed", blocks: hb, sulf: sulf, sulfComp: sulfComp, nh4: nh4 };
      return { cls: "oxygen", blocks: hb, nh4: nh4, loose: !!hints.unbalanced };
    }
    var val = {}, charge = (comp.H || 0), e, i;
    els.forEach(function (x) { if (x in ANIONS) charge += ANIONS[x] * comp[x]; });
    for (i = 0; i < els.length; i++) {
      e = els[i];
      if (e in ANIONS || e === "H") continue;
      if (e in fixed) val[e] = [[fixed[e], comp[e]]];
      else if (e in variable) val[e] = [[variable[e][0], comp[e]]];
      else return { cls: null, reason: "no oxidation states listed for " + e };
    }
    Object.keys(val).forEach(function (x) { val[x].forEach(function (p) { charge += p[0] * p[1]; }); });
    if (Math.abs(charge) > 1e-6) {
      var order = Object.keys(variable);
      for (i = 0; i < order.length; i++) {
        e = order[i];
        if (!(e in val)) continue;
        var states = variable[e].slice().sort(function (a, c) { return a - c; }), n = comp[e];
        var z = variable[e][0] - charge / n;
        if (states[0] - 1e-9 <= z && z <= states[states.length - 1] + 1e-9) {
          for (var k = 0; k + 1 < states.length; k++) {
            var lo = states[k], hi = states[k + 1];
            if (lo - 1e-9 <= z && z <= hi + 1e-9) {
              var f = (z - lo) / (hi - lo);
              val[e] = [[lo, n * (1 - f)], [hi, n * f]];
              break;
            }
          }
          charge = 0;
          break;
        }
      }
      if (Math.abs(charge) > 1e-6) return { cls: null, reason: "the charges do not balance with the oxidation states on file" };
    }
    var out = {};
    Object.keys(val).forEach(function (x) {
      val[x].forEach(function (p) { if (p[1] > 1e-9) out[x + p[0] + "+"] = p[1]; });
    });
    var w = waterMolecules(formula), h = (comp.H || 0) - 2 * w;
    if (h < -1e-9) return { cls: null, reason: "more water than hydrogen" };
    if (w > 1e-9) out.H2O = w;
    if (h > 1e-9) out["H+"] = h;
    ["F", "Cl"].forEach(function (a) { if (a in comp) out[a + "-"] = comp[a]; });
    var halide = (out["F-"] || 0) + (out["Cl-"] || 0);
    if (halide > 2 * ((comp.O || 0) - (out.H2O || 0))) return { cls: null, reason: "hydrated halides are not covered" };
    return { cls: "oxygen", blocks: out };
  }

  function blockCharge(b) {
    if (b === "H2O") return 2;
    if (b === "H+") return 1;
    if (b.charAt(b.length - 1) === "-") return 0;
    return parseFloat(b.replace(/\+$/, "").slice(-1));
  }

  /* Which block values to use: the mineral family's own, where the family has its own and has seen
   * every block at least twice; otherwise the values fitted to the whole class. */
  function pickTables(m, b) {
    var fams = m.families || [], fam = null, i, names = Object.keys(b);
    for (i = 0; i < fams.length && !fam; i++) {
      if (fams[i].members && fams[i].members.length && fams[i].members.some(function (x) { return x in b; })) fam = fams[i];
    }
    for (i = 0; i < fams.length && !fam; i++) {
      if (fams[i].name === m.default_family) fam = fams[i];
    }
    if (fam && fam.blocks) {
      var idx = {};
      fam.blocks.forEach(function (x, j) { idx[x] = j; });
      if (names.every(function (x) { return (x in idx) && fam.count[idx[x]] >= 2; })) return { tab: fam, fam: fam, own: true };
    }
    return { tab: m, fam: fam, own: false };
  }

  /* Entropy and enthalpy of a set of blocks from the fitted tables of one class. */
  function core(model, cls, b, el) {
    var names = Object.keys(b), m = model[cls], idx = {}, unknown, dH = 0, S = 0, flags = [], bare = false;
    m.blocks.forEach(function (x, i) { idx[x] = i; });
    if (cls === "oxygen") {
      var b2 = {}, moved = [];
      names.forEach(function (x) {
        var mm = /^([A-Z][a-z]?)(\d+)\+$/.exec(x);
        if (!mm || (x in idx && x in m.s)) { b2[x] = (b2[x] || 0) + b[x]; return; }
        var zs = m.blocks.map(function (y) { var q = /^([A-Z][a-z]?)(\d+)\+$/.exec(y); return q && q[1] === mm[1] && y in m.s ? +q[2] : null; })
          .filter(function (v) { return v !== null; }).sort(function (a, c) { return a - c; });
        if (!zs.length) { b2[x] = b[x]; return; }
        var z = +mm[2], lo = null, hi = null;
        zs.forEach(function (v) { if (v < z) lo = v; if (v > z && hi === null) hi = v; });
        if (lo !== null && hi !== null) {
          var f = (z - lo) / (hi - lo);
          b2[mm[1] + lo + "+"] = (b2[mm[1] + lo + "+"] || 0) + b[x] * (1 - f);
          b2[mm[1] + hi + "+"] = (b2[mm[1] + hi + "+"] || 0) + b[x] * f;
        } else { var near = lo !== null ? lo : hi; b2[mm[1] + near + "+"] = (b2[mm[1] + near + "+"] || 0) + b[x]; }
        moved.push(x);
      });
      if (moved.length) { b = b2; names = Object.keys(b); bare = true; flags.push("low confidence: " + moved.join(", ") + " never measured, placed between the nearest measured oxidation states of the element"); }
      unknown = names.filter(function (x) { return !(x in idx) || !(x in m.s); });
      if (unknown.length) return { ok: false, status: "no estimate: building block never seen in the training minerals: " + unknown.join(", ") };
      // ## S = Σ n(block) × s(block)
      names.forEach(function (x) { S += b[x] * m.s[x]; });
    } else {
      unknown = names.filter(function (x) { return !(x in idx); });
      var known = names.filter(function (x) { return x in idx; });
      if (unknown.length && !known.length) return { ok: false, status: "no estimate: no element of this mineral was seen in a sulfide of the training minerals" };
      // ## S = Σ n(block) × s(block)
      known.forEach(function (x) { S += b[x] * m.s[idx[x]]; });
      unknown.forEach(function (x) { S += b[x] * el[x.split("|")[0]].S; });      // an unseen element counts as the element itself
      if (unknown.length) {
        flags.push("low confidence: " + unknown.map(function (x) { return x.split("|")[0]; }).join(", ") + " never seen in a training sulfide, counted as the bare element");
        names = known; bare = true;
      }
    }
    var pick = pickTables(m, b), tab = pick.tab, fam = pick.fam, tidx = {};
    tab.blocks.forEach(function (x, i) { tidx[x] = i; });
    var rare = names.filter(function (x) { return tab.count[tidx[x]] < MIN_SEEN; });
    // ## ΔfH = Σ n(block) × h(block)
    names.forEach(function (x) { dH += b[x] * tab.h[tidx[x]]; });
    if (cls === "oxygen") {
      var NO = 0, sq = 0, mean = 0;
      names.forEach(function (x) {
        // ## o = oxygens the block brings = n × charge / 2
        var o = b[x] * blockCharge(x) / 2;
        NO += o; sq += o * tab.a[tidx[x]] * tab.a[tidx[x]]; mean += o * tab.a[tidx[x]];
      });
      // ## acid-base term: ΔfH = Σ n h − Σ o (a − ā)²,   ā = Σ o a / Σ o      (written here as Σ o a² − (Σ o a)² / Σ o)
      if (NO > 0) dH -= sq - mean * mean / NO;
    }
    var unc = model.uncertainty[cls], err;
    if (!fam) err = unc.p68;
    else if (pick.own) err = fam.own.p68;
    else if (fam.blocks) err = (fam.fallback || unc.all_class_model || unc).p68;
    else err = fam.p68;
    if (rare.length) flags.push("low confidence: " + rare.map(function (x) { return x.split("|")[0]; }).join(", ") + " seen in fewer than " + MIN_SEEN + " training minerals");
    // Tellurate rests on two measured solids only, and the block fitted to them misses solid telluric acid (from its dissolved
    // energy, Filella and May 2019, and its solubility) by 35 kJ/mol. That is the give-or-take used per tellurium(VI).
    // ## ± at least 35 × n(Te⁶⁺)
    if (b["Te6+"]) err = Math.max(err, 35 * b["Te6+"]);
    return { ok: true, S: S, dH: dH, err: bare ? err * 2 : err, flags: flags, family: fam ? fam.name : "" };
  }

  /* comp: element counts of the formula, as given by the engine's parseFormula. */
  /* The measured binary halide of cation c ("Cu2+") with halogen a. Where that one was never measured, another halide
     of the same cation is stepped to it by the energies of the dissolved halide ions. */
  function binaryHalide(H, c, a) {
    var v = H.binaries[c + "|" + a];
    if (v !== undefined) return { v: v };
    var alt = ["Cl", "F", "Br", "I"].filter(function (x) { return H.binaries[c + "|" + x] !== undefined; })[0];
    // ## ΔfG(halide of a) = ΔfG(halide of alt) + z × [ΔfG(a⁻, dissolved) − ΔfG(alt⁻, dissolved)]
    return alt ? { v: H.binaries[c + "|" + alt] + parseFloat(c.replace(/\+$/, "").slice(-1)) * (AQ[a] - AQ[alt]), stepped: true } : {};
  }

  function estimate0(formula, comp, model, hints) {
    var out = { formula: formula, status: "", cls: "", family: "", blocks: {}, S: null, dH: null, dG: null, uncertainty: null, flags: [] };
    var el = model.elements, els = Object.keys(comp);
    var missing = els.filter(function (e) { return !(e in el) || el[e].S === null || el[e].S === undefined; });
    if (missing.length) { out.status = "no element entropy on file for " + missing.join(", "); return out; }
    var Sel = 0;
    // ## S(elements) = Σ n(element) × S°(element)
    els.forEach(function (e) { Sel += el[e].S * comp[e]; });
    var r = blocks(formula, comp, model, typeof hints === "string" ? parseHints(hints) : hints);
    if (r.cls === null) { out.status = "not covered: " + r.reason; return out; }
    out.cls = r.cls; out.blocks = r.blocks;
    if (r.cls === "element") { out.status = "element in its reference state"; out.dH = 0; out.dG = 0; out.uncertainty = 0; return out; }
    if (r.cls === "halide") {                    // sum of the measured binary halides, plus a fixed energy per water
      var H = model.halides, nX = 0, g = 0, lack = [], stepped = [];
      if (!H) { out.status = "not covered: halides"; return out; }
      ["F", "Cl", "Br", "I"].forEach(function (a) { nX += comp[a] || 0; });
      Object.keys(r.blocks).forEach(function (c) {
        ["F", "Cl", "Br", "I"].forEach(function (a) {
          if (!comp[a]) return;
          var bin = binaryHalide(H, c, a);
          if (bin.stepped) stepped.push(c.replace(/\d\+$/, "") + " with " + a);
          // ## ΔfG = Σ over cations and halogens of n(cation) × share(halogen) × ΔfG(binary halide)
          if (bin.v === undefined) lack.push(c.replace(/\d\+$/, "") + " with " + a); else g += r.blocks[c] * (comp[a] / nX) * bin.v;
        });
      });
      if (lack.length) { out.status = "no estimate: no measured binary halide for " + lack.join(", "); return out; }
      // ##       + n(H₂O) × (energy per water) + 203.9 × n(NH₄)
      g += r.water * H.water + NH4_STEP * r.nh4;
      // ## ± = √(p68² + (5.2 × n(NH₄))²), doubled if a halide had to be stepped
      out.status = "estimated"; out.dG = g; out.uncertainty = Math.sqrt(H.p68 * H.p68 + NH4_SPREAD * NH4_SPREAD * r.nh4 * r.nh4) * (stepped.length ? 2 : 1);
      if (stepped.length) out.flags.push("low confidence: no measured halide of " + stepped.join(", ") + "; stepped from another halide of the same metal by the dissolved ions");
      out.flags.push("halide estimated as the sum of its measured binary halides" + (r.water > 1e-9 ? " plus " + H.water + " kJ per water" : "") +
        (r.nh4 > 1e-9 ? "; ammonium as the potassium salt plus " + NH4_STEP + " kJ per NH4" : ""));
      return out;
    }
    if (r.cls === "elements") {                  // no fitted model: taken as its elements
      var atoms = 0;
      els.forEach(function (e) { atoms += comp[e]; });
      // ## ΔfG = 0,   ± = 40 × atoms
      out.status = "estimated"; out.dH = 0; out.dG = 0; out.uncertainty = AS_ELEMENTS * atoms;
      out.flags.push("taken as its elements (formation energy zero): there is no fitted model for " + r.why);
      return out;
    }
    var nh4 = r.nh4 || 0;
    // ## S(elements) of the potassium twin: add n(NH₄) × (S°K − S°N − 4 S°H)
    if (nh4 > 1e-9) Sel += nh4 * (el.K.S - el.N.S - 4 * el.H.S);      // element entropies of the potassium twin
    var c1, c2 = null, dG, err;
    if (r.cls === "mixed") {                     // a sulfide part and an oxide part, each from its own model
      var SelS = 0;
      Object.keys(r.sulfComp).forEach(function (e) { SelS += el[e].S * r.sulfComp[e]; });
      c2 = core(model, "sulfide", r.sulf, el);
      if (!c2.ok) { out.status = c2.status; return out; }
      if (Object.keys(r.blocks).length) {
        c1 = core(model, "oxygen", r.blocks, el);
        if (!c1.ok) { out.status = c1.status; return out; }
      } else c1 = { S: 0, dH: 0, err: 0, flags: [], family: "" };
      // ## ΔfG = [ΔfH − T (S − S(elements)) / 1000] of the oxide part + the same of the sulfide part
      dG = (c1.dH - T * (c1.S - (Sel - SelS)) / 1000) + (c2.dH - T * (c2.S - SelS) / 1000);
      // ## ± = √(±oxide² + ±sulfide²)
      err = Math.sqrt(c1.err * c1.err + c2.err * c2.err);
      out.S = c1.S + c2.S; out.dH = c1.dH + c2.dH;
      out.flags = c1.flags.concat(c2.flags, ["estimated as a sulfide part plus an oxide part"]);
    } else {
      c1 = core(model, r.cls, r.blocks, el);
      if (!c1.ok) { out.status = c1.status; return out; }
      // ## ΔfG = ΔfH − T × (S − S(elements)) / 1000        (S in J/K/mol, hence the 1000)
      dG = c1.dH - T * (c1.S - Sel) / 1000; err = c1.err;
      out.S = c1.S; out.dH = c1.dH; out.flags = c1.flags.slice();
    }
    out.family = c1.family;
    if (nh4 > 1e-9) {                            // ammonium: the potassium twin plus a measured step per NH4
      // ## ΔfG = ΔfG(potassium twin) + 203.9 × n(NH₄)
      // ## ± = √(±² + (5.2 × n(NH₄))²)
      dG += NH4_STEP * nh4;
      err = Math.sqrt(err * err + NH4_SPREAD * NH4_SPREAD * nh4 * nh4);
      out.flags.push("ammonium estimated as the potassium mineral plus " + NH4_STEP + " kJ per NH4");
    }
    if (r.loose) { err *= 2; out.flags.push("the formula as listed is not charge-balanced, so this estimate is rough"); }
    out.status = "estimated"; out.dG = dG; out.uncertainty = err;
    return out;
  }

  function countGroup(formula, re) {          // how many of a group the formula holds, with its multiplier
    var n = 0, m, rx = new RegExp("\\((?:" + re + ")\\)([\\d.]*)|(?:" + re + ")", "g");
    while ((m = rx.exec(formula))) n += m[1] ? parseFloat(m[1]) : 1;
    return n;
  }

  /* Where the model has no building block, estimate the twin mineral it does cover and step across with dissolved ions. */
  function estimate(formula, comp, model, hints) {
    var h = typeof hints === "string" ? parseHints(hints) : hints;
    var first = estimate0(formula, comp, model, h);
    // a first answer that is only a stand-in (formation energy zero, or an element the sulfide model has never seen) can be bettered below
    var placeholder = first.dG !== null && h && first.flags.some(function (f) { return /formation energy zero|counted as the bare element/.test(f); });
    // a formula flagged organic that holds a known organic group goes by that group, whatever the first answer was
    var byGroup = !!(h && h.organic) && ORGANIC.some(function (L) { return L.atoms.C && countGroup(formula, L.rx) > 0; });
    if ((first.dG !== null && !placeholder && !byGroup) || !h) return first;
    var c = {}, st = {}, step = 0, n = 0, notes = [], sure = [], k, organic = h.organic, extra = 0, orgSpread = 0;
    Object.keys(comp).forEach(function (e) { c[e] = comp[e]; });
    Object.keys(h.states).forEach(function (x) { st[x] = h.states[x]; });
    var add = function (o, key, v) { o[key] = (o[key] || 0) + v; if (Math.abs(o[key]) < 1e-9) delete o[key]; };
    var nI = 0;
    Object.keys(st).forEach(function (x) { if (/^I\d\+$/.test(x)) { nI += st[x]; delete st[x]; } });
    if (nI > 0) { add(c, "I", -nI); add(c, "N", nI); add(st, "N5+", nI); step += nI * (AQ.IO3 - AQ.NO3); n += nI; notes.push("iodate taken as the nitrate twin"); }
    if (st["S2+"] && /S2O3/.test(formula)) {
      k = st["S2+"] / 2; delete st["S2+"]; add(st, "S6+", k); add(c, "S", -k); add(c, "O", k);
      step += k * (AQ.S2O3 - AQ.SO4); n += k; notes.push("thiosulfate taken as the sulfate twin");
    }
    if (st["Sc3+"]) { k = st["Sc3+"]; delete st["Sc3+"]; add(st, "Y3+", k); add(c, "Sc", -k); add(c, "Y", k); notes.push("Sc counted as Y, whose oxide has nearly the same formation energy"); }
    if (organic) {
      var found = [], carbon = st["C4+"] || 0, cage = /\(\(CH4\)\)([\d.]+)/.exec(formula);
      ORGANIC.forEach(function (L) {
        var q = countGroup(formula, L.rx);
        if (q > 0) { found.push([L, q]); carbon += q * (L.atoms.C || 0); }
      });
      if (cage) { found.push([{ name: "methane", atoms: { C: 1, H: 4 }, aq: "methane", cage: true }, parseFloat(cage[1])]); carbon += parseFloat(cage[1]); }
      if (found.some(function (p) { return p[0].atoms.C; }) && Math.abs((c.C || 0) - carbon) < 1e-6) {
        found.forEach(function (p) {
          var L = p[0], q = p[1];
          Object.keys(L.atoms).forEach(function (e) { add(c, e, -q * L.atoms[e]); });
          if (L.twin) {
            Object.keys(L.twin.atoms).forEach(function (e) { add(c, e, q * L.twin.atoms[e]); });
            // ## step = q × [ΔfG(organic ion, dissolved) − ΔfG(twin ion, dissolved)]
            add(st, L.twin.state, q); step += q * (AQ[L.aq] - AQ[L.twin.aq]);
            (L.checked ? sure : notes).push(L.name + " taken as the " + L.twin.name + " twin" + (L.checked ? " (checked on " + L.checked + ")" : ""));
          } else {
            // ## step = q × ΔfG(molecule, dissolved)
            step += q * AQ[L.aq];
            notes.push(L.name + (L.cage ? " in the cage counted as the gas" : " counted as the dissolved molecule"));
          }
          if (!L.cage) orgSpread += (L.spread || ORGANIC_SPREAD) * q;
          extra += (L.err || 0) * q * (L.err || 0) * q;
        });
        organic = false;
      }
    }
    var reduced = h.reduced || "";
    if (/NH3/.test(formula)) {                                  // ammonia held as a neutral molecule, as in the copper ammine minerals
      var am = countGroup(formula, "NH3"), nitrogen = 0;
      Object.keys(st).forEach(function (x) { if (/^N\d\+$/.test(x)) nitrogen += st[x]; });
      if (am > 0 && Math.abs((c.N || 0) - nitrogen - (h.nh4 || 0) - am) < 1e-6) {
        add(c, "N", -am); add(c, "H", -3 * am); step += am * AQ.NH3; n += am;
        notes.push("ammonia counted as the dissolved molecule");
        reduced = reduced.split(",").filter(function (x) { return x !== "N"; }).join(",");
      }
    }
    var dryO = (c.O || 0) - (h.water || 0);
    if (c.Si && dryO < 1e-6 && (c.F || 0) >= 6 * c.Si - 1e-6) {
      k = c.Si; add(c, "F", -6 * k); delete c.Si; delete st["Si4+"]; add(c, "S", k); add(c, "O", 4 * k); add(st, "S6+", k);
      step += k * (AQ.SiF6 - AQ.SO4); n += k; notes.push("fluorosilicate taken as the sulfate twin");
    }
    if (c.B && dryO < 1e-6 && (c.F || 0) >= 4 * c.B - 1e-6) {
      k = c.B; add(c, "F", -4 * k); delete c.B; delete st["B3+"]; add(c, "N", k); add(c, "O", 3 * k); add(st, "N5+", k);
      step += k * (AQ.BF4 - AQ.NO3); n += k; notes.push("fluoroborate taken as the nitrate twin");
    }
    if ((c.O || 0) - (h.water || 0) > 1e-6) ["Br", "I"].forEach(function (a) {
      if (!c[a]) return;
      k = c[a]; delete c[a]; add(c, "Cl", k); step += k * (AQ[a] - AQ.Cl); n += k; notes.push((a === "Br" ? "bromide" : "iodide") + " taken as the chloride twin");
    });
    var h2 = { states: st, water: h.water, nh4: h.nh4, organic: organic, reduced: reduced, unbalanced: h.unbalanced, nostate: h.nostate };
    var stepped = notes.length + sure.length;
    var t = stepped ? estimate0("", c, model, h2) : first;
    if (t.dG === null && /halide-rich/.test(t.status)) t = splitHalide(c, model, h2) || t;
    if (t.dG === null || (first.dG !== null && !stepped)) { if (stepped && first.dG === null) first.status = t.status; return first; }
    // ## ΔfG = ΔfG(twin mineral) + Σ steps
    t.formula = formula; t.dG += step;
    // One kind of metal, oxalate and water only: this is what the 10 measured oxalates are, and their miss already includes
    // the twin's own error, so the checked spread stands alone here.
    var metals = Object.keys(c).filter(function (e) { return e !== "C" && e !== "O" && e !== "H"; });
    var plain = sure.length === 1 && !notes.length && !n && !extra && metals.length === 1 && !(h.nh4 > 0);
    // ## ± = √(±twin² + (30 × swapped anions)² + ±organic² + extra)
    t.uncertainty = plain ? orgSpread : Math.sqrt(t.uncertainty * t.uncertainty + SWAP_SPREAD * SWAP_SPREAD * n * n + orgSpread * orgSpread + extra);
    if (sure.length) t.flags.push(sure.join("; ") + ", stepped by the energies of the dissolved ions");
    if (notes.length) t.flags.push("low confidence: " + notes.join("; ") + (n || orgSpread ? ", stepped by the energies of the dissolved ions" : ""));
    return t;
  }

  /* More halogen than the oxysalt model allows: a halide part (measured binary halides) plus an oxide part. */
  function splitHalide(c, model, h) {
    var H = model.halides, hal = {}, nX = 0, st = {}, part = {}, need, g = 0, bad = false;
    if (!H || h.reduced || h.organic || h.nostate) return null;
    ["F", "Cl", "Br", "I"].forEach(function (a) { if (c[a]) { hal[a] = c[a]; nX += c[a]; } });
    Object.keys(h.states).forEach(function (x) { st[x] = h.states[x]; });
    var pref = ["K", "Na", "Cs", "Rb", "Li", "Ba", "Sr", "Ca", "Pb", "Tl", "Ag", "Hg", "Cu", "Mg"];
    var rank = function (x) { var i = pref.indexOf(x.replace(/\d\+$/, "")); return i < 0 ? 99 : i; };
    need = nX;
    Object.keys(st).sort(function (a, b) { return rank(a) - rank(b) || (a < b ? -1 : 1); }).forEach(function (x) {
      var z = parseFloat(x.replace(/\+$/, "").slice(-1));
      if (need < 1e-9 || !(z > 0)) return;
      var take = Math.min(st[x], need / z);
      part[x] = take; st[x] -= take; need -= take * z;
      if (st[x] < 1e-9) delete st[x];
    });
    if (need > 1e-6) return null;
    Object.keys(part).forEach(function (x) {
      Object.keys(hal).forEach(function (a) {
        var v = binaryHalide(H, x, a).v;
        // ## halide part: ΔfG = Σ n(cation) × share(halogen) × ΔfG(binary halide)
        if (v === undefined) bad = true; else g += part[x] * (hal[a] / nX) * v;
      });
    });
    if (bad) return null;
    var c2 = {}, rest;
    Object.keys(c).forEach(function (e) { if (!(e in hal)) c2[e] = c[e]; });
    Object.keys(part).forEach(function (x) { var e = x.replace(/\d\+$/, ""); c2[e] -= part[x]; if (c2[e] < 1e-9) delete c2[e]; });
    if (Object.keys(st).length) {
      rest = estimate0("", c2, model, { states: st, water: h.water, nh4: h.nh4, unbalanced: h.unbalanced });
      if (rest.dG === null) return null;
    } else rest = { dG: (h.water || 0) * H.water, uncertainty: 0, flags: [], cls: "halide", blocks: {} };
    // ## ΔfG = halide part + oxide part
    // ## ± = 2 √(±oxide² + p68²)
    rest.dG += g; rest.status = "estimated";
    rest.uncertainty = 2 * Math.sqrt(rest.uncertainty * rest.uncertainty + H.p68 * H.p68);
    rest.flags.push("low confidence: estimated as a halide part (measured binary halides) plus an oxide part");
    return rest;
  }

  var api = { estimate: estimate, blocks: blocks, parseHints: parseHints };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MineralEstimator = api;
})(typeof self !== "undefined" ? self : this);
