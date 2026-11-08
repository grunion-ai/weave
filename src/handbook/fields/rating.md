# rating

A whole number from 0 to the field's `max`, drawn as `max` icons with the first ones filled (Feature #231). Scoring a record (priority, quality, fit) takes one click instead of a number and a scale to remember. To a formula, a sort, a filter, CSV, the API and MCP it is a number.

## Config

`max` — how many icons, any whole number from 1 to 100; `5` unless named (Feature #234). The field dialog takes any number and offers 3, 5 and 7 as shortcuts. The ceiling of 100 keeps a screen of records paintable: every icon is a button in every visible cell.

`icon` — one icon for the field, picked from the inventory (`lucide:<name>`, or a mark): `lucide:star` unless named. `{ "name": "Fit", "type": "rating", "config": { "max": 7, "icon": "lucide:heart" } }`.

`color` — `ink` (default) fills the icons in the text colour with hairline outlines for the empties; `icon` fills them in the icon's own hue (a star amber, a heart rose, a bolt violet, anything else the accent); `accent` fills them in the workspace accent (Feature #235). The tray's **Color** picker shows three of the field's own icons in each setting. A lookup or a rollup of the rating draws in its colour.

Icons are 14px with a 1px gap. A rating column's floor holds every icon, so a drag, a nudge or a stored width never cuts one; past the fit cap (320px) the column stops there and draws a compact `★ 3/12` instead.

`default` — the rating a new record starts with. In the field dialog it is picked on a record of the field's own icons: click the nth to set n, click it again to clear; with the record focused, the arrow keys move it, a digit sets it and `Backspace` clears it. Lowering `max` below the default brings the default down with it.

## Usage

Click the third icon to set 3; click the filled third icon again to clear to 0. In the grid a digit key on the resting cell sets the rating (a digit past the max sets the max) and `Backspace` or `Delete` clears it to 0. A screen reader hears "3 of 5".

A write is rounded and held to 0..max: `{"Fit": 3.6}` stores 4, `{"Fit": 9}` stores 5, numeric text is read as its number, anything else is refused by name. Lowering `max` holds every record to the new ceiling.

A rating column in the grid opens wide enough for every icon: `max` icons, the gaps between them and the cell's padding, up to the fit ceiling of 320 pixels (Issue #404). A width you drag stands.

A lookup of a rating, and a rollup whose answer stays on the scale (`avg`, `min`, `max`, `median`), draw the same icons, read-only, rounded to a whole number; the API returns the unrounded figure. A `sum` or a spread leaves the scale and prints as a number.

## Migrations

`number` ⇄ `rating` both ways: a number becomes a rating by rounding and clamping to the max; a rating becomes the number it held. To `text`, each record freezes its number.

## In formulas

`[Fit] * 20` reads the number: a 4 of 5 is 80.

## Gotchas

Empty and 0 are different: an unrated record is empty (`is-empty` matches it), a cleared one is 0.