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
