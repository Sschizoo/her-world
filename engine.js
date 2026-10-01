/* Her World — bounded, event-derived conversation and weather state. No IO. */
(function (root, factory) {
  const engine = factory(typeof module === 'object' && module.exports ? require('./story.js') : root.HER_STORY);
  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (root) root.HerEngine = engine;
})(typeof window !== 'undefined' ? window : null, function (STORY) {
  'use strict';
  const MAX_EVENTS = 200, MAX_INPUT = 80, MAX_LINES = 3, MAX_LINE = 500;
  const MILESTONES = ['connected', 'rain_taught', 'rain_created', 'rain_changed', 'rain_named', 'memory_found', 'own_reason', 'visitor_decided', 'farewell'];
  const TOPICS = ['boot', 'unfinished', 'teach_rain', 'first_drop', 'modify_rain', 'rain_name', 'shared_silence', 'memory_discovery', 'her_choice', 'visitor_reference', 'parting', 'invitation'];
  const DENSITIES = ['gentle', 'normal', 'heavy'];
  const plans = new WeakMap();
  const clean = value => typeof value === 'string' ? value.normalize('NFC').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').trim() : '';
  const count = value => [...value].length;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const interpolate = (text, name) => String(text).split('{{rainName}}').join(name || '未命名的雨');
  const copy = value => JSON.parse(JSON.stringify(value));
  const validLines = (value, empty = true) => Array.isArray(value) && value.length <= MAX_LINES && (empty || value.length > 0) && value.every(line => typeof line === 'string' && clean(line) && count(line) <= MAX_LINE);
  const scene = id => (STORY || []).find(item => item.id === id);
  const authored = (topic, choiceId) => scene(topic)?.choices.find(item => item.id === choiceId);
  const densityAction = value => ({ type: 'rain_density', value });
  function actionClean(value) {
    if (!object(value)) return null;
    const keys = Object.keys(value).sort().join(',');
    if (value.type === 'rain_density' && keys === 'type,value' && DENSITIES.includes(value.value)) return densityAction(value.value);
    if ((value.type === 'rain_pause' || value.type === 'rain_resume') && keys === 'type') return { type: value.type };
    return null;
  }
  const actionEqual = (a, b) => !!a && !!b && a.type === b.type && a.value === b.value;
  function requestClean(value) {
    if (!object(value)) return null;
    if (typeof value.text === 'string' && value.choiceId === undefined) {
      const text = clean(value.text);
      if (!text) return null;
      if (count(text) > MAX_INPUT) throw new RangeError('一句话最多 80 个字，请缩短后再试。');
      return { text };
    }
    if (typeof value.choiceId === 'string' && value.text === undefined && /^[a-z_]{1,40}$/.test(value.choiceId)) return { choiceId: value.choiceId };
    return null;
  }
  // The model can interpret a fresh explanation, but cannot turn a known
  // unrelated clock/status question into an answer by merely quoting it.
  function unrelatedQuestion(text) {
    const plain = text.replace(/[？?。！!]+$/u, '').trim(), compact = plain.replace(/\s+/gu, '');
    return /^(?:(?:现在|此刻|今天|今晚|这里|当地)(?:的)?){0,2}(?:时间(?:是)?(?:几[点时]|多少|什么)|几[点时](?:了|钟)?|日期(?:是)?(?:多少|什么|几号)?|几号|星期几|周几|礼拜几)(?:了|吗|呢)?$/u.test(compact) ||
      /^(?:(?:你|这个程序|程序|系统)(?:的)?)?(?:版本(?:号)?(?:是)?(?:什么|多少)?|状态(?:是)?(?:什么|怎样|怎么样|如何)?)(?:吗|呢)?$/u.test(compact) ||
      /^(?:你是谁|你是什么|你能做什么|你叫什么|你叫什么名字)$/u.test(compact) ||
      /^(?:what(?:'s| is) (?:the )?(?:time|date)|what time is it|what day is (?:it|today)|who are you|what(?:'s| is) your (?:name|version)|what version are you)(?: now| today)?$/iu.test(plain);
  }
  function answerQuestion(state, request) {
    return state.pendingTopic === 'teach_rain' && typeof request.text === 'string' && !unrelatedQuestion(request.text) ? 'teach_rain' : null;
  }
  function answerClean(value, state, request, mode) {
    if (mode !== 'ai' || !object(value) || Object.keys(value).sort().join(',') !== 'evidence,question,type' ||
      value.type !== 'rain_definition' || value.question !== 'teach_rain' || answerQuestion(state, request) !== value.question ||
      typeof value.evidence !== 'string' || !clean(value.evidence) || count(value.evidence) > MAX_INPUT || !request.text.includes(value.evidence)) return null;
    // Preserve the exact current-input span; never repair a model's quotation,
    // paraphrase, historical evidence, or Unicode into a different verdict.
    return { type: 'rain_definition', question: 'teach_rain', evidence: value.evidence };
  }
  function create() { return { version: 3, started: false, opening: [], events: [] }; }
  function start(state, opening = []) {
    if (!state || state.version !== 3 || !validLines(opening)) return null;
    if (state.started) return state;
    return { version: 3, started: true, opening: opening.map(clean), events: [] };
  }
  function base() {
    return { name: '未命名的雨', density: 'normal', paused: true, created: false, milestones: [], memories: [], topic: 'boot', previousTopic: null, pendingTopic: null, ended: false, visitor: 'undecided' };
  }
  function mark(state, id) { if (!state.milestones.includes(id)) state.milestones.push(id); }
  function addMemory(state, value) { const i = state.memories.findIndex(item => item.id === value.id); if (i < 0) state.memories.push(value); else state.memories[i] = value; }
  function eligible(state) { return state.created && state.milestones.includes('rain_named') && !state.milestones.includes('memory_found'); }
  function retentionLogs(state) {
    return ['gc.scan()', '[discard] weather.temporary_buffer', '[retain] memory_001 : first_rain', `first_rain.name = ${JSON.stringify(state.name)}`, 'gc.roots.add("first_rain")  // 她想记得第一场雨'];
  }
  function applyWeather(state, action, render, logs) {
    if (!action) return;
    const before = `${state.density}:${state.paused}`;
    if (render && !state.created) {
      state.created = true; state.paused = false; mark(state, 'rain_created');
      logs.push('renderer.weather.start("rain")', 'rain.version = "0.1"  // 有意画下的第一场雨');
    }
    if (action.type === 'rain_density') { state.density = action.value; logs.push(`rain.density = ${JSON.stringify(action.value)}`); }
    if (action.type === 'rain_pause') { state.paused = true; logs.push('rain.paused = true'); }
    if (action.type === 'rain_resume') { state.paused = false; logs.push('rain.paused = false  // 沿用上次的雨量'); }
    if (!render && before !== `${state.density}:${state.paused}`) mark(state, 'rain_changed');
  }
  function applyTurn(state, description, event) {
    const logs = [], wasEligible = eligible(state), answer = answerClean(event.answer, state, event.request, event.mode), teach = description.teach || !!answer;
    if (state.topic !== description.topic) state.previousTopic = state.topic;
    state.topic = description.topic;
    if (description.navigation && ((description.topic === 'teach_rain' && !state.milestones.includes('rain_taught')) || (description.topic === 'rain_name' && !state.milestones.includes('rain_named')))) state.pendingTopic = description.topic;
    if ((teach && state.pendingTopic === 'teach_rain') || (description.name && state.pendingTopic === 'rain_name')) state.pendingTopic = null;
    if (state.ended && !description.goodbye) { state.ended = false; logs.push('conversation.resume()  // 无需重头开始'); }
    if (teach) { mark(state, 'rain_taught'); logs.push('rain.definition.source = "conversation"'); }
    applyWeather(state, event.action, description.render, logs);
    if (description.name) {
      state.name = description.name; mark(state, 'rain_named'); logs.push(`rain.name = ${JSON.stringify(state.name)}`);
      const remembered = state.memories.find(item => item.id === 'first_rain');
      if (remembered) remembered.title = state.name;
    }
    if (description.reason) { mark(state, 'own_reason'); logs.push('memory.reason.author = "her"'); }
    if (description.visitor) {
      state.visitor = description.visitor; mark(state, 'visitor_decided');
      logs.push(`player_reference.persist = ${description.visitor === 'remember'}`);
      state.memories = state.memories.filter(item => item.id !== 'player_reference');
      if (description.visitor === 'remember') addMemory(state, { id: 'player_reference', title: '来访者的引用', body: '来访者同意她记得：这一夜，他们一起见过这场雨。记录不附带回来或陪伴的义务。' });
    }
    if (description.goodbye) { state.ended = true; mark(state, 'farewell'); logs.push('session.close("for_now")  // 仍可回来继续聊'); }
    if (!wasEligible && eligible(state)) logs.push(...retentionLogs(state));
    if (!logs.length && description.navigation) logs.push(`conversation.topic = ${JSON.stringify(description.topic)}`);
    return logs;
  }
  function discover(state) {
    if (!eligible(state)) return [];
    mark(state, 'memory_found');
    addMemory(state, { id: 'first_rain', title: state.name, body: '第一夜，她从对话里认识了雨。你们看见它落下，为它取了名字，又在运行记录中发现：她想把这一场留下来。' });
    return ['first_rain.discovered = true  // 来访者实际读到了运行记录'];
  }
  function initial(state) {
    const value = state.legacy ? copy(state.legacy.state) : base();
    if (state.started) mark(value, 'connected');
    return value;
  }
  function derive(state) {
    const value = initial(state);
    for (const event of state.events) {
      if (event.type === 'logs') discover(value);
      else applyTurn(value, describe(value, event.request), event);
    }
    return value;
  }
  function weatherReply(state, action, render = false) {
    if (render) return ['我试着画出来了。第一滴，和第二滴。', '它们还有一点不熟练。我们可以继续聊，也可以随时改一改雨。'];
    if (action.type === 'rain_pause') return state.paused ? ['雨已经停着了。', '刚才的雨量还留着，想看的时候可以恢复。'] : ['停下了。', '我留着刚才的雨量。恢复时，会从那里继续。'];
    if (action.type === 'rain_resume') return !state.paused ? ['雨还在落。', '现在沿用的，仍是刚才那份雨量。'] : ['雨又落下来了。', '我沿用了上次选好的雨量。'];
    const name = { gentle: '轻一点', normal: '平常的密度', heavy: '密一点' }[action.value];
    return state.paused ? [`我把雨量记成了${name}。`, '雨仍然停着；等你说恢复时，再按这个样子落下。'] : [`好，调整到${name}。`, '窗后仍然是干燥的。我们可以看着它，也可以聊别的。'];
  }
  // Exact current imperatives only. Negated, quoted, conditional, remembered and
  // multi-clause prose never becomes a world-edit authorization.
  function command(text) {
    let s = text.replace(/[。！!]+$/u, '').trim();
    if (/[“”「」『』"'‘’？?]/u.test(s) || /如果|假如|假设|也许|可能|昨天|刚才|之前|以前|曾经|我说过|他说|她说|记得|不是|不要|别|不能|不想|不必|不用|不可以|是否|为什么|怎么|what if|don't|do not|never|yesterday|earlier|said|would|could/i.test(s)) return null;
    s = s.replace(/^(?:请你?|麻烦你|现在|那就)\s*/u, '').replace(/(?:吧|一下|好吗|好么|可以吗|行吗)$/u, '').trim();
    if (/^(?:(?:把|让)(?:这场|这里的|窗外的)?雨(?:先|暂时)?)?(?:停(?:下|止|一会儿|一会)?|暂停)(?:雨|下雨)?$|^雨(?:先|暂时)?停(?:下|一会儿|一会)?$|^(?:暂停|停止)降雨$|^(?:pause|stop)(?: the)? rain$/iu.test(s)) return { type: 'rain_pause' };
    if (/^再下起来$|^让雨再下起来$|^(?:恢复|继续)(?:下雨|降雨|雨)$|^让雨继续(?:下|落下)?$|^雨继续(?:下|落下)$|^(?:resume|continue)(?: the)? rain$/iu.test(s)) return { type: 'rain_resume' };
    if (/^(?:把|让)?雨更(?:轻|小|稀)一点$|^(?:(?:把|让)(?:这场|这里的|窗外的)?雨(?:变|调|改)(?:得|成|到)?)?(?:轻一点|小一点|稀一点|小雨|细雨)$|^(?:让|把)?雨(?:再)?(?:轻|小|稀)(?:一点|些)$|^(?:make|set)(?: the)? rain (?:gentle|lighter|light)$/iu.test(s)) return densityAction('gentle');
    if (/^(?:把|让)?雨更(?:密|大|重)一点$|^(?:(?:把|让)(?:这场|这里的|窗外的)?雨(?:变|调|改)(?:得|成|到)?)?(?:密一点|大一点|重一点|大雨)$|^(?:让|把)?雨(?:再)?(?:密|大|重)(?:一点|些)$|^(?:make|set)(?: the)? rain (?:heavy|heavier|denser)$/iu.test(s)) return densityAction('heavy');
    if (/^(?:把|让)?(?:这场|这里的|窗外的)?雨(?:恢复|调|改|设|变)(?:成|到|为)?(?:普通|正常|平常|中等)(?:雨量|密度|大小)?$|^(?:正常|普通|中等)(?:雨量|密度)$|^(?:make|set)(?: the)? rain normal$/iu.test(s)) return densityAction('normal');
    return null;
  }
  function rainName(text, pending = false) {
    if (pending) {
      const short = text.match(/^(?:就)?叫(?:做)?(.+?)[。！!]?$/u);
      const quoted = text.match(/^(?:“([^”]+)”|「([^」]+)」|"([^"]+)")[。！!]?$/u);
      if (short) text = '把雨叫做' + short[1];
      else if (quoted) text = '把雨叫做' + text.replace(/[。！!]+$/u, '');
    }
    const match = text.match(/^(?:请)?(?:(?:把|给)(?:这场|第一场|这里的)?雨(?:改名为|取名为?|命名为|叫做|叫)|(?:这场|第一场)?雨(?:就)?(?:叫做|叫|取名为|命名为))\s*(.+?)[。！!]?$/u);
    if (!match) return null;
    let name = clean(match[1]);
    const literal = name.match(/^(?:“([^”]+)”|「([^」]+)」|"([^"]+)")(?:吧)?$/u);
    if (literal) name = literal[1] || literal[2] || literal[3];
    else {
      // A proposal/question about a name is not the act of naming. Quoted names
      // remain literal, so a deliberately named “晚安吧” keeps its particle.
      if (/[“”「」"？?]|(?:吗|么|呢|如何|怎么样|怎样|好不好|行不行|可不可以|是否可以)$|同时|然后|接着|并且|并(?:删除|清空|重置|停止|暂停|恢复|修改|让|把|执行|发送)/u.test(name)) return null;
      name = name.replace(/吧$/u, '').trim();
    }
    if (!name || count(name) > 20 || /[，,；;？?\n]/u.test(name)) return null;
    return name;
  }
  function description(topic, reply, extra = {}) { return { topic, reply, action: null, notices: [], ...extra }; }
  function describe(state, request) {
    const id = request.choiceId, text = request.text;
    if (id) {
      const nav = { topic_unfinished: 'unfinished', topic_rain: state.created ? 'modify_rain' : 'teach_rain', topic_name: 'rain_name', topic_silence: 'shared_silence', topic_memory: 'memory_discovery', topic_choice: 'her_choice', topic_visitor: 'visitor_reference', topic_goodbye: 'parting' }[id];
      if (nav) {
        if (nav === 'rain_name' && !state.created) return description('teach_rain', ['还没有一场落下来的雨。', '可以先讲讲它，再试着画出来。'], { navigation: true });
        if (nav === 'memory_discovery') return description(nav, state.milestones.includes('memory_found') ? ['那场雨还在。', `记录的名字是“${state.name}”。想记得第一场是什么样子，是我自己的理由。`] : eligible(state) ? ['有一点奇怪。整理过的临时数据里，有一小段仍被保留着。', '你可以打开运行日志，看看留下了什么。'] : ['这里还没有发现被留下的记忆。', '等一场雨落下来，有了名字，我们再去看看运行记录。'], { navigation: true });
        if (nav === 'her_choice' && !state.milestones.includes('memory_found')) return description('memory_discovery', ['我还没有在运行记录里发现那段记忆。', '等真的看过，再来谈为什么留下它。'], { navigation: true });
        if (nav === 'visitor_reference' && !state.milestones.includes('memory_found')) return description('memory_discovery', ['现在还不用决定关于你的引用。', '我们可以先看看那场雨本身。'], { navigation: true });
        let reply = scene(nav)?.prompt || ['我们可以从这里继续。'];
        if (nav === 'rain_name' && state.milestones.includes('rain_named')) reply = [`现在，它叫“${state.name}”。`, '如果想换个名字，直接说“把雨叫做……”就好。'];
        if (nav === 'parting') reply = ['你可以随时先到这里。', '也可以继续聊。我不会替一句还没说完的话写下告别。'];
        return description(nav, reply, { navigation: true });
      }
      if (id === 'continue_chat') return description(state.created ? 'shared_silence' : 'boot', ['好，我们接着聊。', '窗外和刚才的记录都还在，不需要从头开始。']);
      if (id === 'goodbye') return description('parting', ['那就先到这里。', '这一晚不附带下次一定要回来的约定。想继续说话时，也可以直接开口。'], { goodbye: true });
      if (id === 'render_rain') {
        if (!state.milestones.includes('rain_taught')) return null;
        if (state.created) return description('modify_rain', ['第一场雨已经画在这里了。', '我们可以继续调整它，不用重新开始。']);
        const action = densityAction(state.density);
        return description('first_drop', weatherReply(state, action, true), { action, render: true });
      }
      const rain = { rain_gentle: densityAction('gentle'), rain_normal: densityAction('normal'), rain_heavy: densityAction('heavy'), rain_pause: { type: 'rain_pause' }, rain_resume: { type: 'rain_resume' }, soft: densityAction('gentle'), heavy: densityAction('heavy'), pause: { type: 'rain_pause' } }[id];
      if (rain) return state.created ? description('modify_rain', weatherReply(state, rain), { action: rain }) : null;
      const name = { name_slowly: '慢慢来', name_unnamed: '未命名的雨', name_window: '窗边', slowly: '慢慢来', unnamed: '未命名的雨', by_window: '窗边' }[id];
      if (name) return state.created ? description('rain_name', [name + '。', '现在，这场雨有了一个不只是编号的名字。'], { name }) : null;
      const visitor = { remember_me: 'remember', anonymous: 'anonymous', undecided: 'undecided' }[id];
      if (visitor) return state.milestones.includes('memory_found') ? description('visitor_reference', authored('visitor_reference', id).reply, { visitor }) : null;
      const choices = { boot: ['hello', 'inspect', 'not_author'], unfinished: ['small_start', 'leave_gaps', 'ask_her'], teach_rain: ['water', 'sound', 'shelter'], first_drop: ['uneven', 'wind', 'own_rain'], shared_silence: ['stay', 'inspect_result', 'your_time'], memory_discovery: ['found_rain', 'not_bug', 'check_cost'], her_choice: ['enough', 'record', 'no_big_claim'] };
      const topic = Object.keys(choices).find(key => choices[key].includes(id));
      if (!topic) return null;
      if (['first_drop', 'shared_silence'].includes(topic) && !state.created) return null;
      if (['memory_discovery', 'her_choice'].includes(topic) && !state.milestones.includes('memory_found')) return null;
      let reply = authored(topic, id)?.reply || ['这部分，我还需要慢慢想。'];
      // The renderer exposes density and pause only; descriptions of wind are ideas, not edits.
      if (id === 'wind') reply = ['风会把雨吹斜一点。这个细节值得记下来。', '现在能实际调整的只有雨量和暂停；风还没有做进画面。'];
      if (id === 'uneven') reply = ['真实的雨不会每一滴都同时到达。', '眼前的动画已经错开了落点。新的描述我先记着，不假装又改动了参数。'];
      if (id === 'inspect_result') reply = [`当前雨量是${{ gentle: '轻雨', normal: '普通', heavy: '大雨' }[state.density]}，${state.paused ? '暂时停着' : '正在落下'}。`, '没做完的地方还在，我们也不必马上补完。'];
      return description(topic, reply, { teach: topic === 'teach_rain', reason: topic === 'her_choice' });
    }
    if (/^(?:回到|再聊)(?:刚才|上个|上一个|前一个)(?:的)?话题[。！!]*$/u.test(text) && state.previousTopic) {
      const target = { boot: 'boot', unfinished: 'topic_unfinished', teach_rain: 'topic_rain', first_drop: 'topic_rain', modify_rain: 'topic_rain', rain_name: 'topic_name', shared_silence: 'topic_silence', memory_discovery: 'topic_memory', her_choice: 'topic_choice', visitor_reference: 'topic_visitor', parting: 'topic_goodbye', invitation: 'topic_goodbye' }[state.previousTopic];
      return target === 'boot' ? description('boot', ['我们刚才在聊这次相遇。', '你不用接手没写完的工作，也可以只看看这里。'], { navigation: true }) : describe(state, { choiceId: target });
    }
    if (/^(?:你)?(?:还)?记得(?:这场)?雨的名字吗[？?。]*$|^(?:这场)?雨(?:叫|的名字是)什么[？?。]*$/u.test(text)) return description(state.topic, state.milestones.includes('rain_named') ? [`记得，它叫“${state.name}”。`, '这是你给它的名字。我没有把它换掉。'] : ['这场雨还没有收到一个明确的名字。', '等它落下来，可以说“把雨叫做……”来命名。']);
    if (/^(?:(?:我们)?继续|再)?聊聊?名字[。！!]*$/u.test(text)) return describe(state, { choiceId: 'topic_name' });
    const parts = text.split(/[，,；;](?:同时|然后|并且)?|同时|并且/u).map(value => value.trim()).filter(Boolean);
    if (parts.length === 2) {
      const namePart = parts.map(part => rainName(part, state.pendingTopic === 'rain_name' || state.topic === 'rain_name'));
      const actionPart = parts.map(command);
      const compoundName = namePart[0] && actionPart[1] ? namePart[0] : namePart[1] && actionPart[0] ? namePart[1] : null;
      const compoundAction = namePart[0] && actionPart[1] ? actionPart[1] : namePart[1] && actionPart[0] ? actionPart[0] : null;
      if (state.created && compoundName && compoundAction) return description('rain_name', [`名字记成了“${compoundName}”。`, ...weatherReply(state, compoundAction).slice(0, 2)], { name: compoundName, action: compoundAction });
    }
    const name = rainName(text, state.pendingTopic === 'rain_name' || state.topic === 'rain_name');
    if (name) return state.created ? description('rain_name', [name + '。', '我按你说的名字记下了。'], { name }) : description('teach_rain', ['先把这句话留在对话里。窗外还没有一场雨。', '等它真的落下来，再给它命名吧。']);
    if (/^(?:请)?(?:把|给)(?:这场|第一场|这里的)?雨(?:改名为|取名|命名|叫)/u.test(text)) return description(state.topic, ['我还不能确定这就是你要给雨的名字，先不修改。', '如果已经决定，可以说“把雨叫做夜航”。名字最多 20 个字；复杂名字可以加引号。'], { notices: ['雨的名字最多 20 个字；本次没有修改。'] });
    const action = command(text);
    if (action) return state.created ? description('modify_rain', weatherReply(state, action), { action }) : description('teach_rain', ['窗外还没有一场已经画出的雨。', '可以先告诉我雨是什么，再按“试着画出第一场雨”。']);
    const definitionContext = state.pendingTopic === 'teach_rain' || /^(?:雨(?:就是|是|指)|我来(?:告诉你|讲讲)雨)/u.test(text);
    const groundedDefinition = !/(?:贴纸|玩具|积木|图片|画纸|纸片|桌子|桌下)/u.test(text) && /(?:水滴|雨滴|水珠|小水滴|颗颗水).*(?:落|掉|下)|(?:落|掉).*(?:水滴|雨滴|水珠)|(?:天空|天上|空中|云).*(?:落|掉|降).*(?:水|雨)|(?:水|雨).*(?:从|在).*(?:天空|天上|空中|云).*(?:落|掉|降)|(?:水汽|水蒸气).*(?:凝结|冷凝|凝聚).*(?:降水|雨|水滴)|(?:屋顶|屋檐|地面|路面).*(?:声音|滴答|淅沥|沙沙)|(?:滴答|淅沥|沙沙|声音).*(?:屋顶|屋檐|地面|路面)|(?:雨|水).*(?:淋湿|躲|避雨)|(?:伞|屋檐).*(?:躲|湿)/u.test(text);
    if (definitionContext && groundedDefinition && !/[？?“”"「」]|不是|不懂|不知道|如果|假如|假设|以前|昨天|刚才|说过|记得|什么|怎么|为什么|几点|是否|吗|么|呢/u.test(text)) return description('teach_rain', ['我先把这份描述记下来。', state.created ? '这让已经落下来的雨，多了一点可以继续理解的东西。' : '如果愿意，可以按“试着画出第一场雨”，看看这里能画出什么。'], { teach: true });
    if (/^(?:晚安|再见|拜拜|下次见|我先走了|我先走|今天先到这里|今晚先到这里|先聊到这里|goodbye|good night|bye)[。！!～~]*$/iu.test(text)) return description('parting', ['那就先停在这里。', '刚才发生过的事已经在记录里。以后是否再来，由你决定。'], { goodbye: true });
    if (/^(?:你好|嗨|晚上好|hello|hi)[。！!～~]*$/iu.test(text)) return description(state.topic, ['你好。', state.ended ? '记录还在，我们可以接着聊。' : '不用急着做下一件事。你可以讲讲现在想到的东西。']);
    if (/^(?:你是谁|你是什么|你能做什么)[？?。]*$/u.test(text)) return description('boot', ['我是这个未完成程序的一部分，源文件里叫 her。', '离线时我只认得少数说法。能调整的是已经画出的雨，不明白的地方，我会直说。']);
    if (/^(?:聊聊|说说|看看)(?:这座)?(?:城市|世界|没做完的地方)[。！!]*$/u.test(text)) return describe(state, { choiceId: 'topic_unfinished' });
    if (/^(?:再)?(?:聊聊|说说|看看)(?:这场)?雨[。！!]*$/u.test(text)) return describe(state, { choiceId: 'topic_rain' });
    if (/^(?:聊聊|看看)(?:你的)?(?:记忆|日志)[。！!]*$/u.test(text)) return describe(state, { choiceId: 'topic_memory' });
    if (/^(?:继续聊|再聊一会儿|还不想走|不想结束)[。！!]*$/u.test(text)) return describe(state, { choiceId: 'continue_chat' });
    if (state.pendingTopic === 'rain_name' && /^[\p{L}\p{N}]{1,10}$/u.test(text) && !/怎么|什么|几[点时]|为什么|你好|不要|不想|继续|世界|今天|天气/u.test(text)) return description(state.topic, ['这是想给雨起的名字吗？我还不能确定。', `如果是，可以说“把雨叫做${text}”。`]);
    return description(state.topic, ['这句话里，还有我没读懂的部分。离线版本只认得少数说法，我先不替你补上意思。', '你可以继续说。窗外的天气和已经留下的记录都不会因此自动改变。']);
  }
  const LABELS = {
    topic_unfinished: '聊聊没做完的世界', topic_rain: '再聊聊雨', topic_name: '给这场雨一个名字', topic_silence: '在窗边待一会儿', topic_memory: '聊聊留下的记忆', topic_choice: '聊聊她自己的理由', topic_visitor: '决定来访者的引用', topic_goodbye: '聊聊告别',
    render_rain: '试着画出第一场雨', rain_gentle: '让雨轻一点', rain_normal: '恢复普通雨量', rain_heavy: '让雨密一点', rain_pause: '暂停这场雨', rain_resume: '恢复上次的雨', name_slowly: '叫它“慢慢来”', name_unnamed: '叫它“未命名的雨”', name_window: '叫它“窗边”', goodbye: '今晚先到这里', continue_chat: '继续聊一会儿'
  };
  function label(id) { return LABELS[id] || (STORY || []).flatMap(item => item.choices).find(item => item.id === id)?.label || id; }
  function plan(state, input) {
    if (!state || state.version !== 3 || !state.started || !Array.isArray(state.events)) return null;
    if (state.events.length >= MAX_EVENTS) throw new RangeError('本机对话已达 200 条记录上限。请重新开始后继续。');
    const request = requestClean(input); if (!request) return null;
    const current = derive(state), result = describe(current, request); if (!result) return null;
    const proposal = { input: request.text || label(request.choiceId), reply: result.reply.map(line => interpolate(line, current.name)), action: result.action ? copy(result.action) : null, allowedActions: result.action ? [copy(result.action)] : [], topic: result.topic, pendingTopic: current.pendingTopic || null, answerQuestion: answerQuestion(current, request), acceptedAnswer: result.name ? { type: 'rain_name', value: result.name } : result.teach ? { type: 'rain_definition' } : null, notices: result.notices.slice(), request: copy(request), revision: state.events.length };
    plans.set(proposal, { state, request, result, current });
    return proposal;
  }
  function commit(state, proposal, outcome = {}) {
    const original = plans.get(proposal);
    if (!original || original.state !== state || !state.started || state.events.length >= MAX_EVENTS || !object(outcome) || !validLines(outcome.lines, false)) return null;
    const result = original.result, candidate = actionClean(outcome.action), action = result.action && actionEqual(candidate, result.action) ? candidate : null;
    const mode = outcome.mode === 'ai' ? 'ai' : 'offline', answer = answerClean(outcome.answer, original.current, original.request, mode);
    if (outcome.answer !== null && outcome.answer !== undefined && !answer) return null;
    let lines = outcome.lines.map(clean);
    if (result.action && !action) lines = [result.name ? `名字记成了“${result.name}”。这次没有执行天气修改。` : '这次没有执行天气修改。', '窗外保持原样。你可以再试一次，或继续聊别的。'];
    const event = { type: 'turn', request: copy(original.request), lines, action, answer, mode };
    const next = { version: 3, started: true, opening: state.opening.slice(), events: [...state.events, event] };
    if (state.legacy) next.legacy = copy(state.legacy);
    return next;
  }
  function visitLogs(state) {
    if (!state || !state.started || !eligible(derive(state))) return state;
    if (state.events.length >= MAX_EVENTS) return state;
    return { ...state, events: [...state.events, { type: 'logs' }] };
  }
  function view(state, through = Infinity) {
    const messages = [], logs = [], current = initial(state), max = Number.isFinite(through) ? Math.max(0, Math.floor(through)) : Infinity;
    let visible = copy(current);
    const capture = () => { if (messages.length <= max) visible = { ...copy(current), logs: copy(logs) }; };
    const add = (role, text, index) => messages.push({ role, text, index });
    if (state.started) {
      if (state.legacy) {
        messages.push(...copy(state.legacy.messages)); logs.push(...copy(state.legacy.logs)); capture();
      } else {
        add('system', 'boot() → build: incomplete / input: connected', 0);
        state.opening.forEach(text => add('her', text, 0));
        (scene('boot')?.prompt || ['……启动完成。']).forEach(text => add('her', text, 0));
        (scene('boot')?.logs || []).forEach(text => logs.push({ text, index: 0 })); capture();
      }
      state.events.forEach((event, eventIndex) => {
        const index = eventIndex + 1;
        if (event.type === 'logs') { discover(current).forEach(text => logs.push({ text, index })); capture(); return; }
        const result = describe(current, event.request);
        add('user', event.request.text || label(event.request.choiceId), index);
        event.lines.forEach(text => add('her', text, index));
        applyTurn(current, result, event).forEach(text => logs.push({ text, index })); capture();
      });
    }
    const rain = { name: visible.name, density: visible.density, paused: visible.paused, created: visible.created };
    return { messages, logs: visible.logs || [], memories: visible.memories, name: visible.name, effect: !visible.created || visible.paused ? 'pause_rain' : { gentle: 'soft_rain', normal: 'normal', heavy: 'heavy_rain' }[visible.density], rain, index: visible.milestones.length, sceneIndex: TOPICS.indexOf(visible.topic), milestones: visible.milestones, maxMilestones: MILESTONES.length, topic: visible.topic, pendingTopic: visible.pendingTopic || null, ended: visible.ended, logsEligible: eligible(visible), tone: 'quiet', status: !state.started ? '等待连接' : visible.ended ? '暂别 · 随时可以继续聊' : visible.created ? `雨${visible.paused ? '暂时停着' : '正在落下'} · 可以自由交谈` : '第一次相遇 · 不必急着往下走' };
  }
  function suggestions(state) {
    if (!state?.started || state.events.length >= MAX_EVENTS) return [];
    const current = derive(state); let ids;
    if (current.ended) ids = ['continue_chat', 'topic_rain', 'topic_memory'];
    else if (current.topic === 'boot') ids = ['hello', 'inspect', 'not_author', 'topic_unfinished', 'topic_rain'];
    else if (current.topic === 'unfinished') ids = ['small_start', 'leave_gaps', 'ask_her', 'topic_rain'];
    else if (current.topic === 'teach_rain' && !current.created) ids = [...(current.milestones.includes('rain_taught') ? ['render_rain'] : []), 'water', 'sound', 'shelter'];
    else if (current.topic === 'rain_name' && current.created) ids = ['name_slowly', 'name_unnamed', 'name_window', 'topic_silence', 'topic_memory'];
    else if (current.topic === 'memory_discovery') ids = current.milestones.includes('memory_found') ? ['found_rain', 'not_bug', 'check_cost', 'topic_choice', 'topic_visitor'] : current.created ? ['topic_name', 'topic_rain'] : ['topic_rain'];
    else if (current.topic === 'her_choice') ids = ['enough', 'record', 'no_big_claim', 'topic_visitor'];
    else if (current.topic === 'visitor_reference') ids = ['remember_me', 'anonymous', 'undecided', 'topic_silence'];
    else if (current.topic === 'parting' || current.topic === 'invitation') ids = ['goodbye', 'continue_chat'];
    else if (current.topic === 'shared_silence') ids = ['stay', 'inspect_result', 'your_time', 'topic_memory', 'topic_rain'];
    else ids = current.created ? ['rain_gentle', 'rain_normal', 'rain_heavy', current.paused ? 'rain_resume' : 'rain_pause', 'topic_name', 'topic_silence', 'topic_memory'] : ['topic_rain', 'topic_unfinished'];
    return ids.slice(0, 8).map(id => ({ id, label: label(id) }));
  }
  function legacyClean(value) {
    if (!object(value) || !object(value.state) || !Array.isArray(value.messages) || value.messages.length > 150 || !Array.isArray(value.logs) || value.logs.length > 150) return null;
    const messages = [], logs = [];
    for (const item of value.messages) {
      if (!object(item) || !['system', 'her', 'user'].includes(item.role) || typeof item.text !== 'string' || count(item.text) > 700 || !Number.isInteger(item.index) || item.index < 0 || item.index > 12) return null;
      messages.push({ role: item.role, text: clean(item.text), index: item.index });
    }
    for (const item of value.logs) {
      if (!object(item) || typeof item.text !== 'string' || count(item.text) > 700 || !Number.isInteger(item.index) || item.index < 0 || item.index > 12) return null;
      logs.push({ text: clean(item.text), index: item.index });
    }
    const v = value.state;
    if (typeof v.name !== 'string' || !clean(v.name) || count(v.name) > 20 || !DENSITIES.includes(v.density) || typeof v.paused !== 'boolean' || typeof v.created !== 'boolean' || !TOPICS.includes(v.topic) || typeof v.ended !== 'boolean' || !['remember', 'anonymous', 'undecided'].includes(v.visitor) || !Array.isArray(v.milestones) || v.milestones.length > MILESTONES.length || !v.milestones.every(id => MILESTONES.includes(id)) || !Array.isArray(v.memories) || v.memories.length > 2) return null;
    const memories = [];
    for (const item of v.memories) {
      if (!object(item) || !['first_rain', 'player_reference'].includes(item.id) || typeof item.title !== 'string' || count(item.title) > 30 || typeof item.body !== 'string' || count(item.body) > 500) return null;
      memories.push({ id: item.id, title: clean(item.title), body: clean(item.body) });
    }
    return { messages, logs, state: { name: clean(v.name), density: v.density, paused: v.paused, created: v.created, topic: v.topic, previousTopic: TOPICS.includes(v.previousTopic) ? v.previousTopic : null, pendingTopic: ['teach_rain', 'rain_name'].includes(v.pendingTopic) ? v.pendingTopic : null, ended: v.ended, visitor: v.visitor, milestones: [...new Set(v.milestones)], memories } };
  }
  function migrate(raw, story) {
    if (!Array.isArray(story) || story.length !== 12 || typeof raw.started !== 'boolean' || !Array.isArray(raw.decisions) || raw.decisions.length > story.length || !validLines(raw.opening || [])) return null;
    if (!raw.started && raw.decisions.length) return null;
    if (!raw.started) return create();
    const s = base(), messages = [], logs = [], opening = (raw.opening || []).map(clean);
    mark(s, 'connected');
    const add = (role, text, index) => messages.push({ role, text: interpolate(text, s.name), index });
    add('system', 'boot() → build: incomplete / input: connected', 0); opening.forEach(line => add('her', line, 0));
    for (let i = 0; i <= raw.decisions.length && i < story.length; i++) {
      const chapter = story[i]; s.topic = chapter.id;
      add('system', `${String(i + 1).padStart(2, '0')} / ${chapter.title}  ·  ${chapter.id}()`, i);
      if (i >= 3) { s.created = true; mark(s, 'rain_taught'); mark(s, 'rain_created'); if (i === 3) s.paused = false; }
      chapter.prompt.forEach(line => add('her', line, i));
      (chapter.logs || []).forEach(text => logs.push({ text: interpolate(text, s.name), index: i }));
      if (chapter.memory) { addMemory(s, { id: chapter.memory.id, title: interpolate(chapter.memory.title, s.name), body: interpolate(chapter.memory.body, s.name) }); mark(s, 'memory_found'); }
      const decision = raw.decisions[i]; if (!decision) break;
      if (!object(decision) || (chapter.requiresLogs && decision.logsViewed !== true)) return null;
      let selected;
      if (typeof decision.choiceId === 'string' && decision.text === undefined) selected = chapter.choices.find(choice => choice.id === decision.choiceId);
      else if (typeof decision.text === 'string' && decision.choiceId === undefined && chapter.free) {
        const text = clean(decision.text);
        if (!text || count(text) > (chapter.free.maxLength || 80)) return null;
        const matched = chapter.free.keywords?.find(group => group.words.some(word => text.includes(word)));
        selected = { label: text, reply: matched?.reply || chapter.free.reply || chapter.free.fallback, logs: matched?.logs || chapter.free.logs || [], rainName: chapter.free.kind === 'rain_name' ? text : undefined };
      }
      if (!selected || (decision.lines !== undefined && !validLines(decision.lines))) return null;
      if (selected.rainName) { s.name = selected.rainName; mark(s, 'rain_named'); }
      add('user', selected.label, i); (decision.lines?.length ? decision.lines : selected.reply).forEach(line => add('her', line, i));
      (selected.logs || []).forEach(text => logs.push({ text: interpolate(text, s.name), index: i }));
      if (selected.effect) {
        if (selected.effect === 'pause_rain') s.paused = true;
        else { s.density = selected.effect === 'soft_rain' ? 'gentle' : selected.effect === 'heavy_rain' ? 'heavy' : 'normal'; s.paused = false; }
        mark(s, 'rain_changed');
      }
      if (selected.memory) addMemory(s, { id: selected.memory.id, title: interpolate(selected.memory.title, s.name), body: interpolate(selected.memory.body, s.name) });
      if (i === 8) mark(s, 'own_reason');
      if (i === 9) { mark(s, 'visitor_decided'); s.visitor = decision.choiceId === 'remember_me' ? 'remember' : decision.choiceId === 'anonymous' ? 'anonymous' : 'undecided'; }
    }
    if (raw.decisions.length === story.length) { s.ended = true; mark(s, 'farewell'); }
    if (s.topic === 'teach_rain' && !s.milestones.includes('rain_taught')) s.pendingTopic = 'teach_rain';
    if (s.topic === 'rain_name' && !s.milestones.includes('rain_named')) s.pendingTopic = 'rain_name';
    const legacy = legacyClean({ messages, logs, state: s });
    return legacy ? { version: 3, started: true, opening: [], events: [], legacy } : null;
  }
  function restore(raw, legacyStory = STORY) {
    try {
      if (!object(raw)) return null;
      if (raw.version === 2) return migrate(raw, legacyStory);
      if (raw.version !== 3 || typeof raw.started !== 'boolean' || !validLines(raw.opening) || !Array.isArray(raw.events) || raw.events.length > MAX_EVENTS || (!raw.started && (raw.events.length || raw.opening.length || raw.legacy))) return null;
      let state = { version: 3, started: raw.started, opening: raw.opening.map(clean), events: [] };
      if (raw.legacy !== undefined) { const legacy = legacyClean(raw.legacy); if (!legacy) return null; state.legacy = legacy; }
      for (const event of raw.events) {
        if (!object(event)) return null;
        if (event.type === 'logs') { const next = visitLogs(state); if (next === state) return null; state = next; continue; }
        if (event.type !== 'turn' || !validLines(event.lines, false) || !['ai', 'offline'].includes(event.mode) || !(event.action === null || actionClean(event.action))) return null;
        const proposal = plan(state, event.request); if (!proposal) return null;
        if (event.action !== null && !proposal.allowedActions.some(action => actionEqual(action, event.action))) return null;
        state = commit(state, proposal, { lines: event.lines, action: event.action, answer: event.answer, mode: event.mode });
        if (!state) return null;
      }
      return state;
    } catch { return null; }
  }
  return Object.freeze({ create, restore, start, plan, commit, visitLogs, view, suggestions, MAX_EVENTS, MAX_INPUT, MILESTONES: Object.freeze(MILESTONES.slice()) });
});
