package com.crewsafe.identity.repository;

import com.crewsafe.identity.domain.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * @author Jemilin Beulah
 */
public interface AppUserRepository extends JpaRepository<AppUser, UUID> {

    Optional<AppUser> findByUsername(String username);

    Optional<AppUser> findByCognitoSub(String cognitoSub);

    boolean existsByUsername(String username);
}
