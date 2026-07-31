package com.crewsafe.mitigation.ai.bedrock;

public class BedrockAccessError extends BedrockException {
    public BedrockAccessError(String message) {
        super(message);
    }

    public BedrockAccessError(String message, Throwable cause) {
        super(message, cause);
    }
}
