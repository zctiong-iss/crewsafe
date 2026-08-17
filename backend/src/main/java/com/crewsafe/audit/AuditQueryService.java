package com.crewsafe.audit;

import com.crewsafe.audit.AuditPageResponse.AuditEntryResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Assembles the SCRUM-435 audit timeline: a site-scoped page for the web view, and the whole
 * slice as an RFC-4180 CSV for the inspector download. Both read through
 * {@link AuditExportRepository}, so they scope a site identically — a row visible on screen is
 * a row in the export and vice versa.
 *
 * @author Tang Chee Seng
 */
@Service
@RequiredArgsConstructor
public class AuditQueryService {

    private static final String[] CSV_HEADER = {
            "occurred_at", "actor", "event", "event_type",
            "target_type", "target_id", "correlation_id", "detail"};

    private final AuditExportRepository repository;

    public AuditPageResponse page(UUID siteId, Instant from, Instant to, int page, int pageSize) {
        Page<AuditRowView> rows = repository.findSitePage(siteId, from, to, PageRequest.of(page, pageSize));
        List<AuditEntryResponse> entries = rows.getContent().stream()
                .map(AuditEntryResponse::from)
                .toList();
        return new AuditPageResponse(siteId, from, to, page, pageSize, rows.getTotalElements(), entries);
    }

    /**
     * Streams the whole slice as CSV to {@code out}. Written row-by-row through a
     * {@code StreamingResponseBody} rather than built into one big String, so a long trail never
     * has to sit in memory in full — the export is exactly the kind of unbounded read that would
     * otherwise blow the heap.
     */
    public void writeCsv(OutputStream out, UUID siteId, Instant from, Instant to) throws IOException {
        Writer writer = new OutputStreamWriter(out, StandardCharsets.UTF_8);
        writeRecord(writer, CSV_HEADER);
        for (AuditRowView row : repository.findSiteSlice(siteId, from, to)) {
            AuditEntryResponse entry = AuditEntryResponse.from(row);
            writeRecord(writer,
                    entry.occurredAt().toString(),
                    entry.actorName(),
                    entry.eventLabel(),
                    entry.eventType(),
                    entry.targetType(),
                    entry.targetId().toString(),
                    entry.correlationId(),
                    entry.detail());
        }
        writer.flush();
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

    /**
     * RFC-4180 field encoding: a field is quoted only when it must be — it contains a comma, a
     * double-quote, or a line break — and an embedded double-quote is doubled. A null renders as
     * an empty field, not the text "null".
     */
    private static String csvField(String value) {
        if (value == null) {
            return "";
        }
        boolean mustQuote = value.contains(",") || value.contains("\"")
                || value.contains("\n") || value.contains("\r");
        if (!mustQuote) {
            return value;
        }
        return '"' + value.replace("\"", "\"\"") + '"';
    }
}
