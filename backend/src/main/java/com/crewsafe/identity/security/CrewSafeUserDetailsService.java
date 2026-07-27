package com.crewsafe.identity.security;

import com.crewsafe.identity.repository.AppUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Loads users for authentication.
 *
 * By username during login (Spring Security's contract), and by id for every subsequent
 * request — the access token carries a UUID, not a username.
 */
@Service
@RequiredArgsConstructor
public class CrewSafeUserDetailsService implements UserDetailsService {

    private final AppUserRepository users;

    @Override
    @Transactional(readOnly = true)
    public CrewSafeUserPrincipal loadUserByUsername(String username) {
        return users.findByUsername(username)
                .map(CrewSafeUserPrincipal::new)
                .orElseThrow(() -> new UsernameNotFoundException("No such user"));
    }

    /**
     * Loads the principal named by a validated access token.
     *
     * Runs on every authenticated request, which is exactly the point: roles and account
     * status come from the database, not from the token, so a demotion or deactivation
     * takes effect on the next call rather than when the token expires.
     */
    @Transactional(readOnly = true)
    public CrewSafeUserPrincipal loadUserById(UUID id) {
        return users.findById(id)
                .map(CrewSafeUserPrincipal::new)
                .orElseThrow(() -> new UsernameNotFoundException("No such user"));
    }
}
