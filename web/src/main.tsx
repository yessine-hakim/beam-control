import { createRoot } from 'react-dom/client';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles.css';
import { App } from './App';

// No StrictMode: its dev double-mount creates and destroys a WebGL viewer back to back.
createRoot(document.getElementById('root')!).render(<App />);
