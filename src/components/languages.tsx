import React, { useState } from 'react';
import { Modal } from './modal';
import { Button } from './button';
import { useOptions } from '../hooks/use-options';

export interface LanguageOption {
  id: string;
  label: string;
}

export interface LanguagesProps {
  isOpen: boolean;
  onClose: () => void;
  value: string | null;
  onChange: (lang: string | null) => void;
  languages?: LanguageOption[];
  allowAuto?: boolean;
}

export const Languages: React.FC<LanguagesProps> = ({
  isOpen,
  onClose,
  value,
  onChange,
  languages,
  allowAuto = true,
}) => {
  const [search, setSearch] = useState('');
  const options = useOptions();
  const list = languages && languages.length > 0 ? languages : (options.data?.generation?.languages ?? []);
  const popular = list.slice(0, 12);

  const filtered = list.filter(
    (l) =>
      l.id.toLowerCase().includes(search.toLowerCase()) ||
      l.label.toLowerCase().includes(search.toLowerCase()),
  );

  const activeId = allowAuto ? value : (value || 'en');
  const activeLabel = activeId
    ? `${activeId.toUpperCase()} — ${(list.find((l) => l.id === activeId)?.label || activeId).toUpperCase()}`
    : 'AUTO';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="LANGUAGE" size="md">
      <div className="studio-param-modal-content studio-param-modal-compact">
        <div className="studio-lang-search-wrap">
          <span className="studio-lang-search-icon">🔍</span>
          <input
            type="text"
            placeholder={`SEARCH ${list.length} LANGUAGES...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="cyber-input-field studio-lang-search-input"
            autoFocus
          />
          {search && (
            <button
              type="button"
              className="studio-lang-search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear language search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="studio-lang-scroll-body">
          {!search && popular.length > 0 && (
            <>
              <div className="studio-lang-section-title">POPULAR</div>
              <div className="studio-lang-chips-row">
                {popular.map((lang) => {
                  const isSelected = activeId === lang.id;
                  return (
                    <button
                      key={lang.id}
                      type="button"
                      className={`studio-lang-chip ${isSelected ? 'active' : ''}`}
                      onClick={() => onChange(lang.id)}
                    >
                      <span className="studio-lang-chip-code">{lang.id.toUpperCase()}</span>
                      <span className="studio-lang-chip-label">{lang.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="studio-lang-section-title">
            {search
              ? `RESULTS (${filtered.length})`
              : `ALL (${list.length})`}
          </div>

          <div className="studio-lang-grid">
            {filtered.map((lang) => {
              const isSelected = activeId === lang.id;
              return (
                <button
                  key={lang.id}
                  type="button"
                  className={`studio-lang-card ${isSelected ? 'active' : ''}`}
                  onClick={() => onChange(lang.id)}
                >
                  <span className="studio-lang-badge">{lang.id.toUpperCase()}</span>
                  <span className="studio-lang-name">{lang.label}</span>
                  {isSelected && <span className="studio-lang-check">✓</span>}
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="studio-lang-empty">
              NO LANGUAGES FOUND MATCHING "{search.toUpperCase()}"
            </div>
          )}
        </div>

        <div className="studio-lang-selected-strip">
          <div className="studio-field-label studio-field-label-flush">
            <span>LANGUAGE</span>
            <span className="studio-highlight">{activeLabel}</span>
          </div>
        </div>

        <div className="studio-param-actions-row studio-param-actions-compact">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(allowAuto ? null : 'en');
              onClose();
            }}
          >
            {allowAuto ? 'AUTO' : 'RESET'}
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            DONE
          </Button>
        </div>
      </div>
    </Modal>
  );
};
