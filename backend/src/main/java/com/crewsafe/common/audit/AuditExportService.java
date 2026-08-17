package com.crewsafe.common.audit;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.site.domain.Site;
import com.crewsafe.site.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Renders a site's audit timeline as an inspector-ready CSV (SCRUM-452, US-15).
 *
 * <p>The four things the story asks the export to carry map onto existing columns rather
 * than new ones: the <em>trace id</em> is {@code correlation_id}, already stamped on every
 * row from {@code RequestIdFilter} (SCRUM-180 built that as groundwork for this export);
 * the <em>actor</em> is {@code actor_id}, resolved here to a display name; the
 * <em>decision</em> is {@code event_type}; and the <em>rule</em> is the human-readable
 * {@code detail}. {@code detail} is free text in a {@code VARCHAR(500)}, so it is emitted
 * verbatim — this service deliberately does not parse it into structured fields, which
 * would be inventing a schema the write side does not have.
 *
 * @author Abu Bakar
 */
@Service
@RequiredArgsConstructor
public class AuditExportService {

    private final AuditEventRepository events;
    private final AppUserRepository users;
    private final SiteRepository sites;
    private final AuditService audit;
    private final Clock clock;

    private static final List<String> COLUMNS = List.of(
            "event_id", "occurred_at", "correlation_id", "actor_id", "actor_name",
            "event_type", "target_type", "target_id", "detail");

    /** A scheduler-driven event has no authenticated actor; the codebase writes null there. */
    private static final String SYSTEM_ACTOR = "SYSTEM";

    /** An actor whose app_user row no longer exists. Named, not blanked: the id is still evidence. */
    private static final String UNKNOWN_ACTOR = "Unknown user";

    /**
     * @param filename what the browser should save it as
     * @param body     the whole file, preamble included; the caller encodes it (UTF-8)
     * @param sha256   hex digest of the CSV section only — see {@link #preamble}
     * @param rowCount audit rows in the export, excluding the column header
     */
    public record AuditExport(String filename, String body, String sha256, int rowCount) {
    }

    /**
     * Read-only, and one query for the rows plus one for the actor names regardless of how
     * many rows come back — an inspector export covering a long range would otherwise be a
     * textbook N+1.
     */
    @Transactional(readOnly = true)
    public AuditExport export(UUID siteId, UUID actorId, Instant from, Instant to) {
        List<AuditEvent> rows = events.findForSiteBetween(siteId, from, to);
        Map<UUID, String> actorNames = actorNames(rows);

        CsvWriter csv = new CsvWriter();
        csv.row(COLUMNS);
        for (AuditEvent event : rows) {
            csv.row(List.of(
                    event.getId().toString(),
                    event.getOccurredAt().toString(),
                    event.getCorrelationId(),
                    event.getActorId() == null ? "" : event.getActorId().toString(),
                    actorName(event, actorNames),
                    event.getEventType(),
                    event.getTargetType(),
                    event.getTargetId().toString(),
                    oneLine(event.getDetail())));
        }

        String csvSection = csv.content();
        String digest = sha256(csvSection);
        String body = csvSection + trailer(siteId, from, to, rows.size(), digest);

        // Recorded inline rather than deferred to after-commit like the write-side services
        // do: there is no enclosing write transaction whose rollback could orphan this row,
        // and by this point the export has genuinely been produced. AuditService is
        // REQUIRES_NEW, so it commits in its own transaction despite the readOnly one here.
        audit.record(actorId, AuditEventType.AUDIT_EXPORTED, "SITE", siteId,
                "Exported " + rows.size() + " audit events for site " + siteId
                        + " (" + from + " to " + to + ")");

        return new AuditExport(filename(siteId), body, digest, rows.size());
    }

    private Map<UUID, String> actorNames(List<AuditEvent> rows) {
        List<UUID> actorIds = rows.stream()
                .map(AuditEvent::getActorId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();

        return users.findAllById(actorIds).stream()
                .collect(Collectors.toMap(AppUser::getId, AppUser::getDisplayName));
    }

    /**
     * A null actor is {@code SYSTEM}, not blank. The distinction matters in an evidence
     * record: the scheduler-driven events ({@code SHIFT_ACTIVATED}, {@code ACTION_LATE},
     * {@code RECOMMENDATION_AUTO_DISPATCHED}) genuinely had no human behind them, and a
     * blank cell reads as missing data rather than as the finding it actually is.
     */
    private String actorName(AuditEvent event, Map<UUID, String> actorNames) {
        if (event.getActorId() == null) {
            return SYSTEM_ACTOR;
        }
        return actorNames.getOrDefault(event.getActorId(), UNKNOWN_ACTOR);
    }

    /**
     * Provenance rows appended <em>below</em> the data, so the file stays self-describing
     * once detached from the response that carried it — an inspector opening this months
     * later has no HTTP headers to consult.
     *
     * <p>Below, not above, and that placement is the whole point. These lines originally sat
     * on top of the file, which made row 1 a one-column comment while every data row had
     * nine. Spreadsheet and JavaScript CSV viewers take row 1 as the header, built a
     * one-column table, then fell over on the first nine-column row — the file parsed
     * correctly and displayed as nothing. The header row has to be line 1, so the metadata
     * moved to the end and is padded to the same nine columns as everything else, leaving
     * the file uniformly rectangular.
     *
     * <p>The digest covers the data section only — a file cannot contain its own hash. The
     * boundary is stated as a property of the lines rather than a line count, so verifying
     * is one portable command with no magic number to drift:
     * {@code grep -v '^#' export.csv | shasum -a 256}. ({@code head -n -N} would have been
     * the positional equivalent, but BSD/macOS {@code head} rejects negative counts, and a
     * printed instruction that fails on the reader's own laptop is worse than none.)
     *
     * <p>That command is only trustworthy because no field can contain a line break — see
     * {@link #oneLine}.
     */
    private String trailer(UUID siteId, Instant from, Instant to, int rowCount, String digest) {
        String siteName = sites.findById(siteId)
                .map(Site::getName)
                .orElse("(unknown site)");

        CsvWriter meta = new CsvWriter();
        meta.row(padded("# CrewSafe SG - audit timeline export", ""));
        meta.row(padded("# site_id", siteId.toString()));
        meta.row(padded("# site_name", oneLine(siteName)));
        meta.row(padded("# range_from", String.valueOf(from)));
        meta.row(padded("# range_to", String.valueOf(to)));
        meta.row(padded("# generated_at", clock.instant().toString()));
        meta.row(padded("# row_count", String.valueOf(rowCount)));
        meta.row(padded("# sha256", digest));
        meta.row(padded("# verify_with", "grep -v '^#' <this file> | shasum -a 256"));

        return meta.content();
    }

    /** A metadata row widened to the data's column count, so the file stays rectangular. */
    private static List<String> padded(String label, String value) {
        List<String> row = new java.util.ArrayList<>(List.of(label, value));
        while (row.size() < COLUMNS.size()) {
            row.add("");
        }
        return row;
    }

    /**
     * Collapses CR/LF in free text to spaces so one audit event is always one physical line.
     *
     * <p>{@code detail} carries operator free text (a cancellation reason, say), and
     * {@link CsvWriter} would faithfully quote an embedded newline — valid CSV that no
     * longer survives line-oriented tooling. Two things depend on one-record-one-line: the
     * {@code grep -v '^#'} verification above, which a newline followed by {@code #} inside a
     * quoted field could otherwise corrupt, and every {@code grep}/{@code wc -l} an inspector
     * might reach for. The writer keeps its newline handling for correctness; this simply
     * never hands it one.
     */
    private static String oneLine(String text) {
        return text == null ? "" : text.replaceAll("[\\r\\n]+", " ");
    }

    private String filename(UUID siteId) {
        return "crewsafe-audit-" + siteId + "-" + clock.instant().toString().replace(":", "") + ".csv";
    }

    private String sha256(String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(content.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is mandatory in every conformant JRE; this cannot happen at runtime.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
