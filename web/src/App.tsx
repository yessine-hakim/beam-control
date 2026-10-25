import { useEffect, useRef, useState } from 'react';
import type { Viewer } from 'cesium';
import { Credits } from './Credits';
import { Dashboard } from './Dashboard';
import { flyToReceiver } from './flyTo';
import { Globe } from './Globe';
import { TopBar } from './TopBar';
import { useSnapshot } from './useSnapshot';

const DEMO_RECEIVER_ID = 'london-west';

export function App() {
  const { snapshot, connected, send } = useSnapshot();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const flewIn = useRef(false);

  // Open on the demo receiver once a beam exists to frame.
  useEffect(() => {
    if (flewIn.current || !viewer || !snapshot?.beams.some((b) => b.receiverId === DEMO_RECEIVER_ID)) return;
    flewIn.current = true;
    flyToReceiver(viewer, DEMO_RECEIVER_ID, snapshot);
  }, [viewer, snapshot]);

  return (
    <div className="app">
      <TopBar connected={connected} />
      <main className="layout">
        <Dashboard snapshot={snapshot} send={send} onFlyTo={(id) => viewer && flyToReceiver(viewer, id, snapshot)} />
        <div className="stage">
          <Globe snapshot={snapshot} onViewer={setViewer} />
          <Credits />
        </div>
      </main>
    </div>
  );
}
