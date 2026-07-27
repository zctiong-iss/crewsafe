package com.crewsafe.identity.security;

import com.crewsafe.identity.domain.AppUser;
import com.crewsafe.identity.domain.Role;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * The authenticated principal.
 *
 * Wraps {@link AppUser} rather than using Spring's built-in {@code User} so that the user's
 * UUID travels with the security context — the site-access check needs it on every request,
 * and re-reading it from a username would mean an extra query per call.
 *
 * The {@code ROLE_} prefix is applied here. It is Spring Security's authority-string
 * convention (what {@code hasRole("SUPERVISOR")} looks for), not part of the domain, so the
 * database stores the bare role name.
 */
public class CrewSafeUserPrincipal implements UserDetails {

    private final UUID id;
    private final String username;
    private final String passwordHash;
    private final Role role;
    private final boolean active;

    public CrewSafeUserPrincipal(AppUser user) {
        this.id = user.getId();
        this.username = user.getUsername();
        this.passwordHash = user.getPasswordHash();
        this.role = user.getRole();
        this.active = user.isActive();
    }

    public UUID getId() {
        return id;
    }

    public Role getRole() {
        return role;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return username;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return active;
    }
}
