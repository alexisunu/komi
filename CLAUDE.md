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
- Navegacion inferior: exactamente "Lectura", "Mi Jardin", "Estadisticas". Respetar `env(safe-area-inset-bottom)`.
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
  - Ejecutar: `python manage.py runserver`, `python manage.py migrate`, `python manage.py makemigrations`. `runserver` no transmite el SSE del chat en vivo: para probar el chat usar `uvicorn config.asgi:application --reload --port 8000`.
  - Verificar: `python manage.py test` (crea y borra `test_komi_db`; el usuario necesita `CREATEDB`; añadir `--noinput` si quedó una base de pruebas de una corrida interrumpida), `ruff check .`, `ruff format --check .`, `python manage.py makemigrations --check --dry-run`.
  - Pruebas por área: `python manage.py test apps.ai_companion` (usa un cliente de Gemini falso, sin red ni cuota), `apps.profiles`, `apps.reading_sessions`, `apps.garden`. Las de concurrencia y desconexión usan `TransactionTestCase` y son más lentas.
  - Probar el SSE a mano (con uvicorn en marcha): `curl -N -X POST http://127.0.0.1:8000/api/v1/companion/<chat_id>/message/ -H "X-Profile-Id: <uuid>" -H "Content-Type: application/json" -d '{"content":"...","turn":1}'`. Usa una base de datos de pruebas, no la de desarrollo.
  - Casos compartidos del plan de hábito: si cambia el algoritmo de `apps/profiles/services.py`, regenerar `komi_frontend/src/shared/fixtures/habitPlanCases.json` con `python manage.py dump_habit_plan_cases` y actualizar `komi_frontend/src/services/habitPlan.ts`. `python manage.py dump_habit_plan_cases --check` falla si el archivo está desactualizado (la prueba `test_habit_plan_cases` hace lo mismo). El archivo no se edita a mano.
- Frontend (desde `komi_frontend/`, requiere Node 20.19 o superior):
  - Instalar: `npm install`.
  - Servidor: copiar `.env.example` a `.env.local` y fijar `VITE_API_URL` (por ejemplo `http://127.0.0.1:8000`; en producción debe ser `https`). Sin valor la app funciona sin red y la cola de onboarding espera. El backend debe tener ese origen en `CORS_ALLOWED_ORIGINS`.
  - Ejecutar: `npm run dev`. Verificar: `npm run build` (incluye `tsc -b`), `npm run lint`, `npm run test` (Vitest, `fake-indexeddb` para Dexie).
  - Probar la PWA sin conexión: `npm run build` y `npm run preview` (http://localhost:4173; el Service Worker solo existe en la versión de producción). Para que el backend local responda a ese origen, añadirlo a `CORS_ALLOWED_ORIGINS`.
  - Iconos de la PWA: `node scripts/generate-icons.mjs` (un solo uso; requiere Edge o Chrome, o `EDGE_PATH`) regenera los PNG de `public/icons/` si cambia el girasol o los tokens.
  - Versiones fijadas por Node 20: `vitest` 4 y `jsdom` 27 (las versiones 5 y 31 exigen Node 22); `typescript` 5.9 (`typescript-eslint` no admite la 6.1 o superior).

## 11. Prohibido sin aprobacion previa
Cambiar el stack, agregar dependencias, alterar tokens de color, saltarse un sprint, borrar archivos, reescribir el SRS, o hacer commit de secretos.
