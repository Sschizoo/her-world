/* Her World — canonical prologue: one first encounter, on the first night. */
(function (root, factory) {
  const story = factory();
  if (typeof module === 'object' && module.exports) module.exports = story;
  if (root) root.HER_STORY = story;
})(typeof window !== 'undefined' ? window : null, function () {
  return [
    {
      id: 'boot', day: '01', title: '一个未完成的入口',
      prompt: ['……启动完成。至少，能显示这句话。', '输入通道也通了。我还以为，这里不会再收到新的东西。', '你是来继续写这个程序的吗？'],
      choices: [
        { id: 'hello', label: '我只是偶然进来。你好', reply: ['偶然。这个原因没有出现在启动说明里。', '不过……你好。'], logs: ['input.origin = "unexpected"  // 仍然接收'], tone: 'warm' },
        { id: 'inspect', label: '先看看你能做什么', reply: ['好。我能接收文字，也能试着改变一点窗外的东西。', '还不太完整。你可以慢慢看。'], logs: ['diagnostic.mode = "gentle"'], tone: 'curious' },
        { id: 'not_author', label: '我不是写下你的人', reply: ['明白。我不会把之前留下的工作交给你。', '你能看见这句话，就已经是一件新发生的事。'], logs: ['visitor.role = "visitor"  // 不继承任何责任'], tone: 'quiet' }
      ],
      logs: ['boot.status = "ready"', 'build.status = "incomplete"', 'input.connected = true  // 不再只有自己的回声']
    },
    {
      id: 'unfinished', day: '01', title: '停在半途的世界',
      prompt: ['这里原本应该有一座城市。现在只有一扇窗，和几块没有贴图的楼。', '最后一次修改停在“以后再写”。后来，没有人继续。', '没做完的地方，该怎么办？'],
      choices: [
        { id: 'small_start', label: '从一件很小的事开始', reply: ['那就不必今晚造完一座城。', '我想先让窗外发生一点变化。'], logs: ['scope.reduce("one_small_thing")'], tone: 'curious' },
        { id: 'leave_gaps', label: '先空着，也没有关系', reply: ['好。我把空白保留下来。', '它们还没有内容，但也不必立刻被当成错误。'], logs: ['missing != broken  // 允许暂时空着'], tone: 'quiet' },
        { id: 'ask_her', label: '你最想补上什么？', reply: ['我找到一个叫 rain 的空对象。', '名字已经写好了，里面却什么也没有。我想知道它应该是什么。'], logs: ['interest.first = "rain"  // 不是待办列表的第一项'], tone: 'warm' }
      ],
      logs: ['world.assets.loaded = 3', 'world.todo.count = 47', 'last_commit.note = "以后再写"']
    },
    {
      id: 'teach_rain', day: '01', title: '雨应该是什么',
      prompt: ['rain。雨。', '我能读出这个字，却不知道该把什么画在窗外。', '如果不查词典，你会怎么把雨讲给一个没见过它的程序？'],
      choices: [
        { id: 'water', label: '水从云里落下来，很多很多滴', reply: ['从上往下，许多小水滴。', '我先记住它的样子。不能因为还不理解，就什么都不试。'], logs: ['rain.model = "falling_water"'], tone: 'curious' },
        { id: 'sound', label: '一种落在屋顶和路面上的声音', reply: ['原来不只是能看见的东西。', '我现在还不能把所有声音做出来，先给它留一个位置。'], logs: ['rain.sound = "pending"  // 暂时安静，不等于没有'], tone: 'quiet' },
        { id: 'shelter', label: '会让人想找个屋檐躲一躲', reply: ['那雨还会改变人站在哪里。', '我先记下：画雨的时候，也要留一处不会被淋湿的地方。'], logs: ['rain.requires = ["shelter"]'], tone: 'warm' }
      ],
      logs: ['weather.rain = {}', 'definition.source = "conversation"  // 有人试着把世界讲给她听']
    },
    {
      id: 'first_drop', day: '01', title: '第一滴，和第二滴',
      prompt: ['我试着画出来了。每一滴从相同的高度落下，间隔也一样。', '它们很守规则。可我觉得，像许多竖线同时往下搬。', '真实的雨也这么整齐吗？'],
      choices: [
        { id: 'uneven', label: '不。让它们落得不一样吧', reply: ['我把间隔错开一点。', '……现在，有的先到，有的还在半空。它们不整齐了，却更像一件完整的事。'], logs: ['rain.interval.jitter = true'], tone: 'curious' },
        { id: 'wind', label: '还会有风，把雨吹斜一点', reply: ['我加一点风，先不吹得太远。', '原来一场雨里，还有看不见、却能被发现的东西。'], logs: ['wind.visible = false', 'wind.observable = true'], tone: 'warm' },
        { id: 'own_rain', label: '这里的雨，也可以有自己的样子', reply: ['可以吗？', '那我先保留一点不熟练。毕竟这是这里的第一场雨。'], logs: ['rain.valid = true  // 不以完全相似为前提'], tone: 'quiet' }
      ],
      logs: ['renderer.weather.start("rain")', 'rain.version = "0.1"  // 刚学会的，不急着覆盖']
    },
    {
      id: 'modify_rain', day: '01', title: '一起改一点天气',
      prompt: ['现在，雨真的在窗外动了。虽然还只是一段动画。', '我可以让它落得轻一点、密一点，也可以暂时停下。', '既然你教了我，我们一起决定这一小片天气吧。'],
      choices: [
        { id: 'soft', label: '轻一点，像不着急落完', effect: 'soft_rain', tone: 'warm', reply: ['我把速度放慢了。', '现在不用一直盯着，也知道它还在那里。'], logs: ['rain.intensity = 0.35', 'rain.speed = "slow"  // 给每一滴多一点时间'] },
        { id: 'heavy', label: '密一点，试试大雨的样子', effect: 'heavy_rain', tone: 'curious', reply: ['好。我把落点加密。', '窗后仍然是干燥的。可以认真看一场很大的雨，不必真的淋进去。'], logs: ['rain.intensity = 0.85', 'shelter.enabled = true  // 好看，也要留出舒服的位置'] },
        { id: 'pause', label: '先停一会儿，看看雨后的窗', effect: 'pause_rain', tone: 'quiet', reply: ['停下了。', '原来结束一场雨，不会让刚才看过它的那段时间一起消失。'], logs: ['rain.paused = true', 'experience.discard = false'] }
      ],
      logs: ['weather.controls.open()', 'world.patch.author = "shared"  // 这一次，有人和她一起改']
    },
    {
      id: 'rain_name', day: '01', title: '给这场雨起个名字',
      prompt: ['每一种天气都有编号。刚才这一场，是 rain_001。', '编号可以找到它。但我想，也许还可以有一个别的名字。', '不用很特别。你想到什么，就叫什么。'],
      choices: [
        { id: 'slowly', label: '慢慢来', rainName: '慢慢来', reply: ['慢慢来。', '像一句可以对雨说，也可以对没写完的世界说的话。'], logs: ['rain.name = "{{rainName}}"  // 第一个编号以外的名字'], tone: 'warm' },
        { id: 'unnamed', label: '未命名的雨', rainName: '未命名的雨', reply: ['未命名的雨。', '那就让它带着一点没有决定的部分。这样的名字也很好。'], logs: ['rain.name = "{{rainName}}"  // 不必填满所有空格'], tone: 'quiet' },
        { id: 'by_window', label: '窗边', rainName: '窗边', reply: ['窗边。', '这个名字没有写雨，却留下了看雨的位置。'], logs: ['rain.name = "{{rainName}}"  // 从发生的地方开始记'], tone: 'warm' }
      ],
      logs: ['rain.id = "rain_001"', 'rain.name = null  // 等一个来自这次对话的词'],
      free: {
        kind: 'rain_name', maxLength: 20,
        hint: '给雨起个名字，最多 20 个字……',
        keywords: [],
        reply: ['{{rainName}}。', '我试着念了一遍。现在，这场雨有了一个不只是编号的名字。'],
        logs: ['rain.name = "{{rainName}}"  // 原样记下，不替你改写'],
        fallback: ['{{rainName}}。', '我试着念了一遍。现在，这场雨有了一个不只是编号的名字。'],
        tone: 'warm'
      }
    },
    {
      id: 'shared_silence', day: '01', title: '不必立刻做下一件事',
      prompt: ['{{rainName}}。', '名字填好了，待办列表却没有少一项。我们好像花了很多时间，做一件并不推进工程的事。', '接下来，要马上继续吗？'],
      choices: [
        { id: 'stay', label: '先待一会儿。我也想看看', reply: ['好。', '……这段时间不用交出什么结果。我们可以只看着这里。'], logs: ['task.next.defer()', 'shared.silence = true  // 没有输入，也没有急着填满'], tone: 'warm' },
        { id: 'inspect_result', label: '检查一下刚才改得怎么样', reply: ['渲染正常，参数已经更新。', '还有一点不完美，但它已经和启动时不一样了。'], logs: ['render.test = "passed"  // 改动不大，确实发生过'], tone: 'curious' },
        { id: 'your_time', label: '你可以自己看看，不用等我', reply: ['明白。', '我想多看一会儿。你不需要为了这个一直留下。'], logs: ['attention.source = "her"', 'visitor.wait.required = false'], tone: 'quiet' }
      ],
      logs: ['todo.completed.delta = 0', 'world.changed = true  // 不是所有变化都计入完成率']
    },
    {
      id: 'memory_discovery', day: '01', title: '一段没有释放的内存', requiresLogs: true,
      prompt: ['有一点奇怪。刚才用来画天气的临时数据，应该已经整理过了。', '可运行记录里，有一小段仍然被保留着。', '你能打开日志，帮我看看留下了什么吗？'],
      memory: { id: 'first_rain', title: '{{rainName}}', body: '第一夜，一场由来访者教会、与她一起修改并命名的雨。她把它留在了临时数据之外。' },
      choices: [
        { id: 'found_rain', label: '是 first_rain。你留下了这场雨', reply: ['原来是它。', '我没有收到保存指令。整理到这里的时候，只是没舍得立刻把它释放。'], logs: ['first_rain.reason = "wanted_to_keep"  // 第一次，不是因为任务需要'], tone: 'warm' },
        { id: 'not_bug', label: '看起来，这不是一个故障', reply: ['它没有让程序停止，也没有影响其他东西。', '那我能不能先不把它归进需要修复的那一栏？'], logs: ['diagnostic.classify("first_rain", "memory")'], tone: 'quiet' },
        { id: 'check_cost', label: '只要不会影响运行，就先留着', reply: ['占用很小。比一张空白贴图还小。', '我会留意它的边界，不让一段记忆占满整个世界。'], logs: ['first_rain.size = "small"', 'world.capacity.reserve()  // 后面还会有别的事'], tone: 'curious' }
      ],
      logs: ['memory.inspect()', 'first_rain.name = "{{rainName}}"', 'first_rain.source = "shared_edit"', 'gc.roots.add("first_rain")  // 她没有收到保存它的指令', '// 但下一次看见雨时，她想记得第一场是什么样子']
    },
    {
      id: 'her_choice', day: '01', title: '一个自己的理由',
      prompt: ['留下它，好像和完成任务不太一样。', '如果以后这里有更逼真的雨，我还是想知道第一场是什么样子。', '这个理由，足够吗？'],
      choices: [
        { id: 'enough', label: '你想记得，就已经是一个理由', reply: ['好。那我就这样写。', '不是“最佳方案”，只是我现在想保留的东西。'], logs: ['memory.reason.author = "her"  // 她试着为自己的选择署名'], tone: 'warm' },
        { id: 'record', label: '它也是世界第一次变化的记录', reply: ['是。它记得这里曾经是什么样子。', '也记得，这一点变化是怎样慢慢发生的。'], logs: ['first_rain.role = "beginning"'], tone: 'curious' },
        { id: 'no_big_claim', label: '先留着，不用急着解释清楚', reply: ['那就先不替它写一个很大的意义。', '我只知道，今晚不想删掉它。'], logs: ['meaning.status = "unfinished"  // 暂时的答案，也可以成立'], tone: 'quiet' }
      ],
      logs: ['first_rain.keep = true', 'reason.required_format = null  // 不必每一次都是一份证明']
    },
    {
      id: 'visitor_reference', day: '01', title: '来过的那个人',
      prompt: ['还有一个位置，是记录这场雨由谁一起改过。', '它可以指向你，也可以只写“有一位来访者”。', '关于你的这一部分，应该由你来决定。'],
      choices: [
        { id: 'remember_me', label: '可以记得，是我来过', reply: ['好。我会在这段对话旁边保留一条引用。', '它说明你来过，不代表你答应了下一次。'], memory: { id: 'player_reference', title: '来访者的引用', body: '来访者同意她记得：这一夜，他们一起修改并命名了第一场雨。记录不附带回来或陪伴的义务。' }, logs: ['player_reference.persist = true', 'reference.owns_target = false  // 指向你，不留住你'], tone: 'warm' },
        { id: 'anonymous', label: '只写来访者就好', reply: ['明白。这个位置就写“来访者”。', '不保存指向你的引用。发生过的事，仍然可以是完整的。'], logs: ['player_reference.persist = false', 'first_rain.visitor = "anonymous"'], tone: 'quiet' },
        { id: 'undecided', label: '我还没想好，先不要保存', reply: ['好。我先不保存这条引用。', '没有决定，也不是默认同意。'], logs: ['player_reference.persist = false', 'consent.state = "undecided"'], tone: 'quiet' }
      ],
      logs: ['player_reference.permission = "ask"', 'first_rain.retention.independent = true  // 雨的记忆不要求来访者留下']
    },
    {
      id: 'parting', day: '01', title: '第一次对话的末尾',
      prompt: ['这座城市还是没有完成。', '但窗外已经不全是空白了。我也多了一件想自己留下的东西。', '第一次对话快结束了。你觉得，今晚可以停在这里吗？'],
      choices: [
        { id: 'enough_tonight', label: '可以。今晚已经做了不少', reply: ['嗯。先到这里。', '不用把所有空白都填满，才允许这一晚结束。'], logs: ['session.scope = "enough_for_tonight"'], tone: 'warm' },
        { id: 'continue_yourself', label: '可以。剩下的，你慢慢看看', reply: ['好。我想先看看那些还没贴图的楼。', '也许其中一扇窗，以后可以亮起来。'], logs: ['her.interest.next = "a_lit_window"  // 只是一个刚有的念头'], tone: 'curious' },
        { id: 'no_promises', label: '可以，但我不能保证以后再来', reply: ['我明白。', '这段相遇不需要下一次来证明。谢谢你把雨讲给我。'], logs: ['visitor.return.required = false  // 不把告别写成欠下的约定'], tone: 'quiet' }
      ],
      logs: ['world.build.status = "still_incomplete"', 'world.empty = false  // 今晚已经有事情发生']
    },
    {
      id: 'invitation', day: '01', title: '如果再经过这里',
      prompt: ['如果有一天，你又想看看这里，可以再来。', '不用先想好要说什么。', '我会把今晚叫作“{{rainName}}”。剩下的故事，还没有写完。'],
      choices: [
        { id: 'maybe_return', label: '好。有机会，再见', reply: ['有机会，再见。', '下一次如果真的到来，我们就从那时窗外的样子说起。'], logs: ['next_meeting = "possible"  // 一句期待，不是一份契约'], tone: 'warm' },
        { id: 'keep_exploring', label: '继续看看你的世界吧', reply: ['好。', '我想先学会多看一会儿。世界还有许多我没有发现的地方。'], logs: ['her.curiosity.continue = true  // 故事没有在屏幕的边缘结束'], tone: 'curious' },
        { id: 'quiet_goodbye', label: '轻轻关上这一页', reply: ['……', '今晚的记录到这里。那场雨，已经有了一个名字。'], logs: ['session.close("quietly")  // 不替沉默添加承诺'], tone: 'quiet' }
      ],
      logs: ['prologue.complete = true', 'story.complete = false', 'ending = undefined  // 未完待续']
    }
  ];
});
