const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendCommand: async (image, command) => {
    const response = await fetch('http://127.0.0.1:8080/api/container/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, command }),
    });
    return response.json();
  },
});
