// Portal interno de UT Llano Alianza (aplicación aparte, puerto 8081).
// La página llama a /engine-rest en el portal y el portal (CamundaRestController)
// reenvía cada petición a la API REST de Camunda, en el puerto 8080.
// Los datos guardados del caso se consultan en /registros-api (RegistrosRestController -> puerto 8082).
const API = "/engine-rest";

// Qué grupo puede iniciar cada proceso (conFormulario: tiene formulario de inicio)
const INICIOS = [
  { grupo: "trabajador", clave: "procesoAccidenteTrabajo", texto: "Reportar un accidente o incidente" },
  { grupo: "coordinador", clave: "procesoAsistenciaPersonal", texto: "Programar la asistencia del mes" },
  { grupo: "legal", clave: "procesoElaborarPropuesta", texto: "Elaborar una nueva propuesta", conFormulario: true }
];

let sesion = null;          // { id, nombre, grupos: [] }
let nombresProcesos = {};   // id de la definición -> nombre del proceso
let formularioActual = null; // { tipo: "tarea" | "inicio", id, componentes, valores }
let temporizador = null;
let tareaActual = null;     // tarea abierta (para poder cancelar su proceso)

// Solo el administrador puede cancelar procesos
const esAdmin = () => sesion && (sesion.id === "demo" || sesion.grupos.includes("camunda-admin"));

const $ = (id) => document.getElementById(id);

// ---------- llamadas REST ----------
async function rest(ruta, opciones = {}) {
  const resp = await fetch(API + ruta, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...(opciones.headers || {}) }
  });
  if (!resp.ok) {
    let mensaje = "Error " + resp.status;
    try { mensaje = (await resp.json()).message || mensaje; } catch (e) { /* sin cuerpo */ }
    const error = new Error(mensaje);
    error.status = resp.status;
    throw error;
  }
  if (resp.status === 204) return null;
  const texto = await resp.text();
  return texto ? JSON.parse(texto) : null;
}

// ---------- sesión ----------
async function entrar(usuario, clave) {
  const r = await rest("/identity/verify", {
    method: "POST",
    body: JSON.stringify({ username: usuario, password: clave })
  });
  if (!r.authenticated) throw new Error("Usuario o contraseña incorrectos");
  const perfil = await rest("/user/" + encodeURIComponent(usuario) + "/profile");
  const grupos = await rest("/group?member=" + encodeURIComponent(usuario));
  sesion = {
    id: usuario,
    nombre: perfil.firstName || usuario,
    grupos: grupos.map((g) => g.id)
  };
  sessionStorage.setItem("sesion", JSON.stringify(sesion));
}

function salir() {
  sesion = null;
  sessionStorage.removeItem("sesion");
  clearInterval(temporizador);
  mostrarLogin();
}

function mostrarLogin() {
  $("vista-app").hidden = true;
  $("vista-login").hidden = false;
  $("form-login").reset();
}

async function mostrarApp() {
  $("vista-login").hidden = true;
  $("vista-app").hidden = false;
  $("nombre-usuario").textContent = sesion.nombre + " (" + sesion.id + ")";
  await cargarNombresProcesos();
  pintarInicios();
  await mostrarPendientes();
  clearInterval(temporizador);
  temporizador = setInterval(() => {
    if (!$("vista-pendientes").hidden) { cargarPendientes(); cargarProcesosEnCurso(); }
  }, 10000);
}

// ---------- actividades pendientes ----------
async function cargarNombresProcesos() {
  const definiciones = await rest("/process-definition");
  nombresProcesos = {};
  definiciones.forEach((d) => { nombresProcesos[d.id] = d.name || d.key; });
}

function pintarInicios() {
  const zona = $("zona-iniciar");
  zona.innerHTML = "";
  const mios = INICIOS.filter((i) => sesion.grupos.includes(i.grupo));
  if (mios.length === 0) return;
  const caja = document.createElement("div");
  caja.className = "iniciar";
  caja.innerHTML = "<p><strong>Iniciar un proceso</strong></p>";
  mios.forEach((inicio) => {
    const boton = document.createElement("button");
    boton.textContent = inicio.texto;
    boton.addEventListener("click", () => iniciarProceso(inicio));
    caja.appendChild(boton);
  });
  zona.appendChild(caja);
}

async function mostrarPendientes(mensaje, esError) {
  $("vista-tarea").hidden = true;
  $("vista-pendientes").hidden = false;
  avisar(mensaje, esError);
  await cargarPendientes();
  await cargarProcesosEnCurso();
}

// ---------- administrador: procesos en curso ----------
async function cargarProcesosEnCurso() {
  const zona = $("zona-admin");
  zona.hidden = !esAdmin();
  if (!esAdmin()) return;
  const lista = $("lista-procesos");
  const principales = INICIOS.map((i) => i.clave);
  try {
    const instancias = await rest("/history/process-instance?unfinished=true&sortBy=startTime&sortOrder=desc");
    // Solo los procesos principales; los subprocesos se cancelan junto con su proceso
    const enCurso = instancias.filter((p) => !p.superProcessInstanceId && principales.includes(p.processDefinitionKey));
    $("contador-admin").textContent = enCurso.length;
    lista.innerHTML = "";
    if (enCurso.length === 0) {
      lista.innerHTML = '<p class="vacio">No hay procesos en curso.</p>';
      return;
    }
    enCurso.forEach((p) => {
      const fila = document.createElement("div");
      fila.className = "pendiente";
      const info = document.createElement("div");
      const titulo = document.createElement("h3");
      titulo.textContent = p.processDefinitionName || p.processDefinitionKey;
      const detalle = document.createElement("p");
      detalle.className = "detalle";
      detalle.textContent = "Iniciado " + formatoFecha(p.startTime) + " · ID " + p.id.slice(0, 8);
      info.append(titulo, detalle);
      const boton = document.createElement("button");
      boton.className = "btn-peligro";
      boton.textContent = "Cancelar";
      boton.addEventListener("click", () => cancelarProceso(p.id, titulo.textContent));
      fila.append(info, boton);
      lista.appendChild(fila);
    });
  } catch (e) {
    lista.innerHTML = '<p class="vacio">No se pudieron cargar los procesos: ' + escapar(e.message) + "</p>";
  }
}

// Si la tarea es de un subproceso, sube hasta el proceso principal
async function procesoPrincipal(idInstancia) {
  let id = idInstancia;
  for (let i = 0; i < 5; i++) {
    const p = await rest("/history/process-instance/" + id);
    if (!p.superProcessInstanceId) return { id: p.id, nombre: p.processDefinitionName || p.processDefinitionKey };
    id = p.superProcessInstanceId;
  }
  return { id, nombre: "el proceso" };
}

async function cancelarProceso(idInstancia, nombre) {
  if (!esAdmin()) return;
  if (!confirm("¿Seguro que quieres cancelar " + nombre + "? Se borrarán todas sus tareas pendientes.")) return;
  try {
    await rest("/process-instance/" + idInstancia, { method: "DELETE" });
    await mostrarPendientes("Proceso cancelado: " + nombre + ".");
  } catch (e) {
    await mostrarPendientes("No se pudo cancelar el proceso: " + e.message, true);
  }
}

async function cancelarProcesoDeTarea() {
  if (!tareaActual) return;
  try {
    const principal = await procesoPrincipal(tareaActual.processInstanceId);
    await cancelarProceso(principal.id, principal.nombre);
  } catch (e) {
    avisar("No se pudo cancelar el proceso: " + e.message, true);
  }
}

async function cargarPendientes() {
  const lista = $("lista-pendientes");
  try {
    let tareas = [];
    if (sesion.grupos.length > 0) {
      tareas = await rest("/task?candidateGroups=" + encodeURIComponent(sesion.grupos.join(","))
        + "&sortBy=created&sortOrder=desc");
    }
    $("contador").textContent = tareas.length;
    lista.innerHTML = "";
    if (tareas.length === 0) {
      lista.innerHTML = '<p class="vacio">No tienes actividades pendientes.</p>';
      return;
    }
    tareas.forEach((t) => {
      const fila = document.createElement("div");
      fila.className = "pendiente";
      const info = document.createElement("div");
      const titulo = document.createElement("h3");
      titulo.textContent = t.name;
      const detalle = document.createElement("p");
      detalle.className = "detalle";
      detalle.textContent = (nombresProcesos[t.processDefinitionId] || "Proceso")
        + " · creada " + formatoFecha(t.created);
      info.append(titulo, detalle);
      const boton = document.createElement("button");
      boton.textContent = "Abrir";
      boton.addEventListener("click", () => abrirTarea(t));
      fila.append(info, boton);
      lista.appendChild(fila);
    });
  } catch (e) {
    lista.innerHTML = '<p class="vacio">No se pudieron cargar las tareas: ' + escapar(e.message) + "</p>";
  }
}

// ---------- abrir tarea o inicio ----------
async function abrirTarea(tarea) {
  try {
    const [formulario, variables] = await Promise.all([
      rest("/task/" + tarea.id + "/deployed-form"),
      rest("/task/" + tarea.id + "/variables")
    ]);
    const valores = {};
    Object.entries(variables || {}).forEach(([k, v]) => { valores[k] = v.value; });
    formularioActual = { tipo: "tarea", id: tarea.id, componentes: formulario.components, valores };
    tareaActual = tarea;
    $("tarea-proceso").textContent = nombresProcesos[tarea.processDefinitionId] || "";
    pintarFormulario(formulario.components, valores, "Completar tarea");
    mostrarRegistros(tarea.processInstanceId);
  } catch (e) {
    await mostrarPendientes("No se pudo abrir la tarea: " + e.message, true);
  }
}

async function iniciarProceso(inicio) {
  let formulario = null;
  if (inicio.conFormulario) {
    try {
      formulario = await rest("/process-definition/key/" + inicio.clave + "/deployed-start-form");
    } catch (e) {
      await mostrarPendientes("No se pudo cargar el formulario de inicio: " + e.message, true);
      return;
    }
  }
  if (!formulario) {
    try {
      await rest("/process-definition/key/" + inicio.clave + "/start", {
        method: "POST", body: JSON.stringify({ variables: {} })
      });
      await mostrarPendientes("Proceso iniciado: " + inicio.texto.toLowerCase() + ".");
    } catch (e) {
      await mostrarPendientes("No se pudo iniciar el proceso: " + e.message, true);
    }
    return;
  }
  formularioActual = { tipo: "inicio", id: inicio.clave, componentes: formulario.components, valores: {} };
  tareaActual = null;
  $("tarea-proceso").textContent = "Nuevo proceso";
  $("zona-registros").hidden = true;
  pintarFormulario(formulario.components, {}, "Iniciar proceso");
}

// ---------- datos guardados en el servicio de registros ----------
async function mostrarRegistros(idInstancia) {
  const zona = $("zona-registros");
  const caja = $("datos-registros");
  zona.hidden = false;
  caja.innerHTML = '<p class="ayuda">Cargando...</p>';
  try {
    const principal = await procesoPrincipal(idInstancia);
    const resp = await fetch("/registros-api/instancias/" + encodeURIComponent(principal.id));
    const datos = await resp.json();
    if (!resp.ok) throw new Error(datos.error || "Error " + resp.status);
    const lineas = lineasRegistros(datos);
    caja.innerHTML = lineas.length
      ? "<ul>" + lineas.map((l) => "<li>" + escapar(l) + "</li>").join("") + "</ul>"
      : '<p class="ayuda">Todavía no hay datos guardados para este caso.</p>';
  } catch (e) {
    caja.innerHTML = '<p class="ayuda">No se pudieron consultar los registros: ' + escapar(e.message) + "</p>";
  }
}

function lineasRegistros(d) {
  const lineas = [];
  const pesos = (n) => "$" + Math.round(Number(n)).toLocaleString("es-CO");
  if (d.accidente) {
    const a = d.accidente;
    lineas.push("Accidente " + a.id + " · estado " + a.estado + " · " + a.nombreTrabajador + " · sede " + a.sede);
    a.reportes.forEach((r) => lineas.push("Reporte a " + (r.entidad === "ARL_EPS" ? "ARL y EPS" : "Ministerio del Trabajo")
      + ": radicado " + r.radicado));
    if (a.conceptoArl) lineas.push("Concepto de " + a.conceptoArl.nombreArl + ": " + a.conceptoArl.calificacion);
    if (a.matrizRiesgo) lineas.push("Matriz de riesgos: riesgo " + a.matrizRiesgo.nivelRiesgo
      + " · próxima inspección " + a.matrizRiesgo.proximaInspeccion);
  }
  if (d.novedades && d.novedades.length) {
    lineas.push("Novedades guardadas: " + d.novedades.length);
    d.novedades.forEach((n) => lineas.push("   " + n.fecha + " · " + n.trabajador + " · " + n.tipo + " · " + n.horas + " h"));
  }
  if (d.prefactura) lineas.push("Prefactura " + d.prefactura.id + " cerrada: " + d.prefactura.totalNovedades
    + " novedades, " + d.prefactura.totalHoras + " h");
  if (d.propuesta) lineas.push("Propuesta " + d.propuesta.id + " (" + d.propuesta.numeroProceso + ") · estado "
    + d.propuesta.estado + " · valor " + pesos(d.propuesta.valorPropuesta));
  return lineas;
}

// ---------- formulario ----------
function pintarFormulario(componentes, valores, textoBoton) {
  avisar();
  const form = $("form-tarea");
  form.innerHTML = "";
  componentes.forEach((c) => {
    if (c.type === "text") {
      const titulo = document.createElement("h2");
      titulo.textContent = (c.text || "").replace(/^#+\s*/, "");
      form.appendChild(titulo);
      return;
    }
    form.appendChild(crearCampo(c, valores));
  });
  const boton = document.createElement("button");
  boton.type = "submit";
  boton.textContent = textoBoton;
  form.appendChild(boton);
  actualizarCondiciones();
  $("zona-cancelar-tarea").hidden = !(esAdmin() && tareaActual);
  $("vista-pendientes").hidden = true;
  $("vista-tarea").hidden = false;
  window.scrollTo(0, 0);
}

function crearCampo(c, valores) {
  const caja = document.createElement("div");
  caja.className = "campo" + (c.type === "checkbox" ? " campo-check" : "");
  caja.dataset.clave = c.key;
  const textoEtiqueta = c.label || c.dateLabel || c.key;
  const requerido = c.validate && c.validate.required;
  const valor = valores[c.key] !== undefined && valores[c.key] !== null ? valores[c.key] : c.defaultValue;

  // Datos de tareas anteriores: solo se muestran
  if (c.readonly) {
    const etiqueta = document.createElement("label");
    etiqueta.textContent = textoEtiqueta;
    const dato = document.createElement("div");
    dato.className = "solo-lectura";
    dato.textContent = valor === undefined || valor === null || valor === "" ? "—" : mostrarValor(valor);
    caja.append(etiqueta, dato);
    return caja;
  }

  let entrada;
  const id = "campo-" + c.key;
  if (c.type === "checkbox") {
    const etiqueta = document.createElement("label");
    entrada = document.createElement("input");
    entrada.type = "checkbox";
    entrada.id = id;
    entrada.checked = valor === true;
    etiqueta.append(entrada, document.createTextNode(" " + textoEtiqueta));
    if (requerido) etiqueta.insertAdjacentHTML("beforeend", ' <span class="obligatorio">*</span>');
    caja.appendChild(etiqueta);
  } else {
    const etiqueta = document.createElement("label");
    etiqueta.htmlFor = id;
    etiqueta.textContent = textoEtiqueta;
    if (requerido) etiqueta.insertAdjacentHTML("beforeend", ' <span class="obligatorio">*</span>');
    if (c.type === "textarea") {
      entrada = document.createElement("textarea");
    } else if (c.type === "select") {
      entrada = document.createElement("select");
      entrada.innerHTML = '<option value="">Selecciona una opción</option>';
      (c.values || []).forEach((op) => {
        const opcion = document.createElement("option");
        opcion.value = op.value;
        opcion.textContent = op.label;
        entrada.appendChild(opcion);
      });
    } else {
      entrada = document.createElement("input");
      if (c.type === "number") { entrada.type = "number"; entrada.step = "any"; }
      else if (c.type === "datetime") entrada.type = "date";
      else entrada.type = "text";
    }
    entrada.id = id;
    if (valor !== undefined && valor !== null) entrada.value = valor;
    caja.append(etiqueta, entrada);
  }
  entrada.dataset.tipo = c.type;
  entrada.addEventListener("input", actualizarCondiciones);
  entrada.addEventListener("change", actualizarCondiciones);

  if (c.description) {
    const ayuda = document.createElement("div");
    ayuda.className = "descripcion";
    ayuda.textContent = c.description;
    caja.appendChild(ayuda);
  }
  return caja;
}

// Lee los valores que el usuario escribió (solo campos visibles y editables)
function leerValores() {
  const valores = {};
  formularioActual.componentes.forEach((c) => {
    if (c.type === "text" || c.readonly) return;
    const entrada = $("campo-" + c.key);
    if (!entrada || entrada.closest(".campo").hidden) return;
    if (c.type === "checkbox") valores[c.key] = entrada.checked;
    else if (c.type === "number") valores[c.key] = entrada.value === "" ? null : Number(entrada.value);
    else valores[c.key] = entrada.value;
  });
  return valores;
}

// Condiciones "ocultar si..." de los formularios (=campo != true, =campo = true)
function seOculta(expresion, valores) {
  if (!expresion) return false;
  let m = expresion.match(/^=\s*(\w+)\s*!=\s*true\s*$/);
  if (m) return valorActual(m[1], valores) !== true;
  m = expresion.match(/^=\s*(\w+)\s*=\s*true\s*$/);
  if (m) return valorActual(m[1], valores) === true;
  return false;
}

function valorActual(clave, valoresEscritos) {
  if (clave in valoresEscritos) return valoresEscritos[clave];
  return formularioActual.valores[clave];
}

function actualizarCondiciones() {
  const escritos = {};
  formularioActual.componentes.forEach((c) => {
    const entrada = $("campo-" + c.key);
    if (entrada && c.type === "checkbox") escritos[c.key] = entrada.checked;
  });
  formularioActual.componentes.forEach((c) => {
    if (c.type === "text") return;
    const caja = document.querySelector('.campo[data-clave="' + c.key + '"]');
    if (caja) caja.hidden = seOculta(c.conditional && c.conditional.hide, escritos);
  });
}

function validar(valores) {
  let ok = true;
  document.querySelectorAll(".campo .error").forEach((e) => e.remove());
  document.querySelectorAll(".campo.con-error").forEach((e) => e.classList.remove("con-error"));
  formularioActual.componentes.forEach((c) => {
    if (c.type === "text" || c.readonly || !(c.validate && c.validate.required)) return;
    if (!(c.key in valores)) return; // está oculto
    const v = valores[c.key];
    const vacio = c.type === "checkbox" ? v !== true : (v === null || v === "" || Number.isNaN(v));
    if (vacio) {
      ok = false;
      const caja = document.querySelector('.campo[data-clave="' + c.key + '"]');
      caja.classList.add("con-error");
      caja.insertAdjacentHTML("beforeend", '<p class="error">' +
        (c.type === "checkbox" ? "Debes marcar esta casilla." : "Este campo es obligatorio.") + "</p>");
    }
  });
  return ok;
}

// Convierte los valores al formato de variables de Camunda
function aVariables(valores) {
  const variables = {};
  Object.entries(valores).forEach(([k, v]) => {
    if (v === null) return;
    let tipo = "String";
    if (typeof v === "boolean") tipo = "Boolean";
    else if (typeof v === "number") tipo = Number.isInteger(v) ? "Long" : "Double";
    variables[k] = { value: v, type: tipo };
  });
  return variables;
}

async function enviarFormulario(evento) {
  evento.preventDefault();
  const valores = leerValores();
  if (!validar(valores)) return;
  const boton = $("form-tarea").querySelector("button[type=submit]");
  boton.disabled = true;
  const cuerpo = JSON.stringify({ variables: aVariables(valores) });
  try {
    if (formularioActual.tipo === "tarea") {
      await rest("/task/" + formularioActual.id + "/complete", { method: "POST", body: cuerpo });
      await mostrarPendientes("Tarea completada.");
    } else {
      await rest("/process-definition/key/" + formularioActual.id + "/start", { method: "POST", body: cuerpo });
      await mostrarPendientes("Proceso iniciado.");
    }
  } catch (e) {
    boton.disabled = false;
    avisar("No se pudo enviar: " + e.message, true);
  }
}

// ---------- utilidades ----------
function avisar(mensaje, esError) {
  const aviso = $("aviso");
  aviso.hidden = !mensaje;
  aviso.textContent = mensaje || "";
  aviso.className = "aviso" + (esError ? " mal" : "");
}

function formatoFecha(texto) {
  if (!texto) return "";
  const f = new Date(texto);
  return isNaN(f) ? texto : f.toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
}

function mostrarValor(v) {
  if (v === true) return "Sí";
  if (v === false) return "No";
  return String(v);
}

function escapar(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}

// ---------- eventos ----------
$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("error-login").hidden = true;
  try {
    await entrar($("usuario").value.trim(), $("clave").value);
    await mostrarApp();
  } catch (err) {
    $("error-login").textContent = err instanceof TypeError
      ? "No se pudo conectar con Camunda. ¿Está corriendo la aplicación?"
      : err.message;
    $("error-login").hidden = false;
  }
});
$("btn-salir").addEventListener("click", salir);
$("btn-actualizar").addEventListener("click", () => cargarPendientes());
$("btn-volver").addEventListener("click", () => mostrarPendientes());
$("form-tarea").addEventListener("submit", enviarFormulario);
$("btn-cancelar-tarea").addEventListener("click", cancelarProcesoDeTarea);

// Si ya había sesión abierta en esta pestaña, se mantiene
const guardada = sessionStorage.getItem("sesion");
if (guardada) {
  sesion = JSON.parse(guardada);
  mostrarApp();
}
