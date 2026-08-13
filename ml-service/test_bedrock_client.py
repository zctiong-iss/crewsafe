from unittest.mock import patch, MagicMock
import pytest
import anthropic
from bedrock_client import BedrockClient, BedrockAccessError, BedrockModelAccessError

def test_verify_access_raises_on_auth_failure():
  with patch('bedrock_client.AnthropicBedrock') as mock_client_class:
    mock_client = MagicMock()
    mock_client.messages.create.side_effect = anthropic.AuthenticationError(message="Invalid credentials", response=MagicMock(), body=None)
    mock_client_class.return_value = mock_client

    client = BedrockClient()
    with pytest.raises(BedrockAccessError):
        client.verify_access()

def test_verify_access_raises_on_model_not_found():
  with patch('bedrock_client.AnthropicBedrock') as mock_client_class:
    mock_client = MagicMock()
    mock_client.messages.create.side_effect = anthropic.NotFoundError(message="Model not found", response=MagicMock(), body=None)
    mock_client_class.return_value = mock_client

    client = BedrockClient()
    with pytest.raises(BedrockModelAccessError):
        client.verify_access()

def test_verify_access_raises_on_API_connection_error():
  with patch('bedrock_client.AnthropicBedrock') as mock_client_class:
    mock_client = MagicMock()
    mock_client.messages.create.side_effect = anthropic.APIConnectionError(message="API connection error", request=MagicMock())
    mock_client_class.return_value = mock_client

    client = BedrockClient()
    with pytest.raises(BedrockAccessError):
        client.verify_access()

def test_verify_access_raises_on_API_status_error():
  with patch('bedrock_client.AnthropicBedrock') as mock_client_class:
    mock_client = MagicMock()
    mock_client.messages.create.side_effect = anthropic.APIStatusError(message="API status error", response=MagicMock(), body=None)
    mock_client_class.return_value = mock_client

    client = BedrockClient()
    with pytest.raises(BedrockAccessError):
        client.verify_access()

def test_verify_access_succeeds():
    with patch('bedrock_client.AnthropicBedrock') as mock_client_class:
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        # no side_effect set — the call just returns a default fake, no exception

        client = BedrockClient()
        success, msg = client.verify_access()

        assert success is True


def test_verify_invoke_succeeds():
    with patch('bedrock_client.AnthropicBedrock') as mock_client_class:
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        fake_tool_block = MagicMock()
        fake_tool_block.type = "tool_use"
        fake_tool_block.input = {
          "mitigations": [
             {
               "priority": "HIGH", "action": "...", "rationale": "...", "estimatedImpact": "...",
               "actionCode": "REST_15_MIN_HOURLY", "category": "REST", "origin": "MANDATORY",
               "ruleReference": "HS-33-HEAVY", "appliesTo": ["w-1"]
             }
            ]
          }
        
        fake_response = MagicMock()
        fake_response.content = [fake_tool_block]
        fake_response.usage.input_tokens = 42
        fake_response.usage.output_tokens = 17

        client = BedrockClient()
        mock_client.messages.create.return_value = fake_response

        batch, latency_ms, input_tokens, output_tokens = client.invoke("some context")

        assert input_tokens == 42 and output_tokens == 17 and len(batch.mitigations) == 1

def test_invoke_failure_does_not_poison_cache():
    with patch('bedrock_client.AnthropicBedrock') as mock_client_class:
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = anthropic.AuthenticationError(
            message="bad creds", response=MagicMock(), body=None
        )
        mock_client_class.return_value = mock_client

        client = BedrockClient()
        client._access_verified = True  # skip verify_access(), isolate invoke()'s own handling

        with pytest.raises(BedrockAccessError):
            client.invoke("some context")

        assert client._access_verified is True   # unchanged, not flipped by invoke()
        assert client._access_error is None       # never written by invoke()
