package com.crewsafe.supervisor.domain;

/**
 * Enumeration of possible call session states.
 *
 * Flow:
 * - PENDING: Worker initiated call, waiting for supervisor response
 * - ACCEPTED: Supervisor accepted the call (call is now active)
 * - REJECTED: Supervisor rejected the call
 * - MISSED: Call was not answered within timeout
 * - ENDED: Call completed (either party hung up)
 */
public enum CallStatus {
    PENDING,   // Call requested, waiting for response
    ACCEPTED,  // Supervisor accepted the call
    REJECTED,  // Supervisor rejected the call
    MISSED,    // Call was not answered
    ENDED      // Call completed
}
