import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/types';
const call = async (method: string, ...args: unknown[]) => {
  const reply = await ipcRenderer.invoke('chromatic', method, ...args);
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
};
const api: Api = {
  snapshot: () => call('snapshot'), save: draft => call('save', draft), remove: id => call('remove', id), launch: id => call('launch', id),
  discover: () => call('discover'), importProfiles: keys => call('importProfiles', keys), addBrowser: family => call('addBrowser', family),
  chooseDirectory: () => call('chooseDirectory'), exportProfiles: ids => call('exportProfiles', ids), previewSlim: ids => call('previewSlim', ids), clean: tokens => call('clean', tokens),
  unlock: pin => call('unlock', pin), setPin: (pin, oldPin) => call('setPin', pin, oldPin), lock: () => call('lock'),
  settings: settings => call('settings', settings), manager: id => call('manager', id), dismiss: () => call('dismiss'),
  activity: () => ipcRenderer.send('activity'),
  onChange: callback => { ipcRenderer.on('changed', callback); return () => ipcRenderer.removeListener('changed', callback); }
};
contextBridge.exposeInMainWorld('chromatic', api);
