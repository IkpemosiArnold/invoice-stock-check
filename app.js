import { checkAll, checkPasted, stockCsv, gbp, DOC_NAMES, INVOICE_DOCS, TABLE_DOCS } from "./check.js?v=1";
import { sample, pasteExample } from "./samples.js?v=1";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const icon = (name) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
};
const glyph = { pass: "check", fail: "cross", none: "none", queried: "none" };
const wide = window.matchMedia("(min-width: 960px)");
const word = (l) =>
  l.ready ? "Ready" : l.state === "queried" ? "Queried" : l.kind === "notfound" ? "Not found" : l.kind === "unread" ? "Not read" : l.kind === "price" ? "New price" : "Held";
const supplierShort = (l) => (l.supplier || "").split(" ")[0].replace(/^\w+/, (w) => w[0] + w.slice(1).toLowerCase());

let picks = {};
let approved = false;
let openId = null;
let firstRender = true;
let pasted = [];
let pastedOpen = null;

function markedLine(text, ranges) {
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start < at) continue;
    frag.append(text.slice(at, r.start), el("span", `u ${r.tone || "pass"}`, text.slice(r.start, r.end)));
    at = r.end;
  }
  frag.append(text.slice(at));
  return frag;
}

function sources(docs, refs) {
  const box = el("div", "srcs");
  const by = new Map();
  for (const r of refs) {
    if (!(r.end > r.start)) continue;
    const k = `${r.doc}:${r.line}`;
    if (!by.has(k)) by.set(k, { doc: r.doc, line: r.line, ranges: [] });
    const g = by.get(k);
    if (!g.ranges.some((x) => x.start === r.start && x.end === r.end)) g.ranges.push(r);
  }
  const order = [...INVOICE_DOCS, "paste", "stock", "goods"];
  for (const s of [...by.values()].sort((a, b) => order.indexOf(a.doc) - order.indexOf(b.doc) || a.line - b.line)) {
    const f = el("div", "src");
    const isTable = TABLE_DOCS.includes(s.doc);
    const label = s.doc === "paste" ? `Your line ${s.line + 1}` : `${DOC_NAMES[s.doc]}, ${isTable ? "row" : "line"} ${isTable ? s.line : s.line + 1}`;
    f.append(el("p", "src-h", label));
    const p = el("p", "src-line");
    p.append(markedLine(docs[s.doc][s.line], s.ranges));
    f.append(p);
    box.append(f);
  }
  return box;
}

const draw = (node) => requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("drawn")));

function calcRows(pairs) {
  const dl = el("dl", "calc");
  for (const [l, v, strong] of pairs) {
    const r = el("div", `cl-row${strong ? " strong" : ""}`);
    r.append(el("dt", "cl-l", l), el("dd", "cl-v", v));
    dl.append(r);
  }
  return dl;
}

function title(l) {
  if (l.ready) return `Ready, ${gbp(l.value)}`;
  if (l.state === "queried") return "Queried with the supplier";
  if (l.kind === "notfound") return "Not on your stock list";
  if (l.kind === "unread") return "Not read";
  if (l.kind === "price") return "New price";
  return "Held for the manager";
}

function detail(l, docs, { own = false } = {}) {
  const box = el("div", "evidence");
  box.append(el("p", "side-h", own ? `Your line ${l.n}` : `${supplierShort(l)}, invoice ${l.invoiceNo}`));
  box.append(el("p", `side-title st-${l.state === "queried" ? "none" : l.state}`, title(l)));

  if (!l.ready) {
    const why = el("p", "reason");
    const g = icon(glyph[l.state]);
    g.style.color = `var(--${l.state === "queried" ? "muted" : l.state})`;
    why.append(g, el("span", null, l.why));
    box.append(why);
  }
  if (own && l.dupe) box.append(el("p", "tool-sub", `Same line as your line ${l.dupe}. Checked again, not merged.`));

  box.append(el("p", "ev-h", "What the invoice says"));
  if (l.refs.length) box.append(sources(docs, l.refs));
  else box.append(el("p", "src-line", docs[l.doc][l.line]));

  if (l.facts.length) {
    box.append(el("p", "ev-h", l.ready ? "The stock line" : "What checked out"));
    box.append(calcRows(l.facts));
  }

  if (l.srcRefs.length) {
    box.append(el("p", "ev-h", l.ready ? "The rows it used" : "The rows it looked at"));
    box.append(sources(docs, l.srcRefs));
  }

  if (!l.ready && l.options.length && !own && l.state !== "queried") {
    box.append(el("p", "ev-h", "The manager decides"));
    const ch = el("div", "choices");
    for (const o of l.options) {
      const b = el("button", "btn");
      b.type = "button";
      b.append(el("span", null, o.label), el("small", null, o.note));
      b.addEventListener("click", () => {
        picks[l.n] = { ...(picks[l.n] || {}), ...o.pick };
        approved = false;
        render({ keep: true });
      });
      ch.append(b);
    }
    box.append(ch);
  }
  if (!l.ready && l.options.length && own) {
    box.append(el("p", "ev-h", "What the manager would choose from"));
    box.append(el("p", "tool-sub", l.options.map((o) => o.label).join(", or ")));
  }
  if (l.settled && picks[l.n] && !own) {
    const p = el("p", "picked");
    p.append(icon(l.ready ? "check" : "none"), l.settled);
    const undo = el("button", "btn text", "Undo");
    undo.type = "button";
    undo.addEventListener("click", () => {
      delete picks[l.n];
      approved = false;
      render({ keep: true });
    });
    box.append(p, undo);
  }
  draw(box);
  return box;
}

function totalsDetail(t, docs) {
  const box = el("div", "evidence");
  box.append(el("p", "side-h", DOC_NAMES[t.inv.doc]));
  box.append(el("p", `side-title st-${t.ok ? "pass" : "fail"}`, t.ok ? "The totals add up" : "The totals do not add up"));
  const names = { netS: "Net at 20%", vatS: "VAT at 20%", netZ: "Net at 0%", total: "Total due" };
  box.append(el("p", "ev-h", "Summed from its own lines"));
  box.append(
    calcRows(
      t.rows.map((r) => [names[r.key], r.printed == null ? `${gbp(r.want)}, not printed on the invoice` : r.match ? `${gbp(r.want)}, as printed` : `${gbp(r.want)}; the invoice prints ${gbp(r.printed)}`, r.key === "total"]),
    ),
  );
  box.append(el("p", "ev-h", "What the invoice prints"));
  box.append(sources(docs, t.rows.map((r) => r.ref).filter(Boolean)));
  box.append(el("p", "tool-sub", "VAT is worked out on each rate's net total and rounded to the penny."));
  draw(box);
  return box;
}

function row(l, docs, { own = false, isOpen, onToggle }) {
  const item = el("div", "row-item");
  item.dataset.id = String(l.n);
  const b = el("button", "row");
  b.type = "button";
  b.setAttribute("aria-expanded", String(isOpen));
  const st = l.state === "queried" ? "queried" : l.state;
  const s = el("span", `status st-${st}`);
  s.append(icon(glyph[l.state]), el("span", null, word(l)));
  const v = el("span", "val");
  v.append(el("b", null, l.inv ? `${l.inv.desc}` : l.text));
  const where = own ? "" : `${supplierShort(l)}, `;
  v.append(el("span", `meta${l.ready ? "" : ` st-${st}`}`, `${where}${l.short}${l.ready && l.settled ? ", settled by the manager" : ""}`));
  const chev = icon("chev");
  chev.classList.add("chev");
  b.append(s, v, chev);
  item.append(b);
  b.addEventListener("click", onToggle);
  if (isOpen && (own || !wide.matches)) {
    const d = detail(l, docs, { own });
    d.classList.add("enter");
    item.append(d);
  }
  return item;
}

function totalsRow(t, isOpen, onToggle) {
  const item = el("div", "row-item");
  item.dataset.id = t.inv.doc;
  const b = el("button", "row");
  b.type = "button";
  b.setAttribute("aria-expanded", String(isOpen));
  const s = el("span", `status st-${t.ok ? "pass" : "fail"}`);
  s.append(icon(t.ok ? "check" : "cross"), el("span", null, t.ok ? "Adds up" : "Off"));
  const v = el("span", "val");
  v.append(el("b", "plain", `${t.inv.supplier.replace(/\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} ${t.inv.number}`));
  v.append(el("span", "meta", `${t.inv.lines.length} lines, ${gbp(t.want.total)} with VAT, ${t.inv.date}`));
  const chev = icon("chev");
  chev.classList.add("chev");
  b.append(s, v, chev);
  item.append(b);
  b.addEventListener("click", onToggle);
  if (isOpen && !wide.matches) {
    const d = totalsDetail(t, sample);
    d.classList.add("enter");
    item.append(d);
  }
  return item;
}

function scrollTo(scope, id) {
  const n = scope.querySelector(`.row-item[data-id="${id}"]`);
  if (!n) return;
  const top = n.getBoundingClientRect().top;
  if (top < 0 || top > innerHeight * 0.6) n.scrollIntoView({ block: "start", behavior: "smooth" });
}

function render({ keep = false } = {}) {
  const r = checkAll(sample, picks);
  const sum = $("summary");
  sum.replaceChildren(
    el("span", "sum-main", `${r.ready.length} of ${r.lines.length} lines ready`),
    el("span", "sum-side", `${gbp(r.value)} net`),
    el("span", "sum-side muted", r.held.length ? `${r.held.length} for the manager` : "nothing waiting"),
  );
  const groups = $("groups");
  groups.replaceChildren();
  const toggle = (id) => () => {
    openId = openId === id && !wide.matches ? null : id;
    render({ keep: true });
    if (!wide.matches && openId != null) scrollTo(groups, id);
  };
  for (const [name, list] of [["For the manager", r.held], ["Ready to stock", r.ready], ["Queried with the supplier", r.queried]]) {
    if (!list.length) continue;
    groups.append(el("p", "group-h", `${name} (${list.length})`));
    const rows = el("div", "rows");
    if (!firstRender && !keep) rows.classList.add("fresh");
    for (const l of list) rows.append(row(l, sample, { isOpen: openId === l.n, onToggle: toggle(l.n) }));
    groups.append(rows);
  }
  groups.append(el("p", "group-h", `Invoice totals (${r.totals.length})`));
  const trows = el("div", "rows");
  for (const t of r.totals) trows.append(totalsRow(t, openId === t.inv.doc, toggle(t.inv.doc)));
  groups.append(trows);

  const side = $("side");
  side.replaceChildren();
  if (wide.matches) {
    const all = [...r.held, ...r.ready, ...r.queried];
    let l = all.find((x) => x.n === openId);
    const t = r.totals.find((x) => x.inv.doc === openId);
    if (!l && !t) {
      l = all[0];
      openId = l.n;
      groups.querySelector(`.row-item[data-id="${l.n}"] .row`)?.setAttribute("aria-expanded", "true");
    }
    const box = t ? totalsDetail(t, sample) : detail(l, sample);
    box.classList.add("enter");
    side.append(box);
  }
  const n = r.ready.length;
  const h = r.held.length;
  $("update-sub").textContent = approved
    ? `Approved: ${n} line${n === 1 ? "" : "s"}, ${gbp(r.value)} net into stock. The file is a generic CSV. Nothing is sent from here.`
    : `${n} line${n === 1 ? "" : "s"}, ${gbp(r.value)} net. ${h ? `${h} line${h === 1 ? " stays" : "s stay"} out until the manager settles ${h === 1 ? "it" : "them"}.` : "Nothing is waiting."}${r.queried.length ? ` ${r.queried.length} queried.` : ""}`;
  $("approve").disabled = approved || !n;
  $("approve").textContent = approved ? "Approved" : `Approve ${n} ready line${n === 1 ? "" : "s"}`;
  $("dl").disabled = !approved;
  firstRender = false;
}

function renderPasted() {
  const out = $("own-out");
  out.replaceChildren();
  if (!pasted.length) return;
  const docs = { ...sample, paste: pasted.map((l) => l.text) };
  const ok = pasted.filter((l) => l.ready);
  out.append(el("p", "group-h", `${ok.length} of ${pasted.length} ready${ok.length ? `, ${gbp(ok.reduce((t, l) => t + l.value, 0))} net` : ""}. Tap a line for its source.`));
  const rows = el("div", "rows");
  for (const l of pasted) {
    rows.append(
      row(l, docs, {
        own: true,
        isOpen: pastedOpen === l.n,
        onToggle: () => {
          pastedOpen = pastedOpen === l.n ? null : l.n;
          renderPasted();
        },
      }),
    );
  }
  out.append(rows);
}

function renderSources() {
  const out = $("src-out");
  out.replaceChildren();
  const box = el("div", "docs");
  for (const d of [...INVOICE_DOCS, ...TABLE_DOCS]) {
    const doc = el("div", "doc");
    doc.append(el("p", "doc-h", DOC_NAMES[d]));
    const body = el("div", "doc-body");
    const isTable = TABLE_DOCS.includes(d);
    sample[d].forEach((text, i) => {
      const p = el("p");
      p.append(el("span", "ln", isTable ? (i === 0 ? "" : String(i)) : String(i + 1)), el("span", null, text));
      body.append(p);
    });
    doc.append(body);
    box.append(doc);
  }
  out.append(box);
}

$("why-btn").addEventListener("click", () => {
  const c = $("chain");
  c.hidden = !c.hidden;
  $("why-btn").setAttribute("aria-expanded", String(!c.hidden));
});
$("approve").addEventListener("click", () => {
  approved = true;
  render({ keep: true });
});
$("dl").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([stockCsv(checkAll(sample, picks))], { type: "text/csv" }));
  a.download = "stock-update-sample.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$("reset").addEventListener("click", () => {
  picks = {};
  approved = false;
  openId = null;
  render();
});
$("own-sample").addEventListener("click", () => {
  $("own-in").value = pasteExample;
  $("own-check").click();
});
$("own-check").addEventListener("click", () => {
  const err = $("own-error");
  err.hidden = true;
  const text = $("own-in").value;
  if (!text.trim()) {
    pasted = [];
    renderPasted();
    err.textContent = "Nothing to check yet. Paste a line such as: PD-1102 HOUSE VODKA 70CL 6 BTL 13.40 80.40 S";
    err.hidden = false;
    return;
  }
  pasted = checkPasted(text, sample);
  pastedOpen = (pasted.find((l) => !l.ready) || pasted[0]).n;
  renderPasted();
});
$("src-btn").addEventListener("click", () => {
  const out = $("src-out");
  out.hidden = !out.hidden;
  $("src-btn").setAttribute("aria-expanded", String(!out.hidden));
  $("src-btn").textContent = out.hidden ? "Show them" : "Hide them";
  if (!out.hidden && !out.childElementCount) renderSources();
});
wide.addEventListener("change", () => render({ keep: true }));
render();
