package com.crewsafe.mitigation.service;

import com.crewsafe.mitigation.ai.bedrock.BedrockApiClient;
import com.crewsafe.mitigation.ai.bedrock.BedrockException;
import com.crewsafe.mitigation.ai.bedrock.BedrockTimeoutException;
import com.crewsafe.mitigation.domain.AgentDraftPlan;
import com.crewsafe.mitigation.domain.MitigationSuggestion;
import com.crewsafe.mitigation.repository.AgentDraftPlanRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Unit tests for AgentDraftPlanService
 */
@DisplayName("Agent Draft Plan Service Tests")
class AgentDraftPlanServiceTest {
    @Mock
    private AgentDraftPlanRepository repository;

    @Mock
    private BedrockApiClient bedrockApiClient;

    private AgentDraftPlanService service;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        service = new AgentDraftPlanService(repository, bedrockApiClient);
    }

    @Nested
    @DisplayName("Generate Draft Plan Tests")
    class GenerateDraftPlanTests {
        private UUID siteId;
        private UUID supervisorId;
        private String context;

        @BeforeEach
        void setUp() {
            siteId = UUID.randomUUID();
            supervisorId = UUID.randomUUID();
            context = "Current WBGT: 32°C, 15 workers on site, 2 hours into shift";
        }

        @Test
        @DisplayName("Successfully generate draft plan and save to database")
        void testGenerateDraftPlanSuccess() {
            // Arrange
            MitigationSuggestion suggestion = new MitigationSuggestion(
                    "high",
                    "Increase rest breaks",
                    "High WBGT requires enhanced rest",
                    "Reduces heat-related injury risk"
            );
            when(bedrockApiClient.generateMitigations(anyString()))
                    .thenReturn(new MitigationSuggestion.Batch(List.of(suggestion)));

            AgentDraftPlan expectedPlan = AgentDraftPlan.builder()
                    .id(UUID.randomUUID())
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .planContext(context)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.PENDING)
                    .build();

            when(repository.save(any(AgentDraftPlan.class))).thenReturn(expectedPlan);

            // Act
            AgentDraftPlan result = service.generateDraftPlan(siteId, supervisorId, context);

            // Assert
            assertNotNull(result);
            assertEquals(siteId, result.getSiteId());
            assertEquals(supervisorId, result.getSupervisorId());
            assertEquals(AgentDraftPlan.ApprovalStatus.PENDING, result.getApprovalStatus());
            verify(repository, times(1)).save(any(AgentDraftPlan.class));
            verify(bedrockApiClient, times(1)).generateMitigations(anyString());
        }

        @Test
        @DisplayName("Handle Bedrock timeout exception")
        void testGenerateDraftPlanTimeout() {
            // Arrange
            when(bedrockApiClient.generateMitigations(anyString()))
                    .thenThrow(new BedrockTimeoutException("Timeout", null));

            // Act & Assert
            assertThrows(BedrockTimeoutException.class,
                    () -> service.generateDraftPlan(siteId, supervisorId, context));
            verify(repository, never()).save(any());
        }

        @Test
        @DisplayName("Handle Bedrock API error")
        void testGenerateDraftPlanBedrockError() {
            // Arrange
            when(bedrockApiClient.generateMitigations(anyString()))
                    .thenThrow(new BedrockException("API Error", null));

            // Act & Assert
            assertThrows(BedrockException.class,
                    () -> service.generateDraftPlan(siteId, supervisorId, context));
            verify(repository, never()).save(any());
        }
    }

    @Nested
    @DisplayName("Approve Draft Plan Tests")
    class ApproveDraftPlanTests {
        private UUID draftPlanId;
        private UUID supervisorId;
        private AgentDraftPlan existingPlan;

        @BeforeEach
        void setUp() {
            draftPlanId = UUID.randomUUID();
            supervisorId = UUID.randomUUID();
            existingPlan = AgentDraftPlan.builder()
                    .id(draftPlanId)
                    .siteId(UUID.randomUUID())
                    .supervisorId(supervisorId)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.PENDING)
                    .build();
        }

        @Test
        @DisplayName("Successfully approve pending draft plan")
        void testApprovePendingPlan() {
            // Arrange
            when(repository.findById(draftPlanId)).thenReturn(Optional.of(existingPlan));
            when(repository.save(any(AgentDraftPlan.class))).thenReturn(existingPlan);

            // Act
            AgentDraftPlan result = service.approveDraftPlan(draftPlanId, supervisorId);

            // Assert
            assertNotNull(result);
            assertEquals(AgentDraftPlan.ApprovalStatus.APPROVED, result.getApprovalStatus());
            assertNotNull(result.getApprovedAt());
            verify(repository, times(1)).save(any(AgentDraftPlan.class));
        }

        @Test
        @DisplayName("Reject approval if supervisor doesn't own plan")
        void testApprovePlanUnauthorized() {
            // Arrange
            UUID wrongSupervisorId = UUID.randomUUID();
            when(repository.findById(draftPlanId)).thenReturn(Optional.of(existingPlan));

            // Act & Assert
            assertThrows(IllegalArgumentException.class,
                    () -> service.approveDraftPlan(draftPlanId, wrongSupervisorId));
            verify(repository, never()).save(any());
        }

        @Test
        @DisplayName("Reject approval if plan not found")
        void testApprovePlanNotFound() {
            // Arrange
            when(repository.findById(draftPlanId)).thenReturn(Optional.empty());

            // Act & Assert
            assertThrows(IllegalArgumentException.class,
                    () -> service.approveDraftPlan(draftPlanId, supervisorId));
        }
    }

    @Nested
    @DisplayName("Reject Draft Plan Tests")
    class RejectDraftPlanTests {
        private UUID draftPlanId;
        private UUID supervisorId;
        private AgentDraftPlan existingPlan;

        @BeforeEach
        void setUp() {
            draftPlanId = UUID.randomUUID();
            supervisorId = UUID.randomUUID();
            existingPlan = AgentDraftPlan.builder()
                    .id(draftPlanId)
                    .siteId(UUID.randomUUID())
                    .supervisorId(supervisorId)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.PENDING)
                    .build();
        }

        @Test
        @DisplayName("Successfully reject draft plan")
        void testRejectPlan() {
            // Arrange
            when(repository.findById(draftPlanId)).thenReturn(Optional.of(existingPlan));
            when(repository.save(any(AgentDraftPlan.class))).thenReturn(existingPlan);

            // Act
            AgentDraftPlan result = service.rejectDraftPlan(draftPlanId, supervisorId);

            // Assert
            assertNotNull(result);
            assertEquals(AgentDraftPlan.ApprovalStatus.REJECTED, result.getApprovalStatus());
            verify(repository, times(1)).save(any(AgentDraftPlan.class));
        }

        @Test
        @DisplayName("Reject operation if supervisor doesn't own plan")
        void testRejectPlanUnauthorized() {
            // Arrange
            UUID wrongSupervisorId = UUID.randomUUID();
            when(repository.findById(draftPlanId)).thenReturn(Optional.of(existingPlan));

            // Act & Assert
            assertThrows(IllegalArgumentException.class,
                    () -> service.rejectDraftPlan(draftPlanId, wrongSupervisorId));
            verify(repository, never()).save(any());
        }
    }

    @Nested
    @DisplayName("Query Draft Plans Tests")
    class QueryDraftPlansTests {
        private UUID siteId;
        private UUID supervisorId;

        @BeforeEach
        void setUp() {
            siteId = UUID.randomUUID();
            supervisorId = UUID.randomUUID();
        }

        @Test
        @DisplayName("Get draft plan by ID")
        void testGetDraftPlan() {
            // Arrange
            UUID planId = UUID.randomUUID();
            AgentDraftPlan plan = AgentDraftPlan.builder()
                    .id(planId)
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .build();

            when(repository.findById(planId)).thenReturn(Optional.of(plan));

            // Act
            AgentDraftPlan result = service.getDraftPlan(planId);

            // Assert
            assertNotNull(result);
            assertEquals(planId, result.getId());
        }

        @Test
        @DisplayName("Get pending draft plans for supervisor at site")
        void testGetPendingPlans() {
            // Arrange
            AgentDraftPlan plan1 = AgentDraftPlan.builder()
                    .id(UUID.randomUUID())
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.PENDING)
                    .build();

            AgentDraftPlan plan2 = AgentDraftPlan.builder()
                    .id(UUID.randomUUID())
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.PENDING)
                    .build();

            when(repository.findBySiteIdAndSupervisorIdAndApprovalStatus(
                    siteId, supervisorId, AgentDraftPlan.ApprovalStatus.PENDING
            )).thenReturn(List.of(plan1, plan2));

            // Act
            List<AgentDraftPlan> result = service.getPendingDraftPlans(siteId, supervisorId);

            // Assert
            assertNotNull(result);
            assertEquals(2, result.size());
        }

        @Test
        @DisplayName("Get all draft plans for supervisor")
        void testGetDraftPlansForSupervisor() {
            // Arrange
            AgentDraftPlan plan = AgentDraftPlan.builder()
                    .id(UUID.randomUUID())
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .build();

            when(repository.findBySupervisorId(supervisorId)).thenReturn(List.of(plan));

            // Act
            List<AgentDraftPlan> result = service.getDraftPlansForSupervisor(supervisorId);

            // Assert
            assertNotNull(result);
            assertEquals(1, result.size());
        }

        @Test
        @DisplayName("Return empty list if no pending plans exist")
        void testGetPendingPlansEmpty() {
            // Arrange
            when(repository.findBySiteIdAndSupervisorIdAndApprovalStatus(
                    siteId, supervisorId, AgentDraftPlan.ApprovalStatus.PENDING
            )).thenReturn(new ArrayList<>());

            // Act
            List<AgentDraftPlan> result = service.getPendingDraftPlans(siteId, supervisorId);

            // Assert
            assertNotNull(result);
            assertTrue(result.isEmpty());
        }
    }
}
