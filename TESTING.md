# Test status

## Automated, mock-only

21 application interaction/pacing checks, 3 world-animation checks and 18 AI transport checks (42 total). All automated tests used mocks; no real provider credential was used.

Application: three complete authored routes; named rain as plain text; empty/overlong names; log discovery gate; duplicate-click guard; refresh restoring progress without a key; unavailable/corrupt storage; mock AI key clearing and absence from save; explicit AI failure-to-offline recovery; reset confirmation; keyboard tabs and reduced motion; model text cannot alter progression; nine-scene free-input route; exact free input passed to a mocked AI response.

Transport: fixed endpoint/model; authentication header only; no cookies/referrer/redirect; invalid key rejection; pagehide/disconnect key clearing; key echo rejection; safe HTTP/network errors; bounded plain text, content arrays and legacy structured output; empty/truncated final text; response size cap; concurrency; abort/timeout without retries; 20-call page reminder cap.

Run:

```sh
node --test tests/app.test.cjs tests/world.test.cjs
node tests/ai.test.cjs
```

Additional v0.2.1 checks: Unicode-by-character reveal; sequential sentence order; skip/held-Space safety; stale double clicks and free-send lock; refresh mid-reveal; reduced motion/pause settlement; sequential log gates; opening AI before authored prompts; immediate opening failure→retry/offline; smooth world targets and bfcache resume; known HTTP status surviving cleanup failure; known response-read interruption distinguished from status-unavailable fetch errors; local rejection of full headers/prefixed/quoted credential input.

## Browser verification

Desktop browser is the target, including 1366×768, 1440×900 and larger screens. Mobile is not a product target.

Local Chromium launch and localhost access were blocked by the development environment, so automated local pixel screenshots could not be captured there. The mock DOM harness does not verify layout. The prior release’s public Pages desktop inspection subsequently passed: full offline route completed (initial two scenes checked by the publishing reviewer, remaining scenes and ending checked by the implementation worker), named rain, log gate, free text, anonymous-memory choice, drawer layouts, replay Cancel and refresh restoration. No application-origin console errors observed; the cloud browser extension emitted unrelated metadata errors.

The v0.2.1 paced build additionally needs a public desktop browser spot-check after deployment; automated timing checks pass.

Checklist: introductory screen; connect disclosure dialog; full offline path; rain naming; log drawer with narrow desktop height; memory card; end-of-prologue screen; refresh; cancel reset; key-free offline mode; keyboard focus.

## One invalid-credential connection diagnostic

After the user reported a network failure, one intentionally invalid, accountless test string was manually submitted through the published app in the cloud browser. The page received a readable authentication rejection (401/403 classification), and no DMXAPI CORS error appeared in the filtered browser console. It did not reproduce the user’s network error. The test string was then disconnected and cleared. No valid credential or model-generation request was used; this does not establish the user’s browser/network, account, or model availability.

## Not verified

- Real DMXAPI Key, user quota or model availability (the implementation/test workflow never receives or enters a real key)
- Real provider CORS from the published Pages origin
- Paid requests and real-world model response latency/quality
- Cross-browser Safari/Firefox rendering

The page reports actual request failures and never silently labels authored fallback as AI.
