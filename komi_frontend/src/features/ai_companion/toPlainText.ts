// La app muestra texto plano. Gemini a veces responde con Markdown (negrita, cursiva, titulos,
// viñetas); aqui se quitan las marcas sin tocar las palabras. Funcion pura, segura para texto
// parcial: durante el streaming un asterisco puede llegar antes que su pareja.

export function toPlainText(text: string): string {
  return (
    text
      // Viñetas con asterisco al inicio de linea: se conservan como guion.
      .replace(/^([ \t]*)\*[ \t]+/gm, "$1- ")
      // Titulos "# Titulo".
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      // Negrita y cursiva con asteriscos, y cualquier asterisco suelto (incluso a medio streaming).
      .replace(/\*+/g, "")
      // Negrita con guiones bajos y cursiva _palabra_ (sin tocar snake_case).
      .replace(/__+/g, "")
      .replace(/(^|[^\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, "$1$2")
      // Codigo en linea y bloques.
      .replace(/`+/g, "")
  );
}
