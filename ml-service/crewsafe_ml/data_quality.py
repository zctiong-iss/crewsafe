"""Small, readable data-quality reports for historical weather datasets."""

from __future__ import annotations

import csv
import hashlib
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable

from .data_gov_sg import (
    MAX_STATION_LOCATION_CORRECTION_METRES,
    UpstreamPayloadError,
    WeatherMetric,
    WeatherReading,
    station_location_distance_metres,
)


# These are the normal publication intervals in the data.gov.sg feeds we use.
EXPECTED_INTERVAL_MINUTES = {
    WeatherMetric.WBGT.slug: 15,
    WeatherMetric.AIR_TEMPERATURE.slug: 1,
    WeatherMetric.RELATIVE_HUMIDITY.slug: 1,
    WeatherMetric.WIND_SPEED.slug: 1,
    WeatherMetric.WIND_DIRECTION.slug: 1,
    WeatherMetric.RAINFALL.slug: 5,
}

STATION_COLUMNS = (
    "metric",
    "station_id",
    "station_name",
    "latitude",
    "longitude",
    "row_count",
    "first_observed_at",
    "last_observed_at",
)

GAP_COLUMNS = (
    "metric",
    "station_id",
    "gap_after",
    "gap_before",
    "expected_interval_minutes",
    "missing_interval_count",
    "gap_minutes",
)


@dataclass(frozen=True)
class DataQualityReport:
    """Files and summaries that help a person inspect dataset quality."""

    station_inventory_csv: Path
    missing_periods_csv: Path
    station_inventory_sha256: str
    missing_periods_sha256: str
    row_count_by_metric: dict[str, int]
    station_count_by_metric: dict[str, int]
    coverage_by_metric: dict[str, dict[str, str | None]]
    gap_count_by_metric: dict[str, int]
    largest_gap_minutes_by_metric: dict[str, float]


@dataclass
class _StationSummary:
    reading: WeatherReading
    row_count: int
    first_observed_at: datetime
    last_observed_at: datetime


def write_data_quality_reports(
    readings: Iterable[WeatherReading],
    *,
    metrics: Iterable[WeatherMetric],
    output_directory: Path,
) -> DataQualityReport:
    """Write station and internal-gap reports from validated observations."""

    selected_metrics = tuple(metrics)
    metric_names = [metric.slug for metric in selected_metrics]
    row_count_by_metric = {name: 0 for name in metric_names}
    station_summaries: dict[tuple[str, str], _StationSummary] = {}
    times_by_station: dict[tuple[str, str], list[datetime]] = defaultdict(list)

    for reading in readings:
        row_count_by_metric[reading.metric] += 1
        station_key = (reading.metric, reading.station_id)
        times_by_station[station_key].append(reading.observed_at)
        _update_station_summary(station_summaries, station_key, reading)

    station_inventory = output_directory / "station_inventory.csv"
    missing_periods = output_directory / "missing_periods.csv"
    _write_station_inventory(station_inventory, station_summaries)
    gaps = _find_internal_gaps(times_by_station)
    _write_csv(missing_periods, GAP_COLUMNS, gaps)

    return DataQualityReport(
        station_inventory_csv=station_inventory,
        missing_periods_csv=missing_periods,
        station_inventory_sha256=_sha256(station_inventory),
        missing_periods_sha256=_sha256(missing_periods),
        row_count_by_metric=row_count_by_metric,
        station_count_by_metric=_station_counts(metric_names, station_summaries),
        coverage_by_metric=_coverage(metric_names, station_summaries),
        gap_count_by_metric=_gap_counts(metric_names, gaps),
        largest_gap_minutes_by_metric=_largest_gaps(metric_names, gaps),
    )


def _update_station_summary(
    summaries: dict[tuple[str, str], _StationSummary],
    station_key: tuple[str, str],
    reading: WeatherReading,
) -> None:
    existing = summaries.get(station_key)
    if existing is None:
        summaries[station_key] = _StationSummary(
            reading=reading,
            row_count=1,
            first_observed_at=reading.observed_at,
            last_observed_at=reading.observed_at,
        )
        return

    original = existing.reading
    location_distance = station_location_distance_metres(
        original.latitude,
        original.longitude,
        reading.latitude,
        reading.longitude,
    )
    if location_distance > MAX_STATION_LOCATION_CORRECTION_METRES:
        raise UpstreamPayloadError(
            f"conflicting station metadata for {reading.metric}/{reading.station_id}"
        )
    if original.station_name != reading.station_name or location_distance > 0:
        # Readings arrive chronologically, so the inventory shows the latest
        # accepted official name and coordinates. The correction CSV keeps the
        # complete history used to audit these upstream metadata changes.
        existing.reading = reading
    existing.row_count += 1
    existing.first_observed_at = min(existing.first_observed_at, reading.observed_at)
    existing.last_observed_at = max(existing.last_observed_at, reading.observed_at)


def _write_station_inventory(
    destination: Path,
    summaries: dict[tuple[str, str], _StationSummary],
) -> None:
    rows = []
    for station_key in sorted(summaries):
        summary = summaries[station_key]
        reading = summary.reading
        rows.append(
            {
                "metric": reading.metric,
                "station_id": reading.station_id,
                "station_name": reading.station_name,
                "latitude": str(reading.latitude),
                "longitude": str(reading.longitude),
                "row_count": summary.row_count,
                "first_observed_at": summary.first_observed_at.isoformat(),
                "last_observed_at": summary.last_observed_at.isoformat(),
            }
        )
    _write_csv(destination, STATION_COLUMNS, rows)


def _find_internal_gaps(
    times_by_station: dict[tuple[str, str], list[datetime]],
) -> list[dict[str, str | int | float]]:
    gaps: list[dict[str, str | int | float]] = []
    for (metric, station_id), observed_times in sorted(times_by_station.items()):
        expected_minutes = EXPECTED_INTERVAL_MINUTES[metric]
        expected_interval = timedelta(minutes=expected_minutes)
        previous_time: datetime | None = None
        for observed_time in sorted(set(observed_times)):
            if previous_time is not None and observed_time - previous_time > expected_interval:
                gap_minutes = (observed_time - previous_time).total_seconds() / 60
                missing_count = max(0, int(gap_minutes // expected_minutes) - 1)
                gaps.append(
                    {
                        "metric": metric,
                        "station_id": station_id,
                        "gap_after": previous_time.isoformat(),
                        "gap_before": observed_time.isoformat(),
                        "expected_interval_minutes": expected_minutes,
                        "missing_interval_count": missing_count,
                        "gap_minutes": gap_minutes,
                    }
                )
            previous_time = observed_time
    return gaps


def _station_counts(
    metric_names: list[str],
    summaries: dict[tuple[str, str], _StationSummary],
) -> dict[str, int]:
    return {
        metric: sum(1 for station_metric, _ in summaries if station_metric == metric)
        for metric in metric_names
    }


def _coverage(
    metric_names: list[str],
    summaries: dict[tuple[str, str], _StationSummary],
) -> dict[str, dict[str, str | None]]:
    result: dict[str, dict[str, str | None]] = {}
    for metric in metric_names:
        metric_summaries = [
            summary
            for (station_metric, _), summary in summaries.items()
            if station_metric == metric
        ]
        result[metric] = {
            "first_observed_at": min(
                (summary.first_observed_at for summary in metric_summaries),
                default=None,
            ).isoformat()
            if metric_summaries
            else None,
            "last_observed_at": max(
                (summary.last_observed_at for summary in metric_summaries),
                default=None,
            ).isoformat()
            if metric_summaries
            else None,
        }
    return result


def _gap_counts(
    metric_names: list[str],
    gaps: list[dict[str, str | int | float]],
) -> dict[str, int]:
    return {
        metric: sum(1 for gap in gaps if gap["metric"] == metric)
        for metric in metric_names
    }


def _largest_gaps(
    metric_names: list[str],
    gaps: list[dict[str, str | int | float]],
) -> dict[str, float]:
    return {
        metric: max(
            (float(gap["gap_minutes"]) for gap in gaps if gap["metric"] == metric),
            default=0.0,
        )
        for metric in metric_names
    }


def _write_csv(
    destination: Path,
    columns: tuple[str, ...],
    rows: Iterable[dict[str, str | int | float]],
) -> None:
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(temporary, destination)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
