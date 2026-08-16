import { test } from "node:test";
import assert from "node:assert/strict";
import { tableId } from "../scripts/screenshots.mjs";

const schema = [
  { space: "Handbook", tables: [{ id: "g1", name: "Guide", qualified: "Handbook/Guide" }] },
  {
    space: "Development",
    tables: [
      { id: "f1", name: "Feature", qualified: "Development/Feature" },
      { id: "i1", name: "Issue", qualified: "Development/Issue" },
    ],
  },
  { space: "Empty" },
];

test("tableId resolves a qualified Space/Table name", () => {
  assert.equal(tableId(schema, "Development/Feature"), "f1");
  assert.equal(tableId(schema, "Handbook/Guide"), "g1");
});

test("tableId falls back to a bare table name", () => {
  assert.equal(tableId(schema, "Issue"), "i1");
});

test("tableId throws for an unknown table rather than returning undefined", () => {
  assert.throws(() => tableId(schema, "Development/Nope"), /no table Development\/Nope/);
});

test("tableId tolerates a space with no tables", () => {
  assert.equal(tableId([{ space: "Empty" }, ...schema], "Development/Issue"), "i1");
});
