import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Tooltip } from '../daw/Tooltip';
import type { DropdownOption } from './utils';

export interface AgHeaderTooltipParams {
  displayName?: string;
  tooltip?: string;
  align?: 'left' | 'right';
}

export const AgHeaderTooltip: React.FC<AgHeaderTooltipParams> = ({
  displayName = '',
  tooltip = '',
  align = 'left',
}) => (
  <Tooltip
    title={displayName}
    description={tooltip}
    position="top"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
      width: '100%',
    }}
  >
    <span className="cm-ag-header-label">{displayName}</span>
  </Tooltip>
);

export interface BlockDropdownProps<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
  align?: 'start' | 'end';
  chevron?: boolean;
  triggerIcon?: React.ComponentType<{ className?: string; size?: number }>;
  variant?: 'block' | 'header';
}

export function BlockDropdown<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  align = 'start',
  chevron = true,
  triggerIcon: TriggerIconOverride,
  variant = 'block',
}: BlockDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const active = options.find((o) => o.value === value) ?? options[0];
  const ActiveIcon = TriggerIconOverride ?? active?.icon;

  return (
    <div
      ref={wrapRef}
      className="cm-dropdown-wrap"
      data-open={open ? 'true' : 'false'}
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip title={active?.label || ariaLabel} description={active?.tooltip || ariaLabel}>
        <button
          type="button"
          className={variant === 'header' ? 'cm-control-switcher' : 'cm-sort-dropdown__trigger'}
          data-open={open ? 'true' : 'false'}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => setOpen((prev) => !prev)}
        >
          {active?.logoUrl ? (
            <img src={active.logoUrl} alt="" className="cm-network-filter__logo" />
          ) : ActiveIcon ? (
            <ActiveIcon
              className={
                variant === 'header' ? 'cm-control-switcher__icon' : 'cm-sort-dropdown__icon'
              }
            />
          ) : null}
          <span
            className={
              variant === 'header' ? 'cm-control-switcher__label' : 'cm-sort-dropdown__label'
            }
          >
            {active?.label}
          </span>
          {chevron && (
            <ChevronDown
              className={
                variant === 'header' ? 'cm-control-switcher__chevron' : 'cm-sort-dropdown__icon'
              }
            />
          )}
        </button>
      </Tooltip>

      {open && (
        <div
          className="cm-dropdown-menu"
          data-align={align === 'end' ? 'end' : undefined}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((opt) => {
            const Icon = opt.icon;
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className="cm-dropdown-item"
                data-active={isSelected ? 'true' : 'false'}
                title={opt.tooltip || opt.label}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.logoUrl ? (
                  <img src={opt.logoUrl} alt="" className="cm-network-filter__logo" />
                ) : Icon ? (
                  <Icon className="cm-sort-dropdown__icon" />
                ) : null}
                <span>{opt.label}</span>
                {opt.count !== undefined && (
                  <span className="cm-sort-dropdown__count">{opt.count}</span>
                )}
                {isSelected && <Check className="cm-dropdown-item__check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
