// Semillas del Dia por libro, leidas de Dexie al abrir Mi Jardin. Sin servicio no hay semillas.

import { useEffect, useState } from "react";
import type { Seed, SeedService } from "../../services/seedService";

const NONE: ReadonlyMap<string, readonly Seed[]> = new Map();

export function useSeeds(source: Pick<SeedService, "loadByBook"> | undefined): ReadonlyMap<string, readonly Seed[]> {
  const [seeds, setSeeds] = useState<ReadonlyMap<string, readonly Seed[]>>(NONE);

  useEffect(() => {
    if (!source) return undefined;
    let alive = true;
    source
      .loadByBook()
      .then((loaded) => {
        if (alive) setSeeds(loaded);
      })
      .catch(() => {
        // Sin lectura no hay semillas que mostrar; Dexie sigue siendo la fuente.
      });
    return () => {
      alive = false;
    };
  }, [source]);

  return seeds;
}
