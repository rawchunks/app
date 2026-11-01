import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Task } from '../lib/schema';

export interface Choice { id: string; label: string }
export interface TagItem {
  id: string;
  label: string;
  desc: string;
}
export interface TagCategory {
  id: string;
  label: string;
  desc: string;
  max?: number;
  tags: TagItem[];
}
export interface ScaleOption {
  id: string;
  label: string;
  desc: string;
}
export interface TimeSignatureOption {
  id: '2' | '3' | '4' | '6';
  label: string;
  desc: string;
}
export interface TempoPresetOption {
  val: number;
  label: string;
  desc: string;
}
export interface DurationPresetOption {
  val: number;
  label: string;
  desc: string;
}
export interface ReworkPreset {
  id: string;
  mode: 'conservative' | 'balanced' | 'aggressive';
  strength: number;
  label: string;
  shortLabel: string;
  desc: string;
}
export interface CoverPreset {
  id: string;
  value: number;
  strength?: number;
  noise?: number;
  label: string;
  shortLabel: string;
  desc: string;
}
export interface CompletePreset {
  id: string;
  label: string;
  classes: string;
  trackClasses?: string[];
  desc: string;
}
export interface SculptModeOption {
  id: string;
  label: string;
  axis: string;
  description: string;
}
export interface Parameter {
  label: string;
  type: 'number' | 'select' | 'text' | 'multiselect';
  min?: number;
  max?: number;
  step?: number;
  options?: Choice[];
  tasks?: Task[];
}
export interface Options {
  generation: {
    modes: Choice[];
    languages: Choice[];
    genres?: TagCategory[];
    production?: TagCategory[];
    styles?: TagCategory[];
    moods?: TagCategory[];
    vocals?: TagCategory[];
    tags?: string[];
    moodTags?: string[];
    vocalTags?: string[];
    roots?: string[];
    scales?: ScaleOption[];
    timeSignatures?: TimeSignatureOption[];
    tempoPresets?: TempoPresetOption[];
    durationPresets?: DurationPresetOption[];
    duration: { min: number; max: number };
    parameters: Record<string, Parameter>;
  };
  editing: {
    modes: Choice[];
    tasks: (Choice & { modes: string[]; description: string })[];
    repaintModes: Choice[];
    stems: Choice[];
    tracks?: Choice[];
    qualities?: Choice[];
    reworkPresets?: ReworkPreset[];
    coverPresets?: CoverPreset[];
    completePresets?: CompletePreset[];
    promptTags?: string[];
    sculptModes?: SculptModeOption[];
    duration: { min: number; max: number };
    parameters: Record<string, Parameter>;
  };
}

export function useOptions() {
  return useQuery({
    queryKey: ['music-options'],
    queryFn: async (): Promise<Options> => {
      const response = await api.fetch('/api/options');
      if (!response.ok) throw new Error('AI options are unavailable, try again in a minute.');
      return response.json();
    },
    staleTime: 60_000,
  });
}
