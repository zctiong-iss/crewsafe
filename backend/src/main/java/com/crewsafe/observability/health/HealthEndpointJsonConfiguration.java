package com.crewsafe.observability.health;

import com.fasterxml.jackson.annotation.JsonIgnore;
import org.springframework.boot.actuate.endpoint.jackson.EndpointObjectMapper;
import org.springframework.boot.actuate.health.SystemHealth;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Keeps Actuator health responses limited to the approved generic status field. */
@Configuration(proxyBeanMethods = false)
public class HealthEndpointJsonConfiguration {

    @Bean
    static BeanPostProcessor healthEndpointObjectMapperCustomizer() {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) {
                if (bean instanceof EndpointObjectMapper endpointObjectMapper) {
                    endpointObjectMapper.get().addMixIn(SystemHealth.class,
                            StatusOnlySystemHealthMixin.class);
                }
                return bean;
            }
        };
    }

    private abstract static class StatusOnlySystemHealthMixin {

        @JsonIgnore
        abstract java.util.Set<String> getGroups();
    }
}
