# CLAUDE.md — Komi (v1.0 PWA)

Komi es una PWA mobile-first de habitos de lectura con estetica Zen (concepto "Komorebi") y gamificacion tipo Forest: cada libro es un girasol que crece con el avance. Dos modos de lectura: digital (.epub, con epubjs) y libro fisico (temporizador + paginas manuales). Al terminar una sesion hay una charla opcional con Gemini, limitada a 5 turnos. El usuario final usa iPhone (Safari, instalada en la pantalla de inicio).

## 1. Fuentes de verdad (leer antes de tocar codigo)
- `docs/SRS_Komi_v1.md`: especificacion completa (requisitos, casos de uso, brand sheet, component sheet, modelo de datos, endpoints, prompts, sprints). Es la autoridad. No la cargues entera: lee solo las secciones del sprint en curso.
- `docs/reference_prototype.tsx`: prototipo en React. Es REFERENCIA VISUAL Y DE FLUJO (layout, SVG del girasol, textos). No copies su logica de estado ni su estructura; reimplementa segun el SRS.
- Si el SRS, el prototipo y este archivo se contradicen: manda el SRS. Si el SRS es ambiguo o contradictorio, PREGUNTA antes de decidir. No inventes requisitos.

## 2. Stack (fijo, no cambiar sin aprobacion)
- Frontend (`komi_frontend/`): React 18 + Vite + TypeScript estricto + `vite-plugin-pwa` (Workbox). `epubjs`, `dexie` (IndexedDB), `lucide-react`.
- Backend (`komi_backend/`): Python 3.11+, Django 5 + Django REST Framework, ASGI con Uvicorn (streaming SSE), PostgreSQL 16, SDK `google-genai`.
- Estructura de carpetas: exactamente la de las secciones 13.2 y 13.3 del SRS.
- No agregar dependencias nuevas sin avisar y justificar.

## 3. Como trabajar
- Un sprint a la vez, en el orden de la seccion 15 del SRS. No empieces el siguiente sin confirmacion explicita.
- Antes de implementar algo no trivial, propon un plan corto y espera aprobacion.
- Cambios pequenos y verificables. Un commit por unidad logica con mensaje claro en espanol.
- Despues de cada cambio: corre los tests y el linter relevantes. No declares algo terminado sin haberlo ejecutado.
- No toques el esquema de base de datos fuera de migraciones de Django.
- No hagas cambios fuera del alcance de v1.0.

## 4. Definicion de terminado
Una tarea esta terminada solo si: compila, pasa tests y lint, funciona sin conexion (salvo el chat con IA), se ve bien en modo claro (Komorebi) y oscuro (Tsukimi), y respeta los tokens del Brand Sheet.

## 5. Diseno visual
- Prohibido `#000000` y `#FFFFFF` puros. Usa solo los tokens de la seccion 9.2 (claro) y 9.5 (oscuro) del SRS, definidos como variables CSS en un unico lugar (`core/theme`). Nunca hex sueltos en componentes.
- Sin emojis en la interfaz, el codigo, los comentarios ni la documentacion. Iconos: `lucide-react` con `stroke-width` 1.75, o SVG propios.
- Maximo 4 bloques funcionales por pantalla y al menos 40% de espacio en blanco.
- Tipografia: Lora (titulos y lector) y Plus Jakarta Sans (UI, numeros con `tabular-nums`). Radios, alturas y escala segun la seccion 10 del SRS.
- Navegacion inferior (v2): exactamente "Lectura" y "Mi Jardin". "Estadisticas" y la racha (badge del Dashboard) quedan ocultas, no borradas, tras la bandera unica `FEATURES.statsAndStreak` de `core/featureFlags.ts` (apagada). Con la bandera encendida vuelven los tres accesos y el badge. Respetar `env(safe-area-inset-bottom)`.
- Transiciones de 300 a 400 ms `ease-out`.

## 6. Reglas de negocio criticas
- Offline-first: libros, sesiones, rachas y progreso se guardan primero en IndexedDB (Dexie) y se sincronizan despues. Solo el chat con IA requiere conexion.
- Temporizador: calcula el tiempo restante a partir de marcas de tiempo (`Date.now()` contra la hora de inicio), nunca contando ticks de `setInterval`. Safari suspende las pestanas en segundo plano.
- Periodo de gracia de 15 s con Page Visibility API (`visibilitychange`). Pasado ese tiempo fuera de la pantalla, la sesion se invalida sin alterar el progreso previo.
- Rachas: se calculan con `started_at_local` (hora local de inicio) para no romper lecturas que cruzan la medianoche (`streak_engine.py`).
- Sincronizacion: sesiones por union aditiva e idempotente (UUID del cliente); progreso de libros monotonico (`MAX(progress_percentage)`). Ver seccion 11.4.
- Los archivos .epub se quedan en el dispositivo (IndexedDB). El servidor solo recibe metadatos, progreso y el fragmento de la sesion.
- Etapas del girasol: 0-24 semilla, 25-59 tallo, 60-99 capullo, 100 flor.

## 7. Gemini (backend unicamente)
- La clave `GEMINI_API_KEY` vive solo en `.env` del backend. Nunca en el cliente, nunca en el repo.
- Modelos por variables de entorno: `GEMINI_PRIMARY_MODEL` y `GEMINI_FALLBACK_MODEL`. Ante HTTP 429 o 503 del primario (sin texto emitido aun), cambiar al de respaldo en la misma peticion. No hardcodear nombres de modelo.
- Turno 1 sin costo: la apertura de Komi se genera con plantillas locales en `prompt_builder.py` (cero llamadas a la API). Las llamadas a Gemini empiezan cuando el lector responde (turnos 2 a 5).
- El limite de 5 turnos lo aplica el backend: con `turn_count == 5` bloquear nuevos mensajes, extraer lo que sigue a `[SEMILLA_DEL_DIA]:` hacia `ReflectionChat.key_takeaway` y poner `is_closed = True`.
- Los prompts viven solo en `prompt_builder.py`, segun la seccion 14 del SRS.

## 8. Seguridad
- Secretos solo en `.env` (ignorado por git). Entregar `.env.example` sin valores reales.
- La app se sirve por HTTPS (requisito de PWA y Service Worker). Configurar CORS estricto hacia el dominio del frontend.
- Validar toda entrada en serializers de DRF. No confiar en el cliente para el limite de turnos ni para las rachas.

## 9. Pruebas (obligatorias)
Backend (`python manage.py test`): `streak_engine` (incluye medianoche y zonas horarias), limite de 5 turnos, `prompt_builder` (ambos modos), consolidacion de `/profile/sync/`.
Frontend (Vitest): calculo de plan de habito (seccion 5.1), `botanicCalculator`, logica del temporizador y del periodo de gracia, repositorios Dexie.

## 10. Comandos (actualizar tras el Sprint 1 y el Sprint 3)
- Backend (desde `komi_backend/`, con `.venv` activado; requiere PostgreSQL y `.env` copiado de `.env.example`):
  - Instalar: `pip install -r requirements-dev.txt`.
  - Ejecutar: `python manage.py runserver`, `python manage.py migrate`, `python manage.py makemigrations`. **El chat con IA debe correrse con `uvicorn config.asgi:application --reload --port 8000`, nunca con `runserver`**: `runserver` no transmite el SSE en vivo y atiende cada petición en un bucle de eventos nuevo. El cliente de Gemini es por petición (se crea y se cierra en cada envío, SRS §19, punto 22) justamente por eso: un cliente compartido fallaba en una de cada dos peticiones con `RuntimeError: Event loop is closed`. No vuelvas a cachear `get_gemini_client`. Para el resto de la API sirve cualquiera de los dos.
  - Verificar: `python manage.py test` (crea y borra `test_komi_db`; el usuario necesita `CREATEDB`; añadir `--noinput` si quedó una base de pruebas de una corrida interrumpida), `ruff check .`, `ruff format --check .`, `python manage.py makemigrations --check --dry-run`.
  - Pruebas por área: `python manage.py test apps.ai_companion` (usa un cliente de Gemini falso, sin red ni cuota), `apps.profiles`, `apps.reading_sessions`, `apps.garden`. Las de concurrencia y desconexión usan `TransactionTestCase` y son más lentas.
  - Probar el SSE a mano (con uvicorn en marcha): `curl -N -X POST http://127.0.0.1:8000/api/v1/companion/<chat_id>/message/ -H "X-Profile-Id: <uuid>" -H "Content-Type: application/json" -d '{"content":"...","turn":1}'`. Usa una base de datos de pruebas, no la de desarrollo.
  - Casos compartidos del plan de hábito: si cambia el algoritmo de `apps/profiles/services.py`, regenerar `komi_frontend/src/shared/fixtures/habitPlanCases.json` con `python manage.py dump_habit_plan_cases` y actualizar `komi_frontend/src/services/habitPlan.ts`. `python manage.py dump_habit_plan_cases --check` falla si el archivo está desactualizado (la prueba `test_habit_plan_cases` hace lo mismo). El archivo no se edita a mano.
  - Casos compartidos de la racha: si cambia `apps/reading_sessions/streak_engine.py`, regenerar `komi_frontend/src/shared/fixtures/streakCases.json` con `python manage.py dump_streak_cases` y actualizar `komi_frontend/src/services/localStreak.ts`. `python manage.py dump_streak_cases --check` falla si el archivo está desactualizado (la prueba `test_streak_cases` hace lo mismo). El archivo no se edita a mano.
- Frontend (desde `komi_frontend/`, requiere Node 20.19 o superior):
  - Instalar: `npm install`.
  - Servidor: copiar `.env.example` a `.env.local` y fijar `VITE_API_URL` (por ejemplo `http://127.0.0.1:8000`; en producción debe ser `https`). Sin valor la app funciona sin red y la cola de onboarding espera. El backend debe tener ese origen en `CORS_ALLOWED_ORIGINS`.
  - Ejecutar: `npm run dev`. Verificar: `npm run build` (incluye `tsc -b`), `npm run lint`, `npm run test` (Vitest, `fake-indexeddb` para Dexie).
  - Probar la PWA sin conexión: `npm run build` y `npm run preview` (http://localhost:4173; el Service Worker solo existe en la versión de producción). Para que el backend local responda a ese origen, añadirlo a `CORS_ALLOWED_ORIGINS`.
  - Prueba de punta a punta con la API real (una sola charla, consume 4 llamadas a Gemini): usar una base aparte (`komi_e2e`, nunca `komi_db`; el servidor no la protege, hay que comprobarlo a mano), lanzar `uvicorn config.asgi:application --port 8001` con `DATABASE_URL` y `CORS_ALLOWED_ORIGINS=http://localhost:4173` solo en el entorno del proceso, compilar con `VITE_API_URL=http://127.0.0.1:8001 npm run build` (la URL se fija al compilar; volver a compilar con la normal después), servir con `npm run preview` y manejar Edge sin interfaz por CDP. No adelantar el reloj de la página: el servidor rechaza fechas futuras (`updated_at_in_future`); atrasarlo al empezar la sesión y devolverlo a la hora real. Detalle en SRS §19, punto 20.
  - Iconos de la PWA: `node scripts/generate-icons.mjs` (un solo uso; requiere Edge o Chrome, o `EDGE_PATH`) regenera los PNG de `public/icons/` si cambia el girasol o los tokens.
  - Versiones fijadas por Node 20: `vitest` 4 y `jsdom` 27 (las versiones 5 y 31 exigen Node 22); `typescript` 5.9 (`typescript-eslint` no admite la 6.1 o superior).

## 11. Prohibido sin aprobacion previa
Cambiar el stack, agregar dependencias, alterar tokens de color, saltarse un sprint, borrar archivos, reescribir el SRS, o hacer commit de secretos.

## 12. Estado actual (para retomar)
- **Fase 5 (iPhone real y despliegue gratuito).** Plan aprobado en cinco bloques con un punto de revisión cada uno: 5.1 preparar el despliegue (**terminado y aprobado**), 5.2 despliegue real (**terminado**), 5.3 recuperación de datos (**terminado, pendiente de revisión del autor**), 5.4 iPhone real (**terminado: Parte A en Android y Parte B en el iPhone, con el visto bueno de la usuaria final**), 5.5 cierre (**terminado**). **v1.0 cerrada el 11 de noviembre de 2026 por decisión del autor.** Detalle en `docs/DEPLOY_Komi.md` y SRS §19, puntos 22 a 24. **Desplegado y verificado en el 5.2:** Supabase `komi-lectura` (`us-east-1`, pooler en modo sesión), backend `https://komi-lectura-api.onrender.com` (salud, base de datos y CORS en vivo; arranque en frío: 35,4 s, petición retenida, 200) y frontend `https://komi-lectura-uwu.pages.dev` (`sw.js` con `no-cache`; `_redirects` sin reglas porque Pages ya hace el respaldo a `index.html`: no añadir un `404.html`). Una charla real hecha desde una ventana privada y su perfil de prueba borrado con `docs/DEPLOY_Komi.md` §10. Datos y medidas en `docs/DEPLOY_Komi.md` §9. **5.3 (recuperación de datos):** Ajustes muestra el código de recuperación (el `profile_id`, con aviso de que da acceso a los datos) y "Volver a traer mis datos"; la bienvenida del onboarding ofrece "Ya tengo un código de recuperación". La mezcla (`localRestore`) es aditiva, idempotente y atómica y nunca pisa datos locales; un perfil local distinto del código se rechaza; los errores son genéricos; los EPUB recuperados aparecen sin archivo y se vuelven a elegir. Detalle en SRS §19.24. **Siguiente: 5.5 (cierre).** **Fallos de la Parte A diferidos a la v2 por decisión del autor (todos los fallos van a la v2; detalle en SRS §19.24):** importar el `.ics` en Android, el aviso de gracia que aplasta el Dashboard, destello y reflujo al cambiar de capítulo del EPUB y retroceso de una o dos páginas al reabrir el EPUB. **Funcionalidad ausente, también a la v2:** la pestaña Estadísticas es solo un marcador de posición (`StatsScreen`), sin gráfica ni rachas. **5.5 en curso:** punto 1 (registro INFO en Render) y puntos 2 y 3 (charla real: modelo principal, sin respaldo, primer fragmento de 5 s o menos) hechos; el punto 4 (aviso de Gemini bajo el campo de la charla, opción A del autor, texto exacto en SRS §19.24) está hecho; el 5 (la base local `komi_e2e` se borró el 11 de noviembre de 2026 con aprobación del autor; para otra prueba de punta a punta se vuelve a crear con `CREATE DATABASE` y `migrate`) y el 6 (lista de la v2 reunida en `docs/V2_Pendientes_Komi.md`) están hechos. **La Parte B en el iPhone la hizo la usuaria final y dio el visto bueno (informado por el autor, sin el detalle de cada prueba). Lo que sigue es la v2: ver `docs/V2_Pendientes_Komi.md`. No empezar la v2 sin plan y confirmación explícita.** **Pendiente que no bloquea:** ver "Despertando a Komi" con el servicio dormido en un dispositivo real (difícil de provocar en el uso normal).
- **Tarea de la decisión 6 (hecha, `b143bef`):** el envío de mensajes espera al despertar cuando "despierto" caducó (`companionService.send`); la pantalla de la charla dice "Despertando a Komi".
- **Cuentas y nombres:** el nombre del proyecto de Pages (`komi-lectura-uwu.pages.dev`) no se cambia: borraría IndexedDB y el Service Worker del iPhone. Las acciones en las cuentas las hace el autor, guiado paso a paso; nunca se pegan secretos ni el código de recuperación en el chat.
- **Gemini:** el uso real ya incluye charlas con Gemini (el autor y su pareja las usan a diario), así que las charlas normales se hacen con el perfil real. Las pruebas que borran datos o crean basura se hacen desde una ventana privada (perfil desechable) y se limpian con `docs/DEPLOY_Komi.md` §10; nunca con el perfil de uso real.
- **Reglas vigentes de la sesión:** sin `push` (lo hace el autor); un commit por unidad lógica; el chat se corre con `uvicorn`, nunca con `runserver`; cero dependencias nuevas.
