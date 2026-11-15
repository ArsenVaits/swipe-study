import assert from "node:assert/strict";
import { test } from "node:test";
import { placeSeries } from "../lib/series";

test("series lessons go to the top of the feed in plan order as they arrive", () => {
  const feed = [{ id: "old-1" }, { id: "old-2" }];
  const first = placeSeries(feed, ["a"], [{ id: "a" }]);
  assert.deepEqual(first.map((e) => e.id), ["a", "old-1", "old-2"]);
  const second = placeSeries(first, ["a", "b", "c"], [{ id: "c" }, { id: "b" }]);
  assert.deepEqual(second.map((e) => e.id), ["a", "b", "c", "old-1", "old-2"]);
  const again = placeSeries(second, ["a", "b", "c"], []);
  assert.deepEqual(again.map((e) => e.id), ["a", "b", "c", "old-1", "old-2"]);
});
