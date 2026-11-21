// Plugin-Schnittstelle: Plugins registrieren Filter (Menü Filter › Plugins) und Befehle (Menü Hilfe › Plugin-Befehle)
import { S, doc, emit, toast, commit, view } from './state.js';
import { FILTERS } from './engine/filters.js';
import { makeCanvas } from './engine/util.js';

export const PLUGIN_COMMANDS = [];
export const PLUGIN_FILTERS = [];
export const PLUGIN_ERRORS = [];

function api(file) {
  return {
    registerFilter(def) {
      if (!def || !def.id || typeof def.apply !== 'function') throw new Error('registerFilter: id und apply() erforderlich');
      const id = 'plugin_' + def.id;
      FILTERS[id] = { group: 'Plugins', name: def.name || def.id, params: def.params || [], apply: def.apply, plugin: file };
      if (!PLUGIN_FILTERS.includes(id)) PLUGIN_FILTERS.push(id);
    },
    registerCommand(def) {
      if (!def || !def.label || typeof def.run !== 'function') throw new Error('registerCommand: label und run() erforderlich');
      PLUGIN_COMMANDS.push({ label: def.label, run: def.run, file });
    },
    document: () => doc(), toast, commit, refresh: () => { view.request(); emit(); }, makeCanvas, state: S,
  };
}

export async function loadPlugins() {
  if (!window.native || !window.native.pluginsList) return 0;
  PLUGIN_COMMANDS.length = 0; PLUGIN_ERRORS.length = 0;
  PLUGIN_FILTERS.splice(0).forEach((id) => delete FILTERS[id]);
  const list = await window.native.pluginsList();
  for (const p of list) {
    try { new Function('lumora', p.code)(api(p.name)); }
    catch (e) { PLUGIN_ERRORS.push(p.name + ': ' + e.message); console.error('Plugin-Fehler', p.name, e); }
  }
  emit();
  return list.length;
}
