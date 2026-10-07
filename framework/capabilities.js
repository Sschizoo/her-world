/* Declarative, bounded operations understood by the generic world runtime. No IO. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerCapabilities = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
  const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
  const enumeration = values => ({ type: 'string', enum: values });
  const record = (properties, required = Object.keys(properties), extra = {}) => ({ type: 'object', additionalProperties: false, properties, required, ...extra });
  const evidence = text(200), target = text(64), panels = ['world', 'memory', 'logs', 'character'];
  const placement = record({ anchor: enumeration(['sky', 'ground', 'window_left', 'window_right', 'window_below', 'above', 'below', 'left_of', 'right_of', 'keep_center', 'keep_base']), target, gap: integer(0, 10) }, ['anchor']);
  const shape = { label: text(40), glyphs: text(249), x: integer(0, 99), y: integer(0, 59), scale: integer(1, 3) };
  const weather = { kind: text(32), name: text(40), intensity: integer(0, 3), paused: { type: 'boolean' } };
  const definitions = [
    ['world.create', 'Create one original printable ASCII object (24 columns by 10 rows, scale 1..3, grid 100x60, maximum world.capacity objects); label and glyphs may be creatively derived. Use both integer x/y or top-level placement, never both. Placement needs the named landmark in world.landmarks; relative anchors need an existing object or landmark target. Entire footprint must fit the grid. IDs and provenance are assigned locally.', { object: record(shape, ['label', 'glyphs', 'scale']), placement, evidence }, ['object', 'evidence']],
    ['world.update', 'Edit an existing object by stable ID, preserving printable ASCII <=24 columns by10 rows and a footprint inside100x60. Use changes with x/y or placement; keep_center and keep_base preserve a resize anchor.', { target, changes: record(shape, []), placement, evidence }, ['target', 'changes', 'evidence']],
    ['world.remove', 'Remove an existing object and its annotations.', { target, evidence }],
    ['world.annotate', 'Set or clear a user meaning (maximum120 characters) or the fictional character interpretation independently; never combine these fields.', { target, field: enumeration(['meaning', 'interpretation']), value: { anyOf: [text(120), { type: 'null' }] }, evidence }],
    ['weather.set', 'Change the independent weather entity using bounded visual state.', { changes: record(weather, [], { minProperties: 1 }), evidence }],
    ['memory.upsert', 'Create or revise a note (maximum14 current notes; title60, body240 characters). Its original source is retained separately from its current revision. Reuse the ID for corrections.', { id: { ...text(37), pattern: '^note_[a-z0-9_]{1,32}$' }, title: text(60), body: text(240), evidence }],
    ['memory.remove', 'Remove a current note by stable ID; the immutable event transcript retains the original.', { id: { ...text(37), pattern: '^note_[a-z0-9_]{1,32}$' }, evidence }],
    ['story.answer', 'Explicitly answer at most one pre-turn pending question per turn (value maximum200 characters); newly unlocked questions wait until next turn. Set plan.topic to that question topic. Choice values are declared choice IDs. Consent allow requires explicit current permission and the pre-turn active question must be that consent question. Never answer an unrelated question.', { questionId: target, value: text(200), evidence }],
    ['story.defer', 'Leave a currently pending question unresolved for later. It can be resumed by returning to its topic.', { questionId: target, evidence }],
    ['character.update', 'Update only fictional mood/stance and bounded fictional relationship deltas (each cumulative trust/familiarity delta must stay within -5..5, applied to turn-start scores and clipped0..100); this is narrative state, never real telemetry. Current input is the basis.', { changes: record({ mood: text(80), stance: text(160), trustDelta: integer(-5, 5), familiarityDelta: integer(-5, 5) }, [], { minProperties: 1 }), evidence }],
    ['log.note', 'Append a fictional character observation. Must not claim an actual UI visit or device telemetry.', { text: text(160), evidence }],
    ['panel.open', 'Request a panel at this sentence boundary. This does not prove the player viewed it and cannot complete a UI question.', { panel: enumeration(panels) }]
  ];
  const registry = Object.fromEntries(definitions.map(([id, description, properties, required]) => [id, freeze({ id, description, schema: record({ type: { const: id }, ...properties }, ['type', ...(required || Object.keys(properties)).filter(key => key !== 'evidence')]) })]));
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function matches(value, schema) {
    if (schema.anyOf) return schema.anyOf.some(candidate => matches(value, candidate));
    if ('const' in schema && value !== schema.const) return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    if (schema.type === 'null') return value === null;
    if (schema.type === 'boolean') return typeof value === 'boolean';
    if (schema.type === 'integer') return Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum;
    if (schema.type === 'string') return typeof value === 'string' && [...value].length >= (schema.minLength || 0) && [...value].length <= (schema.maxLength || Infinity) && (!schema.pattern || new RegExp(schema.pattern, 'u').test(value));
    if (schema.type === 'object') return plain(value) && Object.keys(value).length >= (schema.minProperties || 0) && schema.required.every(key => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every(key => Object.prototype.hasOwnProperty.call(schema.properties, key) && matches(value[key], schema.properties[key]));
    return 'const' in schema;
  }
  function validate(operation) { return plain(operation) && Object.prototype.hasOwnProperty.call(registry, operation.type) && matches(operation, registry[operation.type].schema); }
  function descriptors(ids) { return (ids || Object.keys(registry)).map(id => registry[id]).filter(Boolean); }
  return freeze({ SCHEMA: 'her-world-turn-v2', ids: Object.keys(registry), panels, descriptors, validate });
});
