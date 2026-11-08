# How text behaves

Every piece of text in weave has one role, and the role decides what a line does when it runs out of room. The rule is the same on every surface and at every view density, so a new screen inherits it.

| Role | How it wraps | When it runs out of room |
| --- | --- | --- |
| Page and section titles | Balanced lines | Wraps. A title is never cut. |
| Prose and descriptions | Even lines, with no single word left alone on the last one | Folds on a whole line, with **Show more** beside it. |
| Table cells | The line count the density sets: one at Compact and Comfortable, three at Spacious | Ends in an ellipsis on the last whole line. Hover the cell for the full value. |
| Chips and states | One row in a dense row, two at Spacious with the rest counted in +N, wrapped on a tile or a record page | A state name stays readable in full somewhere on screen. |
| Long unbroken values | Break anywhere | Stay inside their box and never push the page wider. |

**Density changes the line count, not the role.** Switching a table from Comfortable to Spacious gives its cells three lines. The text is still a table cell, and it still ends in an ellipsis with the full value on hover.

**A fold ends on a whole line.** A description folds to five lines on a workspace or space page and three under a table title or a field label. The count is of lines, so a gap between paragraphs cannot cut the last line in half.

**Three dots are not a cut.** An ellipsis shows every letter it draws and says there is more. Cut-off text is a letter or a line sliced by the edge of its box, and weave never shows it.

To read a table cell's full value on a phone, where nothing hovers, open the row: the record page wraps every value.
