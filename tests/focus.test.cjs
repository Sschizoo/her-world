const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const Focus = require('../focus.js');
const source = fs.readFileSync(path.join(__dirname, '../focus.js'), 'utf8');
const find = (rows, id) => rows.find(row => row.id === id);
const message = (text, index = 0, role = 'her') => ({ role, text, index });

test('visible created objects become focus subjects and follow actual object conversation', () => {
  const object={id:'obj_1',label:'双人长椅',source:{createdBy:'画一张双人长椅',lastChangedBy:'把长椅移到窗边'}};
  const scene={objects:[object]};
  assert(!Focus.calculate({messages:[message('我想画双人长椅')]}).some(row=>row.id==='object:obj_1'));
  const before=Focus.calculate({scene,messages:[message('窗外的雨。')]});
  const after=Focus.calculate({scene,messages:[message('窗外的雨。'),message('把长椅移到窗边',1,'user'),message('双人长椅就在这里。',1)]});
  assert(find(after,'object:obj_1').score>find(before,'object:obj_1').score);assert.equal(after.reduce((sum,row)=>sum+row.percent,0),100);
  assert.equal(find(after,'object:obj_1').label,'双人长椅');
});

test('object focus is bounded, deterministic and does not leak an unrevealed creation', () => {
  const objects=Array.from({length:10},(_,i)=>({id:`obj_${i+1}`,label:`物件${i+1}`,source:{createdBy:`创建物件${i+1}`,lastChangedBy:`创建物件${i+1}`}}));
  const input={scene:{objects},messages:[message('物件1、物件2在这里。')]}, first=Focus.calculate(input);
  assert(first.length<=4);assert.equal(first.reduce((sum,row)=>sum+row.percent,0),100);assert.deepEqual(Focus.calculate(input),first);
  assert.deepEqual(Focus.calculate({scene:{objects:[]},messages:[{...message('创建物件1',1,'user'),transient:true}]}),[]);
});

test('UMD exposes one pure browser/CommonJS calculation API', () => {
  const window = {};
  vm.runInNewContext(source, { window });
  assert.equal(typeof window.HerFocus.calculate, 'function');
  assert.deepEqual(Object.keys(Focus), ['calculate']);
});

test('unseen entities and future topics are absent, including the default rain name', () => {
  for (const topic of ['rain', 'teach_rain', 'rain_name', 'window', 'visitor_reference', 'unfinished']) {
    assert.deepEqual(Focus.calculate({ messages: [], topic, rain: { created: false }, name: '未命名的雨', milestones: [] }), []);
  }
  assert.deepEqual(Focus.calculate({ messages: [message('……启动完成。')], topic: 'rain_name' }), []);
});

test('only completed dialogue is considered, not transient, pending, partial or system lines', () => {
  const messages = [
    { ...message('雨'), transient: true }, { ...message('窗'), incomplete: true },
    { ...message('名字'), pending: true }, { ...message('来访者'), complete: false },
    { ...message('未完成'), completed: false }, message('rain name visitor incomplete', 0, 'system')
  ];
  assert.deepEqual(Focus.calculate({ messages }), []);
});

test('one encountered subject receives 100%, without invented companions', () => {
  assert.deepEqual(Focus.calculate({ messages: [message('窗还亮着。')] }), [
    { id: 'window', label: '窗', score: 1.58, percent: 100, bar: '--------------------' }
  ]);
});

test('integer percentages sum to 100 and display only four encountered entities', () => {
  const rows = Focus.calculate({ messages: [message('你看，未完成的窗外，雨有了名字。')] });
  assert.equal(rows.length, 4);
  assert.equal(rows.reduce((sum, row) => sum + row.percent, 0), 100);
  assert(rows.every(row => Number.isInteger(row.percent) && row.percent >= 0 && row.percent <= 100));
  assert.deepEqual(rows.map(row => row.id), ['rain', 'window', 'name', 'player']);
});

test('equal evidence uses a stable entity order and stable rounding', () => {
  const input = { messages: [message('雨、窗、名字。')] };
  const rows = Focus.calculate(input);
  assert.deepEqual(rows.map(row => [row.id, row.percent]), [['rain', 34], ['window', 33], ['name', 33]]);
  for (let n = 0; n < 50; n++) assert.deepEqual(Focus.calculate(input), rows);
});

test('visible executed rain establishes evidence; unexecuted density fields do not', () => {
  assert.deepEqual(Focus.calculate({ rain: { created: false, density: 'heavy', paused: false } }), []);
  const rows = Focus.calculate({ rain: { created: true, density: 'normal', paused: false } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'rain');
  assert.equal(rows[0].percent, 100);
});

test('executed rain command raises rain focus over the preceding window discussion', () => {
  const before = { messages: [message('窗外的雨。')], rain: { created: true, density: 'normal' } };
  const after = { messages: [...before.messages, message('让雨更密一点', 1, 'user'), message('雨变密了。', 1)], rain: { created: true, density: 'heavy' } };
  assert(find(Focus.calculate(after), 'rain').percent > find(Focus.calculate(before), 'rain').percent);
});

test('stopping and resuming rain keep the topic earned and respond to executed dialogue', () => {
  const original = { messages: [message('窗外的雨。')], rain: { created: true, density: 'normal' } };
  const stopped = { messages: [...original.messages, message('停雨。', 1, 'user'), message('雨停下了。', 1)], rain: { created: true, density: 'normal', paused: true } };
  const resumed = { messages: [...stopped.messages, message('再下起雨来。', 2, 'user'), message('雨又落下了。', 2)], rain: { created: true, density: 'normal', paused: false } };
  assert(find(Focus.calculate(stopped), 'rain').percent > find(Focus.calculate(original), 'rain').percent);
  assert(find(Focus.calculate(resumed), 'rain'));
});

test('naming and recalling the assigned name raise name/player from earned context', () => {
  const before = { name: '夜航', messages: [message('你给这场雨起了名字。'), message('雨还在窗外落下。', 1)], rain: { created: true } };
  const after = { ...before, messages: [...before.messages, message('我记得夜航，是我取的名字。', 2, 'user'), message('夜航。我记得你给它取的名字。', 2)] };
  const older = Focus.calculate(before), recent = Focus.calculate(after);
  assert(find(recent, 'name').percent > find(older, 'name').percent);
  assert(find(recent, 'player').percent > find(older, 'player').percent);
});

test('a saved assigned name can be recalled literally without keyword matching', () => {
  const rows = Focus.calculate({ name: '[夜航].*', messages: [message('[夜航].*。')] });
  assert.equal(rows[0].id, 'name');
  assert.equal(rows[0].percent, 100);
  assert(!find(Focus.calculate({ name: '[夜航].*', messages: [message('无关的文字。')] }), 'rain'));
});

test('stale topics lose relative and absolute influence as newer turns arrive', () => {
  const before = { messages: [message('窗。', 0), message('雨。', 1)] };
  const after = { messages: [...before.messages, ...Array.from({ length: 8 }, (_, n) => message('雨。', n + 2))] };
  assert(find(Focus.calculate(after), 'window').score < find(Focus.calculate(before), 'window').score);
  assert(find(Focus.calculate(after), 'window').percent < find(Focus.calculate(before), 'window').percent);
});

test('a pending question is weak evidence and topic alone cannot flood the bars', () => {
  const input = { messages: [message('雨、雨、雨。', 0), message('你想起什么名字了吗？', 1)], rain: { created: true }, topic: 'rain_name' };
  const rows = Focus.calculate(input);
  assert(find(rows, 'rain').percent > find(rows, 'name').percent);
  const withoutTopic = Focus.calculate({ ...input, topic: null });
  assert(Math.abs(find(rows, 'name').score - find(withoutTopic, 'name').score - .2) < 1e-8);
});

test('repetition, line splitting and very long histories cannot create unbounded scores', () => {
  const short = Focus.calculate({ messages: [message('雨。')] });
  const repeated = Focus.calculate({ messages: [message('雨'.repeat(10000))] });
  assert.deepEqual(short, repeated);
  const rows = Focus.calculate({ messages: Array.from({ length: 1000 }, (_, n) => message('雨、窗、名字、来访者、未完成。', Math.floor(n / 20))) });
  assert(rows.every(row => Number.isFinite(row.score) && row.score > 0 && row.score <= 12));
  assert.equal(rows.reduce((sum, row) => sum + row.percent, 0), 100);
});

test('bars are thin, fixed-width printable ASCII, with no SVG or neural-attention data', () => {
  const rows = Focus.calculate({ messages: [message('雨和窗。')] });
  assert(rows.every(row => /^[.-]{20}$/.test(row.bar)));
  assert.deepEqual(Object.keys(rows[0]), ['id', 'label', 'score', 'percent', 'bar']);
});

test('calculation does not mutate input or depend on time, animation or randomness', () => {
  const input = { messages: [message('窗边的雨。')], rain: { created: true, paused: true }, name: '未命名的雨', milestones: ['unfinished'] };
  const original = JSON.stringify(input);
  const fakeMath = Object.create(Math);
  fakeMath.random = () => { throw new Error('randomness forbidden'); };
  const window = {};
  vm.runInNewContext(source, { window, Math: fakeMath, Date: class { constructor() { throw new Error('time forbidden'); } } });
  const output = window.HerFocus.calculate(input);
  assert.equal(JSON.stringify(output), JSON.stringify(Focus.calculate(input)));
  assert.equal(JSON.stringify(input), original);
});

test('invalid inputs are harmless and unknown milestone names do not reveal topics', () => {
  for (const value of [undefined, null, false, 'rain', 8]) assert.deepEqual(Focus.calculate(value), []);
  assert.deepEqual(Focus.calculate({ messages: [null, {}, 'rain'], milestones: ['future_rain_name', { id: 'rain_name' }], topic: 'name' }), []);
});

test('authored unfinished-world wording earns that topic without future state', () => {
  const rows = Focus.calculate({ messages: [message('聊聊没做完的世界', 1, 'user'), message('最后一次修改停在“以后再写”。', 1), message('没做完的地方，该怎么办？', 1)], topic: 'unfinished' });
  assert.equal(rows[0].id, 'unfinished');
  assert(!find(rows, 'rain'));
  assert(!find(rows, 'name'));
});

test('completed naming milestone preserves an intentional default name', () => {
  assert.deepEqual(Focus.calculate({ name: '未命名的雨' }), []);
  const rows = Focus.calculate({ name: '未命名的雨', milestones: ['rain_named'] });
  assert.equal(rows[0].id, 'name');
  assert(!find(rows, 'rain'));
});

test('engine visible-view and completed-message cutoff prevent later names and rain from leaking', () => {
  const Engine = require('../engine.js');
  let state = Engine.start(Engine.create());
  const through = Engine.view(state).messages.length;
  for (const choiceId of ['topic_rain', 'water', 'render_rain', 'name_slowly']) {
    const proposal = Engine.plan(state, { choiceId });
    assert(proposal);
    state = Engine.commit(state, proposal, { lines: proposal.reply, action: proposal.action });
    assert(state);
  }
  const past = Engine.view(state, through);
  const rows = Focus.calculate({ ...past, messages: past.messages.slice(0, through) });
  assert.equal(past.rain.created, false);
  assert(!find(rows, 'rain'));
  assert(!find(rows, 'name'));
  const fullRows = Focus.calculate(Engine.view(state));
  assert(find(fullRows, 'rain'));
  assert(find(fullRows, 'name'));
});
