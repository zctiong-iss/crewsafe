"""Bedrock client for spike verification."""
import logging
import time
from typing import Optional, Type
import anthropic
from anthropic import AnthropicBedrock
from pydantic import BaseModel

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
            self.client = AnthropicBedrock(aws_region=self.region, max_retries=8)

            start = time.time()
            # one call — replaces client.invoke_model(modelId=..., body=json.dumps(...))
            self.client.messages.create(
                model="global.anthropic.claude-haiku-4-5-20251001-v1:0",
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

        except Exception as e:
            # Credential resolution (e.g. no AWS credentials at all) fails underneath the
            # Anthropic SDK's own boto3 session handling, before any HTTP call is made, and
            # surfaces as a plain RuntimeError rather than one of the anthropic.* types above
            # — the old boto3-based client caught this via BotoCoreError; this replacement
            # didn't, so an environment with no AWS credentials (e.g. the CI smoke container)
            # crashed the app at startup instead of degrading gracefully like verify_access()
            # is supposed to.
            msg = f"Bedrock access error in region={self.region}: {e}"
            logger.error(msg)
            self._access_error = msg
            self._access_verified = True
            raise BedrockAccessError(msg) from e

    def invoke(
        self,
        context: str,
        model_id: str = "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        max_tokens: int = 1024,
        temperature: float = 0.7,
        response_model: Optional[Type[BaseModel]] = None,
        extra_instructions: str = "",
        prompt_override: Optional[str] = None,
    ) -> tuple[BaseModel, float, int, int]:
        """
        Invoke Bedrock with structured output constraint.
        Returns (parsed_response, latency_ms, input_tokens, output_tokens)

        `response_model` is the Pydantic model Bedrock is constrained to produce and the type
        the result is parsed back into; it defaults to {@code MitigationBatch}, which is what
        the §8.6 benchmark and /bedrock/suggest use. The agent graph passes its own richer
        model instead, so adding a plan-level rationale to the draft did not require changing
        the shape the benchmark measured. `extra_instructions` is appended to the prompt for
        the same reason — additive, so the benchmarked prompt is a prefix of the agent's.
        """
        if not self._access_verified:
            self.verify_access()

        if self.client is None:
            self.client = AnthropicBedrock(aws_region=self.region, max_retries=8)

        model = response_model or MitigationBatch
        # `prompt_override` replaces the heat-advisor framing entirely rather than appending
        # to it. Translation is the caller that needs this: instructing a model to act as a
        # safety advisor and then asking it only to restate someone else's sentence invites it
        # to improve the advice it was given, which is the one thing a translator must not do.
        prompt = prompt_override if prompt_override is not None else self._build_prompt(context)
        if extra_instructions:
            prompt = f"{prompt}\n\n{extra_instructions}"
        schema = self._get_schema(model)

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
            parsed = model(**structured)

            # Input tokens
            input_tokens = response.usage.input_tokens

            # Output tokens
            output_tokens = response.usage.output_tokens

            logger.info(
                f"Bedrock invocation: latency={latency_ms:.0f}ms, "
                f"suggestions={len(parsed.mitigations)}, tokens={input_tokens} + {output_tokens}"
            )

            return parsed, latency_ms, input_tokens, output_tokens

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

        except Exception as e:
            # Same underlying gap as verify_access() — see its comment.
            msg = f"Bedrock access error in region={self.region}: {e}"
            logger.error(msg)
            raise BedrockAccessError(msg) from e

    @staticmethod
    def _build_prompt(context: str) -> str:
        return f"""You are a heat stress safety advisor for outdoor crews in Singapore.

The deterministic policy engine below has already decided what is REQUIRED. Your job is
only to turn its output into a clear, prioritised, worker-targeted plan — you may not add,
remove, or soften anything it marked mandatory, and you may only use action codes it has
already given you. Never invent a new action code.

Policy and shift context:
{context}

For every mandatory and advisory action listed above, produce one mitigation with:
- actionCode: copied exactly from the context, never invented
- category: the topic group for that code (REST, HYDRATION, SHADE_COOLING, WORK_SCHEDULING,
  MONITORING, or STOP_WORK)
- origin: MANDATORY or ADVISORY, matching which list it came from above
- ruleReference: copied exactly from the context
- appliesTo: the worker IDs this applies to; omit the whole field if it applies to everyone
  on the shift
- timing: durationMinutes / everyMinutes / startByUtc, only if the action has a duration or
  recurrence — omit the whole field otherwise
- priority, action, rationale, estimatedImpact: your own concise, plain-language phrasing

Every action marked MANDATORY above must appear in your output — do not omit one."""

    @staticmethod
    def _get_schema(model: Type[BaseModel] = MitigationBatch) -> dict:
        """Derived from the Pydantic model itself, not hand-duplicated — a change to the
        model is automatically what Bedrock is asked to produce, so the two can never
        silently drift apart the way the original hand-written copy did.

        Nested models ($defs/$ref, e.g. Timing) round-trip fine: the Anthropic SDK forwards
        the schema to the tool-use API verbatim and it resolves internal references itself."""
        return model.model_json_schema()
