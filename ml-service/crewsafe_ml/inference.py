"""Checksum-verified loading and inference for packaged WBGT models."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import joblib
import pandas as pd

from .features import build_feature_frame


class ModelConfigurationError(RuntimeError):
    """A configured model bundle is incomplete or cannot be trusted."""


@dataclass(frozen=True)
class ModelPrediction:
    predicted_value: float
    model_version: str
    interval_half_width: float


class ForecastModelRegistry:
    """Load only artifacts pinned by a trusted manifest checksum."""

    def __init__(
        self,
        *,
        model_version: str,
        numeric_features: Sequence[str],
        categorical_features: Sequence[str],
        horizons: Mapping[int, Mapping[str, Any]],
        models: Mapping[int, Any],
    ) -> None:
        self._model_version = model_version
        self._numeric_features = tuple(numeric_features)
        self._categorical_features = tuple(categorical_features)
        self._horizons = dict(horizons)
        self._models = dict(models)

    @classmethod
    def from_environment(cls) -> ForecastModelRegistry | None:
        manifest_value = os.getenv("WBGT_MODEL_MANIFEST")
        expected_checksum = os.getenv("WBGT_MODEL_MANIFEST_SHA256")
        if not manifest_value:
            return None
        if not expected_checksum:
            raise ModelConfigurationError(
                "WBGT_MODEL_MANIFEST_SHA256 is required when a model is configured"
            )
        return cls.load(Path(manifest_value), expected_checksum)

    @classmethod
    def load(cls, manifest_path: Path, expected_checksum: str) -> ForecastModelRegistry:
        manifest_path = manifest_path.resolve(strict=True)
        if not _valid_sha256(expected_checksum):
            raise ModelConfigurationError("model manifest checksum is invalid")
        if _sha256(manifest_path) != expected_checksum.lower():
            raise ModelConfigurationError("model manifest checksum does not match")

        manifest = _read_manifest(manifest_path)
        model_version = _required_text(manifest, "model_version")
        numeric_features = _string_list(manifest, "numeric_features")
        categorical_features = _string_list(manifest, "categorical_features")
        horizon_payload = manifest.get("horizons")
        if not isinstance(horizon_payload, Mapping):
            raise ModelConfigurationError("model manifest horizons are missing")

        horizons: dict[int, Mapping[str, Any]] = {}
        models: dict[int, Any] = {}
        for horizon in (30, 60):
            configuration = horizon_payload.get(str(horizon))
            if not isinstance(configuration, Mapping):
                raise ModelConfigurationError(f"model manifest is missing horizon {horizon}")
            selected_model = _required_text(configuration, "selected_model")
            interval_half_width = configuration.get("interval_half_width")
            if not isinstance(interval_half_width, (int, float)) or interval_half_width < 0:
                raise ModelConfigurationError("model interval is missing or invalid")
            horizons[horizon] = configuration

            artifact_name = configuration.get("artifact")
            if selected_model == "persistence":
                if artifact_name is not None:
                    raise ModelConfigurationError("persistence must not reference an artifact")
                continue
            if not isinstance(artifact_name, str) or Path(artifact_name).name != artifact_name:
                raise ModelConfigurationError("model artifact name is invalid")
            artifact_path = (manifest_path.parent / artifact_name).resolve(strict=True)
            if artifact_path.parent != manifest_path.parent:
                raise ModelConfigurationError("model artifact escaped its bundle directory")
            artifact_checksum = configuration.get("artifact_sha256")
            if (
                not isinstance(artifact_checksum, str)
                or _sha256(artifact_path) != artifact_checksum
            ):
                raise ModelConfigurationError("model artifact checksum does not match")
            models[horizon] = joblib.load(artifact_path)

        return cls(
            model_version=model_version,
            numeric_features=numeric_features,
            categorical_features=categorical_features,
            horizons=horizons,
            models=models,
        )

    def predict(
        self,
        *,
        horizon_minutes: int,
        observations: Sequence[Mapping[str, Any]],
        station_id: str,
        latitude: float,
        longitude: float,
    ) -> ModelPrediction:
        configuration = self._horizons.get(horizon_minutes)
        if configuration is None:
            raise ValueError("horizon_minutes must be 30 or 60")
        feature_row = _inference_feature_row(
            observations,
            station_id=station_id,
            latitude=latitude,
            longitude=longitude,
        )
        selected_model = str(configuration["selected_model"])
        if selected_model == "persistence":
            predicted_value = float(feature_row["wbgt_t"].iloc[0])
        else:
            model = self._models[horizon_minutes]
            columns = list(self._numeric_features + self._categorical_features)
            missing_columns = sorted(set(columns).difference(feature_row.columns))
            if missing_columns:
                raise ValueError("forecast context is missing required feature fields")
            predicted_value = float(model.predict(feature_row[columns])[0])
        return ModelPrediction(
            predicted_value=predicted_value,
            model_version=f"{self._model_version}:{selected_model}",
            interval_half_width=float(configuration["interval_half_width"]),
        )


def _inference_feature_row(
    observations: Sequence[Mapping[str, Any]],
    *,
    station_id: str,
    latitude: float,
    longitude: float,
) -> pd.DataFrame:
    if not 2 <= len(observations) <= 16:
        raise ValueError("forecast context requires between 2 and 16 observations")
    rows: list[dict[str, Any]] = []
    seen_timestamps: set[pd.Timestamp] = set()
    for observation in observations:
        timestamp = pd.Timestamp(observation["observed_at"])
        if timestamp.tzinfo is None:
            raise ValueError("observation timestamps must include a timezone")
        timestamp = timestamp.tz_convert("UTC")
        if timestamp in seen_timestamps:
            raise ValueError("forecast context contains a duplicate timestamp")
        seen_timestamps.add(timestamp)
        for metric in (
            "wbgt",
            "air_temperature",
            "relative_humidity",
            "wind_speed",
            "wind_direction",
            "rainfall",
        ):
            value = observation.get(metric)
            if value is None:
                continue
            rows.append(
                {
                    "metric": metric,
                    "observed_at": timestamp,
                    "station_id": station_id,
                    "station_name": station_id,
                    "latitude": latitude,
                    "longitude": longitude,
                    "value": float(value),
                }
            )
    readings = pd.DataFrame(rows)
    if readings.empty or "wbgt" not in set(readings["metric"]):
        raise ValueError("forecast context does not contain WBGT observations")
    feature_frame = build_feature_frame(readings)
    latest_timestamp = max(seen_timestamps)
    latest = feature_frame.loc[feature_frame["observed_at"] == latest_timestamp]
    if latest.empty:
        raise ValueError("latest forecast context observation must contain WBGT")
    return latest.tail(1)


def _read_manifest(path: Path) -> Mapping[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ModelConfigurationError("model manifest is unreadable") from error
    if not isinstance(payload, Mapping):
        raise ModelConfigurationError("model manifest must contain an object")
    return payload


def _required_text(mapping: Mapping[str, Any], field: str) -> str:
    value = mapping.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ModelConfigurationError(f"model manifest {field} is missing")
    return value.strip()


def _string_list(mapping: Mapping[str, Any], field: str) -> list[str]:
    value = mapping.get(field)
    if not isinstance(value, list) or not value or not all(isinstance(item, str) for item in value):
        raise ModelConfigurationError(f"model manifest {field} is invalid")
    return value


def _valid_sha256(value: str) -> bool:
    return len(value) == 64 and all(character in "0123456789abcdefABCDEF" for character in value)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
