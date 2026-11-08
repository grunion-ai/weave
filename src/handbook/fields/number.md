# number

Finite numeric value. One type, four costumes — plain, currency, percent, and a unit — and the costume is display only.

## Config

| Key | Values | Effect |
| --- | --- | --- |
| `format` | `number` (default), `currency`, `percent`, `compact` | which costume the cell wears — `compact` prints 1.2M / 4.8K and composes with a currency ($1.2M) |
| `currency` | ISO code — `USD`, `EUR`, `MXN`, `CNY`, `JPY`, `RUB`, `CAD`, … | the symbol, when `format` is `currency` or `compact` |
| `unit` | any short string — `kg`, `ms`, `seats` | a suffix, on plain numbers and on formulas |
| `decimals` | integer | fixed places; defaults to 0, or 2 under `currency`, or 1 under `compact` |
| `separator` | boolean | thousands grouping (currency and compact group on their own) |
| `accounting` | boolean | negatives in parentheses — ($1,234.57) — the finance convention; needs `currency` |
| `display` | `text` (default), `bar`, `ring`, `heat` | how the value is drawn: a bar or a ring filled to its share of the scale, or a cell tinted by it; the text rides beside it, and the API still returns the number |
| `scale` | `column` (default) or a number above 0 | what 100% is for a bar, ring or heat: the column's largest value, or a fixed figure (`1` for a percent, `5` for a score out of five) |
| `color` | `ink` (default), `icon`, `accent` | the colour a bar, ring or heat is drawn in (Feature #235): Quiet ink is the text colour on a hairline track and a grey tint; Color by icon draws bars and rings teal and runs heat from cool to warm; One accent hue draws everything in the workspace accent |
| `default` | number | the value a new record starts with |

```json
{ "name": "Price", "type": "number",
  "config": { "format": "currency", "currency": "USD", "decimals": 2 } }
```

A bar is 6px tall with round ends on an 80px track, the figure to its right; a ring is 16px; heat is a rounded tint behind the figure. A graphic column opens wide enough for its graphic and its widest figure; a width you drag is kept. Under `display` the tray's **Color** picker draws three swatches, each this field's graphic in that setting. The field's settings tray also draws a **Sample**: this column's own smallest, middle and largest figures in the chosen costume, measured against the chosen scale, so a bar on `column` shows what the column will look like. A column holding no numbers yet samples a quarter, three fifths and the whole of the scale instead, labelled as examples.

## Usage

```bash
weave field add Invoice Total number --config '{"format":"currency","currency":"USD"}'
weave field add Part Weight number --config '{"unit":"kg","decimals":1}'
weave field add Deal Share number --config '{"format":"percent","decimals":1}'
weave field add Fund Raised number --config '{"format":"compact","currency":"USD"}'
weave field add Ledger Net number --config '{"format":"currency","currency":"USD","accounting":true}'
```

Right-aligned with tabular figures, so a column of figures lines up on the decimal.

## In formulas & rollups

Aggregates: `sum`, `avg`, `median`, `min`, `max`, `range`, `stdev`, `count`, `filled`, `empty`, `distinct`. Formula: `round(Price * Count)`. A rollup of this column wears its costume.

## Gotchas

**A formula reads the raw number, never the costume.** `$1,499.50` is stored as `1499.5`; the currency, the unit and the separator are painted at read time. A formula that received the formatted string would break the moment someone turned on grouping — so it does not receive it.

Validates with `Number()`: `"25000"` coerces, `"abc"` is rejected.