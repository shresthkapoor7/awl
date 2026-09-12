import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Agent, Phase } from "../../demo";
import {
  officePose,
  SEAT,
  SEATED_HEIGHT,
  STANDING_HEIGHT,
  type OfficePose,
} from "./office-motion";

export type StationLabel = {
  id: string;
  x: number;
  y: number;
  visible: boolean;
};
type Options = {
  onSelect: (id: string) => void;
  onLabels: (labels: StationLabel[]) => void;
  onFailure: () => void;
};
type Station = {
  id: string;
  phase: Phase;
  group: THREE.Group;
  head: THREE.Group;
  person: THREE.Group;
  arms: THREE.Group[];
  elbows: THREE.Group[];
  legs: THREE.Group[];
  knees: THREE.Group[];
  mug: THREE.Group;
  elapsed: number;
  index: number;
  pose: OfficePose;
  seated: number;
  screen: THREE.MeshStandardMaterial;
  signal: THREE.Mesh;
  anchor: THREE.Vector3;
};

export function createOffice(
  host: HTMLDivElement,
  initialAgents: Agent[],
  options: Options,
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor("#0a0a0a");
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.setAttribute(
    "aria-label",
    "3D office. Select an agent or use the agent list below.",
  );
  host.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 100);
  camera.position.set(11, 12, 14);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.5, 0);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.minZoom = 0.65;
  controls.maxZoom = 2.1;
  controls.minPolarAngle = Math.PI / 6;
  controls.maxPolarAngle = Math.PI / 2.6;
  controls.minAzimuthAngle = -Math.PI / 5;
  controls.maxAzimuthAngle = Math.PI / 2.5;
  controls.update();
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const material = (color: string) => {
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.82,
          metalness: 0.02,
        }),
      );
    return materials.get(color)!;
  };
  function box(
    parent: THREE.Object3D,
    size: [number, number, number],
    at: [number, number, number],
    color: string,
    round = 0,
  ) {
    const mesh = new THREE.Mesh(
      round
        ? new RoundedBoxGeometry(...size, 2, round)
        : new THREE.BoxGeometry(...size),
      material(color),
    );
    mesh.position.set(...at);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function cylinder(
    parent: THREE.Object3D,
    radius: number,
    height: number,
    at: [number, number, number],
    color: string,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 20),
      material(color),
    );
    mesh.position.set(...at);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function sphere(
    parent: THREE.Object3D,
    radius: number,
    at: [number, number, number],
    color: string,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 16, 12),
      material(color),
    );
    mesh.position.set(...at);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function plant(
    parent: THREE.Object3D,
    x: number,
    z: number,
    scale: number,
    potColor: string,
    y = 0,
  ) {
    const plant = new THREE.Group();
    plant.position.set(x, y, z);
    plant.scale.setScalar(scale);
    parent.add(plant);
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.31, 0.23, 0.46, 24),
      material(potColor),
    );
    pot.position.y = 0.23;
    pot.castShadow = true;
    pot.receiveShadow = true;
    plant.add(pot);
    cylinder(plant, 0.28, 0.018, [0, 0.46, 0], "#604932");
    cylinder(plant, 0.025, 1.08, [0, 0.98, 0], "#5c7542");
    for (let leaf = 0; leaf < 11; leaf++) {
      const angle = leaf * 2.4;
      const height = 0.66 + leaf * 0.085;
      const reach = 0.32 - leaf * 0.011;
      const foliage = sphere(
        plant,
        1,
        [Math.sin(angle) * reach, height, Math.cos(angle) * reach],
        ["#477d47", "#649852", "#83ad62"][leaf % 3],
      );
      foliage.scale.set(0.16, 0.05, 0.36 - leaf * 0.012);
      foliage.rotation.set(-0.2 - leaf * 0.025, angle, 0.15);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, reach, 6),
        material("#5c7542"),
      );
      stem.position.set(
        (Math.sin(angle) * reach) / 2,
        height,
        (Math.cos(angle) * reach) / 2,
      );
      stem.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)),
      );
      plant.add(stem);
    }
  }
  scene.add(new THREE.HemisphereLight("#e5f1ff", "#c2ad87", 2.5));
  const light = new THREE.DirectionalLight("#fff0d4", 2.6);
  light.position.set(-3, 11, 7);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, {
    left: -13,
    right: 13,
    top: 13,
    bottom: -13,
    far: 40,
  });
  light.shadow.normalBias = 0.03;
  scene.add(light);
  const rim = new THREE.DirectionalLight("#d4eaff", 1.7);
  rim.position.set(-8, 6, -5);
  scene.add(rim);
  const room = new THREE.Group();
  scene.add(room);
  let stations: Station[] = [];
  let roomDepth = 9;
  let disposed = false;
  let frame = 0;
  let lastTime = 0;
  let lastRender = 0;
  let pointerDown: { x: number; y: number } | null = null;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  function disposeGroup(group: THREE.Group) {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    group.clear();
  }
  function build(agents: Agent[]) {
    disposeGroup(room);
    for (const station of stations) station.screen.dispose();
    stations = [];
    const rows = Math.max(1, Math.ceil(agents.length / 2));
    roomDepth = Math.max(9, rows * 3.8 + 4);
    box(room, [12, 0.25, roomDepth], [0, -0.22, 0], "#a38164", 0.06);
    box(room, [12, 0.08, roomDepth], [0, -0.04, 0], "#d8c5a8");
    box(room, [12, 2.5, 0.16], [0, 1.2, -roomDepth / 2], "#d5e0d0");
    box(room, [0.16, 2.5, roomDepth], [-6, 1.2, 0], "#eee7d9");
    for (let i = -5.25; i < 6; i += 0.75)
      box(room, [0.012, 0.006, roomDepth], [i, 0.004, 0], "#b8a385");
    for (let z = -roomDepth / 2 + 1.6; z < roomDepth / 2; z += 1.8)
      for (let i = -6; i < 6; i += 0.75)
        box(
          room,
          [0.75, 0.006, 0.01],
          [i + 0.375, 0.004, z + (Math.round(i * 4) % 3) * 0.25],
          "#b8a385",
        );
    // Daylight windows and a planted shelf give the cutaway room some life.
    for (const z of [-2.8, -0.3, 2.2]) {
      if (z > roomDepth / 2 - 0.7) continue;
      box(room, [0.08, 1.35, 1.85], [-5.87, 1.48, z], "#faf4e8", 0.03);
      box(room, [0.02, 1.15, 1.65], [-5.815, 1.48, z], "#a6d3df");
      box(room, [0.03, 1.15, 0.045], [-5.79, 1.48, z], "#fff8ed");
      box(room, [0.03, 0.045, 1.65], [-5.79, 1.48, z], "#fff8ed");
      box(room, [0.35, 0.07, 2], [-5.75, 0.8, z], "#faf4e8", 0.02);
    }
    box(
      room,
      [3.5, 1.03, 0.07],
      [-0.9, 1.55, -roomDepth / 2 + 0.13],
      "#b68a5d",
      0.035,
    );
    box(
      room,
      [3.3, 0.86, 0.03],
      [-0.9, 1.55, -roomDepth / 2 + 0.18],
      "#f4f1df",
    );
    for (let i = 0; i < 3; i++) {
      box(
        room,
        [0.55, 0.32, 0.012],
        [-1.94 + i * 0.84, 1.61, -roomDepth / 2 + 0.205],
        ["#e8bd78", "#99bfae", "#b8c8db"][i],
      );
      box(
        room,
        [0.35, 0.018, 0.015],
        [-1.94 + i * 0.84, 1.65, -roomDepth / 2 + 0.22],
        "#697e72",
      );
      box(
        room,
        [0.25, 0.018, 0.015],
        [-1.99 + i * 0.84, 1.54, -roomDepth / 2 + 0.22],
        "#697e72",
      );
    }
    box(
      room,
      [2.1, 0.85, 0.75],
      [3.65, 0.43, -roomDepth / 2 + 0.65],
      "#6a8c7b",
      0.04,
    );
    box(
      room,
      [2.2, 0.08, 0.86],
      [3.65, 0.88, -roomDepth / 2 + 0.65],
      "#d2aa7b",
      0.025,
    );
    for (const x of [3.2, 4.1])
      box(
        room,
        [0.36, 0.035, 0.05],
        [x, 0.6, -roomDepth / 2 + 1.04],
        "#d4be8c",
      );
    // Coffee corner, with an actual leafy plant rather than gray spikes.
    box(
      room,
      [0.44, 0.56, 0.4],
      [3.95, 1.19, -roomDepth / 2 + 0.57],
      "#363d3e",
      0.045,
    );
    box(
      room,
      [0.29, 0.2, 0.025],
      [3.95, 1.21, -roomDepth / 2 + 0.78],
      "#91b8ad",
      0.02,
    );
    cylinder(room, 0.085, 0.14, [3.95, 1.01, -roomDepth / 2 + 0.83], "#f3e8d8");
    plant(room, -4.7, -roomDepth / 2 + 0.85, 1.2, "#bd7957");
    plant(room, 5, -roomDepth / 2 + 0.9, 1.3, "#e6d7bd");
    plant(room, -5.0, roomDepth / 2 - 0.7, 0.9, "#718e80");
    plant(room, 4.95, roomDepth / 2 - 0.7, 0.95, "#bd7957");
    // A small lounge at the front, outside workstation walking routes.
    box(
      room,
      [2.6, 0.025, 1.25],
      [-3.15, 0.018, roomDepth / 2 - 0.8],
      "#91ada0",
      0.1,
    );
    box(
      room,
      [2.3, 0.25, 0.68],
      [-3.15, 0.43, roomDepth / 2 - 0.8],
      "#c98763",
      0.11,
    );
    box(
      room,
      [2.3, 0.5, 0.17],
      [-3.15, 0.78, roomDepth / 2 - 0.53],
      "#c98763",
      0.075,
    );
    for (const x of [-4.1, -2.2])
      box(room, [0.1, 0.35, 0.42], [x, 0.18, roomDepth / 2 - 0.8], "#765f4b");
    agents.forEach((agent, index) => {
      const x = index % 2 === 0 ? -2.45 : 2.1;
      const z = (Math.floor(index / 2) - (rows - 1) / 2) * 3.8;
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.userData.agentId = agent.id;
      room.add(group);
      box(group, [3, 0.13, 1.4], [0, 0.95, 0], "#cfa472", 0.05);
      box(
        group,
        [3.25, 0.02, 2.35],
        [0.1, 0.018, 0.25],
        index % 2 ? "#a8b8c1" : "#a7bba1",
        0.09,
      );
      plant(group, -1.15, -0.2, 0.3, "#f0dfc2", 1.02);
      for (const legX of [-1.3, 1.3])
        for (const legZ of [-0.5, 0.5])
          box(group, [0.09, 0.9, 0.09], [legX, 0.45, legZ], "#58645f");
      box(group, [1.5, 0.018, 0.65], [-0.1, 1.025, 0.2], "#506b64", 0.02);
      box(group, [0.5, 0.04, 0.35], [0, 1.05, -0.28], "#272727", 0.02);
      box(group, [0.07, 0.28, 0.08], [0, 1.2, -0.3], "#333333");
      box(group, [1.3, 0.8, 0.1], [0, 1.65, -0.28], "#171717", 0.04);
      const screen = new THREE.MeshStandardMaterial({
        color: "#446b70",
        emissive: "#a7e0df",
        emissiveIntensity: 0.2,
        roughness: 0.65,
      });
      const display = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 0.65),
        screen,
      );
      display.position.set(0, 1.65, -0.221);
      group.add(display);
      for (let line = 0; line < 4; line++)
        box(
          group,
          [0.38 + (line % 2) * 0.25, 0.025, 0.008],
          [-0.12, 1.85 - line * 0.12, -0.211],
          "#bfe3d4",
        );
      box(group, [0.85, 0.04, 0.28], [-0.1, 1.06, 0.4], "#4a4a4a", 0.02);
      for (let row = 0; row < 3; row++)
        for (let key = 0; key < 9; key++)
          box(
            group,
            [0.06, 0.01, 0.05],
            [-0.44 + key * 0.085, 1.085, 0.31 + row * 0.08],
            "#939393",
            0.003,
          );
      cylinder(group, 0.1, 0.18, [-1.1, 1.12, 0.28], "#f4e7ce");
      box(group, [0.4, 0.07, 0.5], [1.05, 1.03, -0.25], "#c1775c", 0.02);
      // Furniture and the articulated character have separate transforms.
      const chair = new THREE.Group();
      chair.position.set(SEAT[0], 0, SEAT[1]);
      chair.rotation.y = Math.PI;
      group.add(chair);
      cylinder(chair, 0.055, 0.43, [0, 0.27, 0], "#626b67");
      for (let spoke = 0; spoke < 5; spoke++) {
        const base = new THREE.Group();
        base.rotation.y = (spoke * Math.PI * 2) / 5;
        chair.add(base);
        box(base, [0.065, 0.065, 0.4], [0, 0.09, 0.17], "#3b4843", 0.025);
        sphere(base, 0.065, [0, 0.065, 0.36], "#29332f");
      }
      box(chair, [0.7, 0.16, 0.56], [0, 0.5, -0.08], "#46685e", 0.07);
      box(chair, [0.69, 0.64, 0.12], [0, 0.91, -0.39], "#52796b", 0.06);
      box(chair, [0.08, 0.48, 0.07], [0, 0.59, -0.38], "#3b4843");
      const person = new THREE.Group();
      group.add(person);
      const shell = index % 2 ? "#d6e5e7" : "#f1ddbc";
      const trim = index % 2 ? "#7297a6" : "#c29359";
      box(person, [0.47, 0.16, 0.32], [0, 0, 0], trim, 0.06);
      box(person, [0.55, 0.5, 0.36], [0, 0.34, 0], shell, 0.1);
      box(person, [0.17, 0.045, 0.012], [0, 0.39, 0.19], trim, 0.01);
      const head = new THREE.Group();
      head.position.set(0, 0.82, 0);
      person.add(head);
      box(head, [0.56, 0.46, 0.47], [0, 0, 0], shell, 0.1);
      box(head, [0.42, 0.2, 0.025], [0, 0, 0.24], "#233835", 0.05);
      for (const eye of [-0.1, 0.1])
        sphere(head, 0.036, [eye, 0, 0.26], "#d5f8eb");
      const arms: THREE.Group[] = [],
        elbows: THREE.Group[] = [],
        legs: THREE.Group[] = [],
        knees: THREE.Group[] = [];
      for (const side of [-1, 1]) {
        const arm = new THREE.Group();
        arm.position.set(side * 0.37, 0.53, 0);
        person.add(arm);
        arms.push(arm);
        sphere(arm, 0.085, [0, 0, 0], trim);
        box(arm, [0.15, 0.25, 0.18], [0, -0.14, 0], shell, 0.045);
        const elbow = new THREE.Group();
        elbow.position.y = -0.28;
        arm.add(elbow);
        elbows.push(elbow);
        box(elbow, [0.14, 0.2, 0.17], [0, -0.09, 0], shell, 0.04);
        sphere(elbow, 0.09, [0, -0.22, 0], trim);
        const leg = new THREE.Group();
        leg.position.x = side * 0.155;
        person.add(leg);
        legs.push(leg);
        box(leg, [0.2, 0.3, 0.21], [0, -0.16, 0], trim, 0.055);
        const knee = new THREE.Group();
        knee.position.y = -0.32;
        leg.add(knee);
        knees.push(knee);
        sphere(knee, 0.085, [0, 0, 0], "#67776e");
        box(knee, [0.18, 0.43, 0.2], [0, -0.27, 0], shell, 0.05);
        box(knee, [0.24, 0.18, 0.34], [0, -0.57, 0.07], "#354b43", 0.045);
      }
      const mug = new THREE.Group();
      elbows[1].add(mug);
      mug.position.set(0, -0.21, 0.1);
      cylinder(mug, 0.09, 0.16, [0, 0, 0], "#cb865d");
      cylinder(mug, 0.07, 0.008, [0, 0.084, 0], "#513b2b");
      const signal = box(
        group,
        [0.08, 0.08, 0.08],
        [-0.51, 2.13, -0.26],
        "#ededed",
        0.015,
      );
      stations.push({
        id: agent.id,
        phase: agent.phase,
        group,
        head,
        person,
        arms,
        elbows,
        legs,
        knees,
        mug,
        elapsed: 0,
        index,
        pose: officePose(agent.phase, 0, index),
        seated: officePose(agent.phase, 0, index).seated,
        screen,
        signal,
        anchor: new THREE.Vector3(x + SEAT[0], 2.75, z + SEAT[1]),
      });
    });
    updateAgents(agents);
    resize();
  }
  function updateAgents(agents: Agent[]) {
    if (
      agents.length !== stations.length ||
      agents.some((agent, i) => agent.id !== stations[i].id)
    ) {
      build(agents);
      return;
    }
    for (let i = 0; i < agents.length; i++) {
      const station = stations[i];
      if (station.phase !== agents[i].phase) station.elapsed = 0;
      station.phase = agents[i].phase;
      station.pose = officePose(station.phase, station.elapsed, station.index);
      station.seated = station.pose.seated;
      applyPose(station, 0, true);
      station.screen.emissiveIntensity = station.phase === "new" ? 0.02 : 0.2;
      station.signal.visible = ["waiting", "human", "replaying"].includes(
        station.phase,
      );
    }
    render();
    schedule();
  }
  function render(projectLabels = true) {
    if (disposed) return;
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    if (!projectLabels) return;
    const { width, height } = host.getBoundingClientRect();
    options.onLabels(
      stations.map((station) => {
        const p = station.anchor.clone().project(camera);
        return {
          id: station.id,
          x: ((p.x + 1) * width) / 2,
          y: ((1 - p.y) * height) / 2,
          visible:
            p.z > -1 && p.z < 1 && Math.abs(p.x) < 0.94 && Math.abs(p.y) < 0.9,
        };
      }),
    );
  }
  function resize() {
    if (disposed) return;
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height);
    const aspect = width / height;
    const viewHeight = Math.max(roomDepth * 0.9 + 3.2, 17.5 / aspect);
    camera.left = (-viewHeight * aspect) / 2;
    camera.right = (viewHeight * aspect) / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
    render();
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (disposed || motion.matches || document.hidden || !stations.length) {
      lastTime = 0;
      return;
    }
    frame = requestAnimationFrame(animate);
  }
  function applyPose(station: Station, delta: number, immediate = false) {
    const pose = station.pose;
    station.seated = immediate
      ? pose.seated
      : THREE.MathUtils.damp(station.seated, pose.seated, 12, delta);
    const sit = station.seated;
    const gait = pose.walking ? Math.sin(station.elapsed * 8) : 0;
    station.person.position.set(
      pose.x,
      THREE.MathUtils.lerp(STANDING_HEIGHT, SEATED_HEIGHT, sit) +
        (pose.walking ? Math.abs(gait) * 0.035 : 0),
      pose.z,
    );
    const angle = Math.atan2(
      Math.sin(pose.heading - station.person.rotation.y),
      Math.cos(pose.heading - station.person.rotation.y),
    );
    station.person.rotation.y += immediate
      ? angle
      : angle * Math.min(1, delta * 9);
    station.person.rotation.z = pose.walking ? gait * 0.025 : 0;
    for (let side = 0; side < 2; side++) {
      const stride = gait * (side === 0 ? 1 : -1);
      station.legs[side].rotation.x = THREE.MathUtils.lerp(
        stride * 0.5,
        -Math.PI / 2,
        sit,
      );
      station.knees[side].rotation.x = THREE.MathUtils.lerp(
        Math.max(0, -stride) * 0.55,
        Math.PI / 2,
        sit,
      );
      station.arms[side].rotation.set(
        pose.typing
          ? -1.25 + Math.sin(station.elapsed * 15 + side * Math.PI) * 0.09
          : -stride * 0.45,
        0,
        side === 0 ? 0.07 : -0.07,
      );
      station.elbows[side].rotation.x = pose.typing ? -0.35 : -0.18;
    }
    if (pose.waving) {
      station.arms[0].rotation.z =
        -2.5 + (motion.matches ? 0 : Math.sin(station.elapsed * 4) * 0.18);
      station.elbows[0].rotation.x = -0.3;
    }
    if (pose.coffee) {
      station.arms[1].rotation.x = -0.6;
      station.elbows[1].rotation.x = -1.4;
      station.mug.rotation.x = 2;
    }
    station.mug.visible = pose.coffee;
    station.head.rotation.set(
      pose.typing ? 0.1 + Math.sin(station.elapsed * 9) * 0.025 : 0,
      motion.matches
        ? 0
        : Math.sin(station.elapsed * 0.85 + station.index) * 0.14,
      0,
    );
    station.anchor.set(
      station.group.position.x + pose.x,
      station.person.position.y + 1.45,
      station.group.position.z + pose.z,
    );
    station.screen.emissiveIntensity =
      station.phase === "new"
        ? 0.02
        : pose.typing
          ? 0.2 + Math.sin(station.elapsed * 5) * 0.07
          : 0.15;
  }
  function animate(time: number) {
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    lastTime = time;
    for (const station of stations) {
      station.elapsed += delta;
      station.pose = officePose(station.phase, station.elapsed, station.index);
      applyPose(station, delta);
    }
    // Thirty frames per second is enough for the office; labels follow people.
    if (time - lastRender >= 1000 / 30) {
      render();
      lastRender = time;
    }
    schedule();
  }
  function resetCamera() {
    camera.position.set(11, 12, 14);
    camera.zoom = 1;
    controls.target.set(0, 0.5, 0);
    controls.update();
    resize();
  }
  function hit(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    for (const intersection of raycaster.intersectObjects(
      stations.map((s) => s.group),
      true,
    )) {
      let object: THREE.Object3D | null = intersection.object;
      while (object) {
        if (object.userData.agentId) return object.userData.agentId as string;
        object = object.parent;
      }
    }
    return null;
  }
  function down(event: PointerEvent) {
    pointerDown = { x: event.clientX, y: event.clientY };
  }
  function up(event: PointerEvent) {
    if (
      event.button === 0 &&
      pointerDown &&
      Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) <
        6
    ) {
      const id = hit(event);
      if (id) options.onSelect(id);
    }
    pointerDown = null;
  }
  function move(event: PointerEvent) {
    canvas.style.cursor = pointerDown
      ? "grabbing"
      : hit(event)
        ? "pointer"
        : "grab";
  }
  function cancel() {
    pointerDown = null;
  }
  function contextLost(event: Event) {
    event.preventDefault();
    options.onFailure();
  }
  function motionChanged() {
    host.dataset.motion = motion.matches ? "reduced" : "full";
    render();
    schedule();
  }
  const cameraChanged = () => render();
  controls.addEventListener("change", cameraChanged);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("lostpointercapture", cancel);
  canvas.addEventListener("webglcontextlost", contextLost);
  document.addEventListener("visibilitychange", schedule);
  motion.addEventListener("change", motionChanged);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  host.dataset.motion = motion.matches ? "reduced" : "full";
  build(initialAgents);
  return {
    updateAgents,
    resetCamera,
    zoomBy(factor: number) {
      camera.zoom = THREE.MathUtils.clamp(
        camera.zoom * factor,
        controls.minZoom,
        controls.maxZoom,
      );
      camera.updateProjectionMatrix();
      render();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      document.removeEventListener("visibilitychange", schedule);
      motion.removeEventListener("change", motionChanged);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("lostpointercapture", cancel);
      canvas.removeEventListener("webglcontextlost", contextLost);
      disposeGroup(room);
      stations.forEach((s) => s.screen.dispose());
      materials.forEach((m) => m.dispose());
      light.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
