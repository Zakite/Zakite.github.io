/* engine.js - the redox value of one species.
 *
 * At a given pH and redox potential (Eh), the most stable state of a mineral's elements in water is found by Gibbs
 * energy minimization (a small linear program) over every species in the database made of those elements. Nothing
 * about the products is chosen by hand. The energy of getting there, per electron moved, is the redox value.
 *   parseFormula, makeSpecies   a formula as atoms, charge and electron count
 *   Conditions, gprime          pH, the potentials of H2 and O2, the energy of a species at a potential
 *   lpMin, lowest               the lowest-energy mix of species with the same atoms
 *   equilibrate                 products, energy and electrons at one potential
 *   valence, settle, breakdown  oxidation states, and the change in water that moves no electrons
 *   analyze                     the redox value against O2
 */
(function (root) {
  "use strict";

  const NEAR_LINE = 10;            // kJ per mol e-: an inert mineral whose first reduction lies this close below the H2 line is marked as a borderline case
  const F = 96.485;               // kJ per volt per mole of electrons
  const R = 8.314462618e-3;       // kJ / (mol K)
  const T = 298.15;               // K; the database values are for 25 C
  // ## RT = 8.314462618 × 10⁻³ kJ/(mol K) × 298.15 K = 2.479 kJ/mol
  const RT = R * T;
  const LN10 = Math.log(10);
  // Electrons per formula unit that are rounding or a trace impurity in the formula, not the mineral's chemistry:
  // under 0.02, or under one for every 200 atoms other than O and H.
  // ## fewest electrons that count = larger of 0.02 and 0.005 × (atoms other than O and H)
  function noise(sp) { let a = 0; for (const e of sp.heavy) a += sp.comp[e]; return Math.max(0.02, 0.005 * a); }

  const ELEMENTS = new Set((
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As " +
    "Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd " +
    "Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am " +
    "Cm Bk Cf Es Fm Md No Lr").split(" "));


  // ---------------------------------------------------------------- formulas
  function readNumber(s, i) {
    const m = /^(\d+\.\d+|\.\d+|\d+)/.exec(s.slice(i));   // 2, 0.5 and .5
    return m ? [parseFloat(m[1]), i + m[1].length] : [1, i];
  }

  function parseGroup(s) {
    const stack = [{}];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === "(" || ch === "[") {
        stack.push({});
        i += 1;
      } else if (ch === ")" || ch === "]") {
        if (stack.length === 1) throw new Error("unbalanced parentheses");
        const inner = stack.pop();
        const [mult, next] = readNumber(s, i + 1);
        i = next;
        const top = stack[stack.length - 1];
        for (const el in inner) top[el] = (top[el] || 0) + inner[el] * mult;
      } else {
        const m = /^[A-Z][a-z]?/.exec(s.slice(i));
        if (!m || !ELEMENTS.has(m[0])) throw new Error("cannot read '" + s.slice(i) + "' as an element");
        const [mult, next] = readNumber(s, i + m[0].length);
        i = next;
        const top = stack[stack.length - 1];
        top[m[0]] = (top[m[0]] || 0) + mult;
      }
    }
    if (stack.length !== 1) throw new Error("unbalanced parentheses");
    return stack[0];
  }

  /** 'Fe3O4', 'KFe3(SO4)2(OH)6', 'Fe0.947O', 'FeSO4*7H2O', 'SO4-2' -> {comp, charge} */
  function parseFormula(text) {
    let s = String(text).trim().replace(/ /g, "");
    if (!s) throw new Error("empty formula");
    let charge = 0;
    const m = /([+-])(\d*)$/.exec(s);
    if (m) {
      charge = (m[1] === "+" ? 1 : -1) * parseInt(m[2] || "1", 10);
      s = s.slice(0, m.index);
    }
    s = s.replace(/:/g, "*");                     // PHREEQC style: CaSO4:2H2O
    if (!/[\u00B7\u2022*]/.test(s)) {              // with an explicit mark, every dot is a decimal
      s = s.replace(/\.(\d+\.\d+|\d*)H2O$/, "*$1H2O");    // MgSO4.H2O, Yb2(CO3)3.6H2O
    }
    const comp = {};
    for (const part of s.split(/[·•*]/)) {
      const [mult, start] = readNumber(part, 0);
      if (start === part.length) throw new Error("cannot read '" + text + "' as a formula");
      const g = parseGroup(part.slice(start));
      for (const el in g) comp[el] = (comp[el] || 0) + g[el] * mult;
    }
    return { comp: comp, charge: charge };
  }

  // -------------------------------------------------------------------- data
  function makeSpecies(name, formula, state, G, ref, citation, kind) {
    const p = parseFormula(formula);
    const heavy = Object.keys(p.comp).filter(function (e) { return e !== "O" && e !== "H"; }).sort();
    const nO = p.comp.O || 0, nH = p.comp.H || 0;
    return {
      name: name, formula: formula, state: state, G: G, ref: ref || "", citation: citation || "", kind: kind || "",
      comp: p.comp, charge: p.charge, heavy: heavy, heavySet: new Set(heavy), nO: nO, nH: nH,
      // ## ω = charge + 2 × (O atoms) − (H atoms)
      omega: p.charge + 2 * nO - nH,     // summed oxidation numbers of everything except O and H
    };
  }

  function splitCSVLine(line) {
    const out = [];
    let cur = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
        } else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function parseCSV(text) {
    const all = String(text).replace(/^﻿/, "").split(/\r?\n/);
    const comments = all.filter(function (l) { return /^[ "]*#/.test(l); })
      .map(function (l) { return l.replace(/^[ "]*#\s?/, "").replace(/[",]+$/, ""); });
    const lines = all.filter(function (l) { return l.replace(/[ ,\t]/g, "") && !/^[ "]*#/.test(l); });
    const rows = lines.map(splitCSVLine);
    const head = rows.shift() || [];
    const records = rows.map(function (r) {
      const o = {};
      head.forEach(function (h, i) { o[h.trim()] = r[i] === undefined ? "" : r[i]; });
      return o;
    });
    return { records: records, comments: comments };
  }

  function loadDatabase(csvText) {
    const parsed = parseCSV(csvText);
    const species = [];
    for (const r of parsed.records) {
      try {
        const G = parseFloat(r.dGf_kJ_mol);
        if (!isFinite(G)) continue;
        species.push(makeSpecies(r.name.trim(), r.formula.trim(), (r.state || "cr").trim(), G,
          (r.ref || "user").trim(), (r.citation || "").trim(), (r.kind || "").trim()));
      } catch (err) { /* unreadable formula: skip the row */ }
    }
    const water = species.find(function (s) { return s.name === "water" && s.state === "liq"; });
    if (!water) throw new Error("the database needs a row named 'water' with state 'liq'");
    return { species: species, water: water, comments: parsed.comments };
  }

  const STATE_ORDER = ["cr", "gas", "liq", "aq"];
  const STATE_ALIAS = { g: "gas", s: "cr", l: "liq" };

  /** Resolve a name or formula. Solids first, then gases, liquids, dissolved species;
   *  polymorphs come back most stable first. Append (aq), (g) or (cr) to force a state. */
  function find(db, text) {
    text = String(text).trim();
    let want = null;
    const m = /\((aq|g|gas|cr|s|liq|l)\)$/i.exec(text);
    if (m) {
      const k = m[1].toLowerCase();
      want = STATE_ALIAS[k] || k;
      text = text.slice(0, m.index).trim();
    }
    const pool = db.filter(function (s) { return want === null || s.state === want; });
    function best(group) {
      for (const state of STATE_ORDER) {
        const chosen = group.filter(function (s) { return s.state === state; });
        if (chosen.length) return chosen.sort(function (a, b) { return a.G - b.G; });
      }
      return [];
    }
    const key = text.toLowerCase();
    const named = pool.filter(function (s) { return s.name.toLowerCase() === key; });
    if (named.some(function (s) { return s.state !== "aq"; })) return best(named);
    let parsed;
    try {
      parsed = parseFormula(text);
    } catch (err) {
      if (named.length) return named;
      throw err;
    }
    const comp = parsed.comp, els = Object.keys(comp);
    const hits = pool.filter(function (s) {
      const sk = Object.keys(s.comp);
      if (sk.length !== els.length || !els.every(function (e) { return e in s.comp; })) return false;
      const k = comp[els[0]] / s.comp[els[0]];
      return els.every(function (e) { return Math.abs(comp[e] - k * s.comp[e]) < 1e-6 * Math.max(1, comp[e]); }) &&
        Math.abs(parsed.charge - k * s.charge) < 1e-6;
    });
    const out = best(hits);
    return out.length ? out : named;
  }

  // ---------------------------------------------------------- linear program
  /** Minimize costs.x subject to sum_j x_j * cols[j] = b, x >= 0.
   *  Two-phase tableau simplex with Bland's rule. Returns {objective, sol: [[column, amount]]}. */
  function lpMin(cols, costs, b) {
    const m = b.length, n = cols.length;
    const sign = b.map(function (v) { return v < 0 ? -1 : 1; });
    let T = [];
    for (let i = 0; i < m; i++) {
      const row = new Array(n + m + 1);
      for (let j = 0; j < n; j++) row[j] = cols[j][i] * sign[i];
      for (let k = 0; k < m; k++) row[n + k] = k === i ? 1 : 0;
      row[n + m] = Math.abs(b[i]);
      T.push(row);
    }
    const basis = [];
    for (let i = 0; i < m; i++) basis.push(n + i);
    let scale = 1;
    for (const c of costs) scale = Math.max(scale, Math.abs(c));
    const tol = 1e-11 * scale + 1e-9;
    const last = n + m;

    function pivot(r, c) {
      const p = T[r][c];
      const pr = T[r].map(function (v) { return v / p; });
      T[r] = pr;
      for (let i = 0; i < T.length; i++) {
        if (i !== r && T[i][c] !== 0) {
          const f = T[i][c], row = T[i];
          for (let k = 0; k <= last; k++) row[k] = row[k] - f * pr[k];
        }
      }
      basis[r] = c;
    }

    function run(cost, eps) {
      for (let it = 0; it < 100000; it++) {
        const cb = basis.map(function (j) { return cost[j]; });
        let enter = -1;
        for (let j = 0; j < n; j++) {                       // Bland: first improving column
          let acc = 0;
          for (let i = 0; i < T.length; i++) acc += cb[i] * T[i][j];
          if (cost[j] - acc < -eps) { enter = j; break; }
        }
        if (enter < 0) return;
        let leave = -1, bestRatio = 0;
        for (let i = 0; i < T.length; i++) {
          if (T[i][enter] > 1e-10) {
            const ratio = T[i][last] / T[i][enter];
            if (leave < 0 || ratio < bestRatio - 1e-12 ||
                (Math.abs(ratio - bestRatio) <= 1e-12 && basis[i] < basis[leave])) {
              leave = i; bestRatio = ratio;
            }
          }
        }
        if (leave < 0) throw new Error("unbounded");
        pivot(leave, enter);
      }
      throw new Error("no convergence");
    }

    const phase1 = new Array(n + m).fill(0);
    for (let k = 0; k < m; k++) phase1[n + k] = 1;
    run(phase1, 1e-9);
    let infeasible = 0;
    for (let i = 0; i < m; i++) if (basis[i] >= n) infeasible += T[i][last];
    if (infeasible > 1e-7) throw new Error("no species in the database can hold one of its elements");
    for (let i = T.length - 1; i >= 0; i--) {              // clear leftover artificial columns
      if (basis[i] >= n) {
        let j = -1;
        for (let c = 0; c < n; c++) if (Math.abs(T[i][c]) > 1e-9) { j = c; break; }
        if (j < 0) { T.splice(i, 1); basis.splice(i, 1); } else pivot(i, j);
      }
    }
    const phase2 = costs.concat(new Array(m).fill(0));
    run(phase2, tol);
    const sol = [];
    let objective = 0;
    for (let i = 0; i < T.length; i++) {
      if (T[i][last] > 1e-10) { sol.push([basis[i], T[i][last]]); objective += costs[basis[i]] * T[i][last]; }
    }
    return { objective: objective, sol: sol };
  }

  // --------------------------------------------------------------- chemistry
  function Conditions(db, water, pH, solutes, activities, exclude) {
    this.db = db; this.water = water;
    this.pH = pH === undefined ? 7 : pH;
    this.solutes = solutes === undefined ? 1 : solutes;
    this.act = activities || {};
    this.exclude = new Set(exclude || []);
    this.byname = {};
    for (const s of db) if (!(s.name in this.byname)) this.byname[s.name] = s;
    // ## E(H₂) = −(RT ln 10 / F) × pH
    this.E_H2 = -RT * LN10 * this.pH / F;                   // 2 H+ + 2 e- = H2 (1 bar)
    // ## E(O₂) = −ΔfG(H₂O) / (2F) + E(H₂)
    this.E_O2 = -water.G / (2 * F) + this.E_H2;             // O2 (1 bar) + 4 H+ + 4 e- = 2 H2O
    // ## window = F × (E(O₂) − E(H₂))
    this.window = F * (this.E_O2 - this.E_H2);              // 118.6 kJ per mole of electrons
  }

  Conditions.prototype.activity = function (sp) {
    if (sp.name in this.act) return this.act[sp.name];
    return sp.state === "aq" ? this.solutes : 1;
  };

  /** Gibbs energy of the species relative to water, H+ and electrons at this pH and Eh. */
  Conditions.prototype.gprime = function (sp, Eh) {
    // ## μH = −F × Eh − RT ln 10 × pH
    const muH = -F * Eh - RT * LN10 * this.pH;              // H = H+ + e-
    // ## μO = ΔfG(H₂O) − 2 μH
    const muO = this.water.G - 2 * muH;
    // ## μQ = F × Eh
    const muQ = F * Eh;                                     // unit positive charge = minus an electron
    // ## g′ = ΔfG + RT ln a − O × μO − H × μH − charge × μQ
    return sp.G + RT * Math.log(this.activity(sp)) - sp.nO * muO - sp.nH * muH - sp.charge * muQ;
  };

  Conditions.prototype.candidates = function (sp) {
    const ex = this.exclude;
    const out = this.db.filter(function (s) {
      return s.heavy.length > 0 && s.kind !== "partner" && !ex.has(s.name) && s !== sp &&
        s.heavy.every(function (e) { return sp.heavySet.has(e); });
    });
    out.push(sp);
    return out;
  };

  // ------------------------------------------------- oxidation states
  // Elements that keep one oxidation state in minerals and in water.
  const FIXED = { Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1, Be: 2, Mg: 2, Ca: 2, Sr: 2, Ba: 2, Ra: 2, Zn: 2, Cd: 2, Al: 3, Sc: 3, Y: 3, Ga: 3, In: 3,
    La: 3, Pr: 3, Nd: 3, Pm: 3, Sm: 3, Gd: 3, Tb: 3, Dy: 3, Ho: 3, Er: 3, Tm: 3, Yb: 3, Lu: 3, Si: 4, Zr: 4, Hf: 4, Th: 4, Ge: 4, B: 3, Nb: 5, Ta: 5, F: -1 };
  // The others: states they take, most usual first.
  const STATES = { Fe: [2, 3], Mn: [2, 3, 4], Co: [2, 3], Ni: [2, 3], Cu: [2, 1], Cr: [3, 6], V: [5, 4, 3], Ti: [4, 3], Ce: [3, 4], Eu: [3, 2],
    U: [6, 4, 5], Mo: [6, 4, 5], W: [6, 4], Re: [7, 4], Pb: [2, 4], Sn: [4, 2], Tl: [1, 3], Hg: [2, 1], Ag: [1], Au: [1, 3], Pd: [2, 4], Pt: [2, 4],
    Rh: [3, 2], Ru: [3, 2, 4], Ir: [3, 4], Os: [4, 8], Bi: [3, 5], Sb: [3, 5], As: [5, 3], Se: [4, 6], Te: [4, 6], S: [6, 4], P: [5, 3], C: [4, 3, 2, 0], N: [5, 3],
    Cl: [-1], Br: [-1], I: [-1, 5, 7] };
  // In a species with several of these, the first one present in this list takes whatever charge is left over.
  const ABSORB = ["Fe", "Mn", "Co", "Ni", "Cu", "Cr", "V", "Ti", "U", "Ce", "Eu", "Pb", "Sn", "Tl", "Hg", "Au", "Pd", "Pt", "Ru", "Ir", "Mo", "W", "Re",
    "Bi", "Sb", "As", "Te", "Se", "S", "C", "N", "P", "I"];
  const ANION = { S: 1, Se: 1, Te: 1 }, HALOGEN = { F: 1, Cl: 1, Br: 1, I: 1 }, PNICTIDE = { As: 1, Sb: 1, Bi: 1, P: 1, C: 1, N: 1, Si: 1, B: 1 };

  function statesOf(el, sp, hasO) {
    if (ANION[el]) return hasO ? (el === "S" ? [6, 4, -2, -1, 0] : [4, 6, -2]) : [-2, -1, 0];
    if (el === "N") return sp.nH > 0 ? [-3, 5, 3, 0] : [5, 3, 0, -3];
    if ((el === "As" || el === "Sb" || el === "Bi") && !hasO) return [3, 5];        // sulfosalts
    if (el === "Cu" && !hasO) return [1, 2];                                        // copper is Cu(I) in sulfides
    return STATES[el] || null;
  }

  /** Put an average oxidation state into whole states: {state: atoms}. Null if it is outside what the element takes. */
  function splitState(el, avg, count, strict) {
    const near = Math.round(avg);
    if (Math.abs(avg - near) * count < 0.02) avg = near;
    const allowed = (STATES[el] || []).concat(ANION[el] ? [-2, -1, 0] : []).concat(el === "N" ? [-3, 0] : []).slice().sort(function (a, b) { return a - b; });
    if (strict && allowed.length && (avg < allowed[0] - 1e-9 || avg > allowed[allowed.length - 1] + 1e-9)) return null;
    const out = {};
    if (avg === near) { out[near] = count; return out; }
    let lo = Math.floor(avg), hi = Math.ceil(avg);
    if (allowed.length && !(allowed.indexOf(lo) >= 0 && allowed.indexOf(hi) >= 0)) {
      const below = allowed.filter(function (v) { return v < avg; }), above = allowed.filter(function (v) { return v > avg; });
      if (below.length && above.length) { lo = below[below.length - 1]; hi = above[0]; }
    }
    const f = (avg - lo) / (hi - lo);
    out[lo] = count * (1 - f); out[hi] = count * f;
    return out;
  }

  /** Atoms of each element in each oxidation state, as {"Fe:2": 1, "Fe:3": 2}. Null when the formula does not settle it
   *  (organic molecules, phosphides and the like, several elements that could each take the charge). */
  function valence(sp) {
    if (sp._val !== undefined) return sp._val;
    let v = settle(sp);
    // Organic molecules and their salts: carbon bonded to carbon, hydrogen or nitrogen has no settled state.
    // Carbonate (C +4, three O per C) and oxalate (C +3, two O per C) do, so those two pass when the oxygen is there for them.
    if (v && sp.comp.C >= 2 && sp.nH > 0 && sp.nO < 3 * sp.comp.C &&
        (Object.keys(v).some(function (k) { return /^C:/.test(k) && k !== "C:3" && k !== "C:4"; }) ||
         sp.nO < 2 * (v["C:3"] || 0) + 3 * (v["C:4"] || 0) - 1e-9)) v = null;
    sp._val = v;
    return v;
  }
  function settle(sp) {
    const heavy = sp.heavy, comp = sp.comp, hasO = sp.nO > 0, out = {};
    const put = function (el, st) { Object.keys(st).forEach(function (z) { if (st[z] > 1e-12) out[el + ":" + z] = (out[el + ":" + z] || 0) + st[z]; }); };
    const fail = function () { sp._val = null; return null; };
    if (!heavy.length) return fail();
    if (sp.states) {                                     // states read from the IMA formula
      let sum = 0, ok = true;
      const seen = {};
      Object.keys(sp.states).forEach(function (k) {
        const m = /^([A-Z][a-z]?)(\d+)\+$/.exec(k);
        if (!m) { ok = false; return; }
        const o = {}; o[m[2]] = sp.states[k]; put(m[1], o);
        seen[m[1]] = (seen[m[1]] || 0) + sp.states[k]; sum += sp.states[k] * parseFloat(m[2]);
      });
      heavy.forEach(function (el) {
        const left = comp[el] - (seen[el] || 0);
        if (Math.abs(left) < 1e-6) return;
        if (left < 0) { ok = false; return; }
        if (HALOGEN[el]) { put(el, { "-1": left }); sum -= left; }
        else if (el === "N" && sp.nh4 && Math.abs(left - sp.nh4) < 1e-6) { put(el, { "-3": left }); sum -= 3 * left; }
        else ok = false;
      });
      if (ok && Math.abs(sum - sp.omega) < 0.02) { sp._val = out; return out; }
      Object.keys(out).forEach(function (k) { delete out[k]; });
    }
    if (heavy.length === 1) {                            // one element: the charge settles it
      put(heavy[0], splitState(heavy[0], sp.omega / comp[heavy[0]], comp[heavy[0]], false));
      sp._val = out; return out;
    }
    const anions = heavy.filter(function (e) { return ANION[e] || HALOGEN[e]; });
    if (!hasO && !anions.length) {                       // metals only: an alloy, every element at zero
      if (heavy.some(function (e) { return PNICTIDE[e]; }) || sp.charge) return fail();
      heavy.forEach(function (e) { put(e, { "0": comp[e] }); });
      sp._val = out; return out;
    }
    if (!hasO && !heavy.some(function (e) { return HALOGEN[e]; }) && !heavy.some(function (e) { return ANION[e]; }) &&
        heavy.some(function (e) { return PNICTIDE[e]; })) return fail();
    if (!hasO && heavy.some(function (e) { return e === "P"; })) return fail();     // phosphides
    let rest = sp.omega;
    const open = [];
    heavy.forEach(function (e) {
      if (e in FIXED) { put(e, (function () { const o = {}; o[FIXED[e]] = comp[e]; return o; })()); rest -= FIXED[e] * comp[e]; }
      else open.push(e);
    });
    if (!open.length) { if (Math.abs(rest) > 0.02) return fail(); sp._val = out; return out; }
    for (const e of open) if (!statesOf(e, sp, hasO) && open.length > 1) return fail();
    let absorber = null;
    for (const e of ABSORB) if (open.indexOf(e) >= 0 && (statesOf(e, sp, hasO) || []).length > 1) { absorber = e; break; }
    if (!absorber) absorber = open[open.length - 1];
    const others = open.filter(function (e) { return e !== absorber; });
    const lists = others.map(function (e) { return statesOf(e, sp, hasO); });
    const pick = new Array(others.length).fill(0);
    for (;;) {                                           // the other elements take a usual state; the absorber takes the rest
      let r = rest;
      others.forEach(function (e, i) { r -= lists[i][pick[i]] * comp[e]; });
      const st = splitState(absorber, r / comp[absorber], comp[absorber], others.length > 0);    // alone, it takes whatever the charge says (Mn in KMnO4 is +7)
      const okSign = st && Object.keys(st).every(function (z) { return ANION[absorber] || PNICTIDE[absorber] || HALOGEN[absorber] || parseFloat(z) >= 0; });
      if (st && okSign) {
        others.forEach(function (e, i) { const o = {}; o[lists[i][pick[i]]] = comp[e]; put(e, o); });
        put(absorber, st);
        sp._val = out; return out;
      }
      let k = pick.length - 1;
      while (k >= 0 && pick[k] === lists[k].length - 1) { pick[k] = 0; k--; }
      if (k < 0) return fail();
      pick[k]++;
    }
  }

  /** What water alone does to the species when no electrons move: every element keeps its oxidation state.
   *  dG <= 0 per formula unit. This energy is not redox energy, so it is kept out of every redox number. */
  /** The mix of candidate species with the lowest total energy that matches the mineral in what row() counts
   *  (its atoms, or its atoms held at their oxidation states). Empty when the mineral itself is that mix. */
  Conditions.prototype.lowest = function (sp, cands, row, Eh) {
    const self = this;
    // ## choose amounts xᵢ ≥ 0 of the candidates so that Σ xᵢ g′ᵢ is as low as it can be, while Σ xᵢ rowᵢ = row(mineral)
    const res = lpMin(cands.map(row), cands.map(function (s) { return self.gprime(s, Eh); }), row(sp));
    // ## ΔG = Σ xᵢ g′ᵢ − g′(mineral)
    const products = sortProducts(cands, res.sol), dG = res.objective - this.gprime(sp, Eh);
    return (dG > -1e-7 || (products.length === 1 && products[0][0] === sp)) ? { products: [], dG: 0 } : { products: products, dG: dG };
  };

  Conditions.prototype.breakdown = function (sp) {
    if (!this._bd) this._bd = new Map();
    if (this._bd.has(sp)) return this._bd.get(sp);
    let out = { products: [], dG: 0, known: false };
    const mine = valence(sp);
    if (mine) {
      const keys = Object.keys(mine);
      const cands = this.candidates(sp).filter(function (s) {
        if (s === sp) return true;
        const v = valence(s);
        return v && Object.keys(v).every(function (k) { return k in mine; });
      });
      // ## B = ΔG of the lowest-energy mix when every element keeps its oxidation state
      out = this.lowest(sp, cands, function (s) { const v = valence(s); return keys.map(function (k) { return v[k] || 0; }); }, this.E_H2);   // any Eh: no electrons move
      out.known = true;
    }
    this._bd.set(sp, out);
    return out;
  };

  function sortProducts(cands, sol) {
    return sol.map(function (p) { return [cands[p[0]], p[1]]; }).sort(function (a, b) {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].name < b[0].name ? -1 : a[0].name > b[0].name ? 1 : 0;
    });
  }

  /** Most stable state of the species' elements in water at this pH and Eh.
   *  n > 0: the species gives up n electrons; n < 0: it takes up -n. dG <= 0 per formula unit. */
  Conditions.prototype.equilibrate = function (sp, Eh) {
    const elements = sp.heavy;
    if (!elements.length) {
      // ## only O and H in it: ΔG = −g′,  n = −ω
      return { Eh: Eh, products: [], dG: -this.gprime(sp, Eh), n: -sp.omega, w: -sp.nO, h: sp.nH - 2 * sp.nO };
    }
    const low = this.lowest(sp, this.candidates(sp), function (s) { return elements.map(function (e) { return s.comp[e] || 0; }); }, Eh);
    const products = low.products;
    if (!products.length) return { Eh: Eh, products: [], dG: 0, n: 0, w: 0, h: 0 };      // already the stable state
    let n = 0, w = 0, hh = 0;
    // ## electrons: n = Σ xᵢ ωᵢ − ω(mineral)
    // ## water used: w = Σ xᵢ Oᵢ − O(mineral)        H⁺ released: h = H(mineral) + 2w − Σ xᵢ Hᵢ
    for (const p of products) { n += p[1] * p[0].omega; w += p[1] * p[0].nO; hh += p[1] * p[0].nH; }
    n -= sp.omega; w -= sp.nO;
    const h = sp.nH + 2 * w - hh;
    return { Eh: Eh, products: products, dG: low.dG, n: Math.abs(n) > noise(sp) ? n : 0, w: w, h: h };
  };

  /** Most stable state in water with no electron partner (oxidation numbers conserved). */
  Conditions.prototype.alone = function (sp) {
    const elements = sp.heavy;
    if (!elements.length) return { products: [], dG: 0 };
    return this.lowest(sp, this.candidates(sp), function (s) { return elements.map(function (e) { return s.comp[e] || 0; }).concat([s.omega]); }, this.E_H2);   // any Eh
  };

  /** For a mineral that neither O2 nor H2 changes: the potential where it first takes electrons below the H2 limit
   *  (or, with up, first gives them above the O2 limit, as gold does). Formal outside the stability of water, but it
   *  ranks minerals that nothing in water can reduce. Steps out by half a volt, then narrows down by halving. */
  Conditions.prototype.firstMove = function (sp, up) {
    const s = up ? 1 : -1;
    let near = up ? this.E_O2 : this.E_H2, far = near, eq = null;         // near: no electrons move there; far: they do
    for (let k = 0; k < (up ? 10 : 14) && !eq; k++) {
      far += 0.5 * s;
      const e = this.equilibrate(sp, far);
      if (e.n * s > 0) eq = e; else near = far;
    }
    if (!eq) return null;
    for (let k = 0; k < 12; k++) {
      const mid = (near + far) / 2, e = this.equilibrate(sp, mid);
      if (e.n * s > 0) { far = mid; eq = e; } else near = mid;
    }
    // ## E = Eh ± (ΔG − B) / (n F)        (+ above O₂, − below H₂)
    // ## value = ±(E(O₂) − E) × F
    const n = s * eq.n, E = far + s * (eq.dG - this.breakdown(sp).dG) / (n * F);
    return { E: E, n: n, number: s * (this.E_O2 - E) * F, eq: eq, up: up };
  };

  // ---------------------------------------------------------- numbers as text
  /** Python's "%.4g" */
  function g4(c) {
    if (c === 0) return "0";
    const e = Math.floor(Math.log10(Math.abs(c)));
    if (e < -4 || e >= 4) {
      const parts = c.toExponential(3).split("e");
      let mant = parts[0];
      if (mant.indexOf(".") >= 0) mant = mant.replace(/0+$/, "").replace(/\.$/, "");
      const ex = parseInt(parts[1], 10);
      return mant + "e" + (ex < 0 ? "-" : "+") + (Math.abs(ex) < 10 ? "0" : "") + Math.abs(ex);
    }
    return String(parseFloat(c.toPrecision(4)));
  }






  /** Reference states of the elements that the database lacks: formation energy zero by definition. */
  function elementReferences(species) {
    const have = new Set();
    for (const s of species) {
      if (s.heavy.length === 1 && !s.nO && !s.nH && !s.charge && Math.abs(s.G) < 0.01 && s.state !== "aq") have.add(s.heavy[0]);
    }
    const out = [];
    ELEMENTS.forEach(function (el) {
      if (el === "O" || el === "H" || have.has(el)) return;
      out.push(makeSpecies(el + " (element)", el, "cr", 0, "element", "element in its reference state, formation energy zero by definition", "element"));
    });
    return out;
  }

  // ----------------------------------------------------------------- analysis
  /** Fuel number (against O2) and oxidant number (against H2) of one species. */
  function analyze(sp, cond) {
    const ox = cond.equilibrate(sp, cond.E_O2);
    const red = cond.equilibrate(sp, cond.E_H2);
    const own = cond.alone(sp);
    const bd = cond.breakdown(sp), B = bd.dG;               // energy of changing in water with no electrons moving: not redox energy
    const out = { species: sp, O2: ox, H2: red, alone: own, breakdown: bd, fuel: null, oxidant: null, notes: [] };
    const names = function (ps) { return ps.map(function (p) { return p[0].name; }).join(", "); };
    if (B < -1) {
      out.notes.push("changes in water on its own, with no electrons moving: to " + names(bd.products) + ", releasing " + (-B).toFixed(1) +
        " kJ/mol (not counted in the redox value)");
    }
    if (own.dG < B - 1) {
      out.notes.push(bd.known
        ? "can also shift electrons between its own atoms with no partner: to " + names(own.products) + ", releasing " + (B - own.dG).toFixed(1) + " kJ/mol"
        : "reacts with water on its own: to " + names(own.products) + ", releasing " + (-own.dG).toFixed(1) +
          " kJ/mol with no electron partner (for organic compounds, carbides, nitrides and the like this is counted as redox energy and stays in the value)");
    }
    const blind = sp.heavy.filter(function (e) { return !cond.db.some(function (s) { return s !== sp && s.kind !== "element" && s.heavySet.has(e); }); });
    if (blind.length) out.notes.push("no data for " + blind.join(", ") + " in the reaction database, so " + (blind.length > 1 ? "they are" : "it is") + " treated as unreactive");
    if (ox.n > 0) {
      // ## fuel number = −(ΔG − B) / n        (ΔG and n at the potential of O₂)
      // ## E(mineral) = E(O₂) − number / F
      const number = -(ox.dG - B) / ox.n;
      out.fuel = { number: number, n: ox.n, total: -(ox.dG - B), E: cond.E_O2 - number / F };
    } else if (ox.n < 0) {
      out.notes.push("a stronger oxidant than O2 here: it gives off O2 on the way to its stable state");
    }
    if (red.n < 0) {
      // ## oxidant number = −(ΔG − B) / n − window        (ΔG and n at the potential of H₂)
      // ## E(mineral) = E(O₂) + number / F
      const number = -(red.dG - B) / -red.n - cond.window;
      // ## value against H₂ = oxidant number + window = −(ΔG − B) / n
      out.oxidant = { number: number, n: -red.n, E: cond.E_O2 + number / F, vsH2: number + cond.window };
    } else if (red.n > 0) {
      out.notes.push("it reduces water: " + g3(red.n / 2) + " H2 per formula unit can be released");
    }
    if (out.fuel) { out.role = "fuel"; out.number = out.fuel.number; }
    else if (out.oxidant) { out.role = "oxidant"; out.number = out.oxidant.number; }
    else {
      out.role = "inert";                       // neither O2 nor H2 changes it in water, so no energy is to be had: the value is 0
      const first = sp.heavy.length ? (cond.firstMove(sp) || cond.firstMove(sp, true)) : null;
      out.deep = null; out.outside = first;     // where its first change would be lies outside the stability field of water: a note, not a value
      if (first && first.up) {                  // gold, platinum: nothing reduces them and O2 does not oxidize them
        // ## how much stronger than O₂ an oxidant must be = E(first oxidation) − E(O₂)
        out.notes.push("O2 does not oxidize it: that would take an oxidant " + (first.E - cond.E_O2).toFixed(3) + " V stronger than O2 (to " + names(first.eq.products.slice(0, 3)) + ")");
      } else if (first) {                       // quartz, corundum, fluorite: O2 has nothing to oxidize and H2 cannot reduce them
        // ## how far below the H₂ line its first reduction lies = E(H₂) − E(first reduction)
        const gap = cond.E_H2 - first.E;
        out.notes.push("H2 does not reduce it: its first reduction (to " + names(first.eq.products.slice(0, 3)) + ") lies " + gap.toFixed(3) + " V below the H2 line, outside the stability field of water" +
          (gap * F < NEAR_LINE ? "; that is close to the line, so within the error H2 may reduce it" : ""));
      }
      out.number = 0;
    }
    return out;
  }

  function g3(c) { return String(parseFloat(c.toPrecision(3))); }




  const api = {
    F: F, RT: RT, LN10: LN10, parseFormula: parseFormula, makeSpecies: makeSpecies, parseCSV: parseCSV, splitCSVLine: splitCSVLine,
    loadDatabase: loadDatabase, find: find, lpMin: lpMin, Conditions: Conditions, elementReferences: elementReferences, valence: valence,
    noise: noise, FIXED: FIXED, analyze: analyze, g4: g4, g3: g3,
  };
  root.MineralRedox = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
