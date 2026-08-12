"""Test suite for forecast service and endpoints."""
import pytest
from fastapi.testclient import TestClient
from app import app
from forecast_service import ForecastService, MODEL_VERSION


client = TestClient(app)


class TestForecastService:
    """Test persistence baseline forecaster."""

    def test_forecast_wbgt_persistence(self):
        """Forecast should return current value for WBGT."""
        prediction = ForecastService.forecast(
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
        prediction = ForecastService.forecast(
            metric="temperature",
            current_value=28.0,
            horizon_minutes=60,
        )
        assert prediction.metric == "temperature"
        assert prediction.predicted_value == 28.0
        assert prediction.horizon_minutes == 60

    def test_forecast_humidity_persistence(self):
        """Forecast should return current value for humidity."""
        prediction = ForecastService.forecast(
            metric="humidity",
            current_value=65.0,
            horizon_minutes=30,
        )
        assert prediction.metric == "humidity"
        assert prediction.predicted_value == 65.0

    def test_forecast_confidence_interval(self):
        """Confidence interval should be symmetric around prediction."""
        prediction = ForecastService.forecast(
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
        prediction = ForecastService.forecast(
            metric="temperature",
            current_value=0.0,
            horizon_minutes=30,
        )
        assert prediction.predicted_value == 0.0
        assert prediction.confidence_interval_lower < 0
        assert prediction.confidence_interval_upper > 0

    def test_forecast_negative_value(self):
        """Forecast should handle negative values."""
        prediction = ForecastService.forecast(
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
        prediction = ForecastService.forecast(
            metric="wbgt",
            current_value=35.5,
            horizon_minutes=30,
        )
        assert prediction.timestamp is not None


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

        monkeypatch.setattr(ForecastService, "forecast", fail_forecast)

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
