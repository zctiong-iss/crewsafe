"""Test suite for forecast service and endpoints."""
import logging
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
import app as app_module
from app import app
from crewsafe_ml.inference import (
    ForecastModelRegistry,
    ModelConfigurationError,
    ModelInferenceError,
    ModelPrediction,
)
from forecast_service import (
    ForecastInferenceError,
    ForecastInputError,
    ForecastModelUnavailableError,
    ForecastService,
    MODEL_VERSION,
)
from models import ForecastContext


client = TestClient(app)


class TestForecastService:
    """Test persistence baseline forecaster."""

    def test_forecast_wbgt_persistence(self):
        """Forecast should return current value for WBGT."""
        prediction = ForecastService().forecast(
            metric="wbgt",
            current_value=35.5,
            horizon_minutes=30,
        )
        assert prediction.metric == "wbgt"
        assert prediction.predicted_value == 35.5
        assert prediction.horizon_minutes == 30
        assert prediction.model_version == MODEL_VERSION

    def test_forecast_temperature_persistence(self):
        """Forecast should return current value for temperature."""
        prediction = ForecastService().forecast(
            metric="temperature",
            current_value=28.0,
            horizon_minutes=60,
        )
        assert prediction.metric == "temperature"
        assert prediction.predicted_value == 28.0
        assert prediction.horizon_minutes == 60

    def test_forecast_humidity_persistence(self):
        """Forecast should return current value for humidity."""
        prediction = ForecastService().forecast(
            metric="humidity",
            current_value=65.0,
            horizon_minutes=30,
        )
        assert prediction.metric == "humidity"
        assert prediction.predicted_value == 65.0

    def test_forecast_confidence_interval(self):
        """Confidence interval should be symmetric around prediction."""
        prediction = ForecastService().forecast(
            metric="wbgt",
            current_value=35.5,
            horizon_minutes=30,
        )
        # Interval should be ±2.5%
        expected_width = 35.5 * 0.025
        assert abs(prediction.confidence_interval_lower - (35.5 - expected_width)) < 0.01
        assert abs(prediction.confidence_interval_upper - (35.5 + expected_width)) < 0.01

    def test_forecast_zero_value(self):
        """Confidence interval should handle zero current value."""
        prediction = ForecastService().forecast(
            metric="temperature",
            current_value=0.0,
            horizon_minutes=30,
        )
        assert prediction.predicted_value == 0.0
        assert prediction.confidence_interval_lower < 0
        assert prediction.confidence_interval_upper > 0

    def test_forecast_negative_value(self):
        """Forecast should handle negative values."""
        prediction = ForecastService().forecast(
            metric="temperature",
            current_value=-5.0,
            horizon_minutes=30,
        )
        assert prediction.predicted_value == -5.0
        # Should still have symmetric confidence interval
        assert prediction.confidence_interval_lower < prediction.predicted_value
        assert prediction.confidence_interval_upper > prediction.predicted_value

    def test_forecast_timestamp_present(self):
        """Forecast should include timestamp."""
        prediction = ForecastService().forecast(
            metric="wbgt",
            current_value=35.5,
            horizon_minutes=30,
        )
        assert prediction.timestamp is not None

    def test_forecast_service_rejects_unsupported_horizon(self):
        """Internal callers receive the same 30-or-60 rule as HTTP callers."""
        with pytest.raises(ValueError, match="30 or 60"):
            ForecastService().forecast(
                metric="wbgt",
                current_value=35.5,
                horizon_minutes=45,
            )


class TestTrainedForecastService:
    """Test trained inference without depending on a real binary model artifact."""

    NOW = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)

    def test_uses_trained_model_for_valid_recent_wbgt_context(self):
        registry = Mock()
        registry.predict.return_value = ModelPrediction(
            predicted_value=34.2,
            model_version="wbgt-test-v1:hist-gradient",
            interval_half_width=1.5,
        )
        service = ForecastService(registry, clock=lambda: self.NOW)

        prediction = service.forecast(
            metric="wbgt",
            current_value=33.5,
            horizon_minutes=60,
            context=forecast_context(self.NOW, latest_wbgt=33.5),
        )

        assert prediction.predicted_value == 34.2
        assert prediction.model_version == "wbgt-test-v1:hist-gradient"
        assert prediction.confidence_interval_lower == pytest.approx(32.7)
        assert prediction.confidence_interval_upper == pytest.approx(35.7)
        registry.predict.assert_called_once()

    def test_rejects_stale_context_before_calling_the_model(self):
        registry = Mock()
        service = ForecastService(registry, clock=lambda: self.NOW)

        with pytest.raises(ForecastInputError) as caught:
            service.forecast(
                metric="wbgt",
                current_value=33.5,
                context=forecast_context(
                    self.NOW - timedelta(minutes=60),
                    latest_wbgt=33.5,
                ),
            )

        assert caught.value.code == "FORECAST_INPUT_INVALID"
        registry.predict.assert_not_called()

    def test_rejects_context_that_disagrees_with_current_value(self):
        service = ForecastService(Mock(), clock=lambda: self.NOW)

        with pytest.raises(ForecastInputError) as caught:
            service.forecast(
                metric="wbgt",
                current_value=33.5,
                context=forecast_context(self.NOW, latest_wbgt=31.0),
            )

        assert caught.value.code == "FORECAST_INPUT_INVALID"

    def test_returns_typed_failure_when_trained_model_is_not_configured(self):
        service = ForecastService(clock=lambda: self.NOW)

        with pytest.raises(ForecastModelUnavailableError) as caught:
            service.forecast(
                metric="wbgt",
                current_value=33.5,
                context=forecast_context(self.NOW, latest_wbgt=33.5),
            )

        assert caught.value.code == "FORECAST_MODEL_UNAVAILABLE"

    def test_returns_typed_failure_when_configured_model_bundle_cannot_load(
        self,
        monkeypatch,
    ):
        """Bad model configuration is contained and never crashes service startup."""
        monkeypatch.setenv("WBGT_MODEL_MANIFEST", "/private/missing/manifest.json")
        monkeypatch.setenv("WBGT_MODEL_MANIFEST_SHA256", "0" * 64)

        service = ForecastService.from_environment()

        with pytest.raises(ForecastModelUnavailableError):
            service.forecast(
                metric="wbgt",
                current_value=33.5,
                context=forecast_context(self.NOW, latest_wbgt=33.5),
            )

    def test_returns_typed_failure_when_model_inference_fails(self):
        registry = Mock()
        registry.predict.side_effect = ModelInferenceError("private artifact detail")
        service = ForecastService(registry, clock=lambda: self.NOW)

        with pytest.raises(ForecastInferenceError) as caught:
            service.forecast(
                metric="wbgt",
                current_value=33.5,
                context=forecast_context(self.NOW, latest_wbgt=33.5),
            )

        assert caught.value.code == "FORECAST_INFERENCE_FAILED"

    def test_registry_rejects_a_model_without_explicit_approval(self, tmp_path: Path):
        """A development artifact cannot be activated by configuration alone."""
        manifest = {
            "schema_version": 2,
            "approved_for_inference": False,
            "model_version": "development-model",
        }
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        checksum = hashlib.sha256(manifest_path.read_bytes()).hexdigest()

        with pytest.raises(ModelConfigurationError, match="not approved"):
            ForecastModelRegistry.load(manifest_path, checksum)

    def test_registry_rejects_a_model_with_an_approval_blocker(self, tmp_path: Path):
        """Approval cannot override a recorded unresolved blocker."""
        manifest = {
            "schema_version": 2,
            "approved_for_inference": True,
            "approval_blocker": "Untouched evaluation is incomplete.",
            "model_version": "blocked-model",
        }
        manifest_path = tmp_path / "manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        checksum = hashlib.sha256(manifest_path.read_bytes()).hexdigest()

        with pytest.raises(ModelConfigurationError, match="approval blocker"):
            ForecastModelRegistry.load(manifest_path, checksum)


class TestForecastEndpoint:
    """Test /forecast HTTP endpoint."""

    def test_forecast_endpoint_30min_horizon(self):
        """Endpoint should accept 30-minute horizon."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "horizon_minutes": 30,
                "current_value": 35.5,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["metric"] == "wbgt"
        assert data["predicted_value"] == 35.5
        assert data["horizon_minutes"] == 30
        assert data["model_version"] == MODEL_VERSION

    def test_forecast_endpoint_60min_horizon(self):
        """Endpoint should accept 60-minute horizon."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "horizon_minutes": 60,
                "current_value": 35.5,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["horizon_minutes"] == 60

    def test_forecast_endpoint_default_horizon(self):
        """Endpoint should default to 30-minute horizon."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "current_value": 35.5,
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data["horizon_minutes"] == 30

    def test_forecast_endpoint_all_metrics(self):
        """Endpoint should accept all valid metrics."""
        for metric in ["wbgt", "temperature", "humidity"]:
            response = client.post(
                "/forecast",
                json={
                    "metric": metric,
                    "current_value": 30.0,
                }
            )
            assert response.status_code == 200
            assert response.json()["metric"] == metric

    def test_forecast_endpoint_invalid_metric(self):
        """Endpoint should reject invalid metric."""
        response = client.post(
            "/forecast",
            json={
                "metric": "invalid_metric",
                "current_value": 35.5,
            }
        )
        assert response.status_code == 422  # Validation error

    def test_forecast_endpoint_invalid_horizon_too_low(self):
        """Endpoint should reject horizon < 30 minutes."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "horizon_minutes": 15,
                "current_value": 35.5,
            }
        )
        assert response.status_code == 422

    def test_forecast_endpoint_invalid_horizon_too_high(self):
        """Endpoint should reject horizon > 60 minutes."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "horizon_minutes": 90,
                "current_value": 35.5,
            }
        )
        assert response.status_code == 422

    def test_forecast_endpoint_rejects_unsupported_45min_horizon(self):
        """Only the trained 30-minute and 60-minute horizons are valid."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "horizon_minutes": 45,
                "current_value": 35.5,
            },
        )
        assert response.status_code == 422

    def test_forecast_endpoint_invalid_current_value(self):
        """Endpoint should reject a value outside the declared forecast range."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "horizon_minutes": 30,
                "current_value": 61.0,
            },
        )
        assert response.status_code == 422

    def test_forecast_endpoint_rejects_malformed_request(self):
        """Endpoint should reject a request missing the required current value."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "horizon_minutes": 30,
            },
        )
        assert response.status_code == 422

    def test_forecast_endpoint_returns_safe_error_when_service_fails(self, monkeypatch):
        """An unexpected forecast failure must not expose the original exception."""
        def fail_forecast(*_args, **_kwargs):
            raise RuntimeError("synthetic forecast failure")

        monkeypatch.setattr(app_module.forecast_service, "forecast", fail_forecast)

        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "horizon_minutes": 30,
                "current_value": 35.5,
            },
        )

        assert response.status_code == 500
        assert response.json() == {"detail": "Internal server error"}

    def test_forecast_endpoint_returns_typed_model_unavailable_error(self, monkeypatch):
        """The backend receives a stable code it can map to SCRUM-141 fallback."""
        monkeypatch.setattr(
            app_module,
            "forecast_service",
            ForecastService(clock=lambda: TestTrainedForecastService.NOW),
        )

        response = client.post(
            "/forecast",
            json=forecast_request(TestTrainedForecastService.NOW),
        )

        assert response.status_code == 503
        assert response.json() == {
            "detail": {
                "code": "FORECAST_MODEL_UNAVAILABLE",
                "message": "Trained forecast model is temporarily unavailable",
            }
        }

    def test_forecast_endpoint_uses_model_without_changing_response_contract(self, monkeypatch):
        """Optional context activates inference while the response shape stays stable."""
        registry = Mock()
        registry.predict.return_value = ModelPrediction(
            predicted_value=34.2,
            model_version="wbgt-test-v1:hist-gradient",
            interval_half_width=1.5,
        )
        monkeypatch.setattr(
            app_module,
            "forecast_service",
            ForecastService(registry, clock=lambda: TestTrainedForecastService.NOW),
        )

        response = client.post(
            "/forecast",
            json=forecast_request(TestTrainedForecastService.NOW),
        )

        assert response.status_code == 200
        assert set(response.json()) == {
            "metric",
            "predicted_value",
            "horizon_minutes",
            "model_version",
            "confidence_interval_lower",
            "confidence_interval_upper",
            "timestamp",
        }
        assert response.json()["model_version"] == "wbgt-test-v1:hist-gradient"

    def test_unexpected_forecast_error_does_not_leak_details(self, monkeypatch, caplog):
        """Clients and logs receive no model exception text or stack trace."""
        monkeypatch.setattr(
            app_module.forecast_service,
            "forecast",
            Mock(side_effect=RuntimeError("private-model-path")),
        )

        with caplog.at_level(logging.ERROR):
            response = client.post(
                "/forecast",
                json={"metric": "wbgt", "current_value": 35.5},
            )

        assert response.status_code == 500
        assert response.json() == {"detail": "Internal server error"}
        assert "private-model-path" not in caplog.text
        assert "Traceback" not in caplog.text

    def test_forecast_endpoint_response_schema(self):
        """Response should match ForecastPrediction schema."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "current_value": 35.5,
            }
        )
        data = response.json()
        required_fields = [
            "metric",
            "predicted_value",
            "horizon_minutes",
            "model_version",
            "confidence_interval_lower",
            "confidence_interval_upper",
            "timestamp",
        ]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"

    def test_forecast_endpoint_confidence_interval_bounds(self):
        """Response should have valid confidence interval bounds."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "current_value": 35.5,
            }
        )
        data = response.json()
        assert data["confidence_interval_lower"] < data["predicted_value"]
        assert data["confidence_interval_upper"] > data["predicted_value"]
        assert data["confidence_interval_lower"] < data["confidence_interval_upper"]

    def test_forecast_endpoint_versioned_prediction(self):
        """Every prediction should have model version for traceability."""
        response = client.post(
            "/forecast",
            json={
                "metric": "wbgt",
                "current_value": 35.5,
            }
        )
        data = response.json()
        assert data["model_version"] is not None
        assert len(data["model_version"]) > 0
        assert "baseline" in data["model_version"].lower()


class TestHealthAndIntegration:
    """Test health check and general integration."""

    def test_health_check(self):
        """Health endpoint should return OK."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_forecast_does_not_break_bedrock(self):
        """Adding forecast should not affect existing Bedrock endpoints."""
        # Health should still work
        response = client.get("/health")
        assert response.status_code == 200

    def test_openapi_schema_includes_forecast(self):
        """OpenAPI schema should include forecast endpoint."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        assert "/forecast" in schema["paths"]
        assert "post" in schema["paths"]["/forecast"]


def forecast_context(latest_time: datetime, *, latest_wbgt: float) -> ForecastContext:
    """Build a small, ordered 15-minute context for service-boundary tests."""

    observations = []
    for offset in range(4, -1, -1):
        observations.append(
            {
                "observed_at": latest_time - timedelta(minutes=15 * offset),
                "wbgt": latest_wbgt - offset / 10,
                "air_temperature": 31.0,
                "relative_humidity": 70.0,
                "wind_speed": 3.0,
                "wind_direction": 180.0,
                "rainfall": 0.0,
            }
        )
    return ForecastContext(
        station_id="S123",
        latitude=1.3521,
        longitude=103.8198,
        observations=observations,
    )


def forecast_request(latest_time: datetime) -> dict[str, object]:
    """Serialize a trained-model request as a real backend client would send it."""

    context = forecast_context(latest_time, latest_wbgt=33.5)
    return {
        "metric": "wbgt",
        "horizon_minutes": 30,
        "current_value": 33.5,
        "context": context.model_dump(mode="json"),
    }
