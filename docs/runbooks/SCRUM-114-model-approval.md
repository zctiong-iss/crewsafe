# SCRUM-114 frozen-model approval runbook

Use this runbook for the one-time untouched-period evaluation of
`wbgt-six-month-frozen-candidate-v2`. It creates review evidence only. It never
approves, deploys, or changes the frozen candidate automatically.

## Frozen candidate identity

- Source commit: `8df59f20b9b842752af3bbcee7a36961ecb27ed4`
- Training period: 1 February–31 July 2026
- Frozen at: 14 August 2026 02:17 UTC
- Manifest SHA-256: `ad0a3ba2f1a7e587ceaa7333c8bf65afe6535c0b31f0d15cb9028ca41e3b9359`
- Untouched evaluation period: 15 August–4 September 2026, inclusive

Keep the bundle private. Do not commit model files, raw data, API keys, or approval
reports. Before using a copied bundle, verify its `manifest.sha256` file.

## 1. Download the completed untouched period

Run this on or after **5 September 2026 at 08:00 Singapore time**, so 4 September
is also complete in UTC. The downloader is resumable; rerunning the same command
continues the same date range without downloading completed pages again.

Ensure `NEA_API_KEY` is available through the team's protected local method. Never
paste it into this command, a log, Git, or a Markdown file.

```bash
cd ml-service
python -m crewsafe_ml.download_dataset \
  --start-date 2026-08-15 \
  --end-date 2026-09-04 \
  --output-directory data/approval-2026-08-15-to-2026-09-04
```

This keeps the downloader's conservative default request interval. Change it only
when the approved API-key tier's current official limit has been confirmed. Do not
change the dates, metrics, page limit, or output folder during this run.

## 2. Run the checksum-pinned evaluator once

Do not retrain, rename, edit, or replace anything inside the frozen bundle. The
evaluator verifies the manifest, artifacts, dataset, feature version, and dates
before loading the model.

```bash
cd ml-service
python -m crewsafe_ml.evaluate_approval \
  --model-manifest artifacts/wbgt-six-month-frozen-candidate-v2/manifest.json \
  --model-manifest-sha256 ad0a3ba2f1a7e587ceaa7333c8bf65afe6535c0b31f0d15cb9028ca41e3b9359 \
  --features data/approval-2026-08-15-to-2026-09-04/weather_features_15min.csv \
  --feature-manifest data/approval-2026-08-15-to-2026-09-04/manifest.json \
  --output artifacts/approval-2026-08-15-to-2026-09-04-v2.json
```

The expected decision is `READY_FOR_HUMAN_REVIEW`. `BLOCKED` is a safe result: stop
and read the failed gates instead of changing thresholds or rerunning with easier data.

## 3. Human-review checklist

The reviewer records their name, date, report checksum, decision, and reasoning.
Approval requires every item below.

- [ ] The report references the exact model version, source commit, and manifest checksum above.
- [ ] All eight automated gates are `true`.
- [ ] Both horizons contain real examples at or above 32°C and 33°C.
- [ ] Candidate MAE is lower than Persistence MAE at both horizons.
- [ ] Candidate recall at 32°C and 33°C is not lower than Persistence at either horizon.
- [ ] Bias, false negatives, per-band error, and interval coverage are acceptable for supervisor planning.
- [ ] The model card's limitations and persistence fallback remain visible and accurate.
- [ ] No secret, personal information, raw dataset, or unapproved model file will be published.

If any item fails, keep `approved_for_inference` false and keep the labelled
Persistence fallback. Create a separate Jira issue for investigation; do not edit
this evidence to make it pass.

## 4. Separate promotion step

`READY_FOR_HUMAN_REVIEW` is not deployment approval. After the checklist is signed,
a separate reviewed promotion must create a checksum-pinned promoted manifest,
remove the approval blocker, set `approved_for_inference` to true, and configure the
runtime to use that exact promoted checksum. Keep the frozen candidate unchanged as
audit evidence and preserve the Persistence rollback path.
