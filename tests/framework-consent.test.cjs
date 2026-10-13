'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../framework/runtime.js');
const C = require('../framework/capabilities.js');
const P = require('../framework/packs.js');
const clone = value => JSON.parse(JSON.stringify(value));
const plan = (operations = [], topic = null) => ({ schema: C.SCHEMA, topic, lines: ['先确认你的意思。', '这次选择已经处理。'], beats: operations.length ? [{ afterLine: 1, operations }] : [] });
const answer = (questionId, value) => ({ type: 'story.answer', questionId, value });
const commit = (state, input, operations, topic) => R.commitModel(state, R.propose(state, { text: input }), plan(operations, topic));
const turn = (...args) => { const result = commit(...args); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.state; };
const ready = () => {
  let state = R.create(P.get('rain-lab'));
  state = turn(state, '轻轻的雨', [answer('q_rain', '轻轻的雨')], 'rain');
  state = turn(state, '夜航', [answer('q_name', '夜航')], 'naming');
  state = R.observe(state, { type: 'panel.viewed', panel: 'logs' });
  assert.equal(R.context(state).activeQuestionId, 'q_visitor');
  return state;
};
const historical = (input = '你可以记住我吗。') => {
  const save = clone(R.serialize(R.create(P.get('rain-lab'))));
  save.events = [
    { id: 'event_1', type: 'turn', rulesVersion: '4', input: '轻轻的雨', plan: plan([answer('q_rain', '轻轻的雨')], 'rain') },
    { id: 'event_2', type: 'turn', rulesVersion: '4', input: '夜航', plan: plan([answer('q_name', '夜航')], 'naming') },
    { id: 'event_3', type: 'panel.viewed', panel: 'logs' },
    { id: 'event_4', type: 'turn', rulesVersion: '4', input, plan: plan([answer('q_visitor', 'allow')], 'visitor') }
  ];
  return save;
};

test('fresh consent rejects questions at punctuation and clause boundaries atomically', () => {
  const state = ready(), before = clone(state);
  for (const input of [
    '你可以记住我吗', '你可以记住我吗。', '你可以记住我么！', '你可以保留引用呢…',
    '我同意保存引用吗!', '你可以记住我吗，先问一下', '你可以记住我吗；我还没想好',
    '/回答 你可以记住我吗。', '你可以记住我吗？', '你可以记住我吗。先别急着回答',
    '你可以记住我吗：先确认一下', '你可以记住我吗🙂', '你可以记住我吗（还没决定）', '请记住我好吗。',
    '你可以记住我，好不好', '你可以记住我行不行', '你可以记住我，好不好。', '你可以记住我行不行！'
  ]) {
    const result = commit(state, input, [{ type: 'weather.set', changes: { intensity: 2 } }, answer('q_visitor', 'allow')], 'visitor');
    assert.equal(R.explicitConsent(input), false, input);
    assert.equal(result.error?.code, 'CONSENT_REQUIRED', input);
    assert.equal(result.frames, undefined); assert.deepEqual(state, before);
  }
});

test('fresh consent rejects permission that depends on a future decision', () => {
  const state = ready();
  for (const input of [
    '你可以在获得我同意之后记住我', '你可以在我同意后保存引用', '请等我同意后再保存引用',
    '你可以在我点头时记住我', '你可以征得我的许可后再保存引用',
    'Please remember me only after I give permission', 'You may remember me after I explicitly consent',
    'Please remember me once I approve', 'You can retain my reference when I confirm',
    'You may save my reference with my future permission', '你可以等待我的许可，然后记住我',
    'Please wait for my permission before you remember me', 'You may remember me subject to my approval'
  ]) {
    assert.equal(R.explicitConsent(input), false, input);
    assert.equal(commit(state, input, [answer('q_visitor', 'allow')], 'visitor').error?.code, 'CONSENT_REQUIRED', input);
  }
});

test('fresh consent rejects conditional permission and prerequisites across clause boundaries atomically', () => {
  const state = ready(), before = clone(state), saved = clone(R.serialize(state));
  for (const input of [
    'You may remember me provided I consent', 'Please save my reference only with my permission',
    'You may remember me provided that I give you permission', 'You may remember me providing I agree',
    'You may remember me on the condition that I approve', 'You may save my reference contingent on my approval',
    'Please retain my reference depending on my authorization', 'Please remember me only with my express consent',
    'Yes, you can remember me, but only with my approval', 'Please save my reference, but get my consent first',
    'Please save my reference; you need to obtain my permission first',
    'You may remember me；only with my permission', 'You may remember me（provided that I consent）',
    'Please save my reference，but you must ask for my permission first',
    'Please remember me. First ask for my approval', 'You can remember me: my permission is required first',
    'You may remember me as long as I consent', 'You may remember me providing I allow it',
    'You may remember me on condition that I agree', 'You may remember me provided I say yes',
    'Please save my reference, but only with my go-ahead', 'You may remember me, but ask me first',
    'You may remember me, but check with me beforehand', 'You may remember me only after I authorize it',
    'You may remember me. You will need my consent', 'You may remember me. My approval must come first',
    '你可以记住我，前提是我同意', '你可以记住我，但得先征求我的同意',
    '你可以记住我；条件是先获得我的许可', '你可以保留我的引用，但需要事先得到我的授权',
    '我同意保存引用，前提是你先问过我', '你可以记住我：必须先得到我的允许',
    '你可以记住我（前提是我点头）', '你可以记住我。保存前要先征求我的同意',
    '你可以记住我，但要以我的同意为前提', '你可以记住我，但是需要我的许可',
    '你可以记住我，但先征求我的许可', '你可以记住我，须经我批准',
    '/回答 你可以记住我，前提是我同意', '你可以记住我，只有征得我的允许才行',
    '你可以记住我，只要我同意', '你可以记住我，要经我同意', '你可以记住我，经我同意之后',
    '你可以记住我，但先问我', '你可以记住我，不过要先问一下我', '你可以记住我，但事先得问过我',
    '你可以记住我，但同意须另行取得', '你可以记住我，前提是：我同意',
    'You may remember me provided that: I consent', 'Please save my reference, but my permission must be obtained first',
    'You may remember me only after you ask me', '你可以记住我，但要问过我之后才行'
  ]) {
    assert.equal(R.explicitConsent(input), false, input);
    const result = commit(state, input, [{ type: 'weather.set', changes: { intensity: 2 } }, answer('q_visitor', 'allow')], 'visitor');
    assert.equal(result.error?.code, 'CONSENT_REQUIRED', input);
    assert.equal(result.frames, undefined, input);
    assert.deepEqual(state, before, input); assert.deepEqual(R.serialize(state), saved, input);
  }
});

test('current affirmative consent remains accepted while denials and revocations reject', () => {
  const state = ready();
  for (const input of [
    '同意留下引用', '/回答 同意留下引用', '你可以记住我', '我愿意', '好的',
    'Yes, you can remember me', 'I agree', '你可以记住我，我现在同意',
    '我现在同意你记住我，之后再聊别的', '我同意保存以后要用的引用', '你可以保留我的引用，我已经确认了',
    'You may remember me. I give my permission now', 'You may remember me; I have already given my consent',
    '我同意保存引用；我现在明确同意', '你可以记住我，我已经给了许可',
    '我同意保存引用。下次见面时再聊其他话题', 'You may remember me. After the rain, we can talk again',
    '我同意保存引用。你先问我天气怎么样', '我同意保存引用，你先问我天气怎么样',
    '我同意保存引用。你先问我天气好不好', '我同意保存引用。看看天气好不好',
    'You may remember me. First ask me about the weather', 'You may remember me, but ask me about the weather first',
    'I agree.', 'Yes.', 'I consent.', '/回答 Yes.'
  ]) {
    assert.equal(R.explicitConsent(input), true, input);
    const result = commit(state, input, [answer('q_visitor', 'allow')], 'visitor');
    assert.equal(result.ok, true, input);
    assert.equal(result.state.events.at(-1).consentVersion, 2);
    assert.equal(result.state.story.answers.q_visitor.value, 'allow');
    assert.equal(result.frames[0].story.answers.q_visitor, undefined);
    assert.equal(result.frames[1].story.answers.q_visitor.value, 'allow');
  }
  for (const input of [
    '不要记住我', '我不同意留下引用', '你可以记住我，但我撤回同意', '我以前同意过', '如果我同意呢',
    '他说：我同意', 'Please do not remember me', 'I decline', 'You may remember me, but I do not consent',
    'You may remember me, but I withdraw my permission', 'You can remember me; I revoke my consent',
    'Please remember me. I rescind my approval', 'You may remember me if I consent later',
    'You may remember me, but I revoke my consent', 'You may remember me. I withdraw my permission',
    'Please remember me, but I cannot give consent', "You may remember me, but I won't consent",
    "You may remember me, but I can't agree", '你可以记住我，但我取消授权', '你可以记住我，但我不许可',
    '你可以记住我，但我还没同意', '你可以记住我，但我未授权', '你可以记住我，我没许可',
    "You may remember me, but I haven't given permission", 'You may remember me, but I am revoking consent',
    'You may remember me, but I am withdrawing permission', 'You may remember me, but no permission has been given',
    'You may remember me, but I have yet to consent', 'You may remember me, but my consent is revoked',
    'You may remember me, but my consent is withdrawn', 'You may remember me, but my permission is cancelled',
    'You may remember me, but I withhold my consent', 'You may remember me, but I deny permission',
    '你可以记住我，但授权已撤销', '你可以记住我，但许可作废了'
  ]) {
    assert.equal(R.explicitConsent(input), false, input);
    assert.equal(commit(state, input, [answer('q_visitor', 'allow')], 'visitor').error?.code, 'CONSENT_REQUIRED', input);
  }
});

test('historical consent uses its frozen validator and preserves canonical saves and cursor frames', () => {
  for (const input of [
    '你可以记住我吗。', '你可以在获得我同意之后记住我', 'Please remember me only after I give permission',
    'You may remember me provided I consent', 'Please save my reference only with my permission',
    '你可以记住我，前提是我同意', '你可以记住我，但得先征求我的同意',
    'Please remember me, but I cannot give consent', "You may remember me, but I won't consent",
    '你可以记住我，但我取消授权', '你可以记住我，但我不许可',
    '你可以记住我，好不好', '你可以记住我行不行', '你可以记住我，但同意须另行取得'
  ]) {
    const saved = historical(input), original = clone(saved), restored = R.restore(saved, P.get('rain-lab'));
    assert.equal(restored.ok, true, JSON.stringify(restored.error));
    assert.deepEqual(saved, original); assert.deepEqual(R.serialize(restored.state), original);
    assert.equal(restored.state.story.answers.q_visitor.value, 'allow');
    assert.equal(R.view(restored.state, { event: 3, line: 0 }).story.answers.q_visitor, undefined);
    assert.equal(R.view(restored.state, { event: 3, line: 1 }).story.answers.q_visitor.value, 'allow');
    const continued = turn(restored.state, '现在继续聊聊', [], null), replayed = R.restore(R.serialize(continued), continued.pack);
    assert.equal(replayed.ok, true, JSON.stringify(replayed.error)); assert.deepEqual(replayed.state, continued);
    assert.equal(continued.events.at(-1).consentVersion, 2);
    assert.deepEqual(continued.events.slice(0, 4), original.events);
  }
  for (const input of ['你可以记住我吗', '不要记住我', '如果我同意呢', '他说：我同意', 'I agree.', 'Yes.']) assert.equal(R.restore(historical(input), P.get('rain-lab')).error?.code, 'CONSENT_REQUIRED', input);
});

test('every fresh turn binds consent policy and replay rejects downgrades across observations', () => {
  let state = ready();
  assert.ok(state.events.filter(event => event.type === 'turn').every(event => event.consentVersion === 2));
  state = turn(state, '你可以记住我', [answer('q_visitor', 'allow')], 'visitor');
  state = R.observe(state, { type: 'panel.viewed', panel: 'memory' });
  state = turn(state, '继续聊聊', [], null);
  const saved = clone(R.serialize(state));
  const downgraded = clone(saved); delete downgraded.events.at(-1).consentVersion;
  assert.equal(R.restore(downgraded, state.pack).error?.code, 'EVENT_INVALID');
  for (const input of [
    '你可以记住我吗。', 'You may remember me provided I consent', 'Please save my reference only with my permission',
    '你可以记住我，前提是我同意', '你可以记住我，但得先征求我的同意', 'You may remember me, but I withdraw my permission',
    'Please remember me, but I cannot give consent', "You may remember me, but I won't consent",
    '你可以记住我，但我取消授权', '你可以记住我，但我不许可',
    '你可以记住我，好不好', '你可以记住我行不行', '你可以记住我，但同意须另行取得'
  ]) {
    const strict = clone(saved); strict.events[3].input = input;
    assert.equal(R.restore(strict, state.pack).error?.code, 'CONSENT_REQUIRED', input);
  }
  for (const value of [0, 1, 3, '2', null, false, {}]) {
    const invalid = clone(saved); invalid.events[0].consentVersion = value;
    assert.equal(R.restore(invalid, state.pack).error?.code, 'EVENT_INVALID', JSON.stringify(value));
  }
  const oldRules = clone(saved); oldRules.events[0].rulesVersion = '3';
  assert.equal(R.restore(oldRules, state.pack).error?.code, 'EVENT_INVALID');
  const replayed = R.restore(saved, state.pack); assert.equal(replayed.ok, true); assert.deepEqual(replayed.state, state);
});

test('pinned rules1/2/3 consent archives keep legacy validation before the new-policy transition', () => {
  const digests = { '1': '402db16c', '2': '362c6f2f', '3': 'd63194b2' };
  for (const rulesVersion of ['1', '2', '3']) {
    const saved = historical(), original = clone(saved);
    saved.pack.rulesVersion = rulesVersion; saved.pack.digest = digests[rulesVersion];
    for (const event of saved.events) if (event.type === 'turn') {
      if (rulesVersion === '3') event.rulesVersion = rulesVersion;
      else delete event.rulesVersion;
    }
    const restored = R.restore(saved, P.get('rain-lab'));
    assert.equal(restored.ok, true, JSON.stringify(restored.error));
    assert.equal(restored.migration.fromRulesVersion, rulesVersion);
    assert.equal(restored.state.story.answers.q_visitor.value, 'allow');
    assert.equal(R.view(restored.state, { event: 3, line: 1 }).story.answers.q_visitor.value, 'allow');
    const continued = turn(restored.state, '继续聊聊', [], null);
    assert.equal(continued.events.at(-1).consentVersion, 2);
    const replayed = R.restore(R.serialize(continued), continued.pack);
    assert.equal(replayed.ok, true, JSON.stringify(replayed.error)); assert.deepEqual(replayed.state, continued);
    assert.deepEqual(continued.events[3].plan, original.events[3].plan);
    const forged = clone(saved); forged.events[0].consentVersion = 2;
    assert.equal(R.restore(forged, P.get('rain-lab')).error?.code, 'EVENT_INVALID');
  }
});

test('a model plan cannot supply or downgrade the runtime consent marker', () => {
  const state = ready(), candidate = R.propose(state, { text: '你可以记住我' });
  for (const consentVersion of [1, 2]) {
    assert.equal(R.commitModel(state, candidate, { ...plan([answer('q_visitor', 'allow')], 'visitor'), consentVersion }).error?.code, 'PLAN_INVALID');
    const operation = { ...answer('q_visitor', 'allow'), consentVersion };
    assert.equal(R.commitModel(state, candidate, plan([operation], 'visitor')).error?.code, 'OPERATION_INVALID');
  }
});
