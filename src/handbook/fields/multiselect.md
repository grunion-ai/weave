# multiselect

Several choices from the same option shape as `select`; stored as an array of ids, rendered as a row of chips.

## Config

Same as `select`: `options`, `default`.

## Usage

`{"Tags": ["alpha", "stable"]}` — a bare string becomes a one-element array. CSV import splits on `;`.

The picker is a token box: chips live inside the cursor box with the text you are typing, so adding a fourth tag never pushes the field out from under you.

## Gotchas

Order is the order you wrote, not the order of the options list.