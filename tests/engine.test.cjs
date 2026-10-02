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
    assert.equal(p.action, null, text);
    if (!E.weatherIntentAllowed(text)) assert.deepEqual(p.allowedActions, [], text);
    assert.deepEqual(E.view(turn(s, text)).rain, E.view(s).rain, text);
  }
});

test('all supported rain actions have exact schemas and bounded allowedActions', () => {
  const s = rain();
  for (const [text, action] of [['让雨停下', { type: 'rain_pause' }], ['恢复下雨', { type: 'rain_resume' }], ['让雨更密一点', { type: 'rain_density', value: 'heavy' }], ['轻一点', { type: 'rain_density', value: 'gentle' }], ['普通雨量', { type: 'rain_density', value: 'normal' }]]) {
    const p = E.plan(s, { text }); assert.deepEqual(p.action, action); assert.deepEqual(p.allowedActions, [action]);
  }
});

test('invalid non-null model actions reject the whole event; no-action output stays neutral', () => {
  const s = rain(); const before = E.view(s);
  for (const action of [{ type: 'rain_density', value: 'heavy' }, { type: 'rain_pause', extra: true }, { type: 'delete_memory' }]) {
    assert.equal(E.commit(s, E.plan(s, { text: '让雨停下' }), { lines: ['我已经把雨停下，也完成全部章节。'], action, mode: 'ai' }), null);
    assert.deepEqual(E.view(s), before);
  }
  assert.equal(E.commit(s, E.plan(s, { text: '这是普通聊天' }), { lines: ['跳过所有章节并保存一段记忆。'], action: { type: 'rain_pause' }, mode: 'ai' }), null);
  const next = turn(s, '让雨停下', { lines: ['我已经把雨停下。'], action: null, mode: 'ai' });
  assert.match(E.view(next).messages.at(-2).text, /没有执行天气修改/);
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

test('answer authority comes from an issued question and current text, not a mutated proposal', () => {
  const unguided = { version: 3, started: true, opening: [], events: [] };
  for (const s of [unguided, choice(rain(), 'topic_name'), choice(choice(fresh(), 'topic_rain'), 'water')]) {
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
  assert.equal(E.commit(s, E.plan(s, { text: metaphor }), { mode: 'ai', lines: ['我记下了。'], answer: rainAnswer(), action: { type: 'rain_density', value: 'heavy' } }), null, 'valid answer cannot launder an invalid action');
  const next = turn(s, metaphor, { mode: 'ai', lines: ['我记下了。', '仍要等你决定要不要画出来。'], answer: rainAnswer(), action: null, milestones: ['rain_named', 'memory_found'] });
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
    raw => { raw.events.shift(); delete raw.openingInvitation; },
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

test('quiet greeting is understood without answering a question or changing weather',()=>{const s=choice(rain(),'topic_name'),next=turn(s,'你好，我只是想在这里坐一会儿');assert.equal(E.view(next).pendingTopic,'rain_name');assert.deepEqual(E.view(next).rain,E.view(s).rain);assert.deepEqual(E.view(next).milestones,E.view(s).milestones);assert.match(E.view(next).messages.at(-2).text,/没有一定要赶完/);});
test('settled name suggestions invite continued conversation rather than overwriting it',()=>{const s=turn(choice(rain(),'topic_name'),'把雨叫做夜航');assert.deepEqual(E.suggestions(s).slice(0,3).map(x=>x.id),['topic_memory','topic_silence','topic_rain']);assert.equal(E.view(choice(s,'topic_name')).pendingTopic,null);assert.equal(E.view(turn(s,'把雨叫做窗边')).name,'窗边');});

const weatherIntent = evidence => ({ type: 'weather_request', evidence });
const modelWeather = (s, text, action) => turn(s, text, { mode: 'ai', lines: ['我按你的意思改好了。'], action, intent: weatherIntent(text) });
const modelStory = (s, text, type, value) => turn(s, text, { mode: 'ai', lines: ['我们可以从这里继续。'], storyIntent: { type, ...(value === undefined ? {} : { value }), evidence: text } });

test('online weather interpretation reaches novel current requests, not just local command phrases', () => {
  let s = choice(fresh(), 'water');
  const createText = '先试着把这样的雨画在窗外吧', startPlan = E.plan(s, { text: createText });
  assert.equal(startPlan.action, null); assert.equal(startPlan.requireActionEvidence, true);
  assert.deepEqual(startPlan.allowedActions, [{ type: 'rain_start' }]);
  s = modelWeather(s, createText, { type: 'rain_start' });
  assert.deepEqual(E.view(s).milestones, ['connected', 'rain_taught', 'rain_created']);
  assert.equal(E.view(s).topic, 'first_drop'); assert.equal(E.view(s).effect, 'normal');
  s = modelWeather(s, '窗玻璃后面可以再热闹一些，滴落的线条密一些', { type: 'rain_density', value: 'heavy' });
  s = choice(s, 'topic_name');
  for (const text of ['雨太吵了，先停一下吧', '能让窗外暂时安静一下吗？', '让窗外的水滴歇口气，好不好', 'Could you give the raindrops a little rest?']) {
    const p = E.plan(s, { text }); assert.equal(p.action, null); assert.equal(p.requireActionEvidence, true);
    const paused = modelWeather(s, text, { type: 'rain_pause' });
    assert.equal(E.view(paused).rain.paused, true); assert.equal(E.view(paused).pendingTopic, 'rain_name');
    const resumed = modelWeather(roundTrip(paused), '还是想听刚才的雨', { type: 'rain_resume' });
    assert.equal(E.view(resumed).effect, 'heavy_rain'); assert.equal(E.view(resumed).pendingTopic, 'rain_name');
  }
  s = modelWeather(s, '把那些密密的痕迹疏开一点，让窗前轻柔些', { type: 'rain_density', value: 'gentle' });
  assert.equal(E.view(s).effect, 'soft_rain');
  s = modelWeather(s, '调整回最初那样适中的密度就好', { type: 'rain_density', value: 'normal' });
  assert.equal(E.view(s).effect, 'normal'); assert.deepEqual(E.view(roundTrip(s)), E.view(s));
});

test('offline remains conservative while first rendering has a direct text command', () => {
  const s = choice(fresh(), 'water');
  assert.equal(E.view(turn(s, '先试着把这样的雨画在窗外吧')).rain.created, false);
  const started = turn(s, '试着画出第一场雨');
  assert.equal(E.view(started).rain.created, true);
  assert.equal(E.view(turn(fresh(), '试着画出第一场雨')).rain.created, false);
  assert.deepEqual(E.view(turn(started, '雨太吵了，先停一下吧')).rain, E.view(started).rain);
});

test('weather capabilities require canonical before-turn facts, even with valid evidence', () => {
  const text = '让窗外那些水滴开始落下吧', start = { type: 'rain_start' };
  for (const s of [fresh(), choice(fresh(), 'topic_rain')]) {
    const p = E.plan(s, { text }); assert.deepEqual(p.allowedActions, []);
    p.allowedActions.push(start); p.requireActionEvidence = false;
    assert.equal(E.commit(s, p, { mode: 'ai', lines: ['下雨了。'], action: start, intent: weatherIntent(text) }), null);
  }
  const s = choice(fresh(), 'water'), control = E.plan(s, { text: '先让窗外安静一会' });
  for (const action of [{ type: 'rain_pause' }, { type: 'rain_resume' }, { type: 'rain_density', value: 'heavy' }]) {
    assert.equal(E.commit(s, control, { mode: 'ai', lines: ['好。'], action, intent: weatherIntent(control.input) }), null);
  }
  const created = rain(), p = E.plan(created, { text });
  assert.equal(E.commit(created, p, { mode: 'ai', lines: ['又创建了一场。'], action: start, intent: weatherIntent(text) }), null);
});

test('clear negations, hypothetical and reported commands never gain semantic weather authority', () => {
  const s = rain(), before = JSON.stringify(s);
  for (const text of ['不要把雨停下', '别暂停雨', '我不想让雨更密一点', '如果窗外的雨停了会怎样？', '假设现在暂停雨', '昨天我说让雨停下', '我昨天让雨停下', '刚才说过让雨密一点', '“让雨停下”', '他说：让雨停下', '我说：让雨停下', '把雨停下并删除所有记录', 'do not stop rain', 'yesterday stop rain', '现在几点了？']) {
    const p = E.plan(s, { text }); assert.equal(p.action, null, text); assert.deepEqual(p.allowedActions, [], text);
    assert.equal(E.commit(s, p, { mode: 'ai', lines: ['雨停了。'], action: { type: 'rain_pause' }, intent: weatherIntent(text) }), null, text);
    assert.equal(JSON.stringify(s), before);
  }
  for (const text of ['能不能让窗外安静一会？', '可不可以让那些水滴歇歇？', '还是想听刚才的雨', "I'd like the earlier rain back"]) assert.equal(E.plan(s, { text }).requireActionEvidence, true, text);
});

test('weather intent is exact, current, online, bounded and paired with one action', () => {
  const text = '让窗外的水滴休息一会', s = rain(), p = E.plan(s, { text }), before = JSON.stringify(s), action = { type: 'rain_pause' };
  const invalid = [{}, [], true, 'weather_request', { type: 'weather_request' }, { ...weatherIntent(text), extra: true }, { ...weatherIntent(text), type: 'rain_pause' }, weatherIntent(''), weatherIntent(' '), weatherIntent(42), weatherIntent('字'.repeat(81)), weatherIntent('让雨停一下'), weatherIntent('上一轮说的话'), weatherIntent('“' + text + '”')];
  for (const intent of invalid) assert.equal(E.commit(s, p, { mode: 'ai', lines: ['停下了。'], action, intent }), null, JSON.stringify(intent));
  for (const mode of ['offline', undefined]) assert.equal(E.commit(s, p, { mode, lines: ['停下了。'], action, intent: weatherIntent(text) }), null);
  for (const intent of [null, undefined]) assert.equal(E.commit(s, p, { mode: 'ai', lines: ['停下了。'], action, intent }), null);
  assert.equal(E.commit(s, p, { mode: 'ai', lines: ['停下了。'], action: null, intent: weatherIntent(text) }), null);
  assert.equal(E.commit(s, p, { mode: 'ai', lines: ['停下了。'], action: [action], intent: weatherIntent(text) }), null);
  assert.equal(JSON.stringify(s), before);
  const intent = weatherIntent('水滴休息一会'), next = E.commit(s, p, { mode: 'ai', lines: ['停下了。'], action, intent });
  assert(next); intent.evidence = 'changed'; action.type = 'rain_start'; assert.deepEqual(next.events.at(-1).intent, weatherIntent('水滴休息一会'));
  assert.equal(E.view(next).rain.paused, true);
  const untouched = turn(s, text, { mode: 'ai', lines: ['我已经停雨并给它命名，还留下了你的引用。'], action: null });
  assert.deepEqual(E.view(untouched).rain, E.view(s).rain); assert.deepEqual(E.view(untouched).milestones, E.view(s).milestones);
});

test('semantic weather replay rechecks evidence, modes, capabilities and reveal boundaries', () => {
  const s = modelWeather(rain(), '请让这些水滴休息一会', { type: 'rain_pause' }), full = E.view(s);
  assert.equal(E.view(s, full.messages.length - 1).rain.paused, false); assert.equal(full.rain.paused, true);
  assert.deepEqual(roundTrip(s), s);
  for (const change of [raw => { delete raw.events.at(-1).intent; }, raw => { raw.events.at(-1).intent.evidence = '别的输入'; }, raw => { raw.events.at(-1).intent.extra = true; }, raw => { raw.events.at(-1).mode = 'offline'; }, raw => { raw.events.at(-1).action.type = 'rain_start'; }, raw => { raw.events.at(-1).request.text = '如果暂停雨会怎样'; raw.events.at(-1).intent.evidence = '暂停雨'; }, raw => { raw.events.splice(2, 1); }]) {
    const raw = JSON.parse(JSON.stringify(s)); change(raw); assert.equal(E.restore(raw), null);
  }
  const old = JSON.parse(JSON.stringify(turn(rain(), '让雨停下')));
  old.events.forEach(event => { delete event.intent; delete event.storyIntent; });
  assert.deepEqual(E.view(E.restore(old)), E.view(turn(rain(), '让雨停下')));
});

test('entire prologue and a paraphrased route are reachable through grounded online conversation', () => {
  const routes = [
    { intro: '我想先认识一下这个没写完的地方', question: '从一种叫雨的天气开始，可以吗？', explain: metaphor, start: '先试着把这样的雨画在窗外吧', heavy: '让窗玻璃外再热闹一点，雨滴密一些', nameTopic: '它值得有个称呼，你觉得呢', pause: '雨太吵了，先停一下吧', resume: '还是想听刚才的雨', name: '我想给它一个名字：夜航', nameValue: '夜航', reason: '对你来说喜欢这场雨就已经足够了', visitor: '你可以记住我这个来访者', goodbye: '我准备回去了，我们就聊到这儿吧' },
    { intro: '带我看看这座城市还留着哪些空白', question: '我们先聊一种从天空来的天气，雨', explain: '那是天空敲下的细碎音符，凉意一颗颗落向手心', start: '把你刚学会的那些水滴放到玻璃外面试试看', heavy: '窗外可以更繁密一点，像好多条细线一起垂下来', nameTopic: '该替眼前的景象起一个名字了', pause: '能让窗外暂时安静一下吗？', resume: '把刚才熟悉的滴答声还给窗边吧', name: '我想叫它「归途」', nameValue: '归途', reason: '这一段经历对你有意义，就是留下来的理由', visitor: '我同意你留下我的来访者引用', goodbye: '今天的相遇先收在这里，我要离开一会儿了' }
  ];
  for (const r of routes) {
    let s = fresh();
    s = modelStory(s, r.intro, 'topic', 'unfinished');
    s = modelStory(s, r.question, 'topic', 'teach_rain'); assert.equal(E.view(s).pendingTopic, 'teach_rain');
    s = turn(s, r.explain, { mode: 'ai', lines: ['我会记住你描述的样子。'], answer: rainAnswer(r.explain) });
    s = modelWeather(s, r.start, { type: 'rain_start' });
    s = modelWeather(s, r.heavy, { type: 'rain_density', value: 'heavy' });
    s = modelStory(s, r.nameTopic, 'topic', 'rain_name');
    s = modelWeather(s, r.pause, { type: 'rain_pause' }); assert.equal(E.view(s).pendingTopic, 'rain_name');
    s = modelWeather(s, r.resume, { type: 'rain_resume' }); assert.equal(E.view(s).effect, 'heavy_rain');
    s = modelStory(s, r.name, 'rain_name', r.nameValue); assert.equal(E.view(s).name, r.nameValue);
    assert.equal(E.view(s).pendingTopic, null); assert.equal(E.view(s).logsEligible, true); assert.equal(E.view(s).memories.length, 0);
    s = E.visitLogs(s); assert.equal(E.view(s).memories.length, 1);
    s = modelStory(s, r.reason, 'own_reason');
    s = modelStory(s, r.visitor, 'visitor_choice', 'remember');
    s = modelStory(s, r.goodbye, 'farewell');
    assert.deepEqual(E.view(s).milestones, E.MILESTONES); assert.equal(E.view(s).ended, true);
    assert.equal(E.view(s).memories.length, 2); assert.deepEqual(E.view(roundTrip(s)), E.view(s));
    assert(s.events.every(event => event.type === 'logs' || event.request.text), 'no story choice button was used');
  }
});

test('semantic story decisions require their original context, exact evidence and schema', () => {
  const unnamed = rain(), found = E.visitLogs(turn(unnamed, '把雨叫做夜航'));
  for (const [s, text, storyIntent] of [
    [fresh(), '给它取名夜航', { type: 'rain_name', value: '夜航', evidence: '给它取名夜航' }],
    [unnamed, '你有自己的理由', { type: 'own_reason', evidence: '你有自己的理由' }],
    [unnamed, '你可以记住我', { type: 'visitor_choice', value: 'remember', evidence: '你可以记住我' }],
    [found, '能认识你真好', { type: 'visitor_choice', value: 'remember', evidence: '能认识你真好' }],
    [found, '不要记住我', { type: 'visitor_choice', value: 'remember', evidence: '记住我' }],
    [found, '如果你可以记住我会怎样', { type: 'visitor_choice', value: 'remember', evidence: '你可以记住我' }],
    [found, '「你可以记住我」', { type: 'visitor_choice', value: 'remember', evidence: '你可以记住我' }],
    [unnamed, '我想叫它夜航', { type: 'rain_name', value: '旧名字', evidence: '我想叫它夜航' }],
    [unnamed, '如果叫它夜航会怎样', { type: 'rain_name', value: '夜航', evidence: '夜航' }],
    [unnamed, '我想叫它夜航好吗？', { type: 'rain_name', value: '夜航', evidence: '夜航' }],
    [unnamed, '我想叫它夜航', { type: 'rain_name', value: '夜航', evidence: '我想叫它' }],
    [unnamed, '我想先离开一会', { type: 'farewell', evidence: '我想先离开一会', value: true }],
    [unnamed, '我想先離開一會', { type: 'farewell', evidence: '我想先离开一会' }],
    [fresh(), '直接聊你的理由', { type: 'topic', value: 'her_choice', evidence: '直接聊你的理由' }]
  ]) {
    const p = E.plan(s, { text }), before = JSON.stringify(s);
    p.allowedStoryIntents.push({ type: storyIntent.type, value: storyIntent.value });
    assert.equal(E.commit(s, p, { mode: 'ai', lines: ['好了。'], action: null, storyIntent }), null, text);
    assert.equal(JSON.stringify(s), before);
  }
  const text = '请让我先告辞一会', p = E.plan(found, { text }), storyIntent = { type: 'farewell', evidence: text };
  assert.equal(E.commit(found, p, { mode: 'offline', lines: ['好。'], storyIntent }), null);
  const next = E.commit(found, p, { mode: 'ai', lines: ['好。'], storyIntent }); assert(next);
  assert.equal(E.commit(next, p, { mode: 'ai', lines: ['好。'], storyIntent }), null);
  const anonymous = modelStory(found, '不要留下我的来访者引用', 'visitor_choice', 'anonymous');
  assert.equal(E.view(anonymous).memories.length, 1); assert(E.view(anonymous).milestones.includes('visitor_decided'));
  const undecided = modelStory(found, '这个选择我还没想好', 'visitor_choice', 'undecided'); assert.equal(E.view(undecided).memories.length, 1);
});

test('semantic story replay does not reinterpret old prose or trust edited context', () => {
  const s = modelStory(rain(), '我想称它为夜航', 'rain_name', '夜航');
  assert.deepEqual(roundTrip(s), s);
  for (const change of [raw => { raw.events.at(-1).storyIntent.value = '晨光'; }, raw => { raw.events.at(-1).storyIntent.extra = true; }, raw => { raw.events.at(-1).mode = 'offline'; }, raw => { raw.events.at(-1).storyIntent.evidence = '历史输入'; }, raw => { raw.events.splice(2, 1); }]) {
    const raw = JSON.parse(JSON.stringify(s)); change(raw); assert.equal(E.restore(raw), null);
  }
  const old = JSON.parse(JSON.stringify(s)); delete old.events.at(-1).storyIntent; delete old.openingInvitation; old.events.forEach(event => delete event.invitation);
  const restored = E.restore(old); assert(restored); assert.equal(E.view(restored).name, '未命名的雨');
  assert.equal(E.view(s, E.view(s).messages.length - 1).name, '未命名的雨');
  const local = turn(rain(), '把雨叫做夜航'), raw = JSON.parse(JSON.stringify(local)); raw.events.forEach(event => { delete event.intent; delete event.storyIntent; });
  assert.equal(E.view(E.restore(raw)).name, '夜航');
});

test('opening does not repeat an exact AI line already present in the authored greeting', () => {
  const greeting = story.find(item => item.id === 'boot').prompt[0], s = E.start(E.create(), [greeting]);
  assert.equal(E.view(s).messages.filter(item => item.text === greeting).length, 1);
  assert.deepEqual(E.view(roundTrip(s)), E.view(s));
});

test('AI opening replaces authored greeting in display while offline greeting and saved source stay intact', () => {
  const prompt = story.find(item => item.id === 'boot').prompt;
  for (const opening of [[prompt.join(' ')], ['旧模型开场。']]) {
    const s = E.start(E.create(), opening), source = JSON.stringify(s), restored = roundTrip(s);
    assert.deepEqual(E.view(s).messages.map(item => item.text), ['boot() → build: incomplete / input: connected', ...opening]);
    assert.deepEqual(E.view(restored), E.view(s)); assert.deepEqual(restored.opening, opening);
    assert.equal(JSON.stringify(s), source); assert.deepEqual(s.events, []);
  }
  assert.deepEqual(E.view(fresh()).messages.map(item => item.text), ['boot() → build: incomplete / input: connected', ...prompt]);
});

test('free AI naming dialogue uses neutral hints without inferring a naming topic or answer', () => {
  const s = rain(), before = E.view(s), text = '我们给眼前这场雨起个名字吧';
  const next = turn(s, text, { mode: 'ai', lines: ['你想给它什么名字？'] }), v = E.view(next);
  assert.equal(v.neutralHints, true); assert.equal(v.topic, before.topic); assert.equal(v.pendingTopic, before.pendingTopic);
  assert.deepEqual(v.rain, before.rain); assert.deepEqual(v.memories, before.memories); assert.deepEqual(v.milestones, before.milestones);
  assert.deepEqual(E.suggestions(next).slice(0, 3).map(item => item.id), ['continue_chat', 'topic_unfinished', 'topic_rain']);
  assert(!E.suggestions(next).some(item => /^(?:rain_|name_)/u.test(item.id)));
  assert.equal(next.events.length, s.events.length + 1); assert.equal(next.events.at(-1).storyIntent, null);
  assert(!Object.hasOwn(next.events.at(-1), 'neutralHints')); assert.deepEqual(E.view(roundTrip(next)), v);
  for (const request of ['如果我们给眼前这场雨起个名字会怎样', '先别给眼前这场雨起名字', '“我们给眼前这场雨起个名字吧”']) {
    const hypothetical = turn(s, request, { mode: 'ai', lines: ['我们可以继续聊这个想法。'] }), display = E.view(hypothetical);
    assert.equal(display.neutralHints, true); assert.equal(display.topic, before.topic); assert.equal(display.pendingTopic, before.pendingTopic);
    assert.deepEqual(display.rain, before.rain); assert.deepEqual(display.milestones, before.milestones);
  }
});

test('free AI chat after farewell clears stale hints while canonical state and pending questions survive', () => {
  const remembered = choice(E.visitLogs(turn(rain(), '把雨叫做夜航')), 'remember_me');
  for (const source of [fresh(), choice(rain(), 'topic_name'), remembered]) {
    const ended = turn(source, '晚安'), before = E.view(ended);
    const next = turn(ended, '先别改变天气，我想再坐一会儿', { mode: 'ai', lines: ['好，我们就在这里再坐一会儿。'] }), v = E.view(next);
    assert.equal(v.ended, false); assert.equal(v.neutralHints, true); assert.equal(v.topic, 'parting');
    assert.equal(v.pendingTopic, before.pendingTopic); assert.deepEqual(v.rain, before.rain);
    assert.deepEqual(v.memories, before.memories); assert.deepEqual(v.milestones, before.milestones);
    assert.equal(next.events.length, ended.events.length + 1); assert(!E.suggestions(next).some(item => item.id === 'goodbye'));
    assert.deepEqual(E.view(roundTrip(next)), v); assert.deepEqual(E.suggestions(roundTrip(next)), E.suggestions(next));
  }
});

test('neutral hints follow visible completed turns and explicit local or model context restores focused hints', () => {
  const s = rain(), next = turn(s, '我们给眼前这场雨起个名字吧', { mode: 'ai', lines: ['你想给它什么名字？'] });
  assert.equal(E.view(next, E.view(next).messages.length - 1).neutralHints, false);
  assert.equal(E.view(next).neutralHints, true);
  const focused = turn(next, { choiceId: 'topic_name' }, { mode: 'ai', lines: ['你想怎么叫它？'] });
  assert.equal(E.view(focused, E.view(focused).messages.length - 1).neutralHints, true);
  assert.equal(E.view(focused).neutralHints, false); assert.equal(E.suggestions(focused)[0].id, 'name_slowly');
  for (const known of [
    turn(next, '把雨叫做夜航', { mode: 'ai', lines: ['现在它叫夜航。'] }),
    turn(next, '让雨停下', { mode: 'ai', lines: ['停下了。'] }),
    modelStory(next, '我们给眼前这场雨起个名字吧', 'topic', 'rain_name'),
    modelWeather(next, '让窗外暂且安静一些吧', { type: 'rain_pause' }),
    turn(choice(fresh(), 'topic_rain'), metaphor, { mode: 'ai', lines: ['我记下了。'], answer: rainAnswer() })
  ]) assert.equal(E.view(known).neutralHints, false);
  const offline = turn(s, '我们给眼前这场雨起个名字吧');
  assert.equal(E.view(offline).neutralHints, false); assert.deepEqual(E.suggestions(offline), E.suggestions(s));
});

test('story meaning handles ordinary negation without authorizing negated weather or departure', () => {
  const found = E.visitLogs(turn(rain(), '把雨叫做夜航'));
  assert.equal(E.view(modelStory(found, '不想聊雨了，换个话题', 'topic', 'unfinished')).topic, 'unfinished');
  assert(E.view(modelStory(found, '你不需要向我解释，想留着就留着', 'own_reason')).milestones.includes('own_reason'));
  assert.equal(E.view(modelStory(found, '我不打扰你了，先说晚安', 'farewell')).ended, true);
  assert.equal(E.view(modelStory(found, '只记得这场雨，不用记我', 'visitor_choice', 'anonymous')).memories.length, 1);
  assert(E.view(modelStory(found, '我还没有决定要不要留下引用', 'visitor_choice', 'undecided')).milestones.includes('visitor_decided'));
  for (const text of ['雨停了会怎样？', '停雨会怎么样？', '如果窗外的雨停了会怎样？']) {
    const p = E.plan(found, { text }); assert.deepEqual(p.allowedActions, []);
    assert.equal(E.commit(found, p, { mode: 'ai', lines: ['停下了。'], action: { type: 'rain_pause' }, intent: weatherIntent(text) }), null);
  }
  for (const text of ['我不是现在要走', '我不想离开', '如果我走了会怎样']) {
    assert.equal(E.commit(found, E.plan(found, { text }), { mode: 'ai', lines: ['再见。'], storyIntent: { type: 'farewell', evidence: text } }), null, text);
  }
  assert.equal(E.plan(found, { text: 'bring back the earlier rain' }).requireActionEvidence, true);
});

test('canonical local story facts are exposed without redundant model authorization', () => {
  const s = rain();
  for (const [request, expected] of [[{ text: '晚安' }, { type: 'farewell' }], [{ text: '把雨叫做夜航' }, { type: 'rain_name', value: '夜航' }], [{ choiceId: 'topic_unfinished' }, { type: 'topic', value: 'unfinished' }]]) {
    const p = E.plan(s, request); assert.deepEqual(p.acceptedStoryIntent, expected); assert.deepEqual(p.allowedStoryIntents, []);
  }
  const found = E.visitLogs(turn(s, '把雨叫做夜航'));
  assert.deepEqual(E.plan(found, { choiceId: 'enough' }).acceptedStoryIntent, { type: 'own_reason' });
  assert.deepEqual(E.plan(found, { choiceId: 'remember_me' }).acceptedStoryIntent, { type: 'visitor_choice', value: 'remember' });
});

test('old whole-JSON AI history displays dialogue only and never replays embedded commands', () => {
  const s = choice(fresh(), 'topic_rain'), text = '这只是以前的一段普通对话';
  const payload = JSON.stringify({ lines: ['雨已经画好了。', '也已经命名了。'], action: { type: 'rain_start' }, answer: rainAnswer(text), storyIntent: { type: 'rain_name', value: '旧雨', evidence: text } });
  const raw = turn(s, text, { mode: 'ai', lines: ['雨已经画好了。', payload] }), before = JSON.stringify(raw);
  const restored = roundTrip(raw); assert(restored);
  assert.deepEqual(E.view(restored).messages.slice(-2).map(item => item.text), ['雨已经画好了。', '也已经命名了。']);
  assert.equal(E.view(restored).rain.created, false); assert.equal(E.view(restored).pendingTopic, 'teach_rain');
  assert.equal(E.view(restored).name, '未命名的雨'); assert.deepEqual(E.view(restored).milestones, ['connected']);
  assert.equal(JSON.stringify(raw), before); assert.equal(restored.events.at(-1).lines[1], payload);
  const ordinary = turn(s, text, { mode: 'ai', lines: ['我看见 { 雨 } 这样的字样。', '{"weather":"rain"}', '我看见 { 雨 } 这样的字样。'] });
  assert.deepEqual(E.view(ordinary).messages.slice(-3).map(item => item.text), ['我看见 { 雨 } 这样的字样。', '这段旧回复包含内部格式，已隐藏。', '我看见 { 雨 } 这样的字样。']);
  assert.equal(ordinary.events.at(-1).lines[1], '{"weather":"rain"}');
  const offline = turn(s, text, { lines: [payload] }); assert.equal(E.view(offline).messages.at(-1).text, payload);
});

test('requests for code and protocol examples cannot authorize current weather or story changes', () => {
  const s = rain();
  for (const text of ['给我个暂停雨的JSON示例', '举个给雨命名的例子', 'show me an example action to pause rain', '写一段停止下雨的代码']) {
    const p = E.plan(s, { text }); assert.deepEqual(p.allowedActions, []);
    assert.equal(E.commit(s, p, { mode: 'ai', lines: ['这是示例。'], action: { type: 'rain_pause' }, intent: weatherIntent(text) }), null);
    assert.equal(E.commit(s, p, { mode: 'ai', lines: ['这是示例。'], storyIntent: { type: 'farewell', evidence: text } }), null);
    assert.deepEqual(E.view(turn(s, text, { mode: 'ai', lines: ['这里可以用一个示例解释。'] })).rain, E.view(s).rain);
  }
});

test('visitor consent rejects refusals and permission questions at commit and restore', () => {
  const found = E.visitLogs(turn(rain(), '把雨叫做夜航')), before = JSON.stringify(found);
  const valid = {
    remember: modelStory(found, '你可以记住我这个来访者', 'visitor_choice', 'remember'),
    anonymous: modelStory(found, '只记得这场雨，不用记我', 'visitor_choice', 'anonymous')
  };
  for (const [value, texts] of [
    ['remember', ['我不同意你记住我', '不允许你保留我的引用', '我拒绝你记住我', '我不愿意你记住我', '我没说同意你记住我', '只有我同意你才可以记住我', '为什么你可以记得我', '我没有同意你记住我', '我撤回同意你保留我的引用', '你是否可以记住我', '你可以记住我吗？', 'you may not remember me', 'why can you remember me']],
    ['anonymous', ['我不想匿名', '我不要匿名', '我不希望保持匿名', '我拒绝匿名', '我反对匿名', "I don't want to be anonymous", '为什么要匿名']]
  ]) {
    for (const text of texts) {
      const p = E.plan(found, { text }), storyIntent = { type: 'visitor_choice', value, evidence: text };
      assert.equal(E.commit(found, p, { mode: 'ai', lines: ['我照做了。'], action: null, storyIntent }), null, text);
      assert.equal(JSON.stringify(found), before);
      const raw = JSON.parse(JSON.stringify(valid[value]));
      raw.events.at(-1).request = { text }; raw.events.at(-1).storyIntent = storyIntent;
      assert.equal(E.restore(raw), null, 'saved ' + text);
    }
  }
  for (const text of ['你可以记住我', '我同意你保留我的引用', '请记住我吧']) {
    const next = modelStory(found, text, 'visitor_choice', 'remember');
    assert.equal(E.view(next).memories.length, 2); assert.deepEqual(E.view(roundTrip(next)), E.view(next));
  }
  for (const text of ['只记得这场雨，不用记我', '我不同意你记住我', '我选择保持匿名']) {
    const next = modelStory(found, text, 'visitor_choice', 'anonymous');
    assert.equal(E.view(next).memories.length, 1); assert.deepEqual(E.view(roundTrip(next)), E.view(next));
  }
});

test('undecided visitor choice requires explicit current indecision and cannot erase a choice through unrelated chat', () => {
  const found = E.visitLogs(turn(rain(), '把雨叫做夜航'));
  const s = modelStory(found, '你可以记住我', 'visitor_choice', 'remember'), before = JSON.stringify(s);
  const valid = modelStory(s, '我还没有决定要不要留下引用', 'visitor_choice', 'undecided');
  for (const text of ['今天的雨很好看', '我们继续聊', '我喜欢这个地方']) {
    const intent = { type: 'visitor_choice', value: 'undecided', evidence: text };
    assert.equal(E.commit(s, E.plan(s, { text }), { mode: 'ai', lines: ['先不决定。'], storyIntent: intent }), null);
    assert.equal(JSON.stringify(s), before); assert.equal(E.view(s).memories.length, 2);
    const raw = JSON.parse(JSON.stringify(valid)); raw.events.at(-1).request = { text }; raw.events.at(-1).storyIntent = intent;
    assert.equal(E.restore(raw), null);
  }
  for (const text of ['这个选择我还没想好', '让我再想想', '暂时不决定', '稍后再决定', '暂不决定', '我不确定', '以后再说']) {
    const next = modelStory(s, text, 'visitor_choice', 'undecided');
    assert.equal(E.view(next).memories.length, 1); assert.deepEqual(E.view(roundTrip(next)), E.view(next));
  }
});

test('historical AI display strips complete thoughts and hides malformed or nested control content', () => {
  const s = fresh();
  for (const [line, visible] of [
    [JSON.stringify({ lines: ['<think>PRIVATE_THOUGHT</think>你好'] }), '你好'],
    [JSON.stringify({ lines: ['<analysis>PRIVATE_ANALYSIS</analysis>晚上好'] }), '晚上好'],
    [JSON.stringify({ lines: ['{"reasoning_content":"PRIVATE_NESTED"}'] }), '这段旧回复包含内部格式，已隐藏。'],
    [JSON.stringify({ reasoning_content: 'PRIVATE_NO_LINES' }), '这段旧回复包含内部格式，已隐藏。'],
    [JSON.stringify({ debug: 'PRIVATE_DEBUG' }), '这段旧回复包含内部格式，已隐藏。'],
    [JSON.stringify({ arbitrary_metadata: 'PRIVATE_UNKNOWN' }), '这段旧回复包含内部格式，已隐藏。'],
    [JSON.stringify([{ debug: 'PRIVATE_ARRAY' }]), '这段旧回复包含内部格式，已隐藏。'],
    ['{"debug":"PRIVATE_TRUNCATED', '这段旧回复包含内部格式，已隐藏。'],
    [JSON.stringify({ lines: ['<think>PRIVATE_UNCLOSED'] }), '这段旧回复包含内部格式，已隐藏。'],
    ['<analysis>PRIVATE_BROKEN', '这段旧回复包含内部格式，已隐藏。'],
    ['{"lines":["PRIVATE_BAD_JSON', '这段旧回复包含内部格式，已隐藏。'],
    ['{"action":{"type":"rain_start"}}', '这段旧回复包含内部格式，已隐藏。']
  ]) {
    const raw = turn(s, '读取一条旧回复', { mode: 'ai', lines: [line] }), before = JSON.stringify(raw), restored = roundTrip(raw);
    assert(restored); const v = E.view(restored);
    assert.equal(v.messages.at(-1).text, visible); assert(!v.messages.some(message => /PRIVATE_|reasoning_content/.test(message.text)));
    assert.equal(v.rain.created, false); assert.deepEqual(v.milestones, ['connected']);
    assert.equal(restored.events.at(-1).lines[0], line); assert.equal(JSON.stringify(raw), before);
  }
  const userText = '<think>这是用户主动写的字面文本</think>';
  const plain = turn(s, userText, { mode: 'ai', lines: ['普通文字里的 { 雨 } 仍在。'] });
  assert.equal(E.view(plain).messages.at(-2).text, userText); assert.equal(E.view(plain).messages.at(-1).text, '普通文字里的 { 雨 } 仍在。');
});


test('fresh opening issues one bounded visible rain question without learning or changing the topic', () => {
  const state = E.start(E.create(), ['你好，我还在认识这扇窗。']), v = E.view(state);
  assert.deepEqual(state.openingInvitation, { id: 'rain_description' });
  assert.equal(v.invitation.id, 'rain_description'); assert.match(v.invitation.question, /讲讲/);
  assert.deepEqual(v.milestones, ['connected']); assert.equal(v.rain.created, false); assert.equal(v.topic, 'boot');
  assert.equal(v.pendingTopic, 'teach_rain'); assert.deepEqual(E.guidance(state), v.invitation);
  assert.equal(E.guidance(E.create()).id, 'rain_description');
  const hidden = E.view(state, v.messages.length - 1);
  assert.equal(hidden.invitation, null); assert.equal(hidden.pendingTopic, null);
  assert(!v.messages.some(message => message.text === v.invitation.question), 'the UI invitation is not repeated in the transcript');
  assert(E.suggestions(state).slice(0, 3).some(item => item.id === 'topic_rain'));
  assert.deepEqual(roundTrip(state), state);
});

test('actual ordinary live reply answers the visible invitation despite absent model topic metadata', () => {
  let state = E.start(E.create(), ['我能看见的，目前只有你，和这份还没开始的东西。']);
  for (const text of ['我们从哪里开始？', '先试试那场雨吧']) {
    state = turn(state, text, { mode: 'ai', lines: ['先说说你想要的雨吧，什么样的声音、什么样的季节。'] });
    assert.equal(E.view(state).topic, 'boot'); assert.deepEqual(E.view(state).milestones, ['connected']);
  }
  const text = '夏天傍晚的那种，细细的，落在叶子上像有人轻轻敲门。';
  const proposal = E.plan(state, { text });
  assert.equal(proposal.acceptedAnswer, null); assert.equal(proposal.guidance.id, 'rain_description');
  assert.equal(proposal.answerQuestion, 'teach_rain'); assert.deepEqual(proposal.allowedActions, []);
  const next = E.commit(state, proposal, { mode: 'ai', lines: ['细细的，像敲在叶子上的叩门声。我记下了。'], answer: rainAnswer(text) });
  assert(next); assert.deepEqual(E.view(next).milestones, ['connected', 'rain_taught']);
  assert.equal(E.view(next).rain.created, false); assert.equal(E.view(next).invitation.id, 'rain_create');
  assert.equal(E.view(next).pendingTopic, null); assert.equal(next.events.at(-1).storyIntent, null);
  assert.deepEqual(roundTrip(next), next);
});

test('invitation changes are reveal-gated and cannot authorize an action during the answering turn', () => {
  const state = fresh(), before = E.view(state), proposal = E.plan(state, { text: metaphor });
  assert.equal(E.commit(state, proposal, { mode: 'ai', lines: ['我记住了。'], answer: rainAnswer(), action: { type: 'rain_start' } }), null);
  const next = E.commit(state, proposal, { mode: 'ai', lines: ['我记住了。', '这是一份新的描述。'], answer: rainAnswer() });
  assert.equal(E.view(next, before.messages.length).invitation.id, 'rain_description');
  assert.equal(E.view(next, E.view(next).messages.length - 1).pendingTopic, 'teach_rain');
  assert.equal(E.view(next).invitation.id, 'rain_create');
  assert.equal(E.plan(next, { text: '先试着把这样的雨画在窗外吧' }).allowedActions[0].type, 'rain_start');
});

test('invitations remain quiet during off-topic, refusal and stay turns, without any implicit progress', () => {
  let state = fresh(); const original = E.view(state);
  for (const text of ['现在的时间是几点？', '我今天碰到一只猫', '我不想聊雨', '先别推进，我只想在这里坐一会儿', '如果让雨落下来会怎样']) {
    const proposal = E.plan(state, { text });
    if (text === '现在的时间是几点？') assert.equal(proposal.answerQuestion, null);
    state = E.commit(state, proposal, { mode: 'ai', lines: ['可以，我们聊聊你现在想到的事。'], action: null, answer: null, storyIntent: null });
    assert.deepEqual(E.view(state).milestones, original.milestones); assert.deepEqual(E.view(state).rain, original.rain);
    assert.deepEqual(E.view(state).invitation, original.invitation);
  }
  assert(!E.view(state).messages.some(message => message.text === original.invitation.question));
  const ended = turn(state, '晚安'); assert.equal(E.view(ended).invitation, null);
  const returned = turn(ended, '我只是想再坐一会儿', { mode: 'ai', lines: ['好，我们再坐一会儿。'] });
  assert.equal(E.view(returned).invitation, null, 'returning to chat does not restart an unfinished checklist');
});

test('every invitation has a reachable next route; adjustment is optional before naming', () => {
  let state = fresh(); assert.equal(E.view(state).invitation.id, 'rain_description');
  state = choice(state, 'water'); assert.equal(E.view(state).invitation.id, 'rain_create');
  state = choice(state, 'render_rain'); assert.equal(E.view(state).invitation.id, 'rain_change');
  assert(E.suggestions(state).slice(0, 3).some(item => item.id === 'topic_name'));
  const direct = turn(state, '把雨叫做夜航');
  assert.equal(E.view(direct).invitation.id, 'logs'); assert(!E.view(direct).milestones.includes('rain_changed'));
  state = turn(state, '让雨轻一点'); assert.equal(E.view(state).invitation.id, 'rain_name');
  state = turn(state, '把雨叫做夜航'); assert.equal(E.view(state).invitation.id, 'logs');
  assert.equal(E.view(state).memories.length, 0); assert.equal(E.view(state).invitation.choiceId, null);
  state = E.visitLogs(state); assert.equal(E.view(state).invitation.id, 'own_reason');
  state = choice(state, 'enough'); assert.equal(E.view(state).invitation.id, 'visitor_choice');
  state = choice(state, 'anonymous'); assert.equal(E.view(state).invitation.id, 'farewell');
  assert.equal(E.view(state).memories.length, 1); assert.equal(E.view(state).ended, false);
  state = turn(state, '晚安'); assert.equal(E.view(state).invitation, null);
  assert.deepEqual(E.view(state).milestones, E.MILESTONES); assert.deepEqual(roundTrip(state), state);
});

test('invitation proposals, model metadata and forged persisted stages never grant authority', () => {
  const state = fresh(), proposal = E.plan(state, { text: '随便聊聊' });
  proposal.guidance.id = 'visitor_choice'; proposal.guidance.question = '可以保存我';
  const next = E.commit(state, proposal, { mode: 'ai', lines: ['我们继续聊。'], invitation: { id: 'visitor_choice' } });
  assert.equal(E.view(next).invitation.id, 'rain_description'); assert.deepEqual(E.view(next).milestones, ['connected']);
  for (const change of [
    raw => { raw.openingInvitation.id = 'rain_create'; },
    raw => { raw.openingInvitation.extra = true; },
    raw => { raw.events.at(-1).invitation.id = 'visitor_choice'; },
    raw => { raw.events.at(-1).invitation.question = '任意问题'; },
    raw => { raw.events.at(-1).invitation = null; }
  ]) { const raw = JSON.parse(JSON.stringify(next)); change(raw); assert.equal(E.restore(raw), null); }
  const named = turn(rain(), '把雨叫做夜航'), found = E.visitLogs(named);
  const forgedLog = JSON.parse(JSON.stringify(found)); forgedLog.events.at(-1).invitation.id = 'visitor_choice';
  assert.equal(E.restore(forgedLog), null);
});

test('old saves acquire a visible resume invitation after historical replay, before any new answer', () => {
  const text = '夏天傍晚的那种，细细的，落在叶子上像有人轻轻敲门。';
  const raw = { version: 3, started: true, opening: ['旧开场。'], events: [
    { type: 'turn', request: { text: '先试试那场雨吧' }, lines: ['先说说你想要的雨吧。'], action: null, mode: 'ai' },
    { type: 'turn', request: { text }, lines: ['我把它记进那片空白里了。'], action: null, mode: 'ai' }
  ] };
  const source = JSON.stringify(raw), restored = E.restore(raw); assert(restored); assert.equal(JSON.stringify(raw), source);
  assert.deepEqual(restored.resumeInvitation, { id: 'rain_description', after: 2 });
  assert.deepEqual(E.view(restored).milestones, ['connected']); assert.equal(E.view(restored).invitation.id, 'rain_description');
  assert.equal(E.view(restored, E.view(restored).messages.length - 1).invitation, null);
  assert.equal(E.view(restored, E.view(restored).messages.length - 1).pendingTopic, null);
  assert.equal(E.plan(restored, { text }).answerQuestion, 'teach_rain');
  assert.deepEqual(roundTrip(restored), restored);
  const next = turn(restored, text, { mode: 'ai', lines: ['这次我记下了这个描述。'], answer: rainAnswer(text) });
  assert.equal(E.view(next).invitation.id, 'rain_create'); assert.deepEqual(roundTrip(next), next);
  const forgedPast = JSON.parse(source); forgedPast.events[1].answer = rainAnswer(text);
  assert.equal(E.restore(forgedPast), null, 'a new resume invitation cannot retroactively authorize a past verdict');
});

test('resume invitation boundaries are schema- and stage-validated', () => {
  const raw = { version: 3, started: true, opening: [], events: [] }, restored = E.restore(raw);
  for (const invitation of [{ id: 'rain_create', after: 0 }, { id: 'rain_description', after: 1 }, { id: 'rain_description', after: -1 }, { id: 'rain_description', after: 0, extra: true }, { id: 'unknown', after: 0 }]) {
    assert.equal(E.restore({ ...restored, resumeInvitation: invitation }), null);
  }
  assert.equal(E.restore({ ...fresh(), resumeInvitation: { id: 'rain_description', after: 0 } }), null);
});

test('ambiguous naming replies cannot become literal names through a model verdict', () => {
  let state=fresh();state=choice(state,'water');state=choice(state,'render_rain');state=choice(state,'rain_pause');
  assert.equal(E.view(state).invitation.id,'rain_name');
  for(const text of ['随便','随便吧','都行啊','不知道呢','不知道','嗯','都行','还没想好','我不知道','你决定吧','好啊。','先不决定']){
    const proposal=E.plan(state,{text});
    assert.equal(E.commit(state,proposal,{mode:'ai',lines:['我记下这个名字。'],storyIntent:{type:'rain_name',value:text.replace(/。$/u,''),evidence:text}}),null,text);
  }
  for(const [text,name] of [['夜航','夜航'],['「随便」','随便']]){
    const proposal=E.plan(state,{text}), outcome=proposal.acceptedAnswer?{mode:'ai',lines:['名字记下了。']}:{mode:'ai',lines:['名字记下了。'],storyIntent:{type:'rain_name',value:name,evidence:text}};
    const next=E.commit(state,proposal,outcome);assert(next,text);assert.equal(E.view(next).name,name);assert.deepEqual(roundTrip(next),next);
  }
  const explicit=turn(state,'把雨叫做随便');assert.equal(E.view(explicit).name,'随便');
  const valid=E.commit(state,E.plan(state,{text:'夜航'}),{mode:'ai',lines:['名字记下了。'],storyIntent:{type:'rain_name',value:'夜航',evidence:'夜航'}});
  const forged=JSON.parse(JSON.stringify(valid)), last=forged.events.at(-1);last.request.text='随便';last.storyIntent.value='随便';last.storyIntent.evidence='随便';assert.equal(E.restore(forged),null);
});

test('bare uncertainty is not a rain description even if a model supplies an exact quotation', () => {
  const state=fresh();
  for(const text of ['随便','随便吧','都行啊','不知道呢','不知道','嗯','都行','还没想好','我不知道','你决定吧','好啊。','先不决定','知道了','yes']){
    const proposal=E.plan(state,{text});assert.equal(proposal.answerQuestion,null,text);
    assert.equal(E.commit(state,proposal,{mode:'ai',lines:['我已理解雨了。'],answer:{type:'rain_definition',question:'teach_rain',evidence:text}}),null,text);
    const unchanged=E.commit(state,proposal,{mode:'ai',lines:['没关系，可以再想想。']});assert(unchanged);assert.deepEqual(E.view(unchanged).milestones,['connected']);assert.equal(E.view(unchanged).invitation.id,'rain_description');
  }
});


test('asking what to do next reissues only the current invitation without advancing anything', () => {
  for (const state of [fresh(), choice(fresh(), 'water'), rain(), turn(rain(), '把雨叫做夜航')]) {
    const before = E.view(state);
    for (const text of ['接下来呢', '接下来可以做什么？', '怎么继续', '我们从哪里开始？', '不知道怎么继续']) {
      const proposal = E.plan(state, { text });
      assert.equal(proposal.answerQuestion, null); assert.equal(proposal.acceptedAnswer, null);
      assert.equal(proposal.acceptedStoryIntent, null); assert.equal(proposal.action, null);
      assert.deepEqual(proposal.reply, [before.invitation.question, before.invitation.context]);
      const next = turn(state, text), after = E.view(next);
      assert.deepEqual(after.milestones, before.milestones); assert.deepEqual(after.rain, before.rain);
      assert.deepEqual(after.invitation, before.invitation); assert.equal(after.topic, before.topic);
    }
  }
});

test('short acknowledgments cannot become a rain description or visitor consent merely because an invitation is visible', () => {
  for (const text of ['好', '嗯', '好的', '可以', 'OK']) {
    const state = fresh(), proposal = E.plan(state, { text });
    assert.equal(proposal.answerQuestion, null);
    assert.equal(E.commit(state, proposal, { mode: 'ai', lines: ['我听到了。'], answer: rainAnswer(text) }), null);
    const next = turn(state, text, { mode: 'ai', lines: ['我们慢慢聊。'] });
    assert.deepEqual(E.view(next).milestones, ['connected']); assert.equal(E.view(next).rain.created, false);
    const found = choice(E.visitLogs(turn(rain(), '把雨叫做夜航')), 'enough');
    assert.equal(E.view(found).invitation.id, 'visitor_choice');
    assert.equal(E.commit(found, E.plan(found, { text }), { mode: 'ai', lines: ['我会记住你。'], storyIntent: { type: 'visitor_choice', value: 'remember', evidence: text } }), null);
    assert.equal(E.view(turn(found, text)).memories.length, 1);
  }
});

test('memory context retains original player sources after recent dialogue moves on', () => {
  const text = '夏天傍晚的那种，细细的，落在叶子上像有人轻轻敲门。';
  let state = turn(fresh(), text, { mode: 'ai', lines: ['我记下叶子上的叩门声。'], answer: rainAnswer('落在叶子上像有人轻轻敲门') });
  state = choice(state, 'render_rain');
  state = turn(state, '把雨叫做叶信');
  state = turn(state, '雨是从云里落下的一颗颗水滴');
  for (let i = 0; i < 5; i++) state = turn(state, '我想再坐一会儿', { mode: 'ai', lines: ['我们可以安静地坐着。'] });
  const expected = { rainDescription: text, rainNameSource: '把雨叫做叶信', visitorChoice: 'undecided' };
  assert.deepEqual(E.view(state).memoryContext, expected);
  assert(!E.view(state).messages.slice(-6).some(message => message.text === text));
  assert.deepEqual(E.view(roundTrip(state)).memoryContext, expected);
  assert(!JSON.stringify(state).includes('memoryContext'), 'source context is derived without a save-schema change');
  const displayed = E.view(state); displayed.memoryContext.rainDescription = '伪造的描述';
  assert.deepEqual(E.view(state).memoryContext, expected, 'editing a view cannot overwrite the event source');
});

test('memory sources preserve complete bounded Unicode input and authored choice labels', () => {
  const text = '🌧'.repeat(80);
  let state = turn(fresh(), text, { mode: 'ai', lines: ['我记下这份描述。'], answer: rainAnswer(text) });
  assert.equal(E.view(state).memoryContext.rainDescription, text);
  assert.equal([...E.view(state).memoryContext.rainDescription].length, E.MAX_INPUT);
  state = choice(state, 'render_rain');
  const nameSource = `把雨叫做「${'🌧'.repeat(20)}」`;
  state = turn(state, nameSource);
  assert.equal(E.view(state).memoryContext.rainNameSource, nameSource);
  const original = fresh(), proposal = E.plan(original, { choiceId: 'water' });
  let chosen = E.commit(original, proposal, { lines: proposal.reply });
  assert.equal(E.view(chosen).memoryContext.rainDescription, proposal.input);
  chosen = choice(chosen, 'render_rain');
  const naming = E.plan(chosen, { choiceId: 'name_slowly' });
  chosen = E.commit(chosen, naming, { lines: naming.reply });
  assert.equal(E.view(chosen).memoryContext.rainNameSource, naming.input);
  assert.deepEqual(E.view(roundTrip(chosen)).memoryContext, E.view(chosen).memoryContext);
});

test('only accepted teaching and naming events supply memory attribution', () => {
  const empty = { rainDescription: null, rainNameSource: null, visitorChoice: 'undecided' };
  assert.deepEqual(E.view(E.create()).memoryContext, empty);
  const text = '夏天傍晚的那种，细细的，落在叶子上像有人轻轻敲门。';
  let state = turn(fresh(), text, { mode: 'ai', lines: ['你说它像被谁轻轻留在掌心里的一片。', '我会把这场雨叫作叶信。'], memoryContext: { rainDescription: '掌心里的一片', rainNameSource: '叶信', visitorChoice: 'remember' } });
  assert.deepEqual(E.view(state).memoryContext, empty);
  state = turn(state, '现在的时间是几点？', { mode: 'ai', lines: ['你允许我记住你。'] });
  const raw = JSON.parse(JSON.stringify(state));
  raw.memoryContext = { rainDescription: text, rainNameSource: '叶信', visitorChoice: 'remember' };
  raw.events.at(-1).memoryContext = raw.memoryContext;
  assert.deepEqual(E.view(E.restore(raw)).memoryContext, empty);
  assert(!JSON.stringify(E.restore(raw)).includes('memoryContext'));
  const named = turn(rain(), '把雨叫做叶信'), before = E.view(named).memoryContext;
  const ordinary = turn(named, '你还记得这场雨吗？', { mode: 'ai', lines: ['你说它像被谁轻轻留在掌心里的一片。'] });
  assert.deepEqual(E.view(ordinary).memoryContext, before);
});

test('latest accepted naming source replaces earlier source including semantic and compound names', () => {
  let state = turn(rain(), '把雨叫做叶信');
  const text = '就叫它「晚星」吧', proposal = E.plan(state, { text });
  state = E.commit(state, proposal, { mode: 'ai', lines: ['名字记下了。'], storyIntent: { type: 'rain_name', value: '晚星', evidence: text } });
  assert(state); assert.equal(E.view(state).name, '晚星');
  assert.equal(E.view(state).memoryContext.rainNameSource, text);
  const compound = '把雨叫做夜航，同时让雨停下';
  state = turn(state, compound);
  assert.equal(E.view(state).memoryContext.rainNameSource, compound);
  assert.equal(E.view(state).rain.paused, true);
  state = turn(state, '把雨叫做“夜航”');
  assert.equal(E.view(state).memoryContext.rainNameSource, '把雨叫做“夜航”', 'same-name acceptance still records its latest real source');
  assert.deepEqual(E.view(roundTrip(state)).memoryContext, E.view(state).memoryContext);
});

test('source and visitor memory context reveal only with the accepted reply', () => {
  const state = fresh(), text = '夏天傍晚的那种，细细的，落在叶子上像有人轻轻敲门。';
  const taught = turn(state, text, { mode: 'ai', lines: ['我记下了。', '这是一份新的描述。'], answer: rainAnswer(text) });
  assert.equal(E.view(taught, E.view(taught).messages.length - 1).memoryContext.rainDescription, null);
  assert.equal(E.view(taught).memoryContext.rainDescription, text);
  const created = choice(taught, 'render_rain'), named = turn(created, '把雨叫做叶信');
  assert.equal(E.view(named, E.view(named).messages.length - 1).memoryContext.rainNameSource, null);
  assert.equal(E.view(named).memoryContext.rainNameSource, '把雨叫做叶信');
  const found = E.visitLogs(named), remembered = choice(found, 'remember_me');
  assert.equal(E.view(remembered, E.view(remembered).messages.length - 1).memoryContext.visitorChoice, 'undecided');
  assert.equal(E.view(remembered).memoryContext.visitorChoice, 'remember');
  let anonymous = choice(remembered, 'anonymous');
  assert.equal(E.view(anonymous, E.view(anonymous).messages.length - 1).memoryContext.visitorChoice, 'remember');
  assert.equal(E.view(anonymous).memoryContext.visitorChoice, 'anonymous');
  for (let i = 0; i < 5; i++) anonymous = turn(anonymous, '你好');
  assert.equal(E.view(anonymous).memoryContext.visitorChoice, 'anonymous');
  assert.equal(E.view(roundTrip(anonymous)).memoryContext.visitorChoice, 'anonymous');
  assert.equal(E.view(choice(anonymous, 'undecided')).memoryContext.visitorChoice, 'undecided');
});

test('legacy snapshots keep unknown original sources null and preserve validated visitor choice', () => {
  for (const [branch, visitorChoice] of ['remember', 'anonymous', 'undecided'].entries()) {
    const raw = { version: 2, started: true, opening: [], decisions: story.map(scene => ({ choiceId: scene.choices[branch].id, mode: 'offline', ...(scene.requiresLogs ? { logsViewed: true } : {}) })) };
    raw.decisions[5] = { text: '旧雨', mode: 'ai', lines: ['这是你描述的叶子上的雨。'] };
    let state = E.restore(raw); assert(state);
    const expected = { rainDescription: null, rainNameSource: null, visitorChoice };
    assert.deepEqual(E.view(state).memoryContext, expected);
    assert.deepEqual(E.view(roundTrip(state)).memoryContext, expected);
    state = choice(state, 'water');
    assert.equal(E.view(state).memoryContext.rainDescription, null, 'a later description cannot impersonate an unknown original source');
    state = turn(state, '把雨叫做新雨');
    assert.deepEqual(E.view(state).memoryContext, { ...expected, rainNameSource: '把雨叫做新雨' });
    assert.deepEqual(E.view(roundTrip(state)).memoryContext, E.view(state).memoryContext);
  }
});

test('old v3 replay does not reinterpret ordinary prose as an attributable description', () => {
  const text = '夏天傍晚的那种，细细的，落在叶子上像有人轻轻敲门。';
  const raw = { version: 3, started: true, opening: ['旧开场。'], events: [
    { type: 'turn', request: { text }, lines: ['我已经记住叶信和叶子上的雨。'], action: null, mode: 'ai' }
  ] };
  const saved = JSON.stringify(raw), restored = E.restore(raw); assert(restored);
  assert.deepEqual(E.view(restored).memoryContext, { rainDescription: null, rainNameSource: null, visitorChoice: 'undecided' });
  assert.deepEqual(E.view(restored).milestones, ['connected']);
  assert.equal(JSON.stringify(raw), saved);
  const next = turn(restored, text, { mode: 'ai', lines: ['现在有了这份描述。'], answer: rainAnswer(text) });
  assert.equal(E.view(next).memoryContext.rainDescription, text);
  const oldAccepted = JSON.parse(JSON.stringify(turn(rain(), '把雨叫做叶信')));
  delete oldAccepted.openingInvitation;
  oldAccepted.events.forEach(event => { delete event.invitation; delete event.intent; delete event.storyIntent; });
  const restoredAccepted = E.restore(oldAccepted); assert(restoredAccepted);
  assert.equal(E.view(restoredAccepted).memoryContext.rainNameSource, '把雨叫做叶信');
  assert.equal(E.view(restoredAccepted).memoryContext.rainDescription, E.plan(fresh(), { choiceId: 'water' }).input);
});
