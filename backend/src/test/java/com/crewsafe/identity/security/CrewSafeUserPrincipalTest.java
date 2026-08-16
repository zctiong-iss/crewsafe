package com.crewsafe.identity.security;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;

import java.util.Collection;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@code getAuthorities()}'s contract, independent of any particular endpoint or Sonar
 * finding it happens to resolve (java:S1452) - see SCRUM-408.
 *
 * @author Jemilin Beulah
 */
class CrewSafeUserPrincipalTest {

    @Test
    void authoritiesContainExactlyOneRolePrefixedAuthority() {
        AppUser user = AppUser.builder()
                .id(UUID.randomUUID())
                .username("supervisor1")
                .cognitoSub("cognito-sub")
                .displayName("Aisyah (Supervisor)")
                .role(Role.SUPERVISOR)
                .build();

        Collection<GrantedAuthority> authorities = new CrewSafeUserPrincipal(user).getAuthorities();

        assertThat(authorities)
                .extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_SUPERVISOR");
    }
}
