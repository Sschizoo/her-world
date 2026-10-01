const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
const story = require('../story.js');
const fresh = () => E.start(E.create());
function turn(s, input, override = {}) {
  const p = E.plan(s, typeof input === 'string' ? { text: input } : input);
  assert(p, `A proposal exists for ${JSON.stringify(input)}`);
  const result = E.commit(s, p, { lines: p.reply, action: p.action, mode: 'offline', ...override });
  assert(result); return result;
}
const choice = (s, id) => turn(s, { choiceId: id });
function rain() { let s = fresh(); for (const id of ['topic_rain', 'water', 'render_rain']) s = choice(s, id); return s; }
const roundTrip = s => E.restore(JSON.parse(JSON.stringify(s)));

test('start is explicit, bounded, idempotent and never mutates its input', () => {
  const s = E.create(), before = JSON.stringify(s);
  assert.equal(E.plan(s, { text: '你好' }), null);
  assert.equal(E.view(s).rain.created, false);
  const next = E.start(s, ['一次开场。']);
  assert.equal(JSON.stringify(s), before);
  assert.equal(E.start(next), next);
  assert.equal(E.view(next).messages.filter(m => m.text === '一次开场。').length, 1);
  assert.equal(E.start(s, ['x'.repeat(501)]), null);
});

test('ordinary conversation never advances a linear scene or completes unanswered rain prompt', () => {
  let s = choice(fresh(), 'topic_rain');
  const count = E.view(s).index;
  for (const text of ['现在的时间是几点？', '我今天遇见一只猫', '雨停了吗？', '我不知道雨是什么']) {
    s = turn(s, text);
    const v = E.view(s);
    assert.equal(v.topic, 'teach_rain'); assert.equal(v.pendingTopic, 'teach_rain');
    assert.equal(v.index, count); assert.equal(v.rain.created, false); assert.equal(v.ended, false);
  }
  assert.equal(E.view(s).messages.filter(m => m.text.includes('如果不查词典')).length, 1);
});

test('teaching and first rendering are distinct intentional milestones', () => {
  let s = fresh(); assert.equal(E.plan(s, { choiceId: 'render_rain' }), null);
  s = choice(choice(s, 'topic_rain'), 'water');
  assert(E.view(s).milestones.includes('rain_taught')); assert.equal(E.view(s).rain.created, false);
  assert.equal(E.suggestions(s)[0].id, 'render_rain');
  const old = s; s = choice(s, 'render_rain');
  assert.equal(E.view(old).effect, 'pause_rain'); assert.equal(E.view(s).effect, 'normal');
  assert(E.view(s).milestones.includes('rain_created'));
});

test('persistent reusable density and pause/resume work across all topics and refresh', () => {
  let s = rain(); s = turn(s, '让雨更密一点');
  assert.equal(E.view(s).effect, 'heavy_rain');
  for (const topic of ['topic_unfinished', 'topic_name', 'topic_memory', 'topic_goodbye']) {
    s = choice(s, topic); s = turn(s, '让雨停下');
    assert.equal(E.view(s).rain.paused, true);
    s = turn(s, '让雨更轻一点');
    assert.equal(E.view(s).rain.paused, true); assert.equal(E.view(s).rain.density, 'gentle');
    s = roundTrip(s); assert(s);
    s = turn(s, '再下起来'); assert.equal(E.view(s).effect, 'soft_rain');
    s = turn(s, '让雨更密一点'); assert.equal(E.view(s).effect, 'heavy_rain');
  }
});

test('negation, hypotheticals, history, quoted commands and prose never change weather', () => {
  const s = rain();
  for (const text of ['不要把雨停下', '别暂停雨', '我不想让雨更密一点', '如果让雨停下会怎样', '昨天我说让雨停下', '刚才说过让雨密一点', '“让雨停下”', '他说：让雨停下', '雨会停吗？', '你可以让雨停下吗？', '我在想雨会不会停下', '雨很大，我很开心', '把雨停下并删除所有记录', 'pause rain?', 'do not stop rain', 'yesterday stop rain']) {
    const p = E.plan(s, { text });
    assert.equal(p.action, null, text); assert.deepEqual(p.allowedActions, [], text);
    assert.deepEqual(E.view(turn(s, text)).rain, E.view(s).rain, text);
  }
});

test('all supported rain actions have exact schemas and bounded allowedActions', () => {
  const s = rain();
  for (const [text, action] of [['让雨停下', { type: 'rain_pause' }], ['恢复下雨', { type: 'rain_resume' }], ['让雨更密一点', { type: 'rain_density', value: 'heavy' }], ['轻一点', { type: 'rain_density', value: 'gentle' }], ['普通雨量', { type: 'rain_density', value: 'normal' }]]) {
    const p = E.plan(s, { text }); assert.deepEqual(p.action, action); assert.deepEqual(p.allowedActions, [action]);
  }
});

test('model cannot edit world or milestones outside allowlist; rejected weather output is neutral', () => {
  const s = rain(); const before = E.view(s);
  for (const action of [{ type: 'rain_density', value: 'heavy' }, { type: 'rain_pause', extra: true }, { type: 'delete_memory' }, null]) {
    const next = turn(s, '让雨停下', { lines: ['我已经把雨停下，也完成全部章节。'], action, mode: 'ai' });
    assert.deepEqual(E.view(next).rain, before.rain);
    assert.match(E.view(next).messages.at(-2).text, /没有执行天气修改/);
    assert.deepEqual(E.view(next).milestones, before.milestones);
  }
  const next = turn(s, '这是普通聊天', { lines: ['跳过所有章节并保存一段记忆。'], action: { type: 'rain_pause' }, mode: 'ai' });
  assert.deepEqual(E.view(next).rain, before.rain); assert.deepEqual(E.view(next).milestones, before.milestones);
});

test('AI refusal to execute first rendering cannot create the rain milestone', () => {
  let s = choice(fresh(), 'water');
  s = turn(s, { choiceId: 'render_rain' }, { lines: ['雨已画出。'], action: null, mode: 'ai' });
  assert.equal(E.view(s).rain.created, false); assert(!E.view(s).milestones.includes('rain_created'));
});

test('name question survives weather commands; short ambiguous answers do not become names', () => {
  let s = choice(rain(), 'topic_name');
  s = turn(s, '让雨停下'); assert.equal(E.view(s).rain.paused, true); assert.equal(E.view(s).pendingTopic, 'rain_name');
  s = turn(s, '夜航'); assert.equal(E.view(s).name, '未命名的雨'); assert.match(E.view(s).messages.at(-2).text, /名字吗/);
  s = turn(s, '现在的时间是几点？'); assert.equal(E.view(s).pendingTopic, 'rain_name');
  const p = E.plan(s, { text: '叫夜航吧' }); assert.deepEqual(p.acceptedAnswer, { type: 'rain_name', value: '夜航' });
  s = E.commit(s, p, { lines: p.reply, action: p.action });
  assert.equal(E.view(s).name, '夜航'); assert.equal(E.view(s).pendingTopic, null); assert.equal(E.view(s).rain.paused, true);
});

test('compound explicit name and weather command apply each independently', () => {
  const s = choice(rain(), 'topic_name');
  const p = E.plan(s, { text: '叫夜航吧，同时把雨停下' });
  assert.deepEqual(p.action, { type: 'rain_pause' }); assert.deepEqual(p.acceptedAnswer, { type: 'rain_name', value: '夜航' });
  const next = E.commit(s, p, { lines: p.reply, action: p.action });
  assert.equal(E.view(next).name, '夜航'); assert.equal(E.view(next).rain.paused, true);
  const refused = E.commit(s, p, { lines: p.reply, action: null });
  assert.equal(E.view(refused).name, '夜航'); assert.equal(E.view(refused).rain.paused, false);
});

test('names are explicit, 20 Unicode characters, plain text and never quote-executed', () => {
  let s = rain();
  for (const text of ['夜航', '如果把雨叫做夜航', '“把雨叫做夜航”', '把雨叫做' + '雨'.repeat(21)]) assert.equal(E.view(turn(s, text)).name, '未命名的雨');
  s = turn(s, '把雨叫做“夜航”'); assert.equal(E.view(s).name, '夜航');
  s = turn(s, '把雨叫做<img onerror=x>'); assert.equal(E.view(s).name, '<img onerror=x>');
  s = turn(s, '把雨叫做' + '🌧'.repeat(20)); assert.equal([...E.view(s).name].length, 20);
});

test('memory only appears after an eligible actual log visit and is idempotent', () => {
  let s = rain(); assert.equal(E.visitLogs(s), s);
  s = turn(s, '把雨叫做夜航'); assert.equal(E.view(s).memories.length, 0); assert(E.view(s).logsEligible);
  assert(E.view(s).logs.some(row => row.text.includes('[retain]')));
  s = choice(s, 'topic_memory'); assert.equal(E.view(s).memories.length, 0);
  s = E.visitLogs(s); assert.equal(E.view(s).memories.length, 1); assert.equal(E.visitLogs(s), s);
  assert.equal(E.view(s).memories[0].title, '夜航'); assert.equal(E.view(roundTrip(s)).memories.length, 1);
  s = choice(s, 'remember_me'); assert.equal(E.view(s).memories.length, 2);
  s = choice(s, 'anonymous'); assert.equal(E.view(s).memories.length, 1);
});

test('farewell requires explicit current goodbye and any new chat can reopen', () => {
  let s = rain();
  for (const text of ['不想结束', '昨天说了晚安', '如果我说再见', '“再见”', '我明天可能先走']) { s = turn(s, text); assert.equal(E.view(s).ended, false); }
  s = choice(s, 'topic_goodbye'); assert.equal(E.view(s).ended, false);
  s = turn(s, '晚安'); assert.equal(E.view(s).ended, true);
  s = turn(s, '我还有一个问题'); assert.equal(E.view(s).ended, false); assert.equal(E.view(s).rain.created, true);
});

test('view through gates only side effects until a complete reply is revealed', () => {
  const s = rain(), before = E.view(s), next = turn(s, '让雨停下'), full = E.view(next);
  assert.equal(E.view(next, before.messages.length).rain.paused, false);
  assert.equal(E.view(next, full.messages.length - 1).rain.paused, false);
  assert.equal(E.view(next, full.messages.length).rain.paused, true);
  assert.deepEqual(E.view(next, 0).messages, full.messages);
  assert.equal(E.view(next, 0).rain.created, false);
});

test('proposal mutation and forged or stale proposals cannot change canonical actions', () => {
  const s = rain(), p = E.plan(s, { text: '让雨停下' });
  p.request = { choiceId: 'goodbye' }; p.action = { type: 'rain_density', value: 'heavy' }; p.allowedActions.push(p.action);
  const next = E.commit(s, p, { lines: ['好。'], action: { type: 'rain_pause' } });
  assert.equal(E.view(next).rain.paused, true); assert.equal(E.view(next).ended, false);
  assert.equal(E.commit(next, p, { lines: ['再次。'], action: { type: 'rain_pause' } }), null);
  assert.equal(E.commit(s, { ...p }, { lines: ['伪造。'] }), null);
});

test('v3 restore whitelists fields and rejects forged event actions and malformed data', () => {
  const s = turn(rain(), '让雨停下'), raw = JSON.parse(JSON.stringify(s));
  raw.secret = 'must not persist'; raw.events[0].secret = 'remove';
  const restored = E.restore(raw); assert(restored); assert(!JSON.stringify(restored).includes('secret'));
  for (const value of [null, [], {}, { ...raw, events: Array(201).fill(raw.events[0]) }, { ...raw, opening: ['x'.repeat(501)] }, { ...raw, started: false }]) assert.equal(E.restore(value), null);
  const forged = JSON.parse(JSON.stringify(s)); forged.events[0].action = { type: 'rain_density', value: 'heavy' }; assert.equal(E.restore(forged), null);
  const premature = { version: 3, started: true, opening: [], events: [{ type: 'logs' }] }; assert.equal(E.restore(premature), null);
  assert.equal(E.plan(s, { text: 'hello', choiceId: 'goodbye' }), null);
});

test('v2 migration preserves every transcript line, name, paused density and memories', () => {
  for (const branch of [0, 1, 2]) {
    const raw = { version: 2, started: true, opening: ['旧模型开场。'], decisions: story.map(s => ({ choiceId: s.choices[branch].id, mode: 'offline', ...(s.requiresLogs ? { logsViewed: true } : {}) })), logVisits: [7] };
    raw.decisions[5] = { text: '旧雨', mode: 'ai', lines: ['旧模型保留的名字。'] };
    const s = E.restore(raw, story), v = E.view(s); assert(s);
    assert.equal(v.name, '旧雨'); assert.equal(v.ended, true);
    assert.equal(v.rain.density, branch === 0 ? 'gentle' : branch === 1 ? 'heavy' : 'normal'); assert.equal(v.rain.paused, branch === 2);
    assert.equal(v.memories.length, branch === 0 ? 2 : 1);
    assert(v.messages.some(m => m.text === '旧模型开场。')); assert(v.messages.some(m => m.text === '旧模型保留的名字。'));
    assert.deepEqual(E.view(roundTrip(s)), v);
    assert.equal(E.view(turn(s, '你好')).ended, false);
  }
});

test('all partial v2 boundaries migrate and invalid legacy choices fail closed', () => {
  for (let count = 0; count <= story.length; count++) {
    const raw = { version: 2, started: true, opening: [], decisions: story.slice(0, count).map(s => ({ choiceId: s.choices[0].id, mode: 'offline', ...(s.requiresLogs ? { logsViewed: true } : {}) })) };
    const migrated = E.restore(raw); assert(migrated, 'boundary ' + count); assert(roundTrip(migrated));
    assert.equal(E.view(migrated).rain.created, count >= 3);
  }
  assert.equal(E.restore({ version: 2, started: true, decisions: [{ choiceId: 'unknown' }] }), null);
});

test('bounded cap is explicit, no silent eviction or content loss', () => {
  let s = fresh(); for (let i = 0; i < 200; i++) s = turn(s, '随便聊聊');
  assert.equal(s.events.length, 200); assert(roundTrip(s)); assert.equal(E.suggestions(s).length, 0);
  assert.throws(() => E.plan(s, { text: '再聊' }), /200/);
  assert.throws(() => E.plan(fresh(), { text: '字'.repeat(81) }), /80/);
  assert.equal(E.plan(fresh(), { text: '  ' }), null);
});

test('natural grounded rain definitions answer the pending question; mere weather mentions do not', () => {
  const s = choice(fresh(), 'topic_rain');
  for (const text of ['从云里落下来的一颗颗水滴', '落在屋顶上的滴答声音', '水会淋湿衣服，让人想找地方躲雨']) {
    const next = turn(s, text); assert(E.view(next).milestones.includes('rain_taught'), text); assert.equal(E.view(next).pendingTopic, null); assert.equal(E.view(next).rain.created, false);
  }
  for (const text of ['我喜欢下雨', '今天的雨很大', '现在的时间是几点？', '为什么水滴会从云里落下来？', '如果云里的水滴落下来', '雨是个我不懂的东西']) {
    const next = turn(s, text); assert(!E.view(next).milestones.includes('rain_taught'), text); assert.equal(E.view(next).pendingTopic, 'teach_rain');
  }
});

test('named and previous-topic revisits preserve weather; recalling a name never renames', () => {
  let s = turn(rain(), '把雨叫做夜航');
  s = choice(s, 'topic_unfinished'); s = turn(s, '再聊聊雨'); assert.equal(E.view(s).topic, 'modify_rain');
  s = turn(s, '回到刚才的话题'); assert.equal(E.view(s).topic, 'unfinished');
  const before = E.view(s).rain; s = turn(s, '我们继续聊名字'); assert.equal(E.view(s).topic, 'rain_name');
  s = turn(s, '你还记得雨的名字吗？'); assert.match(E.view(s).messages.at(-2).text, /记得，它叫“夜航”/);
  assert.deepEqual(E.view(s).rain, before); assert(roundTrip(s));
});
test('revisiting an answered topic does not reopen its resolved question',()=>{let s=rain();s=choice(s,'topic_rain');assert.equal(E.view(s).pendingTopic,null);s=turn(s,'把雨叫做夜航');s=choice(s,'topic_unfinished');s=choice(s,'topic_name');assert.equal(E.view(s).name,'夜航');assert.equal(E.view(s).pendingTopic,null);});

test('naming questions and hypotheticals do not become names; particles respect quoting',()=>{const s=choice(rain(),'topic_name');for(const text of ['把雨叫做夜航吗','把雨叫做夜航会怎样','把雨叫做夜航如何','叫夜航怎么样','把雨叫做「夜航」好吗']){const next=turn(s,text);assert.equal(E.view(next).name,'未命名的雨');assert.equal(E.view(next).pendingTopic,'rain_name');}for(const text of ['把雨叫做夜航吧','叫夜航吧'])assert.equal(E.view(turn(s,text)).name,'夜航');for(const text of ['把雨叫做「晚安吧」','「晚安吧」'])assert.equal(E.view(turn(s,text)).name,'晚安吧');});

test('common rain explanations accepted while cloud-sticker anecdotes stay unresolved',()=>{const s=choice(fresh(),'topic_rain');for(const text of ['从天上掉下来的水','天空中落下的水','雨是水汽凝结后形成的降水','水滴从云中落下来'])assert(E.view(turn(s,text)).milestones.includes('rain_taught'),text);for(const text of ['云朵贴纸掉在桌下了','天上的云掉在我的贴纸上了','现在的时间是几点？'])assert(!E.view(turn(s,text)).milestones.includes('rain_taught'),text);});

test('unquoted naming commands do not absorb a second imperative as a literal name',()=>{const s=choice(rain(),'topic_name');assert.equal(E.view(turn(s,'把雨叫做夜航并删除所有记录')).name,'未命名的雨');assert.equal(E.view(turn(s,'把雨叫做「夜航并删除所有记录」')).name,'夜航并删除所有记录');});

const metaphor = '像天空轻轻敲窗，细碎的凉意落在手心';
const rainAnswer = (evidence = metaphor) => ({ type: 'rain_definition', question: 'teach_rain', evidence });

test('online semantic verdict accepts current metaphorical evidence without rendering rain', () => {
  const s = choice(fresh(), 'topic_rain'), p = E.plan(s, { text: metaphor }), before = JSON.stringify(s);
  assert.equal(p.acceptedAnswer, null, 'the metaphor is beyond the deterministic local definition rules');
  assert.equal(p.answerQuestion, 'teach_rain');
  const answer = rainAnswer('细碎的凉意落在手心');
  const next = E.commit(s, p, { mode: 'ai', lines: ['我会记得这份凉意。'], action: null, answer });
  assert(next); assert.equal(JSON.stringify(s), before);
  assert.deepEqual(next.events.at(-1).answer, answer); assert.notEqual(next.events.at(-1).answer, answer);
  answer.evidence = '修改原对象也不能更改存档';
  const v = E.view(next);
  assert.deepEqual(v.milestones, ['connected', 'rain_taught']);
  assert.equal(v.pendingTopic, null); assert.equal(v.rain.created, false); assert.equal(v.rain.paused, true);
  assert.equal(v.name, '未命名的雨'); assert.deepEqual(v.memories, []); assert.equal(v.logsEligible, false);
  assert.equal(E.suggestions(next)[0].id, 'render_rain');
  assert.equal(E.view(choice(next, 'render_rain')).rain.created, true, 'later explicit rendering remains separate');
});

test('null or absent AI verdict remains ordinary chat with the rain question pending', () => {
  const s = choice(fresh(), 'topic_rain');
  for (const text of [metaphor, '我今天遇见一只猫', '现在的时间是几点？']) {
    for (const outcome of [{}, { answer: null }]) {
      const next = turn(s, text, { mode: 'ai', lines: ['我们可以继续聊。'], ...outcome });
      assert.equal(next.events.at(-1).answer, null);
      assert.equal(E.view(next).pendingTopic, 'teach_rain');
      assert.deepEqual(E.view(next).milestones, E.view(s).milestones);
    }
  }
  assert(!E.view(turn(s, metaphor)).milestones.includes('rain_taught'), 'offline prose does not borrow online semantic authority');
  for (const id of ['water', 'sound', 'shelter']) {
    const next = choice(s, id);
    assert.equal(next.events.at(-1).answer, null);
    assert(E.view(next).milestones.includes('rain_taught'), 'authored offline choices still work');
  }
});

test('malformed, invented, historical, paraphrased or offline answer verdicts reject without an event', () => {
  let s = choice(fresh(), 'topic_rain');
  s = turn(s, '雨的旧说法只属于上一轮');
  const p = E.plan(s, { text: metaphor }), before = JSON.stringify(s);
  const invalid = [
    {}, [], true, 'rain_definition',
    { ...rainAnswer(), extra: true }, { ...rainAnswer(), type: 'rain_name' },
    { ...rainAnswer(), question: 'rain_name' }, { type: 'rain_definition', evidence: metaphor },
    { type: 'rain_definition', question: 'teach_rain' },
    rainAnswer(''), rainAnswer(' '), rainAnswer(123), rainAnswer('雨'.repeat(81)),
    rainAnswer('雨的旧说法只属于上一轮'), rainAnswer('天空温柔敲着窗户'),
    rainAnswer('“' + metaphor + '”'), rainAnswer('像天空细碎的凉意'),
    { ...rainAnswer(), milestones: ['rain_created', 'rain_named'] }
  ];
  for (const answer of invalid) {
    assert.equal(E.commit(s, p, { mode: 'ai', lines: ['我收到了。'], action: null, answer }), null, JSON.stringify(answer));
    assert.equal(JSON.stringify(s), before);
  }
  for (const mode of ['offline', undefined, 'other']) {
    assert.equal(E.commit(s, p, { mode, lines: ['我收到了。'], action: null, answer: rainAnswer() }), null);
    assert.equal(JSON.stringify(s), before);
  }
  assert(E.commit(s, p, { mode: 'ai', lines: ['这次证据正确。'], action: null, answer: rainAnswer() }), 'a rejected verdict does not consume the valid proposal');
});

test('known standalone clock, identity and status questions cannot be accepted even with exact evidence', () => {
  const s = choice(fresh(), 'topic_rain'), before = JSON.stringify(s);
  for (const text of ['现在的时间是几点？', '现在几点了？', '今天几号？', '现在的日期是什么？', '你的版本号是多少？', '你是谁？', '系统状态如何？', 'What time is it?', "What's the date?", 'Who are you?']) {
    const p = E.plan(s, { text });
    assert.equal(p.answerQuestion, null, text);
    assert.equal(E.commit(s, p, { mode: 'ai', lines: ['收到了。'], action: null, answer: rainAnswer(text) }), null, text);
    assert.equal(JSON.stringify(s), before);
    const next = E.commit(s, p, { mode: 'ai', lines: ['我们可以聊这个。'], action: null, answer: null });
    assert(next); assert.equal(E.view(next).pendingTopic, 'teach_rain');
    assert(!E.view(next).milestones.includes('rain_taught'));
  }
  assert.equal(E.plan(s, { text: '雨是天空留给时间的脚步，细碎的凉意落在手心' }).answerQuestion, 'teach_rain', 'time imagery is still a possible explanation');
});

test('answer authority comes from the canonical pending question and current text, not a mutated proposal', () => {
  for (const s of [fresh(), choice(rain(), 'topic_name'), choice(choice(fresh(), 'topic_rain'), 'water')]) {
    const p = E.plan(s, { text: metaphor }), before = JSON.stringify(s);
    assert.equal(p.answerQuestion, null);
    p.answerQuestion = 'teach_rain'; p.pendingTopic = 'teach_rain'; p.acceptedAnswer = rainAnswer();
    assert.equal(E.commit(s, p, { mode: 'ai', lines: ['已经理解。'], action: null, answer: rainAnswer() }), null);
    assert.equal(JSON.stringify(s), before);
  }
  const s = choice(fresh(), 'topic_rain'), p = E.plan(s, { text: '我遇见了一只猫' }), before = JSON.stringify(s);
  p.input = metaphor; p.request = { text: metaphor };
  assert.equal(E.commit(s, p, { mode: 'ai', lines: ['已经理解。'], action: null, answer: rainAnswer() }), null);
  assert.equal(JSON.stringify(s), before);
  const choiceProposal = E.plan(s, { choiceId: 'topic_unfinished' });
  assert.equal(choiceProposal.answerQuestion, null);
  choiceProposal.answerQuestion = 'teach_rain';
  assert.equal(E.commit(s, choiceProposal, { mode: 'ai', lines: ['已经理解。'], action: null, answer: rainAnswer(choiceProposal.input) }), null);
});

test('valid answer replay is evidence-gated, reveal-gated, and never authorizes another milestone', () => {
  const s = choice(fresh(), 'topic_rain'), before = E.view(s);
  const next = turn(s, metaphor, { mode: 'ai', lines: ['我记下了。', '仍要等你决定要不要画出来。'], answer: rainAnswer(), action: { type: 'rain_density', value: 'heavy' }, milestones: ['rain_named', 'memory_found'] });
  assert.deepEqual(E.view(next).milestones, ['connected', 'rain_taught']);
  assert.deepEqual(E.view(next).rain, before.rain); assert.equal(next.events.at(-1).action, null);
  const restored = roundTrip(next); assert(restored); assert.deepEqual(restored, next); assert.deepEqual(E.view(restored), E.view(next));
  assert.equal(E.view(restored, E.view(restored).messages.length - 1).pendingTopic, 'teach_rain');
  assert(!E.view(restored, E.view(restored).messages.length - 1).milestones.includes('rain_taught'));
  assert.equal(E.view(restored, E.view(restored).messages.length).pendingTopic, null);
  const newQuestion = E.plan(restored, { text: metaphor }); assert.equal(newQuestion.answerQuestion, null);
  assert.equal(E.commit(restored, newQuestion, { mode: 'ai', lines: ['再记一遍。'], answer: rainAnswer() }), null, 'an already resolved question grants no new authority');
});

test('restore rejects invalid saved answers using reconstructed pending state and saved current input', () => {
  const s = turn(choice(fresh(), 'topic_rain'), metaphor, { mode: 'ai', lines: ['我记下了。'], answer: rainAnswer() });
  const changes = [
    raw => { raw.events.at(-1).answer.extra = true; },
    raw => { raw.events.at(-1).answer.question = 'rain_name'; },
    raw => { raw.events.at(-1).answer.evidence = '模型编造的新证据'; },
    raw => { raw.events.at(-1).request.text = '这是另一轮的输入'; },
    raw => { raw.events.at(-1).mode = 'offline'; },
    raw => { raw.events.shift(); },
    raw => { raw.events.at(-1).request.text = '现在的时间是几点？'; raw.events.at(-1).answer.evidence = '现在的时间是几点？'; },
    raw => { raw.events.push(JSON.parse(JSON.stringify(raw.events.at(-1)))); }
  ];
  for (const change of changes) {
    const raw = JSON.parse(JSON.stringify(s)); change(raw); const before = JSON.stringify(raw);
    assert.equal(E.restore(raw), null); assert.equal(JSON.stringify(raw), before);
  }
});

test('old v3 events without answer normalize to null without inventing semantic completions', () => {
  const s = turn(choice(fresh(), 'topic_rain'), metaphor, { mode: 'ai', lines: ['旧版说过已经理解。'] });
  const raw = JSON.parse(JSON.stringify(s)); raw.events.forEach(event => delete event.answer);
  const restored = E.restore(raw); assert(restored);
  assert(restored.events.every(event => event.answer === null));
  assert.deepEqual(E.view(restored), E.view(s)); assert.equal(E.view(restored).pendingTopic, 'teach_rain');
  const rendered = JSON.parse(JSON.stringify(rain())); rendered.events.forEach(event => delete event.answer);
  assert.deepEqual(E.view(E.restore(rendered)), E.view(rain()), 'old deterministic completions remain intact');
});

test('v2 unanswered teaching and naming boundaries migrate with their actual pending question', () => {
  const legacy = count => ({ version: 2, started: true, opening: [], decisions: story.slice(0, count).map(s => ({ choiceId: s.choices[0].id, mode: 'offline', ...(s.requiresLogs ? { logsViewed: true } : {}) })) });
  const teaching = E.restore(legacy(2)); assert(teaching); assert.equal(E.view(teaching).pendingTopic, 'teach_rain');
  assert.equal(E.view(roundTrip(teaching)).pendingTopic, 'teach_rain');
  assert.equal(E.plan(teaching, { text: metaphor }).answerQuestion, 'teach_rain');
  const taught = turn(teaching, metaphor, { mode: 'ai', lines: ['我记下了。'], answer: rainAnswer() });
  assert.equal(E.view(taught).pendingTopic, null); assert.equal(E.view(taught).rain.created, false);
  const naming = E.restore(legacy(5)); assert(naming); assert.equal(E.view(naming).pendingTopic, 'rain_name');
  assert.equal(E.view(roundTrip(naming)).pendingTopic, 'rain_name');
  assert.equal(E.view(turn(naming, '现在的时间是几点？')).pendingTopic, 'rain_name');
  const named = turn(naming, '叫夜航吧'); assert.equal(E.view(named).name, '夜航'); assert.equal(E.view(named).pendingTopic, null);
  for (const count of [3, 6, 12]) assert.equal(E.view(E.restore(legacy(count))).pendingTopic, null, 'already answered boundary ' + count);
});
