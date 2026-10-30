type EscapeOwner = { priority: number; close: () => void };
const owners: EscapeOwner[] = [];
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  const owner = owners.reduce<EscapeOwner | undefined>((top, item) => !top || item.priority >= top.priority ? item : top, undefined);
  if (!owner) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  owner.close();
}
export function ownEscape(close: () => void, priority: number) {
  const owner = { close, priority };
  if (!owners.length) window.addEventListener('keydown', escape);
  owners.push(owner);
  return () => {
    const index = owners.indexOf(owner);
    if (index >= 0) owners.splice(index, 1);
    if (!owners.length) window.removeEventListener('keydown', escape);
  };
}
