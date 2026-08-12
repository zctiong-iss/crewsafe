package com.crewsafe.mitigation.api;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.UserStatus;
import com.crewsafe.identity.security.CognitoJwtAuthenticationConverter;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import com.crewsafe.mitigation.ai.bedrock.BedrockException;
import com.crewsafe.mitigation.ai.bedrock.BedrockTimeoutException;
import com.crewsafe.mitigation.domain.AgentDraftPlan;
import com.crewsafe.mitigation.service.AgentDraftPlanService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for AgentDraftPlanController
 */
@WebMvcTest(AgentDraftPlanController.class)
@Import(AgentDraftPlanControllerTest.MethodSecurityTestConfiguration.class)
@DisplayName("Agent Draft Plan Controller Tests")
class AgentDraftPlanControllerTest {

    @TestConfiguration(proxyBeanMethods = false)
    @EnableMethodSecurity
    static class MethodSecurityTestConfiguration {
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private AgentDraftPlanService draftPlanService;

    @MockitoBean
    private CognitoJwtAuthenticationConverter cognitoJwtAuthenticationConverter;

    private UUID siteId;
    private UUID supervisorId;

    @BeforeEach
    void setUp() {
        supervisorId = UUID.randomUUID();
        siteId = UUID.randomUUID();
    }

    private RequestPostProcessor authenticatedAs(Role role) {
        AppUser user = AppUser.builder()
                .id(supervisorId)
                .username("agent-plan-test")
                .cognitoSub("agent-plan-test-sub")
                .displayName("Agent Plan Test User")
                .role(role)
                .status(UserStatus.ACTIVE)
                .build();
        CrewSafeUserPrincipal principal = new CrewSafeUserPrincipal(user);
        return authentication(new UsernamePasswordAuthenticationToken(
                principal, null, principal.getAuthorities()));
    }

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
        mockMvc.perform(post("/api/supervisor/agent-plans")
                .contentType(MediaType.APPLICATION_JSON)
                .with(authenticatedAs(Role.SUPERVISOR))
                .with(csrf())
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
        mockMvc.perform(post("/api/supervisor/agent-plans")
                .contentType(MediaType.APPLICATION_JSON)
                .with(authenticatedAs(Role.SUPERVISOR))
                .with(csrf())
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
        mockMvc.perform(post("/api/supervisor/agent-plans")
                .contentType(MediaType.APPLICATION_JSON)
                .with(authenticatedAs(Role.SUPERVISOR))
                .with(csrf())
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
        mockMvc.perform(post("/api/supervisor/agent-plans")
                .contentType(MediaType.APPLICATION_JSON)
                .with(authenticatedAs(Role.SUPERVISOR))
                .with(csrf())
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
        mockMvc.perform(post("/api/supervisor/agent-plans")
                .contentType(MediaType.APPLICATION_JSON)
                .with(authenticatedAs(Role.WORKER))
                .with(csrf())
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden())
                .andReturn();
    }

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
        mockMvc.perform(get("/api/supervisor/agent-plans/" + planId)
                .with(authenticatedAs(Role.SUPERVISOR)))
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
        mockMvc.perform(get("/api/supervisor/agent-plans/" + planId)
                .with(authenticatedAs(Role.SUPERVISOR)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode").value("not_found"))
                .andReturn();
    }

    @Test
    @DisplayName("Return list of pending draft plans")
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
        mockMvc.perform(get("/api/supervisor/agent-plans/site/" + siteId + "/pending")
                .with(authenticatedAs(Role.SUPERVISOR)))
                .andExpect(status().isOk())
                .andReturn();
    }

    @Test
    @DisplayName("Return empty list if no pending plans")
    void testGetPendingPlansEmpty() throws Exception {
        // Arrange
        when(draftPlanService.getPendingDraftPlans(siteId, supervisorId))
                .thenReturn(List.of());

        // Act & Assert
        MvcResult result = mockMvc.perform(get("/api/supervisor/agent-plans/site/" + siteId + "/pending")
                .with(authenticatedAs(Role.SUPERVISOR)))
                .andExpect(status().isOk())
                .andReturn();

        String content = result.getResponse().getContentAsString();
        assertTrue(content.contains("[]"));
    }

    @Test
    @DisplayName("Successfully approve draft plan")
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
        mockMvc.perform(post("/api/supervisor/agent-plans/" + planId + "/approve")
                .with(authenticatedAs(Role.SUPERVISOR))
                .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.approvalStatus").value("APPROVED"))
                .andReturn();

        verify(draftPlanService, times(1)).approveDraftPlan(planId, supervisorId);
    }

    @Test
    @DisplayName("Return 400 if supervisor doesn't own plan")
    void testApprovePlanUnauthorized() throws Exception {
        // Arrange
        UUID planId = UUID.randomUUID();
        when(draftPlanService.approveDraftPlan(planId, supervisorId))
                .thenThrow(new IllegalArgumentException("Supervisor cannot approve plan from another supervisor"));

        // Act & Assert
        mockMvc.perform(post("/api/supervisor/agent-plans/" + planId + "/approve")
                .with(authenticatedAs(Role.SUPERVISOR))
                .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("invalid_operation"))
                .andReturn();
    }

    @Test
    @DisplayName("Successfully reject draft plan")
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
        mockMvc.perform(post("/api/supervisor/agent-plans/" + planId + "/reject")
                .with(authenticatedAs(Role.SUPERVISOR))
                .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.approvalStatus").value("REJECTED"))
                .andReturn();

        verify(draftPlanService, times(1)).rejectDraftPlan(planId, supervisorId);
    }

    @Test
    @DisplayName("Return all draft plans for supervisor")
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
        mockMvc.perform(get("/api/supervisor/agent-plans/mine")
                .with(authenticatedAs(Role.SUPERVISOR)))
                .andExpect(status().isOk())
                .andReturn();

        verify(draftPlanService, times(1)).getDraftPlansForSupervisor(supervisorId);
    }
}
