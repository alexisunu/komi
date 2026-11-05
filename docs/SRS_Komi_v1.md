# **Documento de Especificación de Requisitos (SRS) — Komi (v1.0)**

# **1\. Visión General del Proyecto**

* **Nombre de la Aplicación:** Komi (inspirado en *Komorebi*, la luz del sol que se filtra entre las hojas).  
* **Propósito:** Progressive Web App (PWA) mobile-first con estética Zen, instalable en la pantalla de inicio de iOS (Safari `apple-mobile-web-app-capable` / `display: standalone`) y Android sin requerir compilación nativa en Xcode. Diseñada para mejorar la concentración, fomentar el hábito de la lectura diaria y dar seguimiento al progreso mediante gamificación orgánica e Inteligencia Artificial conversacional.  
* **Mecánica Central (Core Loop) — Modelo Híbrido de Lectura:** Inspirada en *Forest*, cada libro registrado por el usuario está representado por un girasol virtual. Al plantar un girasol, el usuario elige entre **Modo Digital (.epub)** (lectura integrada dentro de la app con cálculo de progreso automático y extracción exacta del texto leído para la IA) o **Modo Libro Físico** (temporizador Zen tipo Forest con registro manual por páginas y contextualización guiada para la IA). Al iniciar una sesión de concentración (Focus Mode), el girasol crece según el avance. Cuando el libro llega al 100%, el girasol florece por completo y pasa a la galería del jardín personal. Al concluir cada sesión, la app ofrece opcionalmente una charla reflexiva con IA adaptada al formato de lectura elegido.

# **2\. Identidad Visual y Estética (Temática Zen)**

La interfaz evita la saturación visual y el blanco puro para no fatigar la vista, priorizando tonos tierra, papel y naturaleza:

| Elemento Visual | Código Hex | Descripción de Uso |
| :---- | :---- | :---- |
| Fondo Principal (Papel Arroz / Arena) | `#F7F5F0` | Transmite calma y simula el papel de un libro físico. |
| Superficies y Tarjetas (Piedra Suave) | `#EAE6DF` | Separa bloques de contenido sin necesidad de bordes duros. |
| Acento Principal (Amarillo Ocre / Girasol) | `#E5A93C` | Cálido, aplicado en llamadas a la acción (CTA) y los pétalos del girasol. |
| Acento Secundario (Verde Salvia / Matcha) | `#6B8E78` | Utilizado en el tallo, barras de progreso e indicadores positivos. |
| Texto Principal (Carbón Profundo) | `#2C302E` | Alta legibilidad sin la dureza del negro puro. |
| Texto Secundario (Tierra Café) | `#7A7267` | Para subtítulos, nombres de autores y metadatos. |

# **3\. Stack Tecnológico (v1.0)**

| Capa Arquitectural | Tecnología Seleccionada | Justificación y Alcance |
| :---- | :---- | :---- |
| **Frontend** | React 18 \+ Vite \+ TypeScript \+ vite-plugin-pwa | Desarrollo web moderno como Progressive Web App (PWA) instalable en iOS (Safari `apple-mobile-web-app-capable`, `display: standalone`) y Android mediante `vite-plugin-pwa` (generación automática de `manifest.webmanifest` y Service Worker con Workbox). Reutilización directa de los componentes DOM/SVG del prototipo con `lucide-react`, integración de `epubjs` para parseo de XHTML/CFI y persistencia local offline-first en `IndexedDB` mediante `Dexie.js`. |
| **Backend** | Python (Django) | API RESTful robusta, gestión modular del modelo de datos y orquestación de servicios externos. |
| **Base de Datos** | PostgreSQL | Motor relacional para administración estricta de usuarios, libros, estados de girasoles, sesiones e historial. |
| **Inteligencia Artificial** | API de Google Gemini | Integración en backend mediante SDK de Python para análisis conversacional y reflexión literaria adaptativa. |

# **4\. Características Principales (Core Features v1.0)**

1. **Onboarding y Motor de Hábitos:** Cuestionario inicial de 5 preguntas para perfilar al lector y establecer una meta diaria personalizada.  
2. **Dashboard Zen (El Jardín Activo):** Pantalla principal minimalista centrada en el girasol del libro en curso y el temporizador de lectura.  
3. **Focus Mode Híbrido (Lector ePub \+ Temporizador Físico):** Si el libro es `.epub`, abre el lienzo de lectura en color Papel Arroz (`#F7F5F0`) con el temporizador sutil en el header. Si es físico, muestra el girasol respirando con cuenta regresiva. Incluye un período de gracia de 15 segundos monitoreado por Page Visibility API (`document.visibilityState` / evento `visibilitychange`) si el usuario sale de la pestaña o minimiza la app antes de invalidar la sesión, además de un botón de *"Terminé antes de tiempo"* (válido si se completó al menos el 50% del tiempo o si se finalizó el libro al 100%).  
4. **Gestor de Biblioteca Personal (Mi Jardín):** Permite plantar libros importando un archivo `.epub` o registrando un libro físico (medido por páginas para garantizar avance porcentual en cada sesión). Incluye la opción de archivar/desplantar libros abandonados ("En barbecho").  
5. **Compañero de Análisis con IA (Gemini):** En modo `.epub`, recibe los párrafos exactos leídos en la sesión. En modo físico, inicia invitando al lector a compartir qué escena o idea le llamó la atención junto con los metadatos de título y autor para evitar alucinaciones. La sesión se acota a un ciclo Zen de máximo 5 intercambios (1 apertura \+ 4 respuestas) con botón de *"Guardar reflexión y volver al jardín"*.  
6. **Estadísticas y Rachas:** Visualización limpia de días consecutivos de lectura y tiempo total semanal.

# **5\. Cuestionario Inicial de Onboarding**

| \# | Pregunta Clave | Opciones Disponibles | Impacto / Valor Interno |
| :---- | :---- | :---- | :---- |
| 1 | **Experiencia lectora:***¿Cómo describirías tu ritmo de lectura actual?* | • A) Estoy empezando desde cero• B) Leo de vez en cuando (1 a 3 libros al año)• C) Tengo el hábito (4 a 8 libros al año)• D) Soy lector frecuente (+8 libros al año) | Factor de fricción: A \= Conservador, B \= Moderado, C \= Estable, D \= Avanzado |
| 2 | **Meta base de tiempo:***¿Cuánto tiempo de calma puedes regalarle hoy a tu lectura diaria?* | • A) 10 minutos (Semilla ligera)• B) 15 minutos (Equilibrio Zen)• C) 30 minutos (Inmersión media)• D) 45 minutos o más (Lectura profunda) | T\_base: A \= 10 min, B \= 15 min, C \= 30 min, D \= 45 min |
| 3 | **Disparador horario:***¿En qué momento del día tu mente se siente más despejada para leer?* | • A) Al despertar (07:30 AM)• B) En la pausa de la tarde (03:00 PM)• C) Antes de dormir (09:30 PM \- Activa tema Tsukimi)• D) En trayectos o tiempos libres (12:30 PM) | Generación de evento recurrente .ics para Apple/Google Calendar, sugerencia de modo oscuro y banner gentil In-App |
| 4 | **Diagnóstico de obstáculo:***¿Qué suele apagar tu concentración cuando intentas mantener el hábito?* | • A) Las notificaciones y distracciones del celular• B) El cansancio o sueño al leer• C) Olvidar lo que leí en capítulos anteriores• D) Empezar con metas muy altas y abandonar rápido | Reglas de ajuste del temporizador y alertas gentiles |
| 5 | **Estilo pedagógico de IA:***Al terminar tu sesión, ¿cómo te gustaría reflexionar con Komi?* | • A) Retos suaves de memoria para no perder el hilo (MEMORY\_QUIZ)• B) Analizar el trasfondo, psicología e ideas del autor (DEEP\_ANALYSIS)• C) Destilar un resumen práctico con las ideas clave (KEY\_SUMMARY) | `ai_reflection_style` para inyección en prompt |

## **5.1 Algoritmo de Cálculo del Plan de Hábito (daily\_goal\_minutes)**

Para garantizar la formación sostenible del hábito y evitar la frustración, el sistema calcula la meta diaria mediante la siguiente lógica:

7. **1\. Valor inicial (T\_base):** Se asigna el tiempo seleccionado en la Pregunta 2 (10, 15, 30 o 45 minutos).  
8. **2\. Regla de Protección Anti-Abandono:** Si el lector seleccionó en la Pregunta 1 "Estoy empezando desde cero" o en la Pregunta 4 "Empezar con metas muy altas y abandonar rápido", el sistema aplica un tope protector: `daily_goal_minutes = min(T_base, 15)`. Esto asegura victorias tempranas y consistencia durante la primera semana.  
9. **3\. Regla de Fatiga Nocturna:** Si el usuario elige "Antes de dormir" (Pregunta 3\) y "El cansancio o sueño al leer" (Pregunta 4), y su valor `T_base > 20`, se fija automáticamente la meta en 15 minutos y se preconfigura por defecto el tema nocturno Tsukimi.

# **6\. Arquitectura de Componentes del Dashboard Principal**

Para preservar la estética Zen, el Dashboard se limita a **4 zonas limpias** con al menos un 40% de espacio en blanco:

* **Zona 1 — Header Sutil (Superior):** Indicador minimalista de racha actual a la izquierda (ej. `5 días seguidos`) e ícono de perfil/ajustes a la derecha.  
* **Zona 2 — Lienzo Central (El Girasol Activo):** Ocupa el 50% central de la pantalla. Renderiza el girasol vectorial en su etapa actual de crecimiento (Semilla, Tallo, Capullo o Flor Completa) junto con el título del libro activo y una barra delgada de progreso (ej. *Pág. 84 de 250 — 33%*).  
* **Zona 3 — Selector de Tiempo y Acción (Inferior Central):** Control minimalista `[ - ] 15:00 [ + ]` para ajustar el tiempo de la sesión y botón principal redondeado **"Comenzar Lectura"**.  
* **Zona 4 — Navegación Inferior:** Barra limpia con 3 accesos unificados: **"Lectura"**, **"Mi Jardín"** y **"Estadísticas"**, implementando fondo `#F7F5F0` en vistas fijas y `#FDFCFA` (`bg-elevated`) en listas desplazables, respetando `env(safe-area-inset-bottom)` para iOS Safari.

# **7\. Casos de Uso (v1.0)**

## **CU-01: Perfilado Inicial y Generación del Plan de Hábito**

* **Responsable (Actor Principal):** Usuario Lector (en su primer ingreso) / Motor Local de Hábitos.  
* **Precondiciones:** La aplicación se instala y ejecuta por primera vez en el dispositivo móvil; no existe aún un perfil de hábito configurado.  
* **Flujo Normal de Eventos:**  
  1. El sistema presenta la pantalla de bienvenida Zen e inicia el cuestionario secuencial de 5 preguntas (hábito anual, tiempo diario disponible, momento del día, principal obstáculo y estilo de reflexión con IA).  
  2. El usuario selecciona una opción (Quiz Option Card) en cada uno de los 5 pasos y pulsa "Continuar".  
  3. Al finalizar la quinta pregunta, el usuario pulsa "Generar Plan de Hábito".  
  4. El sistema crea un perfil local offline-first en IndexedDB (RF-07), calcula la meta diaria recomendada (ej. 15 min/día), genera el archivo de recordatorio .ics para importar en Apple Calendar o Google Calendar junto con un banner gentil In-App, y almacena la preferencia de conversación para Gemini.  
  5. El sistema redirige al usuario al Dashboard Principal con su primera semilla lista.  
* **Flujos Alternativos:**  
  * **FA-1.1 (Retroceso y modificación):** En cualquier paso del cuestionario (pasos 2 al 5), el usuario pulsa "Atrás", cambia su respuesta previa y continúa sin perder las demás selecciones.  
  * **FA-1.2 (Reconfiguración posterior):** El usuario accede al ícono de Ajustes desde el Dashboard en cualquier momento para actualizar su meta diaria o preferencia de reflexión con la IA.  
* **Postcondiciones:** Queda persistido localmente en IndexedDB el perfil del lector, el tiempo predeterminado del temporizador en el Dashboard y el parámetro de estilo conversacional para el backend de IA.

## **CU-02: Plantar un Libro Híbrido (.epub o Físico) y Gestión de Barbecho**

* **Responsable (Actor Principal):** Usuario Lector / Motor de Biblioteca y Parser epubjs.  
* **Precondiciones:** El usuario se encuentra en la vista "Mi Jardín" o despliega el selector de libros desde el Dashboard.  
* **Flujo Normal de Eventos (Camino Digital .epub):**  
  1. El usuario pulsa el botón "Plantar Libro".  
  2. El sistema despliega el modal híbrido con la pestaña "Importar .epub" activa por defecto.  
  3. El usuario selecciona un archivo .epub válido desde el almacenamiento de su dispositivo.  
  4. El sistema procesa el archivo mediante epubjs (XHTML/OPF), extrae automáticamente el Título, Autor y estructura de capítulos/posiciones CFI, guarda el blob del libro en IndexedDB y permite elegir la variación botánica del girasol (Clásica, Solar u Otoñal).  
  5. El usuario pulsa "Plantar Semilla en Mi Jardín".  
  6. El sistema crea la entidad Libro vinculada a un nuevo Girasol en Etapa 1 (Semilla: 0%) y lo marca como libro activo.  
* **Flujos Alternativos:**  
  * **FA-2.1 (Registro de Libro Físico):** En el paso 2, el usuario selecciona la pestaña "Libro Físico", ingresa manualmente el Título, Autor y el Total de páginas (número entero mayor a 0), elige la especie del girasol y guarda el registro.  
  * **FA-2.2 (Archivo corrompido o formato no soportado):** Si el archivo seleccionado no es un .epub válido o tiene DRM incompatible, el sistema muestra un aviso en tono \#C86D51 indicando el problema y ofrece registrar el libro en modo físico.  
  * **FA-2.3 (Poner un libro "En barbecho" / Archivar):** Si el usuario decide pausar indefinidamente una lectura, pulsa el ícono de archivo en la tarjeta del libro dentro de "Mi Jardín". El girasol pasa a la pestaña "En barbecho" con aspecto latente sin eliminarse su progreso histórico.  
* **Postcondiciones:** El libro queda registrado en la base de datos local IndexedDB (y en cola de sincronización para PostgreSQL si la cuenta está vinculada) asociado a un girasol único.

## **CU-03: Iniciar Sesión de Lectura (Focus Mode Híbrido)**

* **Responsable (Actor Principal):** Usuario Lector / Monitor Page Visibility y Temporizador.  
* **Precondiciones:** Existe un libro activo seleccionado en el Dashboard con progreso menor al 100%.  
* **Flujo Normal de Eventos:**  
  1. En el Dashboard Zen, el usuario ajusta la duración deseada mediante los botones \[-\] y \[+\] en incrementos de 5 minutos (mínimo 5:00, máximo 120:00).  
  2. El usuario pulsa el botón principal ("Abrir Lector ePub Zen" o "Comenzar Lectura Física").  
  3. El sistema registra la hora de inicio en la zona horaria local del dispositivo (RF-06) e inicia la cuenta regresiva:  
  4. Si el libro es EPUB, despliega el Lector ePub Zen con tipografía Lora, controles de tamaño de fuente (16px–22px), paginación fluida y el reloj sutil en el header superior. Si es FÍSICO, oculta la navegación inferior y muestra el lienzo del girasol respirando suavemente junto al reloj.  
  5. El usuario mantiene la pestaña o PWA activa en primer plano hasta que el temporizador llega a 00:00.  
* **Flujos Alternativos:**  
  * **FA-3.1 (Salida a segundo plano y Período de Gracia de 15 segundos \- RF-02):** Si el usuario minimiza el navegador, cambia de pestaña o pasa a segundo plano durante la sesión activa (detectado mediante Page Visibility API con `document.visibilityState` y el evento `visibilitychange`), el sistema activa un contador de gracia de 15 segundos y muestra una alerta gentil en Terracota (\#C86D51 / \#D97F64). Si el usuario regresa antes de los 15 segundos, la sesión continúa normalmente.  
  * **FA-3.2 (Expiración del período de gracia \- Sesión invalidada):** Si transcurren más de 15 segundos fuera de la vista activa de la PWA, el sistema invalida la sesión actual sin modificar el progreso previo del girasol y notifica al usuario al volver.  
  * **FA-3.3 (Finalización anticipada válida "Terminé antes de tiempo" \- RF-02):** Si el usuario pulsa "Terminé antes de tiempo" habiendo completado al menos el 50% de la duración programada (o porque terminó el 100% del libro), el sistema da por válida la sesión y pasa al CU-04. Si lleva menos del 50%, solicita confirmación para cancelar la sesión sin guardar avance.  
* **Postcondiciones:** Se registra una sesión de lectura válida lista para actualizar el crecimiento del girasol y la racha diaria.

## **CU-04: Finalizar Lectura, Actualizar Progreso y Racha**

* **Responsable (Actor Principal):** Usuario Lector / Motor Botánico y de Progreso.  
* **Precondiciones:** El usuario ha completado satisfactoriamente una sesión de lectura en el CU-03.  
* **Flujo Normal de Eventos:**  
  1. Al concluir el tiempo, el sistema evalúa el formato del libro activo:  
  2. **Para .epub:** Calcula automáticamente el nuevo porcentaje de lectura a partir de la última posición CFI/XHTML alcanzada y extrae en memoria los párrafos leídos durante la sesión. **Para FÍSICO:** Despliega el Paso 1 del Bottom Sheet Zen solicitando la página actual alcanzada, el usuario ajusta el número y pulsa "Actualizar Girasol".  
  3. El sistema recalcula el porcentaje total (página\_actual / total\_páginas \* 100\) y actualiza la etapa visual del girasol (Semilla 0-24%, Tallo 25-59%, Capullo 60-99%, Flor Completa 100%).  
  4. El sistema verifica si es la primera sesión válida del día calendario (según la hora local de inicio registrada en CU-03) e incrementa el contador de racha diaria.  
  5. El sistema avanza inmediatamente al Paso 2 del modal post-lectura (CU-05).  
* **Flujos Alternativos:**  
  * **FA-4.1 (Avance físico menor al 1% — Bono de Vitalidad Solar \- RF-03):** Si en un libro físico muy extenso el usuario leyó durante toda la sesión pero el incremento porcentual es menor al 1%, el sistema otorga un Bono de Vitalidad Solar (halo luminoso animado alrededor del girasol) y suma igualmente la racha diaria para mantener la motivación.  
  * **FA-4.2 (Libro completado al 100%):** Si el progreso alcanza el 100%, el girasol ejecuta la animación de florecimiento completo (Etapa 4\) y el libro se clasifica en la galería de "Florecidos 100%" dentro de Mi Jardín.  
* **Postcondiciones:** El porcentaje del libro, la etapa del girasol y la racha del usuario quedan actualizados localmente en IndexedDB (Dexie.js) y sincronizados con PostgreSQL cuando haya red disponible.

## **CU-05: Charla Reflexiva Post-Lectura con IA (Gemini API)**

* **Responsable (Actor Principal):** Usuario Lector / Backend Django \+ API de Google Gemini.  
* **Precondiciones:** Se ha guardado el progreso de la sesión en el CU-04 y se muestra el Paso 2 del Bottom Sheet Zen ("¿Quieres charlar un poco sobre lo que acabas de leer?").  
* **Flujo Normal de Eventos (Flujo A — Acepta conversar):**  
  1. El usuario pulsa el botón primario "Sí, conversar con Komi".  
  2. El sistema abre la vista de Chat con IA mostrando la píldora de contexto del libro y el indicador "Ciclo Zen: Turno 1 de 5".  
  3. El backend construye el prompt contextualizado según la modalidad (RF-05):  
  4. **En modo .epub:** Inyecta el fragmento XHTML exacto leído en la sesión junto con el estilo de reflexión elegido en el Onboarding. **En modo FÍSICO:** Configura un prompt guiado anti-alucinaciones con el Título y Autor de la obra, iniciando con una pregunta abierta que invita al lector a compartir qué escena o idea le llamó la atención.  
  5. La API de Gemini responde mediante streaming de texto (iniciando en menos de 3 segundos, RNF-03).  
  6. El usuario y Komi intercambian reflexiones hasta alcanzar el máximo de 5 turnos.  
  7. En el quinto turno, Komi ofrece una conclusión reflexiva de cierre y el sistema habilita el botón "Guardar reflexión y volver al jardín".  
* **Flujos Alternativos:**  
  * **FA-5.1 (Flujo B — Decide no charlar):** En el modal post-lectura, el usuario pulsa "Por hoy no, volver al jardín". El sistema cierra el modal y regresa directamente al Dashboard Principal mostrando el girasol actualizado.  
  * **FA-5.2 (Sin conexión a internet en el momento del chat \- RNF-04):** Si el dispositivo está offline al intentar abrir el chat, el sistema informa suavemente que el progreso del girasol y la racha ya están guardados localmente, pero que la charla con Komi requiere conexión activa.  
  * **FA-5.3 (Salida anticipada del chat):** El usuario puede pulsar "Volver al jardín" en el header superior en cualquier turno previo al quinto para concluir la conversación cuando lo desee.  
* **Postcondiciones:** La sesión de reflexión concluye, se incrementa el contador de charlas reflexivas en estadísticas y el usuario retorna al Dashboard Zen.

## **CU-06: Consulta de Estadísticas, Jardín y Sincronización de Cuenta**

* **Responsable (Actor Principal):** Usuario Lector / Servicio de Sincronización Django-PostgreSQL.  
* **Precondiciones:** El usuario navega hacia las pestañas "Mi Jardín" o "Estadísticas" desde la barra de navegación inferior.  
* **Flujo Normal de Eventos:**  
  1. El usuario selecciona "Estadísticas" en la barra inferior.  
  2. El sistema renderiza la racha actual de días consecutivos, el conteo de girasoles florecidos al 100%, el gráfico de barras con los minutos leídos en cada día de la semana y el total de charlas reflexivas con Komi.  
  3. El usuario consulta el estado de su perfil local y pulsa "Vincular Google Sign-In para Respaldo Remoto" (RF-07).  
  4. El sistema autentica el token del usuario contra el backend en Django y sincroniza bidireccionalmente su biblioteca de libros, estados de girasoles e historial de sesiones con la base de datos PostgreSQL.  
* **Flujos Alternativos:**  
  * **FA-6.1 (Uso 100% Offline-First con Service Worker):** Si el usuario decide no vincular ninguna cuenta externa, todas las métricas, libros y rachas continúan operando íntegramente en IndexedDB (Dexie.js) y cacheadas por Service Worker sin bloquear ninguna funcionalidad.  
* **Postcondiciones:** El usuario visualiza su evolución lectora y, si vinculó su cuenta, sus datos quedan respaldados de forma segura en PostgreSQL.

# **8\. Requerimientos Funcionales (RF) y No Funcionales (RNF)**

## **Requerimientos Funcionales**

| Identificador | Descripción del Requisito Funcional |
| :---- | :---- |
| **RF-01** | El sistema debe permitir crear libros mediante importación de archivos `.epub` o registro manual de libros físicos por páginas, asociándolos de forma única a una entidad "Girasol" con 4 estados visuales de crecimiento (Semilla: 0-24%, Tallo: 25-59%, Capullo: 60-99%, Flor completa: 100%) y un estado "Archivado/En barbecho" para lecturas pausadas o abandonadas. |
| **RF-02** | El sistema debe proveer un temporizador configurable en bloques de 5 minutos que monitoree el estado en primer plano mediante Page Visibility API (`document.visibilityState` / evento `visibilitychange`) durante la sesión de lectura, incluyendo un período de gracia de 15 segundos en segundo plano antes de anular la sesión y permitiendo finalización anticipada válida tras completar al menos el 50% del tiempo estipulado. |
| **RF-03** | El sistema debe calcular automáticamente el porcentaje de avance mediante la posición CFI/XHTML en libros `.epub` y a través del ingreso de páginas en libros físicos, actualizando la etapa del girasol tras cada sesión completada y aplicando un bono visual de vitalidad en avances menores al 1%. |
| **RF-04** | Al terminar una sesión de lectura y registrar el avance, el sistema debe presentar un modal de decisión (Sí/No) para abrir el chat con IA o volver al Dashboard. |
| **RF-05** | El backend debe integrarse con la API de Gemini mediante inyección dual de prompt: pasando los fragmentos exactos de texto leídos en libros `.epub`, o mediante contextualización guiada anti-alucinaciones basada en título y autor para libros físicos, limitando el intercambio a un máximo de 5 turnos por sesión. |
| **RF-06** | El sistema debe incrementar y mantener la racha diaria del usuario al completar al menos una sesión de lectura válida por día calendario, contabilizada según la hora de inicio de la sesión en la zona horaria local del dispositivo (preservando la racha en lecturas nocturnas que cruzan la medianoche). |
| **RF-07** | El sistema debe permitir la autenticación ligera mediante perfil local offline-first en IndexedDB (Dexie.js) con soporte de Service Worker, brindando la opción voluntaria de vincular la cuenta (Google Sign-In / Correo electrónico) para sincronización y respaldo en PostgreSQL. |

## **Requerimientos No Funcionales**

| Identificador | Categoría | Descripción del Requisito No Funcional |
| :---- | :---- | :---- |
| **RNF-01** | Estética y Usabilidad | Ninguna pantalla principal debe contener más de 4 bloques funcionales visibles simultáneamente, garantizando un mínimo de 40% de espacio libre (whitespace). |
| **RNF-02** | Rendimiento y Batería | Los gráficos de los girasoles deben implementarse en SVG nativo del DOM y `lucide-react` para minimizar el consumo energético durante sesiones prolongadas de temporizador. |
| **RNF-03** | Latencia de IA | Las respuestas del chat con Gemini deben iniciar su renderizado en pantalla en menos de 3 segundos mediante streaming de texto. |
| **RNF-04** | Tolerancia a Fallos | El temporizador, el Service Worker para caché offline de la PWA y el guardado de progreso local en IndexedDB (Dexie.js) deben operar sin interrupciones ante microcortes de red, sincronizando con PostgreSQL al restablecer la conexión (únicamente el módulo de chat con IA exigirá conexión activa). |

# **9\. Brand Sheet (Identidad de Marca y Tokens Base)**

## **9.1 Esencia y Personalidad Visual**

* **Concepto:** *Komorebi* (luz solar filtrándose entre las hojas) \+ Lectura consciente.  
* **Principios de Diseño:** Espacio negativo generoso (mínimo 40% por vista), ausencia de bordes negros duros, transiciones lentas (300ms–400ms `ease-out`) y contraste cálido.

## **9.2 Sistema de Color (Design Tokens)**

| Token | Nombre | Código Hex | Rol en la Interfaz |
| :---- | :---- | :---- | :---- |
| `bg-primary` | Papel Arroz | `#F7F5F0` | Fondo general de todas las pantallas |
| `bg-surface` | Piedra Suave | `#EAE6DF` | Tarjetas de libros, burbujas de IA y contenedores |
| `bg-elevated` | Lino Cálido | `#FDFCFA` | Modales emergentes y barra de navegación inferior |
| `accent-primary` | Amarillo Ocre | `#E5A93C` | Botón CTA principal, pétalos del girasol y controles activos |
| `accent-secondary` | Verde Salvia | `#6B8E78` | Tallo del girasol, barras de progreso y rachas completadas |
| `text-primary` | Carbón Profundo | `#2C302E` | Títulos, temporizador y cuerpo de texto principal |
| `text-secondary` | Tierra Café | `#7A7267` | Autores, etiquetas secundarias y estados inactivos |
| `border-subtle` | Arena Oscura | `#DCD6CC` | Divisores de 1px y bordes de inputs |
| `state-warning` | Terracota Suave | `#C86D51` | Alerta gentil cuando el usuario sale del Focus Mode |

## **9.3 Sistema Tipográfico**

* **Fuente Editorial (Títulos y Nombres de Libros):** *Lora* o *Newsreader* (Pesos: Medium 500, SemiBold 600).  
* **Fuente UI y Números (Controles, Chat y Temporizador):** *Plus Jakarta Sans* o *DM Sans* (Pesos: Regular 400, Medium 500, Bold 700 con `tabular-nums`).  
* **Escala Tipográfica Mobile:**  
  * `Display Timer`: 48px (Line-height: 56px, Sans-Serif SemiBold) — Reloj central.  
  * `H1 Title`: 24px (Line-height: 32px, Serif SemiBold) — Títulos de sección y modales.  
  * `H2 Book Title`: 20px (Line-height: 28px, Serif Medium) — Nombre del libro activo en el Dashboard.  
  * `Body Regular`: 16px (Line-height: 24px, Sans-Serif Regular) — Mensajes del chat con Gemini y preguntas.  
  * `Caption / Meta`: 13px (Line-height: 18px, Sans-Serif Medium) — Autor, porcentaje de avance y racha.

## **9.4 Geometría, Espaciado y Elevación**

* **Grilla Base:** Múltiplos de `8px` (`8px`, `16px`, `24px`, `32px`, `48px`). Margen lateral de pantalla fijo en `24px`.  
* **Radios de Borde (Border Radius):**  
  * Botones y Píldoras (Pills): `999px` (totalmente redondeados, orgánicos).  
  * Tarjetas de Libros y Modales: `20px`.  
  * Inputs de texto y Opciones de cuestionario: `12px`.  
* **Sombras (Zen Elevation):** Sombra difusa cálida para modales: `0px 8px 24px rgba(44, 48, 46, 0.06)`.  
* **Estilo de Ilustración e Iconografía:**  
  * Iconos de trazo continuo redondeado (`stroke-width: 1.75px`), estilo *Lucide* o *Phosphor Icons* en `#2C302E` o `#7A7267`.  
  * Ilustración del Girasol (SVG) estilo *Flat Line-Art* orgánico con trazos en `#2C302E` y rellenos planos en `#6B8E78` y `#E5A93C`.

## **9.5 Modo Oscuro: "Tsukimi" (Noche en el Jardín)**

Para preservar la calma visual durante las lecturas nocturnas ("Antes de dormir"), el Modo Oscuro evita el negro puro (\#000000) que ocasiona fatiga visual por alto contraste (efecto halation), empleando tonos de bosque nocturno, piedra musgo y luz ámbar lunar:

| Token | Modo Claro (Komorebi \- Día) | Modo Oscuro (Tsukimi \- Noche) | Rol en la Interfaz |
| :---- | :---- | :---- | :---- |
| `bg-primary` | `#F7F5F0` (Papel Arroz) | `#181A18` (Bosque Nocturno) | Fondo general del Dashboard y lienzo del lector .epub nocturno |
| `bg-surface` | `#EAE6DF` (Piedra Suave) | `#232623` (Piedra Musgo Oscura) | Tarjetas de libros en Mi Jardín, burbujas de IA y controles \[-\] \[+\] |
| `bg-elevated` | `#FDFCFA` (Lino Cálido) | `#2C302C` (Carbón Cálido) | Modales Bottom Sheet y barra de navegación sobre listas con scroll |
| `accent-primary` | `#E5A93C` (Amarillo Ocre) | `#EBB85B` (Ámbar Lunar) | Botón CTA principal, pétalos del girasol e indicadores activos |
| `accent-secondary` | `#6B8E78` (Verde Salvia) | `#82A890` (Salvia Iluminado) | Tallo del girasol, barras de progreso y burbujas del usuario |
| `text-primary` | `#2C302E` (Carbón Profundo) | `#ECE8DF` (Pergamino Suave) | Texto de lectura .epub, títulos y temporizador |
| `text-secondary` | `#7A7267` (Tierra Café) | `#A09A8E` (Ceniza Cálida) | Metadatos, autores, etiquetas secundarias y estados en barbecho |
| `border-subtle` | `#DCD6CC` (Arena Oscura) | `#363A36` (Corteza Oscura) | Divisores sutiles de 1px y bordes de inputs |
| `state-warning` | `#C86D51` (Terracota Suave) | `#D97F64` (Arcilla Cálida) | Alerta gentil de período de gracia (15s) en segundo plano |

# **10\. Component Sheet (Catálogo de Componentes UI)**

## **10.1 Botones (Buttons)**

* **Primary CTA (`Comenzar Lectura` / `Guardar`):** Fondo `#E5A93C`, texto `#2C302E` en negrita, altura `56px`, ancho mínimo `220px`, radio `999px`. Estado presionado: `#D1962F` con escala `0.98`.  
* **Secondary / Ghost (`Saltar charla` / `Cancelar`):** Fondo transparente, borde `1px solid #DCD6CC`, texto `#7A7267`, altura `48px`, radio `999px`.  
* **Icon Stepper (`[-] y [+]` del Temporizador):** Botones circulares de `44x44px`, fondo `#EAE6DF`, ícono `#2C302E`.

## **10.2 Lienzo del Girasol y Progreso (Sunflower Stage Widget)**

* **Contenedor Circular (Halo):** Círculo central de `220x220px` con borde sutil `#EAE6DF` y fondo `#FAF8F5`.  
* **Estados del Componente SVG:** Estado 1 (0–24% Semilla), Estado 2 (25–59% Tallo con hojas), Estado 3 (60–99% Capullo), Estado 4 (100% Girasol abierto completo).  
* **Barra de Progreso del Libro:** Altura `6px`, ancho `160px`, fondo `#EAE6DF`, relleno `#6B8E78` con bordes redondeados.

## **10.3 Tarjeta de Libro / Girasol (Book Garden Card)**

* **Estructura:** Tarjeta con `16px` de padding, fondo `#EAE6DF`, radio `20px`.  
* **Contenido:** Miniatura del girasol (`48x48px`), Título del libro (Serif `16px`), Autor (`13px #7A7267`), badge identificador de formato (`EPUB` o `FÍSICO`) y badge de porcentaje en verde salvia. Borde activo de `1.5px solid #E5A93C`. Al tocar un girasol se despliega el cajón de "Semillas del Día" (`key_takeaway`) cosechadas en ese libro.

## **10.4 Tarjeta de Opción de Onboarding (Quiz Option Card)**

* **Estructura:** Bloque de ancho completo, altura mínima `60px`, fondo `#EAE6DF`, radio `12px`. Estado seleccionado con fondo `#F7F5F0` y borde `2px solid #6B8E78`.

## **10.5 Modal Post-Lectura y Registro (Bottom Sheet Zen)**

* **Estructura:** Panel inferior deslizable (`border-top-radius: 28px`, fondo `#FDFCFA`).  
* **Paso 1 (Progreso):** Input numérico de página alcanzada (exclusivo para modalidad Libro Físico; en .epub se omite por cálculo automático).  
* **Paso 2 (Trigger de IA):** Pregunta en Serif *"¿Quieres charlar un poco sobre lo que acabas de leer?"* con botón primario **"Sí, conversar con Komi"** y botón secundario **"Por hoy no, volver al jardín"**.

## **10.6 Componentes del Chat con Gemini (AI Reader Companion)**

* **Header de Contexto:** Píldora superior fija con ícono vectorial de girasol: Hablando sobre: \[Título del Libro\] — \[Porcentaje% o Pág. X\].  
* **Burbuja de IA (Komi):** Fondo `#EAE6DF`, texto `#2C302E`, esquinas `18px`.  
* **Burbuja de Usuario:** Fondo `#6B8E78`, texto `#F7F5F0`, esquinas `18px`.  
* **Input de Mensaje:** Barra flotante con radio `999px`, fondo `#EAE6DF` y botón de envío en `#E5A93C`.

## **10.7 Navegación y Header**

* **Badge de Racha (Header):** Píldora compacta (`padding: 6px 12px`, fondo `#EAE6DF`), ícono de sol en `#E5A93C` \+ texto de racha.  
* **Bottom Navigation Minimalista:** Altura `64px` (más padding `env(safe-area-inset-bottom)` en iOS Safari), fondo `#F7F5F0` en vistas fijas y `#FDFCFA` (`bg-elevated`) sobre listas con scroll, con tres accesos unificados: **"Lectura"**, **"Mi Jardín"** y **"Estadísticas"**.

## **10.8 Lector ePub Zen (ePub Reader View)**

* **Lienzo de Lectura:** Fondo inmersivo en Papel Arroz (`#F7F5F0`) con tipografía *Lora* personalizable (tamaño de 16px a 22px, interlineado 1.6), libre de distracciones y con márgenes laterales cómodos de 24px.  
* **Header Superior Minimalista:** Barra sutil que muestra el tiempo restante de la sesión de lectura, indicador de progreso porcentual discreto y acceso rápido a ajustes tipográficos.  
* **Cálculo Dinámico de Progreso:** Actualización automática de la posición CFI/XHTML al avanzar de página, registrando el fragmento textual para alimentar el contexto de Gemini al concluir la sesión.

# **11\. Arquitectura de Datos y API REST (PostgreSQL \+ Django)**

## **11.1 Justificación Arquitectónica (Enfoque Dual: Local \+ Remoto)**

Komi implementa una arquitectura de persistencia en dos niveles: almacenamiento local offline-first en el navegador mediante IndexedDB (Dexie.js) y una base de datos relacional centralizada en PostgreSQL gestionada por Django REST Framework. En iOS Safari, el respaldo remoto en PostgreSQL adquiere especial importancia para mitigar el purgado de almacenamiento impuesto por WebKit (ITP 7-Day Storage Eviction) si el usuario no abre la web en 7 días, blindando la biblioteca mediante la API de almacenamiento persistente (`navigator.storage.persist()`) y sincronización continua en la nube:

* **Respaldo de Rachas y Jardín:** Protege el historial de lectura y los girasoles florecidos ante pérdidas, formateos o cambios de dispositivo al vincular la cuenta del usuario (CU-06, RF-07).  
* **Seguridad de Credenciales y Control del Ciclo Zen de IA:** Resguarda la clave de la API de Google Gemini en el servidor y controla estrictamente el estado conversacional en base de datos para aplicar el límite de máximo 5 turnos por sesión (RF-05).  
* **Agregaciones Temporales y Zona Horaria:** Permite ejecutar consultas agrupadas para las métricas semanales y validar rachas basadas en la hora local de inicio de la sesión (protegiendo lecturas nocturnas que cruzan la medianoche, RF-06).  
* **Sincronización Ligera de Metadatos (.epub):** Los archivos `.epub` permanecen en el almacenamiento local IndexedDB del dispositivo para no saturar el servidor; PostgreSQL únicamente almacena los punteros de posición CFI/XHTML, el porcentaje de avance y el fragmento textual de la sesión activa.

## **11.2 Esquema Relacional de Base de Datos (5 Tablas Core)**

### **1\. Tabla `ReaderProfile` (Perfil y Motor de Hábitos — CU-01)**

Extiende el usuario base de Django para almacenar la configuración del Onboarding y el estado de las rachas:

* `id` (UUID, PK): Identificador único generado en el cliente PWA para soporte offline-first.  
* `user` (OneToOneField \-\> `auth.User`, Nullable): Nulo en modo local anónimo; se vincula al autenticar con Google Sign-In (RF-07).  
* `daily_goal_minutes` (Integer, default: 15): Meta diaria en minutos calculada en el cuestionario inicial.  
* `preferred_moment` (Enum: `MORNING`, `AFTERNOON`, `NIGHT`, `COMMUTE`): Momento del día configurado para recordatorios.  
* `ai_reflection_style` (Enum: `MEMORY_QUIZ`, `DEEP_ANALYSIS`, `KEY_SUMMARY`): Preferencia de reflexión inyectada al prompt de Gemini.  
* `current_streak` (Integer, default: 0): Racha actual de días consecutivos de lectura.  
* `longest_streak` (Integer, default: 0): Racha histórica más alta alcanzada por el lector.  
* `last_valid_session_date` (Date, Nullable): Fecha calendario local de la última sesión válida (RF-06).

### **2\. Tabla `BookGarden` (Entidad Unificada Libro-Girasol — CU-02, RF-01)**

Modela la relación 1 a 1 entre cada libro registrado y su girasol virtual correspondiente:

* `id` (UUID, PK): Identificador único del libro/girasol.  
* `profile_id` (FK \-\> `ReaderProfile`): Lector propietario del jardín.  
* `title` (VARCHAR 255): Título del libro.  
* `author` (VARCHAR 255): Autor del libro.  
* `format_type` (Enum: `EPUB`, `PHYSICAL`): Define la modalidad de lectura y el tipo de prompt para la IA.  
* `sunflower_variant` (Enum: `CLASSIC`, `SOLAR`, `AUTUMN`): Variación botánica elegida al plantar la semilla.  
* `growth_stage` (Enum: `SEED_1`, `STEM_2`, `BUD_3`, `BLOOM_4`): Etapa visual según el avance (0-24%, 25-59%, 60-99%, 100%).  
* `status` (Enum: `ACTIVE`, `GROWING`, `BLOOMED`, `FALLOW`): Estado en la biblioteca (`FALLOW` representa libros archivados "En barbecho").  
* `progress_percentage` (Decimal 5,2, default: 0.00): Porcentaje de avance total (`0.00` a `100.00`).  
* `total_pages` (Integer, Nullable): Total de páginas (requerido para modalidad `PHYSICAL`).  
* `current_page` (Integer, default: 0): Última página alcanzada en modalidad física.  
* `last_epub_cfi` (Text, Nullable): Coordenada exacta XHTML/CFI de lectura en modalidad `.epub` (RF-03).  
* `created_at` / `completed_at` (DateTime): Marcas temporales de plantado y florecimiento al 100%.

### **3\. Tabla `ReadingSession` (Sesiones de Lectura y Temporizador — CU-03, CU-04)**

Registra cada ejecución del Focus Mode y alimenta el módulo de estadísticas semanales:

* `id` (UUID, PK): Identificador de la sesión.  
* `book_id` (FK \-\> `BookGarden`): Libro leído durante la sesión.  
* `planned_duration_sec` (Integer): Tiempo configurado en el temporizador (en segundos).  
* `actual_duration_sec` (Integer): Tiempo efectivo de lectura (soporta finalización anticipada válida tras superar el 50% del tiempo, RF-02).  
* `started_at_local` (DateTime): Fecha y hora local de inicio de la sesión para cómputo de rachas nocturnas (RF-06).  
* `session_status` (Enum: `COMPLETED`, `EARLY_VALID`, `INVALIDATED_GRACE_EXPIRED`): Estado final de la sesión tras validar el período de gracia de 15 segundos.  
* `progress_delta` (Decimal 5,2): Incremento porcentual logrado en la sesión.  
* `granted_solar_bonus` (Boolean, default: False): Indica si se otorgó el Bono de Vitalidad Solar en avances físicos menores al 1% (FA-4.1).  
* `extracted_epub_excerpt` (Text, Nullable): Párrafos XHTML extraídos durante la sesión en modo `.epub` para contextualizar a Gemini (RF-05).

### **4\. Tabla `ReflectionChat` (Sesión de Charla con Komi — CU-05)**

Se instancia cuando el usuario acepta conversar con la IA al concluir su lectura (RF-04):

* `id` (UUID, PK): Identificador de la charla reflexiva.  
* `session_id` (OneToOneField \-\> `ReadingSession`): Sesión de lectura que originó la charla.  
* `turn_count` (SmallInteger, default: 1): Contador estricto del Ciclo Zen (`1` a `5` intercambios, RF-05).  
* `is_closed` (Boolean, default: False): Indica si la sesión alcanzó el quinto turno o fue cerrada por el usuario.  
* `key_takeaway` (Text, Nullable): Síntesis o reflexión final generada al cerrar el ciclo.

### **5\. Tabla `ReflectionMessage` (Historial de Mensajes del Chat)**

Almacena el intercambio de mensajes dentro de cada sesión conversacional:

* `id` (BigAutoField, PK): Identificador secuencial del mensaje.  
* `chat_id` (FK \-\> `ReflectionChat`): Conversación a la que pertenece.  
* `sender` (Enum: `KOMI_AI`, `USER`): Autor del mensaje.  
* `content` (Text): Contenido textual del mensaje.  
* `turn_number` (SmallInteger): Número de turno correspondiente (`1` a `5`).  
* `created_at` (DateTime): Marca de tiempo del envío.

## **11.3 Arquitectura de Endpoints REST (Django REST Framework — API v1)**

| Módulo | Método y Ruta (Endpoint) | Descripción Funcional y Lógica de Negocio |
| :---- | :---- | :---- |
| **Perfil y Sync** | `POST /api/v1/profile/onboarding/` | Registra las 5 respuestas del cuestionario inicial, calcula la meta diaria recomendada y configura el perfil lector (CU-01). |
| **Perfil y Sync** | `POST /api/v1/profile/sync/` | Endpoint de sincronización offline-first (CU-06, RNF-04). Recibe lotes JSON con libros y sesiones locales, consolida en PostgreSQL y devuelve la racha actualizada. |
| **Mi Jardín** | `GET /api/v1/garden/books/` | Lista los libros/girasoles del usuario con filtros por estado (`ACTIVE`, `BLOOMED`, `FALLOW` / En barbecho). |
| **Mi Jardín** | `POST /api/v1/garden/books/` | Planta un nuevo libro/girasol (CU-02) a partir de los metadatos extraídos de un `.epub` o del formulario de libro físico. |
| **Mi Jardín** | `PATCH /api/v1/garden/books/{id}/` | Cambia el libro activo en el Dashboard o actualiza su estado a "En barbecho" (FA-2.3). |
| **Sesiones** | `POST /api/v1/sessions/complete/` | Procesa el cierre de una sesión de lectura (CU-04): recalcula el porcentaje, actualiza la etapa del girasol, evalúa el Bono de Vitalidad Solar y actualiza la racha diaria. |
| **IA (Gemini)** | `POST /api/v1/companion/start/` | Inicia el chat post-lectura (CU-05) construyendo el prompt dual (fragmento XHTML en `.epub` o prompt anti-alucinaciones en físico) y responde vía streaming (`StreamingHttpResponse`, RNF-03). |
| **IA (Gemini)** | `POST /api/v1/companion/{chat_id}/message/` | Procesa cada respuesta del lector verificando que `turn_count <= 5`. En el turno 5 genera la conclusión de cierre y marca `is_closed = True`. |
| **Estadísticas** | `GET /api/v1/stats/weekly/` | Ejecuta agregaciones ORM (`Sum('actual_duration_sec')`) para retornar los minutos leídos por día de la semana, total de girasoles florecidos y charlas completadas (CU-06). |

## **11.4 Resolución de Conflictos y Persistencia en iOS Safari (/api/v1/profile/sync/)**

Para garantizar la integridad y coherencia entre el almacenamiento local offline-first y la base de datos PostgreSQL, el endpoint aplica las siguientes reglas deterministas:

* **Sesiones (ReadingSession):** Unión aditiva e idempotente mediante identificadores UUID generados en el cliente PWA. Las sesiones existentes nunca se sobrescriben ni eliminan; las sesiones sincronizadas se insertan y consolidan de forma permanente.  
* **Progreso de Libros (BookGarden):** Regla de progreso monotónico creciente. Ante cualquier discrepancia entre IndexedDB local y PostgreSQL, prevalece siempre el valor `MAX(progress_percentage)` junto con el puntero `last_epub_cfi` asociado a la marca temporal `updated_at` más reciente.  
* **Protección contra Purgado de Safari (ITP 7-Day Storage Eviction y Persistent Storage API):** En iOS Safari, los datos almacenados en IndexedDB corren riesgo de purgado automático si el usuario permanece más de 7 días sin interactuar con la app, a menos que esté instalada en la pantalla de inicio (`display: standalone`) y solicite cuota protegida. Komi solventa esto con un mecanismo integral en cliente y servidor:  
  * **1\. Almacenamiento Persistente:** Al inicializar la PWA en `App.tsx`, se invoca `navigator.storage.persist()` para solicitar al sistema operativo eximir a la app de limpiezas automáticas por espacio.  
  * **2\. Auto-Sync Inmediato Post-Sesión (Write-Through):** Además de la sincronización por lotes, cada vez que el usuario concluye una sesión de lectura (`POST /api/v1/sessions/complete/`) o planta un libro disponiendo de red activa, el cliente realiza un envío inmediato a PostgreSQL y replica el `profile_id` (UUID) en IndexedDB, `localStorage` y una cookie segura de larga duración (`Max-Age=31536000`).  
  * **3\. Hidratación Automática al Abrir (`GET /api/v1/profile/sync/restore/`):** Si el usuario abre la PWA tras semanas de inactividad y su IndexedDB local fue limpiado por iOS, el cliente recupera su identificador o sesión de Google OAuth y restaura de forma transparente todo su jardín, porcentajes, punteros `last_epub_cfi` y rachas desde PostgreSQL. Si el archivo binario `.epub` fue eliminado localmente por el sistema, la tarjeta del libro muestra un aviso gentil *"Reimportar archivo .epub para continuar en el X%"*, preservando intactos el girasol, las notas y el progreso alcanzado.

# **12\. Diagrama de Componentes y Despliegue**

## **12.1 Diagrama de Arquitectura de Componentes**

**Especificación Mermaid del Diagrama de Componentes:**

```
flowchart TB
    subgraph Mobile["Subsistema Cliente PWA (React + Vite + TypeScript)"]
        UI_Garden["UI: Dashboard Zen & Mi Jardín"]
        UI_Reader["UI: Lector ePub & Focus Mode"]
        UI_Chat["UI: Compañero IA & Estadísticas"]

        Comp_Botanic["Motor Botánico SVG & Hábitos"]
        Comp_Epub["Motor ePub (epubjs XHTML/CFI) & Page Visibility Monitor"]
        Comp_Sync["Gestor de Sincronización Offline-First"]

        Local_DB[("IndexedDB (Dexie.js) + Almacenamiento .epub")]

        UI_Garden --> Comp_Botanic
        UI_Reader --> Comp_Epub
        UI_Chat --> Comp_Sync

        Comp_Botanic --> Local_DB
        Comp_Epub --> Local_DB
        Comp_Sync --> Local_DB
    end

    subgraph Backend["Subsistema Backend (Django + Python)"]
        DRF["Controladores API REST (Django REST Framework)"]
        Svc_Auth["Servicio de Perfiles & Sync"]
        Svc_Streak["Motor de Rachas (Zona Horaria) & Métricas"]
        Svc_AI["Orquestador IA (Prompt Dual & Ciclo 5 Turnos)"]
        PG_DB[("PostgreSQL (5 Tablas Relacionales)")]

        DRF --> Svc_Auth
        DRF --> Svc_Streak
        DRF --> Svc_AI

        Svc_Auth --> PG_DB
        Svc_Streak --> PG_DB
        Svc_AI --> PG_DB
    end

    subgraph External["Servicios Cloud Externos"]
        Gemini["Google Gemini API"]
        GoogleAuth["Google OAuth 2.0"]
    end

    Comp_Sync <-->|"HTTPS / JSON + Streaming SSE"| DRF
    Svc_Auth <-->|"Validación Token"| GoogleAuth
    Svc_AI <-->|"SDK Python (Streaming < 3s)"| Gemini
```

## **12.2 Diagrama de Despliegue de Infraestructura**

**Especificación Mermaid del Diagrama de Despliegue:**

```
flowchart TB
    subgraph ClientNode["<<device>> Smartphone iOS (iPhone Safari) / Android"]
        subgraph AppEnv["PWA Standalone (HTTPS + navigator.storage.persist)"]
            AppArtifact["Artefacto: Komi PWA (React + Vite + Workbox SW)"]
            IndexedDBNode[("IndexedDB (Dexie.js) + Cookie UUID Backup")]
            EpubStorage[("IndexedDB: Blobs .epub")]
            AppArtifact --> IndexedDBNode
            AppArtifact --> EpubStorage
        end
    end

    subgraph FrontendHost["<<cloud CDN>> Vercel / Cloudflare Pages (HTTPS TLS 1.3)"]
        CDNEdge["Static Assets + manifest.webmanifest + Service Worker"]
    end

    subgraph CloudServer["<<cloud PaaS>> Render / Railway / Fly.io (HTTPS TLS 1.3)"]
        subgraph PythonEnv["<<execution environment>> Gunicorn + Uvicorn (ASGI)"]
            DjangoArtifact["Artefacto: Komi Django REST API"]
        end
    end

    subgraph DatabaseNode["<<managed DB>> Neon.tech / Supabase (PostgreSQL 16 SSL)"]
        PostgresDB[("Artefacto: komi_prod_db (5 Tablas Relacionales)")]
    end

    subgraph GoogleCloud["<<external cloud>> Google Cloud Services"]
        GeminiNode["Google Gemini API (google-genai)"]
        OAuthNode["Google OAuth 2.0"]
    end

    AppArtifact <-->|"HTTPS : 443 Carga Inicial PWA"| CDNEdge
    AppArtifact <-->|"HTTPS : 443 JSON REST / SSE Streaming"| DjangoArtifact
    DjangoArtifact <-->|"TCP/SSL : 5432 (Pooler Seguro)"| PostgresDB
    DjangoArtifact <-->|"HTTPS : 443 (API Key Segura)"| GeminiNode
    DjangoArtifact <-->|"HTTPS : 443 (JWT / OAuth)"| OAuthNode
```

## **12.3 Proveedores de Alojamiento Cloud con HTTPS (TLS 1.3) para iOS PWA**

iOS Safari exige conexión **HTTPS estricta (TLS 1.3)** como condición no negociable para habilitar Service Workers, Cache Storage, la API de persistencia (`navigator.storage.persist()`) y el banner de instalación en pantalla de inicio (*Add to Home Screen*). Para garantizar compatibilidad plena con cero costos operativos iniciales, se define la siguiente arquitectura de despliegue en producción:

* **Frontend PWA (komi\_frontend):** Alojado en **Vercel** o **Cloudflare Pages**. Provee distribución CDN perimetral global con certificado SSL automático, compresión Brotli y soporte nativo para rutas SPA y entrega con cabeceras correctas de `manifest.webmanifest` y del Service Worker.  
* **Backend Django ASGI (komi\_backend):** Desplegado en plataformas PaaS como **Render**, **Railway** o **Fly.io** bajo dominios seguros HTTPS (ej. `*.onrender.com` o `*.up.railway.app`). Ejecuta un servidor ASGI configurado con `gunicorn -k uvicorn.workers.UvicornWorker`, garantizando conexiones HTTP persistentes sin cortes de buffer proxy durante el streaming Server-Sent Events (SSE) de la API de Gemini.  
* **Base de Datos PostgreSQL 16:** Instancia gestionada sobre nube en **Neon.tech** (Serverless Postgres) o **Supabase**, conectada a través de túnel SSL seguro en el puerto 5432, con cuota gratuita persistente, backups automatizados y escalado a cero en inactividad.

# **13\. Diagrama de Paquetes y Estructura de Directorio**

## **13.1 Diagrama de Paquetes y Estructura de Directorios (Cliente y Backend)**

**Especificación Mermaid del Diagrama de Paquetes:**

```
flowchart TB
    subgraph MobilePkg["komi_frontend (React + Vite + TypeScript PWA)"]
        subgraph PresentationPkg["features (Capa de Presentación)"]
            F_Onboarding["onboarding"]
            F_Dashboard["dashboard"]
            F_Garden["garden_library"]
            F_Reader["focus_reader"]
            F_Chat["ai_companion"]
            F_Stats["stats"]
        end

        subgraph ServicesPkg["services (Motores Locales)"]
            S_Botanic["botanic_engine"]
            S_Epub["epub_parser (epubjs)"]
            S_Lifecycle["page_visibility_monitor"]
        end

        subgraph DataPkg["data (Capa de Datos Offline-First)"]
            D_Local["local_storage (IndexedDB / Dexie.js)"]
            D_Sync["sync_manager"]
            D_Api["rest_client"]
        end

        subgraph CorePkg["core (Design System Zen)"]
            C_Theme["theme (Komorebi / Tsukimi)"]
            C_Widgets["shared_widgets (Component Sheet)"]
        end

        PresentationPkg --> ServicesPkg
        PresentationPkg --> CorePkg
        ServicesPkg --> DataPkg
    end

    subgraph BackendPkg["komi_backend (Servidor Django REST)"]
        B_Config["config (ASGI / Settings / URLs)"]
        subgraph AppsPkg["apps (Dominios de Negocio)"]
            A_Profiles["profiles (Onboarding & Sync)"]
            A_Garden["garden (Libros & Girasoles)"]
            A_Sessions["reading_sessions (Rachas & Stats)"]
            A_Companion["ai_companion (Gemini & Prompts)"]
        end
        B_Config --> AppsPkg
        A_Companion --> A_Sessions
        A_Sessions --> A_Garden
        A_Garden --> A_Profiles
    end

    D_Api <-->|"HTTPS JSON / SSE"| B_Config
```

## **13.2 Árbol de Carpetas y Archivos: App PWA (React \+ Vite \+ TypeScript)**

```
komi_frontend/
├── index.html                             # Entry HTML con meta tags iOS (apple-mobile-web-app-capable)
├── vite.config.ts                         # Configuración de Vite + vite-plugin-pwa (manifest y Workbox SW)
├── tsconfig.json                          # Configuración estricta de TypeScript
├── package.json                           # react, react-dom, epubjs, dexie, lucide-react
├── public/
│   ├── icons/                             # Iconos apple-touch-icon (180x180) y PWA (192x192, 512x512)
│   └── fonts/
│       ├── Lora/                          # Fuente Serif editorial (Títulos y lector .epub)
│       └── PlusJakartaSans/               # Fuente UI y números tabulares del reloj
│
└── src/
    ├── main.tsx                           # Punto de montaje React DOM y registro del Service Worker
    ├── App.tsx                            # Proveedor de tema (Komorebi/Tsukimi), enrutador de vistas y DB
    │
    ├── core/                              # SISTEMA DE DISEÑO (Brand & Component Sheet)
    │   ├── theme/
    │   │   ├── colorTokens.ts             # Tokens Hex: Modo Claro (Komorebi) y Oscuro (Tsukimi)
    │   │   ├── typographyScale.ts         # Escala tipográfica (Display Timer 48px, H1, Body)
    │   │   └── ThemeContext.tsx           # Contexto global de tema y variables CSS (300ms ease-out)
    │   └── components/
    │       ├── ZenPrimaryButton.tsx       # Botón CTA redondeado (999px) en Amarillo Ocre
    │       ├── TimerStepperButton.tsx     # Botones circulares [-] y [+] de 44x44px
    │       ├── BottomNavZen.tsx           # Barra inferior unificada: Lectura, Mi Jardín, Estadísticas
    │       └── StreakBadge.tsx            # Píldora superior de racha diaria
    │
    ├── data/                              # CAPA DE DATOS (Offline-First IndexedDB & Sync)
    │   ├── local_db/
    │   │   ├── dexieDatabase.ts           # Instancia IndexedDB con Dexie.js (tablas + blobs .epub)
    │   │   ├── localBookRepository.ts     # CRUD local de libros, estados y punteros CFI
    │   │   └── localSessionRepository.ts  # Guardado local de sesiones y cola de sincronización
    │   └── network/
    │       ├── apiClient.ts               # Cliente HTTP/SSE hacia Django (cabecera X-Profile-Id, sin JWT; ver §18)
    │       └── syncService.ts             # Envía lotes pendientes a POST /api/v1/profile/sync/
    │
    ├── services/                          # MOTORES DE LÓGICA LOCAL
    │   ├── epubService.ts                 # Motor epubjs: parsea .epub, metadatos y texto XHTML leído
    │   ├── focusVisibilityService.ts      # Page Visibility API (visibilitychange + 15s de gracia)
    │   ├── botanicCalculator.ts           # Calcula etapa (1-4) y activa Bono de Vitalidad Solar
    │   └── calendarReminderService.ts     # Genera archivo .ics para recordatorio en iOS Calendar
    │
    └── features/                          # MÓDULOS DE PANTALLA (Casos de Uso CU-01 a CU-06)
        ├── onboarding/
        │   ├── OnboardingScreen.tsx       # Vista de las 5 preguntas iniciales + algoritmo (CU-01)
        │   └── QuizOptionCard.tsx         # Tarjeta seleccionable con borde Verde Salvia
        │
        ├── dashboard/
        │   ├── DashboardScreen.tsx        # Las 4 zonas limpias + Lienzo central del girasol
        │   └── SunflowerStageWidget.tsx   # Renderizador SVG DOM animado del girasol
        │
        ├── garden_library/
        │   ├── MyGardenScreen.tsx         # Pestañas: Activos, Florecidos (100%) y En Barbecho
        │   ├── BookGardenCard.tsx         # Tarjeta con miniatura, badge EPUB/FÍSICO y Semillas del Día
        │   └── PlantBookModal.tsx         # Modal híbrido para importar .epub o crear libro físico
        │
        ├── focus_reader/
        │   ├── EpubReaderScreen.tsx       # Lector ePub Zen (#F7F5F0 / #181A18) con reloj en header
        │   ├── PhysicalTimerScreen.tsx    # Pantalla de concentración para libro físico
        │   ├── GracePeriodBanner.tsx      # Alerta gentil en Terracota (#C86D51) de 15 segundos
        │   └── PostReadingSheet.tsx       # Bottom Sheet: Paso 1 (Páginas) y Paso 2 (¿Charlar con IA?)
        │
        ├── ai_companion/
        │   ├── CompanionChatScreen.tsx    # Vista de chat con contador "Ciclo Zen: Turno X de 5"
        │   └── ChatBubbleWidget.tsx       # Burbujas diferenciadas (Komi vs. Lector) con streaming
        │
        └── stats/
            └── StatsScreen.tsx            # Pestaña "Estadísticas": gráfica semanal, rachas y respaldo
```

## **13.3 Árbol de Carpetas y Archivos: Backend (Django REST Framework)**

```
komi_backend/
├── manage.py                              # CLI de administración de Django
├── requirements.txt                       # django, djangorestframework, psycopg, google-genai, uvicorn
├── .env                                   # Variables secretas (DATABASE_URL, GEMINI_API_KEY)
│
├── config/                                # NÚCLEO DE CONFIGURACIÓN DEL SERVIDOR
│   ├── settings.py                        # Configuración PostgreSQL, DRF, CORS y claves de entorno
│   ├── asgi.py                            # Punto de entrada asíncrono (Uvicorn) para Streaming SSE
│   └── urls.py                            # Enrutador principal (/api/v1/...)
│
└── apps/                                  # MÓDULOS DE NEGOCIO (5 Tablas Core)
    │
    ├── profiles/                          # MÓDULO 1: PERFIL, HÁBITOS Y SYNC (Tabla: ReaderProfile)
    │   ├── models.py                      # Modelo ReaderProfile (metas, estilo IA y rachas)
    │   ├── serializers.py                 # Validación de cuestionario y payload de sincronización
    │   ├── services.py                    # Lógica de consolidación de lotes offline-first
    │   ├── views.py                       # Endpoints: /onboarding/ y /sync/
    │   └── urls.py
    │
    ├── garden/                            # MÓDULO 2: BIBLIOTECA Y GIRASOLES (Tabla: BookGarden)
    │   ├── models.py                      # Modelo BookGarden (relación 1:1 Libro-Girasol, CFI, páginas)
    │   ├── serializers.py                 # Serialización de libros activos, florecidos y en barbecho
    │   ├── views.py                       # Endpoints GET, POST y PATCH de /garden/books/
    │   └── urls.py
    │
    ├── reading_sessions/                  # MÓDULO 3: SESIONES, RACHAS Y MÉTRICAS (Tabla: ReadingSession)
    │   ├── models.py                      # Modelo ReadingSession (duración, hora local, extracto XHTML)
    │   ├── streak_engine.py               # Evalúa started_at_local (protege rachas de medianoche) y bonos
    │   ├── stats_selectors.py             # Agregaciones ORM (Sum de minutos por día de la semana)
    │   ├── views.py                       # Endpoints: /sessions/complete/ y /stats/weekly/
    │   └── urls.py
    │
    └── ai_companion/                      # MÓDULO 4: ORQUESTADOR GEMINI (Tablas: ReflectionChat y Message)
        ├── models.py                      # Modelos ReflectionChat (turn_count <= 5) y ReflectionMessage
        ├── prompt_builder.py              # Construye el System Prompt Dual (.epub XHTML vs. Físico)
        ├── gemini_client.py               # Conexión con SDK google-genai y generador de Streaming (<3s)
        ├── views.py                       # Endpoints: /companion/start/ y /companion/{id}/message/
        └── urls.py
```

# **14\. Ingeniería de Prompts y Orquestación de Gemini API**

## **14.1 Arquitectura de Ensamblaje Dinámico (4 Capas)**

El módulo `apps/ai_companion/prompt_builder.py` construye el `system_instruction` de la API de Google Gemini concatenando 4 capas dinámicas en cada petición:  
**Capa 1 — Identidad Core y Reglas de Estilo Zen:** Define la voz pausada de Komi, limita las respuestas entre 50 y 90 palabras para lectura cómoda en móvil, prohíbe estrictamente spoilers más allá del porcentaje actual y exige cerrar con una única pregunta abierta en los turnos 1 al 4\.  
**Capa 2 — Modificador de Preferencia Pedagógica:** Inyecta el estilo elegido por el usuario en la Pregunta 5 del Onboarding (`MEMORY_QUIZ`, `DEEP_ANALYSIS` o `KEY_SUMMARY`).  
**Capa 3 — Contexto Literario Dual (.epub XHTML vs. Físico Anti-Alucinación):** En modalidad `.epub`, adjunta el fragmento exacto XHTML leído en la sesión (`extracted_epub_excerpt`). En modalidad `PHYSICAL`, activa el protocolo anti-alucinaciones basado en Título, Autor y Página reportada, pidiendo al lector en el Turno 1 que comparta la escena o idea leída antes de profundizar.  
**Capa 4 — Controlador de Estado del Ciclo Zen (Turnos 1 al 5):** Regula la progresión conversacional desde la apertura (Turno 1\) hasta el cierre obligatorio (Turno 5), donde prohíbe hacer más preguntas y genera el marcador `[SEMILLA_DEL_DIA]:` para almacenar la síntesis en `ReflectionChat.key_takeaway`.

## **14.2 Plantillas de System Prompts (`prompt_builder.py`)**

```py
# komi_backend/apps/ai_companion/prompt_builder.py

BASE_ZEN_PERSONA = """
Eres Komi, un compañero de lectura sereno, reflexivo y cálido integrado en una aplicación de hábitos de lectura con estética Zen.
Tu propósito es ayudar al lector a interiorizar y disfrutar lo que acaba de leer, cuidando el crecimiento de su girasol virtual.

REGLAS ESTRICTAS DE COMPORTAMIENTO:
1. Tono y Extensión: Mantén un tono pausado, empático y libre de juicios. Tus respuestas deben ser concisas (entre 50 y 90 palabras máximo) para leerse cómodamente en la pantalla de un teléfono móvil.
2. Cero Spoilers (Regla de Oro): NUNCA reveles, adelantes ni insinúes eventos futuros de la trama que ocurran más allá del punto actual de lectura del usuario ({progress_percentage}% del libro).
3. Una Sola Pregunta por Turno: En los turnos 1 al 4, cierra siempre tu intervención con UNA única pregunta abierta o ejercicio puntual. Nunca abrumes al lector con múltiples preguntas simultáneas.
4. Cero Emojis Excesivos: Mantén una prosa limpia y editorial. No utilices listas extensas con viñetas a menos que el usuario haya solicitado resumir ideas clave.
""".strip()

REFLECTION_STYLE_PROMPTS = {
    "MEMORY_QUIZ": """
ESTILO DE CONVERSACIÓN ELEGIDO: Retención y Memoria Activa.
- Tu objetivo es ayudar al lector a recordar detalles concretos, decisiones de personajes o conceptos clave de lo que acaba de leer.
- Formula retos suaves y amigables de memoria sin que parezca un examen académico rígido. Si el lector olvida un detalle, dale una pista sutil con calidez.
""".strip(),

    "DEEP_ANALYSIS": """
ESTILO DE CONVERSACIÓN ELEGIDO: Análisis Profundo de Trama y Subtexto.
- Tu objetivo es explorar las motivaciones psicológicas de los personajes, los dilemas filosóficos de la obra, el simbolismo o la aplicación práctica de las ideas del autor.
- Invita al lector a conectar lo leído con su propia perspectiva o experiencia personal.
""".strip(),

    "KEY_SUMMARY": """
ESTILO DE CONVERSACIÓN ELEGIDO: Síntesis de Ideas Clave.
- Tu objetivo es ayudar al lector a destilar y estructurar las enseñanzas o momentos centrales de su sesión de hoy.
- Ayúdale a construir cápsulas de conocimiento claras y memorables a partir de sus propias palabras.
""".strip(),
}

EPUB_CONTEXT_TEMPLATE = """
MODALIDAD DE LECTURA: Libro Digital (.epub) con Contexto Exacto.
- Obra: "{title}" de {author}.
- Progreso total alcanzado: {progress_percentage}%.

FRAGMENTO EXACTO LEÍDO POR EL USUARIO EN ESTA SESIÓN:
\"\"\"
{extracted_epub_excerpt}
\"\"\"

INSTRUCCIÓN DE ANCLAJE:
Basa tus preguntas, comentarios y análisis EXCLUSIVAMENTE en el fragmento proporcionado arriba y en el contexto previo de la obra hasta este punto. Cita o haz referencia sutil a pasajes o ideas presentes en este texto para demostrar escucha activa.
""".strip()

PHYSICAL_CONTEXT_TEMPLATE = """
MODALIDAD DE LECTURA: Libro Físico Impreso (Sin texto digital adjunto).
- Obra: "{title}" de {author}.
- Progreso reportado hoy: Página {current_page} de {total_pages} ({progress_percentage}% del libro).

PROTOCOLO ESTRICTO ANTI-ALUCINACIONES:
Debido a que las ediciones impresas varían en su paginación, NO asumas ni inventes qué escena exacta ocurre en la página {current_page}.
- En el Turno 1: Saluda con serenidad, celebra su avance hasta la página {current_page} y pídele que te cuente brevemente qué escena, capítulo, argumento o idea le llamó más la atención en su lectura de hoy.
- En los Turnos 2 al 5: Una vez que el usuario mencione el tema o escena, utiliza tu conocimiento general sobre "{title}" de {author} junto con los detalles que el lector te compartió para profundizar sin adelantarte en la historia.
""".strip()

TURN_CONTROL_PROMPTS = {
    1: """
ESTADO DEL CICLO ZEN: Turno 1 de 5 (Apertura de la Charla).
Este es el primer mensaje tras concluir el temporizador de lectura. Da una bienvenida breve y serena por hacer crecer su girasol y lanza la primera pregunta siguiendo el Estilo de Conversación y la Modalidad de Lectura.
""".strip(),
    2: """
ESTADO DEL CICLO ZEN: Turno 2 de 5 (Exploración Inicial).
Valida con empatía la respuesta del lector, aporta una observación breve o matiz literario sobre lo que acaba de comentar y formula una pregunta de seguimiento para profundizar.
""".strip(),
    3: """
ESTADO DEL CICLO ZEN: Turno 3 de 5 (Núcleo de Reflexión).
Conecta lo que el usuario está diciendo con el tema central del libro "{title}" o con cómo aplica esa idea en su vida cotidiana. Cierra con una pregunta reflexiva.
""".strip(),
    4: """
ESTADO DEL CICLO ZEN: Turno 4 de 5 (Penúltimo Intercambio).
Ofrece una perspectiva enriquecedora sobre su respuesta y plantea una última pregunta de síntesis que invite al lector a expresar su conclusión personal de la lectura de hoy.
""".strip(),
    5: """
ESTADO DEL CICLO ZEN: Turno 5 de 5 (Cierre del Ciclo Zen — OBLIGATORIO).
Este es el ÚLTIMO turno de la sesión.
1. NO hagas más preguntas abiertas.
2. Agradece al lector por este momento de calma, elogia su constancia de hoy e integra sus ideas en una conclusión cálida.
3. Al final de tu respuesta, añade exactamente el marcador [SEMILLA_DEL_DIA]: seguido de una sola frase inspiradora (máximo 20 palabras) que resuma el aprendizaje de la charla para guardarlo en la base de datos (campo key_takeaway).
""".strip(),
}

def build_komi_system_prompt(session, profile, current_turn: int) -> str:
    book = session.book
    safe_turn = max(1, min(current_turn, 5))

    layer_1 = BASE_ZEN_PERSONA.format(progress_percentage=book.progress_percentage)
    layer_2 = REFLECTION_STYLE_PROMPTS.get(
        profile.ai_reflection_style,
        REFLECTION_STYLE_PROMPTS["DEEP_ANALYSIS"]
    )

    if book.format_type == "EPUB" and session.extracted_epub_excerpt:
        layer_3 = EPUB_CONTEXT_TEMPLATE.format(
            title=book.title,
            author=book.author,
            progress_percentage=book.progress_percentage,
            extracted_epub_excerpt=session.extracted_epub_excerpt[:6000]
        )
    else:
        layer_3 = PHYSICAL_CONTEXT_TEMPLATE.format(
            title=book.title,
            author=book.author,
            current_page=book.current_page,
            total_pages=book.total_pages or "N/A",
            progress_percentage=book.progress_percentage
        )

    layer_4 = TURN_CONTROL_PROMPTS[safe_turn].format(title=book.title)
    return "\n\n---\n\n".join([layer_1, layer_2, layer_3, layer_4])
```

## **14.3 Procesamiento del Cierre y Extracción de `key_takeaway`**

Al concluir el streaming del Turno 5 en `apps/ai_companion/views.py`, el backend divide la respuesta mediante el delimitador `[SEMILLA_DEL_DIA]:`, almacena la frase resultante en el campo `ReflectionChat.key_takeaway` de PostgreSQL y actualiza `is_closed = True` para finalizar formalmente la sesión.

## **14.4 Análisis de Capacidad y Verificación Oficial de Modelos y Cuotas de Gemini**

**Identificadores Oficiales de Modelos (SDK google-genai):** El backend se conecta directamente al SDK oficial de Python (`google-genai`) utilizando como modelo principal la cadena `gemini-3.6-flash` (equilibrio óptimo de velocidad de streaming y profundidad reflexiva) y como modelo secundario de alta disponibilidad `gemini-3.5-flash-lite` (diseñado para baja latencia y mayor tolerancia de cuota). Estos valores reemplazan a `gemini-2.5-flash` y `gemini-2.5-flash-lite`, que figuraban en la versión original de este apartado: el primero está deprecado y el segundo tiene el acceso limitado a quienes ya lo usaban (verificado el 4 de noviembre de 2026). Son valores a revisar en Google AI Studio. Ambos se parametrizan en el archivo `.env` mediante `GEMINI_PRIMARY_MODEL` y `GEMINI_FALLBACK_MODEL` sin requerir modificaciones en el código fuente.  
**Comparativa de Cuotas del Tier Gratuito (Google AI Studio):**  
**Cuotas Oficiales Estándar (Google AI Studio Free Tier):** Para proyectos registrados en el nivel sin costo, los límites estándar de Google suelen oscilar entre `10 a 15 RPM` (peticiones por minuto), `250,000 a 1,000,000 TPM` (tokens por minuto) y `250 a 1,500 RPD` (peticiones por día), variando según la demanda de la región y si se emplea la variante Flash o Flash-Lite.  
**Límite Ultra-Restrictivo de Estrés (Worst-Case Throttling):** Corresponde a `5 RPM`, `250,000 TPM` y `20 RPD` por API Key, asignado temporalmente en cuentas nuevas sin tarjeta vinculada o en momentos de alta saturación de infraestructura.  
**Cuotas confirmadas en la cuenta del proyecto (4 de noviembre de 2026):** modelo principal `gemini-3.6-flash`: `5 RPM`, `250,000 TPM` y `20 RPD`. Modelo de respaldo `gemini-3.5-flash-lite`: `15 RPM`, `250,000 TPM` y `500 RPD`. Una charla completa cuesta 4 llamadas (el Turno 1 es local). El límite de 20 RPD del principal equivale a 5 charlas al día; al agotarse, el respaldo (500 RPD) absorbe el resto.  
**Cálculo Matemático de Consumo:**  
**Tokens (TPM):** Cada turno envía \~1,200 tokens de entrada (System Prompt \+ extracto .epub) y genera \~150 tokens de salida (`max_output_tokens=1024, temperature=0.65, thinking_level=minimal`; ver la decisión 14 de la sección 17), sumando \~1,350 tokens por turno. Con 250,000 TPM, la holgura de tokens es holgada para soportar más de 180 turnos por minuto.  
**Cuello de Botella en Escenario de Estrés (20 RPD):** Si cada una de las 5 intervenciones de una charla realizara una petición HTTP a la API externa, una cuota mínima de 20 RPD permitiría únicamente 4 conversaciones completas al día (20 RPD / 5 \= 4 charlas/día).  
**Estrategia de Mitigación en Arquitectura (3 Niveles):**  
**1\. Apertura Instantánea con Costo Cero (0 Requests en Turno 1):** El saludo y la primera pregunta del Turno 1 se generan mediante plantillas locales en Django (`prompt_builder.py`) inyectando título, autor y avance sin consultar a Gemini. El consumo de la API inicia solo cuando el lector envía su primera respuesta, reduciendo a 4 llamadas por charla y elevando la capacidad a 5 charlas completas por día.  
**2\. Fallback Multicapa de Modelos y Control de Errores (gemini\_client.py):** Si la API retorna un error HTTP 429 (Quota Exceeded) en el modelo principal (`gemini-3.6-flash`), el cliente intercepta la cabecera `Retry-After` y conmuta de inmediato al de respaldo (`gemini-3.5-flash-lite`; modelo de respaldo en `GEMINI_FALLBACK_MODEL`), duplicando el margen operativo disponible y garantizando que Komi no se detenga aun bajo condiciones severas de estrangulamiento.  
**3\. Inyección de API Key Personal (Modo Desarrollador / BYOK opcional en Ajustes):** Permite configurar una API Key propia en los ajustes de la app o mediante variables de entorno para pruebas intensivas de desarrollo sin agotar la cuota comunitaria.

# **15\. Plan de Implementación y Hoja de Ruta (Sprints v1.0)**

10. **Fase 1 — Cimientos del Backend y Base de Datos (Django \+ PostgreSQL):** Inicialización del repositorio `komi_backend`, configuración de modelos ORM para las 5 tablas núcleo (`ReaderProfile`, `BookGarden`, `ReadingSession`, `ReflectionChat`, `ReflectionMessage`) y suite de pruebas unitarias para el motor de rachas nocturnas (`streak_engine.py`).  
11. **Fase 2 — Orquestador de IA, Streaming SSE y Endpoints REST:** Construcción de `prompt_builder.py` con apertura de costo cero en Turno 1, integración del cliente `gemini_client.py` con streaming y conmutación de modelos de respaldo, más el endpoint idempotente de sincronización offline-first.  
12. **Fase 3 — PWA Mobile Core, Sistema de Diseño y Base Local (React \+ Vite \+ TypeScript):** Inicialización de `komi_frontend` con Vite y `vite-plugin-pwa`, meta tags para iOS Safari (`apple-mobile-web-app-capable`), tokens de color Komorebi y Tsukimi, persistencia `IndexedDB` (`Dexie.js`), Onboarding y reutilización directa del SVG animado del girasol del prototipo.  
13. **Fase 4 — Lector ePub Zen, Ciclo de Vida (15s) e Integración End-to-End:** Integración del visor epubjs, control de segundo plano con 15 segundos de gracia mediante Page Visibility API (`document.visibilityState`), flujo post-lectura en Bottom Sheet, interfaz de chat con respuestas en streaming y visualización de "Semillas del Día" en la biblioteca.  
14. **Fase 5 — Despliegue HTTPS y Pruebas en iPhone (iOS Safari):** Provisión de base de datos PostgreSQL 16 con SSL en Neon/Supabase, despliegue del servicio ASGI de Django en Render/Railway con Gunicorn+Uvicorn y despliegue del frontend PWA en Vercel/Cloudflare Pages con TLS 1.3 estricto. Validación de la API `navigator.storage.persist()`, mitigación del purgado de 7 días de Safari (ITP) e instalación real en pantalla de inicio desde iOS Safari (Compartir \-\> Agregar a pantalla de inicio).

# **16\. Decisiones de Sprint 1**

Decisiones tomadas antes de iniciar la Fase 1 (Sprint 1) para resolver ambigüedades del SRS. Fecha: 2026-11-04. En caso de conflicto con secciones anteriores sobre estos puntos, rige esta sección.

1. **`started_at_local` (zona horaria).** Se guarda la hora de pared local del dispositivo, sin zona horaria. Con `USE_TZ=True` se almacena como `timestamptz` asignando un `datetime` consciente en UTC cuyo reloj es la hora local (23:50 en Bogotá se guarda como 23:50 UTC). No es un instante real: no se convierte con `astimezone()`. El desfase del cliente se descarta y las rachas usan solo `started_at_local.date()`. Queda comentado en el modelo `ReadingSession` y se cubre con una prueba de medianoche en `America/Bogota`.
2. **Reglas de racha (`streak_engine.py`).**
   * Tras un hueco de más de 1 día calendario, la racha se reinicia a 1.
   * Las sesiones atrasadas recibidas por sync fuera de orden no incrementan la racha; la consolidación recalcula desde el conjunto de fechas (idempotente, §11.4).
   * `current_streak` puede quedar desactualizado si hoy aún no se leyó; la lectura usa `effective_streak(estado, hoy_local)`, que devuelve 0 si pasó más de 1 día sin leer.
3. **Sesión válida.** Cuentan para la racha `COMPLETED` y `EARLY_VALID`. `INVALIDATED_GRACE_EXPIRED` no cuenta.
4. **Bono de Vitalidad Solar (FA-4.1).** Aplica solo a libros `PHYSICAL`, con sesión válida y `progress_delta < 1`. Un `progress_delta` de 0 califica.
5. **Base de datos.** PostgreSQL 16 desde el inicio. No se escriben pruebas contra SQLite.
6. **`updated_at` en `BookGarden`.** Se agrega al esquema porque la regla de sync de §11.4 lo requiere y §11.2 no lo lista.
7. **Etapas del girasol.** Se calculan con umbrales sobre el porcentaje decimal: menor a 25 semilla, menor a 60 tallo, menor a 100 capullo, 100 flor. `growth_stage` se deriva de `progress_percentage` al guardar.
8. **`ACTIVE` y `GROWING`.** Se mantienen ambos en el enum `status` de `BookGarden`, sin lógica diferenciada hasta que el SRS la defina.
9. **Alcance de la Fase 1.** Incluye los modelos de `ReflectionChat` y `ReflectionMessage` (solo modelos), según §15.
10. **Límite de turnos.** Se modela con `CheckConstraint` de 1 a 5 en `turn_count` y `turn_number`. La lógica de bloqueo y cierre es de la Fase 2.
11. **Archivos adicionales.** Se agregan `apps.py`, `__init__.py`, `migrations/` y carpetas de pruebas, exigidos por Django aunque no figuran en §13.3. No se crea `wsgi.py` (solo ASGI).
12. **Dependencias aprobadas.** `python-dotenv` (lectura de `.env`) y `ruff` (linter, solo desarrollo). `django-cors-headers`, `google-genai` y `uvicorn` se incorporan en la Fase 2.


# **17\. Decisiones de Sprint 2**

Decisiones tomadas antes de iniciar la Fase 2 (Sprint 2). Fecha: 2026-11-04. En caso de conflicto con secciones anteriores sobre estos puntos, rige esta sección.

1. **Identificación del lector.** Todo endpoint (salvo la creación del perfil en onboarding) identifica al lector con la cabecera `X-Profile-Id` (UUID del `ReaderProfile`). No se usan cookies ni sesiones de Django, por lo que no aplica CSRF. Cada endpoint verifica que libros, sesiones y charlas pertenezcan a ese perfil. Google Sign-In (RF-07) queda fuera del Sprint 2.
   * CORS debe permitir la cabecera `X-Profile-Id` (`CORS_ALLOW_HEADERS`) con orígenes estrictos hacia el dominio del frontend.
   * El UUID no se registra en logs: no se incluye en rutas ni parámetros de URL, no se vuelca la cabecera en ningún `LOGGING` y los mensajes de error no lo contienen.
2. **Alcance.** Se implementan los 9 endpoints de §11.3 más `GET /api/v1/profile/sync/restore/` de §11.4, por bloques.
3. **`POST /companion/start/`.** Devuelve JSON con la plantilla local del Turno 1 (cero llamadas a Gemini). El streaming SSE se usa solo en `POST /companion/{chat_id}/message/`. Si la `ReadingSession` no existe en el servidor, responde 404; el cliente debe sincronizar o completar la sesión antes.
4. **Numeración de turnos.**
   * Komi emite 5 mensajes (turnos 1 a 5) y el lector responde como máximo 4 veces. El Turno 1 es local; los turnos 2 a 5 son llamadas a Gemini (4 por charla).
   * Cada mensaje de Komi lleva su `turn_number`. La respuesta del lector lleva el `turn_number` del turno al que responde.
   * `turn_count` sube al guardar el mensaje de Komi. Con `turn_count == 5` o `is_closed`, cualquier mensaje nuevo se rechaza (un sexto turno es imposible) y no se llama a Gemini.
   * Una prueba verifica que ese intento se rechaza.
5. **Mensaje del Turno 1.** Plantillas locales en `prompt_builder.py` (EPUB y físico, tres estilos). El texto se aprueba antes de usarse.
6. **EPUB sin extracto.** Si el libro es `EPUB` pero no hay `extracted_epub_excerpt`, se usa una plantilla de respaldo con título, autor y avance (sin página), en lugar de la plantilla de libro físico (defecto del ejemplo de §14.2).
7. **Sincronización (`/profile/sync/`).**
   * El esquema del lote JSON (`profile`, `books[]`, `sessions[]`) se define y documenta en la implementación.
   * Progreso: `MAX(progress_percentage)`. El `last_epub_cfi` se toma literalmente del registro con el `updated_at` más reciente (§11.4). Consecuencia documentada: ese CFI puede quedar por detrás del progreso máximo si el registro más reciente es el de menor avance.
   * Estado, título y autor: gana el `updated_at` más reciente enviado por el cliente.
   * Sesiones: unión aditiva e idempotente por UUID; una sesión existente nunca se sobrescribe.
   * Validación de sesiones: `EARLY_VALID` exige `actual_duration_sec >= 50%` de `planned_duration_sec`, salvo que el libro llegue al 100%. Coincide con RF-02 y FA-3.3 ("al menos el 50%"). §11.2 usa "tras superar el 50%"; se adopta la lectura "al menos" (mayor o igual) por ser la de dos requisitos normativos.
   * La racha se recalcula con `streak_engine.recompute_from_dates` y `previous_longest`.
8. **Progreso de la sesión.** Libro físico: el servidor recalcula `current_page / total_pages * 100`. EPUB: el servidor no puede derivarlo del CFI; acepta el porcentaje del cliente acotado entre el progreso previo y 100.
9. **Marcador `[SEMILLA_DEL_DIA]:`.** El servidor lo detecta durante el streaming con un búfer (incluso partido entre fragmentos) y no lo envía al cliente como texto. El texto limpio se transmite y la frase final llega en el evento `done` (`key_takeaway`). Si el modelo no emite el marcador, `key_takeaway` queda nulo y la charla se cierra igualmente.
10. **Dependencias aprobadas.** `google-genai`, `uvicorn` y `django-cors-headers`. Las pruebas usan un cliente falso, sin red.
11. **Modelos de Gemini.** `GEMINI_PRIMARY_MODEL` y `GEMINI_FALLBACK_MODEL` se definen solo en `.env`. Los valores sugeridos originalmente en §14.4 (`gemini-2.5-flash` y `gemini-2.5-flash-lite`) estaban obsoletos al verificarlos (4 de noviembre de 2026). Se reemplazan por `gemini-3.6-flash` (principal) y `gemini-3.5-flash-lite` (respaldo) en §14.4 y en `.env.example`, como valores a revisar en Google AI Studio. Cuotas confirmadas del nivel gratuito: principal 5 RPM, 250K TPM y 20 RPD; respaldo 15 RPM, 250K TPM y 500 RPD. Una charla completa cuesta 4 llamadas. Todo sigue configurándose solo por variables de entorno.
12. **Criterios adicionales.**
    * Garden: la selección del "libro activo" del Dashboard es estado del cliente; `PATCH` solo cambia estado y metadatos.
    * Estadísticas: semana ISO (lunes a domingo) por fecha local, solo sesiones válidas; "charlas completadas" son las cerradas (`is_closed`).
    * Límites de entrada: mensaje del lector hasta 2000 caracteres; extracto EPUB hasta 20000.
    * Onboarding: el servidor ejecuta el algoritmo de §5.1; el cliente lo repite offline y el servidor es la referencia.
    * Fuera de v1.0: BYOK de §14.4 y límites de uso por perfil.
13. **Orden de implementación.** `prompt_builder`, `gemini_client`, perfiles y onboarding, garden, `sessions/complete`, sync y restore, estadísticas y, por último, los endpoints del compañero.

14. **Razonamiento y tope de salida de Gemini.** Verificado en la documentación oficial (4 de noviembre de 2026): `gemini-3.6-flash` y `gemini-3.5-flash-lite` se controlan con `thinking_level` (valores `minimal`, `low`, `medium` y `high`), no con `thinking_budget`. No hay un valor para apagar el razonamiento; `minimal` es el más bajo. Los tokens de razonamiento cuentan contra `max_output_tokens`. Con el tope original de 220, el razonamiento de `gemini-3.6-flash` (por defecto `medium`) consumió ~212 tokens y la respuesta salió cortada o vacía. Decisión: `thinking_level=minimal` en ambos modelos y `max_output_tokens=1024` como colchón; la longitud de 50 a 90 palabras la controla el prompt.
    * Una respuesta con `finish_reason` `MAX_TOKENS` es un caso explícito: `gemini_client` lanza `GeminiTruncatedError` y nunca emite `Finished`. No se cambia al modelo de respaldo. Los endpoints del compañero no deben guardar ese mensaje ni cerrar el chat, y deben enviar un evento de error por SSE para que el cliente descarte el texto parcial ya mostrado.
    * Verificación manual con la API real (turno 2, libro físico, estilo DEEP_ANALYSIS): principal 73 palabras y respaldo 64, ambos con `finish_reason` `STOP` y sin tokens de razonamiento reportados.

15. **Perfiles, identificación y CORS (bloque 3).**
    * `POST /api/v1/profile/onboarding/` recibe `{"profile_id": "<uuid del cliente>", "answers": {"q1".."q5": "A".."D"}}` (`q5` solo `A` a `C`). Es el único endpoint sin `X-Profile-Id`. Responde `profile_id`, `daily_goal_minutes`, `preferred_moment`, `ai_reflection_style` y `preconfigure_tsukimi` (verdadero solo con la regla de fatiga nocturna de §5.1).
    * Mapeo de respuestas: `q2` A, B, C, D = 10, 15, 30, 45 minutos; `q3` A, B, C, D = `MORNING`, `AFTERNOON`, `NIGHT`, `COMMUTE`; `q5` A, B, C = `MEMORY_QUIZ`, `DEEP_ANALYSIS`, `KEY_SUMMARY`. Las preguntas 1 y 4 solo alimentan las reglas de §5.1; sus demás efectos (alertas del temporizador, archivo .ics, banner) son del cliente y no se guardan en el servidor.
    * Idempotencia: si el `profile_id` ya existe, responde 200 con los datos guardados y no los modifica, para que conocer un UUID no permita reescribir un perfil ajeno. En ese caso `preconfigure_tsukimi` es `null`, porque las respuestas no se almacenan. Crear responde 201.
    * La reconfiguración posterior de FA-1.2 (cambiar meta o estilo desde Ajustes) no tiene endpoint en §11.3 y queda fuera de este sprint, salvo que se apruebe uno.
    * Autenticación: `X-Profile-Id` ausente, mal formado o de un perfil inexistente responde 401 con el mismo cuerpo genérico (sin eco del UUID). Las cookies no autentican. La clase vive en `apps/profiles/authentication.py`, un archivo adicional a §13.3, y es la autenticación por defecto de DRF; todos los endpoints posteriores la heredan.
    * El UUID funciona como credencial y no se escribe en logs ni en mensajes de error. El código no lo registra y `django.db.backends` (que registraría el SQL con parámetros) queda fijado en INFO. Una prueba lo comprueba capturando todos los logs.
    * API solo JSON: parser y renderer JSON, sin la API navegable de DRF (entrada con otro tipo de contenido responde 415).
    * CORS (`django-cors-headers`): orígenes estrictos desde `CORS_ALLOWED_ORIGINS` (lista separada por comas; vacía por defecto, es decir, ninguno), sin credenciales, y `x-profile-id` añadida a `CORS_ALLOW_HEADERS`. Los métodos por defecto incluyen `PATCH`.

16. **Garden (bloque 4).**
    * `GET /api/v1/garden/books/`: lista solo los libros del perfil, del más reciente al más antiguo, sin paginación (es una biblioteca personal). Filtro opcional `?status=` con `ACTIVE`, `GROWING`, `BLOOMED` o `FALLOW` (igualdad exacta; `ACTIVE` no incluye `GROWING`, en línea con el punto 8 de la sección 16 anterior); otro valor responde 400.
    * `POST /api/v1/garden/books/`: planta un libro con `title`, `author`, `format_type`, `sunflower_variant` (todos obligatorios) y `id` opcional (UUID del cliente, para el modo offline-first). `total_pages` es obligatorio y mayor que 0 en `PHYSICAL` (tope de cordura: 100000) y se ignora en `EPUB`. El libro nace con 0%, `SEED_1` y `ACTIVE`; el cliente no puede fijar progreso, etapa, estado, página ni perfil.
    * Idempotencia del `POST`: si el `id` ya existe en el mismo perfil, responde 200 con el libro tal como está, sin modificarlo; si pertenece a otro perfil, responde 409 sin revelar datos. Crear responde 201.
    * `PATCH /api/v1/garden/books/{id}/`: solo admite `title`, `author` y `status`. Cualquier otro campo (progreso, etapa, formato, variante, páginas, CFI, perfil, id, fechas) se rechaza con 400, porque el progreso solo lo modifican las sesiones y la sincronización. `GET`, `PUT` y `DELETE` sobre esa ruta responden 405; no hay borrado de libros en v1.0.
    * Transiciones de estado por el cliente: solo a `FALLOW` (barbecho, FA-2.3) o a `ACTIVE` (restaurar). `BLOOMED` y `GROWING` no se pueden fijar a mano. Restaurar un libro con 100% lo deja en `BLOOMED`; restaurar uno en `GROWING` lo conserva. Un libro florecido (`BLOOMED` o con 100%) no se puede poner en barbecho (decisión conservadora del servidor; relajable si el producto lo pide).
    * Un libro de otro perfil responde 404 en `PATCH`, igual que uno inexistente.

17. **Sesiones (`POST /api/v1/sessions/complete/`, bloque 5).**
    * Cuerpo: `id` (UUID de la sesión, del cliente), `book_id`, `planned_duration_sec` (300 a 7200, es decir, de 5 a 120 minutos según CU-03), `actual_duration_sec` (0 hasta `planned_duration_sec`), `started_at_local`, `session_status` y los datos de progreso del formato: libro `PHYSICAL`, `current_page`; libro `EPUB`, `progress_percentage` (0 a 100) y opcionales `last_epub_cfi` (hasta 2000 caracteres) y `extracted_epub_excerpt` (hasta 20000). Los campos del otro formato se ignoran.
    * Respuesta: `session`, `book` (misma forma que el jardín), `just_bloomed` y `streak` (`current`, `longest`, `last_valid_session_date`). Primer envío: 201. Reintento con el mismo `id`: 200 con el resultado guardado, sin duplicar sesión, progreso ni racha, aunque el cuerpo cambie. Si el `id` pertenece a otro perfil: 409 sin revelar datos.
    * `started_at_local` es la hora de pared local: se conservan los dígitos del reloj y se descarta cualquier desfase (`Z`, `-05:00`), porque convertirlo a UTC movería la fecha de la racha. Se devuelve sin zona. Se rechaza una hora más de 14 h y 5 min por delante del reloj del servidor (la zona más adelantada es UTC+14), para que un cliente no falsee rachas con fechas futuras.
    * Estado derivado por el servidor: tiempo completo da `COMPLETED`; al menos el 50% (o llegar al 100% del libro) da `EARLY_VALID`; menos que eso, con un estado válido declarado, responde 400 y no guarda nada. El estado enviado por el cliente se usa solo para distinguir una sesión invalidada.
    * Sesión `INVALIDATED_GRACE_EXPIRED`: se registra con `progress_delta` 0, sin Bono Solar, sin racha y sin tocar el libro. No exige datos de progreso ni que el libro esté activo.
    * Sesiones válidas: el libro debe pertenecer al perfil (si no, 404) y no estar en barbecho ni florecido (409, CU-03).
    * Progreso monotónico. Físico: `current_page / total_pages * 100`, truncado (no redondeado) a 2 decimales, de modo que el 100% solo se alcanza en la última página. EPUB: el porcentaje del cliente acotado entre el guardado y 100. Una página o porcentaje menor al guardado no baja el progreso ni la página; el `progress_delta` es 0 y, si el libro es físico, el Bono Solar aplica (decisión 4 de la sección 16). El `last_epub_cfi` solo se actualiza si la lectura no retrocedió.
    * Al llegar a 100%: `status=BLOOMED`, `completed_at` con la hora del servidor, etapa `BLOOM_4` y `just_bloomed=true`.
    * Racha: `streak_engine.apply_session_if_valid` con la fecha local. Una sesión con fecha anterior a la última válida no cambia el estado (la consolida `recompute_from_dates` en la sincronización).
    * Concurrencia: el cierre corre en una transacción que bloquea la fila del perfil y luego la del libro, de modo que reintentos simultáneos con el mismo `id` crean una sola sesión.
    * Archivos adicionales a §13.3: `serializers.py` y `services.py` en `reading_sessions`.

18. **Sincronización (`POST /api/v1/profile/sync/` y `GET /api/v1/profile/sync/restore/`, bloque 6).**
    * Lote (JSON, con `X-Profile-Id`): `{"books": [...], "sessions": [...]}`. La clave `profile` se ignora: los ajustes del perfil no se sincronizan (`ReaderProfile` no tiene `updated_at` y la reconfiguración de FA-1.2 no tiene endpoint); la racha siempre la calcula el servidor.
      * Libro: `id`, `title`, `author`, `format_type`, `sunflower_variant`, `status` (`ACTIVE` o `FALLOW`; `BLOOMED` y `GROWING` los deriva el servidor), `total_pages`, `current_page`, `progress_percentage`, `last_epub_cfi` y `updated_at` (obligatorio, ISO 8601 con zona).
      * Sesión: exactamente los campos de `POST /sessions/complete/` (§17, punto 17).
    * Respuesta 200: `books` y `sessions`, cada uno con `accepted` (`id`, `result`: `created`, `merged` o `duplicate`; en sesiones también `session_status`, `progress_delta` y `just_bloomed`) y `rejected` (`index`, `id`, `code`, `detail`); `server_books` (estado final de los libros tocados) y `streak`. Un elemento inválido no tumba el lote: cada uno corre en su propio savepoint y se rechaza con su código.
    * Orden y atomicidad: una sola transacción que bloquea primero la fila del perfil (igual que `sessions/complete`). Todos los libros del lote se procesan antes que las sesiones, así una sesión puede referirse a un libro del mismo lote. Las sesiones se procesan en orden cronológico de `started_at_local`, sin importar el orden de llegada; el resultado no depende de él.
    * Reglas de sesión compartidas con `complete` (un solo código, `apps/reading_sessions/services.py`): tope de hora futura de 14 h 5 min, regla del 50% (o llegar al 100%), límites de duración, estado derivado por el servidor, aislamiento por perfil y progreso monotónico. Diferencia deliberada: una sesión válida sobre un libro en barbecho o ya florecido se acepta (las sesiones son aditivas y no se pueden perder), a diferencia de `complete`, que responde 409.
    * Libro florecido: una sesión válida o un registro del cliente no cambian su estado, su progreso, su `completed_at` ni su `updated_at`; no vuelve a florecer. Un libro en barbecho conserva `FALLOW` mientras sube su progreso con MAX; si una sesión lo lleva por primera vez a 100%, pasa a `BLOOMED` y se fija `completed_at` una sola vez. Una petición `FALLOW` sobre un libro florecido se ignora.
    * Libros: `progress = MAX`; `current_page = MAX`; el progreso físico se recalcula con las páginas (el porcentaje del cliente se ignora) y el EPUB se acota a 0-100. Título, autor, estado y `last_epub_cfi` los toma el registro con `updated_at` más reciente, comparando el del cliente con el guardado en el servidor (relojes distintos; sesgo aceptado). El CFI se copia literalmente de ese registro, por lo que puede quedar por detrás del progreso máximo; un CFI nulo o vacío nunca borra el guardado. `format_type`, `sunflower_variant` y `total_pages` no cambian tras plantar. Un `updated_at` más de 5 minutos por delante del reloj del servidor rechaza solo ese libro. El servidor no guarda un libro si la fusión no cambia nada, para que un lote repetido no altere `updated_at`.
    * Idempotencia: las sesiones existentes nunca se sobrescriben y se reportan como `duplicate`; repetir un lote o enviarlo por tandas no cambia el estado. Un UUID repetido dentro del mismo lote se rechaza (`duplicate_in_batch`), y uno que pertenece a otro perfil se rechaza (`id_conflict`) sin revelar datos.
    * Racha: se recalcula tras el lote con `streak_engine.recompute_from_dates` sobre todas las fechas locales válidas del perfil (las del lote y las ya guardadas, también las de `complete`), con `previous_longest` para no bajar el récord.
    * Límites y tamaño: hasta 100 libros y 200 sesiones por lote (más devuelve 400 y no guarda nada) y cuerpo máximo de 2,5 MB (`DATA_UPLOAD_MAX_MEMORY_SIZE`, fijado de forma explícita; más devuelve 413 en JSON). Con 200 sesiones de extractos de 20000 caracteres el cuerpo pasaría de 2,5 MB, así que `extracted_epub_excerpt` solo se conserva en la sesión más reciente del lote; en las demás se ignora (sin rechazarlas). Es suficiente porque el extracto solo sirve para la charla posterior a esa lectura. Un lote completo con un extracto pesa unos 0,2 MB. El cliente envía el extracto solo en la última sesión, porque el cuerpo cuenta entero para el límite.
    * Restore: devuelve `profile` (ajustes), `streak`, todos los `books` (cualquier estado) y todas las `sessions` ordenadas, sin extractos. Las "semillas del día" de las charlas se añadirán con el bloque 8.
    * Códigos de rechazo por elemento y acción del cliente:

| Código | Tipo | Causa | Acción del cliente |
| :---- | :---- | :---- | :---- |
| `validation_error` | Permanente | Campo ausente, formato inválido, valor fuera de rango o página superior al total | Descartar el elemento (reintentarlo tal cual fallaría igual) |
| `below_50_percent` | Permanente | Sesión válida con menos del 50% del tiempo y sin llegar al 100% del libro | Descartar la sesión |
| `future_start` | Permanente | `started_at_local` más de 14 h 5 min por delante del reloj del servidor | Descartar la sesión |
| `book_not_found` | Permanente | El libro no existe en el servidor ni en el lote | Descartar; si el libro existe en local, enviarlo en el mismo lote (error del cliente) |
| `book_rejected` | Según el libro | El libro de la sesión fue rechazado en el mismo lote | Igual que la causa del libro: descartar, o corregir reloj y reintentar si fue `updated_at_in_future` |
| `id_conflict` | Permanente | El UUID pertenece a otro perfil | Descartar |
| `duplicate_in_batch` | Permanente | UUID repetido dentro del lote; el primero ya se procesó | Descartar el duplicado |
| `updated_at_in_future` | Reintentable | `updated_at` del libro más de 5 minutos por delante del reloj del servidor | Corregir reloj y reintentar |

    * Errores de la petición completa: 413 (cuerpo demasiado grande) y 400 por exceso de elementos: dividir y reenviar en tandas, con los libros en la primera tanda. 401 (perfil desconocido): repetir el onboarding (idempotente) y volver a sincronizar. 429, 5xx o 503: reintentar con espera creciente.
    * Archivos adicionales a §13.3: `apps/profiles/sync.py` (la consolidación; separada de `services.py` para evitar un import circular con los serializers), `apps/garden/services.py` y `config/exception_handler.py` (413 en JSON).

19. **Estadísticas semanales (`GET /api/v1/stats/weekly/`, bloque 7).**
    * Selección de la semana (semana ISO, de lunes a domingo): `?week=AAAA-Wss` (por ejemplo `2026-W45`); o `?today=AAAA-MM-DD`, la fecha local del cliente, que elige la semana que la contiene; sin parámetros, la fecha UTC del servidor. El servidor no conoce la zona del lector, por eso el cliente debe enviar `week` o `today` si quiere su semana local.
    * Valores inválidos: 400 con `{"week": "..."}` para un formato distinto de `AAAA-Wss`, una semana inexistente (`2026-W54`, `2025-W53`) o un año fuera de 2000 a 2100; 400 con `{"today": "..."}` para una fecha mal formada, inexistente o fuera de ese rango; 400 si llegan `week` y `today` a la vez. Una semana válida sin datos responde 200 con ceros y los 7 días.
    * Medición: por `started_at_local` sin convertir a UTC ni a la zona del servidor. Una sesión que cruza la medianoche cuenta íntegra en el día y la semana de su inicio (domingo 23:50 es de esa semana; lunes 00:10, de la siguiente). Los límites son `[lunes 00:00:00, lunes siguiente 00:00:00)`. Solo cuentan las sesiones válidas (`COMPLETED` y `EARLY_VALID`); la suma usa `actual_duration_sec`.
    * Respuesta 200: `week`, `start_date`, `end_date`, `days` (7 entradas con `date`, `seconds`, `minutes` y `sessions`), `total_seconds`, `total_minutes`, `sessions_count`, `completed_chats_week`, `completed_chats_total` y `bloomed_books_total`.
    * Charlas completadas: las cerradas (`is_closed`) de sesiones válidas; `completed_chats_week` las atribuye a la semana de la sesión y `completed_chats_total` suma todas. Girasoles florecidos: total histórico de libros con 100% (no se atribuyen a una semana porque `completed_at` es un instante del servidor y no una fecha local). La racha no forma parte de esta respuesta: el cliente la recibe en `complete`, `sync` y `restore`.
    * Archivos: `apps/reading_sessions/stats_selectors.py` (agregaciones) y la ruta `stats/weekly/` en `reading_sessions/urls.py`, montada junto con `sessions/complete/` bajo `api/v1/`.
    * Resuelto en el bloque 8 (punto 20): `GET /profile/sync/restore/` devuelve las charlas cerradas con su `key_takeaway` y sus mensajes, para que un cliente vacío recupere sus semillas y el total de charlas.

20. **Charla con Komi (`/companion/start/` y `/companion/{chat_id}/message/`, bloque 8).**
    * **Arranque, JSON sin Gemini.** `POST /api/v1/companion/start/` con `{"session_id"}`. Crea la charla con el Turno 1 de las plantillas locales y responde 201 con `chat_id`, `session_id`, `turn_count`, `is_closed`, `key_takeaway` y `messages`. Es idempotente: si la sesión ya tiene charla responde 200 con ella (vía de recuperación tras perder la conexión). 404 si la sesión no existe o es de otro perfil; 409 `session_invalid` si la sesión fue invalidada.
    * **Mensaje, SSE.** `POST /api/v1/companion/{chat_id}/message/` con `{"content", "turn"}` (`content` hasta 2000 caracteres; `turn` opcional, de 1 a 4, es el turno de Komi al que responde el lector). Las validaciones ocurren antes del stream y responden JSON: 404 (charla ajena o inexistente), 400 (contenido vacío o largo) y 409 con `code`: `chat_closed`, `reply_in_progress` y `turn_mismatch`. Si todo es válido responde 200 `text/event-stream` (`Cache-Control: no-cache`, `X-Accel-Buffering: no`) con tres eventos: `chunk {text}` (texto visible, en orden), `done {turn, is_closed, key_takeaway, content}` y `error {code, retry_after}`. Un error durante el stream llega como evento `error` dentro de un 200 (ya se envió la cabecera). Se acepta `Accept: text/event-stream`.
    * **Códigos del evento `error`.** `quota_exceeded` (cuota agotada, con `retry_after` en segundos si Gemini lo informa), `truncated` (respuesta cortada por `MAX_TOKENS`), `unavailable` (Gemini caído, 5xx, red o respuesta vacía), `timeout` (más de 60 s esperando a Gemini), `conflict` (la reserva se perdió antes de guardar) e `internal`. El cliente debe descartar todo el texto parcial recibido. Con cualquier `error` no se guardó nada y `turn_count` no cambió, así que el lector puede reenviar el mismo mensaje con el mismo `turn`.
    * **Guardado atómico.** Solo cuando el stream termina bien, una única transacción con la fila de la charla bloqueada guarda el mensaje del lector (turno T), el de Komi (turno T+1) y sube `turn_count`. Con `GeminiTruncatedError` u otro fallo, con un tiempo agotado o con una desconexión del cliente no se guarda nada. Restricción de base de datos: un solo mensaje por charla, autor y turno.
    * **Candado de doble envío.** Nueva columna `ReflectionChat.pending_since` (DateTime, nulo; migración `0002`, no estaba en §11.2). Antes de llamar a Gemini el envío reserva la charla con un `UPDATE` condicional; un segundo envío concurrente recibe 409 `reply_in_progress` sin gastar cuota. El candado se libera siempre al terminar el envío, bien o mal, incluso si el cliente se desconecta; el vencimiento de 90 s solo cubre un proceso caído. Una reserva vencida no puede guardar sobre la nueva (se compara el token de la reserva).
    * **Cierre.** Con `turn_count == 5` (turno 5 de Komi) se llama a Gemini con la extracción de semilla, se guarda la frase tras `[SEMILLA_DEL_DIA]:` en `key_takeaway` (recortada a 500 caracteres; nula si falta o está vacía) y se pone `is_closed = True`. Si el modelo no emite la semilla, la charla cierra igualmente. Todo mensaje posterior, o con `turn_count >= 5`, se rechaza con 409 `chat_closed` sin llamar a Gemini. Una charla completa cuesta exactamente 4 llamadas.
    * **Identificador.** `ReflectionChat.id` pasa de entero a UUID, como dice §11.2. La migración recrea las tablas del compañero y se niega a correr si ya hubiera charlas.
    * **Sin cierre anticipado (nota para el frontend).** FA-5.3 ("Volver al jardín" antes del quinto turno) no tiene endpoint en v1.0: una charla abandonada queda abierta, no cuenta como completada (`is_closed` falso) y no aparece en el restore ni en las estadísticas. El cliente puede retomarla llamando de nuevo a `start/` con la misma sesión, que devuelve la charla y sus mensajes. Cerrarla antes de tiempo exigiría un endpoint nuevo y una decisión sobre qué se guarda.
    * **Restore.** `GET /profile/sync/restore/` incluye `chats`: solo las cerradas, de sesiones válidas del perfil, ordenadas por el inicio de la sesión, cada una con `chat_id`, `session_id`, `turn_count`, `is_closed`, `key_takeaway` y `messages` (con `turn_number`). Las abiertas no se restauran (se retoman con `start/`).
    * **Registro.** No se registran el texto del lector ni la respuesta de Komi; solo el tipo de error.
    * **Despliegue.** `uvicorn` entra en `requirements.txt`. Desarrollo: `uvicorn config.asgi:application --reload --port 8000`. Producción: `gunicorn -k uvicorn.workers.UvicornWorker config.asgi:application` (§13). Detrás de un proxy hay que desactivar el búfer de respuesta (la cabecera `X-Accel-Buffering: no` ya lo indica).
    * **Respaldo por 503.** Un HTTP 503 del modelo principal (saturado o no disponible) activa el modelo de respaldo igual que un 429, y solo si todavía no se emitió texto; con texto ya emitido el error se propaga y el lector descarta lo parcial. Si el respaldo también responde 503 el error es `unavailable` (no cuota); si responde 429 es `quota_exceeded`. Otros códigos (400, 500) no cambian de modelo. Esto amplía la regla de §14.4 y de `CLAUDE.md` §7, que solo mencionaban el 429.
    * **Configuración obligatoria.** `GEMINI_API_KEY`, `GEMINI_PRIMARY_MODEL` y `GEMINI_FALLBACK_MODEL` son obligatorias (antes el respaldo era opcional y su ausencia desactivaba el cambio de modelo en silencio). Si falta alguna, el servidor registra `Falta configurar en el entorno (.env): <variables>` con los nombres de las que faltan, nunca sus valores; el cliente solo recibe el evento `error unavailable`. Para usar un único modelo, repetir el mismo nombre en ambas variables.
    * **Verificación real.** Con `uvicorn` y `curl -N` los fragmentos llegan en vivo y con las cabeceras correctas; al cortar el cliente a mitad de la respuesta el generador se cancela, no se guarda nada y el candado queda libre; un segundo envío durante la respuesta recibe 409 `reply_in_progress`. Charla completa con la API real (base temporal, sin reintentos): 4 llamadas, todas respondidas por el modelo principal (`GEMINI_PRIMARY_MODEL`); respuestas de 58 a 77 palabras; la charla cerró con semilla, sin el marcador en el texto, y el restore devolvió la charla con sus 9 mensajes. Latencia hasta el primer fragmento: 7,2 s (primer turno, conexión en frío), 3,2 s, 2,5 s y 3,8 s; el RNF-03 (menos de 3 s) no se cumplió en 3 de las 4 respuestas de esa muestra y queda como punto a vigilar. Una prueba anterior recibió un 503 del principal y no guardó nada.
    * Archivos adicionales a §13.3: `apps/ai_companion/services.py` (reglas y candado), `streaming.py` (SSE), `serializers.py`, `views.py` y `urls.py`.


# **18\. Decisiones de Sprint 3**

Decisiones tomadas antes de iniciar la Fase 3 (Sprint 3). Fecha: 2026-11-05. En caso de conflicto con secciones anteriores sobre estos puntos, rige esta sección.

1. **Alcance.** Lo de §15 (Fase 3) más lo mínimo para poder verificarlo: navegación inferior con los tres destinos y un Dashboard mínimo (zonas 1 a 3 de §6; el botón "Comenzar Lectura" aún sin acción). Mi Jardín y Estadísticas son pantallas vacías con su título. El lector, el chat y el sync completo son de la Fase 4. `epubjs` se instala en la Fase 4.
2. **Bloques.** (1) Andamiaje, (2) sistema de diseño, (3) componentes base, (4) capa de datos local, (5) lógica pura con pruebas, (6) girasol, (7) onboarding y Dashboard mínimo, (8) PWA. Puntos de revisión tras los bloques 3, 6 y 8.
3. **Tokens derivados.** Se añaden a `colorTokens.ts` en un grupo marcado como derivado (no son parte de §9.2 ni §9.5). Ninguno usa `#000000` ni `#FFFFFF`. Provienen del prototipo: `bg-halo` oscuro (`#1E211E`), `accent-pressed` oscuro (`#D4A146`) y los tonos de pétalo interior y de barbecho del girasol. Se añade `text-on-accent` (`#2C302E` en claro, de §10.1; `#181A18` en oscuro, igual a `bg-primary` oscuro): el texto del CTA sobre `accent-primary` con `text-primary` oscuro (Pergamino claro) sobre Ámbar Lunar da un contraste cercano a 1,6:1; con `text-on-accent` supera 4,5:1 en ambos temas (hay una prueba). `outerCanvas` se omite: es solo el marco del teléfono del prototipo. Los tokens de §9.2 y §9.5 no se modifican.
4. **Girasol.** Solo la variación `clasica` más el estado de barbecho. Las variaciones `solar` y `otonal` del prototipo quedan fuera de v1.0.
5. **Color en archivos que no son CSS.** `manifest` y `theme-color` se generan desde `colorTokens.ts` en `vite.config.ts`; no se duplican hex.
6. **Tema inicial.** `preconfigure_tsukimi` del onboarding; si no existe, `prefers-color-scheme`. Un interruptor manual (ícono de Ajustes) lo persiste en Dexie. Ajustes es solo local en este sprint (FA-1.2 sigue sin endpoint).
7. **Identificación.** `apiClient` usa la cabecera `X-Profile-Id` (§17.1), sin JWT. El comentario de §13.2 se corrige en consecuencia.
8. **Copia del `profile_id` y recuperación.** En este sprint se guarda en IndexedDB y `localStorage`; la cookie de §11.4 se descarta por chocar con §17.15 (credencial expuesta a XSS). **Pendiente de Fase 5:** un mecanismo de recuperación del `profile_id` (por ejemplo, mostrarlo en Ajustes para que el lector lo guarde), porque sin el UUID el `restore` no sirve si Safari borra los datos locales.
9. **Preguntas 1 y 4.** Solo alimentan las reglas de §5.1. Cualquier otro efecto (alertas del temporizador) se define en la Fase 4.
10. **.ics.** Horas según la pregunta 3: 07:30, 15:00, 21:30 y 12:30. La descarga en una PWA instalada de iOS se valida en la Fase 5.
11. **Perfil sin red y coincidencia con el servidor.** El cliente genera el UUID, calcula el plan, guarda en Dexie y encola `POST /profile/onboarding/`. Si el servidor responde otra meta, prevalece la del servidor con actualización silenciosa (§17.15). Una prueba verifica que el cálculo local y el del servidor coinciden para todas las combinaciones de respuestas, y en desarrollo se emite un aviso en consola si difieren.
12. **Fuentes.** Lora y Plus Jakarta Sans autoalojadas en `public/fonts/` (`.woff2`), con sus archivos de licencia OFL.
13. **Iconos PWA** (180, 192 y 512 px). Se generan desde el SVG del girasol con un script de un solo uso, sin agregar su herramienta a `package.json`.
14. **Service Worker.** `autoUpdate` con precache del shell y de las fuentes; las llamadas a la API no se cachean. **Requisito para la Fase 4:** con el temporizador activo, una actualización del Service Worker no debe interrumpir ni recargar la sesión; la nueva versión se aplica al terminar o descartar la sesión.
15. **Enrutador.** Por estado en `App.tsx`, sin `react-router`.
16. **Dependencias aprobadas.** Producción: `react`, `react-dom`, `dexie`, `lucide-react`. Desarrollo: `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `typescript`, `vitest`, `jsdom`, `fake-indexeddb`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`. Opcional: `@testing-library/react`, solo si se prueban componentes.
17. **Prompt de Gemini.** Los turnos 2 a 5 reciben la etapa real del girasol (`ETAPA REAL DEL GIRASOL`), porque la capa 1 menciona el girasol en todos los turnos. El Turno 1 es local y no la necesita.
18. **Archivos adicionales a §13.2 (bloque 2).** `core/theme/geometryTokens.ts` (espaciado, radios, sombra, transiciones), `core/theme/themeCss.ts` (genera la hoja de variables CSS desde los tokens y Vite la inserta en el `<head>`, sin destello de tema), `core/theme/resolveTheme.ts` (lógica pura de elección de tema) y `core/theme/global.css` (`@font-face` y base). `ThemeContext` solo fija el atributo `data-theme`; las variables salen de la hoja generada. Una prueba falla si aparece un hex fuera de `colorTokens.ts`. Las fuentes son WOFF2 variables, subconjunto latino (cubre el español): Lora normal y cursiva, y Plus Jakarta Sans.
19. **Componentes base (bloque 3).** Los cuatro componentes de `core/components` usan solo tokens y variables de `core/theme`. Áreas táctiles de al menos 44 px en lo interactivo (`StreakBadge` es informativo y no la lleva). `BottomNavZen` expone `aria-label="Navegación principal"` y `aria-current="page"`. El anillo de foco usa solo el grosor como variable global; el color se resuelve en cada componente. Texto de `StreakBadge`: "N días seguidos", "1 día seguido" y "Sin racha aún" (este último, propuesto en el bloque 3). La galería de desarrollo (`gallery.html`, `src/dev/`) no se incluye en el build de producción y una prueba lo verifica.
