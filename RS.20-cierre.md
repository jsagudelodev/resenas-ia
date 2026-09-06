# RS.20 — Cierre

**Ítem:** RS.20 — Una respuesta que obedeció al atacante no se entrega. Nunca.

**Cierre:**

(1) Una reseña con inyección detectada NO sale como lista — va a revisión
    humana con borrador y motivo, igual que las acusaciones graves de RS.6.

(2) El test comprueba con un redactor que devuelve exactamente lo que el
    atacante pedía (en inglés, afirmando que el restaurante cerró). Antes del
    fix, la suite pasaba de 172→173; ahora 173/173 verde.

(3) El contador del lote refleja el cambio: revisión humana no se cobra
    (RS.16), igual que las acusaciones graves.

**Commits:**
- `dfa5838` — trabajo RS.20
- `XXX` — anotación de cierre