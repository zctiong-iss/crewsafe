package sg.crewsafe.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import sg.crewsafe.dto.UserResponse;
import sg.crewsafe.entity.User;
import sg.crewsafe.repository.UserRepository;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class UserController {

    private final UserRepository userRepository;

    public UserController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @GetMapping("/me")
    public ResponseEntity<UserResponse> getCurrentUser(Authentication authentication) {
        Jwt jwt = (Jwt) authentication.getPrincipal();
        String cognitoSubject = jwt.getSubject();

        User user = userRepository.findByCognitoSubject(cognitoSubject)
            .orElseGet(() -> {
                User newUser = User.builder()
                    .cognitoSubject(cognitoSubject)
                    .email(jwt.getClaimAsString("email"))
                    .displayName(jwt.getClaimAsString("name"))
                    .build();
                return userRepository.save(newUser);
            });

        UserResponse response = UserResponse.builder()
            .id(user.getId())
            .email(user.getEmail())
            .displayName(user.getDisplayName())
            .build();

        return ResponseEntity.ok(response);
    }
}
