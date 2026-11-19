/* partners.js - the same calculation against a partner other than O2, and reactions written out as text.
 *
 * Not needed for the redox values: those are all against O2 and come from engine.js alone. This file serves the
 * partner menu, the redox ladder and the reaction lines of the page.
 */
(function (root) {
  "use strict";
  const MR = root.MineralRedox, F = MR.F, Conditions = MR.Conditions, g4 = MR.g4;
  // Zones for a reaction that releases energy, in kJ per mole of partner reaction.
  const QUANTUM = 20;             // green at or above: the cost of moving one ion across a membrane (Schink 1997)
  const FLOOR = 10;               // yellow down to here: the lowest yields seen in sediments (Hoehler et al. 2001); red below

  // Redox couples a mineral can be paired with. Where several forms are listed, the most stable
  // one at the chosen pH is used. O, H and charge are balanced with H2O, H+ and electrons.
  //   acceptor: its oxidized form is present, so the mineral has to be the electron donor.
  //   donor:    its reduced form is present, so the mineral has to be the electron acceptor.
  // A partner that is itself a mineral ("mineral" key) is reduced to whatever is stable at the H2 limit,
  // so its number as a partner is the same as its own oxidant number.
  // Labels are written one way throughout: what the mineral meets, an arrow, what that turns into. Every gas (O2, H2, CH4,
  // CO2, N2) is the gas at 1 bar; everything else is dissolved, at the concentration chosen. H2S and NH4+ stand for
  // sulfide and ammonium in whichever form is stable at the pH (H2S or HS-, NH4+ or NH3). Charges are written Fe+3, SO4-2.
  const PARTNERS = [
    { id: "O2", role: "acceptor", label: "O2 → H2O", ox: [{ "oxygen": 1 }], red: [{}] },
    { id: "nitrate", role: "acceptor", label: "NO3- → N2", ox: [{ "NO3-": 1 }], red: [{ "nitrogen": 0.5 }] },
    { id: "nitrate-NH4", role: "acceptor", label: "NO3- → NH4+", ox: [{ "NO3-": 1 }], red: [{ "NH4+": 1 }, { "NH3": 1 }] },
    { id: "MnO2", role: "acceptor", label: "MnO2", mineral: "pyrolusite", ox: [{ "pyrolusite": 1 }], red: [{ "Mn+2": 1 }] },
    { id: "Fe3+", role: "acceptor", label: "Fe+3 → Fe+2", ox: [{ "Fe+3": 1 }], red: [{ "Fe+2": 1 }] },
    { id: "goethite", role: "acceptor", label: "goethite", mineral: "goethite", ox: [{ "goethite": 1 }], red: [{ "Fe+2": 1 }] },
    { id: "hematite", role: "acceptor", label: "hematite", mineral: "hematite", ox: [{ "hematite": 1 }], red: [{ "Fe+2": 2 }] },
    { id: "sulfate", role: "acceptor", label: "SO4-2 → H2S", ox: [{ "SO4-2": 1 }, { "HSO4-": 1 }], red: [{ "HS-": 1 }, { "H2S": 1 }] },
    { id: "sulfur", role: "acceptor", label: "S → H2S", ox: [{ "sulfur": 1 }], red: [{ "HS-": 1 }, { "H2S": 1 }] },
    { id: "CO2", role: "acceptor", label: "CO2 → CH4", ox: [{ "carbon dioxide": 1 }], red: [{ "methane": 1 }] },
    { id: "CO2-acetate", role: "acceptor", label: "CO2 → acetate", ox: [{ "carbon dioxide": 2 }], red: [{ "acetate": 1 }] },
    { id: "H+", role: "acceptor", label: "H+ → H2", ox: [{}], red: [{ "hydrogen": 1 }] },
    { id: "H2", role: "donor", label: "H2 → H+", ox: [{}], red: [{ "hydrogen": 1 }] },
    { id: "formate", role: "donor", label: "formate → CO2", ox: [{ "carbon dioxide": 1 }], red: [{ "formate": 1 }] },
    { id: "acetate", role: "donor", label: "acetate → CO2", ox: [{ "carbon dioxide": 2 }], red: [{ "acetate": 1 }] },
    { id: "lactate", role: "donor", label: "lactate → CO2", ox: [{ "carbon dioxide": 3 }], red: [{ "lactate": 1 }] },
    { id: "CH4", role: "donor", label: "CH4 → CO2", ox: [{ "carbon dioxide": 1 }], red: [{ "methane": 1 }] },
    { id: "sulfide", role: "donor", label: "H2S → SO4-2", ox: [{ "SO4-2": 1 }, { "HSO4-": 1 }], red: [{ "HS-": 1 }, { "H2S": 1 }] },
    { id: "sulfide-S", role: "donor", label: "H2S → S", ox: [{ "sulfur": 1 }], red: [{ "HS-": 1 }, { "H2S": 1 }] },
    { id: "ammonium", role: "donor", label: "NH4+ → N2", ox: [{ "nitrogen": 0.5 }], red: [{ "NH4+": 1 }, { "NH3": 1 }] },
    { id: "Fe2+", role: "donor", label: "Fe+2 → goethite", ox: [{ "goethite": 1 }], red: [{ "Fe+2": 1 }] },
  ];

  /** Potential (V) of a partner couple at these conditions, most stable forms on each side. */
  Conditions.prototype.couple = function (partner) {
    const self = this;
    if (partner.mineral && partner.mineral in this.byname) {
      const sp = this.byname[partner.mineral], eq = this.equilibrate(sp, this.E_H2);
      if (eq.n < 0) {
        return { E: this.E_H2 - (eq.dG - this.breakdown(sp).dG) / (-eq.n * F), n: -eq.n, ox: [[sp, 1]], red: eq.products };
      }
    }
    function side(options) {
      let out = null;
      for (const opt of options) {
        const names = Object.keys(opt);
        if (!names.every(function (nm) { return nm in self.byname; })) continue;
        const sps = names.map(function (nm) { return [self.byname[nm], opt[nm]]; });
        let g = 0;
        for (const p of sps) g += p[1] * self.gprime(p[0], self.E_H2);
        if (out === null || g < out.g) out = { g: g, sps: sps };
      }
      if (out === null) throw new Error("partner " + partner.id + " needs a species that is not in the database");
      return out;
    }
    const ox = side(partner.ox), red = side(partner.red);
    let n = 0;
    for (const p of ox.sps) n += p[1] * p[0].omega;
    for (const p of red.sps) n -= p[1] * p[0].omega;
    return { E: this.E_H2 + (ox.g - red.g) / (n * F), n: n, ox: ox.sps, red: red.sps };
  };

  /** [[label, coefficient]] on each side; negative coefficients move to the other side. */
  function arrange(left, right) {
    const L = left.concat(right.filter(function (t) { return t[1] < 0; }).map(function (t) { return [t[0], -t[1]]; }));
    const Rr = right.concat(left.filter(function (t) { return t[1] < 0; }).map(function (t) { return [t[0], -t[1]]; }));
    const keep = function (t) { return t[1] > 1e-9; };
    return { left: L.filter(keep), right: Rr.filter(keep) };
  }

  function gasTerms(sp, eq, gas) {
    const prods = eq.products.map(function (p) { return [p[0].formula, p[1]]; });
    const n = eq.n, w = eq.w, h = eq.h;
    if (gas === "O2") {
      return [[[sp.formula, 1], ["O2", n / 4], ["H2O", w - n / 2]], prods.concat([["H+", h - n]])];
    }
    return [[[sp.formula, 1], ["H2", -n / 2], ["H2O", w]], prods.concat([["H+", h - n]])];
  }

  /** Overall reaction of a mineral with a partner couple: terms on each side, balanced with H2O and H+. */
  function pairTerms(sp, pr) {
    const eq = pr.eq, c = pr.couple;
    const k = eq.n / c.n;                          // couples consumed per formula unit (negative: run backwards)
    const left = [[sp, 1]].concat(c.ox.map(function (p) { return [p[0], k * p[1]]; }));
    const right = eq.products.map(function (p) { return [p[0], p[1]]; })
      .concat(c.red.map(function (p) { return [p[0], k * p[1]]; }));
    let O = 0, H = 0;
    for (const t of right) { O += t[1] * t[0].nO; H += t[1] * t[0].nH; }
    for (const t of left) { O -= t[1] * t[0].nO; H -= t[1] * t[0].nH; }
    const w = O;                                   // H2O needed on the left
    const h = 2 * w - H;                           // H+ released on the right
    const lab = function (t) { return [t[0].formula, t[1]]; };
    return arrange(left.map(lab).concat([["H2O", w]]), right.map(lab).concat([["H+", h]]));
  }

  function verdict(volts) {
    if (volts === null || volts === undefined) return "no reaction";
    if (volts <= 1e-6) return "no";
    return "yes";
  }

  function zone(kJ) { return kJ >= QUANTUM ? "green" : kJ >= FLOOR ? "yellow" : "red"; }

  /** A mineral with one partner couple: voltage, energy, electrons, and what the mineral becomes. */
  function pair(sp, partner, cond) {
    const c = cond.couple(partner);
    const eq = cond.equilibrate(sp, c.E);
    const out = { partner: partner, couple: c, E_partner: c.E, eq: eq, volts: null, kJ_per_e: null,
      electrons: 0, total: 0, reverse: false, kJ_per_partner: null, zone: null };
    const wanted = partner.role === "acceptor" ? 1 : -1;     // sign of n that the partner allows
    if (eq.n * wanted > 0) {
      out.electrons = Math.abs(eq.n);
      const B = cond.breakdown(sp).dG;                        // not redox energy
      out.kJ_per_e = -(eq.dG - B) / Math.abs(eq.n);
      out.volts = out.kJ_per_e / F;
      out.total = -(eq.dG - B);
      out.kJ_per_partner = out.kJ_per_e * Math.max(c.n, 2);   // per mole of the partner couple as written, at least one electron pair
      if (out.volts > 1e-6) out.zone = zone(out.kJ_per_partner);
    } else if (eq.n !== 0) {
      out.reverse = true;        // energy exists only the other way round, which needs the partner's other form
    }
    out.verdict = verdict(out.volts);
    return out;
  }

  Object.assign(MR, { QUANTUM: QUANTUM, FLOOR: FLOOR, zone: zone, PARTNERS: PARTNERS, pair: pair, verdict: verdict, gasTerms: gasTerms, pairTerms: pairTerms, arrange: arrange });
})(typeof window !== "undefined" ? window : globalThis);
