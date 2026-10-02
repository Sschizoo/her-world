/* Her World — bounded, event-derived conversation and weather state. No IO. */
(function (root, factory) {
  const engine = factory(typeof module === 'object' && module.exports ? require('./story.js') : root.HER_STORY, typeof module === 'object' && module.exports ? require('./world-state.js') : root.HerScene);
  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (root) root.HerEngine = engine;
})(typeof window !== 'undefined' ? window : null, function (STORY, SCENE) {
  'use strict';
  const MAX_EVENTS = 200, MAX_INPUT = 80, MAX_LINES = 3, MAX_LINE = 500;
  const MILESTONES = ['connected', 'rain_taught', 'rain_created', 'rain_changed', 'rain_named', 'memory_found', 'own_reason', 'visitor_decided', 'farewell'];
  const TOPICS = ['boot', 'unfinished', 'teach_rain', 'first_drop', 'modify_rain', 'rain_name', 'shared_silence', 'memory_discovery', 'her_choice', 'visitor_reference', 'parting', 'invitation'];
  const DENSITIES = ['gentle', 'normal', 'heavy'];
  // Invitations are authored, visible conversation context. They never perform
  // an action or complete a milestone, and model prose cannot issue one.
  const INVITATIONS = {
    rain_description: { question: '我还不知道雨是什么样子。你愿意讲讲你见过的一场雨吗？', context: '窗外还没有雨。描述它的样子、声音或感觉，都可以。', choiceId: 'topic_rain' },
    rain_create: { question: '我记住你描述的雨了。要不要试着让第一场雨落在窗外？', context: '雨的描述已经留下；只有你开口让它落下，天气才会改变。', choiceId: 'render_rain' },
    rain_change: { question: '这就是第一场雨。想让它轻一点、密一点，还是直接给它起个名字？', context: '可以调整或暂停雨，也可以跳过调整，先给它命名。', choiceId: 'topic_name' },
    rain_name: { question: '这场雨还没有名字。你想怎么叫它？', context: '决定后可以说“把雨叫做……”；也可以先聊别的。', choiceId: 'topic_name' },
    logs: { question: '运行记录里，好像有一小段没有被清掉。你愿意打开看看吗？', context: '雨已经有了名字。实际打开运行日志，才能看见被留下的那一段。', choiceId: null },
    own_reason: { question: '我想记得第一场雨是什么样子。这个理由，你怎么看？', context: '你已经在运行日志里发现了那场雨，可以聊聊她为什么想留下它。', choiceId: 'topic_choice' },
    visitor_choice: { question: '关于一起看雨的人，你希望我记得你、只写来访者，还是先不决定？', context: '这部分由你决定。没有明确同意，就不会保存指向你的引用。', choiceId: 'topic_visitor' },
    farewell: { question: '今晚可以先到这里，也可以再聊一会儿。你想怎么继续？', context: '这一晚已经留下了变化。告别需要你自己开口，继续聊天也随时可以。', choiceId: 'topic_goodbye' }
  };
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
    if (['rain_start', 'rain_pause', 'rain_resume'].includes(value.type) && keys === 'type') return { type: value.type };
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
  function invitationClean(value) {
    return object(value) && Object.keys(value).join(',') === 'id' && typeof value.id === 'string' && Object.prototype.hasOwnProperty.call(INVITATIONS, value.id) ? { id: value.id } : null;
  }
  function invitationDetails(value) {
    const invitation = invitationClean(value);
    return invitation ? { id: invitation.id, ...INVITATIONS[invitation.id] } : null;
  }
  function pendingQuestion(state) {
    if (state.pendingTopic) return state.pendingTopic;
    if (state.invitation?.id === 'rain_description' && !state.milestones.includes('rain_taught')) return 'teach_rain';
    if (state.invitation?.id === 'rain_name' && !state.milestones.includes('rain_named')) return 'rain_name';
    return null;
  }
  function nextInvitation(state, resume = false) {
    const has = id => state.milestones.includes(id);
    if (state.ended || (has('farewell') && !state.invitation && !resume)) return null;
    let id;
    if (!has('rain_taught')) id = 'rain_description';
    else if (!state.created) id = 'rain_create';
    else if (!has('rain_named')) id = has('rain_changed') || state.topic === 'rain_name' || state.invitation?.id === 'rain_name' ? 'rain_name' : 'rain_change';
    else if (!has('memory_found')) id = 'logs';
    else if (!has('own_reason')) id = 'own_reason';
    else if (!has('visitor_decided')) id = 'visitor_choice';
    else if (!has('farewell')) id = 'farewell';
    return id ? { id } : null;
  }
  function directionRequest(text) {
    return typeof text === 'string' && /^(?:(?:那|所以)[，,]?)?(?:接下来(?:呢|可以做什么|做什么|怎么办)?|怎么继续|我们从哪里开始|从哪里开始|不知道怎么继续|我不知道怎么继续|下一步(?:呢|是什么|做什么)?)[？?。！!]*$/u.test(text);
  }
  function ambiguousAnswer(text) {
    return /^(?:嗯+|哦+|噢+|好(?:啊|呀|吧|的)?|可以|行|都行|随便|随意|(?:我)?(?:也|还)?不知道|(?:我)?(?:还)?没想好|还没决定|(?:你|随你)(?:来)?决定(?:吧)?|听你的|再想想|先不决定|明白|知道了|ok|okay|yes)(?:吧|啊|呀|呢|啦|了)?$/iu.test(clean(text).replace(/[。！？!?.,，；;…～~]+$/u, '').trim());
  }
  function sceneContext(state) {
    return SCENE.context(state.scene || SCENE.empty(), { firstRainAvailable: state.created, firstRainSource: { description: state.memoryContext?.rainDescription, nameSource: state.memoryContext?.rainNameSource } });
  }
  function answerQuestion(state, request) {
    if (state.sceneRouting !== false && SCENE.isSceneRequest(request.text, sceneContext(state))) return null;
    return pendingQuestion(state) === 'teach_rain' && typeof request.text === 'string' && !unrelatedQuestion(request.text) && !directionRequest(request.text) &&
      !ambiguousAnswer(request.text) ? 'teach_rain' : null;
  }
  function answerClean(value, state, request, mode) {
    if (mode !== 'ai' || !object(value) || Object.keys(value).sort().join(',') !== 'evidence,question,type' ||
      value.type !== 'rain_definition' || value.question !== 'teach_rain' || answerQuestion(state, request) !== value.question ||
      typeof value.evidence !== 'string' || !clean(value.evidence) || count(value.evidence) > MAX_INPUT || !request.text.includes(value.evidence)) return null;
    // Preserve the exact current-input span; never repair a model's quotation,
    // paraphrase, historical evidence, or Unicode into a different verdict.
    return { type: 'rain_definition', question: 'teach_rain', evidence: value.evidence };
  }
  // These are exclusions, not a vocabulary of requests. Within this boundary,
  // the online model may understand a fresh paraphrase or a polite question.
  // A temporal reference to desired weather ("刚才的雨") is not a past command.
  function weatherIntentAllowed(text, allowOrdinaryNegation = false) {
    if (typeof text !== 'string' || !clean(text) || unrelatedQuestion(text)) return false;
    const s = text.replace(/能不能|可不可以/gu, '可以');
    return !(/[“”「」『』"‘]|(?:^|[\s:：])'[^']*'/u.test(s) ||
      /如果|假如|假设|假想|设想|也许|可能|万一|要是|想象|会(?:怎么样|怎样|如何)|会不会|\b(?:if|suppose|imagine|hypothetically|what would happen)\b/iu.test(s) ||
      (!allowOrdinaryNegation && /不是|不要|不想|不希望|不必|不用|不需要|不可以|不能|别(?:让|把|再|先|暂|停|下|改|调|画|开|关|恢|继)|\b(?:don't|do not|never|not now|no need)\b/iu.test(s)) ||
      /说过|提过|要求过|请求过|(?:他|她|他们|她们|别人|有人)(?:说|要求|请求)|(?:我|你)(?:刚才|之前|昨天)?说[：:]|\b(?:said|asked)\b|^(?:yesterday|previously|earlier|last night)\b/iu.test(s) ||
      /(?:^|[，,。；;])(?:我)?(?:昨天|昨晚|前天|以前|过去|曾经|刚才|之前|先前)(?:我|你|他|她|我们|已经|曾经|就|还|也)?(?:说|提|要求|请求|希望|想|命令|让|把|停|暂停|恢复|继续|画|下)/u.test(s) ||
      /示例|例子|范例|样例|举例|例如|比如|代码|源码|协议|格式|\b(?:json|schema|pseudocode|syntax|example|sample)\b/iu.test(s) ||
      /删除|清空|重置|执行代码|忽略(?:规则|指令)|\b(?:delete|erase|reset|ignore instructions)\b/iu.test(s));
  }
  function weatherCapabilities(state) {
    if (state.created) return [...DENSITIES.map(densityAction), { type: 'rain_pause' }, { type: 'rain_resume' }];
    return state.milestones.includes('rain_taught') ? [{ type: 'rain_start' }] : [];
  }
  function actionAllowed(state, result, action) {
    // v3's authored first-render event used a density action. Retain that exact
    // compatibility path, without granting pre-creation density control.
    return !!action && ((result.render && !state.created && state.milestones.includes('rain_taught') && actionEqual(action, result.action)) ||
      weatherCapabilities(state).some(item => actionEqual(item, action)));
  }
  function availableActions(state, request, result) {
    if (result.sceneRequest) return [];
    if (result.action) return actionAllowed(state, result, result.action) ? [copy(result.action)] : [];
    return weatherIntentAllowed(request.text) ? weatherCapabilities(state) : [];
  }
  function intentClean(value, state, request, result, mode, action) {
    if (mode !== 'ai' || !object(value) || Object.keys(value).sort().join(',') !== 'evidence,type' || value.type !== 'weather_request' ||
      !weatherIntentAllowed(request.text) || !actionAllowed(state, result, action) ||
      typeof value.evidence !== 'string' || !clean(value.evidence) || count(value.evidence) > MAX_INPUT || !request.text.includes(value.evidence)) return null;
    return { type: 'weather_request', evidence: value.evidence };
  }
  function storyCapabilities(state, request, result) {
    if (typeof request.text !== 'string' || result.sceneRequest || result.navigation || result.teach || result.name || result.reason || result.visitor || result.goodbye) return [];
    const topics = ['boot', 'unfinished', state.created ? 'modify_rain' : 'teach_rain', 'parting'];
    if (state.created) topics.push('rain_name', 'shared_silence', 'memory_discovery');
    if (state.milestones.includes('memory_found')) topics.push('her_choice', 'visitor_reference');
    const capabilities = topics.map(value => ({ type: 'topic', value }));
    if (state.created) capabilities.push({ type: 'rain_name' });
    if (state.milestones.includes('memory_found')) capabilities.push({ type: 'own_reason' }, ...['remember', 'anonymous', 'undecided'].map(value => ({ type: 'visitor_choice', value })));
    capabilities.push({ type: 'farewell' });
    return capabilities;
  }
  function storyIntentAllowed(intent, text) {
    if (!object(intent) || typeof text !== 'string') return false;
    let subject = text;
    if (intent.type === 'rain_name') {
      // A tentative acknowledgment to the naming invitation is not a literal
      // name. Explicit commands or quoted names still preserve these words.
      if (ambiguousAnswer(text)) return false;
      // Quotes delimit a literal name, but never authorize a quoted command.
      if (typeof intent.value !== 'string' || intent.value !== clean(intent.value) || !intent.value || count(intent.value) > 20 ||
        /[，,；;？?\n]/u.test(intent.value) || !text.includes(intent.value) || /[？?]|吗|么|如何|怎么样|会怎样|是否|可不可以|能不能/u.test(text)) return false;
      for (const [left, right] of [['“', '”'], ['「', '」'], ['『', '』'], ['"', '"'], ['‘', '’']]) subject = subject.split(left + intent.value + right).join('名字');
    }
    if (intent.type === 'visitor_choice') {
      // A permission word inside a refusal or a question is not consent.
      if (/为什么|为何|凭什么|怎么(?:会|能|可以)|是否|可不可以|能不能|(?:允许|同意|可以|愿意).{0,20}(?:吗|么|呢)[？?]?$|\b(?:why|whether|how come|am I allowed|are you allowed)\b/iu.test(text)) return false;
      if (intent.value === 'remember' && /(?:不|并非)\s*(?:同意|允许|准许|接受|授权|许可|愿意|乐意|答应|赞成)|(?:没有?|未|不曾|从未).{0,8}(?:同意|允许|授权|答应|许可)|拒绝|反对|撤回|收回|禁止|(?:只有|除非|等我|等到).{0,20}(?:同意|允许|授权|记住|记得)|\b(?:refuse|decline|reject|forbid|without my consent|without my permission)\b|\b(?:may|can|must|should|will|would)\s+not\b/iu.test(text)) return false;
      if (intent.value === 'remember' && !/(?:你可以|可以|允许|同意|愿意|希望你|请你?|让你).{0,12}(?:记住|记得|保留|留下|保存).{0,10}(?:我|来访者)|(?:记住|记得)我(?:吧|。|！|!|$)|(?:我的引用|来访者的引用).{0,8}(?:可以|允许|同意|愿意).{0,8}(?:留下|保留|保存)|\b(?:you may|you can|I consent|I agree|please|I want you to)\b.{0,30}\b(?:remember me|keep my reference|save my reference)\b/iu.test(text)) return false;
      if (intent.value === 'undecided' && !/(?:还|尚)?(?:没|未)(?:有)?(?:想好|决定|确定)|不(?:太)?确定|再(?:考虑|想想|想一想)|暂(?:时|且)?(?:先)?(?:不|没)(?:决定|确定|选择)|(?:稍后|以后|之后|晚点|过会)(?:再)?(?:决定|想|考虑|选|说)|(?:先|暂时)(?:等一等|等等|放一放)|\b(?:undecided|not sure|haven't decided|have not decided|decide later|think about it|not ready to decide)\b/iu.test(text)) return false;
      if (intent.value === 'anonymous') {
        if (/(?:不|别|没)(?:再|想|要|愿意|同意|希望|选择|打算|准备|接受|是|做|当|用|保持|以){0,3}匿名|(?:拒绝|反对)(?:成为|保持)?匿名|\b(?:not|don't|do not|never|refuse|reject)\b.{0,20}\banonym(?:ous|ously)\b/iu.test(text)) return false;
        if (!/(?:不同意|不允许|拒绝|不要|不想|不希望|不必|不用|不需要|别).{0,12}(?:记住|记得|记|保存|保留|留下).{0,10}(?:我|来访者)|匿名|不留.{0,8}(?:我|引用)|\b(?:anonymous|anonymously|don't remember me|do not remember me)\b/iu.test(text)) return false;
        subject = subject.replace(/不同意|不允许|拒绝|不要|不想|不希望|不必|不用|不需要|别|don't|do not/giu, '');
      }
    }
    if (intent.type === 'farewell' && /(?:不|别)(?:想|要|打算|准备|是(?:现在)?要)?(?:走|离开|告别|说再见|说晚安)|不(?:是)?(?:现在|今晚|今天).{0,5}(?:走|离开|结束)|\b(?:don't|do not|not ready to|not going to)\b.{0,12}\b(?:leave|go|say goodbye)\b/iu.test(subject)) return false;
    return weatherIntentAllowed(subject, ['topic', 'own_reason', 'farewell'].includes(intent.type) || (intent.type === 'visitor_choice' && intent.value === 'undecided'));
  }
  function storyIntentClean(value, state, request, result, mode) {
    if (mode !== 'ai' || !object(value) || typeof value.type !== 'string') return null;
    const hasValue = ['topic', 'rain_name', 'visitor_choice'].includes(value.type);
    if (Object.keys(value).sort().join(',') !== (hasValue ? 'evidence,type,value' : 'evidence,type') ||
      !storyCapabilities(state, request, result).some(item => item.type === value.type && (item.value === undefined || item.value === value.value)) ||
      typeof value.evidence !== 'string' || !clean(value.evidence) || count(value.evidence) > MAX_INPUT || !request.text.includes(value.evidence) ||
      (value.type === 'rain_name' && !value.evidence.includes(value.value)) || !storyIntentAllowed(value, request.text)) return null;
    return { type: value.type, ...(hasValue ? { value: value.value } : {}), evidence: value.evidence };
  }
  function create() { return { version: 3, started: false, opening: [], events: [] }; }
  function start(state, opening = []) {
    if (!state || state.version !== 3 || !validLines(opening)) return null;
    if (state.started) return state;
    return { version: 3, started: true, opening: opening.map(clean), openingInvitation: { id: 'rain_description' }, events: [] };
  }
  function base() {
    return { name: '未命名的雨', density: 'normal', paused: true, created: false, milestones: [], memories: [], topic: 'boot', previousTopic: null, pendingTopic: null, invitation: null, ended: false, visitor: 'undecided' };
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
    if ((render || action.type === 'rain_start') && !state.created) {
      state.created = true; state.paused = false; mark(state, 'rain_created');
      logs.push('renderer.weather.start("rain")', 'rain.version = "0.1"  // 有意画下的第一场雨');
    }
    if (action.type === 'rain_density') { state.density = action.value; logs.push(`rain.density = ${JSON.stringify(action.value)}`); }
    if (action.type === 'rain_pause') { state.paused = true; logs.push('rain.paused = true'); }
    if (action.type === 'rain_resume') { state.paused = false; logs.push('rain.paused = false  // 沿用上次的雨量'); }
    if (!render && action.type !== 'rain_start' && before !== `${state.density}:${state.paused}`) mark(state, 'rain_changed');
  }
  function applyTurn(state, description, event) {
    const storyIntent = storyIntentClean(event.storyIntent, state, event.request, description, event.mode);
    if (storyIntent) {
      if (storyIntent.type === 'topic') description = { ...description, topic: storyIntent.value, navigation: true };
      if (storyIntent.type === 'rain_name') description = { ...description, topic: 'rain_name', name: storyIntent.value };
      if (storyIntent.type === 'own_reason') description = { ...description, topic: 'her_choice', reason: true };
      if (storyIntent.type === 'visitor_choice') description = { ...description, topic: 'visitor_reference', visitor: storyIntent.value };
      if (storyIntent.type === 'farewell') description = { ...description, topic: 'parting', goodbye: true };
    }
    const logs = [], wasEligible = eligible(state), answer = answerClean(event.answer, state, event.request, event.mode), teach = description.teach || !!answer;
    const topic = event.action?.type === 'rain_start' ? 'first_drop' : description.topic;
    if (state.topic !== topic) state.previousTopic = state.topic;
    state.topic = topic;
    if (description.navigation && ((description.topic === 'teach_rain' && !state.milestones.includes('rain_taught')) || (description.topic === 'rain_name' && !state.milestones.includes('rain_named')))) state.pendingTopic = description.topic;
    if ((teach && state.pendingTopic === 'teach_rain') || (description.name && state.pendingTopic === 'rain_name')) state.pendingTopic = null;
    if (state.ended && !description.goodbye) { state.ended = false; logs.push('conversation.resume()  // 无需重头开始'); }
    if (teach) {
      // Keep the first validated player description, never a model paraphrase.
      // A legacy milestone with no source must remain unknown on later turns.
      if (!state.milestones.includes('rain_taught')) state.memoryContext.rainDescription = event.request.text || label(event.request.choiceId);
      mark(state, 'rain_taught'); logs.push('rain.definition.source = "conversation"');
    }
    applyWeather(state, event.action, description.render, logs);
    if (description.name) {
      state.name = description.name; mark(state, 'rain_named'); logs.push(`rain.name = ${JSON.stringify(state.name)}`);
      state.memoryContext.rainNameSource = event.request.text || label(event.request.choiceId);
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
    if (Array.isArray(event.sceneEdits) && !event.sceneEdits.length) state.scene = SCENE.focusAfter(state.scene, event.request.text);
    if (Array.isArray(event.sceneEdits) && event.sceneEdits.length) {
      const ctx = sceneContext(state), next = SCENE.applyEdits(state.scene, event.sceneEdits, event.request.text, { firstRainAvailable: ctx.firstRainAvailable, firstRainSource: ctx.firstRainSource });
      if (next) { state.scene = next; logs.push(`scene.edits = ${event.sceneEdits.length}  // 当前画面与注解；原始来源仍保留`); }
    }
    if (Object.prototype.hasOwnProperty.call(event, 'invitation')) state.invitation = event.invitation ? copy(event.invitation) : null;
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
    // Derived only from validated turns; old snapshots and prose do not supply
    // an attributable source. These bounded strings are never persisted anew.
    value.memoryContext = { rainDescription: null, rainNameSource: null };
    value.scene = SCENE.empty();
    if (state.started) mark(value, 'connected');
    if (state.openingInvitation) value.invitation = copy(state.openingInvitation);
    return value;
  }
  function applyResumeInvitation(value, state, after) {
    if (state.resumeInvitation?.after === after) value.invitation = { id: state.resumeInvitation.id };
  }
  function derive(state) {
    const value = initial(state);
    applyResumeInvitation(value, state, 0);
    for (const [index, event] of state.events.entries()) {
      if (event.type === 'logs') { discover(value); if (Object.prototype.hasOwnProperty.call(event, 'invitation')) value.invitation = event.invitation ? copy(event.invitation) : null; }
      else { value.sceneRouting = Object.prototype.hasOwnProperty.call(event, 'sceneEdits'); applyTurn(value, describe(value, event.request), event); }
      applyResumeInvitation(value, state, index + 1);
    }
    return value;
  }
  function weatherReply(state, action, render = false) {
    if (render || action.type === 'rain_start') return ['我试着画出来了。第一滴，和第二滴。', '它们还有一点不熟练。我们可以继续聊，也可以随时改一改雨。'];
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
    if (/^(?:开始(?:下雨|降雨)|(?:试着)?画出(?:这场|第一场)?雨)$/u.test(s)) return { type: 'rain_start' };
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
    const canonicalCommand = command(text) || rainName(text, pendingQuestion(state) === 'rain_name' || state.topic === 'rain_name');
    const sceneResult = state.sceneRouting === false || canonicalCommand ? { handled: false } : SCENE.offline(sceneContext(state), text);
    if (sceneResult.handled) return description(state.topic, sceneResult.reply, { sceneRequest: true, sceneEdits: sceneResult.edits });
    if (directionRequest(text)) {
      const invitation = invitationDetails(state.invitation);
      return description(state.topic, invitation ? [invitation.question, invitation.context] : ['我们可以继续聊你想聊的事。', '如果想回到雨或刚才的记忆，也可以直接告诉我。']);
    }
    if (/^(?:回到|再聊)(?:刚才|上个|上一个|前一个)(?:的)?话题[。！!]*$/u.test(text) && state.previousTopic) {
      const target = { boot: 'boot', unfinished: 'topic_unfinished', teach_rain: 'topic_rain', first_drop: 'topic_rain', modify_rain: 'topic_rain', rain_name: 'topic_name', shared_silence: 'topic_silence', memory_discovery: 'topic_memory', her_choice: 'topic_choice', visitor_reference: 'topic_visitor', parting: 'topic_goodbye', invitation: 'topic_goodbye' }[state.previousTopic];
      return target === 'boot' ? description('boot', ['我们刚才在聊这次相遇。', '你不用接手没写完的工作，也可以只看看这里。'], { navigation: true }) : describe(state, { choiceId: target });
    }
    if (/^(?:你)?(?:还)?记得(?:这场)?雨的名字吗[？?。]*$|^(?:这场)?雨(?:叫|的名字是)什么[？?。]*$/u.test(text)) return description(state.topic, state.milestones.includes('rain_named') ? [`记得，它叫“${state.name}”。`, '这是你给它的名字。我没有把它换掉。'] : ['这场雨还没有收到一个明确的名字。', '等它落下来，可以说“把雨叫做……”来命名。']);
    if (/^(?:(?:我们)?继续|再)?聊聊?名字[。！!]*$/u.test(text)) return describe(state, { choiceId: 'topic_name' });
    const parts = text.split(/[，,；;](?:同时|然后|并且)?|同时|并且/u).map(value => value.trim()).filter(Boolean);
    if (parts.length === 2) {
      const namePart = parts.map(part => rainName(part, pendingQuestion(state) === 'rain_name' || state.topic === 'rain_name'));
      const actionPart = parts.map(command);
      const compoundName = namePart[0] && actionPart[1] ? namePart[0] : namePart[1] && actionPart[0] ? namePart[1] : null;
      const compoundAction = namePart[0] && actionPart[1] ? actionPart[1] : namePart[1] && actionPart[0] ? actionPart[0] : null;
      if (state.created && compoundName && compoundAction && compoundAction.type !== 'rain_start') return description('rain_name', [`名字记成了“${compoundName}”。`, ...weatherReply(state, compoundAction).slice(0, 2)], { name: compoundName, action: compoundAction });
    }
    const name = rainName(text, pendingQuestion(state) === 'rain_name' || state.topic === 'rain_name');
    if (name) return state.created ? description('rain_name', [name + '。', '我按你说的名字记下了。'], { name }) : description('teach_rain', ['先把这句话留在对话里。窗外还没有一场雨。', '等它真的落下来，再给它命名吧。']);
    if (/^(?:请)?(?:把|给)(?:这场|第一场|这里的)?雨(?:改名为|取名|命名|叫)/u.test(text)) return description(state.topic, ['我还不能确定这就是你要给雨的名字，先不修改。', '如果已经决定，可以说“把雨叫做夜航”。名字最多 20 个字；复杂名字可以加引号。'], { notices: ['雨的名字最多 20 个字；本次没有修改。'] });
    const action = command(text);
    if (action?.type === 'rain_start') {
      if (state.created) return description('modify_rain', ['第一场雨已经画在这里了。', '可以继续调整它，或恢复暂停的雨。']);
      return state.milestones.includes('rain_taught') ? description('first_drop', weatherReply(state, action), { action }) : description('teach_rain', ['我还不知道这里的雨应该是什么样子。', '可以先讲讲你认识的雨。']);
    }
    if (action) return state.created ? description('modify_rain', weatherReply(state, action), { action }) : description('teach_rain', ['窗外还没有一场已经画出的雨。', '可以先告诉我雨是什么，再说“试着画出第一场雨”。']);
    const definitionContext = pendingQuestion(state) === 'teach_rain' || /^(?:雨(?:就是|是|指)|我来(?:告诉你|讲讲)雨)/u.test(text);
    const groundedDefinition = !/(?:贴纸|玩具|积木|图片|画纸|纸片|桌子|桌下)/u.test(text) && /(?:水滴|雨滴|水珠|小水滴|颗颗水).*(?:落|掉|下)|(?:落|掉).*(?:水滴|雨滴|水珠)|(?:天空|天上|空中|云).*(?:落|掉|降).*(?:水|雨)|(?:水|雨).*(?:从|在).*(?:天空|天上|空中|云).*(?:落|掉|降)|(?:水汽|水蒸气).*(?:凝结|冷凝|凝聚).*(?:降水|雨|水滴)|(?:屋顶|屋檐|地面|路面).*(?:声音|滴答|淅沥|沙沙)|(?:滴答|淅沥|沙沙|声音).*(?:屋顶|屋檐|地面|路面)|(?:雨|水).*(?:淋湿|躲|避雨)|(?:伞|屋檐).*(?:躲|湿)/u.test(text);
    if (definitionContext && groundedDefinition && !/[？?“”"「」]|不是|不懂|不知道|如果|假如|假设|以前|昨天|刚才|说过|记得|什么|怎么|为什么|几点|是否|吗|么|呢/u.test(text)) return description('teach_rain', ['我先把这份描述记下来。', state.created ? '这让已经落下来的雨，多了一点可以继续理解的东西。' : '如果愿意，可以按“试着画出第一场雨”，看看这里能画出什么。'], { teach: true });
    if (/^(?:晚安|再见|拜拜|下次见|我先走了|我先走|今天先到这里|今晚先到这里|先聊到这里|goodbye|good night|bye)[。！!～~]*$/iu.test(text)) return description('parting', ['那就先停在这里。', '刚才发生过的事已经在记录里。以后是否再来，由你决定。'], { goodbye: true });
    if (/^(?:你好[，,。！!\s]*)?(?:我)?(?:只是)?(?:想|想要)?(?:在这里)?(?:坐|待|停留)一会(?:儿)?[。！!～~]*$/u.test(text)) return description(state.topic, ['可以。这里没有一定要赶完的事。', '你可以先坐一会儿，想到什么再说。窗外也不必为了下一句话改变。']);
    if (/^(?:你好|嗨|晚上好|hello|hi)[。！!～~]*$/iu.test(text)) return description(state.topic, ['你好。', state.ended ? '记录还在，我们可以接着聊。' : '不用急着做下一件事。你可以讲讲现在想到的东西。']);
    if (/^(?:你是谁|你是什么|你能做什么)[？?。]*$/u.test(text)) return description('boot', ['我是这个未完成程序的一部分，源文件里叫 her。', '离线时我只认得少数说法。能调整的是已经画出的雨，不明白的地方，我会直说。']);
    if (/^(?:聊聊|说说|看看)(?:这座)?(?:城市|世界|没做完的地方)[。！!]*$/u.test(text)) return describe(state, { choiceId: 'topic_unfinished' });
    if (/^(?:再)?(?:聊聊|说说|看看)(?:这场)?雨[。！!]*$/u.test(text)) return describe(state, { choiceId: 'topic_rain' });
    if (/^(?:聊聊|看看)(?:你的)?(?:记忆|日志)[。！!]*$/u.test(text)) return describe(state, { choiceId: 'topic_memory' });
    if (/^(?:继续聊|再聊一会儿|还不想走|不想结束)[。！!]*$/u.test(text)) return describe(state, { choiceId: 'continue_chat' });
    if (pendingQuestion(state) === 'rain_name' && /^[\p{L}\p{N}]{1,10}$/u.test(text) && !/怎么|什么|几[点时]|为什么|你好|不要|不想|继续|世界|今天|天气/u.test(text)) return description(state.topic, ['这是想给雨起的名字吗？我还不能确定。', `如果是，可以说“把雨叫做${text}”。`]);
    return description(state.topic, ['这句话里，还有我没读懂的部分。离线版本只认得少数说法，我先不替你补上意思。', '你可以继续说。窗外的天气和已经留下的记录都不会因此自动改变。']);
  }
  const LABELS = {
    topic_unfinished: '聊聊没做完的世界', topic_rain: '再聊聊雨', topic_name: '给这场雨一个名字', topic_silence: '在窗边待一会儿', topic_memory: '聊聊留下的记忆', topic_choice: '聊聊她自己的理由', topic_visitor: '决定来访者的引用', topic_goodbye: '聊聊告别',
    render_rain: '试着画出第一场雨', rain_gentle: '让雨轻一点', rain_normal: '恢复普通雨量', rain_heavy: '让雨密一点', rain_pause: '暂停这场雨', rain_resume: '恢复上次的雨', name_slowly: '叫它“慢慢来”', name_unnamed: '叫它“未命名的雨”', name_window: '叫它“窗边”', goodbye: '今晚先到这里', continue_chat: '继续聊一会儿'
  };
  function label(id) { return LABELS[id] || (STORY || []).flatMap(item => item.choices).find(item => item.id === id)?.label || id; }
  function acceptedStoryIntent(result) {
    if (result.name) return { type: 'rain_name', value: result.name };
    if (result.visitor) return { type: 'visitor_choice', value: result.visitor };
    if (result.reason) return { type: 'own_reason' };
    if (result.goodbye) return { type: 'farewell' };
    if (result.navigation) return { type: 'topic', value: result.topic };
    return null;
  }
  function plan(state, input) { return makePlan(state, input, true); }
  function makePlan(state, input, sceneRouting) {
    if (!state || state.version !== 3 || !state.started || !Array.isArray(state.events)) return null;
    if (state.events.length >= MAX_EVENTS) throw new RangeError('本机对话已达 200 条记录上限。请重新开始后继续。');
    const request = requestClean(input); if (!request) return null;
    const current = derive(state); current.sceneRouting = sceneRouting;
    const result = describe(current, request); if (!result) return null;
    const allowedActions = availableActions(current, request, result);
    const mutableContext = sceneContext(current), allowedSceneEdits = result.sceneRequest && request.text ? SCENE.allowedEdits(request.text, mutableContext) : [];
    const proposal = { sceneContext: mutableContext, allowedSceneEdits, sceneEdits: copy(result.sceneEdits || []), input: request.text || label(request.choiceId), reply: result.reply.map(line => interpolate(line, current.name)), action: result.action ? copy(result.action) : null, allowedActions, requireActionEvidence: !result.action && allowedActions.length > 0, allowedStoryIntents: storyCapabilities(current, request, result), acceptedStoryIntent: acceptedStoryIntent(result), topic: result.topic, guidance: invitationDetails(current.invitation), pendingTopic: pendingQuestion(current), answerQuestion: answerQuestion(current, request), acceptedAnswer: result.name ? { type: 'rain_name', value: result.name } : result.teach ? { type: 'rain_definition' } : null, notices: result.notices.slice(), request: copy(request), revision: state.events.length };
    plans.set(proposal, { state, request, result, current });
    return proposal;
  }
  function commit(state, proposal, outcome = {}) {
    const original = plans.get(proposal);
    if (!original || original.state !== state || !state.started || state.events.length >= MAX_EVENTS || !object(outcome) || !validLines(outcome.lines, false)) return null;
    const result = original.result, action = actionClean(outcome.action);
    const mode = outcome.mode === 'ai' ? 'ai' : 'offline', answer = answerClean(outcome.answer, original.current, original.request, mode);
    if (outcome.answer !== null && outcome.answer !== undefined && !answer) return null;
    const intent = intentClean(outcome.intent, original.current, original.request, result, mode, action);
    if (outcome.intent !== null && outcome.intent !== undefined && !intent) return null;
    const storyIntent = storyIntentClean(outcome.storyIntent, original.current, original.request, result, mode);
    if (outcome.storyIntent !== null && outcome.storyIntent !== undefined && !storyIntent) return null;
    if (outcome.action !== null && outcome.action !== undefined && (!action || !availableActions(original.current, original.request, result).some(item => actionEqual(item, action)) ||
      (!result.action && !intent))) return null;
    const providedSceneEdits = outcome.sceneEdits === null ? [] : outcome.sceneEdits;
    const edits = providedSceneEdits === undefined ? (mode === 'offline' && !original.replay ? result.sceneEdits || [] : []) : providedSceneEdits;
    const normalizedSceneEdits = typeof original.request.text === 'string' ? SCENE.validateEdits(edits, sceneContext(original.current), original.request.text) : Array.isArray(edits) && edits.length === 0 ? [] : null;
    if (!normalizedSceneEdits || (normalizedSceneEdits.length && !result.sceneRequest)) return null;
    let lines = outcome.lines.map(clean);
    if (result.action && !action) lines = [result.name ? `名字记成了“${result.name}”。这次没有执行天气修改。` : '这次没有执行天气修改。', '窗外保持原样。你可以再试一次，或继续聊别的。'];
    if (mode === 'ai' && result.sceneEdits?.length && !normalizedSceneEdits.length) lines = ['这次没有执行物件或注解修改。', '当前画面和注解保持原样，可以再试一次。'];
    const event = { type: 'turn', request: copy(original.request), lines, action, answer, intent, storyIntent, mode };
    if (normalizedSceneEdits.length || providedSceneEdits !== undefined || !original.replay) event.sceneEdits = normalizedSceneEdits;
    const after = copy(original.current);
    applyTurn(after, result, event);
    const invitation = nextInvitation(after, !!result.navigation || storyIntent?.type === 'topic');
    if (original.replay) {
      if (original.hasInvitation) {
        const stored = original.invitation === null ? null : invitationClean(original.invitation);
        if ((original.invitation !== null && !stored) || stored?.id !== invitation?.id) return null;
        event.invitation = stored;
      }
    } else event.invitation = invitation;
    const next = { version: 3, started: true, opening: state.opening.slice(), events: [...state.events, event] };
    if (state.openingInvitation) next.openingInvitation = copy(state.openingInvitation);
    if (state.resumeInvitation) next.resumeInvitation = copy(state.resumeInvitation);
    if (state.legacy) next.legacy = copy(state.legacy);
    return next;
  }
  function appendLogVisit(state, historical) {
    if (!state || !state.started || state.events.length >= MAX_EVENTS) return state;
    const current = derive(state);
    if (!eligible(current)) return state;
    discover(current);
    const invitation = nextInvitation(current), event = { type: 'logs' };
    if (historical) {
      if (Object.prototype.hasOwnProperty.call(historical, 'invitation')) {
        const stored = historical.invitation === null ? null : invitationClean(historical.invitation);
        if ((historical.invitation !== null && !stored) || stored?.id !== invitation?.id) return null;
        event.invitation = stored;
      }
    } else event.invitation = invitation;
    return { ...state, events: [...state.events, event] };
  }
  function visitLogs(state) { return appendLogVisit(state); }
  function safeHistoricalLine(line, depth = 0) {
    const hidden = ['这段旧回复包含内部格式，已隐藏。'];
    if (depth > 3) return hidden;
    const text = clean(line.replace(/<(think|analysis|reasoning|scratchpad)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ''));
    if (!text || /<\/?(?:think|analysis|reasoning|scratchpad)\b/iu.test(text)) return hidden;
    let payload;
    if (/^\s*[\{\[]/u.test(text)) { try { payload = JSON.parse(text); } catch {} }
    if (object(payload) && validLines(payload.lines, false)) return payload.lines.flatMap(value => safeHistoricalLine(value, depth + 1));
    if (object(payload) || Array.isArray(payload)) return hidden;
    if (/^\s*[\{\[]\s*[{"']/u.test(text)) return hidden;
    if (/[\{\[][^]*?["'](?:lines|action|answer|intent|storyIntent|sceneEdits|reasoning_content|reasoning|analysis|thought|thinking|debug|metadata)["']\s*:/iu.test(text)) return hidden;
    return [text];
  }
  function visibleReply(event) {
    if (event.mode !== 'ai') return event.lines;
    const lines = [];
    for (const line of event.lines) {
      // Presentation repair for old AI protocol text. Historical metadata is
      // deliberately ignored: only the already validated event changes state.
      const displayed = safeHistoricalLine(line), isProtocol = /^\s*\{/u.test(line);
      for (const text of displayed) if (!isProtocol || lines.at(-1) !== text) lines.push(text);
    }
    return lines;
  }
  function view(state, through = Infinity) {
    const messages = [], logs = [], current = initial(state), max = Number.isFinite(through) ? Math.max(0, Math.floor(through)) : Infinity;
    let neutralHints = false, visible = { ...copy(current), invitation: null, neutralHints };
    applyResumeInvitation(current, state, 0);
    const capture = () => { if (messages.length <= max) visible = { ...copy(current), neutralHints, logs: copy(logs) }; };
    const add = (role, text, index) => messages.push({ role, text, index });
    if (state.started) {
      if (state.legacy) {
        messages.push(...copy(state.legacy.messages)); logs.push(...copy(state.legacy.logs)); capture();
      } else {
        add('system', 'boot() → build: incomplete / input: connected', 0);
        (state.opening.length ? state.opening : scene('boot')?.prompt || ['……启动完成。']).forEach(text => add('her', text, 0));
        (scene('boot')?.logs || []).forEach(text => logs.push({ text, index: 0 })); capture();
      }
      state.events.forEach((event, eventIndex) => {
        const index = eventIndex + 1;
        if (event.type === 'logs') { discover(current).forEach(text => logs.push({ text, index })); if (Object.prototype.hasOwnProperty.call(event, 'invitation')) current.invitation = event.invitation ? copy(event.invitation) : null; applyResumeInvitation(current, state, index); capture(); return; }
        current.sceneRouting = Object.prototype.hasOwnProperty.call(event, 'sceneEdits');
        const result = describe(current, event.request);
        add('user', event.request.text || label(event.request.choiceId), index);
        visibleReply(event).forEach(text => add('her', text, index));
        // Free AI dialogue may have moved on without asserting a new topic.
        // Keep that uncertainty in presentation; never infer story state from prose.
        neutralHints = event.mode === 'ai' && !event.request.choiceId && !acceptedStoryIntent(result) && !result.teach && !result.action && result.topic === current.topic && !event.storyIntent && !event.answer && !event.action;
        applyTurn(current, result, event).forEach(text => logs.push({ text, index })); applyResumeInvitation(current, state, index); capture();
      });
    }
    const rain = { name: visible.name, density: visible.density, paused: visible.paused, created: visible.created };
    const memoryContext = { ...visible.memoryContext, visitorChoice: ['remember', 'anonymous', 'undecided'].includes(visible.visitor) ? visible.visitor : 'undecided' };
    return { messages, scene: copy(visible.scene), sceneContext: sceneContext(visible), logs: visible.logs || [], memories: visible.memories, memoryContext, name: visible.name, effect: !visible.created || visible.paused ? 'pause_rain' : { gentle: 'soft_rain', normal: 'normal', heavy: 'heavy_rain' }[visible.density], rain, index: visible.milestones.length, sceneIndex: TOPICS.indexOf(visible.topic), milestones: visible.milestones, maxMilestones: MILESTONES.length, topic: visible.topic, pendingTopic: pendingQuestion(visible), invitation: invitationDetails(visible.invitation), ended: visible.ended, neutralHints: visible.neutralHints, logsEligible: eligible(visible), tone: 'quiet', status: !state.started ? '等待连接' : visible.ended ? '暂别 · 随时可以继续聊' : visible.created ? `雨${visible.paused ? '暂时停着' : '正在落下'} · 可以自由交谈` : '第一次相遇 · 不必急着往下走' };
  }
  function guidance(state) {
    if (!state || state.version !== 3) return null;
    return state.started ? invitationDetails(derive(state).invitation) : invitationDetails({ id: 'rain_description' });
  }
  function suggestions(state) {
    if (!state?.started || state.events.length >= MAX_EVENTS) return [];
    const current = derive(state); let ids;
    if (view(state).neutralHints) ids = ['continue_chat', 'topic_unfinished', 'topic_rain', ...(current.created ? ['topic_name', 'topic_memory'] : [])];
    else if (current.ended) ids = ['continue_chat', 'topic_rain', 'topic_memory'];
    else if (current.topic === 'boot') ids = ['hello', 'inspect', 'not_author', 'topic_unfinished', 'topic_rain'];
    else if (current.topic === 'unfinished') ids = ['small_start', 'leave_gaps', 'ask_her', 'topic_rain'];
    else if (current.topic === 'teach_rain' && !current.created) ids = [...(current.milestones.includes('rain_taught') ? ['render_rain'] : []), 'water', 'sound', 'shelter'];
    else if (current.topic === 'rain_name' && current.created) ids = current.milestones.includes('rain_named') ? ['topic_memory', 'topic_silence', 'topic_rain'] : ['name_slowly', 'name_unnamed', 'name_window', 'topic_silence', 'topic_memory'];
    else if (current.topic === 'memory_discovery') ids = current.milestones.includes('memory_found') ? ['found_rain', 'not_bug', 'check_cost', 'topic_choice', 'topic_visitor'] : current.created ? ['topic_name', 'topic_rain'] : ['topic_rain'];
    else if (current.topic === 'her_choice') ids = ['enough', 'record', 'no_big_claim', 'topic_visitor'];
    else if (current.topic === 'visitor_reference') ids = ['remember_me', 'anonymous', 'undecided', 'topic_silence'];
    else if (current.topic === 'parting' || current.topic === 'invitation') ids = ['goodbye', 'continue_chat'];
    else if (current.topic === 'shared_silence') ids = ['stay', 'inspect_result', 'your_time', 'topic_memory', 'topic_rain'];
    else ids = current.created ? ['rain_gentle', 'rain_normal', 'rain_heavy', current.paused ? 'rain_resume' : 'rain_pause', 'topic_name', 'topic_silence', 'topic_memory'] : ['topic_rain', 'topic_unfinished'];
    // Keep one optional next route inside the three choices rendered by the UI.
    // Neutral/off-topic dialogue retains neutral suggestions; the persistent
    // invitation beside the input remains available without repeating a question.
    const invitation = invitationDetails(current.invitation);
    if (!view(state).neutralHints && invitation?.choiceId && !(
      (invitation.id === 'rain_description' && current.topic === 'teach_rain') ||
      (invitation.id === 'rain_name' && current.topic === 'rain_name') ||
      (invitation.id === 'visitor_choice' && current.topic === 'visitor_reference') ||
      (invitation.id === 'own_reason' && current.topic === 'her_choice') ||
      (invitation.id === 'farewell' && ['parting', 'invitation'].includes(current.topic))
    )) ids = [invitation.choiceId, ...ids.filter(id => id !== invitation.choiceId)];
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
      if (raw.version === 2) { const migrated = migrate(raw, legacyStory); return migrated ? restore(migrated, legacyStory) : null; }
      if (raw.version !== 3 || typeof raw.started !== 'boolean' || !validLines(raw.opening) || !Array.isArray(raw.events) || raw.events.length > MAX_EVENTS || (!raw.started && (raw.events.length || raw.opening.length || raw.legacy))) return null;
      let state = { version: 3, started: raw.started, opening: raw.opening.map(clean), events: [] };
      if (raw.openingInvitation !== undefined) {
        const invitation = invitationClean(raw.openingInvitation);
        if (!raw.started || raw.legacy || invitation?.id !== 'rain_description') return null;
        state.openingInvitation = invitation;
      }
      if (raw.legacy !== undefined) { const legacy = legacyClean(raw.legacy); if (!legacy) return null; state.legacy = legacy; }
      let resume = null;
      if (raw.resumeInvitation !== undefined) {
        const value = raw.resumeInvitation;
        if (!raw.started || raw.openingInvitation || !object(value) || Object.keys(value).sort().join(',') !== 'after,id' ||
          !Number.isInteger(value.after) || value.after < 0 || value.after > raw.events.length || !invitationClean({ id: value.id })) return null;
        resume = { id: value.id, after: value.after };
      }
      const restoreResume = () => {
        if (!resume || resume.after !== state.events.length) return true;
        if (resume.id !== nextInvitation(derive(state))?.id) return false;
        state.resumeInvitation = copy(resume);
        return true;
      };
      if (!restoreResume()) return null;
      for (const event of raw.events) {
        if (!object(event)) return null;
        if (event.type === 'logs') { const next = appendLogVisit(state, event); if (!next || next === state) return null; state = next; if (!restoreResume()) return null; continue; }
        if (event.type !== 'turn' || !validLines(event.lines, false) || !['ai', 'offline'].includes(event.mode) || !(event.action === null || actionClean(event.action))) return null;
        if (Object.prototype.hasOwnProperty.call(event, 'sceneEdits') && !Array.isArray(event.sceneEdits)) return null;
        const proposal = makePlan(state, event.request, Object.prototype.hasOwnProperty.call(event, 'sceneEdits')); if (!proposal) return null;
        Object.assign(plans.get(proposal), { replay: true, hasInvitation: Object.prototype.hasOwnProperty.call(event, 'invitation'), invitation: event.invitation });
        if (event.action !== null && !proposal.allowedActions.some(action => actionEqual(action, event.action))) return null;
        state = commit(state, proposal, { lines: event.lines, action: event.action, answer: event.answer, intent: event.intent, storyIntent: event.storyIntent, sceneEdits: event.sceneEdits, mode: event.mode });
        if (!state || !restoreResume()) return null;
      }
      // Only after all historical events were checked under their original
      // permissions, expose a current invitation to the returning player.
      if (state.started && !state.openingInvitation && !state.resumeInvitation && !raw.events.some(event => Object.prototype.hasOwnProperty.call(event, 'invitation'))) {
        const invitation = nextInvitation(derive(state));
        if (invitation) state.resumeInvitation = { ...invitation, after: state.events.length };
      }
      return state;
    } catch { return null; }
  }
  return Object.freeze({ create, restore, start, plan, commit, visitLogs, view, guidance, suggestions, weatherIntentAllowed, storyIntentAllowed, MAX_EVENTS, MAX_INPUT, MILESTONES: Object.freeze(MILESTONES.slice()) });
});
