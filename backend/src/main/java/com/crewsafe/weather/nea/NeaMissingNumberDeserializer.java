package com.crewsafe.weather.nea;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;

import java.io.IOException;
import java.math.BigDecimal;

/**
 * Reads a data.gov.sg numeric reading, treating the agency's "no value" placeholders as absent
 * rather than as a parse failure.
 *
 * <h2>Why this exists</h2>
 *
 * data.gov.sg returns {@code "NA"} for a station that is online but has no reading for this
 * interval. The WBGT DTO typed that field as {@link BigDecimal}, so Jackson threw
 * {@code InvalidFormatException} partway through the response — and because the failure happens
 * during deserialization of the whole payload, <em>every</em> station's reading was lost, not
 * just the one that reported {@code "NA"}. A single offline station discarded the other
 * nineteen, and the WBGT history the forecast is built from ended up full of missing cycles.
 *
 * <p>Returning null instead makes an absent reading a per-station fact, which is what
 * {@code DataGovSgNeaWeatherClient} already assumed it was: its mapper has always had a
 * {@code wbgt() == null} branch. That branch was simply unreachable, because parsing died first.
 *
 * <h2>What this deliberately does not do</h2>
 *
 * It is lenient about <em>missing</em>, never about <em>malformed</em>. A value that is neither a
 * number nor a recognised placeholder still throws, because a WBGT of {@code "27.4C"} or
 * {@code "twenty"} means the upstream format has changed underneath us and silently reading that
 * as "no data" would turn a contract break into a slow, invisible gap in safety readings.
 *
 * <p>Applied only to the reading value. Latitude and longitude keep the strict mapping — a
 * station that cannot say where it is <em>is</em> a malformed record, not an incomplete one.
 *
 * @author Justin Chua
 */
public class NeaMissingNumberDeserializer extends JsonDeserializer<BigDecimal> {

    /**
     * The placeholders data.gov.sg uses for a reading it does not have. Compared
     * case-insensitively after trimming; an empty string counts as absent too.
     */
    private static final String[] ABSENT = {"NA", "N.A.", "-", "null"};

    @Override
    public BigDecimal deserialize(JsonParser parser, DeserializationContext context)
            throws IOException {
        if (parser.currentToken() != null && parser.currentToken().isNumeric()) {
            return parser.getDecimalValue();
        }

        String raw = parser.getValueAsString();
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        for (String absent : ABSENT) {
            if (absent.equalsIgnoreCase(trimmed)) {
                return null;
            }
        }

        try {
            // Numbers sent as strings are ordinary in this API and are not a format change.
            return new BigDecimal(trimmed);
        } catch (NumberFormatException e) {
            // Not a number and not a known placeholder: the upstream contract has moved.
            // Deliberately does not echo the value - it is untrusted third-party input and the
            // message reaches the log sink.
            return (BigDecimal) context.handleWeirdStringValue(
                    BigDecimal.class, trimmed, "not a number or a recognised NEA placeholder");
        }
    }
}
