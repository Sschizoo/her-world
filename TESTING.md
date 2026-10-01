# Test status

## Automated, mock-only

11 application interaction checks and 11 AI transport checks. No live API credentials or real provider requests used.

Application: three complete authored routes; named rain as plain text; empty/overlong names; log discovery gate; duplicate-click guard; refresh restoring progress without a key; unavailable/corrupt storage; mock AI key clearing and absence from save; explicit AI failure-to-offline recovery; reset confirmation; keyboard tabs and reduced motion; model text cannot alter progression.

Transport: fixed endpoint/model; authentication header only; no cookies/referrer/redirect; invalid key rejection; pagehide/disconnect key clearing; key echo rejection; safe HTTP/network errors; strict structured output; response size cap; concurrency; abort/timeout without retries; 20-call page reminder cap.

Run:

```sh
node --test tests/app.test.cjs
node tests/ai.test.cjs
```

## Browser verification

Desktop browser is the target, including 1366×768, 1440×900 and larger screens. Mobile is not a product target.

Local Chromium launch and localhost access were blocked by the development environment, so automated local pixel screenshots could not be captured there. The mock DOM harness does not verify layout. Public Pages desktop inspection is a separate release check.

Checklist: introductory screen; connect disclosure dialog; full offline path; rain naming; log drawer with narrow desktop height; memory card; end-of-prologue screen; refresh; cancel reset; key-free offline mode; keyboard focus.

## Not verified

- Real DMXAPI Key, user quota or model availability
- Real provider CORS from the published Pages origin
- Paid requests and real-world model response latency/quality
- Cross-browser Safari/Firefox rendering

The page reports actual request failures and never silently labels authored fallback as AI.
