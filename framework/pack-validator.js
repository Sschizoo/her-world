/* Data-only content packs. Strict fields, finite values and bounded graphs. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./capabilities.js') : root.HerCapabilities);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerPackValidator = api;
})(typeof window !== 'undefined' ? window : null, function (CAPS) {
  'use strict';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const fields = (value, allowed, required = allowed) => plain(value) && required.every(key => own(value, key)) && Object.keys(value).every(key => allowed.includes(key));
  const safe = (value, max) => typeof value === 'string' && value.length > 0 && [...value].length <= max && value === value.normalize('NFC').trim() && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(value);
  const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/u.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
  const scalar = value => typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6 || safe(value, 800);
  const facts = value => plain(value) && Object.keys(value).length <= 128 && Object.keys(value).every(key => identifier(key) && scalar(value[key]));
  const list = (value, max, predicate) => Array.isArray(value) && value.length <= max && value.every(predicate);
  const unique = (values, field = 'id') => new Set(values.map(value => value[field])).size === values.length;
  const byteLength = text => [...text].reduce((sum, char) => { const code = char.codePointAt(0); return sum + (code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4); }, 0);
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  function validatePack(pack) {
    const fail = path => ({ ok: false, error: { code: 'PACK_INVALID', path } });
    if (!fields(pack, ['id', 'version', 'rulesVersion', 'title', 'guidance', 'character', 'world', 'capabilities', 'topics', 'entities', 'initialFacts', 'nodes'], ['id', 'version', 'rulesVersion', 'title', 'character', 'world', 'capabilities', 'topics', 'entities', 'initialFacts', 'nodes'])) return fail('$');
    if (!identifier(pack.id) || !safe(pack.version, 40) || !safe(pack.rulesVersion, 40) || !safe(pack.title, 120) || own(pack, 'guidance') && !safe(pack.guidance, 3000)) return fail('identity');
    if (!fields(pack.character, ['name', 'role', 'mood', 'stance', 'trust', 'familiarity'], ['name', 'role', 'mood', 'stance']) || !safe(pack.character.name, 60) || !safe(pack.character.role, 800) || !safe(pack.character.mood, 80) || !safe(pack.character.stance, 160) || ['trust', 'familiarity'].some(key => own(pack.character, key) && !integer(pack.character[key], 0, 100))) return fail('character');
    if (!fields(pack.world, ['capacity', 'landmarks', 'weather'], ['capacity', 'landmarks']) || !integer(pack.world.capacity, 1, 8) || !plain(pack.world.landmarks) || Object.keys(pack.world.landmarks).length > 12) return fail('world');
    for (const [id, landmark] of Object.entries(pack.world.landmarks)) if (!identifier(id) || !fields(landmark, ['x', 'y', 'width', 'height']) || !integer(landmark.x, 0, 99) || !integer(landmark.y, 0, 59) || !integer(landmark.width, 1, 100) || !integer(landmark.height, 1, 60) || landmark.x + landmark.width > 100 || landmark.y + landmark.height > 60) return fail('world.landmarks');
    if (own(pack.world, 'weather') && (!fields(pack.world.weather, ['kind', 'name', 'intensity', 'paused']) || !safe(pack.world.weather.kind, 32) || !safe(pack.world.weather.name, 40) || !integer(pack.world.weather.intensity, 0, 3) || typeof pack.world.weather.paused !== 'boolean')) return fail('world.weather');
    if (!list(pack.capabilities, CAPS.ids.length, id => CAPS.ids.includes(id)) || new Set(pack.capabilities).size !== pack.capabilities.length) return fail('capabilities');
    if (!list(pack.topics, 32, topic => fields(topic, ['id', 'title']) && identifier(topic.id) && safe(topic.title, 100)) || !pack.topics.length || !unique(pack.topics)) return fail('topics');
    if (!list(pack.entities, 32, entity => fields(entity, ['id', 'label', 'kind']) && identifier(entity.id) && !/^obj_[0-9]+$/u.test(entity.id) && safe(entity.label, 60) && safe(entity.kind, 40)) || !unique(pack.entities)) return fail('entities');
    if (!facts(pack.initialFacts) || Object.keys(pack.initialFacts).some(key => key.startsWith('answer.'))) return fail('initialFacts');
    if (!list(pack.nodes, 64, node => fields(node, ['id', 'topic', 'requires', 'question', 'completion', 'sets', 'optional'], ['id', 'topic', 'requires', 'question', 'completion', 'sets'])) || !unique(pack.nodes)) return fail('nodes');
    const questionIds = new Set();
    for (const node of pack.nodes) {
      if (!identifier(node.id) || !pack.topics.some(topic => topic.id === node.topic) || !facts(node.requires) || !facts(node.sets) || Object.keys(node.sets).some(key => key.startsWith('answer.')) || own(node, 'optional') && typeof node.optional !== 'boolean') return fail('nodes');
      const q = node.question;
      if (!fields(q, ['id', 'text', 'kind', 'choices'], ['id', 'text', 'kind']) || !identifier(q.id) || questionIds.has(q.id) || !safe(q.text, 500) || !['open', 'choice', 'consent'].includes(q.kind)) return fail('nodes.question');
      questionIds.add(q.id);
      if (q.kind === 'open' ? own(q, 'choices') : !list(q.choices, 8, choice => fields(choice, ['id', 'label']) && identifier(choice.id) && safe(choice.label, 120)) || q.choices.length < 2 || !unique(q.choices)) return fail('nodes.question.choices');
      if (q.kind === 'consent' && (q.choices.length !== 2 || !q.choices.some(choice => choice.id === 'allow') || !q.choices.some(choice => choice.id === 'decline'))) return fail('nodes.question.consent');
      const c = node.completion;
      if (!plain(c)) return fail('nodes.completion');
      if (c.type === 'answer') { if (!fields(c, ['type']) || !pack.capabilities.includes('story.answer')) return fail('nodes.completion'); }
      else if (c.type === 'operation') { if (!fields(c, ['type', 'operation', 'target'], ['type', 'operation']) || !pack.capabilities.includes(c.operation) || ['story.answer', 'story.defer', 'panel.open'].includes(c.operation) || own(c, 'target') && !pack.entities.some(entity => entity.id === c.target)) return fail('nodes.completion'); }
      else if (c.type === 'ui') { if (!fields(c, ['type', 'panel']) || !CAPS.panels.includes(c.panel)) return fail('nodes.completion'); }
      else return fail('nodes.completion');
    }
    for (const node of pack.nodes) for (const fact of Object.keys(node.requires)) if (fact.startsWith('answer.') && !questionIds.has(fact.slice(7))) return fail('nodes.requires');
    if (byteLength(JSON.stringify(pack)) > 24 * 1024) return { ok: false, error: { code: 'PACK_CAPACITY', path: '$' } };
    return { ok: true, value: JSON.parse(JSON.stringify(pack)) };
  }
  return Object.freeze({ validatePack, safeText: safe, identifier, scalar, fields, plain, byteLength });
});
