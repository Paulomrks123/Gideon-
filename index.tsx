
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import VoiceCommandsPage from './VoiceCommandsPage';
import HelpAndSupportPage from './HelpAndSupportPage';
import TermsAndConditionsPage from './TermsAndConditionsPage';
import SecurityPage from './SecurityPage';
import ImageGeneratorPage from './ImageGeneratorPage';
import AdminPanel from './AdminPanel';
import { auth, db, doc, onSnapshot } from './firebase';
import type { User } from 'firebase/auth';
import { UserProfile } from './types';

// --- Color Utility Functions ---
const hexToRgb = (hex: string) => {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b];
};

const rgbToHsl = (r: number, g: number, b: number) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s, l = (max + min) / 2;
    if (max === min) h = s = 0;
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s * 100, l * 100];
};

const adjustColorBrightness = (hex: string, percent: number) => {
    hex = hex.replace(/^\s*#|\s*$/g, '');
    if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const newR = Math.max(0, Math.min(255, r + percent));
    const newG = Math.max(0, Math.min(255, g + percent));
    const newB = Math.max(0, Math.min(255, b + percent));
    const toHex = (n: number) => { const h = n.toString(16); return h.length === 1 ? '0' + h : h; };
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
};

const applyTheme = (theme: string | undefined, customColor: string | undefined) => {
    const root = document.documentElement;
    root.classList.remove('theme-light'); 
    if (theme === 'light') root.classList.add('theme-light');
    if (customColor) {
        root.style.setProperty('--accent-primary', customColor);
        const hoverColor = adjustColorBrightness(customColor, -15);
        root.style.setProperty('--accent-primary-hover', hoverColor);
        const [r, g, b] = hexToRgb(customColor);
        const [h, s, l] = rgbToHsl(r, g, b);
        if (theme !== 'light') {
            const bgHue = h; const bgSat = Math.min(s, 25); 
            root.style.setProperty('--bg-primary', `hsl(${bgHue}, ${bgSat}%, 5%)`);
            root.style.setProperty('--bg-secondary', `hsl(${bgHue}, ${bgSat}%, 10%)`);
            root.style.setProperty('--bg-tertiary', `hsl(${bgHue}, ${bgSat}%, 16%)`);
            root.style.setProperty('--border-color', `hsl(${bgHue}, ${bgSat}%, 22%)`);
            root.style.setProperty('--text-primary', '#F8FAFC');
            root.style.setProperty('--text-secondary', `hsl(${bgHue}, 15%, 75%)`);
        } else {
             const bgHue = h; const bgSat = Math.min(s, 30); 
             root.style.setProperty('--bg-primary', `hsl(${bgHue}, ${bgSat}%, 98%)`);
             root.style.setProperty('--bg-secondary', `hsl(${bgHue}, ${bgSat}%, 100%)`);
             root.style.setProperty('--bg-tertiary', `hsl(${bgHue}, ${bgSat}%, 95%)`);
             root.style.setProperty('--border-color', `hsl(${bgHue}, ${bgSat}%, 88%)`);
             root.style.setProperty('--text-primary', `hsl(${bgHue}, 40%, 10%)`);
             root.style.setProperty('--text-secondary', `hsl(${bgHue}, 20%, 40%)`);
        }
    }
};

const Root = () => {
  const [route, setRoute] = useState(window.location.hash);
  
  // Perfil de Convidado Padrão para evitar telas de login
  const guestUser = {
      uid: 'public_guest',
      email: 'usuario@hypley.ia',
      displayName: 'Convidado HYPLEY'
  } as User;

  const [userData, setUserData] = useState<Partial<UserProfile>>({
      subscriptionStatus: 'active', // Força status ativo para pular tela de pagamento
      theme: 'dark',
      customThemeColor: '#00B7FF'
  });

  useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', handleHashChange, false);
    applyTheme(userData.theme, userData.customThemeColor);
    return () => window.removeEventListener('hashchange', handleHashChange, false);
  }, []);

  // Sincroniza tema se houver um usuário real (opcional, mantido para compatibilidade)
  useEffect(() => {
    if (!auth.currentUser) return;
    const docRef = doc(db, 'users', auth.currentUser.uid);
    const unsubscribe = onSnapshot(docRef, (snap) => {
        if (snap.exists()) {
            const data = snap.data() as UserProfile;
            setUserData(prev => ({ ...prev, ...data }));
            applyTheme(data.theme, data.customThemeColor);
        }
    });
    return () => unsubscribe();
  }, []);

  const slug = route.replace('#', '');

  // Rotas de Páginas Específicas
  if (slug === '/admin' || slug === 'admin') return <AdminPanel />;
  if (slug === '/comandos-de-voz') return <VoiceCommandsPage />;
  if (slug === '/ajuda-e-suporte') return <HelpAndSupportPage />;
  if (slug === '/termos-e-condicoes') return <TermsAndConditionsPage />;
  if (slug === '/seguranca') return <SecurityPage />;
  if (slug === '/gerador-de-imagens') return <ImageGeneratorPage user={auth.currentUser || guestUser} />;
  
  // Retorna diretamente o App com o usuário logado ou o convidado
  return (
    <App 
        user={auth.currentUser || guestUser} 
        initialUserData={userData} 
        onApplyTheme={applyTheme} 
    />
  );
};

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element to mount to");
const root = ReactDOM.createRoot(rootElement);
root.render(<React.StrictMode><Root /></React.StrictMode>);
