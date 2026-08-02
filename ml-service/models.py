"""Pydantic models for Bedrock mitigation spike."""
from pydantic import BaseModel, Field
from typing import List


class MitigationSuggestion(BaseModel):
    """Single mitigation suggestion with structured constraints."""
    priority: str = Field(..., pattern="^(HIGH|MEDIUM|LOW)$", description="Priority level")
    action: str = Field(..., min_length=1, max_length=200, description="Mitigation action")
    rationale: str = Field(..., min_length=1, max_length=500, description="Why this is recommended")
    estimatedImpact: str = Field(..., min_length=1, max_length=200, description="Expected impact")

    class Config:
        json_schema_extra = {
            "example": {
                "priority": "HIGH",
                "action": "Reduce work hours to 20 min active / 10 min rest",
                "rationale": "WBGT at 35°C exceeds safe limits for continuous work",
                "estimatedImpact": "10-15% reduction in heat stress risk"
            }
        }


class MitigationBatch(BaseModel):
    """Batch of mitigation suggestions returned from Bedrock."""
    mitigations: List[MitigationSuggestion] = Field(..., min_items=0, max_items=10)

    class Config:
        json_schema_extra = {
            "example": {
                "mitigations": [
                    {
                        "priority": "HIGH",
                        "action": "Reduce work hours",
                        "rationale": "WBGT critical",
                        "estimatedImpact": "15% reduction"
                    }
                ]
            }
        }


class MitigationRequest(BaseModel):
    """Request context for generating mitigations."""
    context: str = Field(..., min_length=10, max_length=2000, description="Weather and crew context")
    model_id: str = Field(default="anthropic.claude-3-5-sonnet-20241022-v2:0")
    max_tokens: int = Field(default=1024, ge=100, le=4096)
    temperature: float = Field(default=0.7, ge=0.0, le=1.0)

    class Config:
        json_schema_extra = {
            "example": {
                "context": "Current WBGT: 35°C, 60% humidity, 12 workers on site. Last water break 30 min ago."
            }
        }
