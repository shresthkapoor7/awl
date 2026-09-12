const { contextBridge, ipcRenderer } = require("electron");

// Only the app shell receives this preload. No generic IPC or script execution.
contextBridge.exposeInMainWorld("awlBrowser", {
  command: (command) => ipcRenderer.invoke("browser:command", command),
  present: (agentId, lease, bounds) =>
    ipcRenderer.invoke("browser:present", { agentId, lease, bounds }),
  hide: (lease) => ipcRenderer.invoke("browser:hide", lease),
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
