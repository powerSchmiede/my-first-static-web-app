import { useCallback, useEffect, useState } from 'react';

// Kleiner Zwischenspeicher im Arbeitsspeicher der Seite: Bereits geladene Daten erscheinen
// beim erneuten Öffnen sofort und werden im Hintergrund aktualisiert. Beim Abmelden lädt
// die Seite neu, damit ist der Speicher leer. Rechte prüft weiterhin der Server.
const store = new Map();
const pending = new Map();

export function prefetch(key, loader) {
  if (store.has(key) || pending.has(key)) return;
  const promise = loader()
    .then(data => { store.set(key, data); return data; })
    .finally(() => pending.delete(key));
  promise.catch(() => {});
  pending.set(key, promise);
}

export function invalidate(prefix) {
  for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key);
}

// Liefert { data, error, reload }. data ist sofort gefüllt, wenn etwas im Speicher liegt.
export function useCached(key, loader) {
  const [data, setData] = useState(() => store.get(key));
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const fresh = await (pending.get(key) || loader());
      store.set(key, fresh);
      setData(fresh);
      setError('');
      return fresh;
    } catch (err) {
      setError(err.message);
      return undefined;
    }
  }, [key, loader]);

  useEffect(() => {
    setData(store.get(key));
    reload();
  }, [key, reload]);

  return { data, error, reload };
}
