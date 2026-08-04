package com.crewsafe.conditions.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * Shared scheduler for the site conditions SSE stream. A handful of threads, not the
 * single-threaded default, so a burst of open dashboard tabs doesn't queue up behind it.
 */
@Configuration
public class ConditionsStreamConfiguration {

    @Bean
    TaskScheduler conditionsTaskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(4);
        scheduler.setThreadNamePrefix("conditions-stream-");
        return scheduler;
    }
}
