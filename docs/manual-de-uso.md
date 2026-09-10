# Manual de uso — Reseñas AI

> Para qué existe este documento: los demás archivos de `docs/` explican QUÉ
> se construyó y POR QUÉ (`ENCARGO.md`, `la-venta.md`,
> `backlog-v5-automatizacion.md`). Este explica CÓMO ponerlo a correr y
> usarlo, paso a paso, con los comandos y el JSON exactos.
>
> Todo lo que aparece aquí existe y está probado (`npm test`, 247/247 en
> verde a fecha de este documento). Donde una pieza NO está conectada al
> servidor HTTP por defecto, se dice explícitamente — ver §7.

---

## 1. Qué es esto, en una frase

Un servicio que recibe las reseñas de un negocio (pegadas, en CSV, o
importadas automáticamente) y devuelve respuestas listas para pegar en
Google más un resumen de quejas — con guardarraíles que impiden que una
respuesta mala llegue al cliente. El detalle de negocio está en
[`la-venta.md`](la-venta.md); esto es el manual de operación.

## 2. Requisitos e instalación

- Node.js 22 o superior (usa `node:sqlite`, experimental en 22, y `fetch`
  nativo).
- Desde la raíz del proyecto:

```sh
npm install
npm test          # confirma que todo sigue en verde antes de tocar nada
```

## 3. Configuración por variables de entorno

Ninguna es obligatoria para arrancar: sin ellas, el servicio funciona con
piezas "falsas" (sin red, sin costo, sin resultados reales). Para operar de
verdad con un cliente hace falta al menos el bloque **LLM**.

| Variable | Para qué | Si falta |
|---|---|---|
| `LLM_URL` | Endpoint del proveedor del modelo (OpenAI-compatible) | El redactor real no se puede construir; hay que pasar uno explícito |
| `LLM_API_KEY` | Credencial del proveedor | Igual que arriba |
| `LLM_MODEL` | Modelo a usar (ej. `gpt-4o-mini`, `gemini-2.5-flash`) | Usa `gpt-4o-mini` por defecto |
| `MAX_RESEÑAS_POR_LOTE` | Tope de reseñas por lote | Usa `100` |
| `IMPORTADOR_URL` | Endpoint del proveedor de scraping de reseñas de Google | La importación automática (RS.24-26) queda desactivada |
| `IMPORTADOR_API_KEY` | Credencial del proveedor de scraping | Igual que arriba |
| `NOTIFICADOR_URL` | Webhook al que avisar cuando un paquete queda listo | No se manda ningún aviso automático |
| `NOTIFICADOR_API_KEY` | Credencial del webhook (opcional, si el webhook la exige) | Se manda sin cabecera `Authorization` |

**Nota sobre `IMPORTADOR_URL`:** el esquema de petición/respuesta que asume
`TransporteImportacionReal` (`review_id`, `author_name`, `review_text`,
`review_rating`, `review_datetime_utc`) es el típico de un proveedor de
scraping de Google Maps (tipo Outscraper), pero **no se ha verificado contra
un proveedor real todavía** — antes de usarlo con un cliente, confirmar el
esquema exacto de quien se contrate.

## 4. Arranque rápido (modo de prueba, sin nada configurado)

Para probar el flujo sin gastar nada ni tocar ninguna API real:

```ts
// prueba.ts
import { crearServidor, AlmacenDeLotesEnMemoria } from "./src/indice.js";

const servidor = await crearServidor({}, new AlmacenDeLotesEnMemoria());
console.log(`Escuchando en ${servidor.url}`);
```

```sh
npx tsx prueba.ts
```

Sin opciones, `crearServidor` usa `RedactorFalso` (inventa respuestas de
prueba, reconocibles, sin llamar a ningún modelo) y guarda todo en memoria
(se pierde al cerrar el proceso). Sirve para probar el flujo de §6, no para
vender.

## 5. Arranque real (recomendado para producción)

Este es el arranque que junta las piezas persistentes: redactor real,
importación automática, catálogo de negocios que sobrevive a un reinicio, y
aviso por webhook.

```ts
// iniciar.ts
import {
  crearServidor,
  AlmacenDeLotesEnMemoria,
  crearTransporteReal,
  RedactorReal,
  RedactorFalso,
  ImportadorReseñas,
  crearTransporteImportacionReal,
  AlmacenImportacionSqlite,
  CatalogoNegociosSqlite,
  crearNotificadorWebhook,
} from "./src/indice.js";

// Redactor: real si hay credencial de LLM configurada, si no, el falso
// (arranca igual, pero no sirve para vender — ver §3).
const transporteLlm = crearTransporteReal();
const redactor = transporteLlm !== null ? new RedactorReal(transporteLlm) : new RedactorFalso();

// Importador (opcional): solo si hay proveedor de scraping configurado.
const transporteImportacion = crearTransporteImportacionReal();
const importador =
  transporteImportacion !== null
    ? new ImportadorReseñas(transporteImportacion, new AlmacenImportacionSqlite("./importados.db"))
    : undefined;

// Catálogo de negocios: sobrevive a reiniciar el proceso (RS.27).
const catalogo = new CatalogoNegociosSqlite("./negocios.db");

// Notificador (opcional): solo si hay webhook de aviso configurado.
const notificador = crearNotificadorWebhook() ?? undefined;

const servidor = await crearServidor(
  {
    redactor,
    // `exactOptionalPropertyTypes` del proyecto no permite asignar
    // `undefined` a un campo opcional (regla 8 de ENCARGO.md: no se calla
    // al compilador) — de ahí el spread condicional en vez de un ternario
    // directo.
    ...(importador !== undefined ? { importador } : {}),
    ...(importador !== undefined
      ? {
          programadorImportacion: {
            intervaloMs: 60 * 60 * 1000, // revisa negocios cada hora
            catalogo,
            ...(notificador !== undefined ? { notificador } : {}),
          },
        }
      : {}),
  },
  new AlmacenDeLotesEnMemoria(), // los PAQUETES siguen en memoria hoy: ver §8
);

console.log(`Reseñas AI escuchando en ${servidor.url}`);
```

```sh
LLM_URL=https://api.openai.com/v1/chat/completions \
LLM_API_KEY=sk-... \
LLM_MODEL=gpt-4o-mini \
npx tsx iniciar.ts
```

El proceso queda corriendo (`server.listen` no termina solo). Para pararlo,
`Ctrl+C` o, desde código, `await servidor.cerrar()`.

## 6. Uso manual, paso a paso (el que ya se puede vender hoy)

Este es el flujo que describe [`la-venta.md`](la-venta.md) §5: copiar
reseñas de Google Maps a mano y correr el lote.

### 6.1. Preparar la ficha del negocio

```json
{
  "nombre": "Asadero El Buen Sabor",
  "actividad": "restaurante",
  "tono": "cercano",
  "contacto": { "telefono": "300-555-0100" },
  "ofrece": { "gestos": ["repetir el plato", "una disculpa sincera"] },
  "noOfrece": { "gestos": ["devoluciones en efectivo", "descuentos"] },
  "idiomaPorDefecto": "es"
}
```

- `tono`: solo `"cercano"` o `"formal"`.
- `ofrece`/`noOfrece`: lo que el negocio SÍ puede prometer y lo que NUNCA
  debe prometer — el revisor (RS.4) usa esto para bloquear promesas
  inventadas.
- Si el negocio tiene sucursales, añadir `"sucursal": { "nombre": "...",
  "direccion": "...", "encargado": "..." }` (ver RS.11).

### 6.2. Preparar el lote de reseñas

**Opción CSV** (lo que exporta la mayoría de herramientas):

```csv
autor,estrellas,fecha,texto
Marcela Ríos,5,2026-09-01,"La bandeja paisa estaba increíble."
Andrés Gómez,2,2026-09-02,"Esperamos 45 minutos por dos almuerzos."
```

**Opción texto pegado** (copiar directo de Google Maps, sin dar formato):

```
Autor: Marcela Ríos
Estrellas: 5
Fecha: 2026-09-01
La bandeja paisa estaba increíble.

Autor: Andrés Gómez
Estrellas: 2
Fecha: 2026-09-02
Esperamos 45 minutos por dos almuerzos.
```

Una reseña sin estrellas o sin fecha entra igual, marcada como incompleta —
no hace falta completar el lote a mano.

### 6.3. Mandar el lote

```sh
curl -X POST http://127.0.0.1:PUERTO/lotes \
  -H "Content-Type: application/json" \
  -d '{
        "ficha": { ... el JSON de 6.1 ... },
        "lote": "...el CSV o el texto pegado de 6.2..."
      }'
```

Responde con:

```json
{
  "id": "3f9a...",
  "conteos": { "listas": 8, "paraRevision": 2, "fallaron": 0 },
  "resumen": { "motivos": [...], "totalReseñas": 10, ... },
  "fichaFaltantes": []
}
```

- `conteos.listas`: respuestas listas para pegar tal cual.
- `conteos.paraRevision`: **léelas tú antes de mandarlas** — acusación grave
  o intento de manipular al redactor detectado (RS.5/RS.6/RS.20/RS.22).
- `fichaFaltantes`: campos de la ficha que faltaron (la ficha se acepta
  igual, esto es solo un aviso).

### 6.4. Descargar el paquete

```sh
curl http://127.0.0.1:PUERTO/lotes/3f9a.../paquete -o paquete.csv
```

CSV con BOM UTF-8 y `;` como separador — se abre bien en Excel en español.
Trae una fila por reseña con su respuesta, su estado (`lista` /
`paraRevision` / `fallida`) y si se cobró.

### 6.5. O generar un enlace de un solo uso (para mandar por WhatsApp)

```sh
curl http://127.0.0.1:PUERTO/lotes/3f9a.../enlace
# → { "token": "...", "url": "/enlace/..." }
```

El enlace completo (`http://tu-dominio/enlace/TOKEN`) se puede pegar en un
chat: se canjea una sola vez y caduca a los 7 días (configurable con
`plazoCaducidadEnMs` al armar el servidor). Probar con un token ajeno o
inventado responde exactamente igual que uno caducado — no se puede
adivinar cuáles existen.

### 6.6. Antes de entregar — el paso que no se automatiza

**Lee las que quedaron `paraRevision` tú mismo.** El criterio de vendible
(`ENCARGO.md` §4) existe porque una sola respuesta mala convierte el
producto en un pasivo para el negocio. El sistema marca, no decide.

## 7. Uso automático, paso a paso (V5 — RS.24 a RS.28)

Requiere haber arrancado con el bloque de §5 (`importador` +
`programadorImportacion` configurados).

### 7.1. Registrar un negocio bajo seguimiento

En el arranque (lista fija):

```ts
programadorImportacion: {
  intervaloMs: 60 * 60 * 1000,
  catalogo,
  notificador,
  negocios: [{ placeId: "ChIJ...", ficha: { /* el JSON de 6.1 */ } }],
}
```

O en caliente, con el servidor ya corriendo (queda persistido en el
catálogo, sobrevive a reiniciar):

```ts
await servidor.programador!.registrarNegocio({
  placeId: "ChIJ...",
  ficha: { /* el JSON de 6.1 */ },
});
```

`placeId` es el identificador que use el proveedor de importación
configurado en `IMPORTADOR_URL` para ese negocio (revisar su documentación —
suele ser el Place ID de Google Maps).

### 7.2. Qué pasa después, sin que nadie haga nada

Cada `intervaloMs`, el programador:

1. Le pregunta al proveedor de importación por reseñas nuevas de ese
   negocio (las que ya se trajeron antes no se repiten — dedup por id).
2. Si hay reseñas nuevas, corre el mismo pipeline de revisión que el flujo
   manual (§6.3-6.4) y guarda el paquete.
3. Si hay `notificador` configurado, avisa con un `POST` que incluye
   `nombreNegocio`, `conteos` y un `enlaceUrl` ya listo para mandar por
   WhatsApp (mismo mecanismo de §6.5).

Nada de esto cobra ni marca nada como publicado todavía: sigue siendo
"aquí está el paquete", no "ya se lo mandé al negocio".

### 7.3. Quitar un negocio del seguimiento

```ts
await servidor.programador!.quitarNegocio("ChIJ...");
```

## 8. Piezas que existen pero NO están conectadas al servidor por defecto

Construidas y probadas (`npm test` las cubre), pero **`crearServidor` no las
usa automáticamente** — hay que componerlas a mano en un script propio, como
se hizo con `RedactorReal` en §5. Antes de asumir que "ya cobra" o "ya
recuerda lo publicado", confirmar que efectivamente se conectaron:

| Qué hace | Cómo se usa | Módulo |
|---|---|---|
| Recordar qué respuesta ya se publicó, para no reentregarla | `new MarcarRespuestasPublicadas(almacen).publicar(clave)` / `separarPublicadasYNuevas(...)` | `almacenRespuestas.ts` (RS.15) |
| Llevar el saldo de respuestas que un cliente pagó, y descontarlo por lote | `new ServicioSaldoCliente("./saldo.db")` — se pasa como quinto argumento de `procesarLote` | `saldoCliente.ts` (RS.16) |
| Códigos de compra que recargan saldo | `servicioSaldo.registrarCodigo(codigo, cantidad)` / `.canjear(codigo)` | `saldoCliente.ts` (RS.17) |
| Cachear respuestas para no volver a pagarle al LLM por el mismo prompt | `new RedactorConMemoria(redactorReal, almacen)` en vez de pasar `redactorReal` directo | `almacenRespuestas.ts` (RS.10) |
| Log sin nombres de reseñador ni credenciales | `new RegistradorSeguro(new RegistradorEstandar(), listaDeSaneamientoDeLote(autores, credencial))` — se pasa como cuarto argumento de `procesarLote` | `registro.ts` (RS.13) |

El almacén de **paquetes generados** (`AlmacenDeLotes`, segundo argumento de
`crearServidor`) también vive en memoria por defecto
(`AlmacenDeLotesEnMemoria`): un reinicio del proceso pierde los paquetes ya
armados (aunque el catálogo de negocios y lo ya importado sí sobreviven,
ver RS.27/RS.24). Para que un paquete sobreviva a un reinicio hace falta una
implementación de `AlmacenDeLotes` sobre disco — no existe todavía.

## 9. Solución de problemas

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `POST /lotes/importar` devuelve 501 | No se pasó `importador` al armar el servidor | Configurar `IMPORTADOR_URL`/`IMPORTADOR_API_KEY` (§3) o pasar un `ImportadorReseñas` explícito |
| `POST /lotes/importar` devuelve 502 | El proveedor de importación falló o rechazó la clave | El motivo trae el detalle (sin filtrar la clave); revisar cuota/credencial del proveedor |
| Todas las respuestas salen `noDisponible` | Sin `LLM_URL`/`LLM_API_KEY`, o el proveedor rechaza la credencial | Confirmar variables de entorno; con `RedactorFalso` (sin configurar nada) esto es normal, no es un error |
| Una reseña queda `paraRevision` sin que parezca grave | Detectó un intento de manipular la respuesta (inyección) o un patrón de RS.22 (anuncia cierre, inventa un hecho, incluye texto como si fuera la reseña) | Es el guardarraíl funcionando — revisar el borrador a mano |
| Un enlace responde 410 | Caducó o ya se canjeó (o nunca existió — la respuesta es la misma a propósito) | Generar uno nuevo con `GET /lotes/:id/enlace` |
| El aviso automático nunca llega | Sin `notificador` configurado, o el webhook está caído | Un fallo del aviso se escribe en `stderr` del proceso, revisar ahí; el paquete igual queda disponible por las rutas normales |

## 10. Dónde seguir leyendo

- [`la-venta.md`](la-venta.md) — qué se vende, a cuánto, y el guion de la
  primera venta.
- [`ENCARGO.md`](../ENCARGO.md) — el criterio de vendible y las reglas que
  gobiernan el producto.
- [`backlog-v5-automatizacion.md`](backlog-v5-automatizacion.md) — el detalle
  técnico de cada pieza de automatización (RS.24-RS.28) y qué queda
  pendiente.
- [`bitacora.md`](bitacora.md) y [`bitacora-v5.md`](bitacora-v5.md) — el
  historial de qué se construyó, en qué orden y con qué pruebas.
