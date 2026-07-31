package com.crewsafe.mitigation.ai.bedrock;

public class BedrockTimeoutException extends BedrockException {
    public BedrockTimeoutException(String message) {
        super(message);
    }

    public BedrockTimeoutException(String message, Throwable cause) {
        super(message, cause);
    }
}
