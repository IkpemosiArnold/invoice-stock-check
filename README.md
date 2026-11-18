# Stock In

A pub's supplier invoices come in every week. This page takes three of them into stock, one line at a time, and checks each line in plain code against the pub's own stock list and the goods-in sheet filled in at the door. Cases become bottles, kegs and casks show the cost of a pint, spirits the cost of a 25ml measure. Every figure links to the invoice line and the stock-list row it came from. What the checks cannot settle waits for the manager with the reason and the choices. Nothing is guessed.

It is plain code. There is no model in it. The sample is made up.

## What it does

Three invoices, as the text a PDF gives when you copy it out: a drinks wholesaler, a brewery and a foodservice supplier. Two tables stand in for the pub's own system: a stock list (item, supplier code, supplier description, the unit it is bought in, pack size, what it is counted in, the measure, the last cost and the VAT rate) and a goods-in sheet (what was counted off the van, and by whom).

A line is ready to stock only when all of these hold:

1. **It adds up.** Quantity times price is the line total printed on the invoice. A quantity of 0 is held.
2. **One item.** The supplier's code is on the stock list. A line with no code, or a code the list does not have, is held even when its description matches an item word for word; the manager maps it. A line whose code and description are both unknown is not found.
3. **The size is the size on the list.** Pack counts (24X, X48), volumes (70CL, 1LTR, 30L), gallons before KEG or CASK (11G KEG) and weights (5KG, 6OZ) are read from the description and compared with the item's own description. Half a percent is allowed, so 50L and 11G read as the same keg. A different size is held, with the change per bottle and per litre where that applies.
4. **The unit is the one you buy in.** An item bought by the case and charged by the each is held.
5. **The VAT code matches the list.** S is 20% and Z is 0%. If the invoice codes a line differently from the stock list, the line is held with the VAT at stake. Stock cost is net, so the stock value does not change either way.
6. **Goods in counted what was charged.** If fewer came through the door than the invoice charges, the line is held with the shortfall, net and with VAT.
7. **The price is the last cost.** A different price is held as a new price, with the change in percent and per measure: per 25ml for spirits, per pint for kegs and casks, per litre or kilo where the list gives one, and per bottle or each for cases.

Each invoice's printed totals are also summed from its own lines: net at each rate, VAT at 20% on the standard-rated net, rounded to the penny, and the total due.

The sample: 9 of 16 lines are ready, £680.85 net. Seven wait for the manager:

- **Premium vodka:** the code is the 70cl bottle, the line says 1 litre. By the bottle that is up 33.5% on £14.20. By the litre it is £18.95 against £20.29, down 6.6%.
- **Lager bottles:** charged for 3 cases, 2 received. One case short, £26.40 net, £31.68 with VAT.
- **Tonic water:** coded Z, 0% VAT; the stock list has 20%. £6.72 of VAT at stake.
- **Guest ale:** not on the stock list by code or description.
- **Three new prices:** gin up 5.8% (3.4p a 25ml measure), house lager up 5.0% (9.8p a pint), rapeseed oil up 7.7% (13.0p a litre).

The manager settles a held line by picking one of its choices: accept a new cost, stock a new item, stock what was received and query the rest, flag VAT for accounts, or query the line with the supplier. The pick is recorded on the line and in the export. Ready lines are approved together and download as a generic CSV. Nothing is sent from the page.

Paste your own lines into "Try your own lines". Each one comes back ready, held with the reason, or not read. No line is dropped. Goods in is not checked for pasted lines.

## Where a model would go

Real invoices arrive as PDFs, photos of crumpled paper and supplier emails, each in its own layout. A model would read those and propose, for each line, a code, a description, a quantity, a unit, a price and a VAT code. Here the invoices are already text in one fixed layout, which stands in for that step.

The proposal would then pass through the same checks, so a manager only opens the lines that need a decision, and every figure on the others already points at a source. The checks are the part that is tested: `node --test`.

## Limits

- One invoice layout is read: code, description, quantity, unit, price, line total, VAT code. Units are BTL, CS, KEG, CASK and EA.
- Credit notes, negative lines, discounts, delivery charges and keg or cask deposits are not read.
- Pints in a keg or cask are the nominal figure on the stock list (88 to an 11 gallon keg, 72 to a 9 gallon cask, 52.79 to a 30 litre keg). Ullage, sediment and line cleaning are not taken off.
- Only two VAT codes, S at 20% and Z at 0%. The stock list's rate is taken as right; the page does not decide what HMRC would say about an item. VAT is worked out per rate on the invoice total, not line by line.
- Items are matched on the supplier's code, or on a description that is word for word the one on the stock list. There is no fuzzy matching and no matching across suppliers' different names for the same product.
- The price check compares with the last cost on the stock list only. There is no contract price, no price history and no tolerance band: a 1p change is held like a 20p one.
- No recipe costs, gross profit or menu prices are touched.
- The export is a generic CSV. It is not any stock or accounting system's import format.
- The prices are made up. They were not checked against any wholesaler's list.

## Run the tests

```
node --test
```

Needs Node 20 or later. No dependencies. 20 tests cover the sample result, the arithmetic on every ready line, each invoice's printed totals (and a total that does not add up), cases into bottles, bags and each, imperial pints in kegs and casks, 25ml measures, the three new prices and their per-measure change, the 70cl code on a 1 litre line, the VAT mismatch, the short delivery, the item not found, the manager's picks and what they record, stocking all of a short line, that every reference points at the exact text it claims, reading sizes, reading lines, pasted lines (a wrong unit, no code, 50L against 11G, a bad sum, an unknown item, junk, zero, a repeat, no VAT code) and the export.

## Open the page locally

```
python3 -m http.server 8799
```

Then open http://localhost:8799. The page makes no network calls beyond its own files.

## Design

The result comes first, rows are split by hairlines, and an underline draws under the exact characters each figure came from. Red marks two things that disagree, amber marks what is not settled, green marks what was checked and holds. Geist for the tool, Newsreader for anything quoted from an invoice or a list. Warm neutrals and near-black ink, with a lime primary button and an olive accent for text.

Fonts: Geist and Newsreader (SIL Open Font License), in `fonts/`.

## Provenance

Built on 18 Nov 2026 with AI coding agents, directed by Arnold Ikpemosi Adeyemi. The pub (The Quillfen Arms), the suppliers (Pellicott Drinks, Gannerby Brewing, Fallowmere Foodservice), the codes, invoice numbers and prices are made up. A web search and a Companies House search for each name on 18 Nov 2026 found no business by any of them. Staff are first names only.

## Licence

MIT. See `LICENSE`.
