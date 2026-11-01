// @vitest-environment jsdom
import React, { createRef, StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Button } from '../src/components/button';
import { GuideRegistry, visibleRect } from '../src/components/guide/registry';
import { normalizeGuides, setGuideStatus, guideSeen } from '../src/components/guide/status';
import { GUIDE_FLOWS, GUIDE_STEPS } from '../src/components/guide/Steps';
import { GuideProvider, useGuide } from '../src/components/guide/Tour';
import { useGuideOwner, prepareViews } from '../src/components/guide/owners';
import { Keys } from '../src/components/daw/Keys';
import { Drums } from '../src/components/daw/Drums';
import { Sampler } from '../src/components/daw/Sampler';
import * as audioPeaks from '../src/lib/daw/peaks';
import { useDawStore, type DAWTrack } from '../src/lib/daw/store';
import { dawEngine } from '../src/lib/daw/engine';
import { Modal } from '../src/components/modal';
import { useDismiss } from '../src/hooks/use-dismiss';

const service = vi.hoisted(() => ({ fetch: vi.fn(), accountId: 'guide-test' as string | null }));
const measurements = vi.hoisted(() => ({ updates: [] as Array<(height: number) => number> }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual, useState(initial: unknown) {
    const [value, setValue] = actual.useState(initial);
    if (initial !== 190) return [value, setValue];
    return [value, (next: unknown) => {
      if (typeof next === 'function') measurements.updates.push(next as (height: number) => number);
      setValue(next);
    }];
  } };
});
vi.mock('../src/lib/api', () => ({ api: service }));
vi.mock('../src/hooks/use-address', () => ({ useSelectedUserAddress: () => ({ accountId: service.accountId, userAddress: service.accountId, isReconnecting: false }) }));
vi.mock('../src/hooks/use-disclaimer', () => ({ useDisclaimerConsent: () => ({ hasConsented: true, isLoading: false }) }));

beforeEach(() => {
  localStorage.clear();
  measurements.updates = [];
  service.accountId = 'guide-test';
  service.fetch.mockReset().mockImplementation(async () => Response.json({ guides: Object.values(GUIDE_FLOWS).map(flow => `guide:${flow.id}:2:c`) }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(100, 100, 180, 40));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [{ width: 180, height: 40 }] as unknown as DOMRectList);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount(child: React.ReactNode, page: 'studio' | 'market' | 'editor' = 'studio') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<StrictMode><QueryClientProvider client={client}><GuideProvider activePage={page}>{child}</GuideProvider></QueryClientProvider></StrictMode>);
}

describe('guide controls and state', () => {
  it('forwards native attributes, events and refs through both Button variants', () => {
    const button = createRef<HTMLButtonElement>(); const link = createRef<HTMLAnchorElement>();
    const down = vi.fn(), click = vi.fn();
    render(<><Button ref={button} aria-label="Named control" data-guide="control" onMouseDown={down} onClick={click}>Go</Button>
      <Button ref={link} href="/local" aria-label="Named link" data-guide="link" target="_blank" rel="noopener">Link</Button></>);
    expect(screen.getByRole('button', { name: 'Named control' }).getAttribute('data-guide')).toBe('control');
    act(() => button.current!.focus()); expect(document.activeElement).toBe(button.current);
    fireEvent.mouseDown(button.current!); fireEvent.click(button.current!);
    expect(down).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1);
    expect(link.current!.getAttribute('rel')).toBe('noopener');
  });
  it('does not call disabled button or link actions', () => {
    const click = vi.fn();
    render(<><Button disabled onClick={click}>Disabled</Button><Button disabled href="/local" onClick={click}>Disabled link</Button></>);
    fireEvent.click(screen.getByText('Disabled')); fireEvent.click(screen.getByText('Disabled link'));
    expect(click).not.toHaveBeenCalled();
  });
  it('keeps one canonical versioned status per flow within the 32-entry limit', () => {
    const input = ['studio', 'guide:studio:2:d', 'guide:studio:1:c', 'guide:studio:2:c', ...Array.from({ length: 32 }, (_, i) => `external-${i}`)];
    const values = normalizeGuides(input);
    expect(values).toHaveLength(32); expect(values.filter(item => item.includes('studio'))).toEqual(['guide:studio:2:c']);
    expect(guideSeen(normalizeGuides(['studio']), 'studio')).toBe(true);
    expect(guideSeen(setGuideStatus([], 'studio', 'dismissed'), 'studio')).toBe(true);
  });
  it('restores only view values that the user has not replaced', () => {
    let state = { view: 'original', open: false };
    const setters = { view: (view: string) => { state = { ...state, view }; }, open: (open: boolean) => { state = { ...state, open }; } };
    const preparation = prepareViews(state, () => state, setters, { view: 'guide', open: true });
    state.view = 'user'; preparation.leave!();
    expect(state).toEqual({ view: 'user', open: false });
  });
  it('prepares from the current panel and restores the original flow panel', () => {
    let state = { view: 'fx' };
    const preparation = prepareViews(state, () => state, { view: view => { state = { view }; } }, { view: 'mixer' }, { view: 'mixer' });
    expect(state.view).toBe('mixer');
    preparation.leave!(); expect(state.view).toBe('mixer');
  });
  it('rejects hidden and inert ancestors and clips to the visible scroll area', () => {
    render(<div><div hidden><button>Hidden</button></div><div inert><button>Inert</button></div><button>Visible</button></div>);
    expect(visibleRect(screen.getByText('Hidden'))).toBeNull(); expect(visibleRect(screen.getByText('Inert'))).toBeNull();
    expect(visibleRect(screen.getByText('Visible'))?.width).toBe(180);
  });
});

describe('owner lifecycle', () => {
  it('can finish after measuring the card without a deferred size update reading its removed DOM', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240);
    function Owner() {
      const { startFlow } = useGuide();
      useGuideOwner({ id: 'studio', scope: 'completion-size', handles: () => true, prepare: () => ({ target: 'test.measured' }) });
      return <><button onClick={() => startFlow('studio-vibe', { initialStep: 4 })}>Start completion step</button><button data-guide="test.measured">Control</button></>;
    }
    mount(<Owner />); fireEvent.click(screen.getByText('Start completion step'));
    await waitFor(() => expect(measurements.updates.length).toBeGreaterThan(0));
    const deferred = measurements.updates.at(-1)!;
    fireEvent.click(screen.getByRole('button', { name: 'Done', exact: true }));
    expect(document.querySelector('[data-guide-step]')).toBeNull();
    expect(deferred(190)).toBe(240);
    expect(screen.getByText('Start completion step')).toBeDefined();
  });
  it('scrolls a target again when a layout change moves it outside its scroll area', async () => {
    let repositioned = false;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function () {
      const shifted = this.getAttribute('data-layout') === 'shifted' && !repositioned;
      return new DOMRect(100, shifted ? 400 : 100, 180, 40);
    });
    const scroll = vi.fn(function (this: HTMLElement) {
      if (this.getAttribute('data-layout') === 'shifted') repositioned = true;
    });
    HTMLElement.prototype.scrollIntoView = scroll;
    function Owner() {
      const { startFlow } = useGuide(); const [shifted, setShifted] = useState(false);
      useGuideOwner({ id: 'studio', scope: 'layout', handles: () => true, prepare: () => ({ target: 'test.layout' }) });
      return <><button onClick={() => startFlow('studio-vibe')}>Start layout guide</button>
        <button onClick={() => setShifted(true)}>Change layout</button>
        <div style={{ overflowY: 'hidden' }}><button data-guide="test.layout" data-layout={shifted ? 'shifted' : 'original'}>Target</button></div></>;
    }
    mount(<Owner />); fireEvent.click(screen.getByText('Start layout guide'));
    await waitFor(() => expect(document.querySelector('.guide-spotlight-ring')).not.toBeNull());
    expect(scroll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Change layout'));
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector('.guide-spotlight-ring')).not.toBeNull());
  });
  it('prepares once, binds a stable entity, cancels late readiness and leaves once', () => {
    const registry = new GuideRegistry(), leave = vi.fn(), prepare = vi.fn(() => ({ leave })), changed = vi.fn();
    const bindings = new Map<string, string>();
    registry.register({ id: 'studio', scope: 'one', handles: () => true, prepare });
    const first = registry.enter(GUIDE_STEPS.S6, bindings, changed);
    registry.notify(); registry.notify(); expect(prepare).toHaveBeenCalledTimes(1);
    first.leave(); first.leave(); expect(leave).toHaveBeenCalledTimes(1); expect(first.signal.aborted).toBe(true);
    const calls = changed.mock.calls.length;
    registry.register({ id: 'network', scope: 'late', handles: () => true, prepare });
    expect(changed).toHaveBeenCalledTimes(calls);
    const bind = prepare.mock.calls[0][0].bind;
    expect(bind('song', 'first')).toBe('first'); expect(bind('song', 'second')).toBe('first');
  });
  it('does not advance from input arrow keys or trigger product actions', async () => {
    const submit = vi.fn(); const prepared = vi.fn();
    function Owner() {
      const { startFlow } = useGuide();
      useGuideOwner({ id: 'studio', scope: 'test', handles: () => true, prepare: ({ step }) => { prepared(step.id); return { target: 'test.prompt' }; } });
      return <><button onClick={() => startFlow('studio-vibe')}>Replay</button><textarea data-guide="test.prompt" aria-label="Prompt" /><button onClick={submit}>Submit</button></>;
    }
    mount(<Owner />); fireEvent.click(screen.getByText('Replay'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Prompt')));
    fireEvent.keyDown(screen.getByLabelText('Prompt'), { key: 'ArrowRight' });
    expect(document.querySelector('[data-guide-step]')?.getAttribute('data-guide-step')).toBe('V1');
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(document.querySelector('[data-guide-step]')?.getAttribute('data-guide-step')).toBe('V2'));
    expect(prepared.mock.calls.filter(([id]) => id === 'V1')).toHaveLength(1); expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Close guide')); expect(submit).not.toHaveBeenCalled();
    expect(service.fetch.mock.calls.filter(([, options]) => options?.method === 'POST').every(([url]) => url === '/api/user/guides')).toBe(true);
  });
  it('keeps a guide-owned popover open through Next and assigns one Escape owner', async () => {
    const onClose = vi.fn();
    function Owner() {
      const { startFlow } = useGuide(); const [open, setOpen] = useState(false);
      useDismiss(open, () => { onClose(); setOpen(false); });
      useGuideOwner({ id: 'studio', scope: 'test', handles: () => true, prepare: () => { setOpen(true); return { target: 'test.menu' }; } });
      return <><button onClick={() => startFlow('studio-vibe')}>Replay</button>{open && <div data-guide="test.menu"><button>Menu option</button></div>}</>;
    }
    mount(<Owner />); fireEvent.click(screen.getByText('Replay')); await screen.findByText('Menu option');
    await screen.findByText('Next'); fireEvent.pointerDown(screen.getByText('Next')); fireEvent.click(screen.getByText('Next'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1); expect(document.querySelector('[data-guide-step]')).not.toBeNull();
  });
  it('hosts the guide inside its dialog and keeps dirty drafts until an explicit dialog action', async () => {
    function Owner() {
      const { startFlow } = useGuide(); const [open, setOpen] = useState(false);
      useGuideOwner({ id: 'studio', scope: 'test', handles: () => true, prepare: () => { setOpen(true); return { target: 'test.dialog', canLeave: () => !document.querySelector('[data-guide-dirty="true"]') }; } });
      return <><button onClick={() => startFlow('studio-vibe')}>Replay</button><Modal guideOwner="test" guideAnchor="test.dialog" guideDraft isOpen={open} onClose={() => setOpen(false)} title="Edit draft"><textarea aria-label="Draft" /><button onClick={() => setOpen(false)}>Cancel draft</button></Modal></>;
    }
    mount(<Owner />); fireEvent.click(screen.getByText('Replay')); await screen.findByRole('dialog');
    await waitFor(() => expect(document.querySelector('[data-guide-overlay-host] [data-guide-step]')).not.toBeNull());
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByText('Next'));
    expect(document.querySelector('[data-guide-step]')?.getAttribute('data-guide-step')).toBe('V1');
    expect(screen.getByLabelText('Draft')).toHaveProperty('value', 'Keep this draft');
    fireEvent.click(screen.getByText('Cancel draft')); fireEvent.click(await screen.findByText('Next')); 
    await waitFor(() => expect(document.querySelector('[data-guide-step]')?.getAttribute('data-guide-step')).toBe('V2'));
  });
  it('keeps guide navigation available when its control disappears inside its dialog', async () => {
    function Owner() {
      const { startFlow } = useGuide(); const [open, setOpen] = useState(false), [available, setAvailable] = useState(true);
      useGuideOwner({ id: 'studio', scope: 'missing-modal-target', handles: () => true, prepare: () => { setOpen(true); return { target: 'test.dialog-control' }; } });
      return <><button onClick={() => startFlow('studio-vibe')}>Start modal guide</button><Modal guideOwner="test" isOpen={open} onClose={() => setOpen(false)} title="Working dialog">
        {available && <button data-guide="test.dialog-control">Control</button>}<button onClick={() => setAvailable(false)}>Remove control</button>
      </Modal></>;
    }
    mount(<Owner />); fireEvent.click(screen.getByText('Start modal guide'));
    await waitFor(() => expect(document.querySelector('[data-guide-overlay-host] [data-guide-step]')).not.toBeNull());
    fireEvent.click(screen.getByText('Remove control'));
    await screen.findByText('This control is not available in the current view.', {}, { timeout: 2200 });
    expect(screen.getByText('Next')).toBeDefined(); expect(screen.getByText('Skip')).toBeDefined();
    expect(document.querySelector('[data-guide-overlay-host] [data-guide-step]')).not.toBeNull();
  });
});

describe('replay and refresh regressions', () => {
  it('keeps legacy completion after refresh and loads remote statuses before deciding to open', async () => {
    localStorage.setItem('guides:guide-test', JSON.stringify(['welcome', 'studio']));
    service.fetch.mockResolvedValue(Response.json({ guides: [] }));
    mount(<span>Current page</span>);
    await waitFor(() => expect(service.fetch).toHaveBeenCalled());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(document.querySelector('[data-guide-step]')).toBeNull();
    expect(JSON.parse(localStorage.getItem('guides:guide-test')!)).toContain('guide:studio:1:c');
  });
  it('does not reopen the first automatically shown guide on a fresh provider mount', async () => {
    service.fetch.mockImplementation(async (_path, options) => Response.json({ guides: options?.method === 'POST' ? JSON.parse(options.body).guides : [] }));
    const first = mount(<span>Page</span>);
    await screen.findByText('Your account');
    expect(JSON.parse(localStorage.getItem('guides:guide-test')!)).toContain('guide:welcome:2:d');
    first.unmount();
    mount(<span>Page</span>);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(document.querySelector('[data-guide-step]')?.getAttribute('data-guide-step')).not.toMatch(/^A/);
  });
  it('shows the signed-out introduction once even when refreshed before dismissal', async () => {
    service.accountId = null;
    const first = mount(<span>Page</span>);
    await screen.findByText('Your account');
    expect(localStorage.getItem('rawchunks:connect-guide-dismissed')).toBe('1');
    first.unmount(); mount(<span>Page</span>);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(document.querySelector('[data-guide-step]')).toBeNull();
  });
  it('re-enters the same active walkthrough and keeps Next for an unavailable target', async () => {
    const prepare = vi.fn(() => ({ target: 'test.replay' }));
    function Owner() {
      const { startFlow } = useGuide();
      useGuideOwner({ id: 'studio', scope: 'replay', handles: () => true, prepare });
      return <><button onClick={() => startFlow('studio-vibe')}>Replay same</button><div data-guide="test.replay">Control</div></>;
    }
    mount(<Owner />); fireEvent.click(screen.getByText('Replay same'));
    await screen.findByText('Next'); fireEvent.click(screen.getByText('Replay same'));
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    (document.querySelector('[data-guide="test.replay"]') as HTMLElement).hidden = true;
    await screen.findByText('This control is not available in the current view.', {}, { timeout: 2200 });
    expect(screen.getByText('Next')).toBeDefined(); expect(screen.queryByText('Skip step')).toBeNull();
  });
  it('keeps Skip separate from Next, closes its views and remembers dismissal after remount', async () => {
    localStorage.setItem('guides:guide-test', JSON.stringify(['welcome']));
    service.fetch.mockImplementation(async () => Response.json({ guides: [] }));
    const submit = vi.fn();
    function Owner() {
      const { startFlow } = useGuide(); const [open, setOpen] = useState(false);
      useGuideOwner({ id: 'studio', scope: 'skip', handles: () => true, prepare: () => {
        setOpen(true); return { target: 'test.skip-view', leave: () => setOpen(false) };
      } });
      return <><button onClick={() => startFlow('studio')}>Start guide</button>{open && <div data-guide="test.skip-view"><button onClick={submit}>Product action</button></div>}</>;
    }
    const first = mount(<Owner />);
    act(() => screen.getByRole('button', { name: 'Start guide' }).focus());
    fireEvent.click(screen.getByRole('button', { name: 'Start guide' }));
    await screen.findByRole('button', { name: 'Skip', exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() => expect(document.querySelector('[data-guide-step]')?.getAttribute('data-guide-step')).toBe('S2'));
    await screen.findByRole('button', { name: 'Product action' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip', exact: true }));
    expect(document.querySelector('[data-guide-step]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Product action' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start guide' }));
    expect(JSON.parse(localStorage.getItem('guides:guide-test')!)).toContain('guide:studio:2:d');
    expect(submit).not.toHaveBeenCalled();
    await waitFor(() => expect(service.fetch.mock.calls.some(([url, options]) => url === '/api/user/guides' && options?.method === 'POST' && JSON.parse(options.body).guides.includes('guide:studio:2:d'))).toBe(true));
    first.unmount(); mount(<Owner />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(document.querySelector('[data-guide-step]')).toBeNull();
  });
  it('keeps Skip available beside Done on the final step', async () => {
    function Owner() {
      const { startFlow } = useGuide();
      return <button onClick={() => startFlow('studio-vibe', { initialStep: GUIDE_FLOWS['studio-vibe'].steps.length - 1 })}>Start final step</button>;
    }
    mount(<Owner />); fireEvent.click(screen.getByRole('button', { name: 'Start final step' }));
    await screen.findByRole('button', { name: 'Done', exact: true });
    expect(screen.getByRole('button', { name: 'Skip', exact: true })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Next', exact: true })).toBeNull();
  });
  it('cancels an entry when its route changes and does not prepare a late owner', async () => {
    const leave = vi.fn(), prepare = vi.fn(() => ({ target: 'test.route', leave }));
    function Owner() { const { startFlow } = useGuide(); useGuideOwner({ id:'studio', scope:'route', handles:()=>true, prepare }); return <><button onClick={()=>startFlow('studio-vibe')}>Start</button><textarea data-guide="test.route" /></>; }
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const tree=(page:'studio'|'market')=><QueryClientProvider client={client}><GuideProvider activePage={page}><Owner/></GuideProvider></QueryClientProvider>;
    const view=render(tree('studio')); fireEvent.click(screen.getByText('Start')); await screen.findByText('Next');
    view.rerender(tree('market')); await waitFor(()=>expect(document.querySelector('[data-guide-step]')).toBeNull());
    expect(leave).toHaveBeenCalledTimes(1);
  });
  it('retains all cleanup leases across a prerequisite retry', () => {
    const registry=new GuideRegistry(); let ready=false; const firstLeave=vi.fn(), secondLeave=vi.fn();
    const prepare=vi.fn(()=>ready?{leave:secondLeave}:{retry:()=>ready,leave:firstLeave});
    registry.register({id:'studio',scope:'retry',handles:()=>true,prepare});
    const entry=registry.enter(GUIDE_STEPS.S4,new Map(),()=>{}); ready=true; registry.notify(); registry.notify();
    expect(prepare).toHaveBeenCalledTimes(2); entry.leave(); expect(firstLeave).toHaveBeenCalledTimes(1);expect(secondLeave).toHaveBeenCalledTimes(1);
  });
});


describe('real instrument owners', () => {
  const initial = useDawStore.getInitialState();
  afterEach(() => useDawStore.setState(initial, true));
  it.each([['keys', 'editor-keys', 'J1'], ['drums', 'editor-drums', 'D1']] as const)('opens %s without auditioning, creating a lane or changing its pattern', async (kind, flow, step) => {
    const lane = { id: kind, name: kind, type: kind === 'keys' ? 'pianoroll' : 'sequencer', clips: [], muted: false, volume: .7, pan: 0,
      pianoRollNotes: [], sequencerVoices: [{ name: 'KICK', steps: Array(16).fill(false), velocity: Array(16).fill(.8), muted: false }] } as DAWTrack;
    useDawStore.setState({ ...initial, songId: 'guide-test', tracks: [lane], selectedTrackId: lane.id });
    const audition = vi.spyOn(dawEngine, kind === 'keys' ? 'playNote' : 'triggerDrum').mockImplementation(() => {});
    const original = JSON.stringify(useDawStore.getState().tracks);
    function Fixture() { const { startFlow } = useGuide(); return <><button onClick={() => startFlow(flow)}>Open instrument guide</button>{kind === 'keys' ? <Keys track={lane} /> : <Drums track={lane} />}</>; }
    mount(<Fixture />, 'editor'); fireEvent.click(screen.getByText('Open instrument guide'));
    await waitFor(() => expect(document.querySelector('[data-guide-step]')?.getAttribute('data-guide-step')).toBe(step));
    await waitFor(() => expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull());
    await waitFor(() => expect(document.activeElement?.closest(kind === 'keys' ? '[data-guide="keys.note-grid"]' : '[data-guide="drums.steps"]')).not.toBeNull());
    fireEvent.click(screen.getByText('Next')); await screen.findByText('Next'); fireEvent.click(screen.getByLabelText('Close guide'));
    expect(JSON.stringify(useDawStore.getState().tracks)).toBe(original); expect(audition).not.toHaveBeenCalled();
  });
  it('keeps the real drum matrix open and focuses PAD REC on its recording step', async () => {
    const lane = { id: 'drum-pad-test', name: 'Drums', type: 'sequencer', clips: [], muted: false, volume: .7, pan: 0,
      sequencerVoices: [{ name: 'KICK', steps: Array(16).fill(false), velocity: Array(16).fill(.8), muted: false }] } as DAWTrack;
    useDawStore.setState({ ...initial, songId: 'guide-test', tracks: [lane], selectedTrackId: lane.id });
    const audition = vi.spyOn(dawEngine, 'triggerDrum').mockImplementation(() => {});
    const original = JSON.stringify(useDawStore.getState().tracks);
    function Fixture() { const { startFlow } = useGuide(); return <><button onClick={() => startFlow('editor-drums')}>Open pads guide</button><Drums track={lane} /></>; }
    mount(<Fixture />, 'editor'); fireEvent.click(screen.getByText('Open pads guide'));
    await screen.findByRole('dialog');
    fireEvent.click(await screen.findByText('Next')); fireEvent.click(await screen.findByText('Next'));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-guide')).toBe('drums.pad-record'));
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
    expect(JSON.stringify(useDawStore.getState().tracks)).toBe(original); expect(audition).not.toHaveBeenCalled();
  });
  it('retries the sample guide after local decoding without previewing or importing', async () => {
    useDawStore.setState({ ...initial, songId: 'guide-test' });
    vi.spyOn(dawEngine, 'stopAuditionTake').mockImplementation(() => {});
    const audition = vi.spyOn(dawEngine, 'auditionTake').mockImplementation(() => {});
    vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:guide-sample'; } static revokeObjectURL() {} });
    vi.spyOn(audioPeaks, 'decodeAudioFile').mockResolvedValue({ duration: 4, numberOfChannels: 1, length: 32, sampleRate: 8, getChannelData: () => new Float32Array(32) } as AudioBuffer);
    function Fixture() { const { startFlow } = useGuide(); return <><button onClick={() => startFlow('editor-samples', { initialStep: 1 })}>Open sample guide</button><Sampler /></>; }
    mount(<Fixture />, 'editor'); fireEvent.click(screen.getByText('Open sample guide'));
    await screen.findByText('Add audio before choosing a slice or importing it.');
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['synthetic audio'], 'fixture.wav', { type: 'audio/wav' })] } });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-guide')).toBe('sample.slices'));
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-guide')).toBe('sample.import'));
    expect(useDawStore.getState().tracks).toHaveLength(0); expect(audition).not.toHaveBeenCalled();
    expect(service.fetch.mock.calls.every(([url]) => url.includes('/api/user/guides'))).toBe(true);
  });
});
