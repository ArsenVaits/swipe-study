import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, parseEdits } from "../src/video/hyperframes/edits.ts";

const doc = `<div id="a" style="top: 240px">Заголовок</div>
<div id="b">B</div>
<div class="x">1</div>
<div class="x">1</div>`;

test("parses find/replace blocks, including an empty replacement", () => {
  const reply = `t=1 · title · too high → move down
<<<<<<< FIND
<div id="a" style="top: 240px">Заголовок</div>
=======
<div id="a" style="top: 300px">Заголовок</div>
>>>>>>> REPLACE
<<<<<<< FIND
<div id="b">B</div>
=======
>>>>>>> REPLACE`;
  const edits = parseEdits(reply);
  assert.equal(edits.length, 2);
  assert.equal(edits[1].replace, "");
  const res = applyEdits(doc, edits);
  assert.equal(res.applied, 2);
  assert.match(res.doc, /top: 300px/);
  assert.doesNotMatch(res.doc, /id="b"/);
});

test("tolerates whitespace differences but refuses ambiguous or missing matches", () => {
  const res = applyEdits(doc, [
    { find: '<div id="a"   style="top: 240px">Заголовок</div>', replace: "<div id=\"a\">A</div>" },
    { find: '<div class="x">1</div>', replace: "dup" },
    { find: "<nope/>", replace: "x" },
  ]);
  assert.equal(res.applied, 1);
  assert.equal(res.failed.length, 2);
  assert.match(res.doc, /<div id="a">A<\/div>/);
});

test("replacement text with $ signs is inserted literally", () => {
  const res = applyEdits(doc, [{ find: '<div id="b">B</div>', replace: '<div id="b">$1 and $&</div>' }]);
  assert.match(res.doc, /\$1 and \$&/);
});
