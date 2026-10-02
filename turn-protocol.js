/* One bounded model-authored turn. Pure validation; no IO or executable output. */
(function (root, factory) {
  const value = factory(typeof module === 'object' && module.exports ? require('./world-state.js') : root.HerScene);
  if (typeof module === 'object' && module.exports) module.exports = value;
  if (root) root.HerTurn = value;
})(typeof window !== 'undefined' ? window : null, function (SCENE) {
  'use strict';
  const SCHEMA = 'her-world-turn-v1';
  const TOPICS = ['boot', 'unfinished', 'teach_rain', 'first_drop', 'modify_rain', 'rain_name', 'shared_silence', 'memory_discovery', 'her_choice', 'visitor_reference', 'parting', 'invitation'];
  const MILESTONES = ['connected', 'rain_taught', 'rain_created', 'rain_changed', 'rain_named', 'memory_found', 'own_reason', 'visitor_decided', 'farewell'];
  const DENSITIES = ['gentle', 'normal', 'heavy'];
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
  const copy = v => JSON.parse(JSON.stringify(v));
  const keys = (v, names) => object(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
  const safeText = (v, max) => typeof v === 'string' && v.length > 0 && [...v].length <= max && v === v.normalize('NFC').trim() && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(v);
  const protocolText = v => typeof v === 'string' && /<\/?(?:think|analysis|reasoning|scratchpad)\b|(?:["']|\b)(?:schema|lines|applyAfterLine|panel|action|answer|intent|storyIntent|sceneEdits|memoryEdits|logEntries|reasoning_content|analysis|thinking|debug|metadata)(?:["'])?\s*:/iu.test(v);
  const unsafeOutput = v => typeof v === 'string' ? protocolText(v) : v && typeof v === 'object' ? Object.values(v).some(unsafeOutput) : false;
  const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
  const noteId = v => typeof v === 'string' && /^note_[a-z0-9_]{1,32}$/u.test(v);
  // Diagnostics are selected from these fixed pairs only. Never include model
  // text, player input, object/note IDs, unexpected keys, or exception messages.
  const DIAGNOSTICS = freeze(Object.fromEntries([
    ['CONTEXT_INVALID', 'context'], ['INPUT_INVALID', 'input'],
    ['ROOT_INVALID', '$'], ['PROTOCOL_TEXT', '$'], ['SCHEMA_INVALID', 'schema'], ['ROOT_FIELDS', '$'],
    ['LINES_INVALID', 'lines'], ['TIMELINE_INVALID', 'applyAfterLine'], ['PANEL_INVALID', 'panel'],
    ['ANSWER_INVALID', 'answer'], ['ANSWER_PREREQUISITE', 'answer'],
    ['ACTION_INVALID', 'action'], ['ACTION_PREREQUISITE', 'action'],
    ['STORY_INVALID', 'storyIntent'], ['STORY_PREREQUISITE', 'storyIntent'], ['VISITOR_CONSENT', 'storyIntent.evidence'],
    ['SCENE_EDITS_INVALID', 'sceneEdits'], ['MEMORY_EDITS_INVALID', 'memoryEdits'],
    ['MEMORY_CAPACITY', 'memoryEdits'], ['MEMORY_TARGET', 'memoryEdits'], ['LOG_ENTRIES_INVALID', 'logEntries']
  ].map(([code, path]) => [code, { code, path }])));
  const rejected = code => ({ value: null, diagnostic: DIAGNOSTICS[code] });
  function snapshot(value) {
    if (!object(value) || !keys(value.rain, 'name,density,paused,created') || !safeText(value.rain.name, 20) || !DENSITIES.includes(value.rain.density) || typeof value.rain.paused !== 'boolean' || typeof value.rain.created !== 'boolean' || !TOPICS.includes(value.topic) || !Array.isArray(value.milestones) || value.milestones.length > 9 || !value.milestones.every(id => MILESTONES.includes(id)) || !['remember', 'anonymous', 'undecided'].includes(value.visitor) || !Array.isArray(value.memories) || value.memories.length > 14 || !object(value.memoryContext)) return null;
    const ctx = value.sceneContext, scene = ctx && SCENE.context({ grid: ctx.grid, nextId: ctx.nextId, objects: ctx.objects, annotations: ctx.annotations, focusedTarget: ctx.focusedTarget }, { firstRainAvailable: ctx.firstRainAvailable, firstRainSource: ctx.firstRainSource });
    if (!scene || scene.firstRainAvailable !== value.rain.created) return null;
    if (!(value.pendingTopic === null || ['teach_rain', 'rain_name'].includes(value.pendingTopic))) return null;
    const memories = [];
    for (const memory of value.memories) {
      if (!object(memory) || !(noteId(memory.id) || ['first_rain', 'player_reference'].includes(memory.id)) || !safeText(memory.title, 40) || !safeText(memory.body, 500)) return null;
      if (noteId(memory.id) && (memory.kind !== 'world_note' || !safeText(memory.source, 80))) return null;
      if (noteId(memory.id) && (!safeText(memory.createdFrom, 80) || !safeText(memory.latestUpdatedFrom, 80))) return null;
      memories.push({ id: memory.id, title: memory.title, body: memory.body, ...(noteId(memory.id) ? { kind: 'world_note', source: memory.source, createdFrom: memory.createdFrom, latestUpdatedFrom: memory.latestUpdatedFrom } : {}) });
    }
    let invitation = null;
    if (value.invitation !== null && value.invitation !== undefined) {
      if (!object(value.invitation) || !safeText(value.invitation.id, 40) || !safeText(value.invitation.question, 160) || !safeText(value.invitation.context, 200) || !(value.invitation.choiceId === null || safeText(value.invitation.choiceId, 40))) return null;
      invitation = { id: value.invitation.id, question: value.invitation.question, context: value.invitation.context, choiceId: value.invitation.choiceId };
    }
    const memoryContext = { visitorChoice: value.visitor };
    for (const field of ['rainDescription', 'rainNameSource']) {
      if (!(value.memoryContext[field] === null || safeText(value.memoryContext[field], 80))) return null;
      memoryContext[field] = value.memoryContext[field];
    }
    return freeze({ rain: copy(value.rain), milestones: [...new Set(value.milestones)], topic: value.topic, pendingTopic: value.pendingTopic, invitation, visitor: value.visitor, memories, memoryContext, sceneContext: scene });
  }
  // Remembering the visitor is the one operation that needs local consent
  // evidence in addition to the model's semantic decision. Check the complete
  // current message, not a positive span cherry-picked from a refusal.
  function visitorConsent(input, evidence) {
    if (!safeText(input, 80) || !safeText(evidence, 80) || !input.includes(evidence)) return false;
    if (/[“”「」『』"‘’？?]|如果|假如|假设|要是|除非|等我|等到|说过|提过|要求过|请求过|(?:他|她|别人|有人)(?:说|要求|请求)|(?:我|你)(?:刚才|之前|昨天)?说[：:]|为什么|为何|是否|可不可以|能不能|(?:允许|同意|可以|愿意).{0,20}(?:吗|么|呢)[？?]?$|\b(?:if|unless|said|asked|hypothetically|whether|why)\b/iu.test(input)) return false;
    if (/(?:昨天|昨晚|以前|过去|曾经|之前|上次|刚才).{0,16}(?:同意|允许|授权|记住|记得)|\b(?:yesterday|previously|earlier|used to|last time|last night)\b/iu.test(input)) return false;
    if (/(?:不|并非)\s*(?:同意|允许|准许|接受|授权|许可|愿意|乐意|答应|赞成)|(?:没有?|未|不曾|从未).{0,8}(?:同意|允许|授权|答应|许可)|拒绝|反对|撤回|收回|禁止|不要|不想|不希望|不必|不用|不需要|不能|不可以|无法.{0,8}(?:同意|允许|授权)|不.{0,6}(?:记住|记得|保留|留下|保存)|别.{0,10}(?:记|保留|留下|保存)|\b(?:don't|do not|never|refuse|decline|reject|forbid|without my consent|without my permission)\b|\b(?:may|can|must|should|will|would)\s+not\b/iu.test(input)) return false;
    const positive = text => /(?:你可以|可以|允许|同意|愿意|希望你|请你?|让你).{0,12}(?:记住|记得|保留|留下|保存).{0,10}(?:我|来访者)|(?:记住|记得)我(?:吧|。|！|!|$)|(?:我的引用|来访者的引用).{0,8}(?:可以|允许|同意|愿意).{0,8}(?:留下|保留|保存)|\b(?:you may|you can|I consent|I agree|please|I want you to)\b.{0,30}\b(?:remember me|keep my reference|save my reference)\b/iu.test(text);
    return positive(input) && positive(evidence);
  }
  function inspect(value, context, input) {
    const ctx = snapshot(context);
    const fields = ['schema', 'lines', 'applyAfterLine', 'action', 'answer', 'storyIntent', 'sceneEdits', 'memoryEdits', 'logEntries', 'panel'];
    if (!ctx) return rejected('CONTEXT_INVALID');
    if (!safeText(input, 80)) return rejected('INPUT_INVALID');
    if (!object(value)) return rejected('ROOT_INVALID');
    if (unsafeOutput(value)) return rejected('PROTOCOL_TEXT');
    if (value.schema !== SCHEMA) return rejected('SCHEMA_INVALID');
    if (!Object.keys(value).every(key => fields.includes(key))) return rejected('ROOT_FIELDS');
    if (!Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 3 || !value.lines.every(line => safeText(line, 500))) return rejected('LINES_INVALID');
    const result = { schema: SCHEMA, lines: value.lines.slice(), applyAfterLine: value.applyAfterLine === undefined ? 0 : value.applyAfterLine, action: value.action ?? null, answer: value.answer ?? null, storyIntent: value.storyIntent ?? null, sceneEdits: value.sceneEdits ?? [], memoryEdits: value.memoryEdits ?? [], logEntries: value.logEntries ?? [], panel: value.panel ?? null };
    if (!Number.isInteger(result.applyAfterLine) || result.applyAfterLine < 0 || result.applyAfterLine >= result.lines.length) return rejected('TIMELINE_INVALID');
    if (!(result.panel === null || ['logs', 'memory', 'world'].includes(result.panel))) return rejected('PANEL_INVALID');
    const has = id => ctx.milestones.includes(id);
    if (result.answer !== null) {
      if (!keys(result.answer, 'type') || result.answer.type !== 'rain_definition') return rejected('ANSWER_INVALID');
      if (!has('connected')) return rejected('ANSWER_PREREQUISITE');
    }
    if (result.action !== null) {
      const action = result.action;
      if (!object(action) || !(keys(action, 'type,value') && action.type === 'rain_density' && DENSITIES.includes(action.value) || keys(action, 'type') && ['rain_start', 'rain_pause', 'rain_resume'].includes(action.type))) return rejected('ACTION_INVALID');
      if (action.type === 'rain_start' ? ctx.rain.created || !(has('rain_taught') || result.answer) : !ctx.rain.created) return rejected('ACTION_PREREQUISITE');
    }
    const created = ctx.rain.created || result.action?.type === 'rain_start';
    if (result.storyIntent !== null) {
      const intent = result.storyIntent;
      if (!object(intent)) return rejected('STORY_INVALID');
      if (intent.type === 'topic') {
        if (!keys(intent, 'type,value') || !TOPICS.includes(intent.value)) return rejected('STORY_INVALID');
        if (['first_drop', 'modify_rain', 'rain_name', 'shared_silence', 'memory_discovery'].includes(intent.value) && !created) return rejected('STORY_PREREQUISITE');
        if (['her_choice', 'visitor_reference'].includes(intent.value) && !has('memory_found')) return rejected('STORY_PREREQUISITE');
      } else if (intent.type === 'rain_name') {
        if (!keys(intent, 'type,value') || !safeText(intent.value, 20)) return rejected('STORY_INVALID');
        if (!created) return rejected('STORY_PREREQUISITE');
      } else if (intent.type === 'own_reason') {
        if (!keys(intent, 'type')) return rejected('STORY_INVALID');
        if (!has('memory_found')) return rejected('STORY_PREREQUISITE');
      } else if (intent.type === 'visitor_choice') {
        if (!has('memory_found')) return rejected('STORY_PREREQUISITE');
        if (!['remember', 'anonymous', 'undecided'].includes(intent.value)) return rejected('STORY_INVALID');
        if (intent.value === 'remember') {
          if (!keys(intent, 'type,value,evidence')) return rejected('STORY_INVALID');
          if (!visitorConsent(input, intent.evidence)) return rejected('VISITOR_CONSENT');
        } else if (!keys(intent, 'type,value')) return rejected('STORY_INVALID');
      } else if (intent.type === 'farewell') { if (!keys(intent, 'type')) return rejected('STORY_INVALID'); }
      else return rejected('STORY_INVALID');
    }
    const scene = SCENE.validateSemanticEdits(result.sceneEdits, { ...copy(ctx.sceneContext), firstRainAvailable: created }, input);
    if (!scene) return rejected('SCENE_EDITS_INVALID');
    result.sceneEdits = scene;
    if (!Array.isArray(result.memoryEdits) || result.memoryEdits.length > 3) return rejected('MEMORY_EDITS_INVALID');
    const notes = new Set(ctx.memories.filter(memory => noteId(memory.id)).map(memory => memory.id));
    for (const edit of result.memoryEdits) {
      if (!object(edit) || !noteId(edit.id)) return rejected('MEMORY_EDITS_INVALID');
      if (edit.type === 'upsert') {
        if (!keys(edit, 'type,id,title,body') || !safeText(edit.title, 40) || !safeText(edit.body, 240)) return rejected('MEMORY_EDITS_INVALID');
        notes.add(edit.id); if (notes.size > 12) return rejected('MEMORY_CAPACITY');
      } else if (edit.type === 'remove') {
        if (!keys(edit, 'type,id')) return rejected('MEMORY_EDITS_INVALID');
        if (!notes.has(edit.id)) return rejected('MEMORY_TARGET');
        notes.delete(edit.id);
      } else return rejected('MEMORY_EDITS_INVALID');
    }
    if (!Array.isArray(result.logEntries) || result.logEntries.length > 3 || !result.logEntries.every(entry => safeText(entry, 160))) return rejected('LOG_ENTRIES_INVALID');
    return { value: copy(result), diagnostic: null };
  }
  function validate(value, context, input) { return inspect(value, context, input).value; }
  return Object.freeze({ SCHEMA, snapshot, validate, inspect, visitorConsent });
});
