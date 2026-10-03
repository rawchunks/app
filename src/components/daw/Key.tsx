import { createLucideIcon } from 'lucide-react';

export const Key = createLucideIcon('Key', [
  ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 1, key: 'keys' }],
  ['path', { d: 'M9 3v18M15 3v18', key: 'white' }],
  ['path', { d: 'M7 3h4v10H7ZM13 3h4v10h-4Z', fill: 'currentColor', stroke: 'none', key: 'black' }],
]);
