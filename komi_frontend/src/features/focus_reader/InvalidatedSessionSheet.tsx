// Aviso al volver cuando la sesion se invalido por salir mas de 15 s (FA-3.2). Es una hoja modal: no
// ocupa sitio en el flujo, asi que la pantalla de detras no se comprime ni se solapa (A4). El titulo
// vale para los dos casos: con 5 min o mas la sesion invalida si se registra; con menos, no.

import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ZenSheet } from "../../core/components/ZenSheet";

export function InvalidatedSessionSheet({ onClose }: { onClose: () => void }) {
  return (
    <ZenSheet title="Sesión no válida" onClose={onClose}>
      <div className="session-notice" data-testid="session-invalidated">
        <p className="session-notice__text">
          Saliste de la lectura más de 15 segundos y la sesión no se guardó como válida. Tu avance
          anterior sigue a salvo.
        </p>
        <ZenPrimaryButton variant="secondary" onClick={onClose}>
          Entendido
        </ZenPrimaryButton>
      </div>
    </ZenSheet>
  );
}
