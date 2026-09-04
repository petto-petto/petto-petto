import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/press-start-2p'; // 픽셀 폰트 (로컬 번들)
import App from './App.jsx';
import './styles.css';
import { isElectron } from './platform/bridge.js';

// 브라우저 미리보기일 때만 어두운 데스크탑 배경(Electron 투명 창엔 영향 없음)
if (!isElectron) document.documentElement.classList.add('browser-preview');

createRoot(document.getElementById('root')).render(<App />);
