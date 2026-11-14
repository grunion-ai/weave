# The grid

The tables below map each visible grid behaviour to the names that implement
it. `renderTable` in `public/app.js` draws the grid inside one closure, so
changing a behaviour usually means finding its names here instead of reading
the whole file. The tables list names only, since line numbers go stale as the
file changes.

## Drawing a table

| Behaviour | Where |
| --- | --- |
| A table route opens and the chrome paints | `showDatabase`, `tableChrome`, `paintTableChrome`, `tableChromeOn` |
| Rows are read and the grid is drawn | `readAndDrawTable`, `drawDatabase`, `renderTable` |
| The grid a redraw replaces is torn down | `teardownGrid`, the `destroy` closure in `renderTable`, `wvDestroy` |
| A board layout takes the same route | `readAndDrawBoard`, `public/board-core.js`, `public/board-view.js` |
| Which columns are drawn | `visibleCols`, `gridFields`, `fieldVisibilityPopover`, `dropDrawnColumn` |
| Only the rows near the viewport are in the DOM | `public/grid-window.js` (`WeaveGridWindow`), the `rewindow` and `paint` pair inside `renderTable` |
| The next page is fetched as the reader scrolls | `gridPager`, `WeaveGridWindow.feedFor` |
| The loading state | `gridHold`, `paintGridWait`, `showGridLoader`, `hideGridLoader`, `resetGridWait` |

## Editing a cell

| Behaviour | Where |
| --- | --- |
| A cell rests, opens and commits | `activateCell`, `openCellPicker`, `editorFor` |
| A commit writes and the grid catches up | the `onSaved` closure in `renderTable`, `patchRows` |
| A new row is added and takes focus | `newRowTray`, `focusNewRow`, `focusGridRow` |
| Focus and scroll survive a redraw | `rememberGridFocus`, `restoreGridFocus`, `keepScroll` |
| The keyboard moves the cursor | `public/grid-keymap.js` (`WeaveGridKeymap`), `gridMoves` |
| A range is selected, copied and filled | `public/grid-range.js` (`WeaveGridRange`), `public/selection-core.js` (`WeaveSelection`), `repaintRange`, `paintSelection` |

## Shape and fit

| Behaviour | Where |
| --- | --- |
| Column widths and the resize handle | `public/column-resize.js` (`WeaveColumnResize`) |
| Frozen leading columns | `WeaveColumnResize.frozenFit` and `canFreeze`, the `wv-frozen-fields` class |
| The grid decides whether it fits its pane | `refit` inside `renderTable`, `fitGridScroller`, the `wv-fit`, `wv-overflow-x` and `wv-grid-scroll` classes |
| Sideways scroll state | the capture `scroll` listener near the top of `public/app.js`, the `wv-scrolled-x` class |
| A clipped cell says so, and spills on hover | `markClippedCells`, `fitChips`, `showCellPop`, `hideCellPop`, `gridRightEdge` |
| Row height | `gridDensity`, `saveGridDensity`, `checkRowPitch` |

## Reading a view

| Behaviour | Where |
| --- | --- |
| Sort, filter, group and search | `gridSort`, `filterWhere`, `tableGroup`, `setTableSearch`, `public/list-core.js` |
| The view pane that configures all four | `renderViewPane`, `paneFilters`, `paneWrite` |
| Footer totals | `rollupCells`, `footStatLists`, `footRollupWrite` |

## The phone row

| Behaviour | Where |
| --- | --- |
| A row becomes a card on a phone | `public/phone-row.js`, `phoneRowOf`, `phoneLeadEl`, `fitPhoneChipLines` |
| The phone action bar | `installPhoneBar`, `syncPhoneBar` |
| Which fields the card shows | `phoneRowPopover` |

## A grid inside a record

| Behaviour | Where |
| --- | --- |
| A related table on a record page | `relatedGrid`, `subtableOf`, `subtableChips`, `subtablePopover` |

## Placing a change

Logic that needs no DOM belongs in a pure core, a separate file with its own
unit tests: `grid-window.js`, `grid-range.js`, `grid-keymap.js`,
`column-resize.js`, `list-core.js`, `selection-core.js`, `phone-row.js`. Only
the DOM work stays in `renderTable`.

A behaviour whose row lists several names is still a single change. Committing
a cell runs through `editorFor`, `onSaved`, `patchRows`, `gridMoves`,
`keepScroll`, `rememberGridFocus` and `markClippedCells`, so changing how a
cell commits means checking each of them, and the regression test covers every
one the change touches.
