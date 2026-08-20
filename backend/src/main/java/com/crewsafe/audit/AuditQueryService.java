package com.crewsafe.audit;

import com.crewsafe.audit.AuditPageResponse.AuditEntryResponse;
import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

/**
 * Assembles the SCRUM-435 audit timeline: a site-scoped page for the web view, and the whole
 * slice as an RFC-4180 CSV for the inspector download. Both read through
 * {@link AuditExportRepository}, so they scope a site identically — a row visible on screen is
 * a row in the export and vice versa.
 *
 * @author Tang Chee Seng
 * @author Abu Bakar
 */
@Service
@RequiredArgsConstructor
public class AuditQueryService {

    private static final String[] CSV_HEADER = {
            "occurred_at", "actor", "event", "event_type",
            "target_type", "target_id", "correlation_id", "detail"};

    /** Trailer rows below the data, marked with a leading '#' and padded to CSV_HEADER's width
     *  — see {@link #writeTrailer}. */
    private static final int TRAILER_COLUMNS = CSV_HEADER.length;

    private final AuditExportRepository repository;
    private final AuditService audit;
    private final SiteRepository sites;
    private final Clock clock;

    public AuditPageResponse page(UUID siteId, Instant from, Instant to, int page, int pageSize) {
        Page<AuditRowView> rows = repository.findSitePage(siteId, from, to, PageRequest.of(page, pageSize));
        List<AuditEntryResponse> entries = rows.getContent().stream()
                .map(AuditEntryResponse::from)
                .toList();
        return new AuditPageResponse(siteId, from, to, page, pageSize, rows.getTotalElements(), entries);
    }

    /**
     * Streams the whole slice as CSV to {@code out}, self-audits the export, and appends a
     * SHA-256 of the data section so an inspector holding a saved copy of this file, detached
     * from the response that carried it, can prove it has not been altered since.
     *
     * <p>Written row-by-row through a {@code StreamingResponseBody} rather than built into one
     * big String, so a long trail never has to sit in memory in full — the export is exactly the
     * kind of unbounded read that would otherwise blow the heap. That streaming shape is also why
     * the digest cannot be a response header: by the time the last byte is known, the headers have
     * long since been flushed. It goes in the file itself instead, as trailer rows below the data
     * — the header row has to stay on line 1 for the file to open in a standard CSV viewer, a
     * lesson learned the hard way building the same feature's sibling implementation (SCRUM-452).
     *
     * <p>The digest is computed by wrapping {@code out} in a {@link DigestOutputStream} for the
     * header and data rows only; the trailer is then written straight to {@code out}, bypassing
     * the digest, so the checksum never tries to include itself. Verifying is one portable
     * command, printed in the trailer: {@code grep -v '^#' export.csv | shasum -a 256}.
     */
    public void writeCsv(OutputStream out, UUID siteId, UUID actorId, Instant from, Instant to)
            throws IOException {
        MessageDigest digest = sha256();
        Writer dataWriter = new OutputStreamWriter(new DigestOutputStream(out, digest), StandardCharsets.UTF_8);

        writeRecord(dataWriter, CSV_HEADER);
        int rowCount = 0;
        for (AuditRowView row : repository.findSiteSlice(siteId, from, to)) {
            AuditEntryResponse entry = AuditEntryResponse.from(row);
            writeRecord(dataWriter,
                    entry.occurredAt().toString(),
                    entry.actorName(),
                    entry.eventLabel(),
                    entry.eventType(),
                    entry.targetType(),
                    entry.targetId().toString(),
                    entry.correlationId(),
                    entry.detail());
            rowCount++;
        }
        dataWriter.flush();
        String sha256 = HexFormat.of().formatHex(digest.digest());

        Writer trailerWriter = new OutputStreamWriter(out, StandardCharsets.UTF_8);
        writeTrailer(trailerWriter, siteId, from, to, rowCount, sha256);
        trailerWriter.flush();

        // Not deferred to after-commit like the write-side services do: there is no enclosing
        // write transaction whose rollback could orphan this row, and by this point the file has
        // genuinely been produced. AuditService#recordEvent is REQUIRES_NEW, so it commits in its own
        // transaction regardless.
        audit.recordEvent(actorId, AuditEventType.AUDIT_EXPORTED, "SITE", siteId,
                "Exported " + rowCount + " audit events for site " + siteId + " (" + from + " to " + to + ")");
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is mandatory in every conformant JRE; this cannot happen at runtime.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /**
     * Provenance rows appended below the data — 8 more RFC-4180 records, padded to the CSV's own
     * column count so the file stays uniformly rectangular. A leading '#' distinguishes them from
     * data, which doubles as the verification rule: everything that is not a '#' row is exactly
     * what the printed SHA-256 covers.
     */
    private void writeTrailer(Writer writer, UUID siteId, Instant from, Instant to, int rowCount, String sha256)
            throws IOException {
        String siteName = sites.findById(siteId).map(Site::getName).orElse("(unknown site)");

        writeRecord(writer, trailerRow("# CrewSafe SG - audit timeline export", ""));
        writeRecord(writer, trailerRow("# site_id", siteId.toString()));
        writeRecord(writer, trailerRow("# site_name", siteName));
        writeRecord(writer, trailerRow("# range_from", from.toString()));
        writeRecord(writer, trailerRow("# range_to", to.toString()));
        writeRecord(writer, trailerRow("# generated_at", clock.instant().toString()));
        writeRecord(writer, trailerRow("# row_count", String.valueOf(rowCount)));
        writeRecord(writer, trailerRow("# sha256", sha256));
        writeRecord(writer, trailerRow("# verify_with", "grep -v '^#' <this file> | shasum -a 256"));
    }

    private static String[] trailerRow(String label, String value) {
        String[] row = new String[TRAILER_COLUMNS];
        row[0] = label;
        row[1] = value;
        for (int i = 2; i < row.length; i++) {
            row[i] = "";
        }
        return row;
    }

    /** A suggested download filename, e.g. {@code crewsafe-audit-site-<id>-<toDate>.csv}. */
    public String filenameFor(UUID siteId, Instant to) {
        return "crewsafe-audit-site-" + siteId + "-" + to.toString().substring(0, 10) + ".csv";
    }

    /** One CSV record: RFC-4180 fields, comma-separated, CRLF-terminated. */
    private static void writeRecord(Writer writer, String... fields) throws IOException {
        StringBuilder line = new StringBuilder();
        for (int i = 0; i < fields.length; i++) {
            if (i > 0) {
                line.append(',');
            }
            line.append(csvField(fields[i]));
        }
        line.append("\r\n");
        writer.write(line.toString());
    }

    /** Leading characters a spreadsheet treats as the start of a formula (CSV injection). */
    private static final String FORMULA_TRIGGERS = "=+-@\t\r";

    /**
     * RFC-4180 field encoding, plus a CSV-injection guard.
     *
     * <p>RFC-4180: a field is quoted only when it must be — it contains a comma, a double-quote,
     * or a line break — and an embedded double-quote is doubled. A null renders as an empty
     * field, not the text "null".
     *
     * <p>Injection guard: {@code detail} and {@code actor} carry worker- and admin-entered free
     * text. A field beginning with {@code = + - @} (or tab/CR) is executed as a formula when the
     * CSV is opened in Excel or Sheets, so a crafted {@code detail} could run when an inspector
     * opens the export. Prefixing a single quote neutralises the formula while staying human-
     * readable. Applied to every field, not just the obviously free-text ones, since the guard is
     * cheap and a value's provenance is not always visible at this layer.
     */
    private static String csvField(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        String guarded = FORMULA_TRIGGERS.indexOf(value.charAt(0)) >= 0 ? "'" + value : value;
        boolean mustQuote = guarded.contains(",") || guarded.contains("\"")
                || guarded.contains("\n") || guarded.contains("\r");
        if (!mustQuote) {
            return guarded;
        }
        return '"' + guarded.replace("\"", "\"\"") + '"';
    }
}
