package com.crewsafe.forecast.service;

/**
 * Which rung of the forecast ladder produced a value, in descending order of confidence.
 *
 * <h2>Why a ladder replaced an all-or-nothing gate</h2>
 *
 * The forecast used to be a single path: assemble a perfect two-hour context on an exact
 * 15-minute cadence, or return nothing. Against real NEA delivery that meant nothing, almost
 * always — one late or missing reading disqualified the whole window, and because the window is
 * two hours wide, a single dropped cycle removed forecasting for the next two hours rather than
 * for one tick. A supervisor saw "No forecast right now" permanently, on a system whose model
 * worked fine.
 *
 * <p>Each rung answers the same question with less information than the one above it. That is
 * the point: a degraded answer a supervisor can act on beats a blank card, provided the
 * degradation is stated rather than hidden. Every basis below {@link #MODEL} widens its
 * confidence interval and is labelled in the UI, so a fallback value can never be mistaken for
 * a fresh prediction.
 *
 * @author Justin Chua
 */
public enum ForecastBasis {

    /** The trained model on clean, complete, on-cadence context. Native confidence interval. */
    MODEL,

    /**
     * The trained model on context repaired by interpolating a small number of missing slots.
     * The prediction is the model's; the widened interval reflects the invented inputs.
     */
    MODEL_IMPUTED,

    /**
     * A damped linear extrapolation of recent real observations, used when the model's context
     * cannot be assembled at all.
     *
     * <p>Damped rather than plain linear: a steep short-run slope on noisy sensor data
     * extrapolates to an implausible value within an hour, which is the standard failure of
     * naive trends. The damping keeps a 60-minute projection anchored near where the readings
     * actually are.
     */
    TREND,

    /**
     * The last real observation carried forward. Weak, and honest about it — but WBGT changes
     * slowly enough that "much like now" is a defensible half-hour answer, and it is
     * considerably better than refusing to say anything.
     */
    PERSISTENCE
}
