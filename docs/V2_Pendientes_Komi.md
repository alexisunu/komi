# Komi: lista de pendientes para la v2

Reunida el 11 de noviembre de 2026 al cerrar el bloque 5.5. Todo lo de esta lista se difirió por decisión del autor (regla vigente: todos los fallos de la Parte A van a la v2). El detalle y la historia de cada punto están en `docs/SRS_Komi_v1.md` §19.24. Nada de esto se tocó en la v1.0.

## 1. Fallos observados en un Android real (Parte A del bloque 5.4)

| N.º | Qué pasa | Prueba | Causa |
|---|---|---|---|
| 1 | El recordatorio `.ics` no se pudo importar al calendario del teléfono (Google Calendar). | A3 | No investigada. Puede ser la descarga desde la PWA instalada o que ninguna app tome el archivo. |
| 2 | El aviso de "saliste más de 15 segundos" se muestra dentro del Dashboard y aplasta el contenido, con elementos que se sobreponen. Debería ser una ventana emergente. | A4 | El aviso entra en el flujo del diseño. |
| 3 | En el lector EPUB, solo al cambiar de capítulo: destello en modo oscuro y reflujo visible de las letras en modo claro. | A6 | **Resuelto en la rama `v2` (commit `328c46d`), verificado en un Android real.** epubjs no inyecta en los capítulos nuevos los temas registrados con `registerCss`; el tema llegaba tarde, por un efecto que dependía de la identidad de un objeto nuevo en cada render. Detalle en SRS §20. |
| 4 | Al reabrir un EPUB tras cerrar la app, el lector queda una o dos páginas antes de donde se dejó y el porcentaje retrocede con la posición. | A7 | **Resuelto en la rama `v2` (commits `a0b20b2`, `16d24a4` y `e358b6d`), verificado en un Android real.** Tres causas: Lora con `font-display: swap` desplazaba la página tras `display(cfi)`; la posición esperaba un intervalo de 10 s; y una sesión invalidada devolvía al último avance validado. Detalle en SRS §20. |

## 2. Funcionalidad ausente

| N.º | Qué falta |
|---|---|
| 5 | La pestaña **Estadísticas** es solo un marcador de posición (`StatsScreen`). §13.2 prometía gráfica semanal, rachas y copia de seguridad. Para la v2: minutos por día de la semana, racha actual y más larga, y estado de la copia. Requiere plan previo. **Mientras tanto, en la v2 la pestaña y la racha del Dashboard están ocultas tras la bandera `FEATURES.statsAndStreak` (SRS 20, bloque 3); el contenido sigue pendiente.** |

## 3. Limitaciones conocidas de la v1.0 que podrían mejorarse

- **Código de recuperación:** es el `profile_id` y la única credencial de la API. No se puede revocar ni rotar. Quien lo tenga ve las lecturas y charlas.
- **Recuperación de datos:** el servidor no devuelve página, CFI ni extracto por sesión; tampoco las charlas abiertas ni los mensajes (en el dispositivo solo se guarda la semilla). No se valida que el `.epub` que se vuelve a elegir sea el mismo libro. La respuesta llega en una sola petición, sin paginar.
- **Charla con Komi:** no hay cierre anticipado (SRS 19.18). Salir antes del turno 5 pierde la charla.
- **Gemini en el plan gratuito:** Google puede hacer que personas revisen lo enviado. Hoy se avisa en la app. La alternativa es activar facturación (plan de pago), con costo y tarjeta; decisión abierta del autor.
- **Animación de deslizamiento al pasar página en el lector EPUB:** no existe (no se consideró fallo).

## 4. Verificaciones que quedaron sin hacer

- **Parte B del bloque 5.4 (iPhone real):** la hizo la usuaria final y dio el visto bueno (informado por el autor). **No se registró el resultado de cada prueba** (Wake Lock, barra de estado, `navigator.storage.persist()`, descarga del `.ics` en la PWA instalada de iOS, temporizador y periodo de gracia al bloquear la pantalla, portapapeles y autocompletado del campo de recuperación). Si alguna falla al usarla, anotarla aquí.
- **EPUB en Safari:** sin probar en dispositivo real (solo en Android). La usuaria del iPhone lee solo en físico.
- **"Despertando a Komi" con el servicio dormido en un dispositivo real:** no se ha visto. En el uso normal es difícil provocarlo (el servicio casi siempre está despierto al llegar a la charla). Medido en frío en el 5.2: 35,4 s.
- **Prueba automática de "Hablar con Komi" con un EPUB de punta a punta:** en el arnés de pruebas la puerta de la charla con un EPUB no se resuelve (ya ocurría en la base de la rama `v2`; causa sin determinar, SRS 20 punto 2). Lo cubre `PostReadingSheet.test.tsx` y el autor lo probó a mano en un Android.
- **Latencia de la charla:** primer fragmento de 5 s o menos, a ojo; no se cronometró.
- **Versión en vivo de los términos de datos de Gemini:** se consultó por búsqueda (vigencia 23 de marzo de 2026), no por lectura completa. Pueden cambiar.

## 5. Operación

- **Base local `komi_e2e`:** borrada el 11 de noviembre de 2026 con autorización del autor (solo datos de prueba). Si hace falta otra prueba de punta a punta: `CREATE DATABASE komi_e2e;` y `migrate` (ver `CLAUDE.md` §10).
- **Base `komi_db` (desarrollo) y Supabase (producción):** la v2 las actualiza con migraciones de Django; no se crea una base nueva.
