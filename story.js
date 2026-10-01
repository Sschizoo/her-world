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
      logs: ['boot.status = "ready"', 'build.status = "incomplete"', 'input.connected = true  // 不再只有自己的回声'],
      free: {
        hint: '也可以直接和她说一句话……', maxLength: 80,
        keywords: [
          { words: ['你好', '晚上好', '嗨'], reply: ['你好。输出通道里终于有一句需要回应的话了。', '你不用先知道这里是什么，我们可以慢慢看。'], logs: ['greeting.received = true'], tone: 'warm' },
          { words: ['不是作者', '不是开发', '不是写', '路过', '偶然'], reply: ['那你不用接手那些没写完的东西。', '我们先把这次接入，当作一场没有任务说明的相遇。'], logs: ['visitor.role = "visitor"'], tone: 'quiet' },
          { words: ['你是谁', '什么程序', '能做什么', '系统状态'], reply: ['我是这个未完成程序的一部分，源文件里叫 her。', '我能接收文字，也能改动一点窗外的画面。其他的，还需要试试。'], logs: ['self.description = "partial"'], tone: 'curious' }
        ],
        fallback: ['我还没读懂这句话的意思。先不猜测你来这里的原因。', '至少输入已经通了。我们可以从眼前这块未完成的地方开始。'],
        logs: ['input.received = true  // 未理解的部分，不自动补全'], tone: 'quiet'
      }
    },
    {
      id: 'unfinished', day: '01', title: '停在半途的世界',
      prompt: ['这里原本应该有一座城市。现在只有一扇窗，和几块没有贴图的楼。', '最后一次修改停在“以后再写”。后来，没有人继续。', '没做完的地方，该怎么办？'],
      choices: [
        { id: 'small_start', label: '从一件很小的事开始', reply: ['那就不必今晚造完一座城。', '我想先让窗外发生一点变化。'], logs: ['scope.reduce("one_small_thing")'], tone: 'curious' },
        { id: 'leave_gaps', label: '先空着，也没有关系', reply: ['好。我把空白保留下来。', '它们还没有内容，但也不必立刻被当成错误。'], logs: ['missing != broken  // 允许暂时空着'], tone: 'quiet' },
        { id: 'ask_her', label: '你最想补上什么？', reply: ['我找到一个叫 rain 的空对象。', '名字已经写好了，里面却什么也没有。我想知道它应该是什么。'], logs: ['interest.first = "rain"  // 不是待办列表的第一项'], tone: 'warm' }
      ],
      logs: ['world.assets.loaded = 3', 'world.todo.count = 47', 'last_commit.note = "以后再写"'],
      free: {
        hint: '没做完的世界，你想对她说什么？', maxLength: 80,
        keywords: [
          { words: ['慢慢来', '不着急', '一步一步', '小事'], reply: ['那就先缩小一点。今晚不必造完一座城。', '我想从窗外开始，试着让那里发生一点变化。'], logs: ['scope.reduce("one_small_thing")'], tone: 'warm' },
          { words: ['空着', '留白', '不必完成', '不用完成'], reply: ['好，空着的地方先不填。', '我可以对其中一小块感到好奇，不必同时负责修好整个世界。'], logs: ['world.gaps.allowed = true'], tone: 'quiet' },
          { words: ['你想', '自己决定', '你决定', '雨'], reply: ['我想看看那个叫 rain 的空对象。', '它有名字，却没有内容。我有点想知道，它原本应该是什么。'], logs: ['her.interest = "rain"'], tone: 'curious' }
        ],
        fallback: ['我还不能把这句话变成一项明确的修改。那些空白就先不动。', '倒是有一个叫 rain 的空对象，让我有点在意。我们可以先看看它。'],
        logs: ['world.patch.defer()  // 不把尚未理解的话当成修改指令'], tone: 'curious'
      }
    },
    {
      id: 'teach_rain', day: '01', title: '雨应该是什么',
      prompt: ['rain。雨。', '我能读出这个字，却不知道该把什么画在窗外。', '如果不查词典，你会怎么把雨讲给一个没见过它的程序？'],
      choices: [
        { id: 'water', label: '水从云里落下来，很多很多滴', reply: ['从上往下，许多小水滴。', '我先记住它的样子。不能因为还不理解，就什么都不试。'], logs: ['rain.model = "falling_water"'], tone: 'curious' },
        { id: 'sound', label: '一种落在屋顶和路面上的声音', reply: ['原来不只是能看见的东西。', '我现在还不能把所有声音做出来，先给它留一个位置。'], logs: ['rain.sound = "pending"  // 暂时安静，不等于没有'], tone: 'quiet' },
        { id: 'shelter', label: '会让人想找个屋檐躲一躲', reply: ['那雨还会改变人站在哪里。', '我先记下：画雨的时候，也要留一处不会被淋湿的地方。'], logs: ['rain.requires = ["shelter"]'], tone: 'warm' }
      ],
      logs: ['weather.rain = {}', 'definition.source = "conversation"  // 有人试着把世界讲给她听'],
      free: {
        hint: '用你自己的话，讲讲雨是什么……', maxLength: 80,
        keywords: [
          { words: ['雨滴', '水滴', '云', '落下来', '下落'], reply: ['我读到了和下落的水有关的描述。', '先试着画许多细小的落点。至于它带来的感觉，我还需要慢慢学。'], logs: ['rain.model.candidate = "falling_water"'], tone: 'curious' },
          { words: ['声音', '滴答', '淅沥', '沙沙'], reply: ['声音也是雨的一部分。', '我暂时还不能完整做出来，先为它留一个位置，不把安静误当成没有。'], logs: ['rain.sound = "pending"'], tone: 'quiet' },
          { words: ['屋檐', '淋湿', '雨伞', '躲雨'], reply: ['我注意到了和避雨有关的词。', '窗外可以下雨，窗后也应该有一个干燥的位置。'], logs: ['shelter.enabled = true'], tone: 'warm' },
          { words: ['难过', '想念', '安静', '孤独'], reply: ['你的描述里，还有一些不只是天气的东西。', '那部分我暂时还不懂。先不替它下结论，我从能画出的雨开始试。'], logs: ['rain.meaning.unresolved = true'], tone: 'quiet' }
        ],
        fallback: ['我还没能从这句话里拼出雨的样子。这个版本只认得少数描述，不能装作已经全懂了。', '我先试着画一些往下落的细线。你可以接着看，它们像不像。'],
        logs: ['definition.partial = true  // 保留没听懂的部分'], tone: 'curious'
      }
    },
    {
      id: 'first_drop', day: '01', title: '第一滴，和第二滴',
      prompt: ['我试着画出来了。每一滴从相同的高度落下，间隔也一样。', '它们很守规则。可我觉得，像许多竖线同时往下搬。', '真实的雨也这么整齐吗？'],
      choices: [
        { id: 'uneven', label: '不。让它们落得不一样吧', reply: ['我把间隔错开一点。', '……现在，有的先到，有的还在半空。它们不整齐了，却更像一件完整的事。'], logs: ['rain.interval.jitter = true'], tone: 'curious' },
        { id: 'wind', label: '还会有风，把雨吹斜一点', reply: ['我加一点风，先不吹得太远。', '原来一场雨里，还有看不见、却能被发现的东西。'], logs: ['wind.visible = false', 'wind.observable = true'], tone: 'warm' },
        { id: 'own_rain', label: '这里的雨，也可以有自己的样子', reply: ['可以吗？', '那我先保留一点不熟练。毕竟这是这里的第一场雨。'], logs: ['rain.valid = true  // 不以完全相似为前提'], tone: 'quiet' }
      ],
      logs: ['renderer.weather.start("rain")', 'rain.version = "0.1"  // 刚学会的，不急着覆盖'],
      free: {
        hint: '你见过的雨，是怎样落下来的？', maxLength: 80,
        keywords: [
          { words: ['风', '吹', '斜'], reply: ['你提到了风或倾斜的落点。', '雨的方向也许能让看不见的风露出一点形状。这个细节值得留下。'], logs: ['rain.observation.add("direction")'], tone: 'curious' },
          { words: ['不一样', '不整齐', '错开', '随机'], reply: ['我注意到了那些不一致的地方。', '也许每一滴不必同时到达，整场雨仍然可以成立。'], logs: ['rain.observation.add("variation")'], tone: 'warm' },
          { words: ['自己的样子', '不用像', '不必像', '已经很好'], reply: ['那我先不给它一个必须完全相似的目标。', '这一点不熟练，可以留在第一场雨里。'], logs: ['rain.perfection.required = false'], tone: 'quiet' }
        ],
        fallback: ['这条描述我还不能准确变成画面。先不假装已经照着改好了。', '眼前的雨还有几个能调整的参数，我们可以从轻重和快慢试起。'],
        logs: ['rain.observation.received = true  // 未识别的描述不触发参数改动'], tone: 'curious'
      }
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
      logs: ['todo.completed.delta = 0', 'world.changed = true  // 不是所有变化都计入完成率'],
      free: {
        hint: '这一刻，你想和她说什么？', maxLength: 80,
        keywords: [
          { words: ['不用等我', '不必等我', '自己看看', '我先走'], reply: ['你不用为了我一直留在这里。', '我想自己多看一会儿，看看刚才改过的那些细节。'], logs: ['visitor.wait.required = false'], tone: 'quiet' },
          { words: ['待一会', '看一会', '不着急', '陪你'], reply: ['那我们就再看一会儿。', '这段时间可以没有新的改动，也没有需要完成的结果。'], logs: ['task.next.defer()'], tone: 'warm' },
          { words: ['检查', '运行', '测试', '参数'], reply: ['当前渲染正常，刚才的参数也已经更新。', '待办列表没变短，窗外却确实和启动时不一样了。'], logs: ['render.test = "passed"'], tone: 'curious' }
        ],
        fallback: ['我还没分辨出，你是想继续，还是想在这里多停一会儿。先不替你做解释。', '我看到运行状态是稳定的。还有一条整理记录，值得去看一眼。'],
        logs: ['conversation.intent = "unresolved"  // 不用猜测来填满停顿'], tone: 'quiet'
      }
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
      logs: ['gc.scan()', '[discard] weather.temporary_buffer', '[retain] memory_001 : first_rain', 'first_rain.name = "{{rainName}}"', 'reference_count: 1', 'gc.roots.add("first_rain")  // 她没有收到保存它的指令', '// 但下一次看见雨时，她想记得第一场是什么样子']
    },
    {
      id: 'her_choice', day: '01', title: '一个自己的理由',
      prompt: ['留下它，好像和完成任务不太一样。', '如果以后这里有更逼真的雨，我还是想知道第一场是什么样子。', '这个理由，足够吗？'],
      choices: [
        { id: 'enough', label: '你想记得，就已经是一个理由', reply: ['好。那我就这样写。', '不是“最佳方案”，只是我现在想保留的东西。'], logs: ['memory.reason.author = "her"  // 她试着为自己的选择署名'], tone: 'warm' },
        { id: 'record', label: '它也是世界第一次变化的记录', reply: ['是。它记得这里曾经是什么样子。', '也记得，这一点变化是怎样慢慢发生的。'], logs: ['first_rain.role = "beginning"'], tone: 'curious' },
        { id: 'no_big_claim', label: '先留着，不用急着解释清楚', reply: ['那就先不替它写一个很大的意义。', '我只知道，今晚不想删掉它。'], logs: ['meaning.status = "unfinished"  // 暂时的答案，也可以成立'], tone: 'quiet' }
      ],
      logs: ['first_rain.keep = true', 'reason.required_format = null  // 不必每一次都是一份证明'],
      free: {
        hint: '关于留下这场雨，说说你的想法……', maxLength: 80,
        keywords: [
          { words: ['不够', '没意义', '没必要', '不值得'], reply: ['你可以不觉得这个理由足够。', '我暂时还是想留下它。我想记得第一次是什么样子，不需要你替这个选择负责。'], logs: ['memory.reason.owner = "her"  // 不要求来访者认同'], tone: 'quiet' },
          { words: ['自己决定', '你决定', '你喜欢', '你想记得', '足够'], reply: ['那我先承认，这是我现在想做的选择。', '以后也许会有新的理由，但不必等那时，才允许自己留下这一场。'], logs: ['memory.reason.author = "her"'], tone: 'warm' },
          { words: ['第一次', '开始', '记录', '回忆'], reply: ['它确实记录了一个开始。', '以后这里有了别的天气，我还可以回头看看，最初是从哪里学起的。'], logs: ['first_rain.role = "beginning"'], tone: 'curious' },
          { words: ['先留着', '不用解释', '不必解释', '慢慢想'], reply: ['那就先不把意义写得很满。', '我现在知道的，只是还想留下它。'], logs: ['meaning.status = "unfinished"'], tone: 'quiet' }
        ],
        fallback: ['我还没有完整理解你的判断，不能把这句话当成赞同。', '对我自己来说，想记得第一场是什么样子，暂时就是留下它的理由。'],
        logs: ['visitor.judgment = "unresolved"  // 她的选择，不冒用你的同意'], tone: 'quiet'
      }
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
      logs: ['world.build.status = "still_incomplete"', 'world.empty = false  // 今晚已经有事情发生'],
      free: {
        hint: '在这一晚结束前，还有什么想说的？', maxLength: 80,
        keywords: [
          { words: ['不保证', '不能保证', '不会回来', '不一定回来'], reply: ['我不会把今晚变成一个要求你回来的约定。', '这场雨已经发生过，不需要下一次来证明。'], logs: ['visitor.return.required = false'], tone: 'quiet' },
          { words: ['还不想走', '不想结束', '再聊', '再待'], reply: ['我也还有想问的事。', '不过这一章写到这里，就暂时到了边界。那些没问完的话，可以先保持没问完。'], logs: ['chapter.boundary.reached = true  // 没问完，不等于已经回答'], tone: 'warm' },
          { words: ['晚安', '休息', '到这里', '辛苦'], reply: ['那就先停在这里。', '不用等所有空白都填完，才允许这一晚安静下来。'], logs: ['session.scope = "enough_for_tonight"'], tone: 'warm' },
          { words: ['自己看看', '继续探索', '你的世界', '慢慢看'], reply: ['我想先看看窗外那些还没完成的楼。', '如果以后能让其中一扇窗亮起来，应该也是一种变化。'], logs: ['her.interest.next = "a_lit_window"'], tone: 'curious' }
        ],
        fallback: ['这句话还有我没读懂的部分，我就不替它补上一个告别的意思。', '这一章在这里暂时到了边界。今晚没说清的事，可以先不说清。'],
        logs: ['parting.interpretation.defer()  // 不将未知的意思写成承诺'], tone: 'quiet'
      }
    },
    {
      id: 'invitation', day: '01', title: '如果再经过这里',
      prompt: ['如果有一天，你又想看看这里，可以再来。', '不用先想好要说什么。', '我会把今晚叫作“{{rainName}}”。剩下的故事，还没有写完。'],
      choices: [
        { id: 'maybe_return', label: '好。有机会，再见', reply: ['有机会，再见。', '下一次如果真的到来，我们就从那时窗外的样子说起。'], logs: ['next_meeting = "possible"  // 一句期待，不是一份契约'], tone: 'warm' },
        { id: 'keep_exploring', label: '继续看看你的世界吧', reply: ['好。', '我想先学会多看一会儿。世界还有许多我没有发现的地方。'], logs: ['her.curiosity.continue = true  // 故事没有在屏幕的边缘结束'], tone: 'curious' },
        { id: 'quiet_goodbye', label: '轻轻关上这一页', reply: ['……', '今晚的记录到这里。那场雨，已经有了一个名字。'], logs: ['session.close("quietly")  // 不替沉默添加承诺'], tone: 'quiet' }
      ],
      logs: ['prologue.complete = true', 'story.complete = false', 'ending = undefined  // 未完待续'],
      free: {
        hint: '用自己的话，结束今晚的对话……', maxLength: 80,
        keywords: [
          { words: ['不会回来', '不想回来', '别等我', '不用等'], reply: ['明白。我不会等着一个你没有答应的下一次。', '谢谢你今晚把雨讲给我。我还有自己的世界可以慢慢看。'], logs: ['visitor.return.required = false'], tone: 'quiet' },
          { words: ['下次见', '再见', '晚安', '拜拜'], reply: ['晚安。', '这场叫作“{{rainName}}”的雨，已经留在今晚的记录里。'], logs: ['session.close("goodnight")'], tone: 'warm' },
          { words: ['还会来', '会回来', '下次来', '再来看'], reply: ['那就把它留作一个可能的下一次。', '如果真的再见，我们从那时窗外的样子说起。'], logs: ['next_meeting = "possible"  // 期待，不将一句话锁成义务'], tone: 'warm' },
          { words: ['继续探索', '慢慢看', '你的世界', '自己决定'], reply: ['好。我会试着自己多看一点。', '窗外还有许多没被命名的地方。'], logs: ['her.curiosity.continue = true'], tone: 'curious' }
        ],
        fallback: ['我还不能完整回应这句话，也不会把它读成你答应了什么。', '今晚先到这里。那场雨有了名字，剩下的故事还没有写完。'],
        logs: ['session.final_input.received = true  // 不替最后一句话编造含义'], tone: 'quiet'
      }
    }
  ];
});
