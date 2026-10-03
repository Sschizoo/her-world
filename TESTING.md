# Test status

## Automated, mock-only

21 application interaction/pacing checks, 5 character-world checks and 18 AI transport checks (44 total). All automated tests used mocks; no real provider credential was used.

Application: three complete authored routes; named rain as plain text; empty/overlong names; log discovery gate; duplicate-click guard; refresh restoring progress without a key; unavailable/corrupt storage; mock AI key clearing and absence from save; explicit AI failure-to-offline recovery; reset confirmation; keyboard tabs and reduced motion; model text cannot alter progression; nine-scene free-input route; exact free input passed to a mocked AI response.

Transport: fixed endpoint/model; authentication header only; no cookies/referrer/redirect; invalid key rejection; pagehide/disconnect key clearing; key echo rejection; safe HTTP/network errors; bounded plain text, content arrays and legacy structured output; empty/truncated final text; response size cap; concurrency; abort/timeout without retries; 20-call page reminder cap.

Run:

```sh
node --test tests/app.test.cjs tests/world.test.cjs
node tests/ai.test.cjs
```

Additional v0.2.1/v0.2.2 checks: Unicode-by-character reveal; sequential sentence order; skip/held-Space safety; stale double clicks and free-send lock; refresh mid-reveal; reduced motion/pause settlement; sequential log gates; opening AI before authored prompts; immediate opening failure→retry/offline; smooth world targets and bfcache resume; every scene mark is printable ASCII in one neutral hue over a black clear; tall/open-drawer desktop geometry; known HTTP status surviving cleanup failure; known response-read interruption distinguished from status-unavailable fetch errors; local rejection of full headers/prefixed/quoted credential input.

## Browser verification

Desktop browser is the target, including 1366×768, 1440×900 and larger screens. Mobile is not a product target.

Local Chromium launch and localhost access were blocked by the development environment, so automated local pixel screenshots could not be captured there. The mock DOM harness does not verify layout. The prior release’s public Pages desktop inspection subsequently passed: full offline route completed (initial two scenes checked by the publishing reviewer, remaining scenes and ending checked by the implementation worker), named rain, log gate, free text, anonymous-memory choice, drawer layouts, replay Cancel and refresh restoration. No application-origin console errors observed; the cloud browser extension emitted unrelated metadata errors.

The v0.2.1 paced build passed a public desktop spot-check: boot/lines arrive in order, player text appears immediately, skip completes only the active sentence, controls remain locked until reveal completes, and logs appear incrementally. The v0.2.2 character-only world passed automated drawing-surface checks, a local glyph-raster preview, and a live desktop screenshot check on GitHub Pages. The deployed build label, monochrome glyph-only scene, preserved original UI colors, and paced transition into falling character rain were verified.

Checklist: introductory screen; connect disclosure dialog; full offline path; rain naming; log drawer with narrow desktop height; memory card; end-of-prologue screen; refresh; cancel reset; key-free offline mode; keyboard focus.

## One invalid-credential connection diagnostic

After the user reported a network failure, one intentionally invalid, accountless test string was manually submitted through the published app in the cloud browser. The page received a readable authentication rejection (401/403 classification), and no DMXAPI CORS error appeared in the filtered browser console. It did not reproduce the user’s network error. The test string was then disconnected and cleared. No valid credential or model-generation request was used; this does not establish the user’s browser/network, account, or model availability.

## Limits of the earlier offline-only passes

- Real DMXAPI Key, user quota or model availability (the implementation/test workflow never receives or enters a real key)
- Real provider CORS from the published Pages origin
- Paid requests and real-world model response latency/quality
- Cross-browser Safari/Firefox rendering

The page reports actual request failures and never silently labels authored fallback as AI.

## v0.3.0 — non-linear rain and evidence-based focus

Local aggregate checks currently pass: 29 application integration checks, 34 engine checks, 20 focus checks, 5 ASCII world checks and 49 mocked transport groups (137 total). Natural-answer, compound-action and prior-topic revisiting checks are included. The online semantic path separately validates exact current-input evidence and pending question ID, persists accepted verdicts, rejects forged context/evidence, and never automatically renders rain. Confirmed reset covers legacy-copy cleanup, unrelated-key preservation and removal failure. Tests are dependency-free VM/DOM emulation, not a pixel-browser substitute.

Covered: the exact reported “rain definition → what time is it?” regression in offline and mocked AI mode; no automatic first rain or question completion; density → naming topic → stop → unrelated topic → resume preserving density; negated, hypothetical and recalled commands; explicit names and recall; compounds; explicit log discovery; farewell/reopening; v2 migration across every old boundary; caps and invalid saves; error/cancel/disconnect/reset with pending response; no key persistence; slow reveal/skip/save/refresh; evidence-only focus, normalized stable scores, decay and no future transcript leakage.

No valid credentials, paid requests or provider generation used. The user subsequently reported that the HTTP401 problem was resolved. We did not use a valid credential or independently verify that resolution, and this iteration does not claim an authentication fix. Browser visual verification of v0.3.0 must follow parent-coordinated publication; v0.2.2 live screenshot evidence is not a v0.3.0 verification.


## v0.3.0 public desktop loop and v0.3.1 polish

Actual cloud desktop playthrough on the published v0.3.0 completed all nine milestones and remained open afterward. Checked the exact clock-question regression, deliberate first rendering, density/pause/resume across topics, hypothetical no-op, naming-question rejection, compound name+resume, log discovery/focus proportions, anonymous memory, farewell/reopening/name recall, refresh with paused rain/name preserved, cancel reconnect, and explicit offline resume. Drawer-open and closed layouts were visually checked; the original UI palette and monochrome ASCII world remain intact. No live provider/key use.

Playtest led to a small v0.3.1 improvement: settled-name hints now suggest continued conversation instead of three replacements; a quiet greeting is understood in offline mode without advancing or changing weather; unconnected input guidance accurately asks for mode choice. All affected behavior has added regressions; final aggregate is 140 checks (30 app,36 engine,20 focus,5 world,49 transport). v0.3.1 was then verified on live Pages and replayed through all nine milestones in the cloud desktop browser. The improved greeting, settled-name suggestions and unconnected guidance were visibly confirmed. The second route used the other visitor-memory choice (two memories), then reopened after farewell, resumed the remembered heavy rain, and refreshed with the exact name and rain state intact. The first full pass used normal paced presentation; the replay also exercised animation pause/reduced-motion presentation. No material issue remained in the tested offline flows.


## v0.3.1 bounded live model check (user-established session)

The user personally connected the published app. The test continued that existing session without reading, copying, filling or inspecting credentials, request headers or credential storage. Five ordinary conversation requests were initiated, including one manual retry of a status-unknown network failure. One request failed; its single retry and the other three requests produced readable model replies. The clock question preserved pending rain learning and did not create weather.

Actual defects observed: the opening duplicated the authored startup line; a provider reply containing prose followed by a JSON answer object printed the protocol object; and a natural first-rain request after learning was denied because only the hint choice had a local action allowance. Paid requests stopped at that point. The connected tab was preserved without reload; loading a repaired build clears the volatile credential and requires the player to reconnect personally.

## v0.3.2 dialogue-driven repair (not yet live-verified)

Adds bounded semantic weather and story intents with exact current-input evidence, state-specific capabilities, replay validation, explicit consent boundaries and optional text-fill weather hints. A visible invitation leads to actual log discovery. Mixed prose/JSON control extraction is bounded and schema-validated; protocol objects are never executed merely because they appeared in a story example. Exact duplicate startup lines are suppressed. Full natural-input and paraphrased routes run through the real transport parser, application and state engine using only mocks; no story-option buttons are used. Final check counts and post-publication results will be recorded below.

Final v0.3.2 pre-publication validation: 185 checks pass (32 application, 53 engine, 20 focus, 5 world, 75 transport), plus syntax checks for all six scripts. The application tests run two complete all-text routes through the real transport parser and state engine, including both explicit remembered and anonymous visitor choices, physical log discovery, farewell, and storage replay. Review added refusal, permission-question, negated-anonymity and explicit-undecided regressions; unrelated dialogue cannot silently alter visitor consent. Historical AI protocol/thought/unknown metadata is hidden or reduced to safe dialogue for display without rewriting saved source or executing old metadata.

Mixed executable/answer/story payload compatibility is deliberately bounded: one complete trailing object on a fresh line, with prefix prose beginning with the first structured dialogue line. This accepts the observed live duplicate-prose form. Display-only lines wrappers are more permissive. Ambiguous examples, multiple objects, malformed control fragments and duplicate keys fail safely rather than being executed or shown raw.

The v0.3.1 authenticated tab was preserved without refresh, disconnect or additional requests after the five-request diagnostic. No credential migration is attempted. v0.3.2 requires the player to refresh and reconnect personally before the pending live end-to-end validation; the passing mock routes are not a substitute for that live check.

## v0.3.2 live natural-language completion

After the player personally reconnected, the actual tab showed v0.3.2 and an AI connection. The player had left a fresh opening, which was continued without resetting it. Fifteen conversational requests completed with no errors, retries or exposed protocol objects. No story or weather choice buttons were used; the actual log-opening invitation was the sole discovery click.

Verified live: natural rain-topic selection; an off-topic clock question remaining unanswered as rain teaching; a metaphorical rain answer; spoken first rendering; density paraphrase; naming discussion; “雨太吵了，先停一下吧” pausing; a hypothetical leaving the rain paused; “还是想听刚才的雨” restoring the earlier heavy density; semantic naming as 夜航; actual log discovery; a natural own-reason statement; explicit anonymous consent (one memory and player_reference.persist=false); natural farewell reaching all nine milestones; reopening with explicit no-weather-change wording; and accurate earlier-name recall. Focus proportions followed the visible rain/name/conversation evidence. The connected tab was not refreshed or disconnected, and credentials/headers/storage were not inspected.

Two non-blocking presentation issues remained: a combined AI opening overlapped authored greeting lines, and absent topic metadata could leave old hints highlighted. v0.3.3 addresses these with one AI opening and presentation-only neutral hints, without changing intent or milestone authorization. No more live requests are planned for these display fixes; they are checked locally and in a separate key-free deployment view.


Final v0.3.3 validation: 190 checks pass (33 application, 57 engine, 20 focus, 5 world, 75 transport), plus all six script syntax checks. Neutral hints are gated to fully revealed replies and do not rewrite canonical topics, pending questions, memories, weather, milestones or intent permissions. A live AI opening is the sole opening dialogue; offline authored text remains unchanged. This display-only patch awaits key-free deployment verification; the 15-request authenticated proof above is specifically v0.3.2.

## v0.3.4 — discoverable, state-bound invitations

The user reconnected v0.3.3 and asked for a first-time-player test because progression was unclear. Four conversational requests reproduced a concrete blocker without using topic or progression buttons. The opening claimed rain existed while the world was unlearned. After correction and a request for where to begin, she invited a description of rain's sound/season. The player answered “夏天傍晚的那种，细细的，落在叶子上像有人轻轻敲门。” She acknowledged it, but the engine remained at one milestone: her organic question had not established a pending question. Requests stopped at that confirmed failure. The authenticated tab was preserved; no credential field, value, storage or headers were inspected.

The repair keeps a single optional invitation beside the input, matching an explicit, validated invitation record. It covers learning, first rendering, changing/naming, actual log discovery, retained-memory reasoning, visitor consent and parting. Guidance cannot perform an action or grant consent. It changes only after the corresponding response is fully revealed and does not repeat as extra dialogue on every side conversation. Model opening receives canonical empty-world state. Current guidance replaces stale scene questions in the request context.

New mocked application coverage includes the exact observed organic-question/metaphorical-answer failure, a complete route following only visible invitations and ordinary free-text answers, side conversation without repeated prompts, reload, and reveal boundaries. Migration validates historical events before making an invitation available at the newly resumed boundary; old answers are not reinterpreted.

This iteration's automated tests use mocks only. The four live requests above verified the v0.3.3 defect, not the repaired v0.3.4 model experience. Publication and an explicitly reconnected live session are needed for that subsequent check.

Pre-publication aggregate: 218 checks pass (37 application, 69 engine, 20 focus, 5 world, 87 transport), plus syntax checks for all six scripts. The complete invitation-driven mock route additionally checks that every question sent to the model exactly matches the one visible to the player. Direct offline help requests return the current invitation without completing it; ambiguous acknowledgments or deferrals do not count as learning rain, literal names, or consenting to a visitor reference. Explicit and quoted literal names remain valid, including words such as 随便 when deliberately named.

## v0.3.4 published and live novice-style route

The published build, all script/style version tags and desktop invitation layout were verified in a separate key-free tab. The returning save gained only its validated resume-invitation boundary; transcript and world state were preserved.

After the player personally reconnected, the actual page contained a fresh v0.3.4 opening. Testing continued without reset. Twelve requests were initiated: eleven completed replies and one 30-second timeout, which was manually retried once successfully. No automatic retry or credential inspection/entry occurred. All nine milestones were reached by responding naturally to her dialogue and the visible invitation. No story or weather choice buttons were used; actual log viewing was the discovery action.

The exact summer/leaf description that stalled in v0.3.3 now taught rain without creating it. A clock question left state alone; “好呀，就试试看。” created the first rain; a request for more space between drops changed density to gentle. Deferring the name preserved it unresolved, and the bare answer “叶信” became the accepted name. The visible log invitation led to first_rain, a normal opinion about keeping something without needing utility completed her reason, explicit permission created the visitor reference, and a natural goodnight completed the prologue. Reopening preserved the gentle rain, name and two memories. Pacing and drawer layout were visibly checked.

One non-blocking model issue was observed: the clock reply appended another rain invitation despite the no-nag instruction; the later request to stay quietly was respected. More materially, final name recall returned 叶信 correctly but invented a player-attributed description about a leaf in a palm. That sentence was not in the conversation. Paid requests stopped after the twelfth request, and the connected session was preserved.

## v0.3.5 — retained source context for attributed memories

Adds only a small event-derived memory context: first accepted rain-description source, latest actual naming source, and current visitor choice. Historical model prose cannot provide these facts. Original source evidence survives the six-message recent-context limit; renamed rain uses its latest naming source; legacy unknown sources remain null; anonymous consent stays explicit. The output protocol and state-changing permissions are unchanged. Prompt rules forbid inventing prior player quotations and distinguish her current imagery from something the player actually said.

Tests use mocked requests and validate source provenance, reveal gating, restore, history eviction, renaming, absent sources and anonymous context. This is a focused grounding improvement; it does not establish that arbitrary future model prose cannot hallucinate. No live provider call has been made on v0.3.5.

Final pre-publication validation: 235 checks pass (38 application, 76 engine, 20 focus, 5 world, 96 transport), plus six script syntax checks. Independent review reran the aggregate and checked legacy/source/consent boundaries without browser or provider access. The existing fabricated recent-assistant quotation is covered as untrusted attribution evidence; only accepted player-event sources supply the retained facts.

## v0.4.0 — editable ASCII objects and revisable annotations

Adds a bounded persistent scene layer independent of the nine prologue milestones. Typed batches create, move, resize, redraw, rename and remove objects, or set/clear a player's current meaning and the character's interpretation separately. Glyphs are ordinary printable ASCII data, with new patterns allowed; the renderer only draws text in the existing neutral hue. Original player-source events remain distinct from current mutable annotations.

Local integration routes use the real mocked transport and engine: a novel two-seat bench, window placement, side conversation, persistent recall, assigned meaning, requested interpretation, revised meaning, interpretation clearing, removal and restore. Other checks cover first-rain annotations, explicit-only example buttons, partial reveal, pending-request cancellation, invalid-batch rollback and plot independence. Focus bars now include actually visible created objects and their completed conversation evidence.

Renderer checks cover arbitrary patterns, movement/scale/pattern/removal transitions, reduced motion, defensive malformed payloads, bounded replacement layers, resize, and continued monochrome text-only rendering. All requests in this implementation pass are mocked. No real credential, provider generation or paid test was used for v0.4.0; deployed desktop playtests follow publication.

Final pre-publication aggregate: 297 checks pass (45 application, 85 engine, 15 shared scene validator, 22 focus, 13 renderer, 117 transport), plus all seven script syntax checks. Independent review ran a separate real-parser bench route and adversarial checks. Regressions include exact object-ID boundaries, singular focus versus stale/plural/excluded references, negation and historical questions, annotation refusal and clear-only requests, protocol/key/reasoning leakage, reserved weather labels, and ordinary rain descriptions mentioning a bench. Explicit rain naming, weather, farewell and visitor consent retain their own authority even when object labels overlap. A partial script load cannot overwrite an existing save.

## v0.4.0 desktop playtest and v0.4.1 polish

The cloud browser had restarted and displayed a fresh introductory screen, with no restored dialogue or AI session. The offline QA playthrough was created from that visible empty state without resetting an existing save. Published v0.4.0 and its four-panel navigation were verified.

Actual desktop checks confirmed creation, gradual movement to the window, scaling and a newly supplied multiline ASCII pattern; the player meaning and character interpretation could be set separately, and revising the meaning retained the interpretation. A side question cleared the active referent: a stale “它” request clarified without moving the object, while explicitly recalling the bench restored an unambiguous singular reference. All of those edits left the rain-learning question pending. No provider or paid request was made.

The playtest found an offline extraction defect: “在这里放一张能坐两个人的长椅” used the entire utterance as its object label. v0.4.1 fixes leading location phrases while retaining the exact original input as provenance. A single-object drawer now uses the available width to show appearance, player meaning and character interpretation together. This does not alter scene authority or history.

v0.4.1 pre-publication aggregate: 299 checks pass (45 application, 86 engine, 16 scene validator, 22 focus, 13 renderer, 117 transport). Actual refresh/replay and the follow-up layout are verified separately after deployment.

Further v0.4.0 desktop checks confirmed independent interpretation clearing, exact recall of original input and current annotations, and correctly teaching rain with “雨是落在长椅上的水滴” while the object exists. Rain creation, density and naming remained independent, and actual log viewing discovered first_rain without removing the object or its meaning.

## v0.4.2 — explicit label contract

The model prompt now states the existing validator requirement that created/renamed labels be continuous exact excerpts of the current player input, at most 40 Unicode codepoints. For “在这里放一张能坐两个人的长椅”, 长椅 is valid; the paraphrased 双人长椅 is not. Glyph generation remains open within the same bounds. No validator or capability was loosened.

Final aggregate: 300 checks pass (182 application/core/focus/renderer runner checks and 118 mocked transport groups), plus seven syntax checks. This prompt alignment has no live-provider verification. The final desktop replay is an offline UI check, not evidence of real-model artwork quality.

## v0.5.0 — unified model-authored turns

The user reported stalled natural progression, failed object generation and delayed world/memory/log panels. The online pathway now takes one typed model plan containing dialogue, a chosen confirmation line, weather/story intent, scene edits, mutable notes, fictional logs and optional panel opening. Online meaning and labels no longer pass overlapping local phrase/exact-substring gates. Shared validation preserves schema, bounds, existing targets, story prerequisites, atomicity and explicit visitor-remember consent. Offline and historical event behavior remain available and are tested separately.

Current production requests use the unified pathway; archived provider fixtures explicitly exercise only legacy compatibility. New application checks run the actual current transport/parser and commit together. World objects, annotations, notes and logs become visible after the selected confirming sentence while later sentences still type. Historical logs no longer replay a delayed queue. Model-requested panels open once, and newer manual navigation takes priority. Refresh restores the complete committed turn without a request replay.

Memory notes are visibly labeled character-authored, with original/current player-source attribution. They remain separate from canonical prologue memories and scene annotations. Maximum legal scene/notes/Unicode context fits the bounded128KiB request limit; response limit stays64KiB. Invalid or canceled plans leave all layers untouched. Fenced single JSON objects use the same validator; mixed prose/examples and multiple objects remain rejected.

Initial aggregate:337 mock-only checks (53 application,86 legacy engine,13 unified protocol,16 scene validator,22 focus,13 renderer,134 transport), plus eight runtime syntax checks. A separate three-check capture/playback harness verifies source snapshots, production-request equality and browser isolation. These are not live GLM calls. Independent GPT-generated responses and actual browser playback will be recorded separately after they are observed.

### Independent GPT surrogate, frozen v0.5.0

An isolated responder received each actual production request's ordered messages, without implementation files, expected actions or hand-authored response examples beyond the production prompt. Fifteen raw UTF-8 outputs (one opening and fourteen conversational turns) were preserved unchanged with byte hashes, then consumed by the real app submit handler, transport parser, validator, engine and restore path. Every outgoing request matched its captured production body. All15 outputs were accepted; none were patched into the desired schema after generation.

Observed route: create a newly generated seven-line star-supported umbrella; add a separately generated two-person chair; move the chair under the window without overlapping the umbrella; distinguish a player's non-waiting meaning from the character's interpretation; answer an unrelated clock question without progression; clarify a genuinely ambiguous two-object target without mutation; resolve the target, move it, revise meaning and create a note together; teach and render rain in one explicit compound request; make it gentler, name it叶信 and open actual logs; leave a hypothetical stop/removal question unexecuted; accept a reason to retain rain; preserve explicit anonymous choice; farewell; return and accurately recall the revised chair meaning after it left the recent-message window. All nine prologue milestones and both objects survived. No generated-protocol failure or material semantic defect was observed in this bounded sample.

This is GPT surrogate evidence, not a live glm-5.3-flash, DMXAPI, authentication, network-latency or billing test. The standalone tests/model-playback.html embeds the unchanged frozen runtime and all15 synthetic outputs, with an opaque-origin sandbox, in-memory storage, CSP blocking connections and a fixture-only fetch implementation. It cannot access the real game's local save or call the provider. Three harness checks and independent isolation review passed. Actual hosted-browser canvas/layout verification remains pending.

## v0.5.1 — dedicated HTTPS proxy

The fixed browser destination is now https://216.235.248.104/v1/chat/completions. The password field names the private proxy access password and explains that dialogue, world state, memory and source context pass through this server to DMXAPI. The upstream provider Key is not entered in the browser. Access credentials remain volatile and header-only. Model, body fields, request/response limits, timeout, redirects/cookies policy and no-retry behavior are unchanged. The deployed proxy's configured32–128URL-safe access-code format is compatible with existing frontend validation.

Scoped validation:54 application checks,136 mocked transport groups and3 isolated-harness checks pass, plus syntax checks. The original15 independent GPT outputs were reused unchanged against a fresh v0.5.1 runtime snapshot; each captured request body and raw-response hash matched the original, all15 were accepted and the final saved state was identical. The regenerated standalone playback embeds the new proxy runtime but has no upstream network access. No authenticated proxy/provider request was made by these tests; the player will enter and submit the access password personally after deployment.

## v0.5.2 — bounded failure diagnostics

The first authenticated proxy gameplay request on v0.5.1 failed with the generic format message after a natural umbrella creation request. The player had personally entered the access password. Only one request was attempted; no retry, credential inspection, reset or state mutation followed. The old error merges pre-request context failures and several response-validation paths, so the exact failure stage is not established from the visible UI.

The diagnostic patch preserves acceptance predicates, request contents and atomic failure. It adds fixed stage/code/path metadata, retains a known HTTP status, and never includes raw response text, reasoning, arbitrary field names, player text, headers or credentials. Existing GPT raw fixtures are regression data, not evidence that GLM generated a valid reply.

## v0.5.3 — literal JSON encoding guidance

Live proxy evidence: opening and umbrella creation succeeded. In the next session, reshaping the umbrella succeeded but changed its label without a naming request; the combined correction plus bench request failed with HTTP200 / JSON / JSON_SYNTAX / content. A separate bench request succeeded and its completed state was recovered after the cloud browser restarted. No request was resubmitted during that unknown-outcome interval.

The patch keeps JSON.parse and validation acceptance strict. The system prompt adds a JSON.stringify-built glyph example with backslashes, quotation marks and newline encoding, preserves labels for shape-only edits, and clarifies the program/player subject in the opening. Native parser error text is never displayed or saved: only fixed prefix-derived categories are allowed. The waiting-message layout no longer inherits the transcript grid. Existing15-response playback remains a historical v0.5.2 artifact because the production prompt changed.

## v0.5.4 — shared scene landmarks and semantic placement

The reported screenshot asks for clouds in the sky and shows a completion claim near the building. It does not reveal the submitted coordinates. Audit found the old prompt lacked axes, top-left footprint rules and a sky/ground map; background rounding differed by roughly one logical row, which cannot explain a large sky-to-window error. The patch derives trusted layout from HerScene and uses the same map for the rendered window/shoreline.

Optional online placement resolves into ordinary numeric edits before commit. Tests cover full sky footprints, ground contact, window sides, scaled relative targets, earlier same-turn references, center/base retention, free-axis clamping and impossible geometry rejection. Absolute coordinates and old save replay remain unchanged; historical misplaced objects are not inferred or relocated. Rendering checks cover screenshot-sized, open-drawer and extreme40/90-background-row canvases. Background glyphs retain their character-cell rounding; viewport checks compare the expected rounded landmarks while object coordinates remain normalized. No provider call or credential use is needed by these tests. The original15-output page remains historicalv0.5.2 evidence.
