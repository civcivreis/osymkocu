import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'kocum.recent-emojis';
const MAX = 20;

export function useRecentEmojis() {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return;
        setItems(parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX));
      } catch {
        // ignore corrupt cache
      }
    });
  }, []);

  const remember = useCallback((emoji: string) => {
    setItems((current) => {
      const next = [emoji, ...current.filter((item) => item !== emoji)].slice(0, MAX);
      void AsyncStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { items, remember };
}
