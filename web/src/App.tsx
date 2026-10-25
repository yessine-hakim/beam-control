import { useState } from 'react';
import type { Viewer } from 'cesium';
import { Globe } from './Globe';
import { useSnapshot } from './useSnapshot';

export function App() {
  const { snapshot } = useSnapshot();
  const [, setViewer] = useState<Viewer | null>(null);
  return (
    <div className="app">
      <Globe snapshot={snapshot} onViewer={setViewer} />
    </div>
  );
}
