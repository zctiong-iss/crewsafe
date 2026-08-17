package com.crewsafe.common.audit;

import java.util.List;

/**
 * Minimal RFC 4180 CSV assembly for the audit export (SCRUM-452).
 *
 * <p>Hand-rolled rather than pulled from a library: the export writes nine flat string
 * columns and needs exactly one rule from the spec — quote a field that contains a comma,
 * a quote or a line break, and double any quote inside it. A dependency for that is more
 * supply-chain surface than the ten lines it would save.
 *
 * <p>Line endings are CRLF, as RFC 4180 requires, and are written explicitly rather than
 * taken from {@code System.lineSeparator()} — an export whose bytes changed with the host
 * OS would produce a different SHA-256 for the same rows, and the digest in the exported
 * file's preamble is only meaningful if the same range always renders identically.
 *
 * @author Abu Bakar
 */
final class CsvWriter {

    static final String LINE_END = "\r\n";

    private final StringBuilder out = new StringBuilder();

    void row(List<String> fields) {
        for (int i = 0; i < fields.size(); i++) {
            if (i > 0) {
                out.append(',');
            }
            out.append(escape(fields.get(i)));
        }
        out.append(LINE_END);
    }

    String content() {
        return out.toString();
    }

    /**
     * A null renders as an empty field, not the text "null" — a nullable column such as
     * {@code actor_id} on a system-triggered event is absent, and an export that prints
     * "null" into an evidence record invites a reader to treat it as a value.
     */
    private static String escape(String field) {
        if (field == null || field.isEmpty()) {
            return "";
        }
        if (field.indexOf(',') < 0 && field.indexOf('"') < 0
                && field.indexOf('\n') < 0 && field.indexOf('\r') < 0) {
            return field;
        }
        return '"' + field.replace("\"", "\"\"") + '"';
    }
}
