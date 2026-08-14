"""Command-line entry point for historical CrewSafe weather acquisition."""

from __future__ import annotations

import argparse
import os
from datetime import date
from pathlib import Path
from typing import Sequence

from .data_gov_sg import (
    DEFAULT_MAX_PAGES_PER_DAY,
    HistoricalWeatherClient,
    WeatherMetric,
)
from .dataset_io import build_historical_dataset


DEFAULT_METRICS = tuple(WeatherMetric)


def main(arguments: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    options = parser.parse_args(arguments)
    start_date = date.fromisoformat(options.start_date)
    end_date = date.fromisoformat(options.end_date)
    metrics = tuple(_parse_metric(metric) for metric in options.metrics)

    client = HistoricalWeatherClient(
        api_key=os.getenv("NEA_API_KEY"),
        timeout_seconds=options.timeout_seconds,
        minimum_request_interval_seconds=options.request_interval_seconds,
        max_pages_per_day=options.max_pages_per_day,
    )
    result = build_historical_dataset(
        client,
        start_date=start_date,
        end_date=end_date,
        output_directory=Path(options.output_directory),
        metrics=metrics,
    )
    print(f"Rows: {result.row_count}")
    print(
        "Readings using earlier-page station metadata: "
        f"{result.reused_station_metadata_reading_count}"
    )
    print(f"Reused raw pages: {result.reused_raw_page_count}")
    print(f"Downloaded raw pages: {result.downloaded_raw_page_count}")
    print(f"CSV: {result.normalized_csv}")
    if result.prepared_15_minute_csv:
        print(f"15-minute features: {result.prepared_15_minute_csv}")
    print(f"Station inventory: {result.station_inventory_csv}")
    print(f"Station metadata corrections: {result.station_metadata_corrections_csv}")
    print(f"Missing periods: {result.missing_periods_csv}")
    print(f"Manifest: {result.manifest_json}")
    print(f"SHA-256: {result.sha256}")
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download and normalize historical data.gov.sg weather observations."
    )
    parser.add_argument("--start-date", required=True, help="First SGT date (YYYY-MM-DD)")
    parser.add_argument("--end-date", required=True, help="Last SGT date (YYYY-MM-DD)")
    parser.add_argument(
        "--output-directory",
        default="data/historical",
        help="Ignored local directory for raw pages, normalized CSV, and manifest",
    )
    parser.add_argument(
        "--metrics",
        nargs="+",
        default=[metric.slug for metric in DEFAULT_METRICS],
        help="Allowlisted metrics: " + ", ".join(metric.slug for metric in DEFAULT_METRICS),
    )
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    parser.add_argument(
        "--max-pages-per-day",
        type=int,
        default=DEFAULT_MAX_PAGES_PER_DAY,
        help="Safety limit for one metric and day (default: 100)",
    )
    parser.add_argument(
        "--request-interval-seconds",
        type=float,
        default=1.8,
        help="Minimum delay between calls; reduce only when using an approved API-key tier",
    )
    return parser


def _parse_metric(value: str) -> WeatherMetric:
    for metric in WeatherMetric:
        if metric.slug == value:
            return metric
    allowed = ", ".join(metric.slug for metric in WeatherMetric)
    raise argparse.ArgumentTypeError(f"unsupported metric {value!r}; choose from {allowed}")


if __name__ == "__main__":
    raise SystemExit(main())
