import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
// FIX: Changed namespace imports to standard default imports for React components.
import App from './App.tsx';
import Auth from './Auth';
import { Payment } from './Payment';
import VoiceCommandsPage from './VoiceCommandsPage';
import HelpAndSupportPage from './HelpAndSupportPage';
import TermsAndConditionsPage from './TermsAndConditionsPage';
import SecurityPage from './SecurityPage';
import ImageGeneratorPage from './ImageGeneratorPage';
import AdminPanel from './AdminPanel';
import { auth, onAuthStateChanged, db, doc, onSnapshot, updateDoc, signOut, getDoc, serverTimestamp } from './firebase';
import type { User } from 'firebase/auth';
import { UserProfile } from './types';

type SubscriptionStatus = 'loading' | 'active' | 'inactive';

const LoadingScreen = ({ message }: { message: string }) => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--bg-primary)]">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-[var(--accent-primary)]"></div>
        <p className="text-[var(--text-primary)] mt-4">{message}</p>
    </div>
);

// --- Terms Acceptance Modal Component ---
const TermsAcceptanceModal = ({ onAccept }: { onAccept: () => void }) => {
    const [scrolledToBottom, setScrolledToBottom] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    const handleScroll = () => {
        if (contentRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
            if (scrollTop + clientHeight >= scrollHeight - 50) {
                setScrolledToBottom(true);
            }
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => setScrolledToBottom(true), 5000);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
            <div className="bg-[#1e293b] rounded-2xl shadow-2xl overflow-hidden w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-700">
                <div className="p-6 border-b border-gray-700 bg-[#0f172a]">
                    <h2 className="text-2xl font-bold text-white text-center">Termos de Uso Obrigatórios</h2>
                    <p className="text-gray-400 text-sm text-center mt-2">Por favor, leia e aceite os termos para continuar usando o Gideão IA.</p>
                </div>
                
                <div 
                    ref={contentRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto p-6 space-y-4 text-gray-300 text-sm leading-relaxed"
                >
                    <h3 className="text-lg font-bold text-white">TERMOS DE USO – ACESSO AO SISTEMA GIDEÃO IA</h3>
                    <p>O acesso adquirido pelo usuário ao sistema GIDEÃO IA é concedido em caráter vitalício, o que significa que o usuário passa a deter o direito de utilizar a plataforma por prazo indeterminado, de forma contínua e sem a cobrança de mensalidades...</p>
                    <p>O conceito de “acesso vitalício” refere-se exclusivamente ao direito de uso do software GIDEÃO IA em sua forma, estrutura e arquitetura originalmente disponibilizadas...</p>
                </div>

                <div className="p-6 border-t border-gray-700 bg-[#0f172a] flex flex-col items-center gap-3">
                    <button 
                        onClick={onAccept}
                        disabled={!scrolledToBottom}
                        className={`w-full py-4 rounded-lg font-bold text-lg transition-all ${
                            scrolledToBottom 
                            ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg hover:shadow-blue-500/30' 
                            : 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        }`}
                    >
                        {scrolledToBottom ? 'Li e Aceito os Termos de Uso' : 'Leia até o final para aceitar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

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
    } else {
        root.style.removeProperty('--accent-primary');
        root.style.removeProperty('--accent-primary-hover');
        root.style.removeProperty('--bg-primary');
        root.style.removeProperty('--bg-secondary');
        root.style.removeProperty('--bg-tertiary');
        root.style.removeProperty('--border-color');
        root.style.removeProperty('--text-primary');
        root.style.removeProperty('--text-secondary');
    }
};

const Root = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>('loading');
  const [userData, setUserData] = useState<Partial<UserProfile>>({});
  const [route, setRoute] = useState(window.location.hash);
  const [showTermsModal, setShowTermsModal] = useState(false);
  
  const localIpRef = useRef<string | null>(null);

  useEffect(() => {
    const handleHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', handleHashChange, false);
    return () => window.removeEventListener('hashchange', handleHashChange, false);
  }, []);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setSubscriptionStatus('inactive');
        setAuthLoading(false);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    let unsubscribeFirestore: (() => void) | null = null;
    const setupUserListener = async () => {
        if (!user) return;
        setSubscriptionStatus('loading');
        const email = user.email;
        const uid = user.uid;
        let finalRef;
        if (email) {
            const emailDocRef = doc(db, 'users', email);
            const emailDoc = await getDoc(emailDocRef);
            finalRef = emailDoc.exists() ? emailDocRef : doc(db, 'users', uid);
        } else {
             finalRef = doc(db, 'users', uid);
        }

        const fetchAndSetIp = async () => {
            try {
                const response = await fetch('https://api.ipify.org?format=json');
                const data = await response.json();
                if (data.ip) {
                    localIpRef.current = data.ip;
                    if(finalRef) await updateDoc(finalRef, { allowedIP: data.ip }).catch(() => {});
                }
            } catch (err) {}
        };
        fetchAndSetIp();

        if (finalRef) {
            unsubscribeFirestore = onSnapshot(finalRef, (docSnap) => {
                if (docSnap.exists()) {
                  const data = docSnap.data() as UserProfile;
                  if (data.allowedIP && localIpRef.current && data.allowedIP !== localIpRef.current) {
                      alert("Sua conta foi conectada em outra rede/local. Sessão encerrada.");
                      signOut(auth).catch(console.error);
                      return; 
                  }
                  setUserData(data);
                  applyTheme(data.theme, data.customThemeColor);
                  if (data.subscriptionStatus === 'active') {
                    setSubscriptionStatus('active');
                    setShowTermsModal(!data.termsAccepted);
                  } else {
                    setSubscriptionStatus('inactive');
                  }
                } else {
                    setSubscriptionStatus('inactive');
                }
                setAuthLoading(false);
            });
        } else {
            setSubscriptionStatus('inactive');
            setAuthLoading(false);
        }
    };
    if (user) setupUserListener();
    return () => { if (unsubscribeFirestore) unsubscribeFirestore(); };
  }, [user]);

  const handleAcceptTerms = async () => {
      if (!user) return;
      try {
          const docId = user.uid;
          await updateDoc(doc(db, 'users', docId), {
              termsAccepted: true,
              termsAcceptedAt: serverTimestamp()
          });
          setShowTermsModal(false);
      } catch (e) {
          console.error("Error accepting terms:", e);
      }
  };

  const slug = route.replace('#', '');
  if (slug === '/admin' || slug === 'admin') return <AdminPanel />;
  if (authLoading) return <LoadingScreen message="Carregando..." />;
  if (!user) return <Auth />;

  if (subscriptionStatus === 'loading') return <LoadingScreen message="Verificando sua assinatura..." />;

  if (subscriptionStatus === 'active') {
    if (showTermsModal) {
        return <TermsAcceptanceModal onAccept={handleAcceptTerms} />;
    }

    if (slug === '/comandos-de-voz') return <VoiceCommandsPage />;
    if (slug === '/ajuda-e-suporte') return <HelpAndSupportPage />;
    if (slug === '/termos-e-condicoes') return <TermsAndConditionsPage />;
    if (slug === '/seguranca') return <SecurityPage />;
    if (slug === '/gerador-de-imagens') return <ImageGeneratorPage user={user} />;
    
    return <App user={user} initialUserData={userData} onApplyTheme={applyTheme} />;
  }

  return <Payment user={user} userData={userData} />;
};

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element to mount to");
const root = ReactDOM.createRoot(rootElement);
root.render(<React.StrictMode><Root /></React.StrictMode>);
