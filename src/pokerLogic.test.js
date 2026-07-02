import assert from "node:assert/strict";
import { buildSidePots, snapBetTarget } from "./pokerLogic.js";

const player = (id, contributed, folded = false) => ({ id, contributed, folded });

assert.deepEqual(
  buildSidePots([player("a", 20), player("b", 20), player("c", 20)]),
  [{ amount: 60, eligibleIds: ["a", "b", "c"] }],
);

assert.deepEqual(
  buildSidePots([player("a", 100), player("b", 100, true), player("c", 100)]),
  [{ amount: 300, eligibleIds: ["a", "c"] }],
);

assert.deepEqual(
  buildSidePots([player("a", 50), player("b", 100), player("c", 200), player("d", 200, true)]),
  [
    { amount: 200, eligibleIds: ["a", "b", "c"] },
    { amount: 150, eligibleIds: ["b", "c"] },
    { amount: 200, eligibleIds: ["c"] },
  ],
);

assert.equal(snapBetTarget(101, 60, 105, 10), 100);
assert.equal(snapBetTarget(105, 60, 105, 10), 105);
assert.equal(snapBetTarget(109, 60, 105, 10), 105);
assert.equal(snapBetTarget(40, 60, 105, 10), 60);
assert.equal(snapBetTarget(120, 60, 105, 10), 105);

console.log("poker logic tests passed");
