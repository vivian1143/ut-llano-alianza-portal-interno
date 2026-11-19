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
 * Puente entre el portal y el servicio de registros (base de datos del negocio).
 * El navegador llama a /registros-api/... en el portal (puerto 8081)
 * y este controlador reenvía la petición a http://localhost:8082/api/...
 */
@RestController
public class RegistrosRestController {

    private final HttpClient http = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .build();

    @Value("${registros.url:http://localhost:8082/api}")
    private String registrosUrl;

    @RequestMapping("/registros-api/**")
    public ResponseEntity<byte[]> reenviar(HttpServletRequest peticion,
                                           @RequestBody(required = false) byte[] cuerpo) throws Exception {
        String ruta = peticion.getRequestURI().substring(peticion.getContextPath().length() + "/registros-api".length());
        String consulta = peticion.getQueryString();
        URI destino = URI.create(registrosUrl + ruta + (consulta != null ? "?" + consulta : ""));

        HttpRequest.BodyPublisher datos = (cuerpo == null || cuerpo.length == 0)
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofByteArray(cuerpo);
        HttpRequest.Builder llamada = HttpRequest.newBuilder(destino).method(peticion.getMethod(), datos);
        if (peticion.getContentType() != null) {
            llamada.header("Content-Type", peticion.getContentType());
        }
        llamada.header("Accept", "application/json");

        HttpResponse<byte[]> respuesta;
        try {
            respuesta = http.send(llamada.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (java.io.IOException e) {
            HttpHeaders json = new HttpHeaders();
            json.set("Content-Type", "application/json");
            return new ResponseEntity<>("{\"error\":\"El servicio de registros no está encendido\"}".getBytes(),
                    json, HttpStatusCode.valueOf(503));
        }

        HttpHeaders encabezados = new HttpHeaders();
        respuesta.headers().firstValue("Content-Type").ifPresent(tipo -> encabezados.set("Content-Type", tipo));
        return new ResponseEntity<>(respuesta.body(), encabezados, HttpStatusCode.valueOf(respuesta.statusCode()));
    }
}
