# CrewSafe short-horizon WBGT forecast model card

Status: **accepted for the shared staging demonstration only (time-limited exception); not approved for production or general application integration**.

## Intended use

The candidate predicts Singapore WBGT 30 or 60 minutes ahead to help a supervisor
plan. It does not choose safety actions. The deterministic policy engine and human
supervisor remain responsible for decisions.

Never use it to diagnose health, score worker performance, infer personal traits,
or replace an on-site instrument where one is legally required.

## Model and data identity

- Staging runtime model: `wbgt-six-month-safety-floor-staging-demo-v1`
- Underlying frozen candidate: `wbgt-six-month-frozen-candidate-v2`
- Feature version: `wbgt-features-1.2.0`
- Source: data.gov.sg WBGT and supporting weather APIs
- Download periods: 1 February–31 July 2026
- Validated source readings: 20,302,614
- Prepared 15-minute rows: 409,456 across 27 WBGT stations
- Prepared feature SHA-256: `743db27b878d70314d17d8af08aa35ee29beee47da438ac56ca29eb4b0d0bdf3`
- Frozen manifest SHA-256: `ad0a3ba2f1a7e587ceaa7333c8bf65afe6535c0b31f0d15cb9028ca41e3b9359`
- Staging manifest SHA-256: `36ffe8e14f50025358dc633a6d331ea4583e3d378b3e72fc6bcaba7c66207031`
- 30-minute artifact SHA-256: `d3f4111b5f712821f9e63c73563b8dbb1303cecbeeae8ead8a947c57db32822f`
- 60-minute artifact SHA-256: `300dcdd2bc30331da0b97dbe69b8e654756f61466662479c1782a9d112bc77da`
- Frozen at: 14 August 2026 02:17 UTC
- Reviewed source commit: `8df59f20b9b842752af3bbcee7a36961ecb27ed4`
- Pre-July rolling report SHA-256: `bae4da94342d640f62cbdf3f39d99310babbbf07b4dd727c8d87224edc9dd4d9`
- Random seed: `114`

The candidate was rebuilt from the clean commit that contains the merged forecasting
integration and approval evaluator (the reviewed source commit above). Its model
artifacts reproduce the development candidate's recorded checksums, and the frozen
manifest pins that commit while keeping `approved_for_inference` false. The staging
manifest wraps those same pinned artifacts for the shared demo: it is baked into the
staging image but remains inactive until the deployed service receives that exact
manifest path and checksum.

## Features and target

The only targets are WBGT 30 and 60 minutes ahead. Temperature, humidity, wind,
rainfall, station, time, recent WBGT values, rolling summaries, slopes, missingness,
and freshness are input clues rather than separate forecast targets.

For each WBGT timestamp, supporting weather comes from the nearest station with a
non-future reading no more than eight minutes old. If that station is silent, the
feature builder checks the next-nearest station.

## Candidate design

Persistence predicts that future WBGT equals current WBGT. The trained candidate is
`HistGradientBoostingRegressor` with 15 maximum leaves. Its safety-floor variant uses:

```text
final forecast = maximum(trained forecast, current WBGT)
```

The floor prevents the trained model from lowering an already-dangerous current
reading. It does not guarantee that a future rise will be detected.

## Validation method

The six-month comparison uses chronological 70% training, 15% validation, and 15%
test periods with a horizon-sized purge gap. July was examined during development,
so it is no longer an untouched approval period.

A second check used four expanding historical folds ending before July. Every fold
trained only on older rows and used a separate 21-day validation period followed by
a non-overlapping 21-day test period.

## Six-month development comparison

| Horizon | Model | MAE | RMSE | Recall ≥32°C | Recall ≥33°C |
| --- | --- | ---: | ---: | ---: | ---: |
| 30 min | Persistence | 0.423°C | 0.717°C | 48.0% | 60.4% |
| 30 min | Ridge | 0.407°C | 0.666°C | 27.1% | 25.2% |
| 30 min | Raw gradient boosting | 0.355°C | 0.612°C | 21.9% | 2.5% |
| 30 min | Safety-floor boosting | 0.383°C | 0.664°C | 48.0% | 60.4% |
| 60 min | Persistence | 0.641°C | 1.025°C | 35.9% | 47.2% |
| 60 min | Ridge | 0.597°C | 0.902°C | 9.7% | 3.1% |
| 60 min | Raw gradient boosting | 0.489°C | 0.816°C | 13.1% | 0.0% |
| 60 min | Safety-floor boosting | 0.560°C | 0.922°C | 36.1% | 47.2% |

The raw trained model reduced average error but smoothed rare dangerous readings
toward normal values. The safety floor retained persistence-level high-heat recall
while reducing average error on this already-studied test period.

## Pre-July rolling evidence

| Horizon | Folds passing the safety rule | Persistence aggregate MAE | Safety-floor aggregate MAE |
| --- | ---: | ---: | ---: |
| 30 min | 4 of 4 | 0.440°C | 0.413°C |
| 60 min | 3 of 4 | 0.684°C | 0.639°C |

The failed 60-minute fold preserved high-heat recall but had a slightly worse MAE:
0.672°C versus persistence's 0.666°C. This means the candidate is promising but not
consistently better in every historical period.

## Uncertainty and error by actual WBGT band

The interval is the 95th percentile of absolute errors from the validation period.
It is calculated without looking at final-test errors.

| Horizon | Development interval | Test coverage | MAE below 31°C | MAE 31–<32°C | MAE 32–<33°C | MAE ≥33°C |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 min | ±1.468°C | 94.9% | 0.367°C | 0.770°C | 0.915°C | 0.879°C |
| 60 min | ±2.000°C | 94.9% | 0.544°C | 0.903°C | 1.146°C | 1.388°C |

These near-95% coverage values are a development calibration check, not a promise
that every future station or season will have the same coverage.

## Explainability status

The current card documents input groups and measured behaviour, but it does not yet
contain a SHAP feature-attribution report. That work belongs to the project's later
model-card story and must be completed before the full project submission. It is not
required to satisfy Scrum 114's baseline-measurement and versioned-model acceptance.

## Known limitations

- Rows at or above 33°C are rare, about 0.24% of the studied final test period.
- The raw regression model underpredicts rare extremes, especially 60 minutes ahead.
- The safety floor protects ongoing heat better than unseen future heat onset.
- One station, S142 (Sentosa Palawan Green), supplies most ≥33°C examples in the
  studied July period; results may not generalise equally across sites.
- Public stations may not represent a worksite's shade, surfaces, machinery, or
  microclimate.
- Neither horizon reaches an 85% high-heat recall target.
- July cannot approve this candidate because July informed its design.

## Approval and fallback

On 16 August 2026, Bryan Phang accepted a time-limited exception for the shared
university-project staging demonstration. The normal 21-day post-freeze untouched-period
review cannot finish before submission. This decision uses the six-month chronological
comparison, four pre-July expanding-window backtests, checksum-pinned artifacts, and the
reviewed source commit. It does not claim that those development results are equivalent
to a new untouched period, and it does not replace the full review below.

The planned untouched period is 15 August–4 September 2026. Download it only after
the full period has finished, then run the locked candidate once using the exact
frozen-manifest checksum above. Follow
[`docs/runbooks/SCRUM-114-model-approval.md`](../docs/runbooks/SCRUM-114-model-approval.md)
for the commands and human-review checklist.

Approve the candidate for production only if both horizons beat persistence MAE without
reducing recall at either 32°C or 33°C, and a named human reviewer accepts the false
alarms, bias, per-band error, uncertainty, and remaining limitations. Completing this
review is still required — the staging exception above does not substitute for it.

The bundled manifest therefore permits inference only with an explicit
`STAGING_DEMO_ONLY` scope and records `production_approved: false`. The model must not
be described as production-approved or used to authorise a safety action. A future
production decision still requires independent evidence and named human review.

Persistence remains the labelled fallback. Missing or stale context, invalid model
files, ML-service failure, and requests without context remain safe, typed fallback
conditions. Training stays offline; app startup and prediction never download
historical data. Runtime loading requires the exact checksum-pinned manifest and
artifact files.
