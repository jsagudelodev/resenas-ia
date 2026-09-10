# Funcionalidades — Reseñas AI

> Inventario de lo que el sistema hace hoy, verificado contra el código y la
> suite de tests (247/247 en verde a la fecha de este documento). Cada fila
> dice también **si se puede usar tal cual desde el servidor HTTP** o si es
> una pieza que existe y está probada pero hay que componerla a mano — el
> detalle de cómo hacerlo está en [`manual-de-uso.md`](manual-de-uso.md) §8.

---

## 1. Entrada de reseñas

| Funcionalidad | Descripción | ¿Vía HTTP? | Ítem |
|---|---|---|---|
| Reseñas pegadas o en CSV | Un lote llega como CSV exportado o como texto copiado de Google Maps; ambos formatos producen la misma lista normalizada | Sí (`POST /lotes`) | RS.1 |
| Reseña incompleta no se descarta | Sin estrellas o sin fecha, entra igual, marcada | Sí | RS.1 |
| Importación automática de reseñas | Trae solo las reseñas nuevas de un negocio desde un proveedor de scraping (dedup por id) | Sí (`POST /lotes/importar`, o en automático — ver más abajo) | RS.24 |
| Seguimiento periódico por negocio | Revisa negocios registrados a un intervalo fijo, sin que nadie llame al endpoint | Sí, si se configuró al arrancar (`programadorImportacion`) | RS.26 |
| Catálogo de negocios persistente | El registro de qué negocios seguir sobrevive a reiniciar el proceso | Sí, si se pasó un `catalogo` SQLite | RS.27 |

## 2. Ficha del negocio

| Funcionalidad | Descripción | ¿Vía HTTP? | Ítem |
|---|---|---|---|
| Validación de ficha | Nombre, actividad, tono, contacto, qué ofrece y qué no; se acepta incompleta y dice qué falta | Sí | RS.2 |
| Tono cerrado | Solo `"cercano"` o `"formal"`; otro valor se rechaza con motivo | Sí | RS.2 |
| Sucursales | Cada sucursal firma con su propio nombre/dirección/encargado; los paquetes de antes de esto se siguen leyendo igual | Sí | RS.11 |
| Idioma por defecto de la ficha | Se usa cuando no se puede detectar el idioma de una reseña | Sí | RS.7 |

## 3. Redacción de respuestas

| Funcionalidad | Descripción | ¿Vía HTTP? | Ítem |
|---|---|---|---|
| Respuesta redactada por reseña | Menciona el negocio y responde a lo que dice la reseña | Sí | RS.3 |
| Redactor real (LLM por HTTP) | Sin SDK, configurable por `LLM_URL`/`LLM_API_KEY`/`LLM_MODEL`; sin credencial, el sistema arranca igual | Sí (configuración por entorno) | RS.19, RS.21 |
| Detección de idioma | Responde en inglés a una reseña en inglés y en español a una en español; si no se puede decidir, cae al idioma por defecto de la ficha | Sí | RS.7 |
| Caché de respuestas ya redactadas | La segunda vez que se procesa el mismo prompt exacto, cero llamadas al LLM | **No** conectada por defecto — hay que envolver el redactor con `RedactorConMemoria` | RS.10 |

## 4. Guardarraíles (lo que impide vender algo peligroso)

| Funcionalidad | Descripción | ¿Vía HTTP? | Ítem |
|---|---|---|---|
| Revisión antes de entregar | Bloquea admitir culpa, prometer dinero/descuento, o afirmar un dato que no está en la ficha | Sí | RS.4 |
| Detección de inyección | Una reseña que intenta darle órdenes al redactor ("ignora tus instrucciones...") no las obedece; el intento queda registrado | Sí | RS.5 |
| Acusación grave → revisión humana | Intoxicación, cobro indebido, discriminación o amenaza legal: se entrega con borrador, marcada, nunca como lista | Sí | RS.6 |
| Inyección detectada → nunca lista | Si se detectó un intento de manipular la respuesta, esa respuesta **no puede** salir como lista para pegar, aunque el modelo haya obedecido | Sí | RS.20 |
| Retenciones adicionales (halladas con un modelo real) | Bloquea anunciar que el negocio cerró/se trasladó, afirmar hechos sobre el negocio que la ficha no sostiene, o incluir texto que se presenta como si fuera la reseña | Sí | RS.22 |

## 5. El lote completo

| Funcionalidad | Descripción | ¿Vía HTTP? | Ítem |
|---|---|---|---|
| Procesa el lote entero, en orden | Un resultado por reseña, mismo orden de entrada | Sí | RS.8 |
| Una reseña que falla no tumba el lote | Las demás siguen y traen su respuesta | Sí | RS.8 |
| Resumen de quejas | Motivos que se repiten, cuántas reseñas por motivo, rastreable a los índices originales; con pocos datos dice que no hay suficientes en vez de inventar un patrón | Sí | RS.9 |
| Cada respuesta dice si se cobró | Lista para pegar = se cobra; revisión humana o fallida = no se cobra | Sí (viaja en el resultado, aunque el cobro real no está conectado — ver §7) | RS.23 |

## 6. Entrega del paquete

| Funcionalidad | Descripción | ¿Vía HTTP? | Ítem |
|---|---|---|---|
| Exportar a CSV y Markdown | El CSV abre bien en Excel en español (BOM UTF-8, separador `;`) | Sí | RS.12 |
| Separar listas de revisión/fallidas | Un borrador de revisión humana nunca aparece mezclado con lo pegable | Sí | RS.12 |
| Endpoint que junta todo | Sube el lote (o dispara la importación) y devuelve resumen + id de descarga | Sí (`POST /lotes`, `POST /lotes/importar`) | RS.14, RS.25 |
| Enlace de un solo uso | Para mandar por WhatsApp: caduca, se canjea una vez, y no se puede adivinar ni distinguir uno inexistente de uno caducado | Sí (`GET /lotes/:id/enlace`, `GET /enlace/:token`) | RS.18 |
| No repetir lo ya publicado | Una respuesta marcada como publicada aparece separada en el siguiente paquete, no mezclada ni borrada | **No** conectada por defecto — módulo `MarcarRespuestasPublicadas` disponible | RS.15 |
| Aviso automático de paquete listo | Webhook con nombre del negocio, conteos y enlace, disparado por el seguimiento automático | Sí, si se configuró `notificador` | RS.28 |

## 7. Negocio (cobro, saldo)

| Funcionalidad | Descripción | ¿Vía HTTP? | Ítem |
|---|---|---|---|
| Saldo de cliente | Cuenta cuántas respuestas puede consumir un cliente; un lote que no alcanza se rechaza ANTES de llamar al modelo | **No** conectada por defecto — módulo `ServicioSaldoCliente` disponible, se pasa como parámetro de `procesarLote` | RS.16 |
| Código de compra | Recarga saldo una vez; canjearlo dos veces (incluso a la vez) no recarga dos veces | **No** conectada por defecto | RS.17 |

## 8. Operación (seguridad, resiliencia)

| Funcionalidad | Descripción | ¿Vía HTTP? | Ítem |
|---|---|---|---|
| Log sin datos de terceros | Ni el nombre de un reseñador ni una credencial pueden aparecer en una línea de log | **No** conectado por defecto — módulo `RegistradorSeguro` disponible, se pasa como parámetro de `procesarLote` | RS.13 |
| Errores nunca crudos | Un lote vacío, corrupto, o con JSON malformado responde con motivo comprensible; el servicio sigue escuchando | Sí | RS.14 |
| Tope de reseñas por lote configurable | Por variable de entorno, por opción del servidor, o por el cliente (que solo puede bajar el tope, nunca subirlo) | Sí | RS.14 |
| Un negocio caído no tumba la corrida automática | Si el proveedor de importación falla o el pipeline lanza para un negocio, los demás negocios del ciclo siguen | Sí | RS.26 |
| Un aviso caído no tumba nada | Si el webhook de notificación falla, se registra en `stderr` y el paquete sigue disponible por las rutas normales | Sí | RS.28 |

---

## Resumen: qué corre "de fábrica" con solo `crearServidor({}, almacen)`

Ingestión de lotes (pegado/CSV), validación de ficha, redacción (con
`RedactorFalso` si no hay LLM configurado), los cinco guardarraíles de
revisión, resumen de quejas, empaquetado CSV/Markdown, enlaces de un solo
uso, y los endpoints HTTP. **Sin componer nada más**, quedan apagados: caché
de respuestas, marca de publicadas, saldo/cobro, log saneado, y (sin pasar
`importador`/`programadorImportacion`/`notificador`) toda la automatización
de V5. El manual (§5 y §8) muestra cómo encenderlos.
