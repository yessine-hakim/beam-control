import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import type { WireSnapshot } from './types';
import { createSceneRenderer } from './scene/render';

const ESRI_IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_CREDIT = 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

interface Props {
  snapshot: WireSnapshot | null;
  onViewer?: (viewer: Cesium.Viewer | null) => void;
}

/** A plain Cesium viewer, mounted once; each snapshot is drawn into it imperatively. */
export function Globe({ snapshot, onViewer }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<ReturnType<typeof createSceneRenderer> | null>(null);

  useEffect(() => {
    Cesium.Ion.defaultAccessToken = '';
    const viewer = new Cesium.Viewer(container.current!, {
      baseLayer: new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({ url: ESRI_IMAGERY, maximumLevel: 19, credit: ESRI_CREDIT }),
      ),
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });
    viewer.scene.globe.enableLighting = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    renderer.current = createSceneRenderer(viewer);
    onViewer?.(viewer);
    return () => {
      onViewer?.(null);
      renderer.current = null;
      viewer.destroy();
    };
    // Mount once: the viewer outlives every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (snapshot) renderer.current?.render(snapshot);
  }, [snapshot]);

  return <div ref={container} className="globe" />;
}
