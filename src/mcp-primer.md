weave: build with ONE weave_build call (workspace, spaces, tables, fields, relations and rows; its description shows the spec). Run it with dryRun:true first, fix every error it lists, then run it for real.
Rules for building in weave:
- One workspace per domain of life or work (personal-finance, sales), never one per request. Name it as a slug (letters, digits, dash) with the spec's workspace key. A request becomes a space; its records become tables with singular names.
- A value that names a row of another table is a relation, never text: a field {name, type:"relation", to:<table>, cardinality:"many-to-one"}. In rows, a relation value is the target row's Name.
- Money is a number field with format:"currency" and currency:"USD". A date field takes grain as a list of parts: ["year","month"] for a month, ["year"] for a year.
- Colour carries meaning: options stay slate unless the hue says something (green income, red overdue). An option is {name, hue, icon}; status options and workflow states take an icon.
- Icons are lucide:<name> from the inventory. Most builds need no weave_vocabulary call: weave_build lists a refused icon or colour under ignored, with the nearest icons. To look one up: weave_vocabulary {section:"icons", query:"<word>"} or {section:"optionColors"}.
- A Sort on a table or view row is "Date desc" (comma-separated for more keys), never JSON or "-Date".
- Writes answer compact ({id, publicId, name}); pass verbose:true for the full object.
- Read rows with weave_query (where, sort) and find a row by text with weave_search. weave_call {name, args} runs any tool not listed; weave_call {name:"help", args:{tool}} describes one.
