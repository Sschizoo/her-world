/* Frozen v0.5.4 is only a reader. It never writes the original save keys. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./legacy/v0.5.4/engine.js') : root.HerEngine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerFrameworkLegacy = api;
})(typeof window !== 'undefined' ? window : null, function (LEGACY) {
  'use strict';
  const KEYS = ['her-world.prologue.v3', 'her-world.prologue.v2'];
  const copy = value => JSON.parse(JSON.stringify(value));
  function inspect(raw) {
    try {
      if (!LEGACY || (typeof raw === 'string' && raw.length > 1000000)) return { ok: false, error: 'LEGACY_INVALID' };
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const restored = LEGACY.restore(value);
      if (!restored) return { ok: false, error: 'LEGACY_INVALID' };
      const view = LEGACY.view(restored);
      const milestones = view.milestones.slice();
      const facts = {};
      if (milestones.includes('rain_taught')) facts.rain_described = true;
      if (milestones.includes('rain_named')) facts.rain_named = true;
      if (milestones.includes('memory_found')) facts.records_seen = true;
      // A new content pack must ask its own consent question; archive the old
      // decision without silently treating it as a fresh grant.
      const annotations = {};
      for (const [target, annotation] of Object.entries(view.scene.annotations)) annotations[target === 'first_rain' ? 'rain' : target] = copy(annotation);
      const memories = [...view.memories, ...view.memoryNotes].map(item => ({
        id: item.kind === 'world_note' ? item.id : 'note_legacy_' + item.id,
        title: item.title, body: item.body,
        source: item.kind === 'world_note' ? item.createdFrom || item.source || null : item.id === 'first_rain' ? view.memoryContext.rainDescription : null,
        latestSource: item.kind === 'world_note' ? item.latestUpdatedFrom || item.source || null : item.id === 'first_rain' ? view.memoryContext.rainNameSource || view.memoryContext.rainDescription : null
      }));
      const projection = {
        origin: { type: 'legacy-v3', version: '0.5.4', milestones },
        world: {
          objects: copy(view.scene.objects), annotations,
          weather: { kind: 'rain', name: view.rain.name, intensity: view.rain.created ? { gentle: 1, normal: 2, heavy: 3 }[view.rain.density] : 0, paused: view.rain.paused, source: view.memoryContext.rainNameSource || view.memoryContext.rainDescription || null }
        },
        memories,
        transcript: view.messages.map(item => ({ role: item.role === 'user' ? 'user' : item.role === 'system' ? 'system' : 'character', text: item.text })),
        facts
      };
      return { ok: true, projection, summary: { objects: projection.world.objects.length, memories: memories.length, messages: projection.transcript.length, milestones, weatherName: view.rain.name, visitorChoice: view.memoryContext.visitorChoice } };
    } catch { return { ok: false, error: 'LEGACY_INVALID' }; }
  }
  function read(storage) {
    try {
      for (const key of KEYS) { const raw = storage.getItem(key); if (raw) return inspect(raw); }
      return { ok: false, error: 'LEGACY_MISSING' };
    } catch { return { ok: false, error: 'LEGACY_STORAGE_UNAVAILABLE' }; }
  }
  return Object.freeze({ inspect, read, keys: () => KEYS.slice() });
});
