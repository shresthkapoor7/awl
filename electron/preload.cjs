const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("awlAgent", {
  state: () => ipcRenderer.invoke("agent:state"),
  create: (id) => ipcRenderer.invoke("agent:create", id),
  capabilities: () => ipcRenderer.invoke("agent:capabilities"),
  send: (id, text) => ipcRenderer.invoke("agent:send", { id, text }),
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
