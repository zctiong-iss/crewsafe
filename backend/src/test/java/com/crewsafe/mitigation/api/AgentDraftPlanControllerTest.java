package com.crewsafe.mitigation.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.mitigation.ai.bedrock.BedrockException;
import com.crewsafe.mitigation.ai.bedrock.BedrockTimeoutException;
import com.crewsafe.mitigation.domain.AgentDraftPlan;
import com.crewsafe.mitigation.service.AgentDraftPlanService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for AgentDraftPlanController.
 * Tests API endpoints and authorization using full Spring context.
 *
 * @author Surya Kumaraguru
 */
@AutoConfigureMockMvc
@DisplayName("Agent Draft Plan Controller Tests")
class AgentDraftPlanControllerTest extends AbstractIntegrationTest {
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AppUserRepository users;

    @MockBean
    private AgentDraftPlanService draftPlanService;

    private UUID siteId;
    private UUID supervisorId;
    private String supervisorToken;

    private AppUser user(Role role) {
        String username = "agent-draft-" + role + "-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Agent Draft Test " + role, role));
    }

    @BeforeEach
    void setUp() {
        AppUser supervisor = user(Role.SUPERVISOR);
        supervisorId = supervisor.getId();
        supervisorToken = mintAccessToken(supervisor.getUsername());
        siteId = UUID.randomUUID();
    }

    @Nested
    @DisplayName("Generate Draft Plan Endpoint Tests")
    class GenerateDraftPlanTests {
        @Test
        @DisplayName("Successfully generate draft plan (201 Created)")
        void testGenerateDraftPlanSuccess() throws Exception {
            // Arrange
            GenerateAgentDraftPlanRequest request = new GenerateAgentDraftPlanRequest(
                    siteId,
                    "Current WBGT: 32°C, 15 workers on site"
            );

            AgentDraftPlan draft = AgentDraftPlan.builder()
                    .id(UUID.randomUUID())
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .planContext(request.planContext())
                    .recommendedActions("Increase rest breaks and hydration")
                    .safetyConsiderations("Monitor worker vitals closely")
                    .estimatedDurationMinutes(30)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.PENDING)
                    .build();

            when(draftPlanService.generateDraftPlan(any(UUID.class), any(UUID.class), anyString()))
                    .thenReturn(draft);

            // Act & Assert
            mockMvc.perform(post("/api/supervisor/agent-plans")`r`n                    .header("Authorization", "Bearer " + supervisorToken))
                    .header("Authorization", "Bearer " + supervisorToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(request)))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.id").exists())
                    .andExpect(jsonPath("$.siteId").value(siteId.toString()))
                    .andExpect(jsonPath("$.approvalStatus").value("PENDING"))
                    .andReturn();

            verify(draftPlanService, times(1)).generateDraftPlan(any(), any(), anyString());
        }

        @Test
        @DisplayName("Return 504 on Bedrock timeout")
        void testGenerateDraftPlanTimeout() throws Exception {
            // Arrange
            GenerateAgentDraftPlanRequest request = new GenerateAgentDraftPlanRequest(
                    siteId,
                    "Test context"
            );

            when(draftPlanService.generateDraftPlan(any(), any(), anyString()))
                    .thenThrow(new BedrockTimeoutException("Timeout", null));

            // Act & Assert
            mockMvc.perform(post("/api/supervisor/agent-plans")`r`n                    .header("Authorization", "Bearer " + supervisorToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(request)))
                    .andExpect(status().isGatewayTimeout())
                    .andExpect(jsonPath("$.errorCode").value("agent_timeout"))
                    .andReturn();
        }

        @Test
        @DisplayName("Return 503 on Bedrock error")
        void testGenerateDraftPlanBedrockError() throws Exception {
            // Arrange
            GenerateAgentDraftPlanRequest request = new GenerateAgentDraftPlanRequest(
                    siteId,
                    "Test context"
            );

            when(draftPlanService.generateDraftPlan(any(), any(), anyString()))
                    .thenThrow(new BedrockException("API Error", null));

            // Act & Assert
            mockMvc.perform(post("/api/supervisor/agent-plans")`r`n                    .header("Authorization", "Bearer " + supervisorToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(request)))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.errorCode").value("agent_error"))
                    .andReturn();
        }

        @Test
        @DisplayName("Return 400 on invalid request (missing siteId)")
        void testGenerateDraftPlanInvalidRequest() throws Exception {
            // Arrange
            String invalidRequest = "{\"planContext\": \"Test\"}"; // Missing siteId

            // Act & Assert
            mockMvc.perform(post("/api/supervisor/agent-plans")`r`n                    .header("Authorization", "Bearer " + supervisorToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(invalidRequest))
                    .andExpect(status().isBadRequest())
                    .andReturn();
        }

        @Test
        @DisplayName("Reject request without SUPERVISOR role (403 Forbidden)")
        void testGenerateDraftPlanUnauthorized() throws Exception {
            // Arrange
            GenerateAgentDraftPlanRequest request = new GenerateAgentDraftPlanRequest(
                    siteId,
                    "Test context"
            );

            // Act & Assert
            mockMvc.perform(post("/api/supervisor/agent-plans")`r`n                    .header("Authorization", "Bearer " + supervisorToken))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(request)))
                    .andExpect(status().isForbidden())
                    .andReturn();
        }
    }

    @Nested
    @DisplayName("Get Draft Plan Endpoint Tests")
    class GetDraftPlanTests {
        @Test
        @DisplayName("Successfully retrieve draft plan (200 OK)")
        void testGetDraftPlanSuccess() throws Exception {
            // Arrange
            UUID planId = UUID.randomUUID();
            AgentDraftPlan draft = AgentDraftPlan.builder()
                    .id(planId)
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.PENDING)
                    .build();

            when(draftPlanService.getDraftPlan(planId)).thenReturn(draft);

            // Act & Assert
            mockMvc.perform(get("/api/supervisor/agent-plans/" + planId))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(planId.toString()))
                    .andExpect(jsonPath("$.approvalStatus").value("PENDING"))
                    .andReturn();
        }

        @Test
        @DisplayName("Return 404 when draft plan not found")
        void testGetDraftPlanNotFound() throws Exception {
            // Arrange
            UUID planId = UUID.randomUUID();
            when(draftPlanService.getDraftPlan(planId))
                    .thenThrow(new IllegalArgumentException("Draft plan not found"));

            // Act & Assert
            mockMvc.perform(get("/api/supervisor/agent-plans/" + planId))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.errorCode").value("not_found"))
                    .andReturn();
        }
    }

    @Nested
    @DisplayName("Pending Plans Endpoint Tests")
    class PendingPlansTests {
        @Test
        @DisplayName("Return list of pending draft plans")
        @WithMockUser(roles = "SUPERVISOR")
        void testGetPendingPlans() throws Exception {
            // Arrange
            AgentDraftPlan plan1 = AgentDraftPlan.builder()
                    .id(UUID.randomUUID())
                    .siteId(siteId)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.PENDING)
                    .build();

            AgentDraftPlan plan2 = AgentDraftPlan.builder()
                    .id(UUID.randomUUID())
                    .siteId(siteId)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.PENDING)
                    .build();

            when(draftPlanService.getPendingDraftPlans(siteId, supervisorId))
                    .thenReturn(List.of(plan1, plan2));

            // Act & Assert
            mockMvc.perform(get("/api/supervisor/agent-plans/site/" + siteId + "/pending"))
                    .andExpect(status().isOk())
                    .andReturn();
        }

        @Test
        @DisplayName("Return empty list if no pending plans")
        @WithMockUser(roles = "SUPERVISOR")
        void testGetPendingPlansEmpty() throws Exception {
            // Arrange
            when(draftPlanService.getPendingDraftPlans(siteId, supervisorId))
                    .thenReturn(List.of());

            // Act & Assert
            MvcResult result = mockMvc.perform(get("/api/supervisor/agent-plans/site/" + siteId + "/pending"))
                    .andExpect(status().isOk())
                    .andReturn();

            String content = result.getResponse().getContentAsString();
            assertEquals("[]", content.trim());
        }
    }

    @Nested
    @DisplayName("Approve Plan Endpoint Tests")
    class ApprovePlanTests {
        @Test
        @DisplayName("Successfully approve draft plan")
        @WithMockUser(roles = "SUPERVISOR")
        void testApprovePlanSuccess() throws Exception {
            // Arrange
            UUID planId = UUID.randomUUID();
            AgentDraftPlan approved = AgentDraftPlan.builder()
                    .id(planId)
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.APPROVED)
                    .build();

            when(draftPlanService.approveDraftPlan(planId, supervisorId))
                    .thenReturn(approved);

            // Act & Assert
            mockMvc.perform(post("/api/supervisor/agent-plans/" + planId + "/approve"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.approvalStatus").value("APPROVED"))
                    .andReturn();

            verify(draftPlanService, times(1)).approveDraftPlan(planId, supervisorId);
        }

        @Test
        @DisplayName("Return 400 if supervisor doesn't own plan")
        @WithMockUser(roles = "SUPERVISOR")
        void testApprovePlanUnauthorized() throws Exception {
            // Arrange
            UUID planId = UUID.randomUUID();
            when(draftPlanService.approveDraftPlan(planId, supervisorId))
                    .thenThrow(new IllegalArgumentException("Supervisor cannot approve plan from another supervisor"));

            // Act & Assert
            mockMvc.perform(post("/api/supervisor/agent-plans/" + planId + "/approve"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.errorCode").value("invalid_operation"))
                    .andReturn();
        }
    }

    @Nested
    @DisplayName("Reject Plan Endpoint Tests")
    class RejectPlanTests {
        @Test
        @DisplayName("Successfully reject draft plan")
        @WithMockUser(roles = "SUPERVISOR")
        void testRejectPlanSuccess() throws Exception {
            // Arrange
            UUID planId = UUID.randomUUID();
            AgentDraftPlan rejected = AgentDraftPlan.builder()
                    .id(planId)
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .approvalStatus(AgentDraftPlan.ApprovalStatus.REJECTED)
                    .build();

            when(draftPlanService.rejectDraftPlan(planId, supervisorId))
                    .thenReturn(rejected);

            // Act & Assert
            mockMvc.perform(post("/api/supervisor/agent-plans/" + planId + "/reject"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.approvalStatus").value("REJECTED"))
                    .andReturn();

            verify(draftPlanService, times(1)).rejectDraftPlan(planId, supervisorId);
        }
    }

    @Nested
    @DisplayName("My Plans Endpoint Tests")
    class MyPlansTests {
        @Test
        @DisplayName("Return all draft plans for supervisor")
        @WithMockUser(roles = "SUPERVISOR")
        void testGetMyDraftPlans() throws Exception {
            // Arrange
            AgentDraftPlan plan = AgentDraftPlan.builder()
                    .id(UUID.randomUUID())
                    .siteId(siteId)
                    .supervisorId(supervisorId)
                    .build();

            when(draftPlanService.getDraftPlansForSupervisor(supervisorId))
                    .thenReturn(List.of(plan));

            // Act & Assert
            mockMvc.perform(get("/api/supervisor/agent-plans/mine"))
                    .andExpect(status().isOk())
                    .andReturn();

            verify(draftPlanService, times(1)).getDraftPlansForSupervisor(supervisorId);
        }
    }

}

