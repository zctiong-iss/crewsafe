"""Secure, reproducible access to historical data.gov.sg weather observations."""

from __future__ import annotations

import json
import math
import ssl
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Callable, Iterator, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

import certifi


DATA_GOV_SG_BASE_URL = "https://api-open.data.gov.sg/v2/real-time/api"
MAX_RESPONSE_BYTES = 10 * 1024 * 1024
DEFAULT_MAX_PAGES_PER_DAY = 100
# Official station coordinates can receive small corrections between pages.
# Anything larger remains suspicious and stops the dataset build. The 2 km
# allowance covers observed data.gov.sg corrections while keeping the check
# narrow enough to catch likely station-identity mistakes.
MAX_STATION_LOCATION_CORRECTION_METRES = 2_000.0


class HistoricalWeatherError(RuntimeError):
    """Base error for historical weather acquisition."""


class UpstreamRequestError(HistoricalWeatherError):
    """A network or HTTP error occurred without exposing the response body."""

    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


class UpstreamPayloadError(HistoricalWeatherError):
    """The upstream response did not match the documented schema."""


class WeatherMetric(Enum):
    """Allowlisted weather metrics used by the WBGT feature pipeline."""

    WBGT = ("wbgt", "/weather", "deg C", Decimal("-10"), Decimal("60"))
    AIR_TEMPERATURE = (
        "air_temperature",
        "/air-temperature",
        "deg C",
        Decimal("-10"),
        Decimal("60"),
    )
    RELATIVE_HUMIDITY = (
        "relative_humidity",
        "/relative-humidity",
        "percentage",
        Decimal("0"),
        Decimal("100"),
    )
    WIND_SPEED = (
        "wind_speed",
        "/wind-speed",
        "knots",
        Decimal("0"),
        Decimal("250"),
    )
    WIND_DIRECTION = (
        "wind_direction",
        "/wind-direction",
        "degrees",
        Decimal("0"),
        Decimal("360"),
    )
    RAINFALL = (
        "rainfall",
        "/rainfall",
        "mm",
        Decimal("0"),
        Decimal("1000"),
    )

    def __init__(
        self,
        slug: str,
        path: str,
        default_unit: str,
        minimum: Decimal,
        maximum: Decimal,
    ) -> None:
        self.slug = slug
        self.path = path
        self.default_unit = default_unit
        self.minimum = minimum
        self.maximum = maximum


@dataclass(frozen=True)
class WeatherReading:
    """One normalized station observation."""

    metric: str
    observed_at: datetime
    station_id: str
    station_name: str
    latitude: Decimal
    longitude: Decimal
    value: Decimal
    unit: str
    heat_stress: str | None = None

    @property
    def unique_key(self) -> tuple[str, str, str]:
        return self.metric, self.observed_at.isoformat(), self.station_id

    def as_csv_row(self) -> dict[str, str]:
        return {
            "metric": self.metric,
            "observed_at": self.observed_at.isoformat(),
            "station_id": self.station_id,
            "station_name": self.station_name,
            "latitude": str(self.latitude),
            "longitude": str(self.longitude),
            "value": str(self.value),
            "unit": self.unit,
            "heat_stress": self.heat_stress or "",
        }


@dataclass(frozen=True)
class HistoricalWeatherPage:
    """One verified page and its normalized readings."""

    metric: WeatherMetric
    requested_date: date
    page_number: int
    payload: Mapping[str, Any]
    readings: tuple[WeatherReading, ...]
    skipped_missing_reading_count: int
    reused_station_metadata_reading_count: int
    station_metadata_corrections: tuple[StationMetadataCorrection, ...]
    next_pagination_token: str | None


@dataclass(frozen=True)
class StationMetadataCorrection:
    """One accepted, auditable correction to official station metadata."""

    metric: str
    requested_date: date
    page_number: int
    station_id: str
    previous_station_name: str
    corrected_station_name: str
    previous_latitude: Decimal
    previous_longitude: Decimal
    corrected_latitude: Decimal
    corrected_longitude: Decimal
    distance_metres: float

    def as_csv_row(self) -> dict[str, str | int]:
        return {
            "metric": self.metric,
            "requested_date": self.requested_date.isoformat(),
            "page_number": self.page_number,
            "station_id": self.station_id,
            "previous_station_name": self.previous_station_name,
            "corrected_station_name": self.corrected_station_name,
            "previous_latitude": str(self.previous_latitude),
            "previous_longitude": str(self.previous_longitude),
            "corrected_latitude": str(self.corrected_latitude),
            "corrected_longitude": str(self.corrected_longitude),
            "distance_metres": f"{self.distance_metres:.3f}",
        }


JsonRequester = Callable[[str, Mapping[str, str], float], Mapping[str, Any]]
StationMetadata = tuple[Mapping[str, Any], Mapping[str, Any]]


class HistoricalWeatherClient:
    """Fetch paginated historical weather observations from an allowlisted host."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        timeout_seconds: float = 30.0,
        max_attempts: int = 3,
        initial_backoff_seconds: float = 1.0,
        max_backoff_seconds: float = 8.0,
        minimum_request_interval_seconds: float = 1.8,
        max_pages_per_day: int = DEFAULT_MAX_PAGES_PER_DAY,
        requester: JsonRequester | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        if minimum_request_interval_seconds < 0:
            raise ValueError("minimum_request_interval_seconds cannot be negative")
        if max_pages_per_day < 1:
            raise ValueError("max_pages_per_day must be at least 1")

        self._api_key = api_key.strip() if api_key else None
        self._timeout_seconds = timeout_seconds
        self._max_attempts = max_attempts
        self._initial_backoff_seconds = initial_backoff_seconds
        self._max_backoff_seconds = max_backoff_seconds
        self._minimum_request_interval_seconds = minimum_request_interval_seconds
        self._max_pages_per_day = max_pages_per_day
        self._requester = requester or _request_json
        self._sleeper = sleeper
        self._monotonic = monotonic
        self._last_request_started_at: float | None = None
        self._known_standard_stations: dict[
            tuple[WeatherMetric, date], dict[str, StationMetadata]
        ] = {}
        self._latest_standard_stations: dict[
            WeatherMetric, dict[str, StationMetadata]
        ] = {}

    def iter_day(
        self,
        metric: WeatherMetric,
        requested_date: date,
        *,
        first_page_number: int = 1,
        pagination_token: str | None = None,
    ) -> Iterator[HistoricalWeatherPage]:
        """Yield validated pages, optionally continuing after a saved page."""

        if first_page_number < 1:
            raise ValueError("first_page_number must be at least 1")
        seen_tokens = {pagination_token} if pagination_token else set()

        for page_number in range(first_page_number, self._max_pages_per_day + 1):
            parameters = self._parameters(metric, requested_date, pagination_token)
            payload = self._request_with_retries(metric.path, parameters)
            page = self.parse_page(
                metric,
                requested_date,
                page_number,
                payload,
            )
            yield page

            next_token = page.next_pagination_token
            if next_token is None:
                return
            if next_token in seen_tokens:
                raise UpstreamPayloadError("upstream returned a repeated pagination token")
            seen_tokens.add(next_token)
            pagination_token = next_token

        raise UpstreamPayloadError(
            f"{metric.slug} exceeded {self._max_pages_per_day} pages for one day"
        )

    def parse_page(
        self,
        metric: WeatherMetric,
        requested_date: date,
        page_number: int,
        payload: Mapping[str, Any],
    ) -> HistoricalWeatherPage:
        """Validate a downloaded or saved raw response page."""

        _validate_envelope(payload)
        data = _require_mapping(payload.get("data"), "response data")
        reused_station_metadata_reading_count = 0
        station_metadata_corrections: tuple[StationMetadataCorrection, ...] = ()
        if metric is WeatherMetric.WBGT:
            readings, skipped_missing_reading_count = _parse_wbgt_readings(data)
        else:
            known_stations = self._known_standard_stations.setdefault(
                (metric, requested_date),
                {},
            )
            latest_stations = self._latest_standard_stations.setdefault(metric, {})
            (
                readings,
                skipped_missing_reading_count,
                reused_station_metadata_reading_count,
                station_metadata_corrections,
            ) = _parse_standard_readings(
                metric,
                data,
                known_stations,
                latest_stations,
                requested_date=requested_date,
                page_number=page_number,
            )
        return HistoricalWeatherPage(
            metric=metric,
            requested_date=requested_date,
            page_number=page_number,
            payload=payload,
            readings=tuple(readings),
            skipped_missing_reading_count=skipped_missing_reading_count,
            reused_station_metadata_reading_count=(
                reused_station_metadata_reading_count
            ),
            station_metadata_corrections=station_metadata_corrections,
            next_pagination_token=_pagination_token(data),
        )

    def _parameters(
        self,
        metric: WeatherMetric,
        requested_date: date,
        pagination_token: str | None,
    ) -> dict[str, str]:
        parameters = {"date": requested_date.isoformat()}
        if metric is WeatherMetric.WBGT:
            parameters["api"] = "wbgt"
        if pagination_token:
            parameters["paginationToken"] = pagination_token
        return parameters

    def _request_with_retries(
        self,
        path: str,
        parameters: Mapping[str, str],
    ) -> Mapping[str, Any]:
        url = f"{DATA_GOV_SG_BASE_URL}{path}?{urlencode(parameters)}"
        headers = {"Accept": "application/json", "User-Agent": "CrewSafe-ML/1.0"}
        if self._api_key:
            headers["x-api-key"] = self._api_key

        backoff = self._initial_backoff_seconds
        for attempt in range(1, self._max_attempts + 1):
            self._wait_for_rate_limit()
            try:
                return self._requester(url, headers, self._timeout_seconds)
            except UpstreamRequestError as error:
                if not error.retryable or attempt == self._max_attempts:
                    raise
                self._sleeper(backoff)
                backoff = min(backoff * 2, self._max_backoff_seconds)

        raise AssertionError("retry loop exited unexpectedly")

    def _wait_for_rate_limit(self) -> None:
        if self._last_request_started_at is not None:
            elapsed = self._monotonic() - self._last_request_started_at
            remaining = self._minimum_request_interval_seconds - elapsed
            if remaining > 0:
                self._sleeper(remaining)
        self._last_request_started_at = self._monotonic()


def _request_json(
    url: str,
    headers: Mapping[str, str],
    timeout_seconds: float,
) -> Mapping[str, Any]:
    request = Request(url, headers=dict(headers), method="GET")
    try:
        # Refuse redirects so an upstream response cannot forward API-key
        # headers to a different host.
        tls_context = ssl.create_default_context(cafile=certifi.where())
        opener = build_opener(_NoRedirectHandler(), HTTPSHandler(context=tls_context))
        with opener.open(request, timeout=timeout_seconds) as response:
            content = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as error:
        retryable = error.code == 429 or 500 <= error.code <= 599
        raise UpstreamRequestError(
            f"data.gov.sg returned HTTP {error.code}", retryable=retryable
        ) from error
    except (TimeoutError, URLError) as error:
        raise UpstreamRequestError(
            "data.gov.sg request failed", retryable=True
        ) from error

    if len(content) > MAX_RESPONSE_BYTES:
        raise UpstreamPayloadError("data.gov.sg response exceeded the size limit")
    try:
        payload = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise UpstreamPayloadError("data.gov.sg returned invalid JSON") from error
    return _require_mapping(payload, "response")


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        del request, file_pointer, code, message, headers, new_url
        return None


def _validate_envelope(payload: Mapping[str, Any]) -> None:
    code = payload.get("code")
    if code != 0:
        raise UpstreamPayloadError(f"data.gov.sg response reported code {code!r}")


def _pagination_token(data: Mapping[str, Any]) -> str | None:
    value = data.get("paginationToken")
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise UpstreamPayloadError("pagination token must be text")
    return value


def _parse_wbgt_readings(
    data: Mapping[str, Any],
) -> tuple[list[WeatherReading], int]:
    records = _require_list(data.get("records"), "WBGT records")
    normalized: list[WeatherReading] = []
    skipped_missing_count = 0
    for record in records:
        record_mapping = _require_mapping(record, "WBGT record")
        observed_at = _parse_timestamp(record_mapping.get("datetime"), "WBGT datetime")
        item = _require_mapping(record_mapping.get("item"), "WBGT item")
        station_readings = _require_list(item.get("readings"), "WBGT readings")
        for reading in station_readings:
            reading_mapping = _require_mapping(reading, "WBGT reading")
            station = _require_mapping(reading_mapping.get("station"), "WBGT station")
            location = _require_mapping(reading_mapping.get("location"), "WBGT location")
            value = reading_mapping.get("wbgt")
            if _is_missing_measurement(value):
                skipped_missing_count += 1
                continue
            normalized.append(
                _build_reading(
                    WeatherMetric.WBGT,
                    observed_at,
                    station,
                    location,
                    value,
                    unit=WeatherMetric.WBGT.default_unit,
                    heat_stress=_optional_text(reading_mapping.get("heatStress")),
                )
            )
    return normalized, skipped_missing_count


def _parse_standard_readings(
    metric: WeatherMetric,
    data: Mapping[str, Any],
    known_stations: dict[str, StationMetadata],
    latest_stations: dict[str, StationMetadata],
    *,
    requested_date: date,
    page_number: int,
) -> tuple[list[WeatherReading], int, int, tuple[StationMetadataCorrection, ...]]:
    stations = _require_list(data.get("stations"), f"{metric.slug} stations")
    station_by_id: dict[str, StationMetadata] = {}
    metadata_corrections: list[StationMetadataCorrection] = []
    for station_value in stations:
        station = _require_mapping(station_value, f"{metric.slug} station")
        station_id = _required_text(station.get("id"), f"{metric.slug} station id")
        if station_id in station_by_id:
            raise UpstreamPayloadError(f"duplicate {metric.slug} station id {station_id}")
        location = _require_mapping(
            station.get("location"), f"{metric.slug} station location"
        )
        metadata = (station, location)
        previous_metadata = latest_stations.get(station_id)
        if previous_metadata is not None:
            if _station_identity(previous_metadata) != _station_identity(metadata):
                raise UpstreamPayloadError(
                    f"conflicting {metric.slug} station metadata for {station_id}"
                )
            previous_station_name = _station_name(previous_metadata)
            current_station_name = _station_name(metadata)
            previous_latitude, previous_longitude = _station_coordinates(
                previous_metadata
            )
            current_latitude, current_longitude = _station_coordinates(metadata)
            distance_metres = station_location_distance_metres(
                previous_latitude,
                previous_longitude,
                current_latitude,
                current_longitude,
            )
            if distance_metres > MAX_STATION_LOCATION_CORRECTION_METRES:
                raise UpstreamPayloadError(
                    f"conflicting {metric.slug} station metadata for {station_id}"
                )
            if (
                previous_station_name != current_station_name
                or distance_metres > 0
            ):
                metadata_corrections.append(
                    StationMetadataCorrection(
                        metric=metric.slug,
                        requested_date=requested_date,
                        page_number=page_number,
                        station_id=station_id,
                        previous_station_name=previous_station_name,
                        corrected_station_name=current_station_name,
                        previous_latitude=previous_latitude,
                        previous_longitude=previous_longitude,
                        corrected_latitude=current_latitude,
                        corrected_longitude=current_longitude,
                        distance_metres=distance_metres,
                    )
                )
        station_by_id[station_id] = metadata

    unit = _optional_text(data.get("readingUnit")) or metric.default_unit
    batches = _require_list(data.get("readings"), f"{metric.slug} readings")
    normalized: list[WeatherReading] = []
    skipped_missing_count = 0
    reused_station_metadata_count = 0
    for batch_value in batches:
        batch = _require_mapping(batch_value, f"{metric.slug} reading batch")
        observed_at = _parse_timestamp(
            batch.get("timestamp"), f"{metric.slug} reading timestamp"
        )
        for reading_value in _require_list(
            batch.get("data"), f"{metric.slug} station readings"
        ):
            reading = _require_mapping(reading_value, f"{metric.slug} station reading")
            station_id = _required_text(
                reading.get("stationId"), f"{metric.slug} reading station id"
            )
            station_metadata = station_by_id.get(station_id)
            if station_metadata is None:
                station_metadata = known_stations.get(station_id)
                if station_metadata is None:
                    raise UpstreamPayloadError(
                        f"{metric.slug} reading references unknown station {station_id}"
                    )
                reused_station_metadata_count += 1
            value = reading.get("value")
            if _is_missing_measurement(value):
                skipped_missing_count += 1
                continue
            station, location = station_metadata
            normalized.append(
                _build_reading(
                    metric,
                    observed_at,
                    station,
                    location,
                    value,
                    unit=unit,
                )
            )
    # Remember metadata only after the entire page has passed validation.
    known_stations.update(station_by_id)
    latest_stations.update(station_by_id)
    return (
        normalized,
        skipped_missing_count,
        reused_station_metadata_count,
        tuple(metadata_corrections),
    )


def _station_identity(metadata: StationMetadata) -> tuple[str, str]:
    station, location = metadata
    del location
    station_id = _required_text(station.get("id"), "station id")
    device_id = _optional_text(station.get("deviceId")) or station_id
    return station_id, device_id


def _station_name(metadata: StationMetadata) -> str:
    station, location = metadata
    del location
    return _required_text(station.get("name"), "station name")


def _station_coordinates(metadata: StationMetadata) -> tuple[Decimal, Decimal]:
    _, location = metadata
    latitude = _parse_decimal(location.get("latitude"), "station latitude")
    longitude = _parse_decimal(location.get("longitude"), "station longitude")
    if not Decimal("-90") <= latitude <= Decimal("90"):
        raise UpstreamPayloadError("station latitude is outside the valid range")
    if not Decimal("-180") <= longitude <= Decimal("180"):
        raise UpstreamPayloadError("station longitude is outside the valid range")
    return latitude, longitude


def station_location_distance_metres(
    latitude_1: Decimal,
    longitude_1: Decimal,
    latitude_2: Decimal,
    longitude_2: Decimal,
) -> float:
    """Return the great-circle distance between two station coordinates."""

    latitude_delta = math.radians(float(latitude_2 - latitude_1))
    longitude_delta = math.radians(float(longitude_2 - longitude_1))
    start_latitude = math.radians(float(latitude_1))
    end_latitude = math.radians(float(latitude_2))
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(start_latitude)
        * math.cos(end_latitude)
        * math.sin(longitude_delta / 2) ** 2
    )
    return 6_371_000 * 2 * math.atan2(math.sqrt(haversine), math.sqrt(1 - haversine))


def _is_missing_measurement(value: object) -> bool:
    """Recognise only the missing markers observed in the official feed."""

    return value is None or (
        isinstance(value, str) and value.strip().upper() == "NA"
    )


def _build_reading(
    metric: WeatherMetric,
    observed_at: datetime,
    station: Mapping[str, Any],
    location: Mapping[str, Any],
    value: object,
    *,
    unit: str,
    heat_stress: str | None = None,
) -> WeatherReading:
    station_id = _required_text(station.get("id"), f"{metric.slug} station id")
    station_name = _required_text(
        station.get("name"), f"{metric.slug} station name"
    )
    latitude = _parse_decimal(location.get("latitude"), "station latitude")
    longitude = _parse_decimal(location.get("longitude"), "station longitude")
    if not Decimal("-90") <= latitude <= Decimal("90"):
        raise UpstreamPayloadError("station latitude is outside the valid range")
    if not Decimal("-180") <= longitude <= Decimal("180"):
        raise UpstreamPayloadError("station longitude is outside the valid range")

    parsed_value = _parse_decimal(value, f"{metric.slug} value")
    if not metric.minimum <= parsed_value <= metric.maximum:
        raise UpstreamPayloadError(f"{metric.slug} value is outside the accepted range")

    return WeatherReading(
        metric=metric.slug,
        observed_at=observed_at,
        station_id=station_id,
        station_name=station_name,
        latitude=latitude,
        longitude=longitude,
        value=parsed_value,
        unit=unit,
        heat_stress=heat_stress,
    )


def _parse_timestamp(value: object, label: str) -> datetime:
    text = _required_text(value, label)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise UpstreamPayloadError(f"{label} is not an ISO-8601 timestamp") from error
    if parsed.tzinfo is None:
        raise UpstreamPayloadError(f"{label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _parse_decimal(value: object, label: str) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise UpstreamPayloadError(f"{label} is missing or invalid")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise UpstreamPayloadError(f"{label} is not numeric") from error
    if not parsed.is_finite() or not math.isfinite(float(parsed)):
        raise UpstreamPayloadError(f"{label} must be finite")
    return parsed


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise UpstreamPayloadError(f"{label} is missing or invalid")
    return value.strip()


def _optional_text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _require_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise UpstreamPayloadError(f"{label} is missing or invalid")
    return value


def _require_list(value: object, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise UpstreamPayloadError(f"{label} is missing or invalid")
    return value
