import React, { useState, useEffect } from 'react';
import {
  Sun,
  Moon,
  Settings,
  BookOpen,
  Sprout,
  BarChart2,
  Minus,
  Plus,
  Check,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Sparkles,
  Send,
  AlertCircle,
  ArrowLeft,
  Clock,
  Layers,
  Play,
  Pause,
  RotateCcw,
  X,
  CheckCircle2,
  Wind,
  MessageSquare,
  TrendingUp,
  Flower2,
  FileText,
  Book,
  Upload,
  Archive,
  RefreshCw,
  Cloud,
  Type,
  ShieldCheck
} from 'lucide-react';

// ============================================================================
// SISTEMA DE TOKENS: MODO CLARO (KOMOREBI) Y MODO OSCURO (TSUKIMI)
// ============================================================================
const THEMES = {
  light: {
    id: 'light',
    name: 'Komorebi (Día)',
    bgPrimary: '#F7F5F0',      // Papel Arroz
    bgSurface: '#EAE6DF',      // Piedra Suave
    bgElevated: '#FDFCFA',     // Lino Cálido
    bgHalo: '#FAF8F5',         // Halo Solar
    accentPrimary: '#E5A93C',  // Amarillo Ocre
    accentPressed: '#D1962F',
    accentSecondary: '#6B8E78',// Verde Salvia
    textPrimary: '#2C302E',    // Carbón Profundo
    textSecondary: '#7A7267',  // Tierra Café
    borderSubtle: '#DCD6CC',   // Arena Oscura
    stateWarning: '#C86D51',   // Terracota Suave
    outerCanvas: '#E2DDD5'
  },
  dark: {
    id: 'dark',
    name: 'Tsukimi (Noche Zen)',
    bgPrimary: '#181A18',      // Bosque Nocturno (Nunca #000000 puro)
    bgSurface: '#232623',      // Piedra Musgo Oscura
    bgElevated: '#2C302C',     // Carbón Cálido
    bgHalo: '#1E211E',         // Halo Lunar
    accentPrimary: '#EBB85B',  // Ámbar Lunar
    accentPressed: '#D4A146',
    accentSecondary: '#82A890',// Salvia Iluminado
    textPrimary: '#ECE8DF',    // Pergamino Suave
    textSecondary: '#A09A8E',  // Ceniza Cálida
    borderSubtle: '#363A36',   // Corteza Oscura
    stateWarning: '#D97F64',   // Arcilla Cálida
    outerCanvas: '#101210'
  }
};

// ============================================================================
// MOTOR BOTÁNICO SVG: GIRASOL ANIMADO (4 ETAPAS + VARIACIONES + VITALIDAD + BARBECHO)
// ============================================================================
const SunflowerCanvas = ({
  percentage = 45,
  variation = 'clasica', // 'clasica' | 'solar' | 'otonal'
  isWarning = false,
  isFocusActive = false,
  hasVitalityAura = false,
  isDormant = false, // Estado "En barbecho" (Archivado)
  theme = THEMES.light,
  size = 220,
  mini = false
}) => {
  const getStage = (pct) => {
    if (pct >= 100) return 4;
    if (pct >= 60) return 3;
    if (pct >= 25) return 2;
    return 1;
  };

  const stage = getStage(percentage);

  // Paleta botánica adaptativa según especie y estado
  const speciesPalette = {
    clasica: {
      petalOuter: isDormant ? '#9E988E' : theme.accentPrimary,
      petalInner: isDormant ? '#B5AFA4' : '#F2C46D',
      centerDark: theme.id === 'dark' ? '#181A18' : '#2C302E',
      centerRing: theme.textSecondary
    },
    solar: {
      petalOuter: isDormant ? '#9E988E' : theme.accentPrimary,
      petalInner: isDormant ? '#878178' : '#D19226',
      centerDark: theme.id === 'dark' ? '#181A18' : '#2C302E',
      centerRing: theme.accentPrimary
    },
    otonal: {
      petalOuter: isDormant ? '#9E988E' : theme.stateWarning,
      petalInner: isDormant ? '#B5AFA4' : theme.accentPrimary,
      centerDark: theme.id === 'dark' ? '#181A18' : '#2C302E',
      centerRing: theme.textSecondary
    }
  }[variation] || {
    petalOuter: theme.accentPrimary,
    petalInner: '#F2C46D',
    centerDark: '#2C302E',
    centerRing: theme.textSecondary
  };

  const stemColor = isDormant
    ? theme.textSecondary
    : isWarning
    ? theme.stateWarning
    : theme.accentSecondary;

  const strokeColor = theme.id === 'dark' ? '#ECE8DF' : '#2C302E';

  const renderFullFlowerHead = () => {
    const petals = [];
    const count = variation === 'solar' ? 16 : 12;

    for (let i = 0; i < count; i++) {
      const angle = (360 / count) * i;
      if (variation === 'clasica') {
        petals.push(
          <g key={`p-${i}`} transform={`rotate(${angle} 110 78)`}>
            <path
              d="M 110 42 C 118 42, 121 58, 110 70 C 99 58, 102 42, 110 42 Z"
              fill={i % 2 === 0 ? speciesPalette.petalOuter : speciesPalette.petalInner}
              stroke={strokeColor}
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </g>
        );
      } else if (variation === 'solar') {
        petals.push(
          <g key={`p-${i}`} transform={`rotate(${angle} 110 78)`}>
            <polygon
              points="110,36 117,58 110,72 103,58"
              fill={i % 2 === 0 ? speciesPalette.petalOuter : speciesPalette.petalInner}
              stroke={strokeColor}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </g>
        );
      } else {
        petals.push(
          <g key={`p-${i}`} transform={`rotate(${angle} 110 78)`}>
            <path
              d="M 110 38 C 122 46, 119 62, 110 72 C 101 62, 98 46, 110 38 Z"
              fill={i % 2 === 0 ? speciesPalette.petalOuter : speciesPalette.petalInner}
              stroke={strokeColor}
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </g>
        );
      }
    }

    return (
      <g className={isWarning || isDormant ? '' : 'flower-head-breathe'}>
        {petals}
        <circle
          cx="110"
          cy="78"
          r="17"
          fill={speciesPalette.centerDark}
          stroke={strokeColor}
          strokeWidth="1.75"
        />
        <circle
          cx="110"
          cy="78"
          r="12"
          fill="none"
          stroke={speciesPalette.centerRing}
          strokeWidth="1.2"
          strokeDasharray="2 3"
        />
        <circle cx="106" cy="74" r="1.3" fill={theme.bgSurface} />
        <circle cx="114" cy="74" r="1.3" fill={theme.bgSurface} />
        <circle cx="110" cy="78" r="1.3" fill={theme.bgSurface} />
        <circle cx="105" cy="82" r="1.3" fill={theme.bgSurface} />
        <circle cx="115" cy="82" r="1.3" fill={theme.bgSurface} />
      </g>
    );
  };

  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{ width: size, height: size }}
    >
      {/* Contenedor Circular (Halo 220x220px) */}
      {!mini && (
        <div
          className={`absolute inset-0 rounded-full transition-all duration-700 ${
            isFocusActive && !isWarning && !isDormant ? 'halo-pulse' : ''
          }`}
          style={{
            backgroundColor: isWarning
              ? `${theme.stateWarning}18`
              : theme.bgHalo,
            border: isWarning
              ? `2px solid ${theme.stateWarning}`
              : hasVitalityAura
              ? `2px solid ${theme.accentPrimary}`
              : isDormant
              ? `1.5px dashed ${theme.borderSubtle}`
              : `1.5px solid ${theme.bgSurface}`,
            boxShadow: hasVitalityAura
              ? `0 0 28px ${theme.accentPrimary}35`
              : 'none'
          }}
        />
      )}

      <svg
        viewBox="0 0 220 220"
        className="w-full h-full relative z-10 overflow-visible"
        style={{ opacity: isDormant ? 0.65 : 1 }}
      >
        {/* Bono de Vitalidad Solar (RF-03: cuando el avance físico es <1%) */}
        {hasVitalityAura && !mini && (
          <g className="komorebi-particles">
            <circle
              cx="110"
              cy="110"
              r="86"
              fill="none"
              stroke={theme.accentPrimary}
              strokeWidth="1.2"
              strokeDasharray="4 6"
              opacity="0.65"
            />
            <circle cx="48" cy="78" r="3.5" fill={theme.accentPrimary} opacity="0.7" />
            <circle cx="172" cy="74" r="3" fill={theme.accentPrimary} opacity="0.7" />
            <circle cx="110" cy="26" r="4" fill={theme.accentPrimary} opacity="0.6" />
          </g>
        )}

        {/* Partículas Komorebi / Tsukimi */}
        {(stage === 4 || isFocusActive) && !isWarning && !isDormant && !mini && (
          <g className="komorebi-particles">
            <circle cx="52" cy="58" r="2.5" fill={theme.accentPrimary} opacity="0.45" />
            <circle cx="168" cy="64" r="3.5" fill={theme.accentPrimary} opacity="0.35" />
            <circle cx="155" cy="115" r="2" fill={theme.accentSecondary} opacity="0.4" />
            <circle cx="62" cy="122" r="2.2" fill={theme.accentPrimary} opacity="0.4" />
          </g>
        )}

        <g
          className={
            isDormant
              ? ''
              : isWarning
              ? 'plant-wilt'
              : stage === 1
              ? 'seed-breathe'
              : 'plant-sway'
          }
          style={{ transformOrigin: '110px 178px' }}
        >
          {/* ETAPA 1: SEMILLA (0 - 24%) */}
          {stage === 1 && (
            <g>
              <path
                d="M 110 176 Q 110 156 110 144"
                fill="none"
                stroke={stemColor}
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="M 110 152 C 94 146, 90 134, 104 136 C 108 137, 110 145, 110 152 Z"
                fill={stemColor}
                stroke={strokeColor}
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
              <path
                d="M 110 152 C 126 146, 130 134, 116 136 C 112 137, 110 145, 110 152 Z"
                fill={stemColor}
                stroke={strokeColor}
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
              <ellipse
                cx="110"
                cy="168"
                rx="5"
                ry="7"
                fill={theme.textSecondary}
                stroke={strokeColor}
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* ETAPA 2: TALLO (25 - 59%) */}
          {stage === 2 && (
            <g>
              <path
                d={
                  isWarning
                    ? 'M 110 176 Q 112 140 124 108'
                    : 'M 110 176 Q 108 138 110 102'
                }
                fill="none"
                stroke={stemColor}
                strokeWidth="3.5"
                strokeLinecap="round"
              />
              <path
                d="M 109 152 C 82 148, 76 128, 96 128 C 104 128, 108 142, 109 152 Z"
                fill={stemColor}
                stroke={strokeColor}
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
              <path
                d="M 110 142 C 136 138, 142 118, 122 118 C 114 118, 111 132, 110 142 Z"
                fill={stemColor}
                stroke={strokeColor}
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
              <path
                d="M 110 104 C 102 92, 110 84, 110 84 C 110 84, 118 92, 110 104 Z"
                fill={stemColor}
                stroke={strokeColor}
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
            </g>
          )}

          {/* ETAPA 3: CAPULLO (60 - 99%) */}
          {stage === 3 && (
            <g>
              <path
                d={
                  isWarning
                    ? 'M 110 176 Q 115 130 128 92'
                    : 'M 110 176 Q 107 130 110 86'
                }
                fill="none"
                stroke={stemColor}
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M 109 154 C 78 150, 72 128, 94 128 C 103 128, 108 144, 109 154 Z"
                fill={stemColor}
                stroke={strokeColor}
                strokeWidth="1.75"
              />
              <path
                d="M 110 144 C 140 140, 146 118, 124 118 C 115 118, 111 134, 110 144 Z"
                fill={stemColor}
                stroke={strokeColor}
                strokeWidth="1.75"
              />
              <path
                d="M 109 120 C 84 114, 82 98, 98 100 C 105 101, 108 112, 109 120 Z"
                fill={stemColor}
                stroke={strokeColor}
                strokeWidth="1.75"
              />
              <g transform={isWarning ? 'translate(18, 6) rotate(18 110 84)' : ''}>
                <path
                  d="M 102 74 L 105 60 L 110 70 L 115 58 L 118 74 Z"
                  fill={speciesPalette.petalOuter}
                  stroke={strokeColor}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M 96 84 C 96 68, 124 68, 124 84 C 124 92, 96 92, 96 84 Z"
                  fill={stemColor}
                  stroke={strokeColor}
                  strokeWidth="1.75"
                />
              </g>
            </g>
          )}

          {/* ETAPA 4: FLOR COMPLETA (100%) */}
          {stage === 4 && (
            <g>
              <path
                d="M 110 176 Q 107 128 110 82"
                fill="none"
                stroke={stemColor}
                strokeWidth="4.2"
                strokeLinecap="round"
              />
              <path
                d="M 109 154 C 74 148, 68 124, 92 124 C 102 124, 108 142, 109 154 Z"
                fill={stemColor}
                stroke={strokeColor}
                strokeWidth="1.75"
              />
              <path
                d="M 110 142 C 144 136, 150 112, 126 112 C 116 112, 111 130, 110 142 Z"
                fill={stemColor}
                stroke={strokeColor}
                strokeWidth="1.75"
              />
              {renderFullFlowerHead()}
            </g>
          )}
        </g>

        {/* Montículo de Tierra */}
        <path
          d="M 72 182 Q 110 166 148 182 Z"
          fill={theme.bgSurface}
          stroke={strokeColor}
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path
          d="M 64 182 L 156 182"
          stroke={strokeColor}
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
};

// ============================================================================
// DATOS INICIALES: BIBLIOTECA HÍBRIDA (.EPUB + LIBROS FÍSICOS)
// ============================================================================
const INITIAL_BOOKS = [
  {
    id: 'b1',
    title: 'Hábitos Atómicos',
    author: 'James Clear',
    format: 'EPUB', // 'EPUB' | 'FISICO'
    unit: 'Páginas CFI',
    current: 112,
    total: 250,
    variation: 'clasica',
    active: true,
    archived: false,
    epubPages: [
      {
        chapter: 'Capítulo 4: El hombre que no se veía bien',
        cfi: 'epubcfi(/6/8[chap04]!/4/2/1:0)',
        content:
          'El cerebro humano es una máquina de predicción. Continuamente observa tu entorno, analiza lo que encuentra y predice lo que sucederá a continuación. Cuando experimentas algo de manera repetida, tu cerebro comienza a notar lo que es importante, clasificando los detalles y destacando las señales relevantes sin necesidad de pensar conscientemente.'
      },
      {
        chapter: 'Capítulo 4: El Registro de Hábitos',
        cfi: 'epubcfi(/6/8[chap04]!/4/4/1:0)',
        content:
          'El sistema ferroviario japonés es considerado uno de los mejores del mundo. Sus operadores utilizan un proceso llamado "Señalar y Nombrar" (Pointing and Calling), donde señalan físicamente cada velocímetro y dicen en voz alta su estado. Este método reduce los errores hasta en un 85 por ciento porque eleva un hábito no consciente a un nivel consciente.'
      },
      {
        chapter: 'Capítulo 5: La mejor manera de empezar un hábito',
        cfi: 'epubcfi(/6/10[chap05]!/4/2/1:0)',
        content:
          'Las intenciones de implementación son planes específicos que haces de antemano sobre cuándo y dónde actuarás. La fórmula es sencilla: "Cuando ocurra la situación X, yo realizaré la respuesta Y". Las personas que hacen un plan concreto para cuándo y dónde realizarán un nuevo hábito tienen muchas más probabilidades de mantenerlo.'
      }
    ]
  },
  {
    id: 'b2',
    title: 'El Arte de la Calma',
    author: 'Shunmyo Masuno',
    format: 'FISICO',
    unit: 'Páginas',
    current: 45,
    total: 200,
    variation: 'solar',
    active: false,
    archived: false
  },
  {
    id: 'b3',
    title: 'Siddhartha',
    author: 'Hermann Hesse',
    format: 'EPUB',
    unit: 'Páginas CFI',
    current: 160,
    total: 160,
    variation: 'otonal',
    active: false,
    archived: false
  },
  {
    id: 'b4',
    title: 'Crítica de la Razón Pura',
    author: 'Immanuel Kant',
    format: 'FISICO',
    unit: 'Páginas',
    current: 85,
    total: 650,
    variation: 'clasica',
    active: false,
    archived: true // En barbecho
  }
];

const ONBOARDING_QUESTIONS = [
  {
    id: 1,
    category: 'Hábito actual',
    question: '¿Cuántos libros sueles leer al año?',
    options: ['Ninguno aún', '1 a 3 libros', '4 a 8 libros', 'Más de 8']
  },
  {
    id: 2,
    category: 'Disponibilidad diaria',
    question: '¿Cuánto tiempo tranquilo puedes dedicarle a la lectura al día?',
    options: ['10 min', '15-20 min', '30 min', '+45 min']
  },
  {
    id: 3,
    category: 'Momento ideal',
    question: '¿En qué momento del día sientes más calma para leer?',
    options: ['Al despertar', 'En la tarde', 'Antes de dormir', 'En trayectos']
  },
  {
    id: 4,
    category: 'Principal obstáculo',
    question: '¿Qué suele interrumpir tu concentración al leer?',
    options: [
      'Notificaciones del celular',
      'Cansancio o sueño',
      'Pierdo el hilo de la historia',
      'Falta de constancia'
    ]
  },
  {
    id: 5,
    category: 'Preferencia de reflexión',
    question: 'Al terminar de leer un capítulo, ¿cómo prefieres conversar con la IA?',
    options: [
      'Preguntas rápidas de memoria',
      'Análisis profundo de la trama y personajes',
      'Solo resumir ideas clave'
    ]
  }
];

export default function App() {
  // Tema Activo: 'light' (Komorebi) | 'dark' (Tsukimi)
  const [themeMode, setThemeMode] = useState('light');
  const theme = THEMES[themeMode];

  // Navegación principal
  const [currentScreen, setCurrentScreen] = useState('dashboard');

  // Estado de Biblioteca Híbrida
  const [books, setBooks] = useState(INITIAL_BOOKS);
  const activeBook = books.find((b) => b.active && !b.archived) || books[0];
  const activePercentage = Math.min(
    100,
    Math.round((activeBook.current / activeBook.total) * 100)
  );

  // Controles del Laboratorio Botánico
  const [overrideStagePct, setOverrideStagePct] = useState(null);
  const [overrideVariation, setOverrideVariation] = useState(null);
  const [vitalityBonusActive, setVitalityBonusActive] = useState(false);
  const [inspectDormant, setInspectDormant] = useState(false);

  const displayedPct =
    overrideStagePct !== null ? overrideStagePct : activePercentage;
  const displayedVariation =
    overrideVariation !== null ? overrideVariation : activeBook.variation;

  // Estado del Temporizador y Período de Gracia de 15s (RF-02)
  const [timerMinutes, setTimerMinutes] = useState(15);
  const [focusSecondsLeft, setFocusSecondsLeft] = useState(15 * 60);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [gracePeriodActive, setGracePeriodActive] = useState(false);
  const [graceSecondsLeft, setGraceSecondsLeft] = useState(15);
  const [sessionInvalidated, setSessionInvalidated] = useState(false);
  const [earlyFinishEligible, setEarlyFinishEligible] = useState(true); // >= 50% del tiempo

  // Estado Lector ePub Zen (Sección 10.8)
  const [epubPageIndex, setEpubPageIndex] = useState(0);
  const [epubFontSize, setEpubFontSize] = useState(17);
  const [showEpubTypographySettings, setShowEpubTypographySettings] = useState(false);

  // Estado Post-Lectura
  const [postReadStep, setPostReadStep] = useState(1);
  const [tempPhysicalPage, setTempPhysicalPage] = useState(activeBook.current + 5);
  const [earnedVitalityInSession, setEarnedVitalityInSession] = useState(false);

  // Estado Chat con Gemini Acotado a 5 Turnos (RF-05)
  const [chatTurnCount, setChatTurnCount] = useState(1);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);

  // Estado Mi Jardín y Modal Híbrido para Plantar Libro (CU-02)
  const [gardenTab, setGardenTab] = useState('growing'); // 'growing' | 'bloomed' | 'dormant'
  const [showNewBookModal, setShowNewBookModal] = useState(false);
  const [newBookFormat, setNewBookFormat] = useState('EPUB'); // 'EPUB' | 'FISICO'
  const [newBookTitle, setNewBookTitle] = useState('');
  const [newBookAuthor, setNewBookAuthor] = useState('');
  const [newBookTotalPages, setNewBookTotalPages] = useState('220');
  const [newBookVariation, setNewBookVariation] = useState('clasica');
  const [simulatedEpubLoaded, setSimulatedEpubLoaded] = useState(false);

  // Estado Onboarding y Perfil Offline-First (RF-07)
  const [quizStep, setQuizStep] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState({
    0: '1 a 3 libros',
    1: '15-20 min',
    2: 'Antes de dormir',
    3: 'Notificaciones del celular',
    4: 'Análisis profundo de la trama y personajes'
  });
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [cloudSyncLinked, setCloudSyncLinked] = useState(false);
  const [streakDays] = useState(5);

  // Inicializar el primer mensaje de Gemini según el formato del libro activo (Dual Prompt RF-05)
  useEffect(() => {
    setTempPhysicalPage(Math.min(activeBook.total, activeBook.current + 4));
    if (activeBook.format === 'EPUB') {
      const currentEpubExcerpt =
        activeBook.epubPages?.[epubPageIndex]?.content ||
        'El proceso de Señalar y Nombrar eleva un hábito no consciente a un nivel consciente.';
      setChatMessages([
        {
          id: 'init-epub',
          sender: 'ai',
          text: `He leído contigo este fragmento de "${activeBook.title}": "${currentEpubExcerpt.slice(
            0,
            105
          )}...". ¿Cómo crees que hacer consciente un gesto automático podría ayudarte en tu rutina diaria?`
        }
      ]);
    } else {
      setChatMessages([
        {
          id: 'init-fisico',
          sender: 'ai',
          text: `Qué buena sesión con tu ejemplar físico de "${activeBook.title}" de ${activeBook.author}. Sin importar la edición que tengas en manos, cuéntame: ¿qué idea, escena o frase de las páginas que leíste hoy te dejó pensando?`
        }
      ]);
    }
    setChatTurnCount(1);
  }, [activeBook, epubPageIndex]);

  // Reloj principal en Focus Mode
  useEffect(() => {
    if (
      currentScreen !== 'focus' ||
      isTimerPaused ||
      gracePeriodActive ||
      sessionInvalidated
    )
      return;
    const interval = setInterval(() => {
      setFocusSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleCompleteFocusSession();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [currentScreen, isTimerPaused, gracePeriodActive, sessionInvalidated]);

  // Cuenta regresiva de 15 segundos de Período de Gracia (RF-02)
  useEffect(() => {
    if (!gracePeriodActive || sessionInvalidated) return;
    const graceTimer = setInterval(() => {
      setGraceSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(graceTimer);
          setSessionInvalidated(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(graceTimer);
  }, [gracePeriodActive, sessionInvalidated]);

  const formatTime = (totalSec) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Al terminar el Focus Mode (CU-04)
  const handleCompleteFocusSession = () => {
    setGracePeriodActive(false);
    setSessionInvalidated(false);
    if (activeBook.format === 'EPUB') {
      // En modo .epub el progreso ya se actualizó automáticamente al pasar páginas; salta directo al Paso 2 (Trigger IA)
      setPostReadStep(2);
    } else {
      setPostReadStep(1);
    }
    setCurrentScreen('post-reading');
  };

  // Pasar página en el Lector ePub Zen (Actualiza automáticamente CFI y %)
  const handleFlipEpubPage = (direction) => {
    const pages = activeBook.epubPages || INITIAL_BOOKS[0].epubPages;
    const nextIdx = Math.max(0, Math.min(pages.length - 1, epubPageIndex + direction));
    setEpubPageIndex(nextIdx);

    if (direction > 0) {
      const updated = books.map((b) =>
        b.id === activeBook.id
          ? { ...b, current: Math.min(b.total, b.current + 6) }
          : b
      );
      setBooks(updated);
    }
  };

  // Guardar progreso de Libro Físico con Bono de Vitalidad si avance < 1% (CU-04 / RF-03)
  const handleSavePhysicalProgress = () => {
    const newPage = Math.min(activeBook.total, Math.max(0, Number(tempPhysicalPage)));
    const deltaPct = ((newPage - activeBook.current) / activeBook.total) * 100;

    if (deltaPct < 1) {
      setVitalityBonusActive(true);
      setEarnedVitalityInSession(true);
    } else {
      setEarnedVitalityInSession(false);
    }

    const updated = books.map((b) =>
      b.id === activeBook.id ? { ...b, current: newPage } : b
    );
    setBooks(updated);
    setOverrideStagePct(null);
    setPostReadStep(2);
  };

  // Enviar mensaje a Gemini respetando el límite de 5 turnos (RF-05)
  const handleSendMessage = (customPrompt) => {
    if (chatTurnCount >= 5) return;
    const textToSend = customPrompt || chatInput;
    if (!textToSend.trim()) return;

    const nextTurn = chatTurnCount + 1;
    setChatMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, sender: 'user', text: textToSend }
    ]);
    if (!customPrompt) setChatInput('');
    setIsAiTyping(true);

    setTimeout(() => {
      let aiReply = '';
      if (nextTurn >= 5) {
        aiReply =
          'Hemos llegado al quinto intercambio de nuestra reflexión Zen de hoy. Te llevas una idea clara y accionable de tu lectura. Guarda esta reflexión para nutrir tu jardín y descansar la mente.';
      } else if (activeBook.format === 'EPUB') {
        aiReply =
          'Conectando con el párrafo XHTML que acabas de leer: cuando defines el "cuándo y dónde" exacto, eliminas la fatiga de decisión. ¿Dónde dejarás preparado tu libro para mañana?';
      } else {
        aiReply =
          'Qué valiosa observación sobre tu lectura física. Ponerlo en tus propias palabras consolida el recuerdo a largo plazo. ¿Cómo se relaciona esa escena con lo que venías leyendo en capítulos anteriores?';
      }

      setChatMessages((prev) => [
        ...prev,
        { id: `ai-${Date.now()}`, sender: 'ai', text: aiReply }
      ]);
      setChatTurnCount(nextTurn);
      setIsAiTyping(false);
    }, 700);
  };

  // Plantar nuevo libro Híbrido (CU-02)
  const handlePlantNewBook = (e) => {
    e.preventDefault();
    if (!newBookTitle.trim()) return;
    const created = {
      id: `b-${Date.now()}`,
      title: newBookTitle.trim(),
      author: newBookAuthor.trim() || 'Autor desconocido',
      format: newBookFormat,
      unit: newBookFormat === 'EPUB' ? 'Páginas CFI' : 'Páginas',
      current: 0,
      total:
        newBookFormat === 'EPUB'
          ? 180
          : Math.max(10, parseInt(newBookTotalPages, 10) || 200),
      variation: newBookVariation,
      active: true,
      archived: false,
      epubPages: INITIAL_BOOKS[0].epubPages
    };
    setBooks(books.map((b) => ({ ...b, active: false })).concat(created));
    setNewBookTitle('');
    setNewBookAuthor('');
    setSimulatedEpubLoaded(false);
    setShowNewBookModal(false);
  };

  // Archivar / Desarchivar libro ("En barbecho" - RF-01)
  const toggleArchiveBook = (bookId, e) => {
    e.stopPropagation();
    setBooks((prev) =>
      prev.map((b) =>
        b.id === bookId ? { ...b, archived: !b.archived, active: false } : b
      )
    );
  };

  const SCREEN_TABS = [
    { id: 'onboarding', label: '1. Onboarding' },
    { id: 'dashboard', label: '2. Dashboard Zen' },
    { id: 'focus', label: '3. Focus Híbrido (.epub/Físico)' },
    { id: 'post-reading', label: '4. Modal Post-Lectura' },
    { id: 'ai-chat', label: '5. Chat IA (5 Turnos)' },
    { id: 'garden', label: '6. Mi Jardín Híbrido' },
    { id: 'stats', label: '7. Estadísticas & Sync' }
  ];

  return (
    <div
      className="min-h-screen transition-colors duration-500 pb-16 font-sans-ui"
      style={{ backgroundColor: theme.outerCanvas, color: theme.textPrimary }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,500;0,600;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

        .font-serif-editorial {
          font-family: 'Lora', Georgia, serif;
        }
        .font-sans-ui {
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .tabular-timer {
          font-variant-numeric: tabular-nums;
        }

        @keyframes sway {
          0%, 100% { transform: rotate(-2deg); }
          50% { transform: rotate(2deg); }
        }
        @keyframes seedBreathe {
          0%, 100% { transform: scale(1) translateY(0px); }
          50% { transform: scale(1.04) translateY(-2px); }
        }
        @keyframes flowerHeadBreathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @keyframes floatParticles {
          0%, 100% { transform: translateY(0px); opacity: 0.35; }
          50% { transform: translateY(-6px); opacity: 0.8; }
        }
        @keyframes haloBreathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }

        .plant-sway { animation: sway 5.5s ease-in-out infinite; }
        .seed-breathe { animation: seedBreathe 4s ease-in-out infinite; }
        .flower-head-breathe { transform-origin: 110px 78px; animation: flowerHeadBreathe 4.5s ease-in-out infinite; }
        .plant-wilt { transform: rotate(9deg) scale(0.95); transition: transform 0.5s ease-out; }
        .komorebi-particles { animation: floatParticles 5s ease-in-out infinite; }
        .halo-pulse { animation: haloBreathe 4s ease-in-out infinite; }
      `}</style>

      {/* =================================================================== */}
      {/* BARRA SUPERIOR PERSISTENTE: NAVEGADOR DE VISTAS Y TEMA DÍA/NOCHE    */}
      {/* =================================================================== */}
      <header
        className="sticky top-0 z-40 backdrop-blur border-b px-4 py-3 transition-colors duration-300"
        style={{
          backgroundColor: `${theme.bgElevated}F2`,
          borderColor: theme.borderSubtle
        }}
      >
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: theme.accentPrimary,
                color: '#181A18'
              }}
            >
              {themeMode === 'light' ? (
                <Sun className="w-5 h-5 stroke-[1.8]" />
              ) : (
                <Moon className="w-5 h-5 stroke-[1.8]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-serif-editorial font-semibold text-lg">
                  Komi v1.0
                </h1>
                <span
                  className="text-xs font-medium px-2.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: theme.bgSurface,
                    color: theme.textSecondary
                  }}
                >
                  Híbrido (.epub + Físico) • {theme.name}
                </span>
              </div>
              <p className="text-xs" style={{ color: theme.textSecondary }}>
                Prototipo Interactivo Completo • Sin Emojis • Modo Claro y Oscuro
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {SCREEN_TABS.map((tab) => {
              const active = currentScreen === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setCurrentScreen(tab.id);
                    if (tab.id === 'focus') {
                      setFocusSecondsLeft(timerMinutes * 60);
                      setGracePeriodActive(false);
                      setSessionInvalidated(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={{
                    backgroundColor: active ? theme.accentPrimary : theme.bgSurface,
                    color: active ? '#181A18' : theme.textSecondary,
                    fontWeight: active ? 600 : 500
                  }}
                >
                  {tab.label}
                </button>
              );
            })}

            {/* Toggle Modo Claro (Komorebi) vs Modo Oscuro (Tsukimi) */}
            <button
              onClick={() =>
                setThemeMode(themeMode === 'light' ? 'dark' : 'light')
              }
              className="ml-1 px-3.5 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 transition-all"
              style={{
                backgroundColor: theme.bgPrimary,
                color: theme.textPrimary,
                borderColor: theme.accentPrimary
              }}
            >
              {themeMode === 'light' ? (
                <>
                  <Moon className="w-3.5 h-3.5 text-[#E5A93C]" />
                  <span>Modo Oscuro (Tsukimi)</span>
                </>
              ) : (
                <>
                  <Sun className="w-3.5 h-3.5 text-[#EBB85B]" />
                  <span>Modo Claro (Komorebi)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* =================================================================== */}
      {/* CONTENEDOR PRINCIPAL: LABORATORIO BOTÁNICO + SIMULADOR MOBILE       */}
      {/* =================================================================== */}
      <main className="max-w-7xl mx-auto px-4 pt-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* COLUMNA IZQUIERDA (5 cols): CONTROLES HÍBRIDOS Y LABORATORIO SVG */}
        <section className="lg:col-span-5 space-y-5">
          {/* Selector rápido del formato del libro activo para probar el flujo híbrido */}
          <div
            className="rounded-[20px] p-5 border transition-colors"
            style={{
              backgroundColor: theme.bgElevated,
              borderColor: theme.borderSubtle
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: theme.accentSecondary }}>
                Simulador de Flujo Híbrido (CU-02 / CU-03)
              </span>
              <span
                className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: theme.bgSurface,
                  color: theme.accentPrimary
                }}
              >
                Activo: {activeBook.format}
              </span>
            </div>
            <p className="text-xs mb-3" style={{ color: theme.textSecondary }}>
              Cambia el formato del libro activo para ver cómo se adapta el{' '}
              <strong>Focus Mode</strong> (Lector ePub integrado vs Temporizador físico)
              y el <strong>Chat con Gemini</strong>:
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => {
                  setBooks(
                    books.map((b) => ({
                      ...b,
                      active: b.id === 'b1',
                      archived: b.id === 'b1' ? false : b.archived
                    }))
                  );
                }}
                className="p-3 rounded-[14px] border text-left flex items-center gap-2.5 transition-all"
                style={{
                  backgroundColor:
                    activeBook.format === 'EPUB' ? theme.bgPrimary : theme.bgSurface,
                  borderColor:
                    activeBook.format === 'EPUB'
                      ? theme.accentPrimary
                      : 'transparent'
                }}
              >
                <FileText className="w-5 h-5 shrink-0" style={{ color: theme.accentPrimary }} />
                <div>
                  <div className="text-xs font-bold">Modo Digital (.epub)</div>
                  <div className="text-[11px]" style={{ color: theme.textSecondary }}>
                    Hábitos Atómicos (Lector + XHTML)
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  setBooks(
                    books.map((b) => ({
                      ...b,
                      active: b.id === 'b2',
                      archived: b.id === 'b2' ? false : b.archived
                    }))
                  );
                }}
                className="p-3 rounded-[14px] border text-left flex items-center gap-2.5 transition-all"
                style={{
                  backgroundColor:
                    activeBook.format === 'FISICO'
                      ? theme.bgPrimary
                      : theme.bgSurface,
                  borderColor:
                    activeBook.format === 'FISICO'
                      ? theme.accentPrimary
                      : 'transparent'
                }}
              >
                <Book className="w-5 h-5 shrink-0" style={{ color: theme.accentSecondary }} />
                <div>
                  <div className="text-xs font-bold">Modo Libro Físico</div>
                  <div className="text-[11px]" style={{ color: theme.textSecondary }}>
                    El Arte de la Calma (Reloj Zen)
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Inspector Botánico SVG */}
          <div
            className="rounded-[20px] p-5 border transition-colors"
            style={{
              backgroundColor: theme.bgElevated,
              borderColor: theme.borderSubtle
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sprout className="w-5 h-5" style={{ color: theme.accentSecondary }} />
                <h2 className="font-serif-editorial font-semibold text-base">
                  Laboratorio Botánico SVG (RF-01 / RF-03)
                </h2>
              </div>
              {(overrideStagePct !== null ||
                overrideVariation !== null ||
                vitalityBonusActive ||
                inspectDormant) && (
                <button
                  onClick={() => {
                    setOverrideStagePct(null);
                    setOverrideVariation(null);
                    setVitalityBonusActive(false);
                    setInspectDormant(false);
                  }}
                  className="text-xs underline flex items-center gap-1"
                  style={{ color: theme.textSecondary }}
                >
                  <RotateCcw className="w-3 h-3" />
                  Restaurar
                </button>
              )}
            </div>

            {/* Selector de las 4 Etapas */}
            <div className="mb-4">
              <label
                className="block text-xs font-medium mb-2"
                style={{ color: theme.textSecondary }}
              >
                Etapas de Crecimiento (Actual: {displayedPct}%)
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '1. Semilla', pct: 12, range: '0-24%' },
                  { label: '2. Tallo', pct: 45, range: '25-59%' },
                  { label: '3. Capullo', pct: 80, range: '60-99%' },
                  { label: '4. Flor', pct: 100, range: '100%' }
                ].map((st) => {
                  const isSelected =
                    (st.pct === 12 && displayedPct < 25) ||
                    (st.pct === 45 && displayedPct >= 25 && displayedPct < 60) ||
                    (st.pct === 80 && displayedPct >= 60 && displayedPct < 100) ||
                    (st.pct === 100 && displayedPct >= 100);
                  return (
                    <button
                      key={st.label}
                      onClick={() => setOverrideStagePct(st.pct)}
                      className="p-2.5 rounded-[12px] text-left border transition-all"
                      style={{
                        backgroundColor: isSelected
                          ? theme.bgPrimary
                          : theme.bgSurface,
                        borderColor: isSelected
                          ? theme.accentSecondary
                          : 'transparent'
                      }}
                    >
                      <div className="text-xs font-semibold">{st.label}</div>
                      <div className="text-[10px]" style={{ color: theme.textSecondary }}>
                        {st.range}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Estados Especiales: Bono de Vitalidad (<1% avance) y En Barbecho */}
            <div className="grid grid-cols-2 gap-2.5 pt-2 border-t" style={{ borderColor: theme.borderSubtle }}>
              <button
                onClick={() => setVitalityBonusActive(!vitalityBonusActive)}
                className="p-2.5 rounded-[12px] border text-left flex items-center justify-between transition-all"
                style={{
                  backgroundColor: vitalityBonusActive
                    ? `${theme.accentPrimary}20`
                    : theme.bgSurface,
                  borderColor: vitalityBonusActive
                    ? theme.accentPrimary
                    : 'transparent'
                }}
              >
                <div>
                  <div className="text-xs font-semibold">Bono de Vitalidad</div>
                  <div className="text-[10px]" style={{ color: theme.textSecondary }}>
                    Avance físico &lt; 1%
                  </div>
                </div>
                <Sparkles className="w-4 h-4" style={{ color: theme.accentPrimary }} />
              </button>

              <button
                onClick={() => setInspectDormant(!inspectDormant)}
                className="p-2.5 rounded-[12px] border text-left flex items-center justify-between transition-all"
                style={{
                  backgroundColor: inspectDormant
                    ? theme.bgPrimary
                    : theme.bgSurface,
                  borderColor: inspectDormant
                    ? theme.textSecondary
                    : 'transparent'
                }}
              >
                <div>
                  <div className="text-xs font-semibold">En Barbecho</div>
                  <div className="text-[10px]" style={{ color: theme.textSecondary }}>
                    Libro pausado/archivado
                  </div>
                </div>
                <Archive className="w-4 h-4" style={{ color: theme.textSecondary }} />
              </button>
            </div>
          </div>

          {/* Comparativa de Tokens: Komorebi (Día) vs Tsukimi (Noche) */}
          <div
            className="rounded-[20px] p-5 border transition-colors"
            style={{
              backgroundColor: theme.bgElevated,
              borderColor: theme.borderSubtle
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-serif-editorial font-semibold text-sm">
                Paleta Activa: {theme.name}
              </h3>
              <span className="text-[11px]" style={{ color: theme.textSecondary }}>
                Contraste cálido sin #000000 ni #FFFFFF
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[
                { hex: theme.bgPrimary, token: 'bg-primary' },
                { hex: theme.bgSurface, token: 'bg-surface' },
                { hex: theme.bgElevated, token: 'bg-elevated' },
                { hex: theme.accentPrimary, token: 'accent-primary' },
                { hex: theme.accentSecondary, token: 'accent-secondary' },
                { hex: theme.stateWarning, token: 'state-warning' }
              ].map((c) => (
                <div
                  key={c.token}
                  className="flex items-center gap-2 p-2 rounded-[12px] border"
                  style={{
                    backgroundColor: theme.bgPrimary,
                    borderColor: theme.borderSubtle
                  }}
                >
                  <span
                    className="w-5 h-5 rounded-full border shrink-0"
                    style={{
                      backgroundColor: c.hex,
                      borderColor: theme.borderSubtle
                    }}
                  />
                  <div className="truncate">
                    <div className="font-semibold text-[11px] truncate">
                      {c.token}
                    </div>
                    <div className="text-[10px]" style={{ color: theme.textSecondary }}>
                      {c.hex}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================================================================= */}
        {/* COLUMNA DERECHA (7 cols): DISPOSITIVO MOBILE INTERACTIVO          */}
        {/* ================================================================= */}
        <section className="lg:col-span-7 flex flex-col items-center">
          <div
            className="relative w-full max-w-[394px] h-[820px] rounded-[44px] border-[10px] shadow-2xl overflow-hidden flex flex-col justify-between transition-colors duration-500"
            style={{
              backgroundColor: theme.bgPrimary,
              borderColor: themeMode === 'light' ? '#2C302E' : '#2C302C',
              color: theme.textPrimary
            }}
          >
            {/* Barra de Estado Mobile (100% SVG) */}
            <div className="px-6 pt-3 pb-2 flex items-center justify-between text-xs font-semibold shrink-0 select-none">
              <span className="tabular-timer">9:41</span>
              <div
                className="w-20 h-4 rounded-full"
                style={{
                  backgroundColor: themeMode === 'light' ? '#2C302E' : '#0E100E'
                }}
              />
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="1" y="11" width="2.2" height="4" rx="0.5" />
                  <rect x="4.5" y="8.5" width="2.2" height="6.5" rx="0.5" />
                  <rect x="8" y="5.5" width="2.2" height="9.5" rx="0.5" />
                  <rect x="11.5" y="2.5" width="2.2" height="12.5" rx="0.5" />
                </svg>
                <svg className="w-4 h-4" viewBox="0 0 20 12" fill="none">
                  <rect
                    x="1"
                    y="1.5"
                    width="15"
                    height="9"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <rect x="3" y="3.5" width="11" height="5" rx="1" fill="currentColor" />
                </svg>
              </div>
            </div>

            {/* ============================================================= */}
            {/* PANTALLA 1: ONBOARDING CUESTIONARIO (CU-01)                   */}
            {/* ============================================================= */}
            {currentScreen === 'onboarding' && (
              <div className="flex-1 px-6 py-4 flex flex-col justify-between overflow-y-auto">
                {!quizCompleted ? (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium" style={{ color: theme.textSecondary }}>
                        Pregunta {quizStep + 1} de {ONBOARDING_QUESTIONS.length}
                      </span>
                      <span className="text-xs font-semibold" style={{ color: theme.accentSecondary }}>
                        {ONBOARDING_QUESTIONS[quizStep].category}
                      </span>
                    </div>
                    <div
                      className="w-full h-1.5 rounded-full overflow-hidden mb-7"
                      style={{ backgroundColor: theme.bgSurface }}
                    >
                      <div
                        className="h-full transition-all duration-300 rounded-full"
                        style={{
                          width: `${((quizStep + 1) / ONBOARDING_QUESTIONS.length) * 100}%`,
                          backgroundColor: theme.accentSecondary
                        }}
                      />
                    </div>

                    <h2 className="font-serif-editorial font-semibold text-2xl leading-snug mb-6">
                      {ONBOARDING_QUESTIONS[quizStep].question}
                    </h2>

                    <div className="space-y-3">
                      {ONBOARDING_QUESTIONS[quizStep].options.map((option) => {
                        const selected = quizAnswers[quizStep] === option;
                        return (
                          <button
                            key={option}
                            onClick={() =>
                              setQuizAnswers({ ...quizAnswers, [quizStep]: option })
                            }
                            className="w-full min-h-[60px] px-4 py-3 rounded-[12px] flex items-center justify-between text-left transition-all"
                            style={{
                              backgroundColor: selected
                                ? theme.bgPrimary
                                : theme.bgSurface,
                              border: selected
                                ? `2px solid ${theme.accentSecondary}`
                                : '2px solid transparent'
                            }}
                          >
                            <span className="text-base font-medium pr-3">{option}</span>
                            <div
                              className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                              style={{
                                backgroundColor: selected
                                  ? theme.accentSecondary
                                  : 'transparent',
                                border: selected
                                  ? 'none'
                                  : `1.5px solid ${theme.textSecondary}`
                              }}
                            >
                              {selected && (
                                <Check
                                  className="w-3.5 h-3.5 stroke-[2.5]"
                                  style={{ color: theme.bgPrimary }}
                                />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-center items-center text-center">
                    <SunflowerCanvas
                      percentage={15}
                      theme={theme}
                      size={165}
                      hasVitalityAura={true}
                    />
                    <h2 className="font-serif-editorial font-semibold text-2xl mt-4 mb-1">
                      Plan Zen Configurado
                    </h2>
                    <p className="text-xs max-w-[260px] mb-5" style={{ color: theme.textSecondary }}>
                      Perfil local offline-first creado. Puedes plantar libros .epub o
                      físicos cuando quieras.
                    </p>
                    <div
                      className="w-full rounded-[20px] p-4 text-left space-y-2.5 text-xs"
                      style={{ backgroundColor: theme.bgSurface }}
                    >
                      <div className="flex justify-between">
                        <span style={{ color: theme.textSecondary }}>Meta diaria sugerida:</span>
                        <span className="font-bold">{quizAnswers[1]}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: theme.textSecondary }}>Recordatorio Zen:</span>
                        <span className="font-bold">{quizAnswers[2]}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: theme.textSecondary }}>Modo IA Gemini:</span>
                        <span className="font-bold" style={{ color: theme.accentSecondary }}>
                          {quizAnswers[4]}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-4 flex items-center gap-3">
                  {!quizCompleted && quizStep > 0 && (
                    <button
                      onClick={() => setQuizStep(quizStep - 1)}
                      className="h-[52px] px-5 rounded-full border text-xs font-semibold"
                      style={{
                        borderColor: theme.borderSubtle,
                        color: theme.textSecondary
                      }}
                    >
                      Atrás
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!quizCompleted && quizStep < ONBOARDING_QUESTIONS.length - 1) {
                        setQuizStep(quizStep + 1);
                      } else if (!quizCompleted) {
                        setQuizCompleted(true);
                      } else {
                        setQuizCompleted(false);
                        setQuizStep(0);
                        setCurrentScreen('dashboard');
                      }
                    }}
                    className="flex-1 h-[56px] rounded-full font-bold text-sm flex items-center justify-center gap-2"
                    style={{
                      backgroundColor: theme.accentPrimary,
                      color: '#181A18'
                    }}
                  >
                    <span>
                      {!quizCompleted
                        ? quizStep === ONBOARDING_QUESTIONS.length - 1
                          ? 'Generar Plan de Hábito'
                          : 'Continuar'
                        : 'Ir al Dashboard Zen'}
                    </span>
                    <ChevronRight className="w-4 h-4 stroke-[2.2]" />
                  </button>
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* PANTALLA 2: DASHBOARD PRINCIPAL (4 ZONAS LIMPIAS - SECCIÓN 6) */}
            {/* ============================================================= */}
            {currentScreen === 'dashboard' && (
              <>
                <div className="flex-1 px-6 pt-2 pb-4 flex flex-col justify-between">
                  {/* ZONA 1: Header Sutil (Racha + Toggle Tema + Ajustes) */}
                  <div className="flex items-center justify-between">
                    <div
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
                      style={{ backgroundColor: theme.bgSurface }}
                    >
                      <Sun
                        className="w-4 h-4 stroke-[2]"
                        style={{ color: theme.accentPrimary }}
                      />
                      <span className="text-[13px] font-medium">
                        {streakDays} días seguidos
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setThemeMode(themeMode === 'light' ? 'dark' : 'light')
                        }
                        className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                        style={{
                          backgroundColor: theme.bgSurface,
                          color: theme.accentPrimary
                        }}
                        title="Cambiar entre Modo Claro y Oscuro"
                      >
                        {themeMode === 'light' ? (
                          <Moon className="w-4 h-4 stroke-[1.8]" />
                        ) : (
                          <Sun className="w-4 h-4 stroke-[1.8]" />
                        )}
                      </button>
                      <button
                        onClick={() => setCurrentScreen('onboarding')}
                        className="w-9 h-9 rounded-full flex items-center justify-center"
                        style={{
                          backgroundColor: theme.bgSurface,
                          color: theme.textSecondary
                        }}
                        title="Cuestionario / Ajustes"
                      >
                        <Settings className="w-4 h-4 stroke-[1.75]" />
                      </button>
                    </div>
                  </div>

                  {/* ZONA 2: Lienzo Central (Girasol Activo + Badge Híbrido + Progreso) */}
                  <div className="flex flex-col items-center text-center my-auto py-1">
                    <SunflowerCanvas
                      percentage={displayedPct}
                      variation={displayedVariation}
                      hasVitalityAura={vitalityBonusActive}
                      isDormant={inspectDormant}
                      theme={theme}
                      size={220}
                    />

                    {/* Badge de Formato Híbrido (EPUB o FÍSICO) */}
                    <div className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{
                        backgroundColor: theme.bgSurface,
                        color:
                          activeBook.format === 'EPUB'
                            ? theme.accentPrimary
                            : theme.accentSecondary
                      }}
                    >
                      {activeBook.format === 'EPUB' ? (
                        <>
                          <FileText className="w-3 h-3" />
                          <span>MODO DIGITAL .EPUB</span>
                        </>
                      ) : (
                        <>
                          <Book className="w-3 h-3" />
                          <span>LIBRO FÍSICO</span>
                        </>
                      )}
                    </div>

                    {/* Título del Libro Activo */}
                    <h2 className="font-serif-editorial font-medium text-[20px] leading-[28px] mt-1.5">
                      {activeBook.title}
                    </h2>
                    <p
                      className="text-[13px] font-medium"
                      style={{ color: theme.textSecondary }}
                    >
                      {activeBook.author}
                    </p>

                    {/* Barra de progreso del libro (160px x 6px) */}
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <div
                        className="w-[160px] h-[6px] rounded-full overflow-hidden"
                        style={{ backgroundColor: theme.bgSurface }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${displayedPct}%`,
                            backgroundColor: theme.accentSecondary
                          }}
                        />
                      </div>
                      <span
                        className="text-[13px] font-semibold tabular-timer"
                        style={{ color: theme.accentSecondary }}
                      >
                        {displayedPct}%
                      </span>
                    </div>

                    <button
                      onClick={() => setCurrentScreen('garden')}
                      className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full"
                      style={{ color: theme.textSecondary }}
                    >
                      <span>
                        Pág. {activeBook.current} de {activeBook.total}
                      </span>
                      <span>•</span>
                      <span className="underline">Cambiar en Mi Jardín</span>
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* ZONA 3: Selector de Tiempo [-] 15:00 [+] y CTA Principal */}
                  <div className="flex flex-col items-center pb-1">
                    <div className="flex items-center gap-6 mb-4">
                      <button
                        onClick={() => setTimerMinutes(Math.max(5, timerMinutes - 5))}
                        disabled={timerMinutes <= 5}
                        className="w-[44px] h-[44px] rounded-full flex items-center justify-center disabled:opacity-40 transition-transform active:scale-95"
                        style={{ backgroundColor: theme.bgSurface }}
                      >
                        <Minus className="w-5 h-5 stroke-[1.75]" />
                      </button>

                      <div className="text-center min-w-[128px]">
                        <div className="text-[48px] leading-[54px] font-semibold tabular-timer tracking-tight">
                          {timerMinutes}:00
                        </div>
                        <span
                          className="text-xs font-medium"
                          style={{ color: theme.textSecondary }}
                        >
                          minutos de enfoque
                        </span>
                      </div>

                      <button
                        onClick={() => setTimerMinutes(Math.min(120, timerMinutes + 5))}
                        disabled={timerMinutes >= 120}
                        className="w-[44px] h-[44px] rounded-full flex items-center justify-center disabled:opacity-40 transition-transform active:scale-95"
                        style={{ backgroundColor: theme.bgSurface }}
                      >
                        <Plus className="w-5 h-5 stroke-[1.75]" />
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        setFocusSecondsLeft(timerMinutes * 60);
                        setGracePeriodActive(false);
                        setSessionInvalidated(false);
                        setIsTimerPaused(false);
                        setCurrentScreen('focus');
                      }}
                      className="w-full max-w-[270px] h-[56px] font-bold text-base rounded-full flex items-center justify-center gap-2.5 shadow-sm transition-transform active:scale-[0.98]"
                      style={{
                        backgroundColor: theme.accentPrimary,
                        color: '#181A18'
                      }}
                    >
                      {activeBook.format === 'EPUB' ? (
                        <>
                          <BookOpen className="w-5 h-5 stroke-[2]" />
                          <span>Abrir Lector ePub Zen</span>
                        </>
                      ) : (
                        <>
                          <Sprout className="w-5 h-5 stroke-[2]" />
                          <span>Comenzar Lectura Física</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* ZONA 4: Navegación Inferior en Vista Fija (Fondo #F7F5F0 / #181A18) */}
                <nav
                  className="h-[64px] px-6 flex items-center justify-around shrink-0"
                  style={{ backgroundColor: theme.bgPrimary }}
                >
                  <button
                    onClick={() => setCurrentScreen('dashboard')}
                    className="flex flex-col items-center gap-1"
                    style={{ color: theme.textPrimary }}
                  >
                    <BookOpen className="w-5 h-5 stroke-[2.2]" />
                    <span className="text-[11px] font-semibold">Lectura</span>
                  </button>
                  <button
                    onClick={() => setCurrentScreen('garden')}
                    className="flex flex-col items-center gap-1"
                    style={{ color: theme.textSecondary }}
                  >
                    <Sprout className="w-5 h-5 stroke-[1.75]" />
                    <span className="text-[11px] font-medium">Mi Jardín</span>
                  </button>
                  <button
                    onClick={() => setCurrentScreen('stats')}
                    className="flex flex-col items-center gap-1"
                    style={{ color: theme.textSecondary }}
                  >
                    <BarChart2 className="w-5 h-5 stroke-[1.75]" />
                    <span className="text-[11px] font-medium">Estadísticas</span>
                  </button>
                </nav>
              </>
            )}

            {/* ============================================================= */}
            {/* PANTALLA 3: FOCUS MODE HÍBRIDO (.EPUB READER vs FÍSICO)       */}
            {/* ============================================================= */}
            {currentScreen === 'focus' && (
              <div className="flex-1 flex flex-col justify-between overflow-hidden px-5 py-3">
                {/* Header Superior Minimalista con Reloj y Controles */}
                <div
                  className="flex items-center justify-between pb-2.5 border-b"
                  style={{ borderColor: theme.borderSubtle }}
                >
                  <div className="flex items-center gap-2">
                    <Clock
                      className="w-4 h-4"
                      style={{ color: theme.accentPrimary }}
                    />
                    <span className="text-sm font-bold tabular-timer">
                      {formatTime(focusSecondsLeft)}
                    </span>
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: theme.bgSurface,
                        color: theme.accentSecondary
                      }}
                    >
                      {displayedPct}%
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {activeBook.format === 'EPUB' && (
                      <button
                        onClick={() =>
                          setShowEpubTypographySettings(!showEpubTypographySettings)
                        }
                        className="px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1"
                        style={{ backgroundColor: theme.bgSurface }}
                        title="Ajustes tipográficos Lora"
                      >
                        <Type className="w-3.5 h-3.5" />
                        <span>Aa</span>
                      </button>
                    )}
                    <button
                      onClick={() => setIsTimerPaused(!isTimerPaused)}
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: theme.bgSurface }}
                    >
                      {isTimerPaused ? (
                        <Play className="w-3.5 h-3.5" />
                      ) : (
                        <Pause className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Banner de Período de Gracia de 15s (RF-02) */}
                {gracePeriodActive && !sessionInvalidated && (
                  <div
                    className="mt-2.5 rounded-[16px] p-3 border flex items-center justify-between gap-2"
                    style={{
                      backgroundColor: `${theme.stateWarning}20`,
                      borderColor: theme.stateWarning
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <AlertCircle
                        className="w-5 h-5 shrink-0"
                        style={{ color: theme.stateWarning }}
                      />
                      <div className="text-xs">
                        <div
                          className="font-bold"
                          style={{ color: theme.stateWarning }}
                        >
                          App en 2do plano • Gracia: {graceSecondsLeft}s
                        </div>
                        <span style={{ color: theme.textSecondary }}>
                          Regresa antes de 0s para no marchitar la sesión.
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setGracePeriodActive(false);
                        setGraceSecondsLeft(15);
                      }}
                      className="px-3 py-1.5 rounded-full text-xs font-bold shrink-0"
                      style={{
                        backgroundColor: theme.stateWarning,
                        color: '#FDFCFA'
                      }}
                    >
                      Regresar
                    </button>
                  </div>
                )}

                {/* Estado de Sesión Anulada tras expirar los 15s */}
                {sessionInvalidated && (
                  <div
                    className="my-auto rounded-[20px] p-5 border text-center space-y-3"
                    style={{
                      backgroundColor: theme.bgSurface,
                      borderColor: theme.stateWarning
                    }}
                  >
                    <AlertCircle
                      className="w-8 h-8 mx-auto"
                      style={{ color: theme.stateWarning }}
                    />
                    <h3 className="font-serif-editorial font-semibold text-lg">
                      Sesión Interrumpida
                    </h3>
                    <p className="text-xs" style={{ color: theme.textSecondary }}>
                      Superaste los 15 segundos fuera de Komi. El progreso previo de tu
                      girasol está a salvo, pero esta sesión no sumará crecimiento.
                    </p>
                    <button
                      onClick={() => setCurrentScreen('dashboard')}
                      className="w-full h-11 rounded-full font-bold text-xs"
                      style={{
                        backgroundColor: theme.accentPrimary,
                        color: '#181A18'
                      }}
                    >
                      Volver al Jardín
                    </button>
                  </div>
                )}

                {/* CONTENIDO CENTRAL SEGÚN MODALIDAD: LECTOR .EPUB vs TEMPORIZADOR FÍSICO */}
                {!sessionInvalidated && activeBook.format === 'EPUB' && (
                  <div className="flex-1 flex flex-col justify-between py-2 overflow-y-auto">
                    {/* Panel desplegable de tamaño tipográfico (16px - 22px) */}
                    {showEpubTypographySettings && (
                      <div
                        className="mb-2 p-2.5 rounded-[14px] flex items-center justify-between text-xs border"
                        style={{
                          backgroundColor: theme.bgSurface,
                          borderColor: theme.borderSubtle
                        }}
                      >
                        <span className="font-medium">Tamaño fuente Lora:</span>
                        <div className="flex items-center gap-2">
                          {[16, 18, 20, 22].map((sz) => (
                            <button
                              key={sz}
                              onClick={() => setEpubFontSize(sz)}
                              className="px-2.5 py-1 rounded-full font-semibold"
                              style={{
                                backgroundColor:
                                  epubFontSize === sz
                                    ? theme.accentPrimary
                                    : theme.bgPrimary,
                                color:
                                  epubFontSize === sz ? '#181A18' : theme.textPrimary
                              }}
                            >
                              {sz}px
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Lienzo de Lectura ePub (Sección 10.8) */}
                    <div className="my-auto px-1">
                      <div
                        className="text-[11px] font-semibold uppercase tracking-wider mb-1"
                        style={{ color: theme.accentSecondary }}
                      >
                        {(activeBook.epubPages || INITIAL_BOOKS[0].epubPages)[
                          epubPageIndex
                        ]?.chapter}
                      </div>
                      <p
                        className="font-serif-editorial leading-[1.68] transition-all"
                        style={{
                          fontSize: `${epubFontSize}px`,
                          color: theme.textPrimary
                        }}
                      >
                        {(activeBook.epubPages || INITIAL_BOOKS[0].epubPages)[
                          epubPageIndex
                        ]?.content}
                      </p>
                      <div
                        className="mt-3 text-[10px] font-mono truncate"
                        style={{ color: theme.textSecondary }}
                      >
                        CFI:{' '}
                        {(activeBook.epubPages || INITIAL_BOOKS[0].epubPages)[
                          epubPageIndex
                        ]?.cfi}
                      </div>
                    </div>

                    {/* Paginador del ePub */}
                    <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: theme.borderSubtle }}>
                      <button
                        onClick={() => handleFlipEpubPage(-1)}
                        disabled={epubPageIndex === 0}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1 disabled:opacity-40"
                        style={{ backgroundColor: theme.bgSurface }}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Anterior</span>
                      </button>
                      <span className="text-xs font-medium" style={{ color: theme.textSecondary }}>
                        Fragmento {epubPageIndex + 1} de 3
                      </span>
                      <button
                        onClick={() => handleFlipEpubPage(1)}
                        disabled={epubPageIndex >= 2}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1 disabled:opacity-40"
                        style={{
                          backgroundColor: theme.accentSecondary,
                          color: '#FDFCFA'
                        }}
                      >
                        <span>Siguiente pág. (+%)</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {!sessionInvalidated && activeBook.format === 'FISICO' && (
                  <div className="my-auto flex flex-col items-center text-center">
                    <SunflowerCanvas
                      percentage={displayedPct}
                      variation={displayedVariation}
                      isWarning={gracePeriodActive}
                      isFocusActive={true}
                      theme={theme}
                      size={205}
                    />
                    <h3 className="font-serif-editorial font-medium text-lg mt-3">
                      {activeBook.title}
                    </h3>
                    <p className="text-xs" style={{ color: theme.textSecondary }}>
                      Disfruta de tu libro en papel. Komi cuida tu concentración.
                    </p>
                  </div>
                )}

                {/* Controles Inferiores del Focus Mode: Gracia 15s y Terminé Antes de Tiempo */}
                {!sessionInvalidated && (
                  <div className="pt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setGraceSecondsLeft(15);
                          setGracePeriodActive(true);
                        }}
                        className="h-9 rounded-full text-[11px] font-semibold px-2.5 border flex items-center justify-center gap-1"
                        style={{
                          backgroundColor: theme.bgSurface,
                          borderColor: theme.stateWarning,
                          color: theme.stateWarning
                        }}
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Simular 2do Plano (15s)</span>
                      </button>

                      <button
                        onClick={handleCompleteFocusSession}
                        className="h-9 rounded-full text-[11px] font-semibold px-2.5 flex items-center justify-center gap-1"
                        style={{
                          backgroundColor: theme.accentSecondary,
                          color: '#FDFCFA'
                        }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Simular Reloj 00:00</span>
                      </button>
                    </div>

                    {/* Botón "Terminé antes de tiempo" (RF-02: Válido si >=50% o fin del libro) */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (earlyFinishEligible) {
                            handleCompleteFocusSession();
                          } else {
                            setCurrentScreen('dashboard');
                          }
                        }}
                        className="flex-1 h-10 rounded-full border text-xs font-semibold flex items-center justify-center gap-1.5"
                        style={{
                          borderColor: theme.borderSubtle,
                          backgroundColor: theme.bgElevated
                        }}
                      >
                        <span>
                          Terminé antes de tiempo{' '}
                          {earlyFinishEligible
                            ? '(>=50% cumplido: Válido)'
                            : '(<50%: Cancela)'}
                        </span>
                      </button>
                      <button
                        onClick={() => setEarlyFinishEligible(!earlyFinishEligible)}
                        className="px-2.5 h-10 rounded-full text-[10px] font-semibold border"
                        style={{
                          backgroundColor: theme.bgSurface,
                          borderColor: theme.borderSubtle,
                          color: theme.textSecondary
                        }}
                        title="Alternar simulación de umbral del 50%"
                      >
                        Toggle 50%
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ============================================================= */}
            {/* PANTALLA 4: MODAL POST-LECTURA BOTTOM SHEET (CU-04 / CU-05)   */}
            {/* ============================================================= */}
            {currentScreen === 'post-reading' && (
              <div className="flex-1 relative bg-black/40 flex flex-col justify-end">
                <div className="flex-1 flex flex-col items-center justify-center p-4">
                  <SunflowerCanvas
                    percentage={displayedPct}
                    variation={displayedVariation}
                    hasVitalityAura={earnedVitalityInSession}
                    theme={theme}
                    size={165}
                  />
                </div>

                <div
                  className="rounded-t-[28px] px-6 pt-4 pb-7 border-t"
                  style={{
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.borderSubtle
                  }}
                >
                  <div
                    className="w-10 h-1 rounded-full mx-auto mb-4"
                    style={{ backgroundColor: theme.borderSubtle }}
                  />

                  {postReadStep === 1 && activeBook.format === 'FISICO' ? (
                    /* PASO 1 (SOLO LIBRO FÍSICO): INGRESAR PÁGINA ALCANZADA */
                    <div className="text-center">
                      <span
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-2"
                        style={{
                          backgroundColor: theme.bgSurface,
                          color: theme.accentSecondary
                        }}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Sesión física completada
                      </span>
                      <h2 className="font-serif-editorial font-semibold text-xl">
                        ¿En qué página de tu libro quedaste?
                      </h2>
                      <p className="text-xs mt-1" style={{ color: theme.textSecondary }}>
                        Actual: Pág. {activeBook.current} de {activeBook.total}. (Si
                        dejas la misma página verás el Bono de Vitalidad).
                      </p>

                      <div className="my-5 flex items-center justify-center gap-4">
                        <button
                          onClick={() =>
                            setTempPhysicalPage(
                              Math.max(activeBook.current, Number(tempPhysicalPage) - 1)
                            )
                          }
                          className="w-11 h-11 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: theme.bgSurface }}
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          value={tempPhysicalPage}
                          onChange={(e) => setTempPhysicalPage(e.target.value)}
                          className="w-24 text-center text-2xl font-bold rounded-[12px] py-2 border tabular-timer"
                          style={{
                            backgroundColor: theme.bgPrimary,
                            borderColor: theme.borderSubtle
                          }}
                        />
                        <button
                          onClick={() =>
                            setTempPhysicalPage(
                              Math.min(activeBook.total, Number(tempPhysicalPage) + 1)
                            )
                          }
                          className="w-11 h-11 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: theme.bgSurface }}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>

                      <button
                        onClick={handleSavePhysicalProgress}
                        className="w-full h-[54px] font-bold rounded-full flex items-center justify-center gap-2"
                        style={{
                          backgroundColor: theme.accentPrimary,
                          color: '#181A18'
                        }}
                      >
                        <Sprout className="w-5 h-5 stroke-[2]" />
                        <span>Actualizar Girasol</span>
                      </button>
                    </div>
                  ) : (
                    /* PASO 2: TRIGGER CONDICIONAL DE IA GEMINI (CU-05) */
                    <div className="text-center">
                      {activeBook.format === 'EPUB' ? (
                        <span
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-3"
                          style={{
                            backgroundColor: theme.bgSurface,
                            color: theme.accentSecondary
                          }}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Progreso CFI y fragmento XHTML capturados ({displayedPct}%)
                        </span>
                      ) : earnedVitalityInSession ? (
                        <span
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-3"
                          style={{
                            backgroundColor: `${theme.accentPrimary}25`,
                            color: theme.accentPrimary
                          }}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Bono de Vitalidad Solar otorgado por tu constancia
                        </span>
                      ) : null}

                      <h2 className="font-serif-editorial font-semibold text-2xl leading-snug">
                        ¿Quieres charlar un poco sobre lo que acabas de leer?
                      </h2>
                      <p
                        className="text-xs mt-2 mb-5"
                        style={{ color: theme.textSecondary }}
                      >
                        {activeBook.format === 'EPUB'
                          ? 'Komi ya tiene los párrafos exactos que leíste hoy para conversar sin spoilers.'
                          : 'Komi te hará preguntas abiertas sobre tu ejemplar físico sin alucinaciones.'}
                      </p>

                      <div className="space-y-2.5">
                        <button
                          onClick={() => setCurrentScreen('ai-chat')}
                          className="w-full h-[54px] font-bold rounded-full flex items-center justify-center gap-2"
                          style={{
                            backgroundColor: theme.accentPrimary,
                            color: '#181A18'
                          }}
                        >
                          <MessageSquare className="w-5 h-5 stroke-[2]" />
                          <span>Sí, conversar con Komi</span>
                        </button>

                        <button
                          onClick={() => setCurrentScreen('dashboard')}
                          className="w-full h-[46px] rounded-full border text-xs font-semibold"
                          style={{
                            borderColor: theme.borderSubtle,
                            color: theme.textSecondary
                          }}
                        >
                          Por hoy no, volver al jardín
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* PANTALLA 5: COMPAÑERO DE LECTURA IA - MÁX 5 TURNOS (CU-05)    */}
            {/* ============================================================= */}
            {currentScreen === 'ai-chat' && (
              <div className="flex-1 flex flex-col justify-between overflow-hidden">
                {/* Header de Contexto Dual + Contador de 5 Turnos */}
                <div
                  className="px-5 pt-2 pb-3 border-b"
                  style={{ borderColor: theme.borderSubtle }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <button
                      onClick={() => setCurrentScreen('dashboard')}
                      className="inline-flex items-center gap-1 text-xs font-medium"
                      style={{ color: theme.textSecondary }}
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Volver al jardín</span>
                    </button>

                    <span
                      className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: theme.bgSurface,
                        color:
                          chatTurnCount >= 5
                            ? theme.accentPrimary
                            : theme.accentSecondary
                      }}
                    >
                      Ciclo Zen: Turno {chatTurnCount} de 5
                    </span>
                  </div>

                  {/* Píldora de Contexto (Sección 10.6) */}
                  <div
                    className="w-full px-3.5 py-2 rounded-full flex items-center justify-between text-xs"
                    style={{ backgroundColor: theme.bgSurface }}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Flower2
                        className="w-4 h-4 shrink-0"
                        style={{ color: theme.accentPrimary }}
                      />
                      <span className="truncate font-medium">
                        {activeBook.title}
                      </span>
                    </div>
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: theme.bgPrimary,
                        color: theme.textSecondary
                      }}
                    >
                      {activeBook.format === 'EPUB'
                        ? 'XHTML Inyectado'
                        : 'Guía Anti-Alucinación'}
                    </span>
                  </div>
                </div>

                {/* Mensajes del Chat */}
                <div className="flex-1 px-5 py-4 overflow-y-auto space-y-3.5">
                  {chatMessages.map((msg) =>
                    msg.sender === 'ai' ? (
                      <div key={msg.id} className="flex items-start gap-2.5">
                        <div
                          className="w-7 h-7 rounded-full border flex items-center justify-center shrink-0 mt-0.5"
                          style={{
                            backgroundColor: theme.bgSurface,
                            borderColor: theme.borderSubtle
                          }}
                        >
                          <Sparkles
                            className="w-3.5 h-3.5"
                            style={{ color: theme.accentPrimary }}
                          />
                        </div>
                        <div
                          className="p-3.5 rounded-[18px] rounded-tl-[4px] text-sm leading-relaxed max-w-[84%]"
                          style={{
                            backgroundColor: theme.bgSurface,
                            color: theme.textPrimary
                          }}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ) : (
                      <div key={msg.id} className="flex justify-end">
                        <div
                          className="p-3.5 rounded-[18px] rounded-br-[4px] text-sm leading-relaxed max-w-[82%]"
                          style={{
                            backgroundColor: theme.accentSecondary,
                            color: '#FDFCFA'
                          }}
                        >
                          {msg.text}
                        </div>
                      </div>
                    )
                  )}

                  {isAiTyping && (
                    <div
                      className="text-xs pl-9 flex items-center gap-2"
                      style={{ color: theme.textSecondary }}
                    >
                      <span
                        className="w-2 h-2 rounded-full animate-ping"
                        style={{ backgroundColor: theme.accentPrimary }}
                      />
                      <span>Komi está escribiendo (streaming &lt;3s)...</span>
                    </div>
                  )}
                </div>

                {/* Barra Inferior: Si llegó al Turno 5 muestra botón de cierre Zen */}
                <div className="px-4 pb-4 pt-2 space-y-2">
                  {chatTurnCount >= 5 ? (
                    <button
                      onClick={() => setCurrentScreen('dashboard')}
                      className="w-full h-[52px] rounded-full font-bold text-sm flex items-center justify-center gap-2 shadow-sm"
                      style={{
                        backgroundColor: theme.accentPrimary,
                        color: '#181A18'
                      }}
                    >
                      <CheckCircle2 className="w-5 h-5 stroke-[2]" />
                      <span>Guardar reflexión y volver al jardín</span>
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                        {[
                          'Lo aplicaré antes de dormir',
                          'Resumir idea principal',
                          'Hazme una pregunta rápida'
                        ].map((chip) => (
                          <button
                            key={chip}
                            onClick={() => handleSendMessage(chip)}
                            className="px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap border"
                            style={{
                              backgroundColor: theme.bgSurface,
                              borderColor: theme.borderSubtle,
                              color: theme.textSecondary
                            }}
                          >
                            {chip}
                          </button>
                        ))}
                      </div>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSendMessage();
                        }}
                        className="flex items-center gap-2 rounded-full pl-4 pr-1.5 py-1.5"
                        style={{ backgroundColor: theme.bgSurface }}
                      >
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Comparte tu reflexión..."
                          className="flex-1 bg-transparent text-sm focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: theme.accentPrimary,
                            color: '#181A18'
                          }}
                        >
                          <Send className="w-4 h-4 stroke-[2]" />
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ============================================================= */}
            {/* PANTALLA 6: MI JARDÍN HÍBRIDO + EN BARBECHO (CU-02 / RF-01)   */}
            {/* ============================================================= */}
            {currentScreen === 'garden' && (
              <>
                <div className="flex-1 px-6 pt-2 pb-4 overflow-y-auto relative">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="font-serif-editorial font-semibold text-2xl">
                        Mi Jardín
                      </h2>
                      <p className="text-xs" style={{ color: theme.textSecondary }}>
                        Biblioteca híbrida (.epub y físicos)
                      </p>
                    </div>
                    <button
                      onClick={() => setShowNewBookModal(true)}
                      className="h-9 px-3.5 rounded-full text-xs font-bold flex items-center gap-1.5"
                      style={{
                        backgroundColor: theme.accentPrimary,
                        color: '#181A18'
                      }}
                    >
                      <Plus className="w-4 h-4 stroke-[2.2]" />
                      <span>Plantar Libro</span>
                    </button>
                  </div>

                  {/* 3 Filtros: En Crecimiento | Florecidos | En Barbecho */}
                  <div
                    className="grid grid-cols-3 p-1 rounded-full mb-4 text-[11px] font-semibold"
                    style={{ backgroundColor: theme.bgSurface }}
                  >
                    {[
                      {
                        id: 'growing',
                        label: `Activos (${
                          books.filter((b) => !b.archived && b.current < b.total).length
                        })`
                      },
                      {
                        id: 'bloomed',
                        label: `100% (${
                          books.filter((b) => !b.archived && b.current >= b.total).length
                        })`
                      },
                      {
                        id: 'dormant',
                        label: `Barbecho (${books.filter((b) => b.archived).length})`
                      }
                    ].map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setGardenTab(t.id)}
                        className="py-1.5 rounded-full transition-all"
                        style={{
                          backgroundColor:
                            gardenTab === t.id ? theme.bgPrimary : 'transparent',
                          color:
                            gardenTab === t.id
                              ? theme.textPrimary
                              : theme.textSecondary
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* Tarjetas de Libros (Sección 10.3: con Badge EPUB/FÍSICO y Archivar) */}
                  <div className="space-y-3">
                    {books
                      .filter((b) => {
                        if (gardenTab === 'dormant') return b.archived;
                        if (gardenTab === 'bloomed')
                          return !b.archived && b.current >= b.total;
                        return !b.archived && b.current < b.total;
                      })
                      .map((book) => {
                        const pct = Math.min(
                          100,
                          Math.round((book.current / book.total) * 100)
                        );
                        return (
                          <div
                            key={book.id}
                            onClick={() => {
                              if (book.archived) return;
                              setBooks(
                                books.map((item) => ({
                                  ...item,
                                  active: item.id === book.id
                                }))
                              );
                            }}
                            className="p-3.5 rounded-[20px] flex items-center justify-between cursor-pointer transition-all"
                            style={{
                              backgroundColor: theme.bgSurface,
                              border: book.active
                                ? `1.5px solid ${theme.accentPrimary}`
                                : '1.5px solid transparent'
                            }}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className="w-[50px] h-[50px] rounded-2xl flex items-center justify-center shrink-0"
                                style={{ backgroundColor: theme.bgPrimary }}
                              >
                                <SunflowerCanvas
                                  percentage={pct}
                                  variation={book.variation}
                                  isDormant={book.archived}
                                  theme={theme}
                                  size={46}
                                  mini={true}
                                />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                    style={{
                                      backgroundColor: theme.bgPrimary,
                                      color:
                                        book.format === 'EPUB'
                                          ? theme.accentPrimary
                                          : theme.accentSecondary
                                    }}
                                  >
                                    {book.format}
                                  </span>
                                  <h3 className="font-serif-editorial font-medium text-[15px] truncate">
                                    {book.title}
                                  </h3>
                                </div>
                                <p
                                  className="text-xs truncate"
                                  style={{ color: theme.textSecondary }}
                                >
                                  {book.author} • {book.current}/{book.total} págs.
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className="px-2 py-0.5 rounded-full text-xs font-semibold tabular-timer"
                                style={{
                                  backgroundColor: `${theme.accentSecondary}25`,
                                  color: theme.accentSecondary
                                }}
                              >
                                {pct}%
                              </span>
                              <button
                                onClick={(e) => toggleArchiveBook(book.id, e)}
                                className="p-1.5 rounded-full"
                                style={{
                                  backgroundColor: theme.bgPrimary,
                                  color: theme.textSecondary
                                }}
                                title={
                                  book.archived
                                    ? 'Reactivar del barbecho'
                                    : 'Poner en barbecho (Archivar)'
                                }
                              >
                                {book.archived ? (
                                  <RefreshCw className="w-3.5 h-3.5" />
                                ) : (
                                  <Archive className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Modal Híbrido para Plantar Libro (.epub o Físico - CU-02) */}
                  {showNewBookModal && (
                    <div className="absolute inset-0 bg-black/50 flex items-end z-30">
                      <form
                        onSubmit={handlePlantNewBook}
                        className="w-full rounded-t-[28px] p-5 space-y-3 border-t"
                        style={{
                          backgroundColor: theme.bgElevated,
                          borderColor: theme.borderSubtle
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="font-serif-editorial font-semibold text-base">
                            Plantar Nuevo Girasol (Híbrido)
                          </h3>
                          <button
                            type="button"
                            onClick={() => setShowNewBookModal(false)}
                            style={{ color: theme.textSecondary }}
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>

                        {/* Selector de Formato: Importar .epub vs Libro Físico */}
                        <div
                          className="grid grid-cols-2 p-1 rounded-full text-xs font-semibold"
                          style={{ backgroundColor: theme.bgSurface }}
                        >
                          <button
                            type="button"
                            onClick={() => setNewBookFormat('EPUB')}
                            className="py-1.5 rounded-full flex items-center justify-center gap-1.5"
                            style={{
                              backgroundColor:
                                newBookFormat === 'EPUB'
                                  ? theme.bgPrimary
                                  : 'transparent'
                            }}
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Importar .epub</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewBookFormat('FISICO')}
                            className="py-1.5 rounded-full flex items-center justify-center gap-1.5"
                            style={{
                              backgroundColor:
                                newBookFormat === 'FISICO'
                                  ? theme.bgPrimary
                                  : 'transparent'
                            }}
                          >
                            <Book className="w-3.5 h-3.5" />
                            <span>Libro Físico</span>
                          </button>
                        </div>

                        {newBookFormat === 'EPUB' && (
                          <button
                            type="button"
                            onClick={() => {
                              setSimulatedEpubLoaded(true);
                              setNewBookTitle('Meditaciones');
                              setNewBookAuthor('Marco Aurelio');
                            }}
                            className="w-full py-2.5 px-3 rounded-[12px] border border-dashed text-xs flex items-center justify-center gap-2"
                            style={{
                              borderColor: theme.accentPrimary,
                              backgroundColor: theme.bgPrimary
                            }}
                          >
                            <Upload className="w-4 h-4" style={{ color: theme.accentPrimary }} />
                            <span>
                              {simulatedEpubLoaded
                                ? 'meditaciones_marco_aurelio.epub extraído'
                                : 'Simular selección de archivo .epub (Auto-extrae metadatos)'}
                            </span>
                          </button>
                        )}

                        <input
                          type="text"
                          required
                          value={newBookTitle}
                          onChange={(e) => setNewBookTitle(e.target.value)}
                          placeholder="Título del libro"
                          className="w-full h-10 px-3 rounded-[12px] border text-xs"
                          style={{
                            backgroundColor: theme.bgPrimary,
                            borderColor: theme.borderSubtle
                          }}
                        />

                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={newBookAuthor}
                            onChange={(e) => setNewBookAuthor(e.target.value)}
                            placeholder="Autor"
                            className="w-full h-10 px-3 rounded-[12px] border text-xs"
                            style={{
                              backgroundColor: theme.bgPrimary,
                              borderColor: theme.borderSubtle
                            }}
                          />
                          {newBookFormat === 'FISICO' ? (
                            <input
                              type="number"
                              min="1"
                              value={newBookTotalPages}
                              onChange={(e) => setNewBookTotalPages(e.target.value)}
                              placeholder="Total páginas"
                              className="w-full h-10 px-3 rounded-[12px] border text-xs tabular-timer"
                              style={{
                                backgroundColor: theme.bgPrimary,
                                borderColor: theme.borderSubtle
                              }}
                            />
                          ) : (
                            <div
                              className="h-10 px-3 rounded-[12px] flex items-center text-[11px]"
                              style={{
                                backgroundColor: theme.bgSurface,
                                color: theme.textSecondary
                              }}
                            >
                              Longitud XHTML Auto
                            </div>
                          )}
                        </div>

                        <button
                          type="submit"
                          className="w-full h-[48px] font-bold rounded-full text-xs"
                          style={{
                            backgroundColor: theme.accentPrimary,
                            color: '#181A18'
                          }}
                        >
                          Plantar Semilla en Mi Jardín
                        </button>
                      </form>
                    </div>
                  )}
                </div>

                {/* Navegación Inferior en Lista con Scroll (Sección 10.7: usa bg-elevated) */}
                <nav
                  className="h-[64px] px-6 flex items-center justify-around shrink-0 border-t"
                  style={{
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.borderSubtle
                  }}
                >
                  <button
                    onClick={() => setCurrentScreen('dashboard')}
                    className="flex flex-col items-center gap-1"
                    style={{ color: theme.textSecondary }}
                  >
                    <BookOpen className="w-5 h-5 stroke-[1.75]" />
                    <span className="text-[11px] font-medium">Lectura</span>
                  </button>
                  <button
                    onClick={() => setCurrentScreen('garden')}
                    className="flex flex-col items-center gap-1"
                    style={{ color: theme.textPrimary }}
                  >
                    <Sprout className="w-5 h-5 stroke-[2.2]" />
                    <span className="text-[11px] font-semibold">Mi Jardín</span>
                  </button>
                  <button
                    onClick={() => setCurrentScreen('stats')}
                    className="flex flex-col items-center gap-1"
                    style={{ color: theme.textSecondary }}
                  >
                    <BarChart2 className="w-5 h-5 stroke-[1.75]" />
                    <span className="text-[11px] font-medium">Estadísticas</span>
                  </button>
                </nav>
              </>
            )}

            {/* ============================================================= */}
            {/* PANTALLA 7: ESTADÍSTICAS Y PERFIL OFFLINE-FIRST (CU-06/RF-07) */}
            {/* ============================================================= */}
            {currentScreen === 'stats' && (
              <>
                <div className="flex-1 px-6 pt-2 pb-4 overflow-y-auto space-y-4">
                  <div>
                    <h2 className="font-serif-editorial font-semibold text-2xl">
                      Hábito y Calma
                    </h2>
                    <p className="text-xs" style={{ color: theme.textSecondary }}>
                      Racha validada por hora local de inicio (RF-06)
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div
                      className="p-3.5 rounded-[20px]"
                      style={{ backgroundColor: theme.bgSurface }}
                    >
                      <div
                        className="flex items-center gap-1.5 text-xs mb-1"
                        style={{ color: theme.textSecondary }}
                      >
                        <Sun
                          className="w-4 h-4"
                          style={{ color: theme.accentPrimary }}
                        />
                        <span>Racha Actual</span>
                      </div>
                      <div className="text-2xl font-bold tabular-timer">
                        {streakDays} días
                      </div>
                      <span
                        className="text-[11px]"
                        style={{ color: theme.accentSecondary }}
                      >
                        Protege lecturas nocturnas
                      </span>
                    </div>

                    <div
                      className="p-3.5 rounded-[20px]"
                      style={{ backgroundColor: theme.bgSurface }}
                    >
                      <div
                        className="flex items-center gap-1.5 text-xs mb-1"
                        style={{ color: theme.textSecondary }}
                      >
                        <Flower2
                          className="w-4 h-4"
                          style={{ color: theme.accentSecondary }}
                        />
                        <span>Jardín Total</span>
                      </div>
                      <div className="text-2xl font-bold tabular-timer">
                        {books.filter((b) => !b.archived).length} activos
                      </div>
                      <span
                        className="text-[11px]"
                        style={{ color: theme.textSecondary }}
                      >
                        {books.filter((b) => b.archived).length} en barbecho
                      </span>
                    </div>
                  </div>

                  {/* Gráfica Semanal */}
                  <div
                    className="p-4 rounded-[20px]"
                    style={{ backgroundColor: theme.bgSurface }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-serif-editorial font-medium text-sm">
                        Minutos de Lectura Semanal
                      </span>
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: theme.bgPrimary,
                          color: theme.accentSecondary
                        }}
                      >
                        2h 15m
                      </span>
                    </div>
                    <div className="h-28 flex items-end justify-between gap-2 pt-2 px-1">
                      {[
                        { day: 'L', mins: 15 },
                        { day: 'M', mins: 25 },
                        { day: 'X', mins: 10 },
                        { day: 'J', mins: 20 },
                        { day: 'V', mins: 30 },
                        { day: 'S', mins: 20 },
                        { day: 'D', mins: 15, today: true }
                      ].map((d) => (
                        <div
                          key={d.day}
                          className="flex-1 flex flex-col items-center gap-1"
                        >
                          <span
                            className="text-[10px] tabular-timer"
                            style={{ color: theme.textSecondary }}
                          >
                            {d.mins}m
                          </span>
                          <div
                            className="w-full h-16 rounded-full flex items-end p-1"
                            style={{ backgroundColor: theme.bgPrimary }}
                          >
                            <div
                              className="w-full rounded-full"
                              style={{
                                height: `${Math.min(100, (d.mins / 30) * 100)}%`,
                                backgroundColor: d.today
                                  ? theme.accentPrimary
                                  : theme.accentSecondary
                              }}
                            />
                          </div>
                          <span className="text-[11px] font-semibold">{d.day}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tarjeta de Perfil Local Offline-First y Respaldo PostgreSQL (RF-07) */}
                  <div
                    className="p-4 rounded-[20px] space-y-2.5"
                    style={{ backgroundColor: theme.bgSurface }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Cloud
                          className="w-4 h-4"
                          style={{ color: theme.accentPrimary }}
                        />
                        <span className="text-xs font-bold">
                          Sincronización PostgreSQL (RF-07)
                        </span>
                      </div>
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: theme.bgPrimary,
                          color: cloudSyncLinked
                            ? theme.accentSecondary
                            : theme.textSecondary
                        }}
                      >
                        {cloudSyncLinked ? 'Cuenta Vinculada' : 'Perfil Local Offline'}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: theme.textSecondary }}>
                      Tus sesiones y girasoles se guardan localmente sin necesidad de
                      internet y se respaldan en la nube cuando vinculas tu cuenta.
                    </p>
                    <button
                      onClick={() => setCloudSyncLinked(!cloudSyncLinked)}
                      className="w-full h-9 rounded-full text-xs font-semibold border"
                      style={{
                        backgroundColor: theme.bgPrimary,
                        borderColor: theme.borderSubtle
                      }}
                    >
                      {cloudSyncLinked
                        ? 'Sincronizado con Google Sign-In (Desvincular)'
                        : 'Vincular Google Sign-In para Respaldo Remoto'}
                    </button>
                  </div>
                </div>

                <nav
                  className="h-[64px] px-6 flex items-center justify-around shrink-0 border-t"
                  style={{
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.borderSubtle
                  }}
                >
                  <button
                    onClick={() => setCurrentScreen('dashboard')}
                    className="flex flex-col items-center gap-1"
                    style={{ color: theme.textSecondary }}
                  >
                    <BookOpen className="w-5 h-5 stroke-[1.75]" />
                    <span className="text-[11px] font-medium">Lectura</span>
                  </button>
                  <button
                    onClick={() => setCurrentScreen('garden')}
                    className="flex flex-col items-center gap-1"
                    style={{ color: theme.textSecondary }}
                  >
                    <Sprout className="w-5 h-5 stroke-[1.75]" />
                    <span className="text-[11px] font-medium">Mi Jardín</span>
                  </button>
                  <button
                    onClick={() => setCurrentScreen('stats')}
                    className="flex flex-col items-center gap-1"
                    style={{ color: theme.textPrimary }}
                  >
                    <BarChart2 className="w-5 h-5 stroke-[2.2]" />
                    <span className="text-[11px] font-semibold">Estadísticas</span>
                  </button>
                </nav>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}