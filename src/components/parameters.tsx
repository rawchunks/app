import type { Parameter } from '@/hooks/use-options';
import { useState } from 'react';
import { Selector } from './selector';

interface Props {
  parameters: Record<string, Parameter>;
  values: Record<string, string | number>;
  onChange: (values: Record<string, string | number>) => void;
  optional?: boolean;
}

export function parameterValues(values: Record<string, string | number>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
}

export function Parameters({ parameters, values, onChange, optional = false }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const change = (key: string, value: string | number) => {
    const next = { ...values };
    if (value === '' && !optional) delete next[key]; else next[key] = value;
    onChange(next);
  };
  return <div className={optional ? 'studio-optional-fields' : 'studio-field-group'}>
    {Object.entries(parameters).map(([key, parameter]) => <div key={key} className={optional ? 'studio-option-row' : 'studio-field-label'}>
      {optional ? <label className="studio-checkbox-label">
        <input type="checkbox" aria-label={parameter.label} className="cyber-checkbox" checked={key in values} onChange={event => {
          const next = { ...values };
          if (event.target.checked) { next[key] = ''; setOpen(key); } else { delete next[key]; setOpen(null); }
          onChange(next);
        }} />
        {parameter.label}
      </label> : parameter.label}
      {optional && key in values ? <Selector label={`Select ${parameter.label.toLowerCase()}`} value={values[key] === '' ? 'Auto' : String(values[key])} open={open === key} onOpenChange={expanded => setOpen(expanded ? key : null)}>
        <button type="button" className={`studio-dropdown-item ${values[key] === '' ? 'active' : ''}`} onClick={() => { change(key, ''); setOpen(null); }}>Auto</button>
        {parameter.type === 'select'
          ? parameter.options?.map(option => <button key={option.id} type="button" className={`studio-dropdown-item ${values[key] === option.id ? 'active' : ''}`} onClick={() => { change(key, option.id); setOpen(null); }}>{option.label}</button>)
          : parameter.type === 'number' && parameter.min !== undefined && parameter.max !== undefined && parameter.step
            ? Array.from({ length: Math.floor((parameter.max - parameter.min) / parameter.step) + 1 }, (_, index) => Number((parameter.min! + index * parameter.step!).toFixed(6))).map(value => <button key={value} type="button" className={`studio-dropdown-item ${values[key] === value ? 'active' : ''}`} onClick={() => { change(key, value); setOpen(null); }}>{value}</button>)
            : <input aria-label={parameter.label} className="cyber-input-field" value={values[key] ?? ''} onChange={event => change(key, event.target.value)} />}
      </Selector> : !optional && (parameter.type === 'select'
        ? <select aria-label={parameter.label} className="cyber-input-field" value={values[key] ?? ''} onChange={event => change(key, event.target.value)}>
          <option value="">Automatic</option>
          {parameter.options?.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        : <input aria-label={parameter.label} className="cyber-input-field" type={parameter.type === 'number' ? 'number' : 'text'} min={parameter.min} max={parameter.max} step={parameter.step} value={values[key] ?? ''} placeholder="Optional" onChange={event => change(key, event.target.value === '' || parameter.type !== 'number' ? event.target.value : Number(event.target.value))} />)}
    </div>)}
  </div>;
}
