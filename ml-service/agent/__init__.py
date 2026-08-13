"""The SCRUM-118 agent: turn a policy decision into an explainable draft plan.

The backend owns every safety-relevant decision before this package is reached — which
workers are on the shift, what the WBGT is, whether lightning has stopped work, and above
all what the policy engine mandated. This package's only job is to render that decision as
prose a supervisor can read, and to fall back to a deterministic rendering when the model
cannot be trusted to have done it correctly.

Nothing here may add, remove or soften a mandatory action. `validation` enforces that on the
way out, and the backend re-checks it independently (§8.5) because a validator living in the
same process as the thing it validates is a single point of failure.
"""
