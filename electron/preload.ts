import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/types';
const call = async (method: string, ...args: unknown[]) => {
  const reply = await ipcRenderer.invoke('chromatic', method, ...args);
  if (!reply.ok && reply.code && method === 'launch') return { error: { code: reply.code, profileId: reply.profileId, message: reply.error } };
  if (!reply.ok) throw Object.assign(new Error(reply.error), { code: reply.code, profileId: reply.profileId });
  return reply.value;
};
const api: Api = {
  copyProfile: (id, mode, name) => call('copyProfile', id, mode, name), cancelOperation: id => call('cancelOperation', id), scanStorage: ids => call('scanStorage', ids), testProxy: (proxy, id) => call('testProxy', proxy, id), labels: (ids, labels, mode) => call('labels', ids, labels, mode), locateBrowser: id => call('locateBrowser', id), openFolder: id => call('openFolder', id),
  snapshot: () => call('snapshot'), save: draft => call('save', draft), remove: id => call('remove', id), launch: id => call('launch', id),
  discover: () => call('discover'), importProfiles: keys => call('importProfiles', keys), addBrowser: () => call('addBrowser'),
  chooseDirectory: () => call('chooseDirectory'), exportProfiles: ids => call('exportProfiles', ids), previewSlim: ids => call('previewSlim', ids), clean: tokens => call('clean', tokens),
  unlock: pin => call('unlock', pin), setPin: (pin, oldPin) => call('setPin', pin, oldPin), lock: () => call('lock'),
  settings: settings => call('settings', settings), manager: id => call('manager', id), dismiss: () => call('dismiss'),
  launcher: () => call('launcher'),
  clearPending: () => call('clearPending'),
  activity: () => ipcRenderer.send('activity'),
  onChange: callback => { ipcRenderer.on('changed', callback); return () => ipcRenderer.removeListener('changed', callback); }
};
contextBridge.exposeInMainWorld('chromatic', api);
