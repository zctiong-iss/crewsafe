package com.crewsafe.operation.repository;

import com.crewsafe.operation.domain.Approval;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Repository for Approval persistence operations.
 *
 * @author Surya Kumaraguru and Justin Chua
 */
@Repository
public interface ApprovalRepository extends JpaRepository<Approval, UUID> {

    /**
     * Fetches the approver with the approval, because the caller needs their name.
     *
     * <p>{@code Approval.approver} is {@code FetchType.LAZY} and
     * {@code RecommendationService.approvalFor} runs outside a transaction, so the entity comes
     * back holding an uninitialised proxy. That was invisible while the response only read
     * {@code getApprover().getId()} — an id is available on a proxy without touching the
     * database — and became fourteen 500s the moment {@code getDisplayName()} was added, which
     * forces initialisation with no session left to do it in.
     *
     * <p>An entity graph rather than making the association EAGER: this is the one query that
     * needs the approver, and a global fetch change would pull a user row into every other
     * place an Approval is loaded.
     */
    @EntityGraph(attributePaths = "approver")
    Optional<Approval> findByRecommendationId(UUID recommendationId);
}
