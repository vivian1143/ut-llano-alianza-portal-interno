package com.utllanoalianza.portal;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Portal web de UT Llano Alianza.
 * Es una aplicación independiente del motor: corre en el puerto 8081
 * y se comunica con Camunda (puerto 8080) solo por su API REST.
 */
@SpringBootApplication
public class PortalApplication {

    public static void main(String[] args) {
        SpringApplication.run(PortalApplication.class, args);
    }
}
