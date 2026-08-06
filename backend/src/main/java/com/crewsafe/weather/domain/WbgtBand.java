package com.crewsafe.weather.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * The WBGT risk band a reading falls into, per §7.1 of the project plan.
 *
 * <p>This lives server-side and is returned to clients already evaluated, because §12.2 states
 * that no client may submit or override a WBGT risk band and FR-15 makes the backend engine
 * authoritative for anything that decides what a worker must do. A band is exactly that: it is
 * the input to the rest and hydration obligations, so a client that computed its own could
 * quietly disagree with the server about whether someone is owed a break.
 *
 * <p>The mobile app previously derived this in its mock layer, deliberately kept out of any
 * helper a screen could import. Exposing it here is what lets that mock be retired rather than
 * promoted.
 *
 * <p>The wire names are NOT the Java constant names. A Java identifier cannot begin with a
 * digit, so the constants carry a {@code BAND_} prefix that the JSON deliberately drops:
 * clients already key translations off {@code 31_TO_BELOW_32} and similar, and a prefix on the
 * wire would force every consumer to strip it. One {@code @JsonProperty} here is cheaper than a
 * mapping layer in each client, and a mapping layer is a thing that drifts.
 *
 * <p>Boundaries are half-open — a reading of exactly 32.0 is {@code BAND_32_TO_BELOW_33}, not
 * {@code BAND_31_TO_BELOW_32}. That matters at the boundary and nowhere else, which is
 * precisely why it is stated rather than left to whoever reads the comparison next.
 */
public enum WbgtBand {

    /** Below 31°C. */
    @JsonProperty("BELOW_31")
    BELOW_31,

    /** 31°C up to but not including 32°C. */
    @JsonProperty("31_TO_BELOW_32")
    BAND_31_TO_BELOW_32,

    /** 32°C up to but not including 33°C. */
    @JsonProperty("32_TO_BELOW_33")
    BAND_32_TO_BELOW_33,

    /** 33°C and above. */
    @JsonProperty("33_AND_ABOVE")
    BAND_33_AND_ABOVE;

    private static final BigDecimal THIRTY_ONE = new BigDecimal("31");
    private static final BigDecimal THIRTY_TWO = new BigDecimal("32");
    private static final BigDecimal THIRTY_THREE = new BigDecimal("33");

    /**
     * Classifies a reading, or returns {@code null} when there is nothing to classify.
     *
     * <p>A null reading yields a null band rather than a default. {@code BELOW_31} would be the
     * tempting fallback and it is the dangerous one: "no reading" and "the coolest band" would
     * become indistinguishable on screen, and the safer of the two would be assumed for the
     * case where nothing is known at all.
     */
    public static WbgtBand classify(BigDecimal wbgt) {
        if (wbgt == null) {
            return null;
        }
        if (wbgt.compareTo(THIRTY_THREE) >= 0) {
            return BAND_33_AND_ABOVE;
        }
        if (wbgt.compareTo(THIRTY_TWO) >= 0) {
            return BAND_32_TO_BELOW_33;
        }
        if (wbgt.compareTo(THIRTY_ONE) >= 0) {
            return BAND_31_TO_BELOW_32;
        }
        return BELOW_31;
    }
}
