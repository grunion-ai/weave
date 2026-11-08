# daterange
A start and an end, together: `{"start": "2026-09-20", "end": "2026-09-27"}`. Both ends wear the field's grain and costume.
## Config
| Key | Values | Effect |
| --- | --- | --- |
| `grain` | as for `date` — `[]` with `time` makes a range of clock times | which parts each end stores |
| `format` | the nine the `date` type takes | applied to both bounds; `long` inside one year says the year once — `Aug 1 – Sep 15, 2026` |
| `pad` | boolean | zero-padded numerals on `us` and `eu` |
| `time` | boolean | a time of day at both ends |
| `clock` | `24h`, `12h` | as for `date` |
| `zone` · `zoneName` | as for `date` | what the clock times mean |
| `elapsed` | boolean | append the span between the ends — `09:15 – 17:40 · 8h 25m`; needs `time`, and two clock readings wrap at midnight |
| `default` | a range | what a new record starts with |
```json
{ "name": "Hours", "type": "daterange",
  "config": { "grain": [], "time": true, "clock": "12h", "elapsed": true } }
```
## Usage
```bash
weave field add Trip Window daterange --config '{"format":"long"}'
weave field add Store Hours daterange --config '{"grain":[],"time":true,"clock":"12h","elapsed":true}'
weave update 'Trip#3' --values '{"Window": {"start": "2026-09-20", "end": "2026-09-27"}}'
weave update 'Store#1' --values '{"Hours": {"start": "09:15", "end": "17:40"}}'
```
## Editing a range
One control, one dialog (Issue #197). The cell, the entity page and the tray's **default** all wear the same control: a box that reads the whole span in the field's costume — `2026-08-01 – 2026-09-15`, `Aug 1 – Sep 15, 2026` — and a calendar button that opens **one range dialog**. The first click on the calendar sets the start, the second sets the end (an earlier second click swaps the two), and the days between them are lit. Two typed inputs sit inside the same dialog: Enter on **Start** begins a new span and hands focus to **End**; Enter on **End** closes the span and the dialog. **Clear** empties the range, **Today** picks today for whichever end is next. The dialog follows the grain: a year·month range picks two months, a year range two years, a range of clock times two times; a field with a time of day shows a start and an end clock under the calendar.
Typing into the box works too — `2026-08-01 – 2026-09-15`, `aug 1 to sep 15`, `9/1/26 - 9/30/26` — each end read the way a single date is.
## Gotchas
Half a range is not a range: the server refuses one end, so an unfinished pick stays in the dialog until the other end lands, and one date typed alone into the box is refused with a toast. The elapsed span is computed at read time from the two ends and never stored — a formula wanting it uses `datediff`.

**A sort reads the stored ends, not the painted span.** A range sorts by its start, then by its end, so two spans that open on the same day stack the shorter one first — the way a calendar does. The costume changes nothing: `Oct 1 – Oct 3, 2026` sorts below `Sep 9 – Sep 12, 2026` because October is later, not because `O` beats `S`.