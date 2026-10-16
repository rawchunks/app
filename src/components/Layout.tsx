import React, { useEffect } from 'react';
import { AudioWaveform, Radio, FileMusic } from 'lucide-react';
import { Player } from './player';
import { Tooltip } from './daw/Tooltip';
import { store } from '../lib/store';
import { NetworkSelector } from './network';
import { SessionControl } from './session';
import { WalletConnector } from './connector';
import { useSelectedUserAddress } from '../hooks/use-address';
import { useChain } from '../contexts/Network';
import { attachWallet } from '../lib/sdk';

export type Route = 'studio' | 'mypage' | 'market' | 'editor';

export interface Props {
  current: Route;
  onNavigate: (route: Route) => void;
  children: React.ReactNode;
}

export const Layout: React.FC<Props> = ({ current, onNavigate, children }) => {
  const { userAddress, evmAddress, svmAddress } = useSelectedUserAddress();
  const { selectedNetwork } = useChain();

  useEffect(() => {
    const activeAddress = userAddress || evmAddress || svmAddress || '';
    store.setUserAddress(activeAddress, evmAddress, svmAddress);
    if (activeAddress && selectedNetwork) {
      attachWallet(activeAddress, selectedNetwork);
    } else {
      attachWallet(null, null);
    }
  }, [userAddress, evmAddress, svmAddress, selectedNetwork]);

  const navItems: { id: Route; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'studio', label: '/STUDIO', Icon: AudioWaveform },
    { id: 'mypage', label: '/MY-PAGE', Icon: FileMusic },
    { id: 'market', label: '/MARKET', Icon: Radio },
  ];

  return (
    <div className="app-viewport viewport">
      <div className="scanlines" />

      {/* Top Header Navigation */}
      <header className="app-header">
        {/* Brand */}
        <Tooltip title="RAWCHUNKS" description="Open Studio" position="bottom">
          <button type="button" className="header-brand" onClick={() => onNavigate('studio')} aria-label="Rawchunks — open Studio">
            <img src="/branding/logo.svg" alt="Rawchunks" className="header-brand-logo" width={590} height={88} />
            <span className="header-brand-tag">v1.5</span>
          </button>
        </Tooltip>

        {/* The 3 Core Visible Pages */}
        <nav className="service-switcher" aria-label="Services">
          {navItems.map((item) => {
            const active = current === item.id;
            const Icon = item.Icon;
            return (
              <Tooltip key={item.id} title={item.label} position="bottom">
                <button
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-label={item.label}
                  className={`service-nav-btn ${active ? 'active' : ''}`}
                >
                  <span className="service-nav-icon"><Icon className="nav-icon-svg" /></span>
                  <span className="service-nav-label">{item.label}</span>
                </button>
              </Tooltip>
            );
          })}
        </nav>

        {/* Network Selector, Session Control, and Smart Account Connector */}
        <div className="header-actions">
          <NetworkSelector />
          <SessionControl />
          <WalletConnector compact />
        </div>
      </header>

      {/* Main Service Viewport */}
      <main className="main-viewport">
        {children}
      </main>

      {/* Persistent Audio Transport Dock (Studio / My-Page / Market) */}
      {current !== 'editor' && <Player />}
    </div>
  );
};
