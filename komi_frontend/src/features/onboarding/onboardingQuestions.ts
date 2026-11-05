// Cuestionario inicial (SRS 5). Los textos son los del SRS, no los del prototipo (que los resume
// y cambia algunas opciones). Del tema Tsukimi no se dice nada en las opciones: lo decide la regla
// de fatiga nocturna de 5.1 (SRS 18, punto 24).

import type { AiReflectionStyle, PreferredMoment } from "../../data/local_db/types";
import type { OnboardingAnswers } from "../../services/habitPlan";

export type QuestionId = keyof OnboardingAnswers;

export interface QuizOption {
  value: string;
  label: string;
}

export interface QuizQuestion {
  id: QuestionId;
  category: string;
  question: string;
  options: readonly QuizOption[];
}

export const QUESTIONS: readonly QuizQuestion[] = [
  {
    id: "q1",
    category: "Hábito actual",
    question: "¿Cómo describirías tu ritmo de lectura actual?",
    options: [
      { value: "A", label: "Estoy empezando desde cero" },
      { value: "B", label: "Leo de vez en cuando (1 a 3 libros al año)" },
      { value: "C", label: "Tengo el hábito (4 a 8 libros al año)" },
      { value: "D", label: "Soy lector frecuente (+8 libros al año)" },
    ],
  },
  {
    id: "q2",
    category: "Disponibilidad diaria",
    question: "¿Cuánto tiempo de calma puedes regalarle hoy a tu lectura diaria?",
    options: [
      { value: "A", label: "10 minutos (Semilla ligera)" },
      { value: "B", label: "15 minutos (Equilibrio Zen)" },
      { value: "C", label: "30 minutos (Inmersión media)" },
      { value: "D", label: "45 minutos o más (Lectura profunda)" },
    ],
  },
  {
    id: "q3",
    category: "Momento ideal",
    question: "¿En qué momento del día tu mente se siente más despejada para leer?",
    options: [
      { value: "A", label: "Al despertar (07:30 AM)" },
      { value: "B", label: "En la pausa de la tarde (03:00 PM)" },
      { value: "C", label: "Antes de dormir (09:30 PM)" },
      { value: "D", label: "En trayectos o tiempos libres (12:30 PM)" },
    ],
  },
  {
    id: "q4",
    category: "Principal obstáculo",
    question: "¿Qué suele apagar tu concentración cuando intentas mantener el hábito?",
    options: [
      { value: "A", label: "Las notificaciones y distracciones del celular" },
      { value: "B", label: "El cansancio o sueño al leer" },
      { value: "C", label: "Olvidar lo que leí en capítulos anteriores" },
      { value: "D", label: "Empezar con metas muy altas y abandonar rápido" },
    ],
  },
  {
    id: "q5",
    category: "Preferencia de reflexión",
    question: "Al terminar tu sesión, ¿cómo te gustaría reflexionar con Komi?",
    options: [
      { value: "A", label: "Retos suaves de memoria para no perder el hilo" },
      { value: "B", label: "Analizar el trasfondo, psicología e ideas del autor" },
      { value: "C", label: "Destilar un resumen práctico con las ideas clave" },
    ],
  },
];

export const QUESTION_COUNT = QUESTIONS.length;

/** Nombre corto del estilo de reflexión para el resumen del plan. */
export const REFLECTION_STYLE_LABELS: Record<AiReflectionStyle, string> = {
  MEMORY_QUIZ: "Retos suaves de memoria",
  DEEP_ANALYSIS: "Análisis de trasfondo e ideas",
  KEY_SUMMARY: "Resumen con ideas clave",
};

export const MOMENT_LABELS: Record<PreferredMoment, string> = {
  MORNING: "Al despertar",
  AFTERNOON: "En la pausa de la tarde",
  NIGHT: "Antes de dormir",
  COMMUTE: "En trayectos o tiempos libres",
};
