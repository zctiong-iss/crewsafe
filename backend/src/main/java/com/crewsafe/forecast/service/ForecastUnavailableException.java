package com.crewsafe.forecast.service;

/**
 * The private forecast dependency or its required recent context is unavailable.
 *
 * <p>The message is server-side only. The shared exception handler returns a fixed
 * category and never exposes an ML response, model path, or weather context.
 */
public class ForecastUnavailableException extends RuntimeException {

    public ForecastUnavailableException(String message) {
        super(message);
    }

    public ForecastUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
