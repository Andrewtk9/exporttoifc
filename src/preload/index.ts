import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  openFileDialog: () => ipcRenderer.invoke('file:open-dialog'),
  getFileInfo: (filePath: string) => ipcRenderer.invoke('file:get-info', filePath),
  parseFile: (filePath: string) => ipcRenderer.invoke('file:parse', filePath),
  onParseProgress: (callback: (msg: string) => void) => {
    const handler = (_event: any, msg: string) => callback(msg)
    ipcRenderer.on('parse:progress', handler)
    return () => ipcRenderer.removeListener('parse:progress', handler)
  },
  onConvertProgress: (callback: (data: { message: string; percent: number }) => void) => {
    const handler = (_event: any, data: { message: string; percent: number }) => callback(data)
    ipcRenderer.on('convert:progress', handler)
    return () => ipcRenderer.removeListener('convert:progress', handler)
  },
  saveDialog: () => ipcRenderer.invoke('file:save-dialog'),
  saveFile: (filePath: string, data: Uint8Array) =>
    ipcRenderer.invoke('file:save', filePath, data),
  convertToIfc: (options: any) => ipcRenderer.invoke('convert:to-ifc', options),
  saveState: () => ipcRenderer.invoke('state:save'),
  loadState: () => ipcRenderer.invoke('state:load')
})
