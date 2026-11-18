import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAll, checkPasted, readLine, readInvoice, checkTotals, sizeOf, sizeConflict, pintsIn, stockCsv, cells, gbp, pence } from "./check.js";
import { sample, pasteExample } from "./samples.js";

const clone = () => JSON.parse(JSON.stringify(sample));
const byCode = (r, code) => r.lines.find((l) => l.inv.code === code);

test("sample: 9 of 16 lines ready, £680.85 net, 7 for the manager", () => {
  const r = checkAll(sample);
  assert.equal(r.lines.length, 16);
  assert.equal(r.ready.length, 9);
  assert.equal(r.held.length, 7);
  assert.equal(r.value, 68085);
  assert.deepEqual(r.held.map((l) => l.inv.code), ["PD-2207", "PD-5502", "PD-5021", "GB-G09W", "PD-1140", "GB-L11", "FF-30112"]);
  assert.deepEqual(r.held.map((l) => l.kind), ["size", "goods", "vat", "notfound", "price", "price", "price"]);
});

test("every ready line: quantity times price is the line total, and the price is the last cost on the list", () => {
  const r = checkAll(sample);
  for (const l of r.ready) {
    assert.equal(l.inv.qty * l.inv.price, l.inv.net, l.text);
    assert.equal(l.value, l.inv.net, l.text);
    assert.equal(l.inv.price, l.item.last, l.text);
  }
  assert.equal(r.ready.reduce((t, l) => t + l.value, 0), 68085);
});

test("each invoice's printed totals match its own lines", () => {
  const r = checkAll(sample);
  for (const t of r.totals) assert.ok(t.ok, t.inv.number);
  assert.deepEqual(r.totals.map((t) => t.want.total), [57936, 95184, 22773]);
  // 454.80 at 20% is 90.96; 793.20 is 158.64; 13.90 is 2.78
  assert.deepEqual(r.totals.map((t) => t.want.vatS), [9096, 15864, 278]);
});

test("a printed total that does not add up fails", () => {
  const s = clone();
  s.inv1[s.inv1.length - 1] = "Total due 579.46";
  const t = checkTotals(readInvoice("inv1", s.inv1));
  assert.equal(t.ok, false);
  assert.equal(t.rows.find((x) => x.key === "total").match, false);
});

test("cases become bottles, bags and each, with the cost of one shown", () => {
  const r = checkAll(sample);
  const wine = byCode(r, "PD-3310");
  assert.equal(wine.units, 12);
  assert.equal(wine.costPerUnit, 650);
  const chips = byCode(r, "FF-20418");
  assert.equal(chips.units, 12);
  assert.ok(chips.facts.some(([k, v]) => k === "Cost per measure" && v === "£16.20 / 10 = £1.62 a kg"));
  const buns = byCode(r, "FF-17748");
  assert.equal(buns.units, 96);
  assert.ok(buns.facts.some(([k, v]) => k === "Cost each" && v === "£14.40 / 48 = 30.0p each"));
  assert.ok(wine.facts.some(([k, v]) => k === "Cost each" && v === "£39.00 / 6 = £6.50 a bottle"));
});

test("keg and cask pints are the imperial figures on the list", () => {
  assert.equal(pintsIn(11 * 4546.09), 88);
  assert.equal(pintsIn(9 * 4546.09), 72);
  assert.equal(pintsIn(30000), 52.79);
  const r = checkAll(sample);
  assert.equal(r.stock.find((s) => s.code === "GB-L11").measure.count, 88);
  assert.equal(r.stock.find((s) => s.code === "GB-I30").measure.count, 52.79);
  assert.equal(r.stock.find((s) => s.code === "GB-B09").measure.count, 72);
  const ipa = byCode(r, "GB-I30");
  assert.ok(ipa.facts.some(([k, v]) => k === "Cost per measure" && v === "£142.00 / 52.79 = £2.69 a pint"));
});

test("a spirit's cost per 25ml measure: 28 to a 70cl bottle", () => {
  const r = checkAll(sample);
  const v = byCode(r, "PD-1102");
  assert.ok(v.facts.some(([k, val]) => k === "Cost per measure" && val === "£13.40 / 28 = 47.9p a 25ml measure"));
});

test("new prices are held with the change per measure, pint and litre", () => {
  const r = checkAll(sample);
  const gin = byCode(r, "PD-1140");
  assert.equal(gin.kind, "price");
  assert.match(gin.why, /up 5\.8% on £16\.30/);
  assert.match(gin.why, /3\.4p a 25ml measure/); // (17.25 - 16.30) / 28 = 3.39p
  const lager = byCode(r, "GB-L11");
  assert.match(lager.why, /up 5\.0% on £172\.00/);
  assert.match(lager.why, /9\.8p a pint/); // 8.60 / 88 = 9.77p
  const oil = byCode(r, "FF-30112");
  assert.match(oil.why, /up 7\.7% on £33\.90/);
  assert.match(oil.why, /13\.0p a litre/);
});

test("a code for the 70cl bottle on a line that says 1 litre is held, with per-bottle and per-litre change", () => {
  const r = checkAll(sample);
  const v = byCode(r, "PD-2207");
  assert.equal(v.kind, "size");
  assert.equal(v.state, "fail");
  assert.match(v.why, /up 33\.5% on £14\.20/); // 18.95 / 14.20 = 1.3345
  assert.match(v.why, /£18\.95 against £20\.29, down 6\.6%/); // 14.20 / 0.7 = 20.29 a litre
  assert.equal(v.perLitre.was, 2029);
});

test("VAT coded zero on an item your list has at 20% is held, with the VAT at stake", () => {
  const r = checkAll(sample);
  const t = byCode(r, "PD-5021");
  assert.equal(t.kind, "vat");
  assert.match(t.why, /£6\.72/); // 33.60 at 20%
});

test("charged for more than came through the door is held", () => {
  const r = checkAll(sample);
  const l = byCode(r, "PD-5502");
  assert.equal(l.kind, "goods");
  assert.match(l.why, /Charged for 3 CS, 2 received/);
  assert.match(l.why, /£26\.40 net, £31\.68 with VAT/);
  assert.ok(l.srcRefs.some((x) => x.doc === "goods" && x.tone === "fail"));
});

test("a line whose code and words are not on the list is not found, never guessed", () => {
  const r = checkAll(sample);
  const g = byCode(r, "GB-G09W");
  assert.equal(g.kind, "notfound");
  assert.equal(g.item, null);
  assert.match(g.options[0].note, /72 pints each/);
});

test("the manager's picks settle held lines and are recorded", () => {
  const picks = {
    2: { price: "accept" },
    3: { size: "new" },
    5: { vat: "stock" },
    6: { goods: "received" },
    7: { price: "query" },
    10: { item: "new" },
    12: { price: "accept" },
  };
  const r = checkAll(sample, picks);
  assert.equal(r.ready.length, 15);
  assert.equal(r.queried.length, 1);
  assert.equal(r.held.length, 0);
  const lager = r.lines.find((l) => l.n === 6);
  assert.equal(lager.qty, 2);
  assert.equal(lager.value, 5280);
  const vodka = r.lines.find((l) => l.n === 3);
  assert.equal(vodka.item.isNew, true);
  assert.equal(vodka.item.measure.count, 40);
  // 680.85 + 103.50 + 113.70 + 33.60 + 52.80 + 98.00 + 36.50
  assert.equal(r.value, 68085 + 10350 + 11370 + 3360 + 5280 + 9800 + 3650);
  for (const n of [2, 3, 5, 6, 10, 12]) assert.ok(r.lines.find((l) => l.n === n).settled, `line ${n}`);
  const csv = stockCsv(r);
  assert.match(csv, /New cost accepted by the manager/);
  assert.doesNotMatch(csv, /GB-L11/);
});

test("stocking all of a short line uses the charged quantity", () => {
  const r = checkAll(sample, { 6: { goods: "all" } });
  assert.equal(r.lines.find((l) => l.n === 6).qty, 3);
});

test("every reference points at the exact text it claims", () => {
  const r = checkAll(sample, {});
  const docs = { ...sample };
  for (const l of r.lines) {
    for (const ref of [...l.refs, ...l.srcRefs]) {
      const text = docs[ref.doc][ref.line];
      assert.ok(text, `${l.n} ${ref.doc}:${ref.line}`);
      assert.ok(ref.end > ref.start && ref.end <= text.length, `${l.n} range`);
    }
    if (l.inv.code) {
      const ref = l.refs.find((x) => x.doc === l.doc && sample[l.doc][x.line].slice(x.start, x.end) === l.inv.code);
      assert.ok(ref, `code ref on line ${l.n}`);
    }
    const price = l.refs.find((x) => sample[x.doc][x.line].slice(x.start, x.end) === (l.inv.price / 100).toFixed(2));
    assert.ok(price, `price ref on line ${l.n}`);
  }
  const wine = byCode(r, "PD-3310");
  const pack = wine.srcRefs.find((x) => x.doc === "stock" && sample.stock[x.line].slice(x.start, x.end) === "6");
  assert.ok(pack, "the pack cell");
});

test("sizes: packs, centilitres, litres, gallons before a keg, kilos and ounces", () => {
  assert.deepEqual({ ...sizeOf("HOUSE WHITE 6X75CL"), words: undefined }, { pack: 6, ml: 750, g: null, gal: null, words: undefined });
  assert.equal(sizeOf("PREMIUM VODKA 1LTR").ml, 1000);
  assert.equal(sizeOf("HOUSE LAGER 11G KEG").gal, 11);
  assert.equal(sizeOf("CRISPS 32X40G").g, 40); // grams, not gallons, without KEG or CASK after
  assert.equal(sizeOf("BEEF BURGER 6OZ X48").pack, 48);
  assert.ok(Math.abs(sizeOf("BEEF BURGER 6OZ X48").g - 170.1) < 0.1);
  assert.equal(sizeOf("CHIPS SKIN-ON 9MM 4X2.5KG").g, 2500);
  assert.deepEqual(sizeConflict(sizeOf("X 50L KEG"), sizeOf("X 11G KEG")), []);
  assert.deepEqual(sizeConflict(sizeOf("X 30L KEG"), sizeOf("X 11G KEG")), ["volume"]);
  assert.deepEqual(sizeConflict(sizeOf("X 12X75CL"), sizeOf("X 6X75CL")), ["pack"]);
});

test("reading invoice lines", () => {
  const l = readLine("PD-1102 HOUSE VODKA 70CL 6 BTL 13.40 80.40 S");
  assert.equal(l.code, "PD-1102");
  assert.equal(l.desc, "HOUSE VODKA 70CL");
  assert.equal(l.qty, 6);
  assert.equal(l.price, 1340);
  assert.equal(readLine("6 bottles of vodka please"), null);
  assert.equal(readLine("PD-1102 HOUSE VODKA 70CL 6 CRATE 13.40 80.40 S"), null);
  assert.equal(pence("13.4"), null);
  assert.equal(gbp(68085), "£680.85");
  assert.deepEqual(cells("a | bb | ").map((c) => c.val), ["a", "bb", ""]);
});

test("pasted lines: ready, wrong unit, no code, same keg written in litres, bad sum, not on the list", () => {
  const p = checkPasted(pasteExample, sample);
  assert.deepEqual(p.map((l) => l.kind || "ready"), ["ready", "unit", "map", "ready", "sum", "notfound"]);
  assert.match(p[1].why, /charges by EA/);
  assert.match(p[2].why, /word for word your House vodka 70cl/);
  assert.ok(p[3].facts.some(([k, v]) => k === "Size" && /the same size/.test(v)));
  assert.match(p[4].why, /2 x £34\.75 is £69\.50\. The line says £68\.50/);
  assert.ok(p.every((l) => l.facts.every(([k, v]) => k !== "Goods in" || v === "Not checked for pasted lines")));
});

test("pasted junk, zero, a wrong size and a repeat are never dropped", () => {
  const p = checkPasted(["hello", "PD-1102 HOUSE VODKA 70CL 0 BTL 13.40 0.00 S", "GB-L11 HOUSE LAGER 30L KEG 1 KEG 172.00 172.00 S", "hello", "PD-1102 HOUSE VODKA 70CL 6 BTL 13.40 80.40"].join("\n"), sample);
  assert.equal(p.length, 5);
  assert.equal(p[0].kind, "unread");
  assert.equal(p[3].kind, "unread");
  assert.equal(p[2].kind, "size");
  assert.equal(p[4].kind, "vat"); // no VAT code on the line
  assert.equal(p[4].ready, false);
  assert.equal(p[1].kind, "zero");
});

test("the export lists only ready lines and adds up", () => {
  const r = checkAll(sample);
  const csv = stockCsv(r);
  const rows = csv.trim().split("\n").slice(2, -1);
  assert.equal(rows.length, 9);
  const net = rows.reduce((t, row) => t + pence(row.split(",").at(-2)), 0);
  assert.equal(net, 68085);
});
