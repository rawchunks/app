import React, { useState, useEffect, useRef } from 'react';
import { Layout, Route } from './components/Layout';
import { Studio } from './pages/studio';
import { Mypage } from './pages/mypage';
import { Market } from './pages/market';
import { Editor } from './pages/editor';
import { Video } from './pages/video';
import { SongPage } from './pages/song';
import { store } from './lib/store';
import { bus } from './lib/bus';
import { Song } from './lib/schema';
import { api } from './lib/api';
import { useSelectedUserAddress } from './hooks/use-address';
import { useSongs } from './hooks/use-songs';
import { useChain } from './contexts/Network';
import { getModeNetworks } from './lib/chains';
import { readProject, readSongs, writeProject } from './lib/cache';
import {
  parseRoute,
  editorId,
  editorPath,
  videoId,
  videoPath,
  marketCreator,
  marketSong,
  navigateToCreator,
} from './lib/routes';
import { GuideProvider } from './components/guide/Tour';
import './styles/styles.css';
import './styles/video.css';

function readCachedSong(id: string | null, readAddress?: string | null): Song | null {
  if (!id) return null;
  if (readAddress) {
    const project = readProject(id, readAddress);
    if (project?.song) return project.song;
    const mySongs = readSongs(readAddress);
    const hit = mySongs?.find((s) => s.id === id);
    if (hit) return hit;
  }
  const fromStore = store.getState().songs.find((s) => s.id === id);
  if (fromStore) return fromStore;
  if (store.getState().editingSong?.id === id) return store.getState().editingSong;
  try {
    const saved = sessionStorage.getItem('rawchunks_video_song') || sessionStorage.getItem('rawchunks_editing_song');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id === id) return parsed;
    }
  } catch { }
  return null;
}

export const App: React.FC = () => {
  useSongs();
  const { selectedNetwork, setSelectedNetwork } = useChain();
  const { readAddress, accountId, isReconnecting } = useSelectedUserAddress();

  useEffect(() => {
    const allowed = getModeNetworks();
    if (!allowed.includes(selectedNetwork)) {
      setSelectedNetwork(allowed[0]);
    }
  }, [selectedNetwork, setSelectedNetwork]);

  const [editorError, setEditorError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  const readSongTarget = (pathname: string): { creator: string; slug: string } | null => {
    const creator = marketCreator(pathname);
    const slug = marketSong(pathname);
    return creator && slug ? { creator, slug } : null;
  };

  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [songId, setSongId] = useState(() => editorId(window.location.pathname));
  const [videoSongId, setVideoSongId] = useState(() => videoId(window.location.pathname));
  const [viewSong, setViewSong] = useState(() => readSongTarget(window.location.pathname));

  const [editingSong, setEditingSong] = useState<Song | null>(() => {
    const id = editorId(window.location.pathname);
    return readCachedSong(id, readAddress);
  });

  const [videoSong, setVideoSong] = useState<Song | null>(() => {
    const id = videoId(window.location.pathname);
    return readCachedSong(id, readAddress);
  });

  const prevAccountIdRef = useRef<string | null>(accountId);

  useEffect(() => {
    const prev = prevAccountIdRef.current;
    if (prev && ((!accountId && !isReconnecting) || (accountId && prev !== accountId))) {
      setEditingSong(null);
      setEditorError(null);
      setVideoSong(null);
      setVideoError(null);
      if (route === 'editor' || route === 'video') {
        setRoute('studio');
        setSongId(null);
        setVideoSongId(null);
        window.history.replaceState(null, '', '/studio');
      }
    }
    prevAccountIdRef.current = accountId;
  }, [accountId, isReconnecting, route]);

  useEffect(() => {
    const exitWorkstations = () => {
      setEditingSong(null);
      setEditorError(null);
      setVideoSong(null);
      setVideoError(null);
      setRoute((current) => {
        if (current === 'editor' || current === 'video') {
          setSongId(null);
          setVideoSongId(null);
          window.history.replaceState(null, '', '/studio');
          return 'studio';
        }
        return current;
      });
    };
    const unsubLogout = bus.onRemoteLogout(exitWorkstations);
    const unsubSwitch = bus.onRemoteAccountSwitch(exitWorkstations);
    return () => {
      unsubLogout();
      unsubSwitch();
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const next = parseRoute(window.location.pathname);
      setRoute(next);
      const edId = editorId(window.location.pathname);
      const vidId = videoId(window.location.pathname);
      setSongId(edId);
      setVideoSongId(vidId);
      setViewSong(readSongTarget(window.location.pathname));
      setEditorError(null);
      setVideoError(null);
      setEditingSong((current) => (current?.id === edId ? current : readCachedSong(edId, readAddress)));
      setVideoSong((current) => (current?.id === vidId ? current : readCachedSong(vidId, readAddress)));
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
    if (route === 'video' && videoSong && videoSong.id !== videoSongId) {
      setVideoSongId(videoSong.id);
      window.history.replaceState(null, '', videoPath(videoSong.id));
    }
  }, [route, videoSong, videoSongId]);

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
          const response = await api.fetch(`/api/songs/${encodeURIComponent(songId)}`, { userAddress: readAddress });
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
    if (route === 'video' && !videoSong) {
      if (!videoSongId) {
        setVideoError('Choose a song from Workspace to open Video Studio');
        return;
      }
      if (!readAddress) {
        if (!isReconnecting) setVideoError('Connect the creator wallet to direct this video');
        return;
      }
      let mounted = true;
      setVideoError(null);
      const loadVideoTarget = async () => {
        try {
          const response = await api.fetch(`/api/songs/${encodeURIComponent(videoSongId)}`, { userAddress: readAddress });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Could not open this song');
          if (!mounted) return;
          const target = Array.isArray(data) ? data[0] : (data?.song || data);
          if (target && target.id) {
            setVideoSong(target);
            try { sessionStorage.setItem('rawchunks_video_song', JSON.stringify(target)); } catch { }
          } else {
            setVideoError('Song not found');
          }
        } catch (error: any) {
          if (mounted) setVideoError(error?.message || 'Could not open this song');
        }
      };
      loadVideoTarget();
      return () => { mounted = false; };
    }
  }, [route, videoSong, readAddress, isReconnecting, videoSongId]);

  useEffect(() => {
    if (route !== 'editor' || !editingSong?.metadata_cid || !readAddress) return;
    let current = true;
    setEditorError(null);
    api.fetch(`/api/songs/${encodeURIComponent(editingSong.id)}/version`, { method: 'POST', userAddress: readAddress })
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
    const url =
      nextRoute === 'editor' && id
        ? editorPath(id)
        : nextRoute === 'video' && id
          ? videoPath(id)
          : `/${path}`;
    window.history.pushState(null, '', url);
    if (nextRoute === 'market') {
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
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

  const handleDirectVideo = (song: Song) => {
    setVideoSongId(song.id);
    setVideoSong(song);
    try {
      sessionStorage.setItem('rawchunks_video_song', JSON.stringify(song));
    } catch { }
    navigate('video', song.id);
  };

  const handleBackFromEditor = () => {
    setEditingSong(null);
    store.setEditingSong(null);
    try {
      sessionStorage.removeItem('rawchunks_editing_song');
    } catch { }
    navigate('mypage');
  };

  const handleBackFromVideo = () => {
    setVideoSong(null);
    setVideoSongId(null);
    try {
      sessionStorage.removeItem('rawchunks_video_song');
    } catch { }
    navigate('mypage');
  };

  return (
    <GuideProvider activePage={route === 'song' ? 'market' : route === 'video' ? 'editor' : route}>
      <Layout current={route} onNavigate={navigate}>
        {route === 'studio' && <Studio onEditSong={handleEditSong} />}
        {route === 'mypage' && <Mypage onEditSong={handleEditSong} onDirectVideo={handleDirectVideo} />}
        {route === 'market' && <Market />}
        {route === 'song' && viewSong && (
          <SongPage
            creatorSlug={viewSong.creator}
            songSlug={viewSong.slug}
            onBack={() => navigateToCreator(viewSong.creator)}
          />
        )}
        {route === 'editor' && editingSong && !editingSong.metadata_cid && (
          <Editor song={editingSong} onBack={handleBackFromEditor} />
        )}
        {route === 'editor' && (!editingSong || editingSong.metadata_cid) && (
          <div className="editor-status-screen">
            {editorError ?? 'Opening song…'}
          </div>
        )}
        {route === 'video' && videoSong && (
          <Video
            song={videoSong}
            onBack={handleBackFromVideo}
            onSongUpdated={(updated) => {
              setVideoSong(updated);
              store.updateSong(updated.id, { video: updated.video ?? null });
              try {
                sessionStorage.setItem('rawchunks_video_song', JSON.stringify(updated));
              } catch { }
            }}
          />
        )}
        {route === 'video' && !videoSong && (
          <div className="editor-status-screen">
            {videoError ?? 'Opening Video Studio…'}
          </div>
        )}
      </Layout>
    </GuideProvider>
  );
};
