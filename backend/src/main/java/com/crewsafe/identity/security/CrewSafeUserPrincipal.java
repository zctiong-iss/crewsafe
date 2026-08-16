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
 * Wraps {@link AppUser} so that the local user's UUID travels with the security context.
 * The converter has already looked the row up to authenticate the request; carrying the id
 * forward means the site-access check can use it without repeating that query. A Cognito
 * token identifies its subject by {@code sub}, which is not this id — nothing downstream
 * could derive it from the token alone.
 *
 * The {@code ROLE_} prefix is applied here. It is Spring Security's authority-string
 * convention (what {@code hasRole("SUPERVISOR")} looks for), not part of the domain, so the
 * database stores the bare role name.
 *
 * @author Jemilin Beulah
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

    public Collection<GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }
}
