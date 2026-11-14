import { useCallback, useRef } from "react";

// react-force-graph-2d never exposes its d3 simulation (only d3Force / d3ReheatSimulation,
// which pins alpha to 1), so the spec's alpha curve is run here instead: d3's alpha stays at
// 1 (d3AlphaDecay 0) and every force is wrapped to receive heat * alpha, where heat follows
// d3's own update rule, heat += (target - heat) * decay, once per engine tick.
// 0.3 -> ~0.02 in 36 ticks (600 ms at 60 fps) -> ~0.006 in 54 ticks (900 ms).
export const HEAT_REHEAT = 0.3;
export const HEAT_DECAY = 0.07;
export const HEAT_IDLE = 0.005;

type AnyForce = ((alpha: number) => void) & { initialize?: (...args: never[]) => void };

export function useSimHeat(reducedMotion: boolean) {
  const heat = useRef(reducedMotion ? 0 : HEAT_REHEAT);

  const reheat = useCallback(() => {
    heat.current = reducedMotion ? 0 : HEAT_REHEAT;
  }, [reducedMotion]);

  const tick = useCallback(() => {
    const target = reducedMotion ? 0 : HEAT_IDLE;
    heat.current += (target - heat.current) * HEAT_DECAY;
  }, [reducedMotion]);

  const scaled = useCallback(<F extends AnyForce>(force: F): F => {
    const wrapped = ((alpha: number) => force(alpha * heat.current)) as F;
    if (force.initialize) wrapped.initialize = (...args: never[]) => force.initialize!(...args);
    return wrapped;
  }, []);

  return { heat, reheat, tick, scaled };
}
