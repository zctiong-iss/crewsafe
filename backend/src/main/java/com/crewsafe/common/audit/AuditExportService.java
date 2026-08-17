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

    /** Comment lines above the CSV. Fixed, because it is where the SHA-256 boundary sits. */
    private static final int PREAMBLE_LINES = 8;

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
                    event.getDetail() == null ? "" : event.getDetail()));
        }

        String csvSection = csv.content();
        String digest = sha256(csvSection);
        String body = preamble(siteId, from, to, rows.size(), digest) + csvSection;

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
     * Comment lines above the CSV, so the file is self-describing when it is detached from
     * the request that produced it — an inspector holding this months later has no HTTP
     * response headers to consult.
     *
     * <p>The digest covers the CSV section only, not the whole file. Hashing the whole file
     * while printing the hash inside it is circular; naming the boundary instead makes the
     * claim checkable. The preamble is always exactly {@value #PREAMBLE_LINES} lines, so
     * verifying is one command: {@code tail -n +9 export.csv | shasum -a 256}.
     *
     * <p>CR and LF are stripped from the site name because the preamble is line-structured:
     * a name carrying a line break would forge extra preamble lines and shift that boundary.
     */
    private String preamble(UUID siteId, Instant from, Instant to, int rowCount, String digest) {
        String siteName = sites.findById(siteId)
                .map(Site::getName)
                .map(name -> name.replaceAll("[\\r\\n]", " "))
                .orElse("(unknown site)");

        List<String> lines = List.of(
                "# CrewSafe SG - audit timeline export",
                "# site_id: " + siteId,
                "# site_name: " + siteName,
                "# range_from: " + from,
                "# range_to: " + to,
                "# generated_at: " + clock.instant(),
                "# row_count: " + rowCount,
                "# sha256: " + digest + " (SHA-256 of every byte below this preamble)");

        if (lines.size() != PREAMBLE_LINES) {
            // The file tells its reader to skip exactly PREAMBLE_LINES to verify the digest.
            // Changing the preamble without changing that constant would silently print a
            // verification instruction that no longer works.
            throw new IllegalStateException(
                    "Preamble is " + lines.size() + " lines but PREAMBLE_LINES says " + PREAMBLE_LINES);
        }

        return String.join(CsvWriter.LINE_END, lines) + CsvWriter.LINE_END;
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
