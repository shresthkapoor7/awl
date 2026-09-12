import assert from "node:assert/strict";
import {
  officePose,
  SEATED_HEIGHT,
  SEAT,
} from "../src/components/overview/office-motion.ts";

// The seated pelvis clears the cushion; bent thighs fit below the desk and
// the vertical shins put the soles at floor level, instead of through the seat.
assert.ok(SEATED_HEIGHT - 0.08 >= 0.5 + 0.16 / 2 - 1e-6);
assert.ok(SEATED_HEIGHT + 0.1 < 0.95 - 0.13 / 2);
assert.ok(Math.abs(SEATED_HEIGHT - 0.57 - 0.18 / 2) < 1e-6);
for (const phase of [
  "waiting",
  "human",
  "replaying",
  "finished",
  "ready",
  "new",
]) {
  let walked = false;
  let previous;
  for (let step = 0; step < 1800; step++) {
    const pose = officePose(phase, step / 30, 1);
    if (pose.walking) {
      walked = true;
      assert.equal(pose.seated, 0);
      // Keep the body and feet out of the tabletop/legs and chair back.
      assert.ok(pose.z >= 1.09, `${phase} crossed behind the workstation`);
      assert.ok(
        Math.abs(pose.x) > 1.8 || pose.z > 1.0,
        `${phase} crossed the desk`,
      );
      assert.ok(
        Math.abs(pose.x - SEAT[0]) > 0.6 || pose.z < 1.3 || pose.z > 1.95,
        `${phase} crossed the chair back`,
      );
    }
    if (previous)
      assert.ok(
        Math.hypot(pose.x - previous.x, pose.z - previous.z) <= 0.8 / 30 + 1e-6,
        `${phase} teleported`,
      );
    if (phase !== "replaying") assert.equal(pose.typing, false);
    previous = pose;
  }
  assert.equal(walked, phase !== "new");
}
assert.equal(officePose("replaying", 1, 0).typing, true);
assert.equal(officePose("replaying", 1, 0).seated, 1);
console.log(
  "Passed: seated clearance, foot placement, aisle routes, continuous walking, and state-specific activity.",
);
