package com.crewsafe.mitigation.ai.bedrock;

public class BedrockException extends RuntimeException {
    public BedrockException(String message) {
        super(message);
    }

    public BedrockException(String message, Throwable cause) {
        super(message, cause);
    }
}
