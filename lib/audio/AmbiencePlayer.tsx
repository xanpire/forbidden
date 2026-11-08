// Plays the ambience for the present scene (section 17). Mounted once, inside
// GameProvider; renders nothing.

import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';

import { currentAmbience } from '@/lib/rpg/ambience';
import { useGame } from '@/lib/rpg/game';
import { ambienceEngine, ambienceSupported } from './ambienceEngine';
import { useAmbienceSettings } from './ambienceSettings';

const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const;

export function AmbiencePlayer() {
  const { db } = useGame();
  const settings = useAmbienceSettings();
  const supported = Platform.OS === 'web' && ambienceSupported();
  const mix = useMemo(() => (db ? currentAmbience(db) : null), [db]);

  // Browsers only allow sound after a tap: build the graph on the first one.
  useEffect(() => {
    if (!supported || !settings.enabled) return;
    const engine = ambienceEngine();
    if (engine.unlocked) return;

    const unlock = () => {
      engine.unlock();
      for (const name of UNLOCK_EVENTS) window.removeEventListener(name, unlock, true);
    };
    for (const name of UNLOCK_EVENTS) window.addEventListener(name, unlock, true);
    return () => {
      for (const name of UNLOCK_EVENTS) window.removeEventListener(name, unlock, true);
    };
  }, [supported, settings.enabled]);

  // Pause in the background.
  useEffect(() => {
    if (!supported || typeof document === 'undefined') return;
    const engine = ambienceEngine();
    const update = () => engine.setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pagehide', update);
    window.addEventListener('pageshow', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('pagehide', update);
      window.removeEventListener('pageshow', update);
    };
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    const engine = ambienceEngine();
    engine.setVolume(settings.volume);
    engine.setEnabled(settings.enabled);
  }, [supported, settings.enabled, settings.volume]);

  useEffect(() => {
    if (supported && mix) ambienceEngine().setMix(mix);
  }, [supported, mix]);

  return null;
}
