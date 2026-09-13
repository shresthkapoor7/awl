export type WorkspaceBridge = {
  onTogglePanel: (listener: (side: "left" | "right") => void) => () => void;
};
