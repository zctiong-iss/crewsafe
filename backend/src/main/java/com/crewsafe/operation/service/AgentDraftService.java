package com.crewsafe.operation.service;

import com.crewsafe.common.audit.AuditEventType;
import com.crewsafe.common.audit.AuditService;
import com.crewsafe.common.error.BadRequestException;
import com.crewsafe.common.error.ConflictException;
import com.crewsafe.common.error.ErrorCode;
import com.crewsafe.forecast.service.ForecastUnavailableException;
import com.crewsafe.forecast.service.SiteForecastService;
import com.crewsafe.lightning.api.LightningRiskPayload;
import com.crewsafe.lightning.domain.LightningRiskState;
import com.crewsafe.lightning.risk.LightningRiskDerivationService;
import com.crewsafe.mitigation.ai.bedrock.AgentDraftClient;
import com.crewsafe.mitigation.domain.ActionCatalogue;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.domain.RecommendationEvidence;
import com.crewsafe.operation.repository.RecommendationRepository;
import com.crewsafe.policy.domain.PolicyDecision;
import com.crewsafe.policy.service.PolicyEngineService;
import com.crewsafe.shift.domain.Shift;
import com.crewsafe.shift.domain.ShiftAssignment;
import com.crewsafe.shift.domain.ShiftStatus;
import com.crewsafe.shift.repository.ReadinessSubmissionRepository;
import com.crewsafe.shift.repository.ShiftAssignmentRepository;
import com.crewsafe.shift.repository.ShiftRepository;
import com.crewsafe.weather.domain.WbgtBand;
import com.crewsafe.weather.domain.WeatherObservation;
import com.crewsafe.weather.service.WeatherQueryService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Drafts an explainable recommendation for a shift (SCRUM-289, completing US-08).
 *
 * <h2>Why the context gathering lives here and not in the Python graph</h2>
 *
 * The SCRUM-118 design doc draws the whole agent in ml-service. This service is a deliberate
 * deviation, recorded in the ticket's plan doc. Of the six inputs the agent needs, four are
 * reachable only from Java — the policy engine, shift assignments and readiness have no HTTP
 * endpoint at all, and the weather and lightning endpoints that do exist are per-user JWT
 * authenticated and unusable service-to-service. A pure Python graph would have needed roughly
 * four new internal endpoints plus a service-auth mechanism that does not exist, and would have
 * called back into the service that called it.
 *
 * <p>The arrangement also buys the guarantee that matters most. §8.2 requires policy evaluation
 * before any model call, and here that is <em>structural</em>: the ml-service request cannot be
 * constructed without a {@link PolicyDecision} inside it, and ml-service rejects one that
 * arrives without it. Nobody has to remember the rule.
 *
 * <h2>There is no failure mode that returns no plan</h2>
 *
 * A supervisor pressing "generate" during a heat event gets a plan. Lightning short-circuits to
 * a stop-work plan before any model call; an unreachable ml-service, an unusable draft, or a
 * model that never answered all land on {@link DeterministicPlanBuilder}. The only 4xx paths are
 * about the <em>request</em> — an unknown shift, a cancelled one, or a site with no readings at
 * all — never about the model.
 *
 * <p>Both 4xx paths carry an {@link ErrorCode}, because "no plan was drafted" is not
 * self-explanatory to the person who pressed the button and the two causes need different
 * actions from different people (SCRUM-289 follow-up).
 *
 * @author Abu Bakar and Justin Chua
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AgentDraftService {

    /** Recorded as {@code modelVersion} when lightning meant no model was consulted. */
    static final String LIGHTNING_MODEL_VERSION = "deterministic-lightning";

    /** Recorded as {@code modelVersion} when the model's output was unavailable or discarded. */
    static final String FALLBACK_MODEL_VERSION = "deterministic-fallback";

    /** {@code targetType} for every audit event this class records. Same pattern as {@code
     * ActionDispatchService#AUDIT_TARGET_TYPE}. */
    private static final String AUDIT_TARGET_TYPE = "RECOMMENDATION";

    /**
     * A plan may be drafted for a shift that has not started yet or is running, but not for one
     * that is over or called off — drafting heat controls for either is meaningless, and for a
     * CANCELLED shift it would also let a plan be approved and fanned out to workers who are no
     * longer expected on site (SCRUM-255).
     */
    private static final Set<ShiftStatus> DRAFTABLE_STATUSES = EnumSet.of(ShiftStatus.PLANNED, ShiftStatus.ACTIVE);

    private final ShiftRepository shifts;
    private final ShiftAssignmentRepository shiftAssignments;
    private final ReadinessSubmissionRepository readinessSubmissions;
    private final PolicyEngineService policyEngine;
    private final WeatherQueryService weather;
    private final LightningRiskDerivationService lightning;
    private final SiteForecastService siteForecast;
    private final AgentDraftClient agentDraftClient;
    private final DeterministicPlanBuilder deterministicPlans;
    private final RecommendationRepository recommendations;
    private final RecommendationService recommendationService;
    private final AuditService audit;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    /**
     * Gathers context, evaluates policy, drafts a plan and persists it as PENDING_APPROVAL.
     *
     * <p>Empty when no shift with this id exists under this site — the caller renders 404.
     *
     * @throws BadRequestException if the shift is closed or cancelled
     * @throws ConflictException if the site has no usable WBGT reading and no lightning stop-work
     */
    @Transactional
    public Optional<Recommendation> generate(UUID siteId, UUID shiftId, UUID actorId) {
        return doGenerate(siteId, shiftId, actorId);
    }

    private Optional<Recommendation> doGenerate(UUID siteId, UUID shiftId, UUID actorId) {
        Optional<Shift> found = shifts.findByIdAndSiteId(shiftId, siteId);
        if (found.isEmpty()) {
            return Optional.empty();
        }
        Shift shift = found.get();
        if (!DRAFTABLE_STATUSES.contains(shift.getStatus())) {
            throw new BadRequestException(
                    "Cannot draft a recommendation for a " + shift.getStatus() + " shift");
        }

        List<ShiftAssignment> assignments = shiftAssignments.findByShiftId(shiftId);
        Instant now = clock.instant();

        Optional<WeatherQueryService.LatestSiteWeather> latestWeather = weather.findLatestForSite(siteId);
        LightningRiskState lightningState = lightning.deriveForSite(siteId, now)
                .map(LightningRiskPayload::state)
                .orElse(null);
        Double observedWbgt = usableWbgt(latestWeather).orElse(null);

        if (observedWbgt == null && lightningState != LightningRiskState.STOP_WORK) {
            // Nothing to assess and nothing overriding it. Refusing is the honest answer: a plan
            // invented from no reading would carry an evidence block with nothing in it, which is
            // exactly the unexplainable output US-08 exists to prevent.
            throw new ConflictException(
                    "No usable WBGT reading is available for this site, so no plan can be drafted",
                    ErrorCode.NO_USABLE_WBGT);
        }

        // Evaluated even on the lightning path. The plan itself will not come from it, but the
        // recommendation still has to record which policy version was in force and which band the
        // site was in — §12.2 requires both on every recommendation, not only on heat-driven ones.
        PolicyDecision decision = observedWbgt == null ? null : evaluatePolicy(siteId, observedWbgt, assignments);

        Draft draft = lightningState == LightningRiskState.STOP_WORK
                ? lightningDraft(lightningState, assignments, observedWbgt)
                : modelDraft(shift, siteId, decision, assignments, latestWeather, lightningState, observedWbgt);

        RecommendationEvidence evidence = evidence(
                latestWeather, decision, draft.forecastWbgt30m(), lightningState, observedWbgt);

        // SCRUM-440: a lightning-immediate stop-work or a WBGT-max mandatory stop-work skips
        // supervisor approval entirely, per the team's four-rule alert policy -- whether this
        // draft was auto-triggered or a supervisor pressed "Generate" themselves and it turned
        // out to be one of these two. Checked here, not against the persisted plan later:
        // decision.isEmergencyStop() and lightningState are live at draft time and this is the
        // only place both are still in hand -- neither survives into the persisted Recommendation
        // row, so a model-suggested STOP_WORK that was never actually mandatory cannot be
        // mistaken for one after the fact.
        boolean autoDispatch = lightningState == LightningRiskState.STOP_WORK
                || (decision != null && decision.isEmergencyStop());

        Recommendation saved = recommendations.save(Recommendation.builder()
                .id(UUID.randomUUID())
                .shiftId(shiftId)
                .policyVersion(decision == null ? null : decision.policyVersion())
                // PENDING_APPROVAL, never DRAFT. Mobile's status type has no DRAFT member, and its
                // status pill falls through to rendering an unknown status as a green "Approved" —
                // a plan nobody has approved would display as approved. The enum value exists for
                // historical rows; nothing new may be written with it.
                .status(autoDispatch ? Recommendation.RecommendationStatus.AUTO_DISPATCHED
                        : Recommendation.RecommendationStatus.PENDING_APPROVAL)
                .draftPlan(serialise(new MitigationSuggestion.Batch(draft.mitigations())))
                .rationale(draft.rationale())
                .evidence(serialiseEvidence(evidence))
                .modelVersion(draft.modelVersion())
                .createdAt(now)
                .build());

        log.info("recommendation_drafted shift_id={} mitigations={} model_version={} fallback_reason={} "
                        + "auto_dispatch={}",
                shiftId, draft.mitigations().size(), draft.modelVersion(), draft.fallbackReason(), autoDispatch);

        UUID recommendationId = saved.getId();
        if (autoDispatch) {
            afterCommit(() -> audit.record(actorId, AuditEventType.RECOMMENDATION_AUTO_DISPATCHED, AUDIT_TARGET_TYPE,
                    recommendationId, auditDetail(draft)));
            afterCommit(() -> recommendationService.autoDispatch(saved, actorId, draft.mitigations()));
        } else {
            afterCommit(() -> audit.record(actorId, AuditEventType.RECOMMENDATION_DRAFTED, AUDIT_TARGET_TYPE,
                    recommendationId, auditDetail(draft)));
        }

        return Optional.of(saved);
    }

    /**
     * The auto-trigger's entry point (SCRUM-291): supersedes whichever recommendation is
     * currently open for this shift, then drafts a new one exactly as {@link #generate} would
     * for a supervisor, with a null actor recording that this draft was system-triggered — the
     * same convention {@code ShiftService#activateDueShifts} uses for {@code SHIFT_ACTIVATED}.
     *
     * <p>Dedup, not stacking: a shift's conditions can change again before anyone has looked at
     * the last draft, and the old one is now describing conditions that no longer hold. Callers
     * are expected to have already checked the shift-state guard — this method does not
     * re-derive it, the same way {@link #generate} does not re-check who is allowed to call it.
     */
    @Transactional
    public Optional<Recommendation> generateAuto(UUID siteId, UUID shiftId) {
        supersedeOpenRecommendation(shiftId);
        return doGenerate(siteId, shiftId, null);
    }

    private void supersedeOpenRecommendation(UUID shiftId) {
        recommendations.findFirstByShiftIdAndStatusOrderByCreatedAtDesc(
                shiftId, Recommendation.RecommendationStatus.PENDING_APPROVAL).ifPresent(existing -> {
            existing.setStatus(Recommendation.RecommendationStatus.SUPERSEDED);
            recommendations.save(existing);

            UUID existingId = existing.getId();
            afterCommit(() -> audit.record(null, AuditEventType.RECOMMENDATION_SUPERSEDED, AUDIT_TARGET_TYPE,
                    existingId, "Superseded by a new auto-triggered draft for shift " + shiftId));
        });
    }

    /**
     * A site with no ACTIVE heat policy is a configuration state, not a server fault.
     *
     * <p>{@link PolicyEngineService} signals it with {@link NoSuchElementException}, which no
     * handler maps, so it would otherwise surface as a 500 — telling a supervisor the system is
     * broken when the real answer is that nobody has configured this site's thresholds yet. It
     * is a reachable state rather than a theoretical one: {@code V9}'s seeding INSERT is
     * commented out and {@code V12} carried forward from that empty table, so a site created
     * through the API has no policy version until a Safety Manager configures one (SCRUM-120).
     *
     * <p>Refused rather than defaulted. Falling back to built-in thresholds would mean deciding
     * what a worker must do using numbers nobody at this site signed off on, and §7.1 is
     * explicit that thresholds are configuration records rather than hard-coded values.
     */
    private PolicyDecision evaluatePolicy(UUID siteId, Double observedWbgt, List<ShiftAssignment> assignments) {
        try {
            return policyEngine.evaluateForShift(siteId, observedWbgt, assignments);
        } catch (NoSuchElementException e) {
            throw new ConflictException(
                    "No active heat policy is configured for this site, so no plan can be drafted. "
                            + "A Safety Manager must configure and activate a policy version first.",
                    ErrorCode.NO_ACTIVE_POLICY);
        }
    }

    /**
     * §7.1: a lightning stop-work outranks every heat rule, so the model is not consulted at all.
     *
     * <p>Skipping the call is not just an optimisation. The answer is already known with
     * certainty, and asking a language model to phrase it would introduce a way for it to be
     * phrased wrongly during the one situation with the least time to notice.
     */
    private Draft lightningDraft(LightningRiskState state, List<ShiftAssignment> assignments, Double observedWbgt) {
        List<UUID> workerIds = assignments.stream().map(ShiftAssignment::getWorkerId).distinct().toList();
        return new Draft(
                deterministicPlans.forLightning(workerIds),
                deterministicPlans.rationaleForLightning(state, observedWbgt),
                LIGHTNING_MODEL_VERSION,
                "lightning_stop_work",
                null);
    }

    private Draft modelDraft(Shift shift, UUID siteId, PolicyDecision decision, List<ShiftAssignment> assignments,
                              Optional<WeatherQueryService.LatestSiteWeather> latestWeather,
                              LightningRiskState lightningState, Double observedWbgt) {
        // Fetched before the try, not inside it: if ml-service itself is unreachable below, the
        // deterministic plan that results should still carry this in its evidence rather than
        // discarding a forecast that was already fetched successfully.
        Double forecastWbgt30m = fetchForecast(siteId);
        try {
            AgentDraftClient.DraftRequest request = new AgentDraftClient.DraftRequest(
                    shift.getId().toString(),
                    siteId.toString(),
                    observedWbgt,
                    forecastWbgt30m,
                    latestWeather.map(w -> w.qualityStatus().name()).orElse("STALE"),
                    lightningState == null ? "CLEAR" : lightningState.name(),
                    workerPayloads(shift.getId(), assignments),
                    // Empty for now. Worker concerns and unacknowledged dispatches are real §8.6
                    // coverage buckets and the field exists for them, but they are outside this
                    // ticket's data sources, and anything added here must be summarised
                    // server-side — the strings reach the model inside its prompt.
                    List.of(),
                    policyPayload(decision));
            AgentDraftClient.DraftResponse response = agentDraftClient.draft(request);

            List<MitigationSuggestion> mitigations =
                    response.mitigations() == null ? List.of() : response.mitigations();
            String rejection = rejectionReason(mitigations, decision);
            if (rejection != null) {
                log.warn("agent_draft_rejected_by_backend_gate shift_id={} reason={}", shift.getId(), rejection);
                return deterministicDraft(decision, observedWbgt, rejection, response.forecastWbgt30m());
            }

            if (response.usedFallback()) {
                // ml-service already fell back; its plan is the deterministic one, so it is kept
                // as-is rather than rebuilt here, but it must not be attributed to the model.
                return new Draft(mitigations, response.rationale(), FALLBACK_MODEL_VERSION,
                        response.fallbackReason(), response.forecastWbgt30m());
            }
            return new Draft(mitigations, response.rationale(), response.modelId(), null,
                    response.forecastWbgt30m());

        } catch (Exception e) {
            // ml-service unreachable, timed out, or returned something unusable. The Python
            // fallback cannot cover this case — it needs ml-service to be running — so this is
            // the layer that turns it into a plan instead of a 5xx.
            log.warn("agent_draft_unavailable shift_id={} falling back to the deterministic plan", shift.getId());
            return deterministicDraft(decision, observedWbgt, "ml_service_unavailable", forecastWbgt30m);
        }
    }

    /**
     * The trained-model 30-minute forecast (SCRUM-281), or null if one cannot be produced yet.
     *
     * <p>Every reason {@link SiteForecastService} can refuse — no weather history, too little of
     * it, a stale or simulated reading, a station change mid-window, ml-service itself being
     * unreachable — describes context that legitimately does not exist, not a bug. §7.1 says a
     * degraded input degrades the output, it does not fail the request: a null here is not
     * silently dropped, it is exactly what tells the graph to fall back to its own persistence
     * baseline (see {@code agent/graph.py}'s {@code _forecast_node}), so the plan still gets
     * <em>a</em> forecast figure, just not a predictive one.
     */
    private Double fetchForecast(UUID siteId) {
        try {
            return siteForecast.forecast(siteId, 30)
                    .map(forecast -> forecast.predictedValue().doubleValue())
                    .orElse(null);
        } catch (ForecastUnavailableException e) {
            log.warn("forecast_unavailable site_id={} reason={}", siteId, e.getMessage());
            return null;
        }
    }

    private Draft deterministicDraft(PolicyDecision decision, Double observedWbgt, String reason, Double forecast) {
        return new Draft(
                deterministicPlans.fromPolicy(decision),
                deterministicPlans.rationaleFromPolicy(decision, observedWbgt, reason),
                FALLBACK_MODEL_VERSION,
                reason,
                forecast);
    }

    /**
     * The authoritative §8.5 gate. Null means the draft may be persisted.
     *
     * <p>This repeats checks ml-service already ran, on purpose. Python's validation exists to
     * decide whether to retry or fall back; this one decides whether a plan may be stored and
     * shown to a supervisor, and a validator living in the same process as the thing it
     * validates is a single point of failure. If the graph's routing is ever wrong, or a future
     * caller reaches this service some other way, this is the check that still holds.
     *
     * <p>Deliberately narrower than Python's: only the two conditions that make a plan
     * <em>unsafe</em> rather than merely imperfect. An unknown action code cannot be translated
     * for a worker and would reach them as humanised English; a missing mandatory action is
     * §8.1's forbidden omission. Wording and citation quality are the model-selection
     * benchmark's concern, not a reason to discard a plan at persist time.
     */
    private String rejectionReason(List<MitigationSuggestion> plan, PolicyDecision decision) {
        List<String> unknown = plan.stream()
                .map(MitigationSuggestion::actionCode)
                .filter(code -> code == null || !ActionCatalogue.isKnown(code))
                .distinct()
                .toList();
        if (!unknown.isEmpty()) {
            return "unknown_action_code: " + String.join(", ", unknown);
        }

        if (decision != null) {
            Set<String> drafted = plan.stream()
                    .map(MitigationSuggestion::actionCode)
                    .collect(java.util.stream.Collectors.toSet());
            List<String> missing = decision.mandatoryActions().stream()
                    .map(PolicyDecision.PolicyAction::code)
                    .filter(code -> !drafted.contains(code))
                    .distinct()
                    .toList();
            if (!missing.isEmpty()) {
                return "missing_mandatory_action: " + String.join(", ", missing);
            }
        }
        return null;
    }

    private List<AgentDraftClient.DraftRequest.Worker> workerPayloads(UUID shiftId, List<ShiftAssignment> assignments) {
        return assignments.stream()
                .map(assignment -> new AgentDraftClient.DraftRequest.Worker(
                        assignment.getWorkerId().toString(),
                        assignment.getIntensity().name(),
                        // Mirrors PolicyEngineService.evaluateForShift: a missing acclimatisation day
                        // is day 1, the strictest tier. Missing data means more protection, not less.
                        assignment.getAcclimatisationDay() == null ? 1 : assignment.getAcclimatisationDay(),
                        readinessSubmissions
                                .findFirstByShiftIdAndWorkerIdOrderBySubmittedAtDescIdDesc(
                                        shiftId, assignment.getWorkerId())
                                .isPresent()))
                .toList();
    }

    private AgentDraftClient.DraftRequest.PolicyDecisionPayload policyPayload(PolicyDecision decision) {
        return new AgentDraftClient.DraftRequest.PolicyDecisionPayload(
                decision.policyVersion(),
                bandWireName(decision.currentBand()),
                bandWireName(decision.forecastBand()),
                decision.mandatoryActions().stream().map(this::actionPayload).toList(),
                decision.advisoryActions().stream().map(this::actionPayload).toList());
    }

    private AgentDraftClient.DraftRequest.Action actionPayload(PolicyDecision.PolicyAction action) {
        return new AgentDraftClient.DraftRequest.Action(
                action.code(), action.ruleReference(), action.appliesTo(), action.reasoning());
    }

    /**
     * {@link WbgtBand}'s JSON name, not its Java constant name — a Java identifier cannot start
     * with a digit, so the constants carry a {@code BAND_} prefix the wire format drops. The
     * ml-service contract validates against the wire names, so sending {@code name()} would fail
     * on three of the four bands.
     */
    private static String bandWireName(WbgtBand band) {
        if (band == null) {
            return null;
        }
        return band == WbgtBand.BELOW_31 ? "BELOW_31" : band.name().substring("BAND_".length());
    }

    private RecommendationEvidence evidence(Optional<WeatherQueryService.LatestSiteWeather> latestWeather,
                                             PolicyDecision decision, Double forecastWbgt30m,
                                             LightningRiskState lightningState, Double observedWbgt) {
        WeatherObservation observation = latestWeather
                .map(WeatherQueryService.LatestSiteWeather::observation)
                .orElse(null);
        BigDecimal forecast = forecastWbgt30m == null ? null : BigDecimal.valueOf(forecastWbgt30m);

        return new RecommendationEvidence(
                observedWbgt == null ? null : BigDecimal.valueOf(observedWbgt),
                forecast,
                decision == null ? null : decision.currentBand(),
                // Classified from the forecast value actually used, not copied from the policy
                // decision. PolicyEngineService still hardcodes forecastBand = currentBand behind
                // a TODO for SCRUM-188, which was harmless only while the forecast was always the
                // persistence baseline (forecast == observed, so the bands always matched anyway).
                // Now that fetchForecast() can return a real SCRUM-281 prediction, that hardcoding
                // would misclassify the evidence the moment the two values genuinely differ;
                // deriving it here from forecast itself keeps it correct regardless.
                WbgtBand.classify(forecast),
                observation == null ? null : observation.getObservedAt(),
                latestWeather.map(WeatherQueryService.LatestSiteWeather::qualityStatus).orElse(null),
                observation == null ? null : observation.getSource(),
                observation == null ? null : observation.getStationId(),
                lightningState);
    }

    /**
     * A reading is usable only if it exists and the policy engine would accept it. Anything
     * outside 15–40°C is a sensor fault rather than weather, and passing it through would make
     * {@code evaluateForShift} throw a 500 out of what is really a data-quality problem.
     */
    private Optional<Double> usableWbgt(Optional<WeatherQueryService.LatestSiteWeather> latestWeather) {
        return latestWeather
                .map(WeatherQueryService.LatestSiteWeather::observation)
                .map(WeatherObservation::getWbgt)
                .map(BigDecimal::doubleValue)
                .filter(wbgt -> wbgt >= 15 && wbgt <= 40);
    }

    private String auditDetail(Draft draft) {
        return "Recommendation drafted (model=" + draft.modelVersion()
                + (draft.fallbackReason() == null ? "" : ", fallback=" + draft.fallbackReason()) + ")";
    }

    private String serialise(MitigationSuggestion.Batch batch) {
        try {
            return objectMapper.writeValueAsString(batch);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize draft plan", e);
        }
    }

    private String serialiseEvidence(RecommendationEvidence evidence) {
        try {
            return objectMapper.writeValueAsString(evidence);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize recommendation evidence", e);
        }
    }

    /**
     * {@code AuditService#record} runs in {@code REQUIRES_NEW}, so an inline call would commit
     * the audit row independently of this transaction — leaving a "drafted" event behind for a
     * recommendation that rolled back. Same pattern and reason as {@code RecommendationService}.
     */
    private void afterCommit(Runnable action) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    }

    /** The drafted plan plus how it came to be, before it becomes a {@link Recommendation}. */
    private record Draft(List<MitigationSuggestion> mitigations, String rationale, String modelVersion,
                          String fallbackReason, Double forecastWbgt30m) {
    }
}
