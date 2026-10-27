import { createContext, useContext } from "react";
import type { SessionModalOption } from "@/hooks/use-session";

export type GateStep = 'login' | 'terms' | 'funding';

export const GATE_STEPS: readonly GateStep[] = ['login', 'terms', 'funding'];

export const GATE_EVENT = 'rawchunks:open-gate';

export interface GateRequest {
  steps: GateStep[];
  funding?: SessionModalOption;
  action?: 'studio' | 'stream';
  reason?: string;
  force?: boolean;
}

export interface GateStatus {
  loggedIn: boolean;
  consented: boolean;
  funded: boolean;
}

export function unsatisfiedStep(request: GateRequest, status: GateStatus): GateStep | null {
  return request.steps.find(step =>
    step === 'login' ? !status.loggedIn : step === 'terms' ? !status.consented : !status.funded
  ) ?? null;
}

export interface GateOptions {
  steps?: GateStep[];
  funding?: SessionModalOption;
  action?: 'studio' | 'stream';
  reason?: string;
  force?: boolean;
}

export interface ActiveGate {
  request: GateRequest;
  promise: Promise<boolean>;
  settle: (ready: boolean) => void;
}

let active: ActiveGate | null = null;

function mergeSteps(current: GateStep[], incoming?: GateStep[]): GateStep[] {
  if (!incoming) return current;
  const union = new Set([...current, ...incoming]);
  return GATE_STEPS.filter(step => union.has(step));
}

export function openGate(options: GateOptions = {}): Promise<boolean> {
  if (active) {
    if (options.reason || options.funding || options.action || options.force || options.steps) {
      active.request = {
        ...active.request,
        steps: mergeSteps(active.request.steps, options.steps),
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.funding ? { funding: options.funding } : {}),
        ...(options.action ? { action: options.action } : {}),
        ...(active.request.force || options.force ? { force: true } : {}),
      };
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GATE_EVENT, { detail: active }));
    }
    return active.promise;
  }
  let settle!: (ready: boolean) => void;
  const promise = new Promise<boolean>(resolve => { settle = resolve; });
  active = {
    request: {
      steps: options.steps ?? [...GATE_STEPS],
      ...(options.funding ? { funding: options.funding } : {}),
      ...(options.action ? { action: options.action } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
      ...(options.force ? { force: true } : {}),
    },
    promise,
    settle,
  };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GATE_EVENT, { detail: active }));
  return promise;
}

export function activeGate(): ActiveGate | null {
  return active;
}

export function closeGate(ready: boolean): void {
  if (!active) return;
  const closing = active;
  active = null;
  closing.settle(ready);
}

export interface GateContextValue {
  request: GateRequest | null;
  cancel: () => void;
}

export const GateContext = createContext<GateContextValue | null>(null);

export function useGate(): GateContextValue {
  const value = useContext(GateContext);
  if (!value) throw new Error('useGate must be used within a GateProvider');
  return value;
}
