import assert from "node:assert/strict";
import {
  officePose,
  officeLayout,
  workstationPosition,
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
// Finished agents take a one-way trip to distinct spots in the shared break
// area, clear every row of desks, and stay there without changing task state.
for (const count of [1, 2, 3, 6]) {
  const layout = officeLayout(count);
  const destinations = [];
  for (let index = 0; index < count; index++) {
    const origin = workstationPosition(index, count);
    const arrived = officePose("finished", 120, index, count);
    assert.equal(arrived.gossip, true);
    assert.equal(arrived.walking, false);
    assert.deepEqual(officePose("finished", 240, index, count), arrived);
    const destination = [origin[0] + arrived.x, origin[1] + arrived.z];
    assert.ok(destination[1] >= layout.breakZ);
    assert.ok(destination[1] < layout.front - 0.5);
    for (const other of destinations)
      assert.ok(
        Math.hypot(other[0] - destination[0], other[1] - destination[1]) > 1.2,
      );
    destinations.push(destination);
    let previous;
    for (let step = 0; step < 3600; step++) {
      const pose = officePose("finished", step / 30, index, count);
      if (previous)
        assert.ok(
          Math.hypot(pose.x - previous.x, pose.z - previous.z) <=
            0.8 / 30 + 1e-6,
        );
      previous = pose;
      if (!pose.walking) continue;
      for (let desk = 0; desk < count; desk++) {
        const [x, z] = workstationPosition(desk, count);
        assert.ok(
          Math.abs(origin[0] + pose.x - x) > 1.8 ||
            Math.abs(origin[1] + pose.z - z) > 1.05,
          "The cooler route crossed a desk",
        );
      }
    }
  }
}
assert.equal(officePose("ready", 120, 0).gossip, false);
console.log(
  "Passed: seated clearance, foot placement, aisle routes, continuous walking, and state-specific activity.",
);
