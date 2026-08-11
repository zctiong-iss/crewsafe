"""Bedrock client for spike verification."""
import logging
import time
from typing import Optional
import anthropic
from anthropic import AnthropicBedrock

from models import MitigationBatch, MitigationSuggestion

logger = logging.getLogger(__name__)


class BedrockAccessError(Exception):
    """Raised when Bedrock is not accessible."""
    pass


class BedrockModelAccessError(BedrockAccessError):
    """Raised when model is not accessible in the region."""
    pass


class BedrockClient:
    """Minimal Bedrock client for structured output."""

    def __init__(self, region: str = "ap-southeast-1"):
        self.region = region
        self.client = None
        self._access_verified = False
        self._access_error: Optional[str] = None

    def verify_access(self) -> tuple[bool, str]:
        """
        Verify Bedrock model access in the configured region.
        Returns (success: bool, message: str)
        """
        if self._access_verified:
            if self._access_error:
                return False, self._access_error
            return True, f"Bedrock access verified in {self.region}"

        try:
            # Initialize client
            self.client = AnthropicBedrock(aws_region=self.region)

            start = time.time()
            # one call — replaces client.invoke_model(modelId=..., body=json.dumps(...))
            response = self.client.messages.create(
                model="apac.anthropic.claude-3-5-sonnet-20241022-v2:0",
                max_tokens=10,
                messages=[{"role": "user", "content": "OK"}],
            )
            latency = time.time() - start

            msg = f"✓ Bedrock model access confirmed in region={self.region} (latency={latency:.2f}s)"
            logger.info(msg)
            self._access_verified = True
            return True, msg

        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
            msg = f"Bedrock access denied in region={self.region}: {e}"
            logger.error(msg)
            self._access_error = msg
            self._access_verified = True
            raise BedrockAccessError(msg) from e

        except anthropic.NotFoundError as e:
            msg = f"Bedrock model not available, try US-east-1: {e}"
            logger.error(msg)
            self._access_error = msg
            self._access_verified = True
            raise BedrockModelAccessError(msg) from e

        except anthropic.APIConnectionError as e:
            msg = f"Bedrock API connection error: {e}"
            logger.error(msg)
            self._access_error = msg
            self._access_verified = True
            raise BedrockAccessError(msg) from e

        except anthropic.APIStatusError as e:
            msg = f"Bedrock API status error: {e.status_code}"
            logger.error(msg)
            self._access_error = msg
            self._access_verified = True
            raise BedrockAccessError(msg) from e

    def invoke(
        self,
        context: str,
        model_id: str = "apac.anthropic.claude-3-5-sonnet-20241022-v2:0",
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> tuple[MitigationBatch, float, int, int]:
        """
        Invoke Bedrock with structured output constraint.
        Returns (batch, latency_ms, input_tokens, output_tokens)
        """
        if not self._access_verified:
            self.verify_access()

        if self.client is None:
            self.client = AnthropicBedrock(aws_region=self.region)

        prompt = self._build_prompt(context)
        schema = self._get_schema()

        try:
            start = time.time()
            response = self.client.messages.create(
                model=model_id,
                max_tokens=max_tokens,
                temperature=temperature,
                messages=[{"role": "user", "content": prompt}],
                tools = [
                    {
                        "name": "MitigationSchema",
                        "description": "Schema for mitigation suggestions",
                        "input_schema": schema
                    }
                ],
                tool_choice = {
                    "type": "tool",
                    "name": "MitigationSchema"
                }
            )
            latency_ms = (time.time() - start) * 1000

            # Parse structured output
            tool_use_block = next(b for b in response.content if b.type == "tool_use")
            structured = tool_use_block.input
            batch = MitigationBatch(**structured)

            # Input tokens
            input_tokens = response.usage.input_tokens

            # Output tokens
            output_tokens = response.usage.output_tokens

            logger.info(
                f"Bedrock invocation: latency={latency_ms:.0f}ms, "
                f"suggestions={len(batch.mitigations)}, tokens={input_tokens} + {output_tokens}"
            )

            return batch, latency_ms, input_tokens, output_tokens

        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
            msg = f"Bedrock access denied in region={self.region}: {e}"
            logger.error(msg)
            raise BedrockAccessError(msg) from e

        except anthropic.NotFoundError as e:
            msg = f"Bedrock model not available, try US-east-1: {e}"
            logger.error(msg)
            raise BedrockModelAccessError(msg) from e

        except anthropic.APIConnectionError as e:
            msg = f"Bedrock API connection error: {e}"
            logger.error(msg)
            raise BedrockAccessError(msg) from e

        except anthropic.APIStatusError as e:
            msg = f"Bedrock API status error: {e.status_code}"
            logger.error(msg)
            raise BedrockAccessError(msg) from e

    @staticmethod
    def _build_prompt(context: str) -> str:
        return f"""You are a heat stress safety advisor for outdoor crews in Singapore.
Given the weather context below, generate practical mitigation actions to reduce heat-stress risk.

Context: {context}

Return a JSON response with this exact structure:
{{
  "mitigations": [
    {{
      "priority": "HIGH|MEDIUM|LOW",
      "action": "Brief action",
      "rationale": "Why recommended",
      "estimatedImpact": "Expected reduction"
    }}
  ]
}}

Return ONLY valid JSON, no other text."""

    @staticmethod
    def _get_schema() -> dict:
        return {
            "type": "object",
            "properties": {
                "mitigations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "priority": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
                            "action": {"type": "string"},
                            "rationale": {"type": "string"},
                            "estimatedImpact": {"type": "string"},
                        },
                        "required": ["priority", "action", "rationale", "estimatedImpact"],
                    },
                }
            },
            "required": ["mitigations"],
        }
