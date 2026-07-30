package com.crewsafe.weather.nea;

/** A stable failure contract around transport, HTTP, and upstream-payload failures. */
public class NeaApiException extends RuntimeException {

    public enum Reason {
        TRANSPORT,
        HTTP,
        INVALID_RESPONSE
    }

    private final Reason reason;

    public NeaApiException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public NeaApiException(Reason reason, String message, Throwable cause) {
        super(message, cause);
        this.reason = reason;
    }

    public Reason getReason() {
        return reason;
    }
}
