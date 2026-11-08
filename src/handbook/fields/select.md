# select

One choice from a configured list. Stored as the option **id** (a slug), read everywhere as the option **name**.

## Config

`options` — strings, or objects carrying a hue and a glyph. `default` — one option, by name or id; without it a new record's value is empty. The field dialog picks it from the options (*No default* first), and removing that option clears it.

```json
{ "name": "Priority", "type": "select", "config": { "options": [
  { "name": "Low",    "hue": "green" },
  { "name": "Medium", "hue": "amber" },
  { "name": "High",   "hue": "red" }] } }
```

**The palette is ten hues and nothing else**: `slate` (no hex), `blue` `#4769eb`, `green` `#2ea043`, `amber` `#f59f00`, `red` `#e5484d`, `purple` `#8e4ec6`, `cyan` `#00a2c7`, `pink` `#d6409f`, `teal` `#12a594`, `orange` `#f76b15`. Name the hue in `hue`, or give its hex in `color`; weave stores both. `magenta` is the name pink was published under and still resolves to pink, and `neutral` still resolves to slate. Any other name or hex is refused with a 400 that names the ten (Issue #551). Slate is the honest default: a colour should carry meaning, not decoration.

## Usage

Write by name or by id, case-insensitively: `{"Priority": "high"}`. An unknown option is rejected.

Editing the options is an in-place edit from the column header, not a delete-and-recreate: renaming `Medium` to `Normal` keeps every record that held it.

## Gotchas

Pass an option's **id** when renaming it — a bare string re-slugs and orphans the records that pointed at the old id.