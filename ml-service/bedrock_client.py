"""Bedrock client for spike verification."""
import json
import logging
import time
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

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
            self.client = boto3.client("bedrock-runtime", region_name=self.region)

            # Test with a minimal invocation
            test_payload = {
                "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
                "max_tokens": 10,
                "messages": [{"role": "user", "content": "OK"}],
            }

            start = time.time()
            self.client.invoke_model(
                modelId="anthropic.claude-3-5-sonnet-20241022-v2:0",
                contentType="application/json",
                accept="application/json",
                body=json.dumps(test_payload),
            )
            latency = time.time() - start

            msg = f"✓ Bedrock model access confirmed in region={self.region} (latency={latency:.2f}s)"
            logger.info(msg)
            self._access_verified = True
            return True, msg

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if error_code == "AccessDenied":
                msg = f"✗ Access denied to Bedrock in {self.region}. Check IAM permissions."
                self._access_error = msg
                self._access_verified = True
                logger.error(msg)
                raise BedrockAccessError(msg) from e
            elif error_code == "ModelNotFound":
                msg = f"✗ Model not available in {self.region}. Try us-east-1 as fallback."
                self._access_error = msg
                self._access_verified = True
                logger.error(msg)
                raise BedrockModelAccessError(msg) from e
            else:
                msg = f"✗ Bedrock error ({error_code}): {e}"
                logger.error(msg)
                raise BedrockAccessError(msg) from e

        except BotoCoreError as e:
            msg = f"✗ AWS SDK error: {e}"
            logger.error(msg)
            raise BedrockAccessError(msg) from e

    def invoke(
        self,
        context: str,
        model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0",
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> tuple[MitigationBatch, float, int]:
        """
        Invoke Bedrock with structured output constraint.
        Returns (batch, latency_ms, input_tokens)
        """
        if not self._access_verified:
            self.verify_access()

        if self.client is None:
            self.client = boto3.client("bedrock-runtime", region_name=self.region)

        prompt = self._build_prompt(context)
        schema = self._get_schema()

        payload = {
            "modelId": model_id,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": "You are a heat stress safety expert. Return only valid JSON matching the schema.",
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
        }

        try:
            start = time.time()
            response = self.client.invoke_model(
                modelId=model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(payload),
            )
            latency_ms = (time.time() - start) * 1000

            # Parse response
            response_body = json.loads(response["body"].read().decode())
            text_content = response_body["content"][0]["text"]

            # Parse structured output
            structured = json.loads(text_content)
            batch = MitigationBatch(**structured)

            # Estimate input tokens
            input_tokens = len(prompt.split()) * 1.3  # Rough estimate

            logger.info(
                f"Bedrock invocation: latency={latency_ms:.0f}ms, "
                f"suggestions={len(batch.mitigations)}, tokens≈{int(input_tokens)}"
            )

            return batch, latency_ms, int(input_tokens)

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            msg = f"Bedrock invocation failed ({error_code}): {e}"
            logger.error(msg)
            raise BedrockAccessError(msg) from e
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            msg = f"Failed to parse Bedrock response: {e}"
            logger.error(msg)
            raise ValueError(msg) from e

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
