package com.crewsafe.identity.security;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * The authenticated principal.
 *
 * Wraps {@link AppUser} so that the user's UUID travels with the security context — the
 * site-access check needs it on every request, and re-reading it from a claim would mean an
 * extra query per call.
 *
 * The {@code ROLE_} prefix is applied here. It is Spring Security's authority-string
 * convention (what {@code hasRole("SUPERVISOR")} looks for), not part of the domain, so the
 * database stores the bare role name.
 */
public class CrewSafeUserPrincipal {

    private final UUID id;
    private final String username;
    private final String displayName;
    private final Role role;

    public CrewSafeUserPrincipal(AppUser user) {
        this.id = user.getId();
        this.username = user.getUsername();
        this.displayName = user.getDisplayName();
        this.role = user.getRole();
    }

    public UUID getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getDisplayName() {
        return displayName;
    }

    public Role getRole() {
        return role;
    }

    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }
}
