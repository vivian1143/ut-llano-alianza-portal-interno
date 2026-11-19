package com.utllanoalianza.portal;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Puente entre el portal y Camunda.
 * El navegador llama a /engine-rest/... en el portal (puerto 8081)
 * y este controlador reenvía la petición a la API REST de Camunda (puerto 8080).
 */
@RestController
public class CamundaRestController {

    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .build();

    @Value("${camunda.rest-url:http://localhost:8080/engine-rest}")
    private String camundaRestUrl;

    @RequestMapping("/engine-rest/**")
    public ResponseEntity<byte[]> reenviar(HttpServletRequest peticion,
                                           @RequestBody(required = false) byte[] cuerpo) throws Exception {
        String ruta = peticion.getRequestURI().substring(peticion.getContextPath().length() + "/engine-rest".length());
        String consulta = peticion.getQueryString();
        URI destino = URI.create(camundaRestUrl + ruta + (consulta != null ? "?" + consulta : ""));

        HttpRequest.BodyPublisher datos = (cuerpo == null || cuerpo.length == 0)
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofByteArray(cuerpo);
        HttpRequest.Builder llamada = HttpRequest.newBuilder(destino).method(peticion.getMethod(), datos);
        if (peticion.getContentType() != null) {
            llamada.header("Content-Type", peticion.getContentType());
        }
        llamada.header("Accept", peticion.getHeader("Accept") != null ? peticion.getHeader("Accept") : "*/*");

        HttpResponse<byte[]> respuesta = http.send(llamada.build(), HttpResponse.BodyHandlers.ofByteArray());

        HttpHeaders encabezados = new HttpHeaders();
        respuesta.headers().firstValue("Content-Type").ifPresent(tipo -> encabezados.set("Content-Type", tipo));
        return new ResponseEntity<>(respuesta.body(), encabezados, HttpStatusCode.valueOf(respuesta.statusCode()));
    }
}
