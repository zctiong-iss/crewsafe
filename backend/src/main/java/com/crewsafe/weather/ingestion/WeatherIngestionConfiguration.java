package com.crewsafe.weather.ingestion;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.time.Clock;

/** Shared runtime infrastructure for deterministic freshness and scheduled ingestion. */
@Configuration
@EnableScheduling
public class WeatherIngestionConfiguration {

    @Bean
    Clock systemClock() {
        return Clock.systemUTC();
    }
}
