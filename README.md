# UT-llano-Alianza Portal interno
Proyecto de Curso de Profundización Software 1

Es la aplicación para los usuarios de la empresa (puerto 8081). Es aparte de Camunda y se comunica con él solo por su API REST.
Cada actor entra con su usuario, ve solo sus actividades pendientes y completa sus formularios.
La guía general del proyecto está en el repo ut-llano-alianza-hub.

**Responsable:** Laura Vanessa Hernandez Garcia

## Integrantes
- Laura Vanessa Hernandez Garcia 160004630
- Vivian Andrea Prado Zuleta 160004632
- Daniel Felipe Espinosa Alvarez 160004707

# Qué hace
- Se entra con los usuarios de Camunda
- Muestra las actividades pendientes del rol y se actualiza sola cada 10 segundos
- trabajador inicia Accidente, coordinador inicia Asistencia y legal inicia Propuesta (con su formulario de inicio)
- Los formularios son los mismos de Camunda Forms, con campos obligatorios, campos que aparecen según lo que se marque y datos de tareas anteriores que solo se pueden leer
- Abajo de cada formulario salen los datos guardados del caso en el servicio de registros (radicados, concepto de la ARL, novedades, valor de la propuesta)
- El usuario demo es el administrador, ve los procesos en curso y es el único que los puede cancelar

**Usuarios** (la contraseña es igual al usuario)
- Accidente: trabajador, supervisor, sst, investigador, nomina
- Asistencia: coordinador, supervisor, gestionHumana, nomina, facturacion
- Propuesta: legal, proyectos, financiera, gerencia
- Administrador: demo

# Archivos
- CamundaRestController.java: pasa lo que llega a /engine-rest a la API de Camunda
- RegistrosRestController.java: pasa lo que llega a /registros-api al servicio de registros
- static/index.html, app.js y styles.css: la página

# Cambios para la entrega final
- El portal pasó a este repo, antes era la carpeta portal-web del motor
- Se agregó RegistrosRestController y la parte de "Datos guardados del caso" en cada tarea

---

# Cómo ejecutar
Antes tienen que estar prendidos Camunda (8080) y el servicio de registros (8082)

1. En IntelliJ abrir src/main/java/com/utllanoalianza/portal/PortalApplication.java, dar click derecho y Run 'PortalApplication'. Esperar a que diga que arrancó en el puerto 8081
2. Entrar a http://localhost:8081 con el usuario de cada rol

Si Camunda o el servicio de registros están en otra dirección se cambia en src/main/resources/application.yaml o con las variables PUERTO, CAMUNDA_URL y REGISTROS_URL
