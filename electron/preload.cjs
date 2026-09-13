const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("awlAgent", {
  state: () => ipcRenderer.invoke("agent:state"),
  create: (id) => ipcRenderer.invoke("agent:create", id),
  deleteSession: (id) => ipcRenderer.invoke("agent:delete-session", id),
  capabilities: () => ipcRenderer.invoke("agent:capabilities"),
  send: (id, text) => ipcRenderer.invoke("agent:send", { id, text }),
  takeover: (id) => ipcRenderer.invoke("agent:takeover", id),
  resume: (id, requestId, answer) =>
    ipcRenderer.invoke("agent:resume", { id, requestId, answer }),
  launch: (ref, inputs, validation) =>
    ipcRenderer.invoke("agent:launch", { ref, inputs, validation }),
  repair: (id) => ipcRenderer.invoke("agent:repair", id),
  record: (id, action, stepId, parameters) =>
    ipcRenderer.invoke("agent:record", { id, action, stepId, parameters }),
  stop: (id) => ipcRenderer.invoke("agent:stop", id),
  subscribe: (listener) => {
    const handle = (_event, chat) => listener(chat);
    ipcRenderer.on("agent:update", handle);
    return () => ipcRenderer.removeListener("agent:update", handle);
  },
});

// Only the app shell receives this preload. No generic IPC or script execution.
contextBridge.exposeInMainWorld("awlBrowser", {
  command: (command) => ipcRenderer.invoke("browser:command", command),
  present: (agentId, lease, bounds) =>
    ipcRenderer.invoke("browser:present", { agentId, lease, bounds }),
  hide: (lease) => ipcRenderer.invoke("browser:hide", lease),
  onExitFullscreen: (listener) => {
    const handle = () => listener();
    ipcRenderer.on("browser:exit-fullscreen", handle);
    return () => ipcRenderer.removeListener("browser:exit-fullscreen", handle);
  },
  onFocusAddress: (listener) => {
    const handle = () => listener();
    ipcRenderer.on("browser:focus-address", handle);
    return () => ipcRenderer.removeListener("browser:focus-address", handle);
  },
  subscribe: (listener) => {
    const handle = (_event, state) => listener(state);
    ipcRenderer.on("browser:state", handle);
    return () => ipcRenderer.removeListener("browser:state", handle);
  },
});

contextBridge.exposeInMainWorld("awlWorkspace", {
  onTogglePanel: (listener) => {
    const handle = (_event, side) => listener(side);
    ipcRenderer.on("workspace:toggle-panel", handle);
    return () => ipcRenderer.removeListener("workspace:toggle-panel", handle);
  },
});
