package com.crewsafe.operation.api;

import com.crewsafe.AbstractIntegrationTest;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.repository.AppUserRepository;
import com.crewsafe.operation.domain.ActionDispatch;
import com.crewsafe.operation.domain.Approval;
import com.crewsafe.operation.domain.Recommendation;
import com.crewsafe.operation.service.ActionDispatchService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.crewsafe.identity.security.CrewSafeUserPrincipal;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for ActionDispatchController - tests API endpoints and access control.
 *
 * @author Surya Kumaraguru
 */
@AutoConfigureMockMvc
class ActionDispatchControllerTest extends AbstractIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AppUserRepository users;

    @MockitoBean
    private ActionDispatchService actionDispatchService;

    private UUID approvalId;
    private UUID workerId;
    private UUID dispatchId;
    private ActionDispatch dispatch;
    private String supervisorToken;
    private String workerToken;

    private AppUser user(Role role) {
        String username = "action-dispatch-" + role + "-" + UUID.randomUUID();
        createCognitoUser(username);
        return users.save(new AppUser(username, subFor(username), "Action Dispatch Test " + role, role));
    }

    @BeforeEach
    void setUp() {
        AppUser approver = user(Role.SUPERVISOR);
        AppUser worker = user(Role.WORKER);
        workerId = worker.getId();
        supervisorToken = mintAccessToken(approver.getUsername());
        workerToken = mintAccessToken(worker.getUsername());

        approvalId = UUID.randomUUID();
        dispatchId = UUID.randomUUID();

        Recommendation recommendation = Recommendation.builder()
                .id(UUID.randomUUID())
                .build();

        Approval approval = Approval.builder()
                .id(approvalId)
                .recommendation(recommendation)
                .approver(approver)
                .decision(Approval.ApprovalDecision.APPROVED)
                .build();

        dispatch = ActionDispatch.builder()
                .id(dispatchId)
                .approval(approval)
                .worker(worker)
                .actionCode("REST_10_MIN")
                .instruction("Take a 10 minute rest")
                .status(ActionDispatch.ActionDispatchStatus.PENDING)
                .dispatchedAt(Instant.now())
                .build();
    }

    @Test
    void testDispatchAction_Success() throws Exception {
        when(actionDispatchService.dispatchAction(eq(approvalId), eq(workerId), eq("REST_10_MIN"), any(), any(CrewSafeUserPrincipal.class)))
                .thenReturn(dispatch);

        DispatchActionRequest request = DispatchActionRequest.builder()
                .approvalId(approvalId)
                .workerId(workerId)
                .actionCode("REST_10_MIN")
                .instruction("Take a 10 minute rest")
                .build();

        mockMvc.perform(post("/api/action-dispatch")
                .header("Authorization", "Bearer " + supervisorToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andDo(print())
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(dispatchId.toString()))
                .andExpect(jsonPath("$.actionCode").value("REST_10_MIN"))
                .andExpect(jsonPath("$.status").value("PENDING"));
    }

    @Test
    void testDispatchAction_ForbiddenForWorker() throws Exception {
        DispatchActionRequest request = DispatchActionRequest.builder()
                .approvalId(approvalId)
                .workerId(workerId)
                .actionCode("REST_10_MIN")
                .build();

        mockMvc.perform(post("/api/action-dispatch")
                .header("Authorization", "Bearer " + workerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());
    }

    @Test
    void testAcknowledgeDispatch_Success() throws Exception {
        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.ACKNOWLEDGED);
        when(actionDispatchService.acknowledgeDispatch(eq(dispatchId), any(CrewSafeUserPrincipal.class))).thenReturn(dispatch);

        mockMvc.perform(post("/api/action-dispatch/" + dispatchId + "/acknowledge")
                .header("Authorization", "Bearer " + workerToken))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(dispatchId.toString()))
                .andExpect(jsonPath("$.status").value("ACKNOWLEDGED"));
    }

    @Test
    void testAcknowledgeDispatch_Unauthenticated() throws Exception {
        mockMvc.perform(post("/api/action-dispatch/" + dispatchId + "/acknowledge"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void testCompleteDispatch_Success() throws Exception {
        dispatch.setStatus(ActionDispatch.ActionDispatchStatus.COMPLETED);
        dispatch.setEndTime(Instant.now());
        when(actionDispatchService.completeDispatch(eq(dispatchId), any(CrewSafeUserPrincipal.class))).thenReturn(dispatch);

        mockMvc.perform(post("/api/action-dispatch/" + dispatchId + "/complete")
                .header("Authorization", "Bearer " + workerToken))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(dispatchId.toString()))
                .andExpect(jsonPath("$.status").value("COMPLETED"));
    }

    @Test
    void testGetDispatchesForApproval_Success() throws Exception {
        when(actionDispatchService.getDispatchesForApproval(eq(approvalId)))
                .thenReturn(List.of(dispatch));

        mockMvc.perform(get("/api/action-dispatch/approval/" + approvalId)
                .header("Authorization", "Bearer " + supervisorToken))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(dispatchId.toString()))
                .andExpect(jsonPath("$[0].actionCode").value("REST_10_MIN"));
    }

    @Test
    void testGetPendingDispatchesForWorker_Success() throws Exception {
        when(actionDispatchService.getPendingDispatchesForWorker(eq(workerId), any(CrewSafeUserPrincipal.class)))
                .thenReturn(List.of(dispatch));

        mockMvc.perform(get("/api/action-dispatch/worker/" + workerId + "/pending")
                .header("Authorization", "Bearer " + workerToken))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(dispatchId.toString()))
                .andExpect(jsonPath("$[0].status").value("PENDING"));
    }

    @Test
    void testGetDispatch_Success() throws Exception {
        when(actionDispatchService.getDispatch(eq(dispatchId), any(CrewSafeUserPrincipal.class))).thenReturn(dispatch);

        mockMvc.perform(get("/api/action-dispatch/" + dispatchId)
                .header("Authorization", "Bearer " + supervisorToken))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(dispatchId.toString()));
    }

    @Test
    void testGetDispatch_Unauthenticated() throws Exception {
        mockMvc.perform(get("/api/action-dispatch/" + dispatchId))
                .andExpect(status().isUnauthorized());
    }
}
