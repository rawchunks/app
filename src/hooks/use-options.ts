import { useQuery } from '@tanstack/react-query';
import { sdk } from '@/lib/sdk';
import type { Task } from '@/lib/schema';

export interface Choice { id: string; label: string }
export interface Parameter {
  label: string;
  type: 'number' | 'select' | 'text';
  min?: number;
  max?: number;
  step?: number;
  options?: Choice[];
  tasks?: Task[];
}
export interface Options {
  generation: { modes: Choice[]; languages: Choice[]; duration: { min: number; max: number }; parameters: Record<string, Parameter> };
  editing: { modes: Choice[]; tasks: (Choice & { modes: string[]; description: string })[]; repaintModes: Choice[]; stems: Choice[]; duration: { min: number; max: number }; parameters: Record<string, Parameter> };
}

export function useOptions() {
  return useQuery({
    queryKey: ['music-options'],
    queryFn: async (): Promise<Options> => {
      const response = await sdk.fetch('/api/options');
      if (!response.ok) throw new Error('Music options are unavailable');
      return response.json();
    },
    staleTime: 60_000,
  });
}
