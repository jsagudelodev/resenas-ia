# V5 — Automatizar el cuello de botella manual

> Sigue la numeración `RS.*` de `ENCARGO.md` por continuidad (arranca en
> RS.24, después de que V1-V4 cerraran 24/24), pero **vive fuera de ese
> documento a propósito**: `ENCARGO.md` gobierna el trabajo de Argos bajo su
> propio protocolo (un ítem por tanda, docs de solo lectura); esta tanda la
> trabaja una sesión de Claude Code distinta, sin ese harness, a pedido
> explícito del usuario. No se edita `ENCARGO.md` para no mezclar los dos
> registros.
>
> **Por qué esta fase existe.** `docs/la-venta.md` deja dicho que la entrada
> manual (copiar/pegar reseñas) "para diez clientes va bien, para cien no
> existe". El objetivo de V5 es quitar esa fricción para poder atender varios
> negocios sin que cada corrida sea una tarea manual por cliente — no
> construir paneles ni suscripciones (eso sigue fuera de alcance, ver
> `la-venta.md` §2).

---

- ✅ **RS.24 — El importador de reseñas: se acabó el copiar y pegar.**
  Un `TransporteImportacion` inyectable (mismo patrón que `RedactorReal` para
  el LLM) trae las reseñas de un negocio desde un proveedor de scraping de
  pago — no la API oficial de Google (solo da 5 reseñas) ni scraping directo
  a Google Maps (arriesga al cliente justo cuando el objetivo es tener más
  clientes visibles).
  *Cierre:* (1) dedup por `idExterno` entre corridas — reenviar el mismo
  negocio no reimporta ni recobra lo ya traído; (2) una reseña sin estrellas
  o sin fecha entra igual, marcada como incompleta, mismo criterio que RS.1;
  (3) un fallo del transporte (red, cuota, credencial) no tumba nada: se
  convierte en `ImportadorError` con motivo comprensible; (4) lo importado
  sobrevive a reiniciar el proceso (`AlmacenImportacionSqlite`).
  → `src/importadorReseñas.ts`, `test/importadorReseñas.test.ts`, exportado
  desde `src/indice.ts`.

- ✅ **RS.25 — El endpoint que conecta un negocio con su paquete.**
  `POST /lotes/importar` recibe `{ placeId, ficha }`, importa solo las
  reseñas nuevas de ese negocio y corre el mismo pipeline que `POST /lotes`
  (RS.14): revisión, gravedad, idioma, empaquetado.
  *Cierre:* (1) sin reseñas nuevas responde 200 sin crear paquete (no es un
  error: "no hay nada nuevo que revisar"); (2) sin importador configurado
  responde 501 con motivo, el servidor sigue funcionando para `POST /lotes`;
  (3) un fallo del proveedor (`ImportadorError`) responde 502 con motivo
  comprensible, sin filtrar la clave, y el servicio no cae.
  → `src/servicio.ts`.

- ✅ **RS.26 — Traer lo nuevo sola, sin que nadie la dispare.**
  Un `ProgramadorImportacion` recorre los negocios registrados a un
  intervalo fijo y, si alguno trae reseñas nuevas, corre el mismo pipeline
  que RS.25 (vía un callback inyectado — el programador no sabe qué es
  "procesar un lote"). Se enchufa en `crearServidor` con
  `opciones.programadorImportacion` y queda expuesto en
  `ServidorLevantado.programador` para registrar o quitar negocios en
  caliente.
  *Cierre:* (1) `registrarNegocio`/`quitarNegocio`/`listarNegocios` — alta,
  baja y consulta de negocios mientras el proceso corre; (2) un negocio que
  falla (proveedor caído o el callback lanza) no cancela el ciclo para los
  demás; (3) `iniciar` es idempotente, `detener` cancela de verdad (un
  disparo posterior no hace nada) y `crearServidor`/`cerrar()` lo arrancan y
  lo detienen automáticamente.
  → `src/programadorImportacion.ts`, `test/programadorImportacion.test.ts`,
  `test/servicioProgramador.test.ts`, exportado desde `src/indice.ts`.
  **Deliberadamente fuera:** el catálogo persistente de negocios (RS.27) y el
  aviso al dueño (RS.28) — el hueco para este último es el parámetro
  `alTerminarCiclo`.

- ✅ **RS.27 — El catálogo de negocios sobrevive a reiniciar el proceso.**
  `CatalogoNegocios` (en memoria y SQLite, mismo patrón que el resto del
  proyecto) persiste el `placeId → ficha` que antes solo vivía en el `Map`
  de `ProgramadorImportacion`. `registrarNegocio`/`quitarNegocio` ahora
  escriben a través del catálogo si hay uno, y `cargarDesdeCatalogo()`
  recupera lo guardado al arrancar.
  *Cierre:* (1) `registrar`/`quitar`/`listar` sobre el catálogo, aislado del
  programador; (2) registrar dos veces el mismo `placeId` actualiza la ficha
  (upsert), no duplica; (3) **lo guardado sobrevive a reiniciar el
  proceso** — un `ProgramadorImportacion` nuevo, sin que nadie le pase
  `negocios` por opciones, recupera el negocio con solo apuntar al mismo
  archivo SQLite y llamar `cargarDesdeCatalogo()`; demostrado también a
  nivel de `crearServidor` (cerrar el servidor, levantar uno nuevo sobre el
  mismo catálogo, el negocio sigue ahí).
  → `src/catalogoNegocios.ts`, `test/catalogoNegocios.test.ts`, exportado
  desde `src/indice.ts`. **No rompe RS.26:** sin catálogo configurado, el
  programador sigue funcionando solo en memoria, como antes.

- ✅ **RS.28 — Avisar cuando el paquete está listo.**
  Un `Notificador` (webhook genérico, configurable por `NOTIFICADOR_URL` /
  `NOTIFICADOR_API_KEY` — no acoplado a WhatsApp/Twilio/Zapier en particular)
  se enchufa en `programadorImportacion.notificador`; tras cada ciclo
  automático, por cada negocio que produjo un paquete nuevo se genera un
  enlace real (RS.18, vía `almacen.generarEnlace`) y se avisa con nombre del
  negocio, conteos y el enlace.
  *Cierre:* (1) el aviso llega con los datos correctos y el enlace avisado
  sirve de verdad para descargar el paquete; (2) sin `notificador`
  configurado, el ciclo automático sigue funcionando igual que en RS.26/27
  (compatibilidad hacia atrás); (3) un fallo del aviso (webhook caído) se
  registra en stderr y **no tumba el servidor** — el paquete ya está
  guardado y sigue disponible por las rutas de siempre.
  → `src/notificador.ts`, `test/notificador.test.ts`, wiring en
  `src/servicio.ts` y `src/programadorImportacion.ts` (nuevo tipo
  `PaqueteProducido` para que el manejador reporte qué produjo, sin que el
  programador conozca `empaquetar.ts`), exportado desde `src/indice.ts`.

---

## Qué NO se toca en esta fase

- `ENCARGO.md`: gobierna el protocolo de Argos; esta tanda no es Argos.
- El criterio de vendible (`ENCARGO.md` §4) y los guardarraíles ya construidos
  (RS.4, RS.5, RS.6, RS.20, RS.22): el importador solo cambia CÓMO entran las
  reseñas, no qué se hace con ellas una vez dentro del pipeline.
- Suscripción, panel, cobro automatizado: `la-venta.md` §2 sigue vigente —
  eso viene después de que la venta manual esté validada con varios clientes
  reales, no antes.
