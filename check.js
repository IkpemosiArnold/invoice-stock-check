// Invoice lines checked against a venue's stock list and goods-in record.
// Plain code, no model. Every figure carries a reference to the text it came from:
// { doc, line, start, end } where doc is an invoice, the stock list or the goods-in sheet.

export const DOC_NAMES = {
  inv1: "Pellicott Drinks, invoice PD 40871",
  inv2: "Gannerby Brewing, invoice GB-11532",
  inv3: "Fallowmere Foodservice, invoice FF/260917",
  stock: "Stock list",
  goods: "Goods in",
  paste: "Your lines",
};
export const INVOICE_DOCS = ["inv1", "inv2", "inv3"];
export const TABLE_DOCS = ["stock", "goods"];

const ML_PER_GALLON = 4546.09; // imperial gallon
const ML_PER_PINT = 568.26125; // imperial pint
const UNITS = { BTL: "BTL", BOTTLE: "BTL", CS: "CS", CASE: "CS", KEG: "KEG", CASK: "CASK", EA: "EA", EACH: "EA" };
const VAT = { S: 20, Z: 0 };

// ---------- money and numbers ----------

/** "13.40" -> 1340 pence. Only two-decimal amounts are money here. */
export const pence = (s) => {
  const m = /^(\d{1,6})\.(\d{2})$/.exec(String(s).replace(/,/g, ""));
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
};
export const fmt = (p) => (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const gbp = (p) => `${p < 0 ? "-" : ""}£${fmt(Math.abs(p))}`;
const pct = (a, b) => ((a - b) / b) * 100;
const pct1 = (x) => `${Math.abs(x).toFixed(1)}%`;
/** Cost of one measure: under a pound in pence with one decimal, else pounds. */
export const perMeasure = (p) => (p < 100 ? `${(Math.round(p * 10) / 10).toFixed(1)}p` : gbp(Math.round(p)));
const nouns = (n, w) => (n === 1 || w === "each" || w.endsWith("s") ? w : `${w}s`);
const plural = (n, w) => `${n} ${nouns(n, w)}`;

// ---------- tables ----------

/** Split a pipe table row into cells with their character ranges. */
export function cells(text) {
  const out = [];
  let at = 0;
  for (const raw of text.split("|")) {
    const lead = raw.length - raw.trimStart().length;
    const val = raw.trim();
    out.push({ val, start: at + lead, end: at + lead + val.length });
    at += raw.length + 1;
  }
  return out;
}

function stockRows(lines) {
  return lines.slice(1).map((text, i) => {
    const c = cells(text);
    const measure = /^(\d+(?:\.\d+)?)\s*(?:x\s*(25ml|35ml)|(pints?|kg|L))$/.exec(c[7].val);
    return {
      line: i + 1,
      text,
      cell: c,
      name: c[0].val,
      supplier: c[1].val,
      code: c[2].val.toUpperCase(),
      desc: c[3].val,
      buys: c[4].val,
      pack: Number(c[5].val),
      counts: c[6].val,
      measure: measure ? { count: Number(measure[1]), label: measure[2] ? `${measure[2]} measure` : measure[3] === "L" ? "litre" : measure[3].replace(/s$/, "") } : null,
      last: pence(c[8].val),
      lastInv: c[9].val,
      vat: Number(c[10].val.replace("%", "")),
    };
  });
}

function goodsRows(lines) {
  return lines.slice(1).map((text, i) => {
    const c = cells(text);
    const m = /^(\d+)\s+([A-Z]+)$/.exec(c[2].val);
    return { line: i + 1, text, cell: c, inv: c[0].val, code: c[1].val.toUpperCase(), qty: m ? Number(m[1]) : null, unit: m ? m[2] : null, by: c[3].val, note: c[4]?.val || "" };
  });
}

const cellRef = (doc, row, i, tone) => ({ doc, line: row.line, start: row.cell[i].start, end: row.cell[i].end, tone });

// ---------- sizes written in a description ----------

/**
 * Read the size words in a description: a pack count (24X, X48), a volume (70CL, 1LTR, 200ML, 30L),
 * gallons before KEG or CASK (11G KEG), and a weight (5KG, 2.5KG, 6OZ).
 * Returns { pack, ml, g, words: [{ text, start, end }] }. Words it does not know are left alone.
 */
export function sizeOf(desc) {
  const out = { pack: null, ml: null, g: null, gal: null, words: [] };
  const re = /\S+/g;
  let m;
  const toks = [];
  while ((m = re.exec(desc))) toks.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  toks.forEach((t, i) => {
    const w = t.text.toUpperCase();
    const next = (toks[i + 1]?.text || "").toUpperCase();
    let hit = false;
    let r;
    if ((r = /^(\d+)X(\d+(?:\.\d+)?)(ML|CL|LTR|L|KG|G)$/.exec(w))) {
      out.pack = Number(r[1]);
      amount(Number(r[2]), r[3], "");
      hit = true;
    } else if ((r = /^X(\d+)$/.exec(w))) {
      out.pack = Number(r[1]);
      hit = true;
    } else if ((r = /^(\d+(?:\.\d+)?)(ML|CL|LTR|L)$/.exec(w))) {
      amount(Number(r[1]), r[2], next);
      hit = true;
    } else if ((r = /^(\d+(?:\.\d+)?)G$/.exec(w)) && (next === "KEG" || next === "CASK")) {
      out.gal = Number(r[1]);
      out.ml = out.gal * ML_PER_GALLON;
      hit = true;
    } else if ((r = /^(\d+(?:\.\d+)?)(KG|G|OZ)$/.exec(w))) {
      amount(Number(r[1]), r[2], next);
      hit = true;
    }
    if (hit) out.words.push(t);
  });
  return out;

  function amount(n, unit) {
    if (unit === "ML") out.ml = n;
    else if (unit === "CL") out.ml = n * 10;
    else if (unit === "L" || unit === "LTR") out.ml = n * 1000;
    else if (unit === "KG") out.g = n * 1000;
    else if (unit === "G") out.g = n;
    else if (unit === "OZ") out.g = n * 28.349523125;
  }
}

/** Pints in a volume, to two decimals: 11 gallons is 88, 30 litres is 52.79. */
export const pintsIn = (ml) => Math.round((ml / ML_PER_PINT) * 100) / 100;

const near = (a, b) => Math.abs(a - b) <= Math.max(a, b) * 0.005;
const sizeWords = (s) => {
  const parts = [];
  if (s.pack) parts.push(`${s.pack} to a case`);
  if (s.gal) parts.push(`${s.gal} gallons`);
  else if (s.ml) parts.push(s.ml >= 1000 ? `${+(s.ml / 1000).toFixed(2)} litre${s.ml === 1000 ? "" : "s"}` : `${+(s.ml / 10).toFixed(1)}cl`);
  if (s.g) parts.push(s.g >= 1000 ? `${+(s.g / 1000).toFixed(2)} kg` : `${Math.round(s.g)} g`);
  return parts.join(", ");
};

/** Where the two sizes disagree, as plain words. Empty when they agree on everything both state. */
export function sizeConflict(onLine, onList) {
  const out = [];
  if (onLine.pack != null && onList.pack != null && onLine.pack !== onList.pack) out.push("pack");
  if (onLine.ml != null && onList.ml != null && !near(onLine.ml, onList.ml)) out.push("volume");
  if (onLine.g != null && onList.g != null && !near(onLine.g, onList.g)) out.push("weight");
  return out;
}

// ---------- invoices ----------

const LINE_RE = /^(?:([A-Z]{2}-[A-Z0-9]+)\s+)?(.+?)\s+(\d+)\s+([A-Z]+)\s+(\d+\.\d{2})(?:\s+(\d+\.\d{2}))?(?:\s+([SZ]))?$/d;

/** One invoice line as written. Returns null if it is not a line of goods. */
export function readLine(text) {
  const m = LINE_RE.exec(text.toUpperCase());
  if (!m) return null;
  const span = (i) => (m.indices[i] ? { start: m.indices[i][0], end: m.indices[i][1] } : null);
  const unit = UNITS[m[4]];
  if (!unit) return null;
  return {
    code: m[1] || null,
    desc: text.slice(span(2).start, span(2).end),
    qty: Number(m[3]),
    unit,
    unitWritten: m[4],
    price: pence(m[5]),
    net: m[6] ? pence(m[6]) : null,
    vat: m[7] || null,
    at: { code: span(1), desc: span(2), qty: span(3), unit: span(4), price: span(5), net: span(6), vat: span(7) },
  };
}

/** Header, goods lines and printed totals of one invoice. */
export function readInvoice(doc, lines) {
  const head = /^Invoice\s+(.+?)\s+Date\s+(\d{2}\/\d{2}\/\d{4})$/.exec(lines[1] || "");
  const inv = { doc, supplier: lines[0], number: head ? head[1] : null, date: head ? head[2] : null, lines: [], totals: {} };
  lines.forEach((text, i) => {
    if (i < 4) return;
    const t = /^(Net at 20% \(S\)|VAT at 20%|Net at 0% \(Z\)|Total due)\s+(\d+\.\d{2})$/.exec(text);
    if (t) {
      const key = { "Net at 20% (S)": "netS", "VAT at 20%": "vatS", "Net at 0% (Z)": "netZ", "Total due": "total" }[t[1]];
      inv.totals[key] = { value: pence(t[2]), line: i, start: text.length - t[2].length, end: text.length };
      return;
    }
    const l = readLine(text);
    if (l) inv.lines.push({ ...l, doc, line: i, text });
  });
  return inv;
}

/** Recompute an invoice's totals from its own lines and compare with what it prints. */
export function checkTotals(inv) {
  const sum = (rate) => inv.lines.filter((l) => l.vat === rate).reduce((t, l) => t + l.net, 0);
  const netS = sum("S");
  const netZ = sum("Z");
  const vatS = Math.round(netS * 0.2);
  const want = { netS, vatS, netZ, total: netS + vatS + netZ };
  const rows = [];
  let ok = true;
  for (const k of ["netS", "vatS", "netZ", "total"]) {
    const printed = inv.totals[k];
    if (!printed && want[k] === 0) continue;
    const match = printed ? printed.value === want[k] : false;
    if (!match) ok = false;
    rows.push({ key: k, want: want[k], printed: printed ? printed.value : null, match, ref: printed ? { doc: inv.doc, line: printed.line, start: printed.start, end: printed.end, tone: match ? "pass" : "fail" } : null });
  }
  return { ok, rows, want };
}

// ---------- one line ----------

/**
 * Check one invoice line. ctx = { stock, goods, invoice (number or null) }.
 * pick = the manager's choice for this line, if any.
 * Returns the line with state "pass" (ready), "fail" (held: two things disagree),
 * "none" (held: something is missing), or "queried" (the manager sent it back).
 */
export function checkLine(L, ctx, pick = null) {
  const r = {
    n: L.n,
    doc: L.doc,
    line: L.line,
    text: L.text,
    inv: L,
    refs: [],
    srcRefs: [],
    facts: [],
    options: [],
    item: null,
    state: "pass",
    ready: false,
    kind: null,
    why: "",
    short: "",
    settled: null,
  };
  const at = (k, tone = "pass") => (L.at[k] ? { doc: L.doc, line: L.line, start: L.at[k].start, end: L.at[k].end, tone } : null);
  const push = (...refs) => r.refs.push(...refs.filter(Boolean));
  const hold = (state, kind, why, short, options = []) => {
    r.state = state;
    r.kind = kind;
    r.why = why;
    r.short = short;
    r.options = options;
    return r;
  };

  // 1. The line adds up.
  push(at("qty"), at("price"));
  if (L.qty === 0) {
    r.refs[0].tone = "none";
    return hold("none", "zero", "The quantity is 0. Nothing to stock; a credit or a cancelled line is a question for the supplier.", "Quantity is 0");
  }
  if (L.net == null) return hold("none", "unread", "No line total on this line, so the sum cannot be checked.", "No line total");
  const sum = L.qty * L.price;
  if (sum !== L.net) {
    push(at("net", "fail"));
    r.refs.find((x) => x.start === L.at.qty.start).tone = "fail";
    r.refs.find((x) => x.start === L.at.price.start).tone = "fail";
    return hold("fail", "sum", `${L.qty} x ${gbp(L.price)} is ${gbp(sum)}. The line says ${gbp(L.net)}.`, `Line says ${gbp(L.net)}, sum is ${gbp(sum)}`);
  }
  push(at("net"));
  r.facts.push(["Line total", `${L.qty} x ${gbp(L.price)} = ${gbp(L.net)}`]);

  // 2. One stock item.
  let row = L.code ? ctx.stock.find((s) => s.code === L.code.toUpperCase()) : null;
  const newItem = pick?.item === "new";
  if (row) {
    push(at("code"));
    r.srcRefs.push(cellRef("stock", row, 2), cellRef("stock", row, 0));
    r.facts.push(["Item", `${row.name}, code ${row.code} on your stock list`]);
  } else if (!newItem) {
    const byDesc = ctx.stock.find((s) => s.desc.toUpperCase() === L.desc.toUpperCase().replace(/\s+/g, " "));
    push(at("code", "none"), at("desc", "none"));
    if (byDesc) {
      if (pick?.item === "map") {
        row = byDesc;
        r.srcRefs.push(cellRef("stock", row, 3), cellRef("stock", row, 0));
        r.facts.push(["Item", `${row.name}, mapped by the manager on its description`]);
        r.settled = "Mapped by the manager";
      } else {
        r.srcRefs.push(cellRef("stock", byDesc, 3, "none"));
        return hold(
          "none",
          "map",
          L.code ? `Code ${L.code} is not on your stock list. The description is word for word your ${byDesc.name} (${byDesc.code}).` : `No code on the line. The description is word for word your ${byDesc.name} (${byDesc.code}).`,
          `No code match; description fits ${byDesc.code}`,
          [
            { pick: { item: "map" }, label: `Map it to ${byDesc.name}`, note: `Code ${byDesc.code}` },
            { pick: { item: "query" }, label: "Query with the supplier", note: "Keep the line off the stock update" },
          ],
        );
      }
    } else {
      return hold(
        "none",
        "notfound",
        L.code ? `No item on your stock list has code ${L.code} or this description.` : "No code on the line, and no item on your stock list has this description.",
        "Not on your stock list",
        [
          { pick: { item: "new" }, label: `Add it as a new item`, note: `${plural(L.qty, L.unit === "CASK" ? "cask" : L.unit === "KEG" ? "keg" : L.unit === "BTL" ? "bottle" : L.unit === "CS" ? "case" : "unit")} at ${gbp(L.price)}${sizeOf(L.desc).ml && /CASK|KEG/.test(L.unit) ? `, ${pintsIn(sizeOf(L.desc).ml)} pints each` : ""}` },
          { pick: { item: "query" }, label: "Query with the supplier", note: "Keep the line off the stock update" },
        ],
      );
    }
  }
  if (pick?.item === "query") return query(r, "Queried with the supplier");

  if (newItem) {
    const s = sizeOf(L.desc);
    const pints = s.ml && /CASK|KEG/.test(L.unit) ? pintsIn(s.ml) : null;
    r.item = { name: titleCase(L.desc), code: L.code, isNew: true, counts: L.unit === "CASK" ? "cask" : L.unit === "KEG" ? "keg" : L.unit.toLowerCase(), pack: 1, measure: pints ? { count: pints, label: "pint" } : null, vat: VAT[L.vat] };
    r.facts.push(["Item", `New item, ${r.item.name}, added by the manager`]);
    return finish(r, L, r.item, L.qty, "Added as a new item by the manager", ctx);
  }

  // 3. The size on the line is the size on the list.
  const onLine = sizeOf(L.desc);
  const onList = sizeOf(row.desc);
  const conflict = sizeConflict(onLine, onList);
  const sizeRefs = onLine.words.map((w) => ({ doc: L.doc, line: L.line, start: L.at.desc.start + w.start, end: L.at.desc.start + w.end }));
  if (conflict.length && pick?.size !== "new") {
    push(...sizeRefs.map((x) => ({ ...x, tone: "fail" })));
    r.srcRefs.push(...onList.words.map((w) => ({ doc: "stock", line: row.line, start: row.cell[3].start + w.start, end: row.cell[3].start + w.end, tone: "fail" })));
    let money = "";
    if (conflict.includes("volume") && onLine.ml && onList.ml && !onLine.pack && row.pack === 1) {
      const perL = (p, ml) => (p * 1000) / ml;
      const was = perL(row.last, onList.ml);
      const now = perL(L.price, onLine.ml);
      const byBottle = pct(L.price, row.last);
      const byLitre = pct(now, was);
      money = ` By the bottle that is ${byBottle >= 0 ? "up" : "down"} ${pct1(byBottle)} on ${gbp(row.last)}. By the litre it is ${gbp(Math.round(now))} against ${gbp(Math.round(was))}, ${byLitre >= 0 ? "up" : "down"} ${pct1(byLitre)}.`;
      r.perLitre = { was: Math.round(was), now: Math.round(now), byBottle, byLitre };
    }
    const shortTxt = conflict.includes("volume") && r.perLitre ? `Billed as your ${sizeWords(onList)}, written ${sizeWords(onLine)}` : `Size on the line is not the size on your list`;
    return hold(
      "fail",
      "size",
      `Code ${row.code} is your ${row.name}. This line says ${sizeWords(onLine)}.${money}`,
      shortTxt,
      [
        { pick: { size: "new" }, label: `Stock it as a new item`, note: `${titleCase(L.desc)}, ${plural(L.qty, "bottle")} at ${gbp(L.price)}${onLine.ml && row.measure && /ml measure/.test(row.measure.label) ? `, ${Math.floor(onLine.ml / Number(row.measure.label.slice(0, 2)))} x ${row.measure.label.slice(0, 4)}` : ""}` },
        { pick: { size: "query" }, label: "Query with the supplier", note: "Keep the line off the stock update" },
      ],
    );
  }
  if (pick?.size === "query") return query(r, "Queried with the supplier");
  let item = row;
  if (conflict.length && pick?.size === "new") {
    const per = row.measure && /ml measure/.test(row.measure.label) ? Number(row.measure.label.slice(0, 2)) : null;
    item = { ...row, name: titleCase(L.desc), isNew: true, measure: per && onLine.ml ? { count: Math.floor(onLine.ml / per), label: row.measure.label } : null };
    r.settled = "Stocked as a new item by the manager";
    r.facts.push(["Size", `${sizeWords(onLine)}, a new item next to ${row.name}`]);
  } else if (sizeRefs.length) {
    push(...sizeRefs);
    const same = onLine.ml && onList.ml && onLine.ml !== onList.ml ? `. ${onLine.words.map((w) => w.text).join(" ")} on the line, ${onList.words.map((w) => w.text).join(" ")} on your list: ${(onLine.ml / 1000).toFixed(2)} and ${(onList.ml / 1000).toFixed(2)} litres, the same size` : "";
    r.facts.push(["Size", `${sizeWords(onLine)}, as your list${same}`]);
  }

  // 4. The unit is the unit you buy it in.
  if (L.unit !== row.buys) {
    push({ ...at("unit"), tone: "fail" });
    r.srcRefs.push(cellRef("stock", row, 4, "fail"));
    return hold("fail", "unit", `The invoice charges by ${L.unitWritten}. Your list buys ${row.name} by ${row.buys}${row.pack > 1 ? ` of ${row.pack}` : ""}. Which one is meant is a question for the supplier.`, `Charged by ${L.unitWritten}, you buy by ${row.buys}`);
  }
  push(at("unit"));
  r.srcRefs.push(cellRef("stock", row, 4), cellRef("stock", row, 5));

  // 5. VAT rate.
  if (!L.vat) {
    push(at("desc", "none"));
    r.srcRefs.push(cellRef("stock", row, 10, "none"));
    return hold("none", "vat", `No VAT code on the line. Your list has ${row.vat}% for ${row.name}.`, "No VAT code on the line", [
      { pick: { vat: "list" }, label: `Use ${row.vat}% from your list`, note: "Flag the invoice for accounts" },
      { pick: { vat: "query" }, label: "Query with the supplier", note: "Keep the line off the stock update" },
    ]);
  }
  if (VAT[L.vat] !== row.vat && !item.isNew) {
    if (pick?.vat === "query") return query(r, "Queried with the supplier");
    if (pick?.vat !== "stock") {
      push({ ...at("vat"), tone: "fail" });
      r.srcRefs.push(cellRef("stock", row, 10, "fail"));
      const at20 = Math.round((L.net * row.vat) / 100) - Math.round((L.net * VAT[L.vat]) / 100);
      return hold(
        "fail",
        "vat",
        `The invoice codes this ${L.vat}, ${VAT[L.vat]}% VAT. Your list has ${row.vat}% for ${row.name}. At ${row.vat}% the VAT on this line is ${gbp(Math.abs(at20))}, and the invoice ${at20 > 0 ? "charges none" : "charges more"}.`,
        `Invoice ${VAT[L.vat]}% VAT, your list ${row.vat}%`,
        [
          { pick: { vat: "stock" }, label: "Stock it, flag the VAT for accounts", note: `Stock cost is the net ${gbp(L.net)} either way` },
          { pick: { vat: "query" }, label: "Query with the supplier", note: "Keep the line off the stock update" },
        ],
      );
    }
    r.facts.push(["VAT", `Invoice ${L.vat} (${VAT[L.vat]}%), your list ${row.vat}%. Flagged for accounts by the manager`]);
    r.settled = "Stocked by the manager, VAT flagged for accounts";
  } else {
    push(at("vat"));
    r.srcRefs.push(cellRef("stock", row, 10));
    r.facts.push(["VAT", `${L.vat}, ${VAT[L.vat]}%, as your list`]);
  }

  // 6. What came through the door.
  let qty = L.qty;
  if (ctx.invoice) {
    const g = ctx.goods.find((x) => x.inv === ctx.invoice && x.code === row.code);
    if (!g) {
      return hold("none", "goods", `No goods-in entry for ${row.code} on ${ctx.invoice}. Count what arrived before stocking it.`, "No goods-in entry");
    }
    if (g.qty < L.qty && !pick?.goods) {
      r.refs = r.refs.map((x) => (x.start === L.at.qty.start ? { ...x, tone: "fail" } : x));
      r.srcRefs.push(cellRef("goods", g, 2, "fail"));
      if (g.note) r.srcRefs.push(cellRef("goods", g, 4, "fail"));
      const gap = L.qty - g.qty;
      return hold(
        "fail",
        "goods",
        `Charged for ${L.qty} ${L.unit}, ${g.qty} received at the door. ${plural(gap, L.unit === "CS" ? "case" : L.unit.toLowerCase())} short: ${gbp(gap * L.price)} net, ${gbp(gap * L.price + Math.round((gap * L.price * VAT[L.vat]) / 100))} with VAT.`,
        `Charged ${L.qty} ${L.unit}, ${g.qty} received`,
        [
          { pick: { goods: "received" }, label: `Stock the ${g.qty} received, query ${gap}`, note: `${gbp(g.qty * L.price)} to stock, ${gbp(gap * L.price)} to query` },
          { pick: { goods: "all" }, label: `Stock all ${L.qty}`, note: "Only if the rest arrived later" },
        ],
      );
    }
    if (g.qty > L.qty && !pick?.goods) {
      r.srcRefs.push(cellRef("goods", g, 2, "none"));
      return hold("none", "goods", `${g.qty} ${g.unit} received, ${L.qty} charged.`, `Received ${g.qty}, charged ${L.qty}`, [
        { pick: { goods: "all" }, label: `Stock the ${L.qty} charged`, note: "The extra waits for its own invoice" },
      ]);
    }
    if (pick?.goods === "received") {
      qty = g.qty;
      r.settled = `${g.qty} stocked, ${L.qty - g.qty} queried, by the manager`;
    } else if (pick?.goods === "all") {
      r.settled = `All ${L.qty} stocked by the manager`;
    }
    r.srcRefs.push(cellRef("goods", g, 2));
    r.facts.push(["Goods in", `${g.qty} ${g.unit} received, checked by ${g.by}${pick?.goods ? `; ${r.settled}` : ""}`]);
  } else {
    r.facts.push(["Goods in", "Not checked for pasted lines"]);
  }

  // 7. The price against the last invoice.
  if (!item.isNew && L.price !== row.last) {
    if (pick?.price === "query") return query(r, "Queried with the supplier");
    const ch = pct(L.price, row.last);
    const per = row.measure ? `, ${perMeasure(Math.abs(L.price - row.last) / row.measure.count)} a ${row.measure.label}` : row.pack > 1 ? `, ${perMeasure(Math.abs(L.price - row.last) / row.pack)} a ${row.counts}` : "";
    if (pick?.price !== "accept") {
      push({ ...at("price"), tone: "none" });
      r.refs = r.refs.filter((x) => !(x.start === L.at.price.start && x.tone === "pass"));
      r.srcRefs.push(cellRef("stock", row, 8, "none"), cellRef("stock", row, 9, "none"));
      r.change = { from: row.last, to: L.price, pct: ch };
      return hold(
        "none",
        "price",
        `${gbp(L.price)} a ${unitWord(row)}, ${ch >= 0 ? "up" : "down"} ${pct1(ch)} on ${gbp(row.last)} (${row.lastInv})${per}.`,
        `${ch >= 0 ? "Up" : "Down"} ${pct1(ch)} on the last invoice${per}`,
        [
          { pick: { price: "accept" }, label: `Accept ${gbp(L.price)} as the new cost`, note: `Your list changes from ${gbp(row.last)}` },
          { pick: { price: "query" }, label: "Query with the supplier", note: "Keep the line off the stock update" },
        ],
      );
    }
    r.settled = r.settled || "New cost accepted by the manager";
    r.facts.push(["Price", `${gbp(L.price)} a ${unitWord(row)}, new cost accepted (was ${gbp(row.last)}, ${row.lastInv})`]);
    r.srcRefs.push(cellRef("stock", row, 8));
  } else if (!item.isNew) {
    r.srcRefs.push(cellRef("stock", row, 8), cellRef("stock", row, 9));
    r.facts.push(["Price", `${gbp(L.price)} a ${unitWord(row)}, same as ${row.lastInv}`]);
  }

  return finish(r, L, item, qty, r.settled, ctx);
}

function finish(r, L, item, qty, settled, _ctx) {
  r.item = item;
  r.qty = qty;
  r.units = qty * (item.pack || 1);
  r.costPerUnit = L.price / (item.pack || 1);
  r.value = qty * L.price;
  r.state = "pass";
  r.ready = true;
  r.settled = settled || null;
  const conv = (item.pack || 1) > 1 ? `${qty} ${L.unit} x ${item.pack} = ${plural(r.units, item.counts)}` : `${plural(qty, item.counts)}`;
  r.facts.push(["Into stock", conv]);
  if ((item.pack || 1) > 1) r.facts.push(["Cost each", `${gbp(L.price)} / ${item.pack} = ${perMeasure(L.price / item.pack)} ${item.counts === "each" ? "each" : `a ${item.counts}`}`]);
  if (item.measure) r.facts.push(["Cost per measure", `${gbp(L.price)} / ${item.measure.count} = ${perMeasure(L.price / item.measure.count)} a ${item.measure.label}`]);
  r.facts.push(["Stock value", `${qty} x ${gbp(L.price)} = ${gbp(r.value)}`, true]);
  r.short = `${conv.replace(/^.* = /, "")}, ${gbp(r.value)}`;
  return r;
}

function query(r, why) {
  r.state = "queried";
  r.kind = "queried";
  r.why = why;
  r.short = "Queried, kept off the stock update";
  r.settled = why;
  r.options = [];
  return r;
}

const unitWord = (row) => ({ BTL: "bottle", CS: "case", KEG: "keg", CASK: "cask", EA: row.counts }[row.buys] || "unit");
const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(/\b(\d+(?:\.\d+)?)(ltr|l|cl|ml|kg|g)\b/g, (_, n, u) => `${n}${u === "ltr" ? "L" : u === "l" ? "L" : u}`)
    .replace(/\bipa\b/g, "IPA");

// ---------- the whole sample ----------

export function checkAll(sample, picks = {}) {
  const stock = stockRows(sample.stock);
  const goods = goodsRows(sample.goods);
  const invoices = INVOICE_DOCS.map((d) => readInvoice(d, sample[d]));
  const lines = [];
  let n = 0;
  for (const inv of invoices) {
    for (const L of inv.lines) {
      n += 1;
      L.n = n;
      L.invoice = inv;
      const r = checkLine(L, { stock, goods, invoice: inv.number }, picks[n] || null);
      r.invoiceNo = inv.number;
      r.supplier = inv.supplier;
      lines.push(r);
    }
  }
  const totals = invoices.map((inv) => ({ inv, ...checkTotals(inv) }));
  const ready = lines.filter((l) => l.ready);
  const queried = lines.filter((l) => l.state === "queried");
  // The manager sees what disagrees first, then what is missing, then new prices.
  const order = ["size", "goods", "vat", "unit", "sum", "notfound", "map", "zero", "unread", "price"];
  const held = lines.filter((l) => !l.ready && l.state !== "queried").sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.n - b.n);
  return { lines, ready, held, queried, totals, stock, goods, value: ready.reduce((t, l) => t + l.value, 0) };
}

/** Pasted invoice lines, checked against the same stock list. Goods in is not checked. */
export function checkPasted(text, sample) {
  const stock = stockRows(sample.stock);
  const goods = goodsRows(sample.goods);
  const out = [];
  const seen = new Map();
  text
    .split(/\r?\n/)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 40)
    .forEach((t, i) => {
      const L0 = readLine(t);
      const n = i + 1;
      if (!L0) {
        out.push({ n, doc: "paste", line: i, text: t, state: "none", kind: "unread", ready: false, why: "Not read. A line needs: code (optional), description, quantity, unit (BTL, CS, KEG, CASK or EA), price, line total and VAT code (S or Z).", short: "Not read", refs: [], srcRefs: [], facts: [], options: [] });
        return;
      }
      const L = { ...L0, n, doc: "paste", line: i, text: t };
      const r = checkLine(L, { stock, goods, invoice: null }, null);
      const key = t.toUpperCase();
      if (seen.has(key)) r.dupe = seen.get(key);
      else seen.set(key, n);
      out.push(r);
    });
  return out;
}

/** The approved stock update as a generic CSV. */
export function stockCsv(result) {
  const num = (p) => (p / 100).toFixed(2);
  const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const rows = [["invoice", "supplier code", "stock item", "qty", "buy unit", "stock units", "counts in", "cost per buy unit", "net", "settled by manager"]];
  for (const l of result.ready) {
    rows.push([l.invoiceNo, l.inv.code || "", l.item.name + (l.item.isNew ? " (new)" : ""), l.qty, l.inv.unit, l.units, l.item.counts, num(l.inv.price), num(l.value), l.settled || ""]);
  }
  rows.push(["", "", "Total stock value (net, ex VAT)", "", "", "", "", "", num(result.value), ""]);
  return "# Sample data. Made-up pub, suppliers, codes and prices.\n" + rows.map((r) => r.map(q).join(",")).join("\n") + "\n";
}
