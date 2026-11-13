import { describe, expect, it } from "vitest";
import { toPlainText } from "./toPlainText";

describe("toPlainText", () => {
  it("quita la negrita y la cursiva con asteriscos y deja las palabras", () => {
    expect(toPlainText("Una **palabra** y *otra* idea")).toBe("Una palabra y otra idea");
  });

  it("quita un asterisco suelto, como en un texto a medio streaming", () => {
    expect(toPlainText("Una **pala")).toBe("Una pala");
    expect(toPlainText("Termina con *")).toBe("Termina con ");
  });

  it("quita las marcas de titulo y convierte las viñetas con asterisco en guiones", () => {
    expect(toPlainText("## Titulo\n* uno\n* dos")).toBe("Titulo\n- uno\n- dos");
  });

  it("quita guiones bajos de enfasis y acentos graves, sin romper snake_case", () => {
    expect(toPlainText("__fuerte__ y _suave_ con `codigo` y un_nombre_largo")).toBe(
      "fuerte y suave con codigo y un_nombre_largo",
    );
  });

  it("deja intacto el texto plano, con acentos y signos", () => {
    const plain = "¿Qué sentiste al leer eso? Respira: es solo un momento.";
    expect(toPlainText(plain)).toBe(plain);
    expect(toPlainText("")).toBe("");
  });

  it("respeta el marcador de la semilla", () => {
    expect(toPlainText("Gracias. [SEMILLA_DEL_DIA]: Leer es **cuidar**.")).toBe(
      "Gracias. [SEMILLA_DEL_DIA]: Leer es cuidar.",
    );
  });
});
