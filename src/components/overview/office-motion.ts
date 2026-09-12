import type { Phase } from "../../demo";

type Point = [number, number];
export type OfficePose = {
  x: number;
  z: number;
  heading: number;
  seated: number;
  walking: boolean;
  typing: boolean;
  waving: boolean;
  coffee: boolean;
};
type Stop = {
  point: Point;
  seconds: number;
  heading: number;
  seated?: number;
  waving?: boolean;
  coffee?: boolean;
  typing?: boolean;
};

export const SEAT: Point = [0.25, 1.1];
export const STANDING_HEIGHT = 1.04;
export const SEATED_HEIGHT = 0.66;

function rest(stop: Stop): OfficePose {
  return {
    x: stop.point[0],
    z: stop.point[1],
    heading: stop.heading,
    seated: stop.seated ?? 0,
    walking: false,
    typing: stop.typing ?? false,
    waving: stop.waving ?? false,
    coffee: stop.coffee ?? false,
  };
}

// Routes stay in the aisles in front of and beside desks. Chairs never travel
// with characters. Distances determine travel time, keeping walking speed steady.
function followRoute(stops: Stop[], elapsed: number): OfficePose {
  const duration = stops.reduce((total, stop, i) => {
    const next = stops[(i + 1) % stops.length];
    return (
      total +
      stop.seconds +
      Math.hypot(next.point[0] - stop.point[0], next.point[1] - stop.point[1]) /
        0.8
    );
  }, 0);
  let time = elapsed % duration;
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i],
      next = stops[(i + 1) % stops.length];
    if (time <= stop.seconds) return rest(stop);
    time -= stop.seconds;
    const dx = next.point[0] - stop.point[0],
      dz = next.point[1] - stop.point[1];
    const travel = Math.hypot(dx, dz) / 0.8;
    if (time < travel) {
      const progress = time / travel;
      const distance = travel * 0.8;
      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      // Fold the legs before sliding onto the cushion; stand only after clearing
      // its edge. This prevents the walking rig from passing through the seat.
      const seated = stop.seated
        ? clamp(1 - (progress * distance - 0.55) / 0.3)
        : next.seated
          ? clamp((0.85 - (1 - progress) * distance) / 0.3)
          : 0;
      return {
        ...rest(stop),
        x: stop.point[0] + dx * progress,
        z: stop.point[1] + dz * progress,
        heading: seated > 0 ? Math.PI : Math.atan2(dx, dz),
        seated,
        walking: seated === 0,
        waving: false,
        coffee: false,
        typing: false,
      };
    }
    time -= travel;
  }
  return rest(stops[0]);
}

export function officePose(
  phase: Phase,
  elapsed: number,
  index: number,
): OfficePose {
  if (phase === "waiting") {
    return followRoute(
      [
        { point: [1.96, 1.1], seconds: 1.2, heading: 0.5, waving: true },
        { point: [1.96, 2.25], seconds: 0, heading: 0 },
        { point: [0.35, 2.25], seconds: 3.5, heading: 0.4, waving: true },
        { point: [1.96, 2.25], seconds: 0, heading: 0 },
      ],
      elapsed,
    );
  }
  if (phase === "human") {
    return followRoute(
      [
        { point: [1.96, 1.1], seconds: 5, heading: -1.1 },
        { point: [1.96, 2.1], seconds: 4, heading: -0.3 },
      ],
      elapsed,
    );
  }
  if (phase === "replaying") {
    // A working agent faces its monitor and types, with occasional aisle visits
    // on longer runs. Animation never advances the underlying workflow.
    return followRoute(
      [
        { point: SEAT, seconds: 9, heading: Math.PI, seated: 1, typing: true },
        { point: [1.96, 1.1], seconds: 0.5, heading: -Math.PI / 2 },
        { point: [1.96, 2.25], seconds: 1.2, heading: Math.PI / 2 },
        { point: [1.96, 1.1], seconds: 0, heading: -Math.PI / 2 },
      ],
      elapsed,
    );
  }
  if (phase === "finished" || phase === "ready") {
    return followRoute(
      [
        { point: [1.96, 1.1], seconds: 0.4, heading: 0 },
        { point: [1.96, 2.25], seconds: 0, heading: -Math.PI / 2 },
        { point: [-0.4, 2.25], seconds: 5, heading: 0.3, coffee: true },
        { point: [1.96, 2.25], seconds: 0, heading: 0 },
        { point: [1.96, 1.1], seconds: 0, heading: -Math.PI / 2 },
        { point: SEAT, seconds: 7, heading: Math.PI, seated: 1 },
      ],
      elapsed + index * 1.3,
    );
  }
  return {
    ...rest({ point: SEAT, seconds: 1, heading: Math.PI, seated: 1 }),
    heading: Math.PI - 0.25,
  };
}
