// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({time:0,funded:true,update:(_:number)=>{},end:()=>{},fetch:vi.fn(),billing:{source:'usdc',token:'key-a' as string|null,account:'listener-a',network:'eip155:84532',walletToken:'wallet-a'}}));
vi.mock('@/lib/audio',()=>({audio:{load:vi.fn(()=>{f.time=0;}),play:vi.fn(),pause:vi.fn(),seek:vi.fn((t:number)=>{f.time=t;f.update(t);}),reset:vi.fn(),stopImmediate:vi.fn(),preloadNext:vi.fn(),hasSource:()=>true,position:()=>f.time,setOnTimeUpdate:(cb:any)=>{f.update=cb;},setOnDuration:vi.fn(),setOnEnd:(cb:any)=>{f.end=cb;}}}));
vi.mock('@/lib/api',()=>({api:{fetch:f.fetch},hasStreamBudget:()=>f.funded,hasPromoCreditsOnly:()=>false,captureStreamBilling:()=>[{...f.billing}],streamOptions:(b:any)=>({key:b.token,network:b.network,userAddress:b.account,headers:{authorization:`Bearer ${b.token}`}})}));
vi.mock('@/lib/compose',()=>({compose:{fetch:f.fetch,keys:{currentToken:()=>f.billing.token},wallets:{current:()=>({address:f.billing.account})}}}));
vi.mock('@/lib/gate',()=>({openGate:vi.fn(async()=>false)}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn()}}));
import {store} from '@/lib/store';import {audio} from '@/lib/audio';
const song={id:'song-a',title:'A',creator:'creator',url:'https://cdn.test/a.wav',duration:180,stream_price:.03,public:true} as any;
const requests=()=>f.fetch.mock.calls.filter(c=>String(c[0]).endsWith('/checkpoint'));
const body=(c:any[])=>JSON.parse(c[1].body);
const receipt=(b:any)=>Response.json({success:true,result:{acceptedListenedSeconds:b.listenedSeconds,billedWei:String(Math.floor(b.listenedSeconds*500)),deltaWei:'0',status:'confirmed'}});
function onceCheckpoint(run:(b:any)=>Promise<Response>){const original=f.fetch.getMockImplementation()!;f.fetch.mockImplementation((path:string,init:any)=>{if(path.endsWith('/checkpoint')){f.fetch.mockImplementation(original);return run(JSON.parse(init.body));}return original(path,init);});}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}
function advance(t:number){f.time=t;f.update(t);}
beforeEach(async()=>{store.clearUserWorkspace();await settle();vi.useFakeTimers();vi.clearAllMocks();localStorage.clear();f.time=0;f.funded=true;f.billing={source:'usdc',token:'key-a',account:'listener-a',network:'eip155:84532',walletToken:'wallet-a'};f.fetch.mockImplementation(async(p:string,i:any)=>p.endsWith('/checkpoint')?receipt(JSON.parse(i.body)):Response.json({paymentIntentId:'intent-a',url:song.url}));window.dispatchEvent(new Event('online'));await settle();f.fetch.mockClear();store.setUserAddress('listener-a');store.setActiveSong(song);});
afterEach(async()=>{store.clearUserWorkspace();await settle();vi.clearAllTimers();vi.useRealTimers();});
it('starts funded CDN audio before a pending payment request resolves',async()=>{let resolve!:(r:Response)=>void;f.fetch.mockImplementationOnce(()=>new Promise<Response>(r=>{resolve=r;}));const started=store.setPlaying(true);expect(audio.play).toHaveBeenCalled();expect(await started).toBe(true);resolve(Response.json({paymentIntentId:'intent-a'}));await settle();});
it('bills zero for waiting, loading and buffering with a stationary media playhead',async()=>{await store.setPlaying(true);await settle();vi.setSystemTime(Date.now()+120000);advance(0);store.setActiveSong(null);await settle();expect(requests().map(body)).toEqual([expect.objectContaining({listenedSeconds:0,terminal:true})]);});
it('bills the 2.003 seconds actually played before switching songs',async()=>{await store.setPlaying(true);await settle();advance(2.003);store.setActiveSong({...song,id:'song-b'});await settle();expect(body(requests()[0])).toMatchObject({listenedSeconds:2.003,terminal:true});});
it('captures a fractional media tail at pause and excludes seek jumps',async()=>{await store.setPlaying(true);await settle();advance(2);store.setPlayhead(12);advance(13);f.time=13.125;await store.setPlaying(false);await settle();expect(body(requests()[0]).listenedSeconds).toBe(3.125);});
it('keeps heard usage bound to the outgoing song while its admission is pending',async()=>{let resolve!:(r:Response)=>void;f.fetch.mockImplementationOnce(()=>new Promise<Response>(r=>{resolve=r;}));await store.setPlaying(true);advance(2);store.setActiveSong({...song,id:'song-b'});resolve(Response.json({paymentIntentId:'intent-a',url:song.url}));await settle();expect(requests()[0][0]).toBe('/api/songs/song-a/stream/checkpoint');expect(body(requests()[0])).toMatchObject({listenedSeconds:2,terminal:true});});
it('serializes a report followed by a fractional terminal tail',async()=>{await store.setPlaying(true);await settle();let resolve!:(r:Response)=>void;onceCheckpoint(()=>new Promise<Response>(r=>{resolve=r;}));advance(20);advance(20.125);store.setActiveSong(null);await settle();expect(requests()).toHaveLength(1);resolve(receipt({listenedSeconds:20}));await settle();expect(requests().map(body)).toEqual([expect.objectContaining({listenedSeconds:20,terminal:false}),expect.objectContaining({listenedSeconds:20.125,terminal:true})]);});
it('retries the same failed obligation and preserves audio played offline',async()=>{await store.setPlaying(true);await settle();onceCheckpoint(async()=>{throw Error('Offline');});advance(20);await settle();advance(21.125);store.setActiveSong(null);await settle();await vi.advanceTimersByTimeAsync(1000);await settle();const r=requests().map(body);expect(r[1]).toEqual(r[0]);expect(r.at(-1)).toMatchObject({listenedSeconds:21.125,terminal:true});});
it('flushes page-exit usage and retains it until acknowledgment',async()=>{await store.setPlaying(true);await settle();advance(2.003);f.fetch.mockRejectedValue(Error('Offline'));window.dispatchEvent(new Event('pagehide'));await settle();expect(requests().map(body)).toContainEqual(expect.objectContaining({listenedSeconds:2.003,terminal:true}));const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k?.startsWith('rawchunks:stream:'));expect(keys).toHaveLength(1);expect(JSON.parse(localStorage.getItem(keys[0]!)!).observedMs).toBe(2003);});
it('preserves the admitted credential on account change',async()=>{await store.setPlaying(true);await settle();advance(2);f.billing={...f.billing,account:'listener-b',token:'key-b',network:'eip155:8453'};store.setUserAddress('listener-b');await settle();expect(requests()[0][1]).toMatchObject({key:'key-a',network:'eip155:84532',userAddress:'listener-a'});});
it('does not acknowledge HTTP 200 success:false',async()=>{await store.setPlaying(true);await settle();onceCheckpoint(async()=>Response.json({success:false,result:null}));advance(20);await settle();await vi.advanceTimersByTimeAsync(1000);await settle();expect(requests()).toHaveLength(2);expect(requests().map(body)[1]).toEqual(requests().map(body)[0]);});

it('retains fractional usage across pause and resume without counting paused time', async () => {
  await store.setPlaying(true); await settle(); advance(2.003);
  await store.setPlaying(false); await settle(); vi.setSystemTime(Date.now() + 60000);
  await store.setPlaying(true); advance(3.128); store.setActiveSong(null); await settle();
  expect(requests().map(body)).toEqual([
    expect.objectContaining({ listenedSeconds: 2.003, terminal: false }),
    expect.objectContaining({ listenedSeconds: 3.128, terminal: true }),
  ]);
});
it('settles the outgoing repeat and starts a new playback at zero usage', async () => {
  await store.setPlaying(true); await settle(); advance(2.003); store.setRepeatMode('one');
  f.end(); await settle(); advance(1.125); store.setActiveSong(null); await settle();
  expect(requests().map(body)).toEqual([
    expect.objectContaining({ listenedSeconds: 2.003, terminal: true }),
    expect.objectContaining({ listenedSeconds: 1.125, terminal: true }),
  ]);
  const admissions = f.fetch.mock.calls.filter(c => String(c[0]).endsWith('/stream'));
  expect(admissions).toHaveLength(2);
  expect(admissions[1][1].headers['x-idempotency-key']).not.toBe(admissions[0][1].headers['x-idempotency-key']);
});
it('keeps a logout settlement on the captured credential', async () => {
  await store.setPlaying(true); await settle(); advance(2.003); store.clearUserWorkspace(); await settle();
  expect(body(requests()[0])).toMatchObject({ listenedSeconds: 2.003, terminal: true });
  expect(requests()[0][1].key).toBe('key-a');
});
it('does not retry forever when actual media progress exceeds the admitted duration', async () => {
  store.setActiveSong({ ...song, duration: 2 }); await store.setPlaying(true); await settle();
  onceCheckpoint(async b => receipt({ ...b, listenedSeconds: Math.min(b.listenedSeconds, 2) }));
  advance(2.003); store.setActiveSong(null); await settle();
  expect(body(requests()[0])).toMatchObject({ listenedSeconds: 2, terminal: true });
  expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k => k?.startsWith('rawchunks:stream:'))).toHaveLength(0);
});

it('continues reporting after an online event with no unacknowledged usage', async () => {
  await store.setPlaying(true); await settle(); window.dispatchEvent(new Event('online')); await settle();
  advance(20); await settle(); expect(requests()).toHaveLength(1); expect(body(requests()[0]).listenedSeconds).toBe(20);
});

it.each([
  ['eip155:84532', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
  ['eip155:42431', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
  ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'eip155:84532'],
  ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'eip155:42431'],
])('keeps a %s payment session through songs minted on %s', async (network, mintedOn) => {
  f.billing = { ...f.billing, network };
  store.setActiveSong({ ...song, network: mintedOn });
  await store.setPlaying(true); await settle(); advance(20); await settle();
  advance(40); await settle(); advance(40.125);
  store.setActiveSong({ ...song, id: 'song-b', network: mintedOn }); await settle();
  await store.setPlaying(true); await settle(); advance(2.003);
  store.setActiveSong(null); await settle();
  expect(requests().map(body)).toEqual([
    expect.objectContaining({ listenedSeconds: 20, terminal: false }),
    expect.objectContaining({ listenedSeconds: 40, terminal: false }),
    expect.objectContaining({ listenedSeconds: 40.125, terminal: true }),
    expect.objectContaining({ listenedSeconds: 2.003, terminal: true }),
  ]);
  for (const request of f.fetch.mock.calls.filter(c => /\/stream(?:\/checkpoint)?$/.test(String(c[0])))) expect(request[1]).toMatchObject({ network, key: 'key-a', userAddress: 'listener-a' });
});

it('pauses audio when the creator has no payout on the payment network', async () => {
  f.fetch.mockResolvedValueOnce(Response.json({ error: 'Creator payout unavailable' }, { status: 409 }));
  await store.setPlaying(true); advance(2.003); await settle();
  expect(audio.pause).toHaveBeenCalled();
  expect(store.getState().isPlaying).toBe(false);
  expect(requests()).toHaveLength(0);
  const key = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).find(k => k?.startsWith('rawchunks:stream:'))!;
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ observedMs: 2003, acceptedMs: 0, rejected: true });
});

it('pauses on a rejected settlement and retains the unpaid checkpoint', async () => {
  await store.setPlaying(true); await settle();
  onceCheckpoint(async () => Response.json({ error: 'Recipient is invalid' }, { status: 422 }));
  advance(20); await settle();
  expect(audio.pause).toHaveBeenCalled();
  expect(store.getState().isPlaying).toBe(false);
  const key = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).find(k => k?.startsWith('rawchunks:stream:'))!;
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ acceptedMs: 0, rejected: true, pending: { listenedSeconds: 20 } });
});

it('drains an in-flight checkpoint and its fractional tail before session closure completes', async () => {
  f.billing.token = 'closing-key';
  await store.setPlaying(true); await settle();
  let accept!: (response: Response) => void;
  onceCheckpoint(() => new Promise<Response>(resolve => { accept = resolve; }));
  advance(20); advance(20.125);
  let done = false;
  const closing = store.closeSessionPlayback('closing-key').then(value => { done = value; return value; });
  expect(store.getState().isPlaying).toBe(false);
  expect(audio.pause).toHaveBeenCalled();
  await settle(); expect(done).toBe(false); expect(requests()).toHaveLength(1);
  accept(receipt({ listenedSeconds: 20 })); await settle();
  expect(await closing).toBe(true);
  expect(requests().map(body)).toEqual([
    expect.objectContaining({ listenedSeconds: 20, terminal: false }),
    expect.objectContaining({ listenedSeconds: 20.125, terminal: true }),
  ]);
});

it('keeps Card Credit playback and its admitted reservation when a USDC session is disconnected', async () => {
  f.billing.source = 'card'; f.billing.token = 'card-session';
  await store.setPlaying(true); await settle(); advance(2.003);
  expect(await store.closeSessionPlayback('card-session')).toBe(true);
  expect(store.getState().isPlaying).toBe(true);
  f.billing.token = null; f.funded = false;
  await store.setPlaying(false); await settle();
  expect(await store.setPlaying(true)).toBe(true);
  advance(3.128); store.setActiveSong(null); await settle();
  expect(requests().map(body)).toEqual([
    expect.objectContaining({ listenedSeconds: 2.003, terminal: false }),
    expect.objectContaining({ listenedSeconds: 3.128, terminal: true }),
  ]);
});

it('does not stop a newer payment session while an old session is being drained', async () => {
  f.billing.token = 'old-session';
  await store.setPlaying(true); await settle(); advance(2.003);
  store.setActiveSong({ ...song, id: 'song-b' }); await settle();
  f.billing.token = 'key-b';
  await store.setPlaying(true); await settle();
  vi.mocked(audio.pause).mockClear();
  expect(await store.closeSessionPlayback('old-session')).toBe(true);
  expect(store.getState().isPlaying).toBe(true);
  expect(audio.pause).not.toHaveBeenCalled();
});

it('allows creator playback after a USDC session disconnects', async () => {
  f.billing.token = 'creator-session';
  store.setUserAddress(song.creator); await store.setPlaying(true);
  f.billing.token = null; f.funded = false;
  expect(await store.closeSessionPlayback('creator-session')).toBe(true);
  expect(store.getState().isPlaying).toBe(true);
  await store.setPlaying(false);
  expect(await store.setPlaying(true)).toBe(true);
  expect(requests()).toHaveLength(0);
});

it('replays persisted audible usage after reload without charging elapsed offline time', async () => {
  await store.setPlaying(true); await settle(); advance(2.003);
  f.fetch.mockRejectedValue(Error('Offline')); store.setActiveSong(null); await settle();
  vi.setSystemTime(Date.now() + 120000);
  f.fetch.mockImplementation(async (path: string, init: any) => path.endsWith('/checkpoint') ? receipt(JSON.parse(init.body)) : Response.json({ paymentIntentId: 'intent-a' }));
  f.fetch.mockClear(); vi.resetModules(); await import('@/lib/store'); await settle();
  expect(requests().map(body)).toEqual([expect.objectContaining({ listenedSeconds: 2.003, terminal: true })]);
  expect(requests()[0][1].key).toBe('key-a');
  expect(Array.from({length:localStorage.length}, (_,i)=>localStorage.key(i)).filter(k=>k?.startsWith('rawchunks:stream:'))).toHaveLength(0);
});
