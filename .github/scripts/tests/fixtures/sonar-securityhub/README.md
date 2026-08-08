# Synthetic Sonar/Security Hub fixtures

These fixtures are deliberately synthetic. They contain only allowlisted identifiers,
timestamps, and severities; they must never contain a Sonar token, source path, code
snippet, user data, or a response captured from a real service.

`stub-curl.sh` returns `MOCK_CURL_RESPONSE_FILE` and `stub-aws.sh` returns the JSON
files selected by the matching `MOCK_AWS_*_RESPONSE_FILE` variable. Both append only
the requested operation name to `MOCK_CALL_LOG`. They are for hermetic shell tests
only and must not be used by a workflow.
