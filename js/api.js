// Version en ligne : le « serveur » tourne dans le navigateur (js/backend/).
// On copie les données à l'aller et au retour, comme si elles passaient par internet.
import { init, handle, fileUrl as backendFileUrl } from './backend/server.js';

let ready = null;
const boot = () => ready || (ready = init());
const copy = (v) => (v === undefined ? v : structuredClone(v));

async function call(method, path, body) {
  await boot();
  try {
    return copy(await handle(method, path, copy(body)));
  } catch (e) {
    const err = new Error(e?.message || 'Erreur inconnue');
    err.status = e?.status || 500;
    if (err.status >= 500 && !e?.friendly) console.error(e);
    throw err;
  }
}

export const api = {
  get: (p) => call('GET', p),
  post: (p, b = {}) => call('POST', p, b),
  patch: (p, b = {}) => call('PATCH', p, b),
  del: (p) => call('DELETE', p, {}),
};

export const fileUrl = (dir, name) => (name ? backendFileUrl(dir, name) : '');
