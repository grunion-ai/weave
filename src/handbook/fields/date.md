# date
A point in time — or only the parts of one the field actually captures. Type it in any format you like — the cell parses what you meant and stores ISO.

A date field declares two things separately. Its **grain** is which parts it stores: any contiguous run of year · month · day, plus a time of day. Its **costume** is how the stored parts print. A card expires in a month, never on a day; rent falls on the 15th of no particular month. Storing the missing part would store a lie, so the grain leaves it out, and a costume that needs it is refused when the field is defined.
## Config
| Key | Values | Effect |
| --- | --- | --- |
| `grain` | a list from `year`, `month`, `day` — `["year","month"]`, `["month","day"]`, `["day"]`, `["year"]`, `["month"]`, or `[]` with `time` | which parts the field stores; omitted means all three |
| `format` | `long` (default), `iso`, `us`, `eu`, `short`, `month`, `quarter`, `ordinal`, `relative` | `Sep 15, 2026` · `2026-09-15` · `9/15/2026` · `15.9.2026` · `Sep 15` (the year only when it is not this one) · `September 2026` · `Q3 2026` · `September 15th, 2026` · `in 2 weeks` |
| `pad` | boolean | zero-padded numerals on `us` and `eu` — `08/2026` for a card expiry |
| `time` | boolean | store and show a time of day as well |
| `clock` | `12h` (default), `24h` | `2:32 PM` or `14:32` |
| `zone` | `floating` (default), `fixed`, `instant` | what the clock time means — see below |
| `zoneName` | an IANA zone — `America/Los_Angeles`, `Europe/Berlin` | the zone a `fixed` field lives in |
| `default` | a date, or `today()` / `now()` | what a new record starts with, evaluated per record and cut to the grain |
```json
{ "name": "Expires", "type": "date",
  "config": { "grain": ["year", "month"], "format": "us", "pad": true } }
```
## Usage
```bash
weave field add Task Due date --config '{"format":"us"}'
weave field add Post Published date --config '{"format":"long","time":true,"clock":"12h"}'
weave field add Log Seen date --config '{"default":"now()","time":true,"zone":"instant"}'
weave field add Card Expires date --config '{"grain":["year","month"],"format":"us","pad":true}'
weave field add Lease [Rent day] date --config '{"grain":["day"],"format":"ordinal"}'
weave field add Store Opens date --config '{"grain":[],"time":true,"clock":"12h","zone":"fixed","zoneName":"America/Los_Angeles"}'
```
Typing is forgiving: `next friday`, `sep 15`, `15/9`, `in 3 weeks` and `2026-09-15` all land on the same day. The picker button opens a calendar with month and year grids — or, when the grain stores less, a month/year picker, a month/day picker, a year, a day of the month, or just a clock — and the field's own format is shown as an example under the input.
## What the field stores
| Grain | Stores | For |
| --- | --- | --- |
| year · month · day | `2026-08-15`, `2026-08-15T09:15` with time | a due date, a meeting |
| year · month | `2026-08` | a card expiry, a monthly target |
| year | `2026` | a fiscal year, a vintage |
| month · day | `--08-15` | a birthday, an anniversary |
| month | `--08` | a seasonal window |
| day | `---15` | rent day, the 15th of every month |
| none, with time | `09:15` | an opening time |
These are the ISO 8601 truncated forms (XSD gYear / gYearMonth / gMonthDay / gDay), and they sort as text within a grain. A fuller value written to a narrower field is cut to the grain — `2026-08-15` into a year·month field stores `2026-08` — and a thinner one is refused: the store never invents a January or a year.
## What a clock time means
| `zone` | Stores | Means | Two readers in two cities see |
| --- | --- | --- | --- |
| `floating` | `2026-08-15T09:15` | a wall clock, no zone — the default, and what every existing field is | both 09:15 |
| `fixed` | `2026-08-15T09:15` + the field's `zoneName` | a wall clock in a named place | both 09:15 PDT |
| `instant` | `2026-08-15T16:15Z` | a point in history, stored as UTC | 09:15 in Los Angeles, 18:15 in Berlin |
An instant is the one case where the reader's own zone enters, and only because the field asked for it. Written through the API, an instant takes a `Z`, an offset, or a bare wall clock read as UTC.
## Query
```json
{"where": [["Due", "<", "2026-10-01"], ["Due", "not-empty"]]}
```
## In formulas
`days(today(), Due)` · `if(empty(Due), "", days(today(), Due))` · `month(Expires)`

A formula reads the stored value, never the costume, so `year(Expires)` on a year·month field is the year and `day([Rent day])` is the day.
## Gotchas
The format is a costume, like a number's. Comparison, sorting and date math all run on the stored value, so changing a column from `us` to `long` changes nothing but the reading.

**A costume can dress only what the grain stored.** `month` and `quarter` need a month, `ordinal` a day, `relative` a year — ask for one on a grain without it and the field refuses to be defined that way, with the missing part named. The tray only offers the styles the grain can wear.

**Narrowing a grain does not rewrite records.** A `2026-08-15` already stored keeps its day; the costume simply stops printing it. Widening cannot invent the parts it never had.