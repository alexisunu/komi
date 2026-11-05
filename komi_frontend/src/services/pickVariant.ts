// Variante del girasol al plantar un libro (CU-02). Hoy SIEMPRE devuelve CLASSIC: solo esa variante
// esta dibujada (SRS 18, punto 4). La funcion es inyectable para cambiar la regla sin tocar el
// modal. Intencion del producto (ver SRS 19): elegirla al azar al plantar, guardarla y
// sincronizarla; falta dibujar SOLAR y AUTUMN, aprobar sus tokens derivados y resolver el nombre
// "Solar" frente al Bono de Vitalidad Solar.

import type { SunflowerVariant } from "../data/local_db/types";

export type VariantPicker = () => SunflowerVariant;

export const pickVariant: VariantPicker = () => "CLASSIC";
