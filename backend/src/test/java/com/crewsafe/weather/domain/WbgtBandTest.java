package com.crewsafe.weather.domain;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The §7.1 band boundaries.
 *
 * <p>Every case here is a boundary or a null, because the middle of a band is not where this
 * gets decided wrongly. A band is the input to a worker's rest and hydration obligations, so an
 * off-by-one at 32.0 is the difference between an hourly ten-minute rest being owed and not.
 *
 * @author Justin Chua
 */
class WbgtBandTest {

    @ParameterizedTest
    @CsvSource({
            // Well inside each band.
            "20.0, BELOW_31",
            "30.9, BELOW_31",
            "31.5, BAND_31_TO_BELOW_32",
            "32.4, BAND_32_TO_BELOW_33",
            "40.0, BAND_33_AND_ABOVE",

            // The boundaries themselves. Half-open: the lower bound belongs to the higher band.
            "31.0, BAND_31_TO_BELOW_32",
            "32.0, BAND_32_TO_BELOW_33",
            "33.0, BAND_33_AND_ABOVE",

            // And the values immediately below each one.
            "30.99, BELOW_31",
            "31.99, BAND_31_TO_BELOW_32",
            "32.99, BAND_32_TO_BELOW_33"
    })
    void classifiesReadingsAgainstTheBandBoundaries(String wbgt, WbgtBand expected) {
        assertThat(WbgtBand.classify(new BigDecimal(wbgt))).isEqualTo(expected);
    }

    @Test
    void returnsNoBandWhenThereIsNoReading() {
        // Deliberately not BELOW_31. "No reading" and "the coolest band" must stay
        // distinguishable, or the safest interpretation gets assumed for the case where
        // nothing at all is known.
        assertThat(WbgtBand.classify(null)).isNull();
    }

    @Test
    void comparesByValueRatherThanScale() {
        // BigDecimal.equals would treat 32.0 and 32.00 as different; compareTo does not. The
        // ingestion stores whatever scale NEA sent, so this is a real input, not a contrivance.
        assertThat(WbgtBand.classify(new BigDecimal("32.00")))
                .isEqualTo(WbgtBand.classify(new BigDecimal("32.0")))
                .isEqualTo(WbgtBand.BAND_32_TO_BELOW_33);
    }
}
