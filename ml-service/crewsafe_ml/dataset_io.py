"""Build reproducible weather datasets and safely resume interrupted downloads."""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Iterator, Mapping

from .data_gov_sg import (
    DATA_GOV_SG_BASE_URL,
    MAX_STATION_LOCATION_CORRECTION_METRES,
    HistoricalWeatherClient,
    HistoricalWeatherPage,
    StationMetadataCorrection,
    UpstreamPayloadError,
    WeatherMetric,
    WeatherReading,
)
from .data_quality import DataQualityReport, write_data_quality_reports
from .prepared_dataset import (
    PreparedDatasetResult,
    prepared_dataset_manifest,
    write_prepared_15_minute_dataset,
)


DATASET_SCHEMA_VERSION = 4
DOWNLOAD_STATE_SCHEMA_VERSION = 1
DOWNLOAD_STATE_FILE = "download_state.json"
SOURCE_LICENCE_NAME = "Singapore Open Data Licence"
SOURCE_LICENCE_URL = "https://data.gov.sg/open-data-licence"
RAW_PAGE_PATTERN = re.compile(r"^(?P<metric>[a-z_]+)-page-(?P<page>\d{3})[.]json$")

CSV_COLUMNS = (
    "metric",
    "observed_at",
    "station_id",
    "station_name",
    "latitude",
    "longitude",
    "value",
    "unit",
    "heat_stress",
)

STATION_METADATA_CORRECTION_COLUMNS = (
    "metric",
    "requested_date",
    "page_number",
    "station_id",
    "previous_station_name",
    "corrected_station_name",
    "previous_latitude",
    "previous_longitude",
    "corrected_latitude",
    "corrected_longitude",
    "distance_metres",
)


@dataclass(frozen=True)
class DatasetBuildResult:
    output_directory: Path
    normalized_csv: Path
    prepared_15_minute_csv: Path | None
    station_inventory_csv: Path
    station_metadata_corrections_csv: Path
    missing_periods_csv: Path
    manifest_json: Path
    row_count: int
    skipped_missing_reading_count: int
    reused_station_metadata_reading_count: int
    reused_raw_page_count: int
    downloaded_raw_page_count: int
    sha256: str


def inclusive_dates(start_date: date, end_date: date) -> Iterator[date]:
    if end_date < start_date:
        raise ValueError("end_date cannot be before start_date")
    number_of_days = (end_date - start_date).days + 1
    if number_of_days > 730:
        raise ValueError("date range cannot exceed 730 days")
    for offset in range(number_of_days):
        yield start_date + timedelta(days=offset)


def build_historical_dataset(
    client: HistoricalWeatherClient,
    *,
    start_date: date,
    end_date: date,
    output_directory: Path,
    metrics: Iterable[WeatherMetric],
) -> DatasetBuildResult:
    """Download or resume raw pages, then build checked training files."""

    selected_metrics = tuple(metrics)
    _validate_metric_selection(selected_metrics)
    requested_dates = tuple(inclusive_dates(start_date, end_date))

    output_directory = output_directory.resolve()
    raw_directory = output_directory / "raw"
    normalized_csv = output_directory / "weather_readings.csv"
    prepared_csv = output_directory / "weather_features_15min.csv"
    station_metadata_corrections_csv = (
        output_directory / "station_metadata_corrections.csv"
    )
    manifest_json = output_directory / "manifest.json"

    download_state = _download_state(start_date, end_date, selected_metrics)
    _prepare_resumable_directory(output_directory, download_state)
    raw_directory.mkdir(parents=True, exist_ok=True)

    readings_by_key: dict[tuple[str, str, str], WeatherReading] = {}
    skipped_missing_by_metric = {metric.slug: 0 for metric in selected_metrics}
    reused_station_metadata_by_metric = {
        metric.slug: 0 for metric in selected_metrics
    }
    reused_raw_page_count = 0
    downloaded_raw_page_count = 0
    duplicate_reading_count = 0
    station_metadata_corrections: list[StationMetadataCorrection] = []

    for requested_date in requested_dates:
        for metric in selected_metrics:
            saved_pages = _read_saved_pages(
                client,
                raw_directory,
                metric,
                requested_date,
            )
            reused_raw_page_count += len(saved_pages)
            duplicate_reading_count += _collect_pages(
                saved_pages,
                readings_by_key,
                skipped_missing_by_metric,
                reused_station_metadata_by_metric,
                station_metadata_corrections,
            )

            if saved_pages and saved_pages[-1].next_pagination_token is None:
                continue

            next_page_number = len(saved_pages) + 1
            next_token = (
                saved_pages[-1].next_pagination_token if saved_pages else None
            )
            for page in client.iter_day(
                metric,
                requested_date,
                first_page_number=next_page_number,
                pagination_token=next_token,
            ):
                _write_raw_page(raw_directory, page)
                downloaded_raw_page_count += 1
                duplicate_reading_count += _collect_pages(
                    (page,),
                    readings_by_key,
                    skipped_missing_by_metric,
                    reused_station_metadata_by_metric,
                    station_metadata_corrections,
                )

    ordered_readings = sorted(
        readings_by_key.values(),
        key=lambda reading: (
            reading.observed_at,
            reading.metric,
            reading.station_id,
        ),
    )
    _write_csv(normalized_csv, ordered_readings)
    _write_station_metadata_corrections(
        station_metadata_corrections_csv,
        station_metadata_corrections,
    )
    normalized_sha256 = _sha256(normalized_csv)
    quality_report = write_data_quality_reports(
        ordered_readings,
        metrics=selected_metrics,
        output_directory=output_directory,
    )
    prepared_result = _prepare_features_if_possible(
        selected_metrics,
        normalized_csv,
        prepared_csv,
    )

    skipped_missing_count = sum(skipped_missing_by_metric.values())
    reused_station_metadata_count = sum(
        reused_station_metadata_by_metric.values()
    )
    manifest = _dataset_manifest(
        _DatasetManifestInputs(
            start_date=start_date,
            end_date=end_date,
            selected_metrics=selected_metrics,
            normalized_csv=normalized_csv,
            normalized_sha256=normalized_sha256,
            row_count=len(ordered_readings),
            skipped_missing_count=skipped_missing_count,
            skipped_missing_by_metric=skipped_missing_by_metric,
            reused_station_metadata_count=reused_station_metadata_count,
            reused_station_metadata_by_metric=reused_station_metadata_by_metric,
            duplicate_reading_count=duplicate_reading_count,
            station_metadata_corrections=station_metadata_corrections,
            station_metadata_corrections_csv=station_metadata_corrections_csv,
            reused_raw_page_count=reused_raw_page_count,
            downloaded_raw_page_count=downloaded_raw_page_count,
            quality_report=quality_report,
            prepared_result=prepared_result,
        )
    )
    _atomic_write_text(manifest_json, json.dumps(manifest, indent=2, sort_keys=True) + "\n")

    return DatasetBuildResult(
        output_directory=output_directory,
        normalized_csv=normalized_csv,
        prepared_15_minute_csv=prepared_result.path if prepared_result else None,
        station_inventory_csv=quality_report.station_inventory_csv,
        station_metadata_corrections_csv=station_metadata_corrections_csv,
        missing_periods_csv=quality_report.missing_periods_csv,
        manifest_json=manifest_json,
        row_count=len(ordered_readings),
        skipped_missing_reading_count=skipped_missing_count,
        reused_station_metadata_reading_count=reused_station_metadata_count,
        reused_raw_page_count=reused_raw_page_count,
        downloaded_raw_page_count=downloaded_raw_page_count,
        sha256=normalized_sha256,
    )


def _validate_metric_selection(metrics: tuple[WeatherMetric, ...]) -> None:
    if not metrics:
        raise ValueError("at least one metric is required")
    if len(metrics) != len(set(metrics)):
        raise ValueError("metrics cannot contain duplicates")


def _download_state(
    start_date: date,
    end_date: date,
    metrics: tuple[WeatherMetric, ...],
) -> dict[str, object]:
    return {
        "schema_version": DOWNLOAD_STATE_SCHEMA_VERSION,
        "source": "data.gov.sg",
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "metrics": [metric.slug for metric in metrics],
    }


def _prepare_resumable_directory(
    output_directory: Path,
    expected_state: dict[str, object],
) -> None:
    output_directory.mkdir(parents=True, exist_ok=True)
    state_path = output_directory / DOWNLOAD_STATE_FILE
    if state_path.is_file():
        actual_state = _read_json_object(state_path, "download state")
        if actual_state != expected_state:
            raise ValueError(
                "output_directory belongs to different dates or metrics; use a new folder"
            )
        return

    if any(output_directory.iterdir()):
        raise ValueError(
            "non-empty output_directory has no download state and cannot be resumed safely"
        )
    _atomic_write_text(
        state_path,
        json.dumps(expected_state, indent=2, sort_keys=True) + "\n",
    )


def _read_saved_pages(
    client: HistoricalWeatherClient,
    raw_directory: Path,
    metric: WeatherMetric,
    requested_date: date,
) -> tuple[HistoricalWeatherPage, ...]:
    day_directory = raw_directory / requested_date.isoformat()
    if not day_directory.is_dir():
        return ()

    numbered_paths: list[tuple[int, Path]] = []
    for path in day_directory.glob(f"{metric.slug}-page-*.json"):
        match = RAW_PAGE_PATTERN.fullmatch(path.name)
        if match is None or match.group("metric") != metric.slug:
            raise ValueError(f"unexpected raw page filename: {path.name}")
        numbered_paths.append((int(match.group("page")), path))
    numbered_paths.sort()

    expected_numbers = list(range(1, len(numbered_paths) + 1))
    actual_numbers = [page_number for page_number, _ in numbered_paths]
    if actual_numbers != expected_numbers:
        raise ValueError(
            f"saved pages for {requested_date}/{metric.slug} are not consecutive"
        )

    pages = tuple(
        client.parse_page(
            metric,
            requested_date,
            page_number,
            _read_json_object(path, "raw weather page"),
        )
        for page_number, path in numbered_paths
    )
    _validate_saved_pagination(pages)
    return pages


def _validate_saved_pagination(pages: tuple[HistoricalWeatherPage, ...]) -> None:
    seen_tokens: set[str] = set()
    for index, page in enumerate(pages):
        token = page.next_pagination_token
        if token is None and index != len(pages) - 1:
            raise ValueError("saved raw pages continue after a final page")
        if token is not None and token in seen_tokens:
            raise ValueError("saved raw pages contain a repeated pagination token")
        if token is not None:
            seen_tokens.add(token)


def _collect_pages(
    pages: Iterable[HistoricalWeatherPage],
    readings_by_key: dict[tuple[str, str, str], WeatherReading],
    skipped_missing_by_metric: dict[str, int],
    reused_station_metadata_by_metric: dict[str, int],
    station_metadata_corrections: list[StationMetadataCorrection],
) -> int:
    duplicate_reading_count = 0
    for page in pages:
        skipped_missing_by_metric[page.metric.slug] += (
            page.skipped_missing_reading_count
        )
        reused_station_metadata_by_metric[page.metric.slug] += (
            page.reused_station_metadata_reading_count
        )
        station_metadata_corrections.extend(page.station_metadata_corrections)
        for reading in page.readings:
            existing = readings_by_key.get(reading.unique_key)
            if existing is not None and existing != reading:
                raise UpstreamPayloadError(
                    "conflicting duplicate reading for "
                    f"{reading.metric}/{reading.observed_at.isoformat()}/"
                    f"{reading.station_id}"
                )
            if existing is not None:
                duplicate_reading_count += 1
            readings_by_key[reading.unique_key] = reading
    return duplicate_reading_count


def _prepare_features_if_possible(
    selected_metrics: tuple[WeatherMetric, ...],
    normalized_csv: Path,
    prepared_csv: Path,
) -> PreparedDatasetResult | None:
    if WeatherMetric.WBGT not in selected_metrics:
        return None
    return write_prepared_15_minute_dataset(normalized_csv, prepared_csv)


@dataclass(frozen=True)
class _DatasetManifestInputs:
    """Everything `_dataset_manifest` needs, grouped so the signature stays readable."""

    start_date: date
    end_date: date
    selected_metrics: tuple[WeatherMetric, ...]
    normalized_csv: Path
    normalized_sha256: str
    row_count: int
    skipped_missing_count: int
    skipped_missing_by_metric: dict[str, int]
    reused_station_metadata_count: int
    reused_station_metadata_by_metric: dict[str, int]
    duplicate_reading_count: int
    station_metadata_corrections: list[StationMetadataCorrection]
    station_metadata_corrections_csv: Path
    reused_raw_page_count: int
    downloaded_raw_page_count: int
    quality_report: DataQualityReport
    prepared_result: PreparedDatasetResult | None


def _dataset_manifest(inputs: _DatasetManifestInputs) -> dict[str, object]:
    return {
        "schema_version": DATASET_SCHEMA_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "data.gov.sg",
        "source_details": {
            "api_base_url": DATA_GOV_SG_BASE_URL,
            "licence": {
                "name": SOURCE_LICENCE_NAME,
                "url": SOURCE_LICENCE_URL,
            },
        },
        "start_date": inputs.start_date.isoformat(),
        "end_date": inputs.end_date.isoformat(),
        "metrics": [metric.slug for metric in inputs.selected_metrics],
        "download": {
            "raw_page_count": inputs.reused_raw_page_count + inputs.downloaded_raw_page_count,
            "reused_raw_page_count": inputs.reused_raw_page_count,
            "downloaded_raw_page_count": inputs.downloaded_raw_page_count,
            "state_file": DOWNLOAD_STATE_FILE,
        },
        "raw_page_count": inputs.reused_raw_page_count + inputs.downloaded_raw_page_count,
        "row_count": inputs.row_count,
        "normalized_file": inputs.normalized_csv.name,
        "normalized_sha256": inputs.normalized_sha256,
        "prepared_15_minute_dataset": (
            prepared_dataset_manifest(inputs.prepared_result) if inputs.prepared_result else None
        ),
        "data_quality": {
            "row_count_by_metric": inputs.quality_report.row_count_by_metric,
            "station_count_by_metric": inputs.quality_report.station_count_by_metric,
            "coverage_by_metric": inputs.quality_report.coverage_by_metric,
            "skipped_missing_reading_count": inputs.skipped_missing_count,
            "skipped_missing_reading_count_by_metric": inputs.skipped_missing_by_metric,
            "reused_prior_page_station_metadata_reading_count": (
                inputs.reused_station_metadata_count
            ),
            "reused_prior_page_station_metadata_reading_count_by_metric": (
                inputs.reused_station_metadata_by_metric
            ),
            "exact_duplicate_reading_count": inputs.duplicate_reading_count,
            "accepted_station_metadata_correction_count": len(
                inputs.station_metadata_corrections
            ),
            "station_metadata_corrections": {
                "file": inputs.station_metadata_corrections_csv.name,
                "sha256": _sha256(inputs.station_metadata_corrections_csv),
                "maximum_accepted_distance_metres": (
                    MAX_STATION_LOCATION_CORRECTION_METRES
                ),
            },
            "rejected_invalid_reading_count": 0,
            "internal_gap_count_by_metric": inputs.quality_report.gap_count_by_metric,
            "largest_internal_gap_minutes_by_metric": (
                inputs.quality_report.largest_gap_minutes_by_metric
            ),
            "station_inventory": {
                "file": inputs.quality_report.station_inventory_csv.name,
                "sha256": inputs.quality_report.station_inventory_sha256,
            },
            "missing_periods": {
                "file": inputs.quality_report.missing_periods_csv.name,
                "sha256": inputs.quality_report.missing_periods_sha256,
                "definition": "Internal gaps between observed station readings",
            },
        },
    }


def _write_raw_page(raw_directory: Path, page: HistoricalWeatherPage) -> None:
    day_directory = raw_directory / page.requested_date.isoformat()
    day_directory.mkdir(parents=True, exist_ok=True)
    destination = day_directory / f"{page.metric.slug}-page-{page.page_number:03d}.json"
    _atomic_write_text(
        destination,
        json.dumps(page.payload, indent=2, sort_keys=True) + "\n",
    )


def _write_csv(destination: Path, readings: Iterable[WeatherReading]) -> None:
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for reading in readings:
            writer.writerow(reading.as_csv_row())
    os.replace(temporary, destination)


def _write_station_metadata_corrections(
    destination: Path,
    corrections: Iterable[StationMetadataCorrection],
) -> None:
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(
            output,
            fieldnames=STATION_METADATA_CORRECTION_COLUMNS,
        )
        writer.writeheader()
        for correction in corrections:
            writer.writerow(correction.as_csv_row())
    os.replace(temporary, destination)


def _read_json_object(path: Path, label: str) -> Mapping[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is unreadable: {path.name}") from error
    if not isinstance(payload, Mapping):
        raise ValueError(f"{label} must contain an object: {path.name}")
    return payload


def _atomic_write_text(destination: Path, content: str) -> None:
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, destination)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
