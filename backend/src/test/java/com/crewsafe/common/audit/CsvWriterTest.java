package com.crewsafe.common.audit;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * RFC 4180 escaping for the audit export (SCRUM-452). Unit-level because the rules are
 * about single characters, and finding out that a quote broke a column by reading a
 * hundred-row export is the slow way.
 *
 * @author Abu Bakar
 */
class CsvWriterTest {

    private static String write(String... fields) {
        CsvWriter csv = new CsvWriter();
        csv.row(Arrays.asList(fields));
        return csv.content();
    }

    @Test
    void plainFieldsAreNotQuoted() {
        assertThat(write("a", "b", "c")).isEqualTo("a,b,c\r\n");
    }

    @Test
    void aFieldContainingACommaIsQuoted() {
        assertThat(write("one", "two, three")).isEqualTo("one,\"two, three\"\r\n");
    }

    @Test
    void aQuoteIsDoubledAndTheFieldIsQuoted() {
        assertThat(write("he said \"stop\"")).isEqualTo("\"he said \"\"stop\"\"\"\r\n");
    }

    @Test
    void aFieldContainingALineBreakIsQuoted() {
        assertThat(write("line one\nline two")).isEqualTo("\"line one\nline two\"\r\n");
    }

    /** Not the text "null" — see CsvWriter#escape. A blank cell is absence, "null" is a value. */
    @Test
    void aNullFieldIsEmptyNotTheWordNull() {
        assertThat(write("a", null, "c")).isEqualTo("a,,c\r\n");
    }

    /**
     * CRLF regardless of host OS. The digest printed in each export covers these bytes, so
     * the same rows rendering differently on a developer's machine and on CI would make the
     * checksum unverifiable across them.
     */
    @Test
    void rowsAlwaysEndCrlf() {
        CsvWriter csv = new CsvWriter();
        csv.row(List.of("a"));
        csv.row(List.of("b"));

        assertThat(csv.content()).isEqualTo("a\r\nb\r\n");
    }
}
