import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Agent, Phase } from "../../demo";

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
  arm: THREE.Group;
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
  renderer.toneMappingExposure = 1.25;
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
          roughness: 0.75,
          metalness: 0.12,
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
  scene.add(new THREE.HemisphereLight("#ffffff", "#303030", 2.1));
  const light = new THREE.DirectionalLight("#ffffff", 3.8);
  light.position.set(1, 10, 6);
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
  const rim = new THREE.DirectionalLight("#ffffff", 1.8);
  rim.position.set(-8, 6, -5);
  scene.add(rim);
  const room = new THREE.Group();
  scene.add(room);
  let stations: Station[] = [];
  let roomDepth = 9;
  let disposed = false;
  let frame = 0;
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
    box(room, [12, 0.25, roomDepth], [0, -0.22, 0], "#242424", 0.06);
    box(room, [12, 0.08, roomDepth], [0, -0.04, 0], "#393939");
    // A cutaway studio: two walls, low storage, and a backlit wall panel.
    box(room, [12, 2.5, 0.16], [0, 1.2, -roomDepth / 2], "#282828");
    box(room, [0.16, 2.5, roomDepth], [-6, 1.2, 0], "#222222");
    for (let i = -5; i <= 5; i++)
      box(room, [0.012, 0.008, roomDepth], [i, 0.006, 0], "#484848");
    for (let z = -roomDepth / 2 + 1; z < roomDepth / 2; z++)
      box(room, [12, 0.008, 0.012], [0, 0.006, z], "#484848");
    box(
      room,
      [4.5, 0.95, 0.07],
      [-1.3, 1.6, -roomDepth / 2 + 0.13],
      "#101010",
      0.03,
    );
    for (let i = 0; i < 7; i++)
      box(
        room,
        [0.03, 0.52, 0.03],
        [-3.15 + i * 0.15, 1.6, -roomDepth / 2 + 0.18],
        "#b1b1b1",
      );
    box(
      room,
      [1.7, 0.045, 0.03],
      [-0.5, 1.68, -roomDepth / 2 + 0.18],
      "#8a8a8a",
    );
    box(
      room,
      [1.1, 0.035, 0.03],
      [-0.8, 1.48, -roomDepth / 2 + 0.18],
      "#555555",
    );
    box(
      room,
      [2, 0.85, 0.75],
      [3.65, 0.43, -roomDepth / 2 + 0.65],
      "#333333",
      0.04,
    );
    for (const x of [3.2, 4.1])
      box(
        room,
        [0.6, 0.025, 0.04],
        [x, 0.61, -roomDepth / 2 + 1.05],
        "#777777",
      );
    for (const x of [-4.7, 4.9]) {
      cylinder(room, 0.28, 0.42, [x, 0.22, -roomDepth / 2 + 0.85], "#515151");
      for (let leaf = 0; leaf < 5; leaf++) {
        const stem = box(
          room,
          [0.06, 0.85, 0.06],
          [x + Math.sin(leaf * 2) * 0.15, 0.83, -roomDepth / 2 + 0.85],
          "#808080",
          0.02,
        );
        stem.rotation.z = Math.sin(leaf * 2) * 0.35;
      }
    }
    // Low bench along the open front edge; the center stays clear.
    box(
      room,
      [2.5, 0.2, 0.65],
      [-3.6, 0.45, roomDepth / 2 - 0.65],
      "#333333",
      0.06,
    );
    for (const x of [-4.5, -2.7])
      box(room, [0.12, 0.4, 0.4], [x, 0.2, roomDepth / 2 - 0.65], "#181818");
    agents.forEach((agent, index) => {
      const x = index % 2 === 0 ? -2.45 : 2.1;
      const z = (Math.floor(index / 2) - (rows - 1) / 2) * 3.8;
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.userData.agentId = agent.id;
      room.add(group);
      box(group, [3, 0.13, 1.4], [0, 0.95, 0], "#777777", 0.05);
      for (const legX of [-1.3, 1.3])
        for (const legZ of [-0.5, 0.5])
          box(group, [0.09, 0.9, 0.09], [legX, 0.45, legZ], "#242424");
      box(group, [1.5, 0.018, 0.65], [-0.1, 1.025, 0.2], "#242424", 0.02);
      box(group, [0.5, 0.04, 0.35], [0, 1.05, -0.28], "#272727", 0.02);
      box(group, [0.07, 0.28, 0.08], [0, 1.2, -0.3], "#333333");
      box(group, [1.3, 0.8, 0.1], [0, 1.65, -0.28], "#171717", 0.04);
      const screen = new THREE.MeshStandardMaterial({
        color: "#646464",
        emissive: "#ffffff",
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
          "#c4c4c4",
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
      cylinder(group, 0.1, 0.18, [-1.1, 1.12, 0.28], "#aaaaaa");
      box(group, [0.4, 0.07, 0.5], [1.05, 1.03, -0.25], "#4a4a4a", 0.02);
      const person = new THREE.Group();
      person.position.set(0.72, 0, 1.17);
      group.add(person);
      cylinder(person, 0.36, 0.08, [0, 0.1, 0], "#242424");
      cylinder(person, 0.055, 0.55, [0, 0.39, 0], "#777777");
      box(person, [0.62, 0.15, 0.6], [0, 0.72, 0], "#252525", 0.06);
      box(person, [0.62, 0.65, 0.14], [0, 1.03, -0.28], "#333333", 0.06);
      for (const side of [-1, 1]) {
        box(
          person,
          [0.2, 0.44, 0.23],
          [side * 0.17, 0.51, -0.17],
          "#747474",
          0.05,
        );
        box(
          person,
          [0.22, 0.14, 0.38],
          [side * 0.17, 0.3, -0.27],
          "#252525",
          0.04,
        );
      }
      box(person, [0.55, 0.53, 0.37], [0, 1.04, 0], "#a2a2a2", 0.1);
      const head = new THREE.Group();
      head.position.set(0, 1.57, 0);
      person.add(head);
      box(head, [0.56, 0.46, 0.47], [0, 0, 0], "#c2c2c2", 0.1);
      box(head, [0.42, 0.2, 0.025], [0, 0, 0.24], "#1a1a1a", 0.05);
      for (const eye of [-0.1, 0.1])
        sphere(head, 0.035, [eye, 0, 0.26], "#dedede");
      const arm = new THREE.Group();
      arm.position.set(-0.38, 1.21, 0);
      person.add(arm);
      box(arm, [0.16, 0.43, 0.19], [0, -0.18, 0], "#9a9a9a", 0.05);
      sphere(arm, 0.1, [0, -0.4, 0], "#c2c2c2");
      box(person, [0.16, 0.4, 0.19], [0.37, 1.03, 0], "#9a9a9a", 0.05);
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
        arm,
        screen,
        signal,
        anchor: new THREE.Vector3(x + 0.72, 2.75, z + 1.17),
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
      station.phase = agents[i].phase;
      station.arm.rotation.z = station.phase === "waiting" ? -2.25 : -0.1;
      station.head.rotation.y = station.phase === "replaying" ? Math.PI : -0.25;
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
    if (
      disposed ||
      motion.matches ||
      document.hidden ||
      !stations.some((s) => ["waiting", "human", "replaying"].includes(s.phase))
    )
      return;
    frame = requestAnimationFrame(animate);
  }
  function animate(time: number) {
    for (const s of stations) {
      if (s.phase === "waiting")
        s.arm.rotation.z = -2.25 + Math.sin(time / 650) * 0.12;
      if (s.phase === "human")
        s.head.rotation.y = -0.25 + Math.sin(time / 1300) * 0.15;
      if (s.phase === "replaying") {
        s.head.rotation.x = Math.sin(time / 170) * 0.05;
        s.screen.emissiveIntensity = 0.2 + Math.sin(time / 330) * 0.1;
      }
    }
    render(false);
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
