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

## Not verified

- Real DMXAPI Key, user quota or model availability (the implementation/test workflow never receives or enters a real key)
- Real provider CORS from the published Pages origin
- Paid requests and real-world model response latency/quality
- Cross-browser Safari/Firefox rendering

The page reports actual request failures and never silently labels authored fallback as AI.

## v0.3.0 — non-linear rain and evidence-based focus

Local aggregate checks currently pass: 29 application integration checks, 34 engine checks, 20 focus checks, 5 ASCII world checks and 49 mocked transport groups (137 total). Natural-answer, compound-action and prior-topic revisiting checks are included. The online semantic path separately validates exact current-input evidence and pending question ID, persists accepted verdicts, rejects forged context/evidence, and never automatically renders rain. Confirmed reset covers legacy-copy cleanup, unrelated-key preservation and removal failure. Tests are dependency-free VM/DOM emulation, not a pixel-browser substitute.

Covered: the exact reported “rain definition → what time is it?” regression in offline and mocked AI mode; no automatic first rain or question completion; density → naming topic → stop → unrelated topic → resume preserving density; negated, hypothetical and recalled commands; explicit names and recall; compounds; explicit log discovery; farewell/reopening; v2 migration across every old boundary; caps and invalid saves; error/cancel/disconnect/reset with pending response; no key persistence; slow reveal/skip/save/refresh; evidence-only focus, normalized stable scores, decay and no future transcript leakage.

No valid credentials, paid requests or provider generation used. Existing real-user HTTP401 cause remains unresolved and is not claimed fixed by this iteration. Browser visual verification of v0.3.0 must follow parent-coordinated publication; v0.2.2 live screenshot evidence is not a v0.3.0 verification.


## v0.3.0 public desktop loop and v0.3.1 polish

Actual cloud desktop playthrough on the published v0.3.0 completed all nine milestones and remained open afterward. Checked the exact clock-question regression, deliberate first rendering, density/pause/resume across topics, hypothetical no-op, naming-question rejection, compound name+resume, log discovery/focus proportions, anonymous memory, farewell/reopening/name recall, refresh with paused rain/name preserved, cancel reconnect, and explicit offline resume. Drawer-open and closed layouts were visually checked; the original UI palette and monochrome ASCII world remain intact. No live provider/key use.

Playtest led to a small v0.3.1 improvement: settled-name hints now suggest continued conversation instead of three replacements; a quiet greeting is understood in offline mode without advancing or changing weather; unconnected input guidance accurately asks for mode choice. All affected behavior has added regressions; final aggregate is 140 checks (30 app,36 engine,20 focus,5 world,49 transport). v0.3.1 publication/replay remains pending at this note's writing.
