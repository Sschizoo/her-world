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
  const placementSchema = anchors => ({ anyOf: [
    record({ anchor: enumeration(anchors) }),
    record({ anchor: enumeration(['window_left', 'window_right', 'window_below']), gap: integer(0, 10) }, ['anchor']),
    record({ anchor: enumeration(['above', 'below', 'left_of', 'right_of']), target, gap: integer(0, 10) }, ['anchor', 'target'])
  ] });
  const createPlacement = placementSchema(['sky', 'ground']);
  const placement = placementSchema(['sky', 'ground', 'keep_center', 'keep_base']);
  const shape = { label: text(40), glyphs: text(249), x: integer(0, 99), y: integer(0, 59), scale: integer(1, 3) };
  const weatherKinds = ['rain', 'snow', 'mist', 'clear'];
  const weather = { kind: enumeration(weatherKinds), name: text(40), intensity: integer(0, 3), paused: { type: 'boolean' } };
  const definitions = [
    ['world.create', 'Create one original printable ASCII object (24 columns by 10 rows, scale 1..3, grid 100x60, maximum world.capacity objects); label and glyphs may be creatively derived. Use both integer x/y or top-level placement, never both. Sky and ground accept anchor only and need the named landmark in world.landmarks. Window anchors need the window landmark and accept optional gap 0..10 (default 2), never target. Relative anchors require an existing object or landmark target and accept optional gap 0..10 (default 2). Entire footprint must fit the grid. IDs and provenance are assigned locally.', { object: record(shape, ['label', 'glyphs', 'scale']), placement: createPlacement, evidence }, ['object', 'evidence']],
    ['world.update', 'Edit an existing object by stable ID, preserving printable ASCII <=24 columns by10 rows and a footprint inside100x60. Use nonempty changes without placement, or visual changes plus placement without x/y. Fixed window anchors accept optional gap 0..10 (default 2), never target; relative anchors require target and allow the same gap. Sky, ground, keep_center and keep_base accept anchor only. Keep modes require an existing object and preserve its resize anchor.', { target, changes: record(shape, []), placement, evidence }, ['target', 'changes', 'evidence']],
    ['world.remove', 'Remove an existing object and its annotations.', { target, evidence }],
    ['world.annotate', 'Set or clear a user meaning (maximum120 characters) or the fictional character interpretation independently; never combine these fields.', { target, field: enumeration(['meaning', 'interpretation']), value: { anyOf: [text(120), { type: 'null' }] }, evidence }],
    ['weather.set', 'Change rendered weather: kind is rain, snow, mist, or clear only. Clear has no particles and requires intensity 0. Setting kind clear without intensity resets it to 0; an explicitly positive intensity with clear is invalid, including when clear is already current. Other kinds retain their current intensity unless supplied.', { changes: record(weather, [], { minProperties: 1 }), evidence }],
    ['memory.upsert', 'Create or revise a note (maximum14 current notes; title60, body240 characters). Its original source is retained separately from its current revision. Reuse the ID for corrections.', { id: { ...text(37), pattern: '^note_[a-z0-9_]{1,32}$' }, title: text(60), body: text(240), evidence }],
    ['memory.remove', 'Remove a current note by stable ID; the immutable event transcript retains the original.', { id: { ...text(37), pattern: '^note_[a-z0-9_]{1,32}$' }, evidence }],
    ['story.answer', 'Explicitly answer at most one pre-turn pending question per turn (value maximum200 characters); newly unlocked questions wait until next turn. Set plan.topic to that question topic. Choice values are declared choice IDs. Consent allow requires explicit current permission and the pre-turn active question must be that consent question. Never answer an unrelated question.', { questionId: target, value: text(200), evidence }],
    ['story.defer', 'Leave a currently pending question unresolved for later. It can be resumed by returning to its topic.', { questionId: target, evidence }],
    ['character.update', 'Update only fictional mood/stance and bounded fictional relationship deltas (each cumulative trust/familiarity delta must stay within -5..5, applied to turn-start scores and clipped0..100); this is narrative state, never real telemetry. Current input is the basis.', { changes: record({ mood: text(80), stance: text(160), trustDelta: integer(-5, 5), familiarityDelta: integer(-5, 5) }, [], { minProperties: 1 }), evidence }],
    ['log.note', 'Append a fictional character observation. Must not claim an actual UI visit or device telemetry.', { text: text(160), evidence }],
    ['panel.open', 'Request a panel at this sentence boundary. This does not prove the player viewed it and cannot complete a UI question.', { panel: enumeration(panels) }]
  ];
  const visualShape = { label: shape.label, glyphs: shape.glyphs, scale: shape.scale };
  const registry = Object.fromEntries(definitions.map(([id, description, properties, required]) => {
    const schema = record({ type: { const: id }, ...properties }, ['type', ...(required || Object.keys(properties)).filter(key => key !== 'evidence')]);
    // Standard JSON Schema conditionals describe exactly the structural choices
    // enforced locally; geometry and target existence still depend on state.
    if (id === 'world.create') schema.anyOf = [
      { properties: { placement: false, object: { required: ['x', 'y'] } } },
      { required: ['placement'], properties: { object: record(visualShape) } }
    ];
    if (id === 'world.update') schema.anyOf = [
      { properties: { placement: false, changes: { minProperties: 1 } } },
      { required: ['placement'], properties: { changes: record(visualShape, []) } }
    ];
    return [id, freeze({ id, description, schema })];
  }));
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function matches(value, schema) {
    if (typeof schema === 'boolean') return schema;
    if (schema.anyOf && !schema.anyOf.some(candidate => matches(value, candidate))) return false;
    if ('const' in schema && value !== schema.const) return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    if (schema.type === 'null') return value === null;
    if (schema.type === 'boolean') return typeof value === 'boolean';
    if (schema.type === 'integer') return Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum;
    if (schema.type === 'string') return typeof value === 'string' && [...value].length >= (schema.minLength || 0) && [...value].length <= (schema.maxLength || Infinity) && (!schema.pattern || new RegExp(schema.pattern, 'u').test(value));
    if (schema.type === 'object' || schema.properties || schema.required || schema.minProperties !== undefined) {
      if (!plain(value)) return false;
      const properties = schema.properties || {};
      return Object.keys(value).length >= (schema.minProperties || 0) && (schema.required || []).every(key => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every(key => Object.prototype.hasOwnProperty.call(properties, key) ? matches(value[key], properties[key]) : schema.additionalProperties !== false);
    }
    return 'const' in schema || Boolean(schema.anyOf);
  }
  function validate(operation) { return plain(operation) && Object.prototype.hasOwnProperty.call(registry, operation.type) && matches(operation, registry[operation.type].schema); }
  function descriptors(ids) { return (ids || Object.keys(registry)).map(id => registry[id]).filter(Boolean); }
  // Shared with the model adapter. Field order is part of the captured request
  // contract; these values are also duplicated inside escaped message strings.
  function modelDefinition(context) {
    return { pack: context.pack, persona: { name: context.character.name ?? '', role: context.character.role ?? '' }, guidance: context.guidance ?? '', topics: context.topics, capabilities: context.capabilities };
  }
  function requestContextBytes(context) {
    const encoded = JSON.stringify({ context: JSON.stringify(context), definition: JSON.stringify(modelDefinition(context)) });
    return [...encoded].reduce((total, character) => { const point = character.codePointAt(0); return total + (point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4); }, 0);
  }

  return freeze({ SCHEMA: 'her-world-turn-v2', RULES_VERSION: '2', weatherKinds, ids: Object.keys(registry), panels, descriptors, validate, modelDefinition, requestContextBytes });
});
