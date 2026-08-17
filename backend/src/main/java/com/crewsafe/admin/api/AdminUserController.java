package com.crewsafe.admin.api;

import com.crewsafe.admin.service.UserAdminService;
import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import com.crewsafe.identity.domain.UserStatus;
import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Admin local-user management (US-30): registering an already-existing Cognito identity as a
 * local {@code app_user}, then managing its role, status and site memberships. Never talks to
 * Cognito — see {@link UserAdminService}'s javadoc.
 *
 * @author Jemilin Beulah
 */
@RestController
@RequestMapping("/api/v1/admin/users")
@RequiredArgsConstructor
public class AdminUserController {

    private final UserAdminService userAdminService;
    private final SiteMembershipRepository memberships;

    public record UserResponse(UUID id, String username, String cognitoSub, String displayName,
            String role, String status, List<UUID> siteIds, Instant createdAt, Instant updatedAt) {

        static UserResponse from(AppUser user, List<UUID> siteIds) {
            return new UserResponse(user.getId(), user.getUsername(), user.getCognitoSub(),
                    user.getDisplayName(), user.getRole().name(), user.getStatus().name(),
                    siteIds, user.getCreatedAt(), user.getUpdatedAt());
        }
    }

    public record UserRegisterRequest(
            @NotBlank @Size(max = 64) String username,
            @NotBlank @Size(max = 64) String cognitoSub,
            @NotBlank @Size(max = 120) String displayName,
            @NotNull Role role,
            @NotNull Set<UUID> siteIds) {
    }

    /** Partial update — {@code null} fields are left unchanged. */
    public record UserUpdateRequest(Role role, UserStatus status) {
    }

    public record SiteMembershipRequest(@NotNull UUID siteId) {
    }

    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<UserResponse>> listUsers() {
        return ResponseEntity.ok(userAdminService.list().stream()
                .map(user -> UserResponse.from(user, memberships.findSiteIdsByUserId(user.getId())))
                .toList());
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<UserResponse> registerUser(@AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody UserRegisterRequest request) {

        AppUser saved = userAdminService.register(request.username(), request.cognitoSub(), request.displayName(),
                request.role(), request.siteIds(), principal.getId());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(UserResponse.from(saved, memberships.findSiteIdsByUserId(saved.getId())));
    }

    @PatchMapping("/{userId}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<UserResponse> updateUser(@PathVariable UUID userId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal, @RequestBody UserUpdateRequest request) {

        AppUser saved = userAdminService.updateRoleAndStatus(userId, request.role(), request.status(),
                principal.getId());
        return ResponseEntity.ok(UserResponse.from(saved, memberships.findSiteIdsByUserId(saved.getId())));
    }

    @PostMapping("/{userId}/site-memberships")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> grantSite(@PathVariable UUID userId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal,
            @Valid @RequestBody SiteMembershipRequest request) {

        userAdminService.grantSite(userId, request.siteId(), principal.getId());
        // 204, not 201: a SiteMembership is a thin join row with no representation worth
        // returning, symmetric with revokeSite's 204 below. apiFetch's client only special-
        // cases 204 as "no body expected" (matching this codebase's other void endpoints) —
        // a 201 with a genuinely empty body fails its response.json() parse.
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{userId}/site-memberships/{siteId}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> revokeSite(@PathVariable UUID userId, @PathVariable UUID siteId,
            @AuthenticationPrincipal CrewSafeUserPrincipal principal) {

        userAdminService.revokeSite(userId, siteId, principal.getId());
        return ResponseEntity.noContent().build();
    }
}
