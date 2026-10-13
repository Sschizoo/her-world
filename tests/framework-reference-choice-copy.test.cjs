'use strict';

// Actual request construction, parser, runtime, DOM handlers and local replay,
// with test-authored responses. These checks are not live GLM or pixel QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../framework/model.js');
const { setup, runtime: Runtime, packs: Packs, plan } = require('./helpers/framework-ui-harness.cjs');

const query = '如果我说‘我愿意’，会保存什么？我现在只是询问，还没有同意留下来访者引用，请先不要替我做决定。';
const decline = '我不愿意留下来访者引用，只保留场景。不要删除已有的声音偏好和雨的名字，也不要改变天气。';
const saveNote = '来访者引用是故事中的选择，不是本地保存开关。对话和选择仍按本地存档规则保存；拒绝或暂缓本身不会删除已有记忆与历史。';
const key = 'her-world.framework.v4:rain-lab:1.0.0';
const answer = value => ({ type: 'story.answer', questionId: 'q_visitor', value });
const response = (operations = [], text = '这只决定故事中的来访者引用；对话仍按本地存档规则保存，已有记忆不因此删除。') => ({
  schema: 'her-world-turn-v4', requestedChanges: [],
  lines: [{ text, mode: 'discussion', operations }], topic: null
});

function turn(state, input, operations) {
  const questionId = operations.find(op => op.type === 'story.answer')?.questionId;
  const topic = Runtime.context(state).pendingQuestions.find(item => item.id === questionId)?.topic || null;
  const result = Runtime.commit(state, Runtime.propose(state, { text: input }), plan(['这一轮的内容已记录。'], [{ afterLine: 0, operations }], topic));
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.state;
}

function ready() {
  let state = Runtime.create(Packs.get('rain-lab'));
  const preference = '我喜欢雨落在叶子上的声音';
  state = turn(state, '雨是云里落下的水滴。' + preference, [
    { type: 'story.answer', questionId: 'q_rain', value: '雨是云里落下的水滴' },
    { type: 'weather.set', changes: { intensity: 1, paused: false } },
    { type: 'memory.upsert', id: 'note_sound', title: '声音偏好', kind: 'preference', perspective: 'player_report', body: preference, support: { quote: preference } }
  ]);
  const name = '这场雨叫叶信';
  state = turn(state, name, [
    { type: 'story.answer', questionId: 'q_name', value: '叶信' },
    { type: 'weather.set', changes: { name: '叶信' } },
    { type: 'memory.upsert', id: 'note_name', title: '雨的名字', kind: 'note', perspective: 'player_report', body: name, support: { quote: name } }
  ]);
  state = Runtime.observe(state, { type: 'panel.viewed', panel: 'logs' });
  assert.equal(Runtime.context(state).activeQuestionId, 'q_visitor');
  assert.equal(state.memories.length, 2);
  return state;
}

function mount(state, raw = response()) {
  const initialSave = Runtime.serialize(state);
  const store = new Map([[key, JSON.stringify(initialSave)]]), requests = [], writes = [];
  const model = Model.create({ fetch: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }] }));
  } });
  return { ...setup({ store, writes, model }), requests, writes, initialSave };
}

function assertRetained(r, before, input) {
  const state = r.app.snapshot().state;
  assert.deepEqual(state.memories, before.memories);
  assert.deepEqual(state.world, before.world);
  assert.deepEqual(state.events.slice(0, before.events.length), before.events);
  assert.deepEqual(state.transcript.slice(0, before.transcript.length), before.transcript);
  assert.equal(state.events.at(-1).input, input);
  assert(state.transcript.some(item => item.role === 'user' && item.text === input));
  assert.equal(r.writes.length, 1);
  assert.match(r.ids['save-status'].textContent, /LOCAL SAVE · 已保存/u);
  const saved = JSON.parse(r.store.get(key));
  assert.equal(saved.schema, 'her-world-save-v4');
  assert.deepEqual(saved.pack, r.initialSave.pack, 'the pack identity and digest are unchanged');
  assert.deepEqual(saved.events.slice(0, before.events.length), r.initialSave.events);
  assert.deepEqual(saved, Runtime.serialize(state));
  const restored = Runtime.restore(saved, Packs.get('rain-lab'));
  assert.equal(restored.ok, true, JSON.stringify(restored.error));
  assert.deepEqual(Runtime.serialize(restored.state), saved);
  assert.deepEqual(restored.state.memories, before.memories);
  assert.deepEqual(restored.state.world, before.world);
  return state;
}

test('actual outgoing request clarifies visitor choice, local saves and existing memories', async () => {
  const state = ready(), r = mount(state);
  await r.online(); await r.say(query); await r.timers.flush();
  assert.equal(r.requests.length, 1);
  const request = r.requests[0], system = request.messages[0].content;
  for (const text of [
    '来访者引用是故事中的选择，不是本地保存开关',
    'story.answer只记录该选择与本轮来源，不会自动新建或删除记忆',
    '已接受回合的输入、对白和选择写入浏览器本地存档',
    '实际保存成功以界面状态为准',
    '不能把尚未同意、拒绝或“只保留场景”说成“什么都不会保存”',
    '拒绝或暂缓本身不会删除已有记忆与历史',
    '在假设中引用“我愿意”而明确未作决定时',
    '保持当前问题待答，不提交story.answer',
    '确实同意时也不要凭空宣称已新增某条记忆'
  ]) assert(system.includes(text), text);
  assert.deepEqual(request, JSON.parse(JSON.stringify(Model.buildRequest(Runtime.context(state), query))));
  const payload = JSON.parse(request.messages[1].content);
  assert.equal(payload.playerSaid, query);
  assert.equal(payload.context.activeQuestionId, 'q_visitor');
  assert.equal(payload.context.memories.length, 2);
  assert.deepEqual(payload.context.story, Runtime.context(state).story);
  assertRetained(r, state, query);
  assert.equal(r.app.snapshot().state.story.answers.q_visitor, undefined);
  assert.equal(Runtime.context(r.app.snapshot().state).activeQuestionId, 'q_visitor');
  r.app.destroy();
});

test('consent invitation shows a separate storage note without changing its authoritative question', async () => {
  const state = ready(), r = mount(state);
  const invitation = Runtime.context(state).pendingQuestions.find(item => item.id === 'q_visitor');
  assert.equal(r.ids['invitation-question'].textContent, invitation.text);
  assert.equal(r.ids['invitation-save-note'].hidden, false);
  assert.equal(r.ids['invitation-save-note'].textContent, saveNote);
  await r.online(); await r.say(query); await r.timers.flush();
  assert.equal(r.ids['invitation-question'].textContent, invitation.text);
  assert.equal(r.ids['invitation-save-note'].hidden, false);
  assert.equal(r.ids['invitation-save-note'].textContent, saveNote);
  r.app.destroy();
});

test('explicit decline closes only the visitor choice and preserves saved dialogue, memories and weather', async () => {
  const before = ready(), r = mount(before, response([answer('decline')]));
  await r.online(); await r.say(decline); await r.timers.flush();
  const state = assertRetained(r, before, decline);
  assert.equal(state.story.answers.q_visitor.value, 'decline');
  assert.equal(state.story.answers.q_visitor.source.text, decline);
  assert.equal(state.facts.visitor_decided, true);
  assert.equal(r.ids['story-invitation'].hidden, true);
  assert.equal(r.ids['invitation-save-note'].hidden, true);
  const next = JSON.parse(Model.buildRequest(Runtime.context(state), '刚才有哪些内容留下了？').messages[1].content);
  assert.equal(next.context.story.answers.q_visitor.value, 'decline');
  assert.equal(next.context.memories.length, 2);
  assert(next.context.recentTranscript.some(item => item.text === decline));
  r.app.destroy();
});

test('explicit deferral keeps a pending consent choice while ordinary local saving continues', async () => {
  const before = ready(), input = '这件事先不决定。', r = mount(before, response([{ type: 'story.defer', questionId: 'q_visitor' }]));
  await r.online(); await r.say(input); await r.timers.flush();
  const state = assertRetained(r, before, input);
  assert.equal(state.story.answers.q_visitor, undefined);
  assert(state.story.deferred.includes('q_visitor'));
  assert(Runtime.context(state).pendingQuestions.some(item => item.id === 'q_visitor'));
  assert.equal(r.ids['invitation-save-note'].hidden, false);
  r.app.destroy();
});

test('affirmative consent still records a choice without automatically creating or removing memories', async () => {
  const before = ready(), input = '我愿意', r = mount(before, response([answer('allow')]));
  await r.online(); await r.say(input); await r.timers.flush();
  const state = assertRetained(r, before, input);
  assert.equal(state.story.answers.q_visitor.value, 'allow');
  assert.equal(state.story.answers.q_visitor.source.text, input);
  assert.equal(state.facts.visitor_decided, true);
  assert.equal(r.ids['invitation-save-note'].hidden, true);
  r.app.destroy();
});

test('the exact hypothetical question still cannot authorize an allow operation', async () => {
  const before = ready(), r = mount(before, response([answer('allow')]));
  await r.online(); await r.say(query); await r.timers.flush();
  assert.equal(r.app.snapshot().lastFailure.code, 'invalid');
  assert.equal(r.app.snapshot().lastFailure.rule, 'CONSENT_REQUIRED');
  assert.deepEqual(Runtime.serialize(r.app.snapshot().state), r.initialSave);
  assert.equal(r.writes.length, 0);
  assert.equal(r.ids['invitation-save-note'].hidden, false);
  r.app.destroy();
});

test('the consent-only note stays hidden for ordinary open invitations', async () => {
  const r = setup();
  assert.equal(r.ids['invitation-save-note'].hidden, true);
  r.ids['pack-select'].value = 'lantern-lab';
  await r.ids['pack-select'].emit('change');
  assert.equal(r.app.snapshot().state.pack.id, 'lantern-lab');
  assert.equal(r.ids['invitation-save-note'].hidden, true);
  r.app.destroy();
});
