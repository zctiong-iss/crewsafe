package com.crewsafe.identity.api;

import com.crewsafe.identity.repository.SiteMembershipRepository;
import com.crewsafe.identity.security.CrewSafeUserPrincipal;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The current user's identity and site memberships.
 *
 * Clients call this after login to learn which sites to offer — the server is the only
 * authority on that list, and sending it here means the UI never has to guess.
 *
 * @author Jemilin Beulah
 */
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class MeController {

    private final SiteMembershipRepository memberships;

    @GetMapping("/me")
    public ResponseEntity<MeResponse> me(@AuthenticationPrincipal CrewSafeUserPrincipal principal) {
        return ResponseEntity.ok(new MeResponse(
                principal.getId(),
                principal.getUsername(),
                principal.getDisplayName(),
                principal.getRole().name(),
                memberships.findSiteIdsByUserId(principal.getId())
        ));
    }
}
