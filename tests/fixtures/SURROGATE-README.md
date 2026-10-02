# GPT surrogate fixture QA

This harness never calls a provider, reads a credential, or invents a model
response. An independent responder must receive the captured production messages
and save its unedited final response as UTF-8 text.

The current `.qa/gpt-surrogate` snapshot is marked stale. Wait for the unified
model-turn runtime to be ready, then choose a **new** run directory.

```sh
node tests/surrogate-run.cjs init --dir ../.qa/gpt-surrogate-unified
# Give request.json's messages, in order and with their roles, to the blind responder.
node tests/surrogate-run.cjs apply --dir ../.qa/gpt-surrogate-unified --response /absolute/raw-response.txt --next-input '在窗边放一张能坐两个人的长椅'
# Repeat apply with the next unchanged raw response and next player input.
node tests/surrogate-run.cjs prompt --dir ../.qa/gpt-surrogate-unified --input '下一条玩家输入'
node tests/surrogate-run.cjs build-page --dir ../.qa/gpt-surrogate-unified --out tests/model-playback.html
node --test tests/fixtures/surrogate-harness.test.cjs
```

`init` snapshots the production HTML, CSS, and JavaScript and drives the actual
opening UI event flow. `apply` reconstructs the saved synthetic state, drives the
same production UI flow, and returns the raw fixture through a mocked OpenAI
response into the real parser and commit logic. It verifies that the request body
is identical to the one the responder received. Rejected outputs are recorded
without committing progress. A subsequent recorded turn begins after clearing
the failed request through the actual UI flow on the browser page.

Artifacts include `request.json`, numbered request/response/result files,
`session.json` with byte hashes and per-turn states, and `state.json`. Only request
bodies are captured; request headers and the inert dummy credential are omitted.
The synthetic state never comes from a real player's saved game.

The generated HTML is a standalone, separately named test page. It loads unchanged
production code in an `allow-scripts` sandbox without `allow-same-origin`, with
in-memory storage and `connect-src 'none'`. Its fetch function can only return the
next recorded output and never delegates to native fetch. Fixtures are embedded
as base64 text, never evaluated. Controls trigger the real connection and chat
submit handlers. Original gameplay mutation controls are locked, and logs are
locked until the recorded sequence ends to avoid unrecorded memory discovery.
World and memory tabs remain available for inspection. Every step checks request,
acceptance/error, and resulting state against the CLI recording.

The CLI uses a minimal DOM adapter and observes world-object data; it does not
claim pixel verification. The browser page runs the real canvas renderer.
Publishing or browser QA is a separate authorized step.

Source files and execution order are read from production `index.html`; the
unified `turn-protocol.js` module is included automatically. A snapshot refuses to
complete if a production source changes while it is being copied.

For a browser that permits localhost, serve only the test directory:

```sh
python3 -m http.server 18765 --bind 127.0.0.1 --directory tests
```

Then open the named page at `http://127.0.0.1:18765/model-playback.html` in a new
test tab. The current cloud-browser attempt returned `ERR_BLOCKED_BY_CLIENT` for
that local URL, so no local browser playback has been verified. Do not use script
injection or another network route to bypass this block. An authorized hosted
test-page/preview URL can use the same standalone HTML. Browser controls are
available with the documented frame locator and role-based clicks; no page
evaluation is needed.

Frozen v0.5.0 result: the fresh unified run contains15 independent, unchanged GPT responses. All were accepted through production request capture/parser/state handling, with no repaired responses. It reaches all nine milestones, retains two generated objects and a revised note, and recalls the latest meaning after recent-context eviction. The generated model-playback.html contains this complete synthetic sequence. It is a surrogate model test, not a live GLM/provider test.

The v0.5.1 page replays those same15 raw outputs against the proxy build. All request bodies, response hashes and final saved state match v0.5.0; no responses were regenerated or repaired for the endpoint change. The test transport still never reaches the proxy.
