import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Modal } from './modal';
import { Button } from './button';
import { api } from '@/lib/api';
import { useProfile, SocialLinkRecord, SocialPlatform } from '@/hooks/use-profile';
import { thirdwebClient, getChains, getChainByNetwork, getExplorerUrl } from '@/lib/chains';
import { getProfiles, linkProfile, unlinkProfile } from 'thirdweb/wallets/in-app';
import type { Profile as ThirdwebLinkedProfile } from 'thirdweb/wallets';
import { toast } from 'sonner';
import {
  Link2,
  AlertTriangle,
  ExternalLink,
  X,
  Pencil,
  Copy,
  Check,
  Globe,
  User,
  Camera,
} from 'lucide-react';
import { Tooltip } from './daw/Tooltip';

export interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  address?: string | null;
}

export interface SocialPlatformMeta {
  platform: SocialPlatform;
  label: string;
  shortLabel: string;
  placeholder: string;
  baseUrl: string;
  thirdwebStrategy?: 'x' | 'tiktok' | 'farcaster' | 'discord' | 'telegram' | 'twitch' | 'github' | 'google';
}

export const SOCIAL_PLATFORM_CATALOG: SocialPlatformMeta[] = [
  {
    platform: 'x',
    label: 'X (Twitter)',
    shortLabel: 'X',
    placeholder: '@handle or https://x.com/...',
    baseUrl: 'https://x.com/',
    thirdwebStrategy: 'x',
  },
  {
    platform: 'instagram',
    label: 'Instagram',
    shortLabel: 'IG',
    placeholder: '@handle or https://instagram.com/...',
    baseUrl: 'https://instagram.com/',
  },
  {
    platform: 'tiktok',
    label: 'TikTok',
    shortLabel: 'TT',
    placeholder: '@handle or https://tiktok.com/@...',
    baseUrl: 'https://tiktok.com/@',
    thirdwebStrategy: 'tiktok',
  },
  {
    platform: 'farcaster',
    label: 'Farcaster',
    shortLabel: 'FC',
    placeholder: '@handle or https://warpcast.com/...',
    baseUrl: 'https://warpcast.com/',
    thirdwebStrategy: 'farcaster',
  },
  {
    platform: 'spotify',
    label: 'Spotify',
    shortLabel: 'SPOTIFY',
    placeholder: 'Artist URL or Spotify handle...',
    baseUrl: 'https://open.spotify.com/search/',
  },
  {
    platform: 'soundcloud',
    label: 'SoundCloud',
    shortLabel: 'SC',
    placeholder: '@handle or https://soundcloud.com/...',
    baseUrl: 'https://soundcloud.com/',
  },
  {
    platform: 'youtube',
    label: 'YouTube',
    shortLabel: 'YT',
    placeholder: '@channel or https://youtube.com/@...',
    baseUrl: 'https://youtube.com/@',
  },
  {
    platform: 'discord',
    label: 'Discord',
    shortLabel: 'DISCORD',
    placeholder: 'Invite URL or username...',
    baseUrl: 'https://discord.com/users/',
    thirdwebStrategy: 'discord',
  },
  {
    platform: 'telegram',
    label: 'Telegram',
    shortLabel: 'TG',
    placeholder: '@username or https://t.me/...',
    baseUrl: 'https://t.me/',
    thirdwebStrategy: 'telegram',
  },
  {
    platform: 'twitch',
    label: 'Twitch',
    shortLabel: 'TWITCH',
    placeholder: '@channel or https://twitch.tv/...',
    baseUrl: 'https://twitch.tv/',
    thirdwebStrategy: 'twitch',
  },
  {
    platform: 'github',
    label: 'GitHub',
    shortLabel: 'GITHUB',
    placeholder: '@username or https://github.com/...',
    baseUrl: 'https://github.com/',
    thirdwebStrategy: 'github',
  },
  {
    platform: 'google',
    label: 'Google',
    shortLabel: 'GOOGLE',
    placeholder: 'Email or Google profile URL...',
    baseUrl: 'mailto:',
    thirdwebStrategy: 'google',
  },
];

const THIRDWEB_CONNECT_STRATEGIES: Array<{
  strategy: 'x' | 'tiktok' | 'farcaster' | 'discord' | 'telegram' | 'twitch' | 'github' | 'google';
  platform: SocialPlatform;
  label: string;
}> = [
    { strategy: 'x', platform: 'x', label: 'X' },
    { strategy: 'tiktok', platform: 'tiktok', label: 'TikTok' },
    { strategy: 'farcaster', platform: 'farcaster', label: 'Farcaster' },
    { strategy: 'discord', platform: 'discord', label: 'Discord' },
    { strategy: 'telegram', platform: 'telegram', label: 'Telegram' },
    { strategy: 'twitch', platform: 'twitch', label: 'Twitch' },
    { strategy: 'github', platform: 'github', label: 'GitHub' },
    { strategy: 'google', platform: 'google', label: 'Google' },
  ];

/**
 * Strips raw EVM (`0x...`) or Solana base58 addresses and truncated `0x1234...5678` strings
 * so wallet addresses are never mistaken for custom creator nicknames.
 */
export function sanitizeCreatorNickname(
  nickname?: string | null,
  address?: string | null
): string | null {
  const n = (nickname || '').trim();
  if (!n) return null;
  if (address && n.toLowerCase() === address.trim().toLowerCase()) return null;
  if (/^0x[a-fA-F0-9]{14,}$/.test(n)) return null;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(n)) return null;
  if (/^(0x[a-fA-F0-9]{4,8}|[1-9A-HJ-NP-Za-km-z]{4,8})(…|\.\.\.)[a-fA-F0-9A-HJ-NP-Za-km-z]{4,8}$/.test(n)) {
    return null;
  }
  return n;
}

export function formatCreatorShortAddress(address?: string | null): string | null {
  const raw = (address || '').trim();
  if (!raw) return null;
  if (raw.startsWith('0x') && raw.length >= 12) {
    return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
  }
  if (raw.length >= 12) {
    return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
  }
  return raw;
}

export const SocialPlatformGlyph: React.FC<{ platform: SocialPlatform; size?: number }> = ({
  platform,
  size = 13,
}) => {
  switch (platform) {
    case 'x':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
        </svg>
      );
    case 'farcaster':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4.5 3h15v2.25h-1.5v13.5h1.5V21h-6v-2.25h1.5V12c0-1.657-1.343-3-3-3s-3 1.343-3 3v6.75h1.5V21h-6v-2.25H6V5.25H4.5V3z" />
        </svg>
      );
    case 'spotify':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.58 14.42a.62.62 0 0 1-.85.2c-2.34-1.43-5.28-1.75-8.75-.96a.62.62 0 0 1-.27-1.21c3.8-.87 7.06-.5 9.67 1.1a.62.62 0 0 1 .2.87zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.68-1.65-6.76-2.13-9.93-1.16a.78.78 0 1 1-.45-1.49c3.62-1.1 8.12-.57 11.2 1.32.37.23.48.71.25 1.07zm.11-2.83C14.7 8.97 9.42 8.8 6.36 9.73a.93.93 0 1 1-.54-1.78c3.52-1.07 9.36-.86 13.05 1.33a.93.93 0 0 1-.96 1.59z" />
        </svg>
      );
    case 'soundcloud':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.5 10.5c-.3 0-.6.04-.88.12A4.99 4.99 0 0 0 11.75 7a5 5 0 0 0-4.75 3.44V17h10.5a3.25 3.25 0 0 0 0-6.5zM5 10.75v6.25h1v-6.25H5zm-2.5 1.75V17h1v-4.5h-1z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z" />
        </svg>
      );
    case 'discord':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.07.04c-.21.38-.44.87-.61 1.25a18.27 18.27 0 0 0-5.5 0 12.64 12.64 0 0 0-.62-1.25.07.07 0 0 0-.07-.04 19.74 19.74 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.05 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.12c.13-.09.25-.19.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.07 0a.07.07 0 0 1 .08.01c.12.1.25.2.37.29a.08.08 0 0 1-.01.12c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.11c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .08.03 19.83 19.83 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.68-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42z" />
        </svg>
      );
    case 'telegram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M11.94 2a10 10 0 1 0 10 10 10 10 0 0 0-10-10zm4.66 6.84-1.69 7.97c-.12.56-.46.7-.93.43l-2.58-1.9-1.24 1.2c-.14.14-.26.26-.53.26l.19-2.63 4.78-4.32c.21-.18-.05-.29-.32-.11l-5.91 3.72-2.55-.8c-.55-.17-.56-.55.12-.82l9.96-3.84c.46-.17.86.11.7.84z" />
        </svg>
      );
    case 'twitch':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4.265 3 3 6.236v13.223h4.502V21h2.531l2.531-1.541h3.658L21 14.7V3H4.265zm14.906 10.969-2.812 2.812h-4.5l-2.531 2.531v-2.531H5.531V4.828h13.64v9.141zM14.812 7.922v5.063h-1.828V7.922h1.828zm-4.5 0v5.063H8.484V7.922h1.828z" />
        </svg>
      );
    case 'github':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
      );
    case 'google':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z" />
        </svg>
      );
    default:
      return <Link2 size={size} />;
  }
};

function buildSocialUrl(platform: SocialPlatform, rawInput: string): { handle: string; url: string } | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  const meta = SOCIAL_PLATFORM_CATALOG.find((m) => m.platform === platform);
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const lastSegment = pathParts[pathParts.length - 1] || parsed.hostname;
      const handle = lastSegment.startsWith('@') ? lastSegment : `@${lastSegment}`;
      return { handle, url: parsed.toString() };
    } catch {
      return null;
    }
  }
  const cleanHandle = trimmed.replace(/^@+/, '').replace(/\/+$/, '');
  if (!cleanHandle) return null;
  const baseUrl = meta?.baseUrl || 'https://';
  return {
    handle: `@${cleanHandle}`,
    url: `${baseUrl}${encodeURIComponent(cleanHandle)}`,
  };
}

function isAlreadyLinkedCollisionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    msg.includes('already linked') ||
    msg.includes('already associated') ||
    msg.includes('another account') ||
    msg.includes('another user') ||
    msg.includes('different creator') ||
    msg.includes('already exists') ||
    msg.includes('account already') ||
    msg.includes('409')
  );
}

export const CreatorSocialBadges: React.FC<{
  socials?: SocialLinkRecord[] | null;
  compact?: boolean;
  className?: string;
}> = ({ socials, compact = true, className = '' }) => {
  if (!Array.isArray(socials) || socials.length === 0) return null;
  return (
    <div className={`creator-social-badges ${compact ? 'is-compact' : ''} ${className}`.trim()}>
      {socials.map((item) => {
        const meta = SOCIAL_PLATFORM_CATALOG.find((m) => m.platform === item.platform);
        const label = meta?.label || item.platform.toUpperCase();
        const displayHandle = item.handle || meta?.shortLabel || item.platform.toUpperCase();
        const badgeNode = (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`creator-social-badge-pill ${compact ? 'compact' : ''} ${item.verified ? 'verified' : ''}`.trim()}
            aria-label={`${label}: ${displayHandle}`}
            onClick={(e) => e.stopPropagation()}
          >
            <SocialPlatformGlyph platform={item.platform} size={compact ? 11 : 12} />
            {!compact && <span className="creator-social-badge-handle">{displayHandle}</span>}
            {item.verified && <span className="creator-social-verified-dot" aria-hidden="true" />}
            {!compact && <ExternalLink size={10} className="creator-social-badge-ext" />}
          </a>
        );

        return (
          <Tooltip
            key={`${item.platform}:${item.handle}`}
            title={`${label}${item.verified ? ' ✓' : ''}`}
            description={displayHandle}
            position="top"
          >
            {badgeNode}
          </Tooltip>
        );
      })}
    </div>
  );
};

export interface CreatorWalletEntry {
  address: string;
  networkName: string;
  explorerUrl?: string | null;
}

export function resolveCreatorWallets(params: {
  primaryAddress?: string | null;
  addresses?: Iterable<string> | null;
  songs?: Array<{ creator?: string | null; network?: string | null }> | null;
  explicitExplorerUrl?: string | null;
}): CreatorWalletEntry[] {
  const { primaryAddress, addresses, songs, explicitExplorerUrl } = params;
  const chains = getChains();
  const defaultEvmChain = chains.find(
    (c) => c.namespace === 'eip155' || (c.network ?? '').startsWith('eip155:')
  );
  const defaultSolChain = chains.find(
    (c) => c.namespace === 'solana' || (c.network ?? '').startsWith('solana:')
  );

  let evmAddr: string | null = null;
  let evmNet: string | null = null;
  let solAddr: string | null = null;
  let solNet: string | null = null;

  if (Array.isArray(songs)) {
    for (const s of songs) {
      const c = (s.creator || '').trim();
      const n = (s.network || '').trim();
      if (c.startsWith('0x') || n.startsWith('eip155:')) {
        if (!evmAddr && c.startsWith('0x')) evmAddr = c;
        if (!evmNet && n.startsWith('eip155:')) evmNet = n;
      } else if ((c && !c.startsWith('0x')) || n.startsWith('solana:')) {
        if (!solAddr && c && !c.startsWith('0x')) solAddr = c;
        if (!solNet && n.startsWith('solana:')) solNet = n;
      }
    }
  }

  if (addresses) {
    for (const raw of addresses) {
      const a = (raw || '').trim();
      if (!a) continue;
      if (a.startsWith('0x')) {
        if (!evmAddr) evmAddr = a;
      } else if (a.length >= 32) {
        if (!solAddr) solAddr = a;
      }
    }
  }

  const cleanPrimary = (primaryAddress || '').trim();
  if (cleanPrimary) {
    if (cleanPrimary.startsWith('0x')) {
      if (!evmAddr) evmAddr = cleanPrimary;
    } else {
      if (!solAddr) solAddr = cleanPrimary;
    }
  }

  const buildEntry = (addr: string, netId: string | null, isEvm: boolean): CreatorWalletEntry => {
    const chain =
      (netId ? getChainByNetwork(netId) : undefined) ||
      (isEvm ? defaultEvmChain : defaultSolChain);
    const networkName = chain?.name || (isEvm ? 'EVM' : 'Solana');
    let explorerUrl = explicitExplorerUrl || null;
    if (!explorerUrl && chain?.network) {
      const url = getExplorerUrl(chain.network, 'address', addr);
      if (url && url !== '#') explorerUrl = url;
    }
    if (!explorerUrl) {
      explorerUrl = isEvm
        ? `https://sepolia.basescan.org/address/${addr}`
        : `https://explorer.solana.com/address/${addr}?cluster=devnet`;
    }
    return { address: addr, networkName, explorerUrl };
  };

  const result: CreatorWalletEntry[] = [];
  const primaryIsSol = cleanPrimary && !cleanPrimary.startsWith('0x');

  if (primaryIsSol) {
    if (solAddr) result.push(buildEntry(solAddr, solNet, false));
    if (evmAddr) result.push(buildEntry(evmAddr, evmNet, true));
  } else {
    if (evmAddr) result.push(buildEntry(evmAddr, evmNet, true));
    if (solAddr) result.push(buildEntry(solAddr, solNet, false));
  }

  return result;
}

export interface CreatorProfileCardProps {
  variant?: 'mypage' | 'creator' | 'connector' | 'editor-preview';
  address?: string | null;
  addresses?: Iterable<string> | null;
  songs?: Array<{ creator?: string | null; network?: string | null }> | null;
  wallets?: CreatorWalletEntry[];
  nickname?: string | null;
  avatar?: string | null;
  bio?: string | null;
  banner?: string | null;
  socials?: SocialLinkRecord[] | null;
  explorerUrl?: string | null;
  onEdit?: () => void;
  onPreview?: () => void;
  onUploadBanner?: () => void;
  onRemoveBanner?: () => void;
  onUploadAvatar?: () => void;
  onRemoveAvatar?: () => void;
  statsSlot?: React.ReactNode;
  className?: string;
}

/**
 * Canonical Rawchunks Creator Identity Card.
 * Used identically across `/my-page`, `/:creator`, `AccountChip` connector modal, and `ProfileModal` live preview.
 */
export const CreatorProfileCard: React.FC<CreatorProfileCardProps> = ({
  variant = 'mypage',
  address,
  addresses,
  songs,
  wallets,
  nickname,
  avatar,
  bio,
  banner,
  socials,
  explorerUrl,
  onEdit,
  onPreview,
  onUploadBanner,
  onRemoveBanner,
  onUploadAvatar,
  onRemoveAvatar,
  statsSlot,
  className = '',
}) => {
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const cleanNickname = sanitizeCreatorNickname(nickname, address);
  const shortAddr = formatCreatorShortAddress(address);
  const primaryTitle = cleanNickname || shortAddr || 'CREATOR';
  const isEditorPreview = variant === 'editor-preview';
  const isCreatorPage = variant === 'creator';

  const resolvedWallets: CreatorWalletEntry[] = React.useMemo(() => {
    if (Array.isArray(wallets) && wallets.length > 0) {
      return wallets;
    }
    return resolveCreatorWallets({
      primaryAddress: address,
      addresses,
      songs,
      explicitExplorerUrl: explorerUrl,
    });
  }, [wallets, address, addresses, songs, explorerUrl]);

  const handleCopyWallet = (e: React.MouseEvent, targetAddress: string, networkName: string) => {
    e.stopPropagation();
    if (!targetAddress) return;
    navigator.clipboard?.writeText(targetAddress);
    setCopiedAddr(targetAddress);
    toast.success(`${networkName} address copied`);
    window.setTimeout(() => setCopiedAddr((prev) => (prev === targetAddress ? null : prev)), 1800);
  };

  return (
    <div
      className={`creator-card-group variant-${variant} ${banner ? 'has-banner' : ''} ${onEdit ? 'is-editable' : ''} ${className}`.trim()}
      data-guide={variant === 'mypage' ? 'mypage-profile' : undefined}
    >
      {/* Scoped Banner Backdrop Layer */}
      <div
        className={`creator-card-banner ${isEditorPreview ? 'is-interactive' : ''}`}
        onClick={isEditorPreview ? onUploadBanner : undefined}
        style={
          banner
            ? {
              backgroundImage: `linear-gradient(90deg, rgba(6, 6, 10, 0.92) 0%, rgba(6, 6, 10, 0.64) 52%, rgba(6, 6, 10, 0.88) 100%), url(${banner})`,
            }
            : undefined
        }
        aria-hidden={!isEditorPreview}
      >
        {isEditorPreview && (
          <span className="creator-card-banner-camera" aria-hidden="true">
            <Camera size={14} />
          </span>
        )}
      </div>

      {/* Top-Right Edit Pencil Action (Wherever profile is editable) */}
      {onEdit && (
        <div className="creator-card-edit-top-right">
          <Tooltip title="Edit Profile" position="top">
            <button
              type="button"
              className="creator-card-icon-action"
              onClick={onEdit}
              aria-label="Edit profile"
            >
              <Pencil size={11} />
            </button>
          </Tooltip>
        </div>
      )}

      {isEditorPreview && banner && onRemoveBanner && (
        <div className="creator-card-banner-edit-controls">
          <button
            type="button"
            className="creator-card-media-clear-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveBanner();
            }}
            aria-label="Remove banner"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* Main Horizontal Identity Content */}
      <div className="creator-card-body">
        {/* Avatar Anchor */}
        <div
          className={`creator-card-avatar-wrap ${isEditorPreview ? 'is-interactive' : ''}`}
          onClick={isEditorPreview ? onUploadAvatar : undefined}
        >
          {avatar ? (
            <img src={avatar} alt={primaryTitle} className="creator-card-avatar-img" />
          ) : (
            <div className="creator-card-avatar-fallback">
              <User size={18} />
            </div>
          )}
          {isEditorPreview && (
            <span className="creator-card-avatar-camera" aria-hidden="true">
              <Camera size={12} />
            </span>
          )}
          {isEditorPreview && avatar && onRemoveAvatar && (
            <button
              type="button"
              className="creator-card-avatar-clear-btn"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveAvatar();
              }}
              aria-label="Remove avatar"
            >
              <X size={9} />
            </button>
          )}
        </div>

        {/* Center Identity Stack */}
        <div className="creator-card-main">
          {/* Row 1: Primary Name + Wallet External Links (/:creator) or Copy Icons (/my-page) + Preview */}
          <div className="creator-card-head-row">
            <div className="creator-card-title-cluster">
              <span className="creator-card-name">{primaryTitle}</span>

              {isCreatorPage
                ? resolvedWallets.map((w) =>
                  w.explorerUrl ? (
                    <Tooltip
                      key={`${w.networkName}:${w.address}`}
                      title={`View ${w.networkName} Address`}
                      description={formatCreatorShortAddress(w.address) || w.address}
                      position="top"
                    >
                      <a
                        href={w.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="creator-card-icon-action creator-card-wallet-ext"
                        aria-label={`View ${w.networkName} address on explorer`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={11} />
                      </a>
                    </Tooltip>
                  ) : null
                )
                : resolvedWallets.map((w) => {
                  const isThisCopied = copiedAddr === w.address;
                  const formatted = formatCreatorShortAddress(w.address);
                  return (
                    <Tooltip
                      key={`${w.networkName}:${w.address}`}
                      title={`Copy your ${w.networkName} Address`}
                      description={formatted || w.address}
                      position="top"
                    >
                      <button
                        type="button"
                        className="creator-card-wallet-copy-pill"
                        onClick={(e) => handleCopyWallet(e, w.address, w.networkName)}
                        aria-label={`Copy your ${w.networkName} Address`}
                      >
                        {cleanNickname && formatted && (
                          <span className="creator-card-wallet-text">{formatted}</span>
                        )}
                        {isThisCopied ? <Check size={11} /> : <Copy size={11} />}
                      </button>
                    </Tooltip>
                  );
                })}

              {onPreview && (
                <Tooltip
                  title="PUBLIC PROFILE"
                  description="Open your public /:creator studio page"
                  position="top"
                >
                  <button
                    type="button"
                    className="creator-card-icon-action accent"
                    onClick={onPreview}
                    aria-label="Preview public profile"
                  >
                    <Globe size={11} />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Row 2: Prominent Bio */}
          {bio && bio.trim() ? (
            <p className="creator-card-bio">{bio.trim()}</p>
          ) : null}

          {/* Row 3: Social Profiles (Always Below BIO) + Bottom-Right Stats */}
          {((Array.isArray(socials) && socials.length > 0) || statsSlot) && (
            <div className="creator-card-bottom-row">
              <CreatorSocialBadges
                socials={socials}
                compact
                className="creator-card-social-dock"
              />
              {statsSlot && <div className="creator-card-stats-row">{statsSlot}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  address,
}) => {
  const {
    nickname: currentNickname,
    avatar: currentAvatar,
    bio: currentBio,
    banner: currentBanner,
    socials: currentSocials,
    updateProfile,
  } = useProfile(address);

  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [socials, setSocials] = useState<SocialLinkRecord[]>([]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkingStrategy, setLinkingStrategy] = useState<string | null>(null);
  const [linkedThirdwebProfiles, setLinkedThirdwebProfiles] = useState<ThirdwebLinkedProfile[]>([]);
  const [linkErrorBanner, setLinkErrorBanner] = useState<string | null>(null);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const refreshThirdwebProfiles = useCallback(async () => {
    try {
      const list = await getProfiles({ client: thirdwebClient });
      if (Array.isArray(list)) {
        setLinkedThirdwebProfiles(list);
      }
    } catch {
      // External wallet or no embedded session
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setNickname(sanitizeCreatorNickname(currentNickname, address) || '');
      setAvatar(currentAvatar || null);
      setBanner(currentBanner || null);
      setBio(currentBio || '');
      setSocials(Array.isArray(currentSocials) ? currentSocials : []);
      setLinkErrorBanner(null);
      void refreshThirdwebProfiles();
    }
  }, [isOpen, currentNickname, currentAvatar, currentBanner, currentBio, currentSocials, address, refreshThirdwebProfiles]);

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: 'avatar' | 'banner'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (kind === 'avatar') setUploadingAvatar(true);
    else setUploadingBanner(true);

    try {
      const data = new FormData();
      data.append('file', file);
      const res = await api.fetch('/api/generation/cover', {
        method: 'POST',
        body: data,
      });
      const result = await res.json();
      if (!res.ok || !result.imageUrl) {
        throw new Error(result.error || `Failed to upload ${kind}`);
      }
      if (kind === 'avatar') {
        setAvatar(result.imageUrl);
        toast.success('Avatar uploaded');
      } else {
        setBanner(result.imageUrl);
        toast.success('Banner uploaded');
      }
    } catch (err: any) {
      toast.error(err.message || `${kind === 'avatar' ? 'Avatar' : 'Banner'} upload failed`);
    } finally {
      if (kind === 'avatar') {
        setUploadingAvatar(false);
        if (avatarInputRef.current) avatarInputRef.current.value = '';
      } else {
        setUploadingBanner(false);
        if (bannerInputRef.current) bannerInputRef.current.value = '';
      }
    }
  };

  const handleRemoveSocial = (platform: SocialPlatform) => {
    setSocials((prev) => prev.filter((s) => s.platform !== platform));
  };

  const handleThirdwebLink = async (
    strategy: 'x' | 'tiktok' | 'farcaster' | 'discord' | 'telegram' | 'twitch' | 'github' | 'google',
    platform: SocialPlatform,
    label: string
  ) => {
    setLinkErrorBanner(null);
    setLinkingStrategy(strategy);
    try {
      const updated = await linkProfile({
        client: thirdwebClient,
        strategy,
      });
      setLinkedThirdwebProfiles(updated);

      const matched = updated.find((p) => p.type.toLowerCase() === strategy.toLowerCase());
      const rawId =
        matched?.details?.email ||
        matched?.details?.id ||
        matched?.details?.address ||
        strategy;
      const built = buildSocialUrl(platform, String(rawId));
      if (built) {
        setSocials((prev) => {
          const existing = prev.find((s) => s.platform === platform);
          const record: SocialLinkRecord = {
            platform,
            handle: existing?.handle || built.handle,
            url: existing?.url || built.url,
            verified: true,
            providerId: `${strategy}:${String(rawId).toLowerCase()}`,
          };
          return [...prev.filter((s) => s.platform !== platform), record];
        });
      }
      toast.success(`${label} profile linked`);
    } catch (err: any) {
      if (isAlreadyLinkedCollisionError(err)) {
        const msg = 'Account already linked to a different Creator.';
        setLinkErrorBanner(msg);
        toast.error(msg);
      } else {
        const fallback = err instanceof Error ? err.message : `Could not link ${label}`;
        setLinkErrorBanner(fallback);
        toast.error(fallback);
      }
    } finally {
      setLinkingStrategy(null);
    }
  };

  const handleThirdwebUnlink = async (
    profileToUnlink: ThirdwebLinkedProfile,
    platform: SocialPlatform
  ) => {
    if (linkedThirdwebProfiles.length <= 1) {
      toast.error('Cannot unlink your only authentication method');
      return;
    }
    setLinkErrorBanner(null);
    setLinkingStrategy(profileToUnlink.type);
    try {
      const updated = await unlinkProfile({
        client: thirdwebClient,
        profileToUnlink,
      });
      setLinkedThirdwebProfiles(updated);
      setSocials((prev) => prev.filter((s) => s.platform !== platform));
      toast.success(`Unlinked ${profileToUnlink.type.toUpperCase()}`);
    } catch (err: any) {
      toast.error(err instanceof Error ? err.message : 'Failed to unlink profile');
    } finally {
      setLinkingStrategy(null);
    }
  };

  const handleSave = async () => {
    if (!address) {
      toast.error('Connect wallet first');
      return;
    }
    setLinkErrorBanner(null);
    setSaving(true);
    try {
      await updateProfile({
        nickname: nickname.trim() || null,
        avatar: avatar || null,
        bio: bio.trim() || null,
        banner: banner || null,
        socials,
      });
      onClose();
    } catch (err: any) {
      if (isAlreadyLinkedCollisionError(err)) {
        setLinkErrorBanner('Account already linked to a different Creator.');
      } else if (err instanceof Error) {
        setLinkErrorBanner(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || uploadingAvatar || uploadingBanner || linkingStrategy !== null;

  return (
    <Modal
      guideOwner="profile"
      guideAnchor="account.profile-form"
      guideDraft
      isOpen={isOpen}
      onClose={onClose}
      title="EDIT CREATOR PROFILE"
      size="md"
    >
      <div className="profile-modal-body">
        <input
          type="file"
          ref={bannerInputRef}
          accept="image/*"
          className="hidden-file-input"
          onChange={(e) => handleImageUpload(e, 'banner')}
        />
        <input
          type="file"
          ref={avatarInputRef}
          accept="image/*"
          className="hidden-file-input"
          onChange={(e) => handleImageUpload(e, 'avatar')}
        />

        {/* Live WYSIWYG Creator Identity Card Preview */}
        <CreatorProfileCard
          variant="editor-preview"
          address={address}
          nickname={nickname}
          avatar={avatar}
          bio={bio}
          banner={banner}
          socials={socials}
          onUploadBanner={() => bannerInputRef.current?.click()}
          onRemoveBanner={() => setBanner(null)}
          onUploadAvatar={() => avatarInputRef.current?.click()}
          onRemoveAvatar={() => setAvatar(null)}
        />

        {/* Nickname */}
        <div className="cyber-input-wrap">
          <label className="cyber-input-label">NICKNAME</label>
          <input
            type="text"
            aria-label="Nickname"
            className="cyber-input-field"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="ENTER NICKNAME..."
            maxLength={32}
          />
        </div>

        {/* Bio */}
        <div className="cyber-input-wrap">
          <div className="profile-modal-label-row">
            <label className="cyber-input-label">BIO</label>
            <span className={`profile-modal-char-count ${bio.length >= 260 ? 'near-limit' : ''}`}>
              {bio.length} / 280
            </span>
          </div>
          <textarea
            className="cyber-input-field profile-modal-bio-input"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 280))}
            placeholder="TELL LISTENERS ABOUT YOUR SOUND, GENRES & COLLABS..."
            maxLength={280}
            rows={2}
          />
        </div>

        {/* Connect Profiles (Logo-Only 1-Click Link / Unlink) */}
        <div className="cyber-input-wrap">
          <label className="cyber-input-label">LINK YOUR PROFILES</label>

          {linkErrorBanner && (
            <div className="profile-modal-collision-alert" role="alert">
              <AlertTriangle size={14} className="profile-modal-collision-icon" />
              <span>{linkErrorBanner}</span>
            </div>
          )}

          <div className="profile-modal-logo-grid">
            {THIRDWEB_CONNECT_STRATEGIES.map((item) => {
              const linkedAuth = linkedThirdwebProfiles.find(
                (p) => p.type.toLowerCase() === item.strategy.toLowerCase()
              );
              const linkedSocial = socials.find((s) => s.platform === item.platform);
              const isLinked = Boolean(linkedAuth || linkedSocial);
              const isLinking = linkingStrategy === item.strategy;
              return (
                <Tooltip
                  key={item.strategy}
                  title={isLinked ? `Unlink ${item.label}` : `Link ${item.label}`}
                  position="top"
                >
                  <button
                    type="button"
                    className={`profile-modal-logo-btn ${isLinked ? 'linked' : ''} ${isLinking ? 'linking' : ''}`.trim()}
                    disabled={busy}
                    onClick={() => {
                      if (linkedAuth) {
                        void handleThirdwebUnlink(linkedAuth, item.platform);
                      } else if (linkedSocial) {
                        handleRemoveSocial(item.platform);
                      } else {
                        void handleThirdwebLink(item.strategy, item.platform, item.label);
                      }
                    }}
                    aria-label={isLinked ? `Unlink ${item.label}` : `Link ${item.label}`}
                  >
                    <SocialPlatformGlyph platform={item.platform} size={15} />
                    {isLinked && <span className="profile-modal-logo-dot" aria-hidden="true" />}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>

        <div className="profile-modal-actions">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            CANCEL
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={busy}>
            {saving ? 'SAVING...' : 'SAVE PROFILE'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
