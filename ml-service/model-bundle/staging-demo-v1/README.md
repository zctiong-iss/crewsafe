# WBGT staging-demo model bundle

This directory contains the one reviewed WBGT candidate selected for CrewSafe's
university-project staging demonstration. It is not production safety approval.

## Identity

- Runtime model version: `wbgt-six-month-safety-floor-staging-demo-v1`
- Underlying frozen candidate: `wbgt-six-month-frozen-candidate-v2`
- Feature version: `wbgt-features-1.2.0`
- Training data: 1 February–31 July 2026
- Reviewed source commit: `8df59f20b9b842752af3bbcee7a36961ecb27ed4`
- Decision owner: Bryan Phang
- Decision date: 16 August 2026
- Approval scope: staging demonstration only

## Checksums

| File | SHA-256 |
| --- | --- |
| `manifest.json` | `36ffe8e14f50025358dc633a6d331ea4583e3d378b3e72fc6bcaba7c66207031` |
| `forecast-30m.joblib` | `d3f4111b5f712821f9e63c73563b8dbb1303cecbeeae8ead8a947c57db32822f` |
| `forecast-60m.joblib` | `300dcdd2bc30331da0b97dbe69b8e654756f61466662479c1782a9d112bc77da` |

The runtime loads this bundle only when both environment variables match:

```text
WBGT_MODEL_MANIFEST=/app/model-bundle/staging-demo-v1/manifest.json
WBGT_MODEL_MANIFEST_SHA256=36ffe8e14f50025358dc633a6d331ea4583e3d378b3e72fc6bcaba7c66207031
```

The `.joblib` files are trusted project artifacts produced by the reviewed
training pipeline. Do not replace them manually. Retraining creates a new
versioned bundle, checksums, review, and image rather than modifying this one.

## Accepted limitation

The planned 21-day post-freeze evaluation cannot finish before submission. The
decision owner accepted the candidate only for the shared staging demonstration
using the recorded six-month chronological comparison and pre-July rolling
backtests. Persistence remains the safe fallback. The model must not be described
as production-approved or allowed to make safety decisions automatically.
