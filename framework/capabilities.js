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
  const legacyMemoryId = { ...text(37), pattern: '^note_[a-z0-9_]{1,32}$' };
  const memoryId = { ...text(37), pattern: '^(?:note_[a-z0-9_]{1,32}|memory_[1-9][0-9]{0,4})$' };
  const memorySupport = record({ quote: text(200), start: integer(0, 199), end: integer(1, 200) }, ['quote'], { anyOf: [
    { properties: { start: false, end: false } },
    { required: ['start', 'end'] }
  ] });
  const placementSchema = anchors => ({ anyOf: [
    record({ anchor: enumeration(anchors) }),
    record({ anchor: enumeration(['window_left', 'window_right', 'window_below']), gap: integer(0, 10) }, ['anchor']),
    record({ anchor: enumeration(['above', 'below', 'left_of', 'right_of']), target, gap: integer(0, 10) }, ['anchor', 'target'])
  ] });
  const createPlacement = placementSchema(['sky', 'ground']);
  const placement = placementSchema(['sky', 'ground', 'keep_center', 'keep_base']);
  const placementPolicy = enumeration(['auto', 'exact']);
  const allowOverlap = { type: 'boolean' };
  const shape = { label: text(40), glyphs: text(249), x: integer(0, 99), y: integer(0, 59), scale: integer(1, 3) };
  const weatherKinds = ['rain', 'snow', 'mist', 'clear'];
  const weather = { kind: enumeration(weatherKinds), name: text(40), intensity: integer(0, 3), paused: { type: 'boolean' } };
  const definitions = [
    ['world.create', 'Create one original printable ASCII object (24 columns by 10 rows, scale 1..3, grid 100x60, maximum world.capacity objects); label and glyphs may be creatively derived. Use both integer x/y or top-level placement, never both. Sky and ground accept anchor only and need the named landmark in world.landmarks. Window anchors need the window landmark and accept optional gap 0..10 (default 2), never target. Relative anchors require an existing object or landmark target and accept optional gap 0..10 (default 2). Entire scaled glyph rectangle, including spaces, must fit the grid. placementPolicy defaults to auto: numeric x/y are preferred coordinates; search first along that row, then nearest remaining point (squared distance, ties y then x), avoiding every other object, including earlier operations this turn. Sky stays inside its rectangle; ground keeps its baseline and width; window/relative anchors keep the exact side/gap axis and search only the other axis. Auto creations in the same turn try that preferred layout, then a left-boundary-packed layout, then a bounded joint search so earlier uncommitted creations may be repositioned before any line is shown; existing or saved objects never move. exact preserves the chosen position and rejects overlap; allowOverlap:true requires exact and is only for a player explicitly requesting overlap. No free position rejects the entire turn. Do not promise a specific auto position in dialogue. IDs and provenance are assigned locally.', { object: record(shape, ['label', 'glyphs', 'scale']), placement: createPlacement, placementPolicy, allowOverlap, evidence }, ['object', 'evidence']],
    ['world.update', 'Edit an existing object by stable ID, preserving printable ASCII <=24 columns by10 rows and a footprint inside100x60. Use nonempty changes without placement, or visual changes plus placement without x/y. Fixed window anchors accept optional gap 0..10 (default 2), never target; relative anchors require target and allow the same gap. Sky, ground, keep_center and keep_base accept anchor only. Keep modes require an existing object, preserve its resize anchor exactly and fail if blocked. placementPolicy defaults to auto with the same collision search and anchor constraints as world.create; the edited object’s old footprint is excluded. Only this object moves. An edit with no placement or coordinates and unchanged footprint preserves position, including historical overlap. exact preserves requested coordinates; allowOverlap:true requires exact and an explicit player request to overlap. Failed placement rejects the entire turn. Do not promise a specific auto position in dialogue.', { target, changes: record(shape, []), placement, placementPolicy, allowOverlap, evidence }, ['target', 'changes', 'evidence']],
    ['world.remove', 'Remove an existing object and its annotations.', { target, evidence }],
    ['world.annotate', 'Set or clear a user meaning (maximum120 characters) or the fictional character interpretation independently; never combine these fields.', { target, field: enumeration(['meaning', 'interpretation']), value: { anyOf: [text(120), { type: 'null' }] }, evidence }],
    ['weather.set', 'Change rendered weather: kind is rain, snow, mist, or clear only. Clear has no particles and requires intensity 0. Setting kind clear without intensity resets it to 0; an explicitly positive intensity with clear is invalid, including when clear is already current. Other kinds retain their current intensity unless supplied.', { changes: record(weather, [], { minProperties: 1 }), evidence }],
    ['memory.upsert', 'Create or revise a salient active memory (maximum14; title60, body240 Unicode code points), even without an explicit remember command: a taught concept, genuine current preference, actual shared event or explicit promise. Skip trivial chat, duplicate notes and unsupported inferences; clarify ambiguity. For corrections copy a current memory_N handle from context.memories; context.memoryCapacity.withheld also exposes occupied handles, usable only for explicit player-requested revisions or removals. Handles are opaque: never guess them or infer hidden content. memoryCapacity.used includes withheld notes; never auto-evict when full. New memories use a note_slug ID. Unknown memory_N handles cannot create notes. Optional kind defaults to note; perspective defaults to character_interpretation. Optional support.quote must be an exact unique substring of current playerSaid; optional paired start/end disambiguate it using zero-based Unicode code-point offsets, end exclusive. Without support, the complete current input is the source. player_report body must equal the supported quote exactly; paraphrases are character_interpretation. shared_event body must equal an earlier successfully applied same-turn operation summary: world.create 一起创建了世界中的「LABEL」; world.update 一起修改了世界中的「LABEL」; world.remove 一起移除了世界中的「LABEL」; weather.set 一起调整了世界里的天气. LABEL is the locally applied object label. Original source and current revision stay distinct; generation, provenance, dependencies and deletion records are assigned locally. A removed memory needs fresh current support and a new note_slug proposal to return.', { id: memoryId, title: text(60), body: text(240), kind: enumeration(['concept', 'preference', 'experience', 'promise', 'note']), perspective: enumeration(['player_report', 'shared_event', 'character_interpretation']), support: memorySupport, evidence }, ['id', 'title', 'body']],
    ['memory.remove', 'Remove a current active memory when the player requests forgetting, using its current opaque memory_N handle from context.memories or context.memoryCapacity.withheld. Withheld entries still occupy slots and expose no content; remove them only on an explicit player request, never automatically to free capacity. Unknown or stale handles fail. Optional support identifies the exact removal clause in current playerSaid: {quote} for a unique substring, or quote plus paired Unicode code-point start/end offsets. Without support the whole current input becomes excluded recall. With precise support, that clause and the whole deletion transcript are hidden; a disjoint exact player_report from the same input may remain. The removed memory and derived recall stop reaching the character; independent unrelated recall and the actual world remain. The immutable audit is separate, not character recall. Never claim the audit was erased or recover forgotten wording.', { id: memoryId, support: memorySupport, evidence }, ['id']],
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
    if (id === 'world.create' || id === 'world.update') schema.allOf = [{ anyOf: [
      { properties: { allowOverlap: { const: false } } },
      { required: ['placementPolicy'], properties: { placementPolicy: { const: 'exact' } } }
    ] }];
    return [id, freeze({ id, description, schema })];
  }));
  // Old event plans are checked against their own exact fields during replay.
  // Metadata from the current memory rules cannot be smuggled into old events.
  const legacyRegistry = { ...registry,
    'memory.upsert': freeze({ id: 'memory.upsert', description: 'Create or revise a note (maximum14 current notes; title60, body240 characters). Its original source is retained separately from its current revision. Reuse the ID for corrections.', schema: record({ type: { const: 'memory.upsert' }, id: legacyMemoryId, title: text(60), body: text(240), evidence }, ['type', 'id', 'title', 'body']) }),
    'memory.remove': freeze({ id: 'memory.remove', description: 'Remove a current note by stable ID; the immutable event transcript retains the original.', schema: record({ type: { const: 'memory.remove' }, id: legacyMemoryId, evidence }, ['type', 'id']) })
  };
  const registryFor = rulesVersion => rulesVersion === '4' ? registry : ['2', '3'].includes(rulesVersion) ? legacyRegistry : null;
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function matches(value, schema) {
    if (typeof schema === 'boolean') return schema;
    if (schema.allOf && !schema.allOf.every(candidate => matches(value, candidate))) return false;
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
  function validate(operation, rulesVersion = '4') {
    const selected = registryFor(rulesVersion);
    return Boolean(selected && plain(operation) && Object.prototype.hasOwnProperty.call(selected, operation.type) && matches(operation, selected[operation.type].schema));
  }
  function descriptors(ids, rulesVersion = '4') {
    const selected = registryFor(rulesVersion);
    // This optional legacy echo is not authority or provenance. Keep strict
    // validation for saved/local plans, but do not ask a model to reproduce it.
    return selected ? (ids || Object.keys(selected)).map(id => selected[id]).filter(Boolean).map(item => {
      const exposed = JSON.parse(JSON.stringify(item));
      delete exposed.schema.properties.evidence;
      return freeze(exposed);
    }) : [];
  }
  // Shared with the model adapter. Field order is part of the captured request
  // contract; these values are also duplicated inside escaped message strings.
  function modelDefinition(context) {
    return { pack: context.pack, persona: { name: context.character.name ?? '', role: context.character.role ?? '' }, guidance: context.guidance ?? '', topics: context.topics, capabilities: context.capabilities };
  }
  function requestContextBytes(context) {
    const encoded = JSON.stringify({ context: JSON.stringify(context), definition: JSON.stringify(modelDefinition(context)) });
    return [...encoded].reduce((total, character) => { const point = character.codePointAt(0); return total + (point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4); }, 0);
  }

  return freeze({ SCHEMA: 'her-world-turn-v2', RULES_VERSION: '4', weatherKinds, ids: Object.keys(registry), panels, descriptors, validate, modelDefinition, requestContextBytes });
});
