/* Stable logical retrieval budget; model transport measures its actual payload separately. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HerRecallBudget = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  // Captured from published v0.1.8: CAPS.descriptors(CAPS.ids, '4'), without
  // world references. Prose edits must not change historical retrieval or its
  // reconstructed provenance. Preserve dynamic suffixes and schemas except
  // for the explicitly versioned placement projection below. New schema
  // changes need their own costing and replay compatibility decision.
  const baseDescriptions = Object.freeze({
  "world.create": "Create one original printable ASCII object (24 columns by 10 rows, scale 1..3, grid 100x60, maximum world.capacity objects); label and glyphs may be creatively derived. Use both integer x/y or top-level placement, never both. Sky and ground accept anchor only and need the named landmark in world.landmarks. Window anchors need the window landmark and accept optional gap 0..10 (default 2), never target. Relative anchors require an existing object or landmark target and accept optional gap 0..10 (default 2). Entire scaled glyph rectangle, including spaces, must fit the grid. placementPolicy defaults to auto: numeric x/y are preferred coordinates; search first along that row, then nearest remaining point (squared distance, ties y then x), avoiding every other object, including earlier operations this turn. Sky stays inside its rectangle; ground keeps its baseline and width; window/relative anchors keep the exact side/gap axis and search only the other axis. Auto creations in the same turn try that preferred layout, then a left-boundary-packed layout, then a bounded joint search so earlier uncommitted creations may be repositioned before any line is shown; existing or saved objects never move. exact preserves the chosen position and rejects overlap; allowOverlap:true requires exact and is only for a player explicitly requesting overlap. No free position rejects the entire turn. Do not promise a specific auto position in dialogue. IDs and provenance are assigned locally.",
  "world.update": "Edit an existing object by stable ID, preserving printable ASCII <=24 columns by10 rows and a footprint inside100x60. Use nonempty changes without placement, or visual changes plus placement without x/y. Fixed window anchors accept optional gap 0..10 (default 2), never target; relative anchors require target and allow the same gap. Sky, ground, keep_center and keep_base accept anchor only. Keep modes require an existing object, preserve its resize anchor exactly and fail if blocked. placementPolicy defaults to auto with the same collision search and anchor constraints as world.create; the edited object’s old footprint is excluded. Only this object moves. An edit with no placement or coordinates and unchanged footprint preserves position, including historical overlap. exact preserves requested coordinates; allowOverlap:true requires exact and an explicit player request to overlap. Failed placement rejects the entire turn. Do not promise a specific auto position in dialogue.",
  "world.remove": "Remove an existing object and its annotations.",
  "world.annotate": "Set or clear a user meaning (maximum120 characters) or the fictional character interpretation independently; never combine these fields.",
  "weather.set": "Change rendered weather: kind is rain, snow, mist, or clear only. Clear has no particles and requires intensity 0. Setting kind clear without intensity resets it to 0; an explicitly positive intensity with clear is invalid, including when clear is already current. Other kinds retain their current intensity unless supplied.",
  "memory.upsert": "Create or revise a salient active memory (maximum14; title60, body240 Unicode code points), even without an explicit remember command: a taught concept, genuine current preference, actual shared event or explicit promise. Skip trivial chat, duplicate notes and unsupported inferences; clarify ambiguity. For corrections copy a current memory_N handle from context.memories; context.memoryCapacity.withheld also exposes occupied handles, usable only for explicit player-requested revisions or removals. Handles are opaque: never guess them or infer hidden content. memoryCapacity.used includes withheld notes; never auto-evict when full. New memories use a note_slug current-turn alias; the local runtime assigns an independent permanent identity. Only the same turn may reuse that alias. Revise or remove earlier memories only through their current memory_N handles, never a historical note_slug. Unknown memory_N handles cannot create notes. Optional kind defaults to note; perspective defaults to character_interpretation. Optional support.quote must be an exact unique substring of current playerSaid; optional paired start/end disambiguate it using zero-based Unicode code-point offsets, end exclusive. Without support, the complete current input is the source. For sentence-row proposals with explicit perspective player_report, support is required and body must be omitted: select only an exact source quote, which the local adapter validates against current playerSaid. Supplied compatibility bodies are never rewritten and must equal the supported quote exactly; paraphrases are character_interpretation. shared_event body must equal an earlier successfully applied same-turn operation summary: world.create 一起创建了世界中的「LABEL」; world.update 一起修改了世界中的「LABEL」; world.remove 一起移除了世界中的「LABEL」; weather.set 一起调整了世界里的天气. LABEL is the locally applied object label. Original source and current revision stay distinct; generation, provenance, dependencies and deletion records are assigned locally. A removed memory needs fresh current support and a new note_slug proposal to return.",
  "memory.remove": "Remove a current active memory when the player requests forgetting, using its current opaque memory_N handle from context.memories or context.memoryCapacity.withheld. Withheld entries still occupy slots and expose no content; remove them only on an explicit player request, never automatically to free capacity. Unknown or stale handles fail. Optional support identifies the exact removal clause in current playerSaid: {quote} for a unique substring, or quote plus paired Unicode code-point start/end offsets. Without support the whole current input becomes excluded recall. With precise support, that clause and the whole deletion transcript are hidden; a disjoint exact player_report from the same input may remain. The removed memory and derived recall stop reaching the character; independent unrelated recall and the actual world remain. The immutable audit is separate, not character recall. Never claim the audit was erased or recover forgotten wording.",
  "story.answer": "Explicitly answer at most one pre-turn pending question per turn (value maximum200 characters); newly unlocked questions wait until next turn. Set plan.topic to that question topic. Choice values are declared choice IDs. Consent allow requires explicit current permission and the pre-turn active question must be that consent question. Never answer an unrelated question.",
  "story.defer": "Leave a currently pending question unresolved for later. It can be resumed by returning to its topic.",
  "character.update": "Update only fictional mood/stance and bounded fictional relationship deltas (each cumulative trust/familiarity delta must stay within -5..5, applied to turn-start scores and clipped0..100); this is narrative state, never real telemetry. Current input is the basis.",
  "log.note": "Append a fictional character observation. Must not claim an actual UI visit or device telemetry.",
  "panel.open": "Request a panel at this sentence boundary. This does not prove the player viewed it and cannot complete a UI question."
});
  const PROFILE = Object.freeze({
    version: 'her-world-recall-budget-v1', sourceRelease: '0.1.8', rulesVersion: '4',
    placementProjection: 'her-world-placement-budget-v1',
    sourceCapabilitiesSha256: '21afe73a3091d7ad80fc9a63f22a642e583163ddf2f4f9bf55c2147790453836',
    descriptionsSha256: '17c2b1cd69c7fecaf42992dc9cf7477ba48b7e3af49dc99ed44d748c59fbe926',
    baseDescriptions
  });
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  function requireProfile(condition) {
    if (!condition) { const error = new Error('RECALL_BUDGET_PROFILE_INVALID'); error.code = 'RECALL_BUDGET_PROFILE_INVALID'; throw error; }
  }
  const enumeration = values => ({ type: 'string', enum: values });
  function relativeBranch(target, alignment = false) {
    return { type: 'object', additionalProperties: false, properties: {
      anchor: enumeration(['above', 'below', 'left_of', 'right_of']), target, gap: { type: 'integer', minimum: 0, maximum: 10 },
      ...(alignment ? { align: enumeration(['center', 'bottom']) } : {})
    }, required: ['anchor', 'target'], ...(alignment ? { anyOf: [
      { properties: { align: false } },
      { properties: { anchor: enumeration(['left_of', 'right_of']) } }
    ] } : {}) };
  }
  function placementCostSchema(id, schema) {
    if (!['world.create', 'world.update'].includes(id)) return schema;
    const placement = schema?.properties?.placement, alternatives = placement?.anyOf;
    if (!Array.isArray(alternatives)) return schema;
    // Cost precisely the reviewed optional align field and its side-only
    // condition as the original relative branch, so old retrieval/dependency
    // decisions stay byte-identical. The complete bounded target schema is
    // retained. Unknown constraints remain fully charged instead of being
    // discarded by a broad schema rewrite.
    const index = alternatives.findIndex(branch => {
      const target = branch?.properties?.target;
      return target !== undefined
        && JSON.stringify(branch) === JSON.stringify(relativeBranch(target, true));
    });
    if (index < 0) return schema;
    const historical = relativeBranch(alternatives[index].properties.target);
    return { ...schema, properties: { ...schema.properties, placement: { ...placement,
      anyOf: [...alternatives.slice(0, index), historical, ...alternatives.slice(index + 1)]
    } } };
  }
  function createProfile(capabilities) {
    requireProfile(capabilities && capabilities.RULES_VERSION === PROFILE.rulesVersion && Array.isArray(capabilities.ids) && typeof capabilities.descriptors === 'function' && typeof capabilities.requestContextBytes === 'function');
    const ids = Object.keys(baseDescriptions);
    requireProfile(capabilities.ids.length === ids.length && new Set(capabilities.ids).size === ids.length && capabilities.ids.every(id => own(baseDescriptions, id)));
    const descriptors = capabilities.descriptors(ids, PROFILE.rulesVersion);
    requireProfile(Array.isArray(descriptors) && descriptors.length === ids.length);
    const currentBases = Object.create(null);
    for (const descriptor of descriptors) {
      requireProfile(descriptor && own(baseDescriptions, descriptor.id) && !own(currentBases, descriptor.id) && typeof descriptor.description === 'string' && descriptor.description.length > 0);
      currentBases[descriptor.id] = descriptor.description;
    }
    Object.freeze(currentBases);
    function contextBytes(context) {
      requireProfile(context && Array.isArray(context.capabilities));
      const seen = new Set();
      const stableDescriptors = context.capabilities.map(descriptor => {
        requireProfile(descriptor && own(currentBases, descriptor.id) && !seen.has(descriptor.id) && typeof descriptor.description === 'string' && descriptor.description.startsWith(currentBases[descriptor.id]));
        seen.add(descriptor.id);
        return { ...descriptor, description: baseDescriptions[descriptor.id] + descriptor.description.slice(currentBases[descriptor.id].length), schema: placementCostSchema(descriptor.id, descriptor.schema) };
      });
      // A temporary costing view only: live schemas, factual data, sources and
      // actual model definitions are untouched. Transport enforces its own
      // unchanged 128 KiB bound with the complete current definitions.
      return capabilities.requestContextBytes({ ...context, capabilities: stableDescriptors });
    }
    return Object.freeze({ version: PROFILE.version, contextBytes });
  }
  return Object.freeze({ PROFILE, createProfile });
});
