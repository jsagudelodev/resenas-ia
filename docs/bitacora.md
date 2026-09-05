# Bitácora de Reseñas AI

> Una fila por tanda, lo más reciente arriba. **Solo-añadir:** no se borra ni se
> reescribe nada. Lo único editable en una fila existente es su estado.
>
> La escribe Argos al cerrar cada tanda. Si un ítem no cerró, **también se
> anota** — un rojo explicado vale tanto como un verde.

| Fecha | Ítem | Qué se hizo | Iteraciones | Tests añadidos | Qué quedó pendiente |
|---|---|---|---|---|---|
| 2026-09-05 | RS.0 | Levantar el proyecto: `package.json` con `npm test` que encadena `tsc --noEmit` y `node --test` con `tsx`; `tsconfig.json` con `strict`; módulo raíz `src/indice.ts` que expone `version` y reexporta `convertirReseñas`. Suite verde 4/4. Regla 6 demostrada con `git stash`: con `src/indice.ts` stasheado, `tsc` falla con TS2307 sobre `test/indice.test.ts` al no poder resolver `../src/indice.js`. | 1 | `test/indice.test.ts` con 3 tests (versión en formato semver, reexport de `convertirReseñas`, función aún pendiente de RS.1) | El cambio en `.gitignore` y los archivos `src/convertirReseñas.ts` y `test/convertirReseñas.test.ts` quedaron sin commitear al final de la tanda anterior; son material de cierre de RS.1, no de esta. |
