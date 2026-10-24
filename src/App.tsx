import React, { useState, useEffect } from 'react';
import { Layout, Route } from './components/Layout';
import { Studio } from './pages/studio';
import { Mypage } from './pages/mypage';
import { Market } from './pages/market';
import { Editor } from './pages/editor';
import { store } from './lib/store';
import { Song } from './lib/schema';
import { sdk } from './lib/sdk';
import { useSelectedUserAddress } from './hooks/use-address';
import { useSongs } from './hooks/use-songs';
import { readProject, writeProject, readCachedAccount } from './lib/cache';
import { parseRoute, editorId, editorPath } from './lib/routes';
import { GuideProvider } from './components/guide/Tour';
import './styles/styles.css';

export const App: React.FC = () => {
  useSongs();
  const { readAddress, isReconnecting } = useSelectedUserAddress();
  const [editorError, setEditorError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [songId, setSongId] = useState(() => editorId(window.location.pathname));
  const [editingSong, setEditingSong] = useState<Song | null>(() => {
    const songId = editorId(window.location.pathname);
    if (!songId) return null;
    const account = readCachedAccount();
    const address = account?.network.startsWith('solana:') ? account.svmAddress : account?.address;
    const cached = songId && address ? readProject(songId, address) : null;
    if (cached) return cached.song;
    const fromStore = store.getState().editingSong;
    if (fromStore?.id === songId) return fromStore;
    try {
      const saved = sessionStorage.getItem('rawchunks_editing_song');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.id === songId) return parsed;
      }
    } catch { }
    return null;
  });

  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseRoute(window.location.pathname));
      const id = editorId(window.location.pathname);
      setSongId(id);
      setEditorError(null);
      setEditingSong(current => current?.id === id ? current : id && readAddress ? readProject(id, readAddress)?.song ?? null : null);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [readAddress]);

  useEffect(() => {
    if (route === 'editor' && editingSong && editingSong.id !== songId) {
      setSongId(editingSong.id);
      window.history.replaceState(null, '', editorPath(editingSong.id));
    }
  }, [route, editingSong, songId]);

  useEffect(() => {
    if (route === 'editor' && !editingSong) {
      if (!songId) {
        setEditorError('Choose a song from My Page to open the editor');
        return;
      }
      if (!readAddress) {
        if (!isReconnecting) setEditorError('Connect the creator wallet to open this song');
        return;
      }
      let mounted = true;
      setEditorError(null);
      const loadTargetSong = async () => {
        try {
          const response = await sdk.fetch(`/api/songs/${encodeURIComponent(songId)}`, { userAddress: readAddress });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Could not open this song');
          if (!mounted) return;
          const target = Array.isArray(data) ? data[0] : (data?.song || data);
          if (target && target.id) {
            setEditingSong(target);
            store.setEditingSong(target);
            try { sessionStorage.setItem('rawchunks_editing_song', JSON.stringify(target)); } catch { }
            if (Array.isArray(data?.stems) && Array.isArray(data?.takes)) {
              writeProject({ song: target, stems: data.stems, takes: data.takes, commits: [] }, readAddress);
            }
          } else {
            setEditorError('Song not found');
          }
        } catch (error: any) {
          if (mounted) setEditorError(error?.message || 'Could not open this song');
        }
      };

      loadTargetSong();
      return () => { mounted = false; };
    }
  }, [route, editingSong, readAddress, isReconnecting, songId]);

  useEffect(() => {
    if (route !== 'editor' || !editingSong?.metadata_cid || !readAddress) return;
    let current = true;
    setEditorError(null);
    sdk.fetch(`/api/songs/${encodeURIComponent(editingSong.id)}/version`, { method: 'POST', userAddress: readAddress })
      .then(async response => {
        const song = await response.json();
        if (!response.ok) throw new Error(song.error || 'Could not open a song version');
        if (!current) return;
        setEditingSong(song);
        store.setEditingSong(song);
        if (!store.getState().songs.some(item => item.id === song.id)) store.addSong(song);
        sessionStorage.setItem('rawchunks_editing_song', JSON.stringify(song));
        setSongId(song.id);
        window.history.replaceState(null, '', editorPath(song.id));
      })
      .catch(error => { if (current) setEditorError(error.message); });
    return () => { current = false; };
  }, [route, editingSong, readAddress]);

  const navigate = (nextRoute: Route, id?: string) => {
    setRoute(nextRoute);
    const path = nextRoute === 'mypage' ? 'my-page' : nextRoute;
    window.history.pushState(null, '', nextRoute === 'editor' && id ? editorPath(id) : `/${path}`);
  };

  const handleEditSong = (song: Song) => {
    setSongId(song.id);
    setEditingSong(song);
    store.setEditingSong(song);
    try {
      sessionStorage.setItem('rawchunks_editing_song', JSON.stringify(song));
    } catch { }
    navigate('editor', song.id);
  };

  const handleBackFromEditor = () => {
    setEditingSong(null);
    store.setEditingSong(null);
    try {
      sessionStorage.removeItem('rawchunks_editing_song');
    } catch { }
    navigate('mypage');
  };

  return (
    <GuideProvider activePage={route}>
      <Layout current={route} onNavigate={navigate}>
        {route === 'studio' && <Studio onEditSong={handleEditSong} />}
        {route === 'mypage' && <Mypage onEditSong={handleEditSong} />}
        {route === 'market' && <Market />}
        {route === 'editor' && editingSong && !editingSong.metadata_cid && (
          <Editor song={editingSong} onBack={handleBackFromEditor} />
        )}
        {route === 'editor' && (!editingSong || editingSong.metadata_cid) && (
          <div className="editor-status-screen">
            {editorError ?? 'Opening song…'}
          </div>
        )}
      </Layout>
    </GuideProvider>
  );
};
