# SCRUM-187: US-47 Spike - Confirm Amazon Bedrock Connectivity and Structured-Output Contract

## Objective

Validate Amazon Bedrock connectivity from the CrewSafe backend and confirm that structured-output contracts work as expected for AI-driven mitigation drafting in the CrewSafe heat-stress safety platform.

## Scope

This spike focuses on:

1. **Connectivity Verification**: Confirm that the backend can successfully authenticate to and communicate with Amazon Bedrock in the target AWS account
2. **Model Availability**: Verify that required foundation models (e.g., Claude) are accessible via Bedrock
3. **Structured Output Contract**: Test the structured output format for mitigation suggestions
4. **Error Handling**: Identify failure modes and appropriate error handling strategies
5. **Latency and Performance**: Measure baseline response times and identify bottlenecks

## Non-Goals

- Production integration of Bedrock into the critical path
- Persistent caching of Bedrock responses
- Cost optimization or rate limiting
- Model fine-tuning or custom models
- Integration with the UI (backend API only)

## Success Criteria

1. Backend can successfully invoke Amazon Bedrock using AWS SDK v2
2. Structured output request completes successfully with formatted JSON response
3. Error cases are handled gracefully (auth failures, throttling, timeout)
4. Response latency is documented and acceptable (<5s for testing purposes)
5. Code is tested locally with mock responses where appropriate

## Technical Approach

### 1. Dependency Management

- Add `software.amazon.awssdk:bedrock` and `software.amazon.awssdk:bedrockruntime` to `backend/pom.xml`
- Use existing AWS SDK patterns in the codebase (e.g., Cognito client configuration)
- No additional external dependencies beyond AWS SDK v2

### 2. Implementation Structure

- Create `com.crewsafe.mitigation.ai.bedrock` package for Bedrock integration
- Implement `BedrockClientConfiguration` for SDK setup and authentication
- Implement `BedrockMitigationService` for structured prompt engineering and invocation
- Create `MitigationSuggestion` domain model for structured output
- Add unit and integration tests

### 3. Structured Output Contract

Bedrock structured output will enforce a schema for mitigation suggestions:

```json
{
  "mitigations": [
    {
      "priority": "HIGH|MEDIUM|LOW",
      "action": "Brief mitigation action",
      "rationale": "Why this mitigation is recommended",
      "estimatedImpact": "Expected heat stress reduction"
    }
  ]
}
```

### 4. Configuration

- AWS Region: Read from `spring.profiles.active` or environment variable `AWS_REGION` (default: `ap-southeast-1`)
- Model ID: Configurable via properties (default: `anthropic.claude-3-5-sonnet-20241022-v2:0`)
- Endpoint: Use Bedrock Runtime endpoint (not base Bedrock service)
- Authentication: Use default AWS credential provider chain (for local dev and deployed environments)

### 5. Testing Strategy

- **Unit Tests**: Mock Bedrock client responses, test prompt formatting and response parsing
- **Integration Tests**: Use Bedrock mocking or stub responses (testcontainers if needed)
- **Manual Testing**: Against real Bedrock endpoint with synthetic test data

## Implementation Plan

1. Update `backend/pom.xml` with Bedrock dependencies
2. Create Bedrock configuration bean
3. Implement `BedrockMitigationService` with structured output support
4. Create domain models and DTOs
5. Write unit tests with mocked client
6. Write integration test against real Bedrock (conditional on AWS credentials)
7. Create API endpoint for testing: `POST /api/test/bedrock/mitigations`
8. Document findings and observations in runbook

## Dependencies

- AWS SDK v2.46+ (already in pom.xml)
- AWS account with Bedrock access enabled
- Credentials available via default AWS credential provider chain

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| Bedrock not enabled in AWS account | Check account setup; document required IAM policies |
| Model rate limits during testing | Use small batch sizes; implement exponential backoff |
| Structured output parsing errors | Strict schema validation; fallback to plain text |
| Long latency in dev environment | Document baseline; consider caching for production |

## Deliverables

1. ✅ Bedrock SDK integration in backend
2. ✅ `BedrockMitigationService` implementation
3. ✅ Structured output contract validation
4. ✅ Unit and integration tests
5. ✅ Test API endpoint
6. ✅ Spike runbook with findings
7. ✅ Documentation of lessons learned

## Timeline

- Implementation: ~4-6 hours
- Testing: ~2-3 hours
- Documentation: ~1 hour
- Total: ~7-10 hours (1-1.5 sprint days)

## Next Steps

Upon successful spike completion:

1. Review findings in PR
2. Decide on production integration approach
3. Create follow-up user stories for mitigation generation endpoint
4. Identify performance optimization opportunities
