
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createLiveSession, LiveSessionController, sendTextMessage, summarizeText, validateApiKey } from './services/geminiService';
import { ConversationMessage, Conversation, UserProfile, CustomAgent, SystemNotification } from './types';
import { auth, signOut, db, doc, updateDoc, increment, storage, ref, uploadBytes, getDownloadURL, collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, deleteDoc, getDocs, limit } from './firebase';
import type { User } from 'firebase/auth';

// Cost Constants & Token Estimations
// Pricing for gemini-2.5-flash in USD per 1M tokens (for text)
const GEMINI_FLASH_INPUT_COST_PER_MILLION_TOKENS = 0.35;
const GEMINI_FLASH_OUTPUT_COST_PER_MILLION_TOKENS = 0.70;

// --- SYSTEM AGENTS CONFIGURATION ---
// Define agents here to be used by both the UI (Modal) and the Logic (Voice Switching)
const SYSTEM_AGENTS = [
    {
        id: 'default',
        name: 'Assistente Padrão',
        description: 'O Gideão padrão, versátil para guiá-lo em qualquer site ou tarefa com assistência visual e de voz.',
        keywords: ['padrao', 'normal', 'inicio', 'voltar', 'geral', 'default', 'assistente', 'comum', 'principal'],
        icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
    },
    {
        id: 'social_media',
        name: 'Especialista em Mídias Sociais',
        description: 'Analisa seus painéis de métricas, busca tendências na web e fornece estratégias para crescimento.',
        keywords: ['social', 'midia', 'instagram', 'facebook', 'tiktok', 'rede social', 'post', 'stories', 'marketing', 'influencer'],
        icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6'
    },
    {
        id: 'traffic_manager',
        name: 'Andromeda Ads Operative',
        description: 'Especialista em Meta Ads focado em Criativos, CBO e Advantage+. Guia passo a passo como um GPS.',
        keywords: ['trafego', 'gestor', 'meta ads', 'facebook ads', 'anuncio', 'campanha', 'andromeda', 'ads', 'cbo', 'tráfego'],
        icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z'
    },
    {
        id: 'google_ads',
        name: 'Especialista Google Ads',
        description: 'Cria, estrutura e otimiza campanhas de pesquisa com foco em ROI, palavras-chave e anúncios que convertem.',
        keywords: ['google', 'google ads', 'adwords', 'pesquisa', 'links patrocinados', 'youtube ads', 'g ads'],
        icon: 'M8 16l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
    },
    {
        id: 'programmer',
        name: 'Agente Programador',
        description: 'Atua como um dev sênior, analisando código, debugando, sugerindo otimizações e auxiliando em plataformas no-code.',
        keywords: ['programador', 'dev', 'desenvolvedor', 'codigo', 'software', 'programacao', 'web', 'app', 'react', 'code', 'programmer', 'python', 'javascript', 'programação'],
        icon: 'M16 18l6-6-6-6M8 6l-6 6 6 6'
    }
];

// Helper to generate the favicon SVG data URL with a status indicator.
const createFavicon = (isMicActive: boolean): string => {
  const GLogo = `<text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' font-size='70' font-weight='bold' fill='white' font-family='sans-serif'>G</text>`;

  // Red dot for microphone in the top-right corner
  const micDot = isMicActive
    ? `<circle cx='80' cy='20' r='12' fill='#22c55e' stroke='white' stroke-width='2'/>`
    : '';

  const svgContent = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='#4A5568'/%3E${GLogo}${micDot}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
};

// Helper function to play a short beep sound for feedback.
const playBeep = (context: AudioContext | null, frequency = 440, duration = 100) => {
  if (!context || context.state === 'closed') return;
  if (context.state === 'suspended') {
    context.resume();
  }
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = 'sine'; // A simple, clean tone
  oscillator.frequency.setValueAtTime(frequency, context.currentTime);
  
  // Fade out to avoid clicking sound
  gainNode.gain.setValueAtTime(0.3, context.currentTime); // Start at a reasonable volume
  gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration / 1000);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(context.currentTime);
  oscillator.stop(context.currentTime + duration / 1000);
};

// NEW: Helper function to play a notification sound.
const playNotificationSound = (context: AudioContext | null) => {
    if (!context || context.state === 'closed') return;
    if (context.state === 'suspended') {
        context.resume();
    }
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime); // Higher pitch for notification
    gainNode.gain.setValueAtTime(0.3, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.15); // Short, sharp sound

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + 0.15);
};


// Estimated costs for other modalities
const ESTIMATED_COST_PER_SECOND_OF_AUDIO = 0.000166; // Approx $0.01/min
const ESTIMATED_COST_PER_IMAGE_FRAME = 0.0025; // An estimate for image analysis
const ESTIMATED_COST_PER_TTS_CHARACTER = 0.000015; // Based on $15 per 1M characters

// Based on pricing, we can estimate token equivalents for non-text modalities
// to provide a unified view of consumption.
const COST_PER_INPUT_TOKEN = GEMINI_FLASH_INPUT_COST_PER_MILLION_TOKENS / 1_000_000;
const COST_PER_OUTPUT_TOKEN = GEMINI_FLASH_OUTPUT_COST_PER_MILLION_TOKENS / 1_000_000;

const ESTIMATED_TOKENS_PER_SECOND_OF_AUDIO = Math.round(ESTIMATED_COST_PER_SECOND_OF_AUDIO / COST_PER_INPUT_TOKEN); // ~474 tokens
const ESTIMATED_TOKENS_PER_IMAGE_FRAME = Math.round(ESTIMATED_COST_PER_IMAGE_FRAME / COST_PER_INPUT_TOKEN); // ~7143 tokens
const ESTIMATED_TOKENS_PER_TTS_CHARACTER = Math.round(ESTIMATED_COST_PER_TTS_CHARACTER / COST_PER_OUTPUT_TOKEN); // ~21 tokens

const TEXT_COMPRESSION_THRESHOLD = 300; // Summarize texts longer than 300 chars

type Agent = string; // Relaxed type to allow custom IDs

// Utility function to convert Blob to Base64 (Data URL)
const blobToDataURL = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert blob to data URL."));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Utility function to convert Blob/File to Base64 (raw string)
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64data = reader.result.split(',')[1];
        resolve(base64data);
      } else {
        reject(new Error("Failed to convert blob to base64 string."));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// NEW: Função utilitária para enviar status do microfone para a extensão
function enviarStatusParaExtensao(status: boolean) {
    try {
        if (window?.parent) {
            window.parent.postMessage(
                {
                    type: "GIDEAO_MIC_STATUS",
                    on: status
                },
                "*"
            );
            console.log("Status do microfone enviado:", status);
        }
    } catch (e) {
        console.warn("Não foi possível enviar status para extensão:", e);
    }
}

// Helper component for Loading Spinner
const LoadingSpinner: React.FC<{ message: string }> = ({ message }) => (
    <div className="flex flex-col items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--accent-primary)]"></div>
        <p className="text-[var(--text-secondary)] mt-4">{message}</p>
    </div>
);

// Renamed from CodeBlockMessage to CopyableContentBlock and adapted for blockType
const CopyableContentBlock: React.FC<{ content: string; blockType?: 'code' | 'text' | 'prompt' }> = ({ content, blockType = 'code' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
    });
  };

  let titleText = "Conteúdo";
  switch (blockType) {
    case 'code':
      titleText = "Código";
      break;
    case 'text':
      titleText = "Texto para Copiar";
      break;
    case 'prompt':
      titleText = "Prompt para Copiar";
      break;
  }

  return (
    <div className="bg-black/50 rounded-lg overflow-hidden my-2 border border-[var(--border-color)]">
      <div className="flex justify-between items-center px-4 py-2 bg-gray-800/50">
        <span className="text-xs font-sans text-gray-400">{titleText}</span>
        <button onClick={handleCopy} className="flex items-center space-x-1.5 text-xs font-sans text-gray-300 hover:text-white transition-colors p-1 -m-1 rounded-md">
          {copied ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
              <span>Copiado!</span>
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              <span>Copiar</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 text-sm text-gray-300 overflow-x-auto font-mono bg-gray-900">
        <code>{content}</code>
      </pre>
    </div>
  );
};

// New Component for Copy/Download Actions
const MessageActions: React.FC<{ messageText: string; messageId: string }> = ({ messageText, messageId }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(messageText).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(err => {
            console.error("Failed to copy text:", err);
        });
    };

    const handleDownload = () => {
        const fileName = `gideao_ia_message_${messageId}.txt`;
        const blob = new Blob([messageText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex space-x-1 z-10">
            <button
                onClick={handleCopy}
                className="p-1.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-color)] transition-colors duration-200 shadow-md"
                title="Copiar mensagem"
            >
                {copied ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                )}
            </button>
            <button
                onClick={handleDownload}
                className="p-1.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-color)] transition-colors duration-200 shadow-md"
                title="Baixar mensagem"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </button>
        </div>
    );
};


// Visual Help Modal for Annotations
const VisualHelpModal: React.FC<{ data: { image: string; highlight: { x: number; y: number } } | null, onClose: () => void }> = ({ data, onClose }) => {
  if (!data) return null;

  const { image, highlight } = data;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img src={image} alt="Screenshot with annotation" className="w-full h-full object-contain rounded-lg shadow-2xl" />
        
        {/* Highlighting Container */}
        { highlight.x >= 0 && highlight.y >= 0 && (
            <div 
              className="absolute" 
              style={{ 
                left: `${highlight.x * 100}%`, 
                top: `${highlight.y * 100}%`,
                transform: 'translate(-50%, -50%)' 
              }}
              title="Destaque da IA"
            >
                {/* Pulsing Circle */}
                <div className="w-20 h-20 border-4 border-red-500 rounded-full animate-ping absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-75"></div>
                <div className="w-20 h-20 border-4 border-red-500 rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-[0_0_15px_rgba(255,0,0,0.8)]"></div>
                
                {/* Arrow Pointing Down at the circle */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 drop-shadow-lg animate-bounce">
                     <svg width="48" height="48" viewBox="0 0 24 24" fill="red" stroke="white" strokeWidth="1.5">
                        <path d="M12 2L12 18M12 18L5 11M12 18L19 11" strokeLinecap="round" strokeLinejoin="round"/>
                     </svg>
                </div>
            </div>
        )}
        
        <button onClick={onClose} className="absolute -top-4 -right-4 bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-full h-10 w-10 flex items-center justify-center text-2xl font-bold shadow-lg border-2 border-[var(--border-color)] hover:scale-110 transition-transform">&times;</button>
      </div>
    </div>
  );
};

// Bug Report Modal
const BugReportModal: React.FC<{ isOpen: boolean; onClose: () => void; user: User; }> = ({ isOpen, onClose, user }) => {
    if (!isOpen) return null;

    const [description, setDescription] = useState('');
    const [whatsapp, setWhatsapp] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description) return;

        setIsSubmitting(true);
        try {
            let screenshotUrl = null;
            if (file) {
                const storageRef = ref(storage, `bug_reports/${user.uid}/${Date.now()}_${file.name}`);
                const snapshot = await uploadBytes(storageRef, file);
                screenshotUrl = await getDownloadURL(snapshot.ref);
            }

            await addDoc(collection(db, 'bug_reports'), {
                uid: user.uid,
                userEmail: user.email,
                userName: user.displayName || 'Usuário',
                whatsapp: whatsapp || 'Não informado',
                description,
                screenshotUrl,
                status: 'open',
                createdAt: serverTimestamp()
            });

            setSuccess(true);
            setTimeout(() => {
                onClose();
                setSuccess(false);
                setDescription('');
                setWhatsapp('');
                setFile(null);
            }, 3000);
        } catch (error) {
            console.error("Error submitting bug report:", error);
            alert("Erro ao enviar o relatório. Tente novamente.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[var(--bg-secondary)] rounded-2xl shadow-2xl overflow-hidden p-8 border border-[var(--border-color)] max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
                {success ? (
                    <div className="text-center py-8">
                         <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Recebemos seu relato!</h2>
                        <p className="text-gray-300">Obrigado por nos ajudar a melhorar o sistema para você.</p>
                    </div>
                ) : (
                    <>
                        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Ajude-nos a melhorar</h2>
                        <p className="text-[var(--text-secondary)] mb-6 text-sm">
                            O sistema é seu. Ajude-nos a melhorá-lo para você. Informe qual dificuldade, falha ou bug você está enfrentando.
                        </p>
                        
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Descreva o problema ou dificuldade</label>
                                <textarea 
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    className="w-full p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] min-h-[100px]"
                                    placeholder="Ex: Ao clicar no botão X, a tela trava..."
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Print do Erro (Opcional, mas recomendado)</label>
                                <input 
                                    type="file" 
                                    accept="image/*"
                                    onChange={e => setFile(e.target.files ? e.target.files[0] : null)}
                                    className="w-full text-sm text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[var(--bg-tertiary)] file:text-[var(--accent-primary)] hover:file:bg-[var(--bg-primary)]"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Seu WhatsApp (Para entrarmos em contato)</label>
                                <input 
                                    type="text" 
                                    value={whatsapp}
                                    onChange={e => setWhatsapp(e.target.value)}
                                    className="w-full p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                    placeholder="Ex: 11 99999-9999"
                                />
                            </div>

                            <div className="pt-2 flex gap-3 flex-col sm:flex-row">
                                <button 
                                    type="submit" 
                                    disabled={isSubmitting}
                                    className="flex-1 py-3 bg-[var(--accent-primary)] text-[var(--accent-primary-text)] font-bold rounded-lg hover:bg-[var(--accent-primary-hover)] transition-colors disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Enviando...' : 'Enviar Relatório'}
                                </button>
                                
                                <a 
                                    href="https://wa.me/558888738322?text=Preciso%20de%20suporte%20urgente%20no%20sistema." 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="flex-1 py-3 bg-[#25D366] text-white font-bold rounded-lg hover:bg-[#20bd5a] transition-colors text-center flex items-center justify-center gap-2"
                                >
                                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                    Falar com Suporte
                                </a>
                            </div>
                        </form>
                    </>
                )}
                
                <button onClick={onClose} className="mt-4 w-full py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">Fechar</button>
            </div>
        </div>
    );
};

// Confirmation Modal for Deletion
const ConfirmationModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
}> = ({ isOpen, onClose, onConfirm, title, message }) => {
    if (!isOpen) return null;

    // Z-index increased to 110 to be above AgentsModal (which is 60)
    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[var(--bg-secondary)] rounded-2xl shadow-2xl overflow-hidden p-8 text-[var(--text-primary)] border border-[var(--border-color)] max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-4">{title}</h2>
                <p className="text-[var(--text-secondary)] mb-6">{message}</p>
                <div className="flex justify-end space-x-4">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--border-color)] transition-colors">Cancelar</button>
                    <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-[var(--destructive-color)] text-white hover:opacity-90 transition-opacity">Confirmar Exclusão</button>
                </div>
            </div>
        </div>
    );
};

// Notification Modal
const NotificationsModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    notifications: SystemNotification[];
}> = ({ isOpen, onClose, notifications }) => {
    if (!isOpen) return null;

    // Helper to get YouTube ID from URL
    const getYouTubeId = (url: string) => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[var(--bg-secondary)] rounded-2xl shadow-2xl overflow-hidden text-[var(--text-primary)] border border-[var(--border-color)] max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-[var(--border-color)]">
                    <h2 className="text-2xl font-bold">Avisos do Sistema</h2>
                    <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-3xl leading-none">&times;</button>
                </div>
                
                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    {notifications.length === 0 ? (
                        <p className="text-center text-[var(--text-secondary)] py-8">Nenhuma notificação nova.</p>
                    ) : (
                        notifications.map(notif => {
                            const youtubeId = notif.videoUrl ? getYouTubeId(notif.videoUrl) : null;
                            
                            return (
                                <div key={notif.id} className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] overflow-hidden shadow-sm">
                                    <div className="p-5">
                                        <div className="flex justify-between items-start mb-2">
                                            <h3 className="text-lg font-bold text-[var(--text-primary)]">{notif.title}</h3>
                                            <span className="text-xs text-[var(--text-secondary)]">
                                                {notif.createdAt.toLocaleDateString('pt-BR')}
                                            </span>
                                        </div>
                                        <p className="text-[var(--text-secondary)] whitespace-pre-wrap mb-4">{notif.message}</p>
                                        
                                        {/* Action Button for Link */}
                                        {notif.linkUrl && (
                                            <a 
                                                href={notif.linkUrl} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center justify-center w-full py-2.5 px-4 bg-[var(--accent-primary)] text-[var(--accent-primary-text)] font-bold rounded-lg hover:bg-[var(--accent-primary-hover)] transition-colors shadow-sm mb-2"
                                            >
                                                {notif.linkText || 'Clique Aqui'}
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                </svg>
                                            </a>
                                        )}
                                    </div>
                                    
                                    {youtubeId && (
                                        <div className="relative pt-[56.25%] w-full bg-black">
                                            <iframe 
                                                className="absolute top-0 left-0 w-full h-full"
                                                src={`https://www.youtube.com/embed/${youtubeId}`}
                                                title="YouTube video player"
                                                frameBorder="0"
                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                allowFullScreen
                                            ></iframe>
                                        </div>
                                    )}
                                    {notif.videoUrl && !youtubeId && (
                                        <div className="p-4 bg-[var(--bg-tertiary)] border-t border-[var(--border-color)]">
                                            <a href={notif.videoUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-primary)] hover:underline flex items-center text-sm font-semibold">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                                Assistir Vídeo Externo
                                            </a>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

const AgentsModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onActivate: (agent: Agent) => void;
    onDeactivate: () => void;
    activeAgent: Agent;
    customAgents: CustomAgent[];
    onCreateAgent: (name: string, description: string, instruction: string) => void;
    onUpdateAgent: (id: string, name: string, description: string, instruction: string) => void;
    onDeleteAgent: (id: string) => void;
}> = ({ isOpen, onClose, onActivate, onDeactivate, activeAgent, customAgents, onCreateAgent, onUpdateAgent, onDeleteAgent }) => {
    if (!isOpen) return null;
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [instruction, setInstruction] = useState('');

    const handleOpenCreate = () => {
        setEditingId(null);
        setName('');
        setDescription('');
        setInstruction('');
        setIsFormOpen(true);
    };

    const handleOpenEdit = (agent: CustomAgent) => {
        setEditingId(agent.id);
        setName(agent.name);
        setDescription(agent.description);
        setInstruction(agent.systemInstruction);
        setIsFormOpen(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name && description && instruction) {
            if (editingId) {
                onUpdateAgent(editingId, name, description, instruction);
            } else {
                onCreateAgent(name, description, instruction);
            }
            setIsFormOpen(false);
            setEditingId(null);
            setName('');
            setDescription('');
            setInstruction('');
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div 
                className="bg-[var(--bg-secondary)] rounded-2xl shadow-2xl overflow-hidden text-[var(--text-primary)] border border-[var(--border-color)] max-w-5xl w-full max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-6 border-b border-[var(--border-color)] flex-shrink-0">
                    <h2 className="text-2xl font-bold">Agentes Especialistas</h2>
                    <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-3xl leading-none">&times;</button>
                </div>
                
                <div className="p-8 overflow-y-auto flex-1">
                    {isFormOpen ? (
                        <div className="max-w-2xl mx-auto">
                            <div className="flex items-center mb-6">
                                <button onClick={() => setIsFormOpen(false)} className="mr-4 text-[var(--accent-primary)] hover:underline">← Voltar</button>
                                <h3 className="text-xl font-bold">{editingId ? 'Editar Agente' : 'Criar Novo Agente'}</h3>
                            </div>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Nome do Agente</label>
                                    <input 
                                        type="text" 
                                        value={name} 
                                        onChange={e => setName(e.target.value)} 
                                        placeholder="Ex: Contador Especialista"
                                        className="w-full p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                        required 
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Descrição Curta</label>
                                    <input 
                                        type="text" 
                                        value={description} 
                                        onChange={e => setDescription(e.target.value)} 
                                        placeholder="Ex: Ajuda com impostos e contabilidade."
                                        className="w-full p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                        required 
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Persona / Instruções</label>
                                    <p className="text-xs text-[var(--text-secondary)] mb-2">Descreva detalhadamente quem é este agente, o que ele sabe e como ele deve se comportar.</p>
                                    <textarea 
                                        value={instruction} 
                                        onChange={e => setInstruction(e.target.value)} 
                                        placeholder="Ex: Você é um contador sênior com 20 anos de experiência em legislação tributária brasileira. Seu tone é formal e preciso. Você deve..."
                                        className="w-full p-3 h-40 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                                        required 
                                    />
                                </div>
                                <button type="submit" className="w-full py-3 bg-[var(--accent-primary)] text-[var(--accent-primary-text)] font-bold rounded-lg hover:bg-[var(--accent-primary-hover)] transition-colors">
                                    {editingId ? 'Salvar Alterações' : 'Salvar Agente'}
                                </button>
                            </form>
                        </div>
                    ) : (
                        <>
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-lg font-semibold text-[var(--text-secondary)]">Agentes do Sistema</h3>
                                <button onClick={handleOpenCreate} className="flex items-center space-x-2 px-4 py-2 bg-[var(--bg-tertiary)] hover:bg-[var(--accent-primary)] hover:text-[var(--accent-primary-text)] rounded-lg transition-colors border border-[var(--border-color)] text-sm font-bold">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                    <span>Criar Agente Personalizado</span>
                                </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
                                {SYSTEM_AGENTS.map(agent => (
                                    <div key={agent.id} className={`p-6 rounded-lg border-2 transition-all flex flex-col ${activeAgent === agent.id ? 'border-[var(--accent-primary)] bg-[var(--bg-tertiary)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)]'}`}>
                                        <div className="flex items-center space-x-3 mb-3">
                                            <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${activeAgent === agent.id ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={agent.icon} /></svg>
                                            <h3 className="text-lg font-bold">{agent.name}</h3>
                                        </div>
                                        <p className="text-sm text-[var(--text-secondary)] mb-4 h-24 flex-grow overflow-hidden">{agent.description}</p>
                                        <button
                                            onClick={() => agent.id === 'default' ? onDeactivate() : onActivate(agent.id as Agent)}
                                            disabled={activeAgent === agent.id}
                                            className="w-full mt-auto py-2 px-4 rounded-md text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 bg-[var(--accent-primary)] text-[var(--accent-primary-text)] hover:bg-[var(--accent-primary-hover)] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]"
                                        >
                                            {activeAgent === agent.id ? 'Ativo' : 'Ativar'}
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {customAgents.length > 0 && (
                                <>
                                    <h3 className="text-lg font-semibold text-[var(--text-secondary)] mb-6 border-t border-[var(--border-color)] pt-6">Meus Agentes Personalizados</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                        {customAgents.map(agent => (
                                            <div key={agent.id} className={`p-6 rounded-lg border-2 transition-all flex flex-col relative group ${activeAgent === agent.id ? 'border-[var(--accent-primary)] bg-[var(--bg-tertiary)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)]'}`}>
                                                <div className="absolute top-2 right-2 flex space-x-1 z-10">
                                                    <button onClick={(e) => { e.stopPropagation(); handleOpenEdit(agent); }} className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] bg-[var(--bg-primary)]/80 rounded-full shadow-sm border border-[var(--border-color)] backdrop-blur-sm transition-colors" title="Editar Agente">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); onDeleteAgent(agent.id); }} className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--destructive-color)] bg-[var(--bg-primary)]/80 rounded-full shadow-sm border border-[var(--border-color)] backdrop-blur-sm transition-colors" title="Excluir Agente">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                    </button>
                                                </div>
                                                <div className="flex items-center space-x-3 mb-3">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${activeAgent === agent.id ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                    <h3 className="text-lg font-bold truncate">{agent.name}</h3>
                                                </div>
                                                <p className="text-sm text-[var(--text-secondary)] mb-4 h-24 flex-grow overflow-hidden">{agent.description}</p>
                                                <button
                                                    onClick={() => onActivate(agent.id as Agent)}
                                                    disabled={activeAgent === agent.id}
                                                    className="w-full mt-auto py-2 px-4 rounded-md text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 bg-[var(--accent-primary)] text-[var(--accent-primary-text)] hover:bg-[var(--accent-primary-hover)] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]"
                                                >
                                                    {activeAgent === agent.id ? 'Ativo' : 'Ativar'}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

// NEW: Archived Conversations Modal
const ArchivedConversationsModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    archivedConversations: Conversation[];
    onRestoreConversation: (id: string) => Promise<void>;
}> = ({ isOpen, onClose, archivedConversations, onRestoreConversation }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[var(--bg-secondary)] rounded-2xl shadow-2xl overflow-hidden text-[var(--text-primary)] border border-[var(--border-color)] max-w-xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-[var(--border-color)]">
                    <h2 className="text-2xl font-bold">Conversas Arquivadas</h2>
                    <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-3xl leading-none">&times;</button>
                </div>
                
                <div className="p-6 overflow-y-auto flex-1 space-y-4">
                    {archivedConversations.length === 0 ? (
                        <p className="text-center text-[var(--text-secondary)] py-8">Nenhuma conversa arquivada.</p>
                    ) : (
                        archivedConversations.map(convo => (
                            <div key={convo.id} className="flex justify-between items-center bg-[var(--bg-primary)] rounded-lg p-4 border border-[var(--border-color)]">
                                <div>
                                    <h3 className="text-lg font-bold text-[var(--text-primary)]">{convo.title}</h3>
                                    <p className="text-sm text-[var(--text-secondary)]">Arquivado em: {convo.createdAt.toLocaleDateString('pt-BR')}</p>
                                </div>
                                <button
                                    onClick={() => onRestoreConversation(convo.id)}
                                    className="px-4 py-2 bg-[var(--accent-primary)] text-[var(--accent-primary-text)] font-semibold rounded-lg hover:bg-[var(--accent-primary-hover)] transition-colors"
                                >
                                    Restaurar
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

// Shared Logo component for use in modals
const GideaoLogo = ({ className = "" }) => (
    <div className={`text-4xl font-extrabold ${className}`}>
        <span className="text-[var(--text-primary)]">Gideão</span><span className="text-[var(--accent-primary)]">IA</span>
    </div>
);


interface AppProps {
  user: User;
  initialUserData: Partial<UserProfile>;
  onApplyTheme?: (theme: string | undefined, customColor: string | undefined) => void;
}

export const App: React.FC<AppProps> = ({ user, initialUserData, onApplyTheme }) => {
  // UI State
  const [isMicActive, setIsMicActive] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isMicLoading, setIsMicLoading] = useState(false);
  const [isSendingText, setIsSendingText] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<React.ReactNode | null>(null);
  const [isImmersiveMode, setIsImmersiveMode] = useState(false);
  
  // Sidebar Visibility State (Expanded Mode)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Conversation History State
  const [allConversations, setAllConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<ConversationMessage[]>([]);
  const [isConversationsLoading, setIsConversationsLoading] = useState(true);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  
  // Conversation Renaming State
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editTitleInput, setEditTitleInput] = useState('');

  // Transcription & Input State
  const [currentInputTranscription, setCurrentInputTranscription] = useState<string>('');
  const [currentOutputTranscription, setCurrentOutputTranscription] = useState<string>('');
  const [textInput, setTextInput] = useState('');
  
  // Session & Command State
  const [silencePromptVisible, setSilencePromptVisible] = useState(false);
  const [visualHelp, setVisualHelp] = useState<{ image: string; highlight: { x: number; y: number } } | null>(null);
  const [chatToDelete, setChatToDelete] = useState<Conversation | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<string | null>(null); 
  const [isAgentsModalOpen, setIsAgentsModalOpen] = useState(false);
  const [activeAgent, setActiveAgent] = useState<Agent>('default');
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([]); 
  const [isSummarizedMode, setIsSummarizedMode] = useState(false); // NEW STATE

  // Usage Info State
  const [usageInfo, setUsageInfo] = useState({ totalTokens: initialUserData.usage?.totalTokens || 0, totalCost: initialUserData.usage?.totalCost || 0 });
  const [remainingTokens, setRemainingTokens] = useState(initialUserData.usage?.remainingTokens || 0);
  const [usdToBrlRate, setUsdToBrlRate] = useState<number | null>(null);

  // Settings & Profile State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isArchivedModalOpen, setIsArchivedModalOpen] = useState(false); // NEW STATE for Archived Conversations Modal
  const [isBugReportOpen, setIsBugReportOpen] = useState(false); // NEW STATE for Bug Report
  const [profilePicUrl, setProfilePicUrl] = useState(initialUserData.profilePicUrl || null);
  const [theme, setTheme] = useState(initialUserData.theme || 'dark');
  const [customThemeColor, setCustomThemeColor] = useState(initialUserData.customThemeColor || '#00B7FF');
  const [tempColor, setTempColor] = useState(initialUserData.customThemeColor || '#00B7FF'); 
  const [voiceName, setVoiceName] = useState(initialUserData.voiceName || 'Kore'); 
  const [isTextToSpeechEnabled, setIsTextToSpeechEnabled] = useState(initialUserData.textToSpeechEnabled || false); // NEW State for TTS

  // Notification System State
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [isNotificationsModalOpen, setIsNotificationsModalOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(false);
  const hasPlayedNotificationSoundRef = useRef(false); // NEW: To prevent multiple notification sounds

  // Refs
  const liveSessionControllerRef = useRef<LiveSessionController | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null); 
  const audioAnalyserRef = useRef<AnalyserNode | null>(null); // NEW: Audio Analyser Ref
  const animationFrameRef = useRef<number | null>(null); // NEW: Animation Loop Ref
  const silenceTimerRef = useRef<number | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const usageUpdateRef = useRef({ tokenDelta: 0, costDelta: 0 });
  const firestoreUpdateTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizerCanvasRef = useRef<HTMLCanvasElement>(null); // NEW: Visualizer Canvas Ref
  const immersiveCanvasRef = useRef<HTMLCanvasElement>(null); // NEW: Immersive Canvas Ref
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentFileInputRef = useRef<HTMLInputElement>(null);
  
  // NEW: Inactivity Timer Ref
  const inactivityTimerRef = useRef<number | null>(null);
  
  // Scrolling Logic Refs
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true); // Default to true so it starts at bottom

  // Refs for State (Fix Stale Closures in Event Listeners)
  const isMicActiveRef = useRef(isMicActive);
  const isScreenSharingRef = useRef(isScreenSharing);
  const isCameraActiveRef = useRef(isCameraActive);
  
  // Prevent duplicate messages
  const lastProcessedResponseRef = useRef<string>('');


  // Efeito para atualizar o favicon, mostrando um ponto vermelho quando o microfone está ativo.
  useEffect(() => {
    const favicon = document.getElementById('favicon') as HTMLLinkElement | null;
    if (favicon) {
      favicon.href = createFavicon(isMicActive);
    }
  }, [isMicActive]);
  
  // Sync Refs with State
  useEffect(() => { isMicActiveRef.current = isMicActive; }, [isMicActive]);
  useEffect(() => { isScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);
  useEffect(() => { isCameraActiveRef.current = isCameraActive; }, [isCameraActive]);

  // Previous state ref for mic active status to detect change
  const prevIsMicActiveRef = useRef<boolean>(isMicActive);
  
  // Effect to play a sound when the microphone is turned off.
  useEffect(() => {
    prevIsMicActiveRef.current = isMicActive;
  }, [isMicActive]);

  // AUTO-RESUME AUDIO CONTEXT LOOP (Heartbeat to prevent freeze)
  useEffect(() => {
    if (!isMicActive) return;
    
    const checkAudioContext = () => {
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'running') {
            inputAudioContextRef.current.resume().catch(e => console.warn("Failed to auto-resume input ctx", e));
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'running') {
            outputAudioContextRef.current.resume().catch(e => console.warn("Failed to auto-resume output ctx", e));
        }
    };

    const interval = setInterval(checkAudioContext, 1000);
    return () => clearInterval(interval);
  }, [isMicActive]);

  // Ensure video element stays in sync with stream state to fix visibility issues
  useEffect(() => {
    if (videoRef.current) {
        if (isCameraActive && cameraStreamRef.current) {
            if (videoRef.current.srcObject !== cameraStreamRef.current) {
                videoRef.current.srcObject = cameraStreamRef.current;
                videoRef.current.play().catch(e => console.warn("Video play error (camera):", e));
            }
        } else if (isScreenSharing && screenStreamRef.current) {
             if (videoRef.current.srcObject !== screenStreamRef.current) {
                videoRef.current.srcObject = screenStreamRef.current;
                videoRef.current.play().catch(e => console.warn("Video play error (screen):", e));
            }
        }
    }
  }, [isCameraActive, isScreenSharing]);

  // --- PRESENCE SYSTEM (Online Status) ---
  useEffect(() => {
      if (!user) return;

      const updatePresence = async () => {
          try {
              const userRef = doc(db, 'users', user.uid);
              await updateDoc(userRef, {
                  lastSeen: serverTimestamp()
              });
          } catch (e) {
              console.warn("Failed to update presence:", e);
          }
      };

      updatePresence();
      const interval = setInterval(updatePresence, 60000);

      const handleVisibilityChange = () => {
          if (!document.hidden) {
              updatePresence();
          }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
          clearInterval(interval);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
  }, [user]);

  // Derived state for active and archived conversations
  const { activeConversations, archivedConversations } = useMemo(() => {
    const active: Conversation[] = [];
    const archived: Conversation[] = [];
    allConversations.forEach(convo => {
      if (convo.isArchived) {
        archived.push(convo);
      } else {
        active.push(convo);
      }
    });
    return { activeConversations: active, archivedConversations: archived };
  }, [allConversations]);

  const addMessage = useCallback(async (
      role: 'user' | 'model' | 'system', 
      text: string, 
      options: {
          summary?: string;
          imageUrl?: string;
          fileName?: string;
          blockType?: 'code' | 'text' | 'prompt';
      } = {}
  ): Promise<string | null> => {
      if (!activeConversationId) return null;
      try {
          const { summary, imageUrl, fileName, blockType } = options;
          const messageData = { 
              role, 
              text, 
              timestamp: serverTimestamp(), 
              ...(summary && { summary }), 
              ...(imageUrl && { imageUrl }), 
              ...(fileName && { fileName }),
              ...(blockType && { blockType }) 
          };
          const messageRef = await addDoc(collection(db, `conversations/${activeConversationId}/messages`), messageData);
          return messageRef.id;
      } catch (error) {
          console.error("Error adding message:", error);
          setErrorMessage("Falha ao salvar a mensagem.");
          return null;
      }
  }, [activeConversationId]);

  const checkAndSaveProgrammingLevel = useCallback(async (userMessage: string) => {
    if (activeAgent === 'programmer' && !initialUserData.programmingLevel) {
      const messageLower = userMessage.toLowerCase().trim();
      let level: 'basic' | 'intermediate' | 'advanced' | null = null;

      const basicTerms = ['básico', 'basico', 'iniciante', 'basic', 'beginner'];
      const intermediateTerms = ['intermédio', 'intermediário', 'intermediario', 'medio', 'medium', 'intermediate'];
      const advancedTerms = ['avançado', 'avancado', 'expert', 'especialista', 'senior', 'advanced'];

      if (basicTerms.some(term => messageLower.includes(term))) {
        level = 'basic';
      } else if (intermediateTerms.some(term => messageLower.includes(term))) {
        level = 'intermediate';
      } else if (advancedTerms.some(term => messageLower.includes(term))) {
        level = 'advanced';
      }
      
      if (level) {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          await updateDoc(userDocRef, { programmingLevel: level });
          addMessage('system', `Seu nível de programação foi salvo como: ${level}.`);
        } catch (error) {
          console.error("Failed to save programming level:", error);
          setErrorMessage("Não foi possível salvar seu nível de programação.");
        }
      }
    }
  }, [activeAgent, initialUserData.programmingLevel, user.uid, addMessage]);

  // Sync internal state with props from Firestore listener
  useEffect(() => {
    setProfilePicUrl(initialUserData.profilePicUrl || null);
    setTheme(initialUserData.theme || 'dark');
    setCustomThemeColor(initialUserData.customThemeColor || '#00B7FF');
    setTempColor(initialUserData.customThemeColor || '#00B7FF');
    setVoiceName(initialUserData.voiceName || 'Kore');
    setIsTextToSpeechEnabled(initialUserData.textToSpeechEnabled || false);
    setRemainingTokens(initialUserData.usage?.remainingTokens || 0);
    setUsageInfo({
      totalTokens: initialUserData.usage?.totalTokens || 0,
      totalCost: initialUserData.usage?.totalCost || 0
    });
  }, [initialUserData]);

  // Fetch System Notifications
  useEffect(() => {
    const q = query(
        collection(db, 'system_notifications'),
        orderBy('createdAt', 'desc'),
        limit(5)
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const notifs: SystemNotification[] = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            notifs.push({
                id: doc.id,
                title: data.title,
                message: data.message,
                videoUrl: data.videoUrl,
                linkUrl: data.linkUrl, 
                linkText: data.linkText, 
                createdAt: data.createdAt?.toDate() || new Date(),
            });
        });
        setNotifications(notifs);
        
        const seenStorage = localStorage.getItem('seenNotificationIds');
        const seenIds = seenStorage ? JSON.parse(seenStorage) : [];
        const hasUnread = notifs.some(n => !seenIds.includes(n.id));

        if (hasUnread) {
            setUnreadNotifications(true);
            if (!hasPlayedNotificationSoundRef.current && outputAudioContextRef.current) {
                playNotificationSound(outputAudioContextRef.current);
                hasPlayedNotificationSoundRef.current = true;
            }
        } else {
            setUnreadNotifications(false);
            hasPlayedNotificationSoundRef.current = false; 
        }
    });

    return () => unsubscribe();
  }, []);

  const markNotificationsAsSeen = useCallback(() => {
      if (notifications.length === 0) return;

      const seenStorage = localStorage.getItem('seenNotificationIds');
      const seenIds: string[] = seenStorage ? JSON.parse(seenStorage) : [];
      const newSeenIds = [...seenIds];
      let hasUpdates = false;

      notifications.forEach((n) => {
          if (!seenIds.includes(n.id)) {
              const notifRef = doc(db, 'system_notifications', n.id);
              updateDoc(notifRef, { viewCount: increment(1) }).catch(err => console.error("Error updating view count", err));
              newSeenIds.push(n.id);
              hasUpdates = true;
          }
      });

      if (hasUpdates) {
          localStorage.setItem('seenNotificationIds', JSON.stringify(newSeenIds));
      }
      setUnreadNotifications(false);
      hasPlayedNotificationSoundRef.current = false; 
  }, [notifications]);

  // NEW: Fetch Custom Agents
  useEffect(() => {
      if (!user) return;

      const q = query(
          collection(db, `users/${user.uid}/custom_agents`),
          orderBy('createdAt', 'desc')
      );

      const unsubscribe = onSnapshot(q, (querySnapshot) => {
          const agents: CustomAgent[] = [];
          querySnapshot.forEach((doc) => {
              const data = doc.data();
              agents.push({
                  id: doc.id,
                  name: data.name,
                  description: data.description,
                  systemInstruction: data.systemInstruction,
                  createdAt: data.createdAt?.toDate() || new Date(),
              });
          });
          setCustomAgents(agents);
      }, (err) => {
          console.error("Error fetching custom agents:", err);
      });

      return () => unsubscribe();
  }, [user]);

  // Fetch all conversations for the user
  useEffect(() => {
      if (!user) return;
      setIsConversationsLoading(true);

      const q = query(
          collection(db, 'conversations'),
          where('uid', '==', user.uid)
      );

      const unsubscribe = onSnapshot(q, (querySnapshot) => {
          const fetchedConversations: Conversation[] = [];
          querySnapshot.forEach((doc) => {
              const data = doc.data();
              fetchedConversations.push({
                  id: doc.id,
                  uid: data.uid,
                  title: data.title,
                  createdAt: data.createdAt?.toDate() || new Date(),
                  isArchived: data.isArchived || false,
              });
          });
          
          fetchedConversations.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

          setAllConversations(fetchedConversations);
          
          const currentActive = fetchedConversations.find(c => !c.isArchived);

          if (!activeConversationId && currentActive) {
              setActiveConversationId(currentActive.id);
          }
          
          if (!initialLoadComplete && !currentActive) {
              handleNewChat();
          }
          
          setIsConversationsLoading(false);
          setInitialLoadComplete(true);
      }, (error) => {
          console.error("Error fetching conversations:", error);
          setErrorMessage("Não foi possível carregar seu histórico de conversas.");
          setIsConversationsLoading(false);
      });

      return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Fetch messages for the active conversation
  useEffect(() => {
      if (!activeConversationId) {
          setActiveMessages([]);
          return;
      }
      
      shouldAutoScrollRef.current = true;

      setIsMessagesLoading(true);
      const q = query(
          collection(db, `conversations/${activeConversationId}/messages`),
          orderBy('timestamp', 'asc')
      );

      const unsubscribe = onSnapshot(q, (querySnapshot) => {
          const fetchedMessages: ConversationMessage[] = [];
          querySnapshot.forEach((doc) => {
              const data = doc.data();
              fetchedMessages.push({
                  id: doc.id,
                  role: data.role,
                  text: data.text,
                  timestamp: data.timestamp?.toDate() || new Date(),
                  summary: data.summary,
                  imageUrl: data.imageUrl,
                  fileName: data.fileName,
                  blockType: data.blockType,
              });
          });
          setActiveMessages(fetchedMessages);
          setIsMessagesLoading(false);
      }, (error) => {
          console.error(`Error fetching messages for convo ${activeConversationId}:`, error);
          setErrorMessage("Não foi possível carregar as mensagens desta conversa.");
          setIsMessagesLoading(false);
      });

      return () => unsubscribe();
  }, [activeConversationId]);

  // SMART AUTO-SCROLL LOGIC
  const handleChatScroll = useCallback(() => {
      if (chatContainerRef.current) {
          const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
          const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
          shouldAutoScrollRef.current = isAtBottom;
      }
  }, []);

  useEffect(() => {
      if (shouldAutoScrollRef.current && chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
  }, [activeMessages, currentInputTranscription, currentOutputTranscription, silencePromptVisible]);


  const handleLogout = async () => {
    try {
      if (user?.email) {
        localStorage.setItem('lastKnownTokenCount', JSON.stringify({ email: user.email, tokens: remainingTokens }));
      }
      await signOut(auth);
    } catch (error) {
      console.error("Logout Error:", error)
    }
  };
  
  const updateUsage = useCallback((tokens: number, cost: number) => {
      setUsageInfo(prev => ({ totalTokens: prev.totalTokens + tokens, totalCost: prev.totalCost + cost }));
      setRemainingTokens(prev => prev - tokens);
      usageUpdateRef.current.tokenDelta += tokens;
      usageUpdateRef.current.costDelta += cost;
      if (firestoreUpdateTimerRef.current) clearTimeout(firestoreUpdateTimerRef.current);
      firestoreUpdateTimerRef.current = window.setTimeout(() => {
          const { tokenDelta, costDelta } = usageUpdateRef.current;
          if (tokenDelta > 0 || costDelta > 0) {
              const userDocRef = doc(db, 'users', user.uid);
              updateDoc(userDocRef, {
                  'usage.totalTokens': increment(tokenDelta),
                  'usage.totalCost': increment(costDelta),
                  'usage.remainingTokens': increment(-tokenDelta)
              }).catch(err => console.error("Failed to update usage in Firestore:", err));
              usageUpdateRef.current = { tokenDelta: 0, costDelta: 0 };
          }
      }, 3000);
  }, [user.uid]);
  
  const generateAndStoreSummary = useCallback(async (messageId: string, text: string) => {
    if (text.length > TEXT_COMPRESSION_THRESHOLD && activeConversationId) {
        try {
            const summary = await summarizeText(text);
            const messageRef = doc(db, `conversations/${activeConversationId}/messages`, messageId);
            await updateDoc(messageRef, { summary });
        } catch(err) {
            console.error("Failed to generate and store summary:", err);
        }
    }
  }, [activeConversationId]);
  
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    setSilencePromptVisible(false);
  }, [setSilencePromptVisible]); 

  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => setSilencePromptVisible(true), 5000);
  }, [clearSilenceTimer, setSilencePromptVisible]); 

  const captureScreenAsBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!videoRef.current || !canvasRef.current) { resolve(null); return; }
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      const ctx = canvas.getContext('2d', { alpha: false });
      
      if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
          const MAX_WIDTH = 800;
          let width = video.videoWidth;
          let height = video.videoHeight;
          
          if (width > MAX_WIDTH) {
              const scale = MAX_WIDTH / width;
              width = MAX_WIDTH;
              height = height * scale;
          }

          canvas.width = width;
          canvas.height = height;
          
          ctx.drawImage(video, 0, 0, width, height);
          
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.6);
      } else {
        resolve(null);
      }
    });
  }, []);

  const disconnectSession = useCallback(() => {
    setIsMicActive(false);
    if (liveSessionControllerRef.current) {
        liveSessionControllerRef.current.stopMicrophoneInput();
        liveSessionControllerRef.current.closeSession();
        liveSessionControllerRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsScreenSharing(false);
    setIsCameraActive(false);
    setVisualHelp(null);
    
    playBeep(outputAudioContextRef.current, 300, 150); 
    enviarStatusParaExtensao(false);
  }, []);

  const stopScreenSharing = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsScreenSharing(false);
    setVisualHelp(null);

    if (!isMicActiveRef.current && liveSessionControllerRef.current) {
        disconnectSession();
    }
  }, [disconnectSession]); 

  const resetInactivityTimer = useCallback(() => {
      if (inactivityTimerRef.current) {
          clearTimeout(inactivityTimerRef.current);
          inactivityTimerRef.current = null;
      }
      
      if (isScreenSharingRef.current) {
           inactivityTimerRef.current = window.setTimeout(() => {
              stopScreenSharing();
              setErrorMessage("Compartilhamento de tela encerrado automaticamente após 5 minutos de inatividade para economizar recursos.");
          }, 5 * 60 * 1000); 
      }
  }, [stopScreenSharing]);

  useEffect(() => {
      if (isScreenSharing) {
          resetInactivityTimer();
      } else {
          if (inactivityTimerRef.current) {
              clearTimeout(inactivityTimerRef.current);
              inactivityTimerRef.current = null;
          }
      }
      return () => {
          if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      };
  }, [isScreenSharing, resetInactivityTimer]);


  const handleActivateAgent = useCallback((agentId: Agent) => {
    if (agentId === activeAgent) return;
    resetInactivityTimer(); 
    setActiveAgent(agentId);
    setIsAgentsModalOpen(false);
    
    let agentName = 'Agente Personalizado';
    const customAgent = customAgents.find(a => a.id === agentId);
    const systemAgent = SYSTEM_AGENTS.find(a => a.id === agentId);

    if (customAgent) {
        agentName = customAgent.name;
    } else if (systemAgent) {
        agentName = systemAgent.name;
    }

    addMessage('system', `Sistema ativou o modo: ${agentName}`);
  }, [activeAgent, customAgents, addMessage, resetInactivityTimer]);

  const handleDeactivateAgent = useCallback(() => {
    if (activeAgent === 'default') return;
    resetInactivityTimer(); 
    setActiveAgent('default');
    setIsAgentsModalOpen(false);
    addMessage('system', 'Sistema ativou o modo: Assistente Padrão');
  }, [activeAgent, addMessage, resetInactivityTimer]);

  const onSwitchAgentCommand = useCallback((agentName: string) => {
      resetInactivityTimer(); 
      const normalize = (str: string) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const normalizedInput = normalize(agentName);

      const customMatch = customAgents.find(a => 
          normalize(a.name).includes(normalizedInput) || normalizedInput.includes(normalize(a.name))
      );
      if (customMatch) {
          handleActivateAgent(customMatch.id);
          return;
      }

      const systemMatch = SYSTEM_AGENTS.find(a => 
          a.id === agentName ||
          normalize(a.name).includes(normalizedInput) ||
          a.keywords.some(k => normalizedInput.includes(k))
      );

      if (systemMatch) {
          handleActivateAgent(systemMatch.id);
          return;
      }

      if (['padrao', 'normal', 'voltar', 'inicio'].some(k => normalizedInput.includes(k))) {
          handleActivateAgent('default');
      }

  }, [customAgents, handleActivateAgent, resetInactivityTimer]);

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraActive(false);
    setVisualHelp(null);

    if (!isMicActiveRef.current && liveSessionControllerRef.current) {
        disconnectSession();
    }
  }, [disconnectSession]);

  useEffect(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }

    if ((isScreenSharing || isCameraActive) && liveSessionControllerRef.current) {
       frameIntervalRef.current = window.setInterval(async () => {
          const blob = await captureScreenAsBlob();
          if (blob) {
              try {
                  const base64Data = await blobToBase64(blob);
                  liveSessionControllerRef.current?.sessionPromise?.then((session) => {
                      session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'image/jpeg' } });
                  });
                  updateUsage(ESTIMATED_TOKENS_PER_IMAGE_FRAME, ESTIMATED_COST_PER_IMAGE_FRAME);
              } catch (e) { console.error("Error sending frame:", e); }
          }
       }, 1000); 
    }

    return () => {
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
    };
  }, [isMicActive, isScreenSharing, isCameraActive, updateUsage, captureScreenAsBlob]);

  const startScreenSharing = useCallback(async (): Promise<boolean> => {
    try {
      if (isCameraActive) {
          if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach(track => track.stop());
            cameraStreamRef.current = null;
          }
          setIsCameraActive(false);
          await new Promise(r => setTimeout(r, 100));
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = stream;
      stream.getVideoTracks()[0].onended = () => {
        stopScreenSharing();
      };
      
      setIsScreenSharing(true);
      return true;
    } catch (err: any) {
      return false;
    }
  }, [stopScreenSharing, isCameraActive]); 

  const startCamera = useCallback(async (): Promise<boolean> => {
      try {
        if (isScreenSharing) {
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(track => track.stop());
                screenStreamRef.current = null;
            }
            setIsScreenSharing(false);
            await new Promise(r => setTimeout(r, 100));
        }

        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        cameraStreamRef.current = stream;
        stream.getVideoTracks()[0].onended = () => {
            stopCamera();
        };

        setIsCameraActive(true);
        return true;
      } catch (err: any) {
          return false;
      }
  }, [stopCamera, isScreenSharing]);
  
  const handleNewChat = async () => {
    if(liveSessionControllerRef.current) {
        disconnectSession();
    }
    
    try {
        const newConvoRef = await addDoc(collection(db, 'conversations'), {
            uid: user.uid,
            title: "Nova Conversa",
            createdAt: serverTimestamp(),
            isArchived: false,
        });

        await addDoc(collection(db, `conversations/${newConvoRef.id}/messages`), {
            role: 'system',
            text: 'Olá, eu sou o Gideão IA. Posso ver o que você vê (tela ou câmera) e te guiar. Faça uma pergunta por texto ou ative o microfone para conversar.',
            timestamp: serverTimestamp(),
        });

        setActiveConversationId(newConvoRef.id);
        setTextInput('');
        setCurrentInputTranscription('');
        setCurrentOutputTranscription('');
        setErrorMessage(null);
    } catch (error) {
        console.error("Error creating new chat:", error);
    }
  };
  
  const handleArchiveConversation = async (conversationId: string) => {
    try {
        const conversationDocRef = doc(db, 'conversations', conversationId);
        await updateDoc(conversationDocRef, { isArchived: true });

        if (activeConversationId === conversationId) {
            const nextActiveConvo = activeConversations.find(c => c.id !== conversationId);
            if (nextActiveConvo) {
                setActiveConversationId(nextActiveConvo.id);
            } else {
                handleNewChat();
            }
        }
    } catch (error) {
        console.error("Error archiving conversation:", error);
    }
  };
  
  const handleRestoreConversation = async (conversationId: string) => {
      try {
          const conversationDocRef = doc(db, 'conversations', conversationId);
          await updateDoc(conversationDocRef, { isArchived: false, createdAt: serverTimestamp() });
          setActiveConversationId(conversationId);
          setIsArchivedModalOpen(false); 
      } catch (error) {
          console.error("Error restoring conversation:", error);
      }
  };

  const handleDeleteConversation = async () => {
    if (!chatToDelete) return;
    try {
      const messagesQuery = query(collection(db, `conversations/${chatToDelete.id}/messages`));
      const querySnapshot = await getDocs(messagesQuery);
      querySnapshot.forEach(async (doc) => {
          await deleteDoc(doc.ref);
      });

      await deleteDoc(doc(db, 'conversations', chatToDelete.id));

      if (activeConversationId === chatToDelete.id) {
          const nextActiveConvo = activeConversations.find(c => c.id !== chatToDelete.id) || activeConversations[0] || null;
          if (nextActiveConvo) {
              setActiveConversationId(nextActiveConvo.id);
          } else {
              handleNewChat();
          }
      }
      setChatToDelete(null); 
    } catch (error) {
        console.error("Error deleting conversation:", error);
    }
  };
  
  const startEditingConversation = (convo: Conversation) => {
    setEditingConversationId(convo.id);
    setEditTitleInput(convo.title);
  };

  const saveConversationTitle = async (convoId: string) => {
    if (!editTitleInput.trim() || editTitleInput === "") {
         setEditingConversationId(null);
         return;
    }
    try {
        await updateDoc(doc(db, 'conversations', convoId), { title: editTitleInput.trim() });
    } catch (error) {
        console.error("Error updating title:", error);
    } finally {
        setEditingConversationId(null);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, convoId: string) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        saveConversationTitle(convoId);
    } else if (e.key === 'Escape') {
        setEditingConversationId(null);
    }
  };

  useEffect(() => {
    const fetchExchangeRate = async () => {
      try {
        const response = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
        if (!response.ok) throw new Error('Failed to fetch exchange rate');
        const data = await response.json();
        const rate = parseFloat(data.USDBRL.bid);
        setUsdToBrlRate(rate);
      } catch (error) {}
    };
    fetchExchangeRate();
    inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
    outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
    
    const analyser = outputAudioContextRef.current.createAnalyser();
    analyser.fftSize = 256; 
    analyser.smoothingTimeConstant = 0.5;
    analyser.connect(outputAudioContextRef.current.destination);
    audioAnalyserRef.current = analyser;

    const renderVisualizer = () => {
        const smallCanvas = visualizerCanvasRef.current;
        const immersiveCanvas = immersiveCanvasRef.current;
        
        if (!audioAnalyserRef.current) {
             animationFrameRef.current = requestAnimationFrame(renderVisualizer);
             return;
        }
        
        const bufferLength = audioAnalyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        audioAnalyserRef.current.getByteFrequencyData(dataArray);
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary') || '#00B7FF';

        if (smallCanvas) {
            const ctx = smallCanvas.getContext('2d');
            if (ctx) {
                const parentWidth = smallCanvas.parentElement?.clientWidth || 300;
                if (smallCanvas.width !== parentWidth) {
                    smallCanvas.width = parentWidth;
                }
                
                ctx.clearRect(0, 0, smallCanvas.width, smallCanvas.height);
                const centerX = smallCanvas.width / 2;
                const barWidth = 3;
                const gap = 2;
                const barsToDraw = Math.floor(smallCanvas.width / 2 / (barWidth + gap)); 
                
                for (let i = 0; i < barsToDraw; i++) {
                    const value = dataArray[i % bufferLength]; 
                    const percent = value / 255;
                    const height = Math.max(2, percent * smallCanvas.height * 0.9);
                    
                    ctx.fillStyle = accentColor;
                    ctx.globalAlpha = 0.5 + (percent * 0.5); 
                    
                    ctx.fillRect(centerX + (i * (barWidth + gap)), (smallCanvas.height - height) / 2, barWidth, height);
                    if (i > 0) ctx.fillRect(centerX - (i * (barWidth + gap)), (smallCanvas.height - height) / 2, barWidth, height);
                }
            }
        }

        if (isImmersiveMode && immersiveCanvas) {
            const ctx = immersiveCanvas.getContext('2d');
            if (ctx) {
                immersiveCanvas.width = window.innerWidth;
                immersiveCanvas.height = window.innerHeight;
                const centerX = immersiveCanvas.width / 2;
                const centerY = immersiveCanvas.height / 2;

                ctx.clearRect(0, 0, immersiveCanvas.width, immersiveCanvas.height);
                
                const baseRadius = 60;
                let sum = 0;
                for(let i=0; i<bufferLength; i++) sum += dataArray[i];
                const avg = sum / bufferLength;
                const pulse = (avg / 255) * 20;

                const currentRadius = baseRadius + pulse;

                const gradient = ctx.createRadialGradient(centerX, centerY, currentRadius * 0.5, centerX, centerY, currentRadius * 1.5);
                gradient.addColorStop(0, accentColor);
                gradient.addColorStop(0.5, "transparent");
                gradient.addColorStop(1, "transparent");
                
                ctx.fillStyle = gradient;
                ctx.globalAlpha = 0.3;
                ctx.beginPath();
                ctx.arc(centerX, centerY, currentRadius * 1.5, 0, 2 * Math.PI);
                ctx.fill();

                ctx.strokeStyle = accentColor;
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.8;
                ctx.beginPath();
                ctx.arc(centerX, centerY, currentRadius, 0, 2 * Math.PI);
                ctx.stroke();

                ctx.save();
                ctx.translate(centerX, centerY);
                
                const rayCount = 64; 
                const angleStep = (2 * Math.PI) / rayCount;

                for (let i = 0; i < rayCount; i++) {
                    const value = dataArray[i % bufferLength];
                    const percent = value / 255;
                    const rayLength = percent * (currentRadius * 0.8); 
                    
                    ctx.rotate(angleStep);
                    
                    ctx.fillStyle = accentColor;
                    ctx.globalAlpha = 0.4 + (percent * 0.6);
                    ctx.fillRect(10, -1, rayLength, 2); 
                }

                ctx.restore();

                ctx.beginPath();
                ctx.arc(centerX, centerY, 5 + (pulse * 0.2), 0, 2 * Math.PI);
                ctx.fillStyle = "#fff";
                ctx.globalAlpha = 0.9;
                ctx.fill();
            }
        }
        
        animationFrameRef.current = requestAnimationFrame(renderVisualizer);
    };
    renderVisualizer();

    return () => {
      inputAudioContextRef.current?.close();
      outputAudioContextRef.current?.close();
      window.speechSynthesis.cancel();
      clearSilenceTimer();
      stopScreenSharing(); 
      stopCamera(); 
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImmersiveMode]); 

  const speakText = (text: string) => {
    if (!text) return;
    
    let cleanText = text.replace(/<codeblock>[\s\S]*?<\/codeblock>/g, ' Código oculto. ');
    cleanText = cleanText.replace(/```[\s\S]*?```/g, ' Bloco de código. ');
    cleanText = cleanText.replace(/\*/g, ''); 
    cleanText = cleanText.replace(/<[^>]*>/g, ''); 
    
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.9; 
    
    window.speechSynthesis.speak(utterance);
  };
  
  const handleModelResponse = useCallback(async (responseText: string, isUserCopyRequest: boolean = false) => {
      const codeBlockRegex = /<codeblock>(.*?)<\/codeblock>/s;
      const highlightRegex = /<highlight>([\s\S]*?)<\/highlight>/i;
      const switchAgentRegex = /\[\[SWITCH_AGENT:(.*?)\]\]/i;

      const switchMatch = responseText.match(switchAgentRegex);
      if (switchMatch && switchMatch[1]) {
          const agentName = switchMatch[1].trim();
          onSwitchAgentCommand(agentName);
      }

      let modelTextWithoutSwitch = responseText.replace(switchAgentRegex, '').trim();

      const highlightMatch = modelTextWithoutSwitch.match(highlightRegex);
      if (highlightMatch && highlightMatch[1]) {
          try {
              let jsonStr = highlightMatch[1].trim();
              jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '');
              
              const coords = JSON.parse(jsonStr);
              if (typeof coords.x === 'number' && typeof coords.y === 'number') {
                  if (isScreenSharing || isCameraActive) {
                      const blob = await captureScreenAsBlob();
                      if (blob) {
                          const newImageUrl = await blobToDataURL(blob);
                          setVisualHelp({ image: newImageUrl, highlight: coords });
                      }
                  } else {
                      const lastUserImage = activeMessages.slice().reverse().find(m => m.role === 'user' && m.imageUrl)?.imageUrl;
                      if (lastUserImage) {
                          setVisualHelp({ image: lastUserImage, highlight: coords });
                      }
                  }
              }
          } catch (e) {
              console.error("Failed to parse highlight coordinates:", e);
          }
      }

      let modelTextWithoutHighlight = modelTextWithoutSwitch.replace(highlightRegex, '').trim();
      let explanationText = '';
      let codeText: string | undefined;
      let copyableBlockText: string | undefined; 

      const codeMatch = modelTextWithoutHighlight.match(codeBlockRegex);

      if (codeMatch && codeMatch[1]) {
          codeText = codeMatch[1].trim();
          explanationText = modelTextWithoutHighlight.replace(codeBlockRegex, '').trim();
      } else {
          explanationText = modelTextWithoutHighlight;
      }
      
      if (isUserCopyRequest && !codeText && explanationText.length < 500) {
          copyableBlockText = explanationText;
      }

      const messageId = await addMessage('model', modelTextWithoutHighlight, { 
          blockType: codeText ? 'code' : copyableBlockText ? 'text' : undefined
      });
      
      if (messageId && explanationText.length > TEXT_COMPRESSION_THRESHOLD) {
          generateAndStoreSummary(messageId, explanationText);
      }
  }, [addMessage, generateAndStoreSummary, activeMessages, isScreenSharing, isCameraActive, captureScreenAsBlob, onSwitchAgentCommand]);
  
  const onModelStartSpeaking = useCallback(() => {
    setIsSpeaking(true);
    startSilenceTimer();
  }, [startSilenceTimer]);

  const onModelStopSpeaking = useCallback((text: string) => {
    setIsSpeaking(false);
    clearSilenceTimer();
    if (lastProcessedResponseRef.current === text) {
        return;
    }
    lastProcessedResponseRef.current = text;
    handleModelResponse(text);
  }, [clearSilenceTimer, handleModelResponse]);

  const onUserStopSpeaking = useCallback((text: string) => {
      lastProcessedResponseRef.current = ''; 
      resetInactivityTimer(); 
      addMessage('user', text);
      checkAndSaveProgrammingLevel(text);
      shouldAutoScrollRef.current = true; 
  }, [addMessage, checkAndSaveProgrammingLevel, resetInactivityTimer]);

  const handleToggleMicrophone = async (skipCheck = false) => {
    if (isMicActive && !skipCheck) {
      setIsMicActive(false);
      resetInactivityTimer(); 
      
      if (liveSessionControllerRef.current) {
          liveSessionControllerRef.current.stopMicrophoneInput();
      }
      
      playBeep(outputAudioContextRef.current, 300, 150);
      enviarStatusParaExtensao(false);

      if (!isScreenSharing && !isCameraActive) {
          disconnectSession();
      } 

    } else {
      setIsMicLoading(true);
      resetInactivityTimer(); 
      try {
        nextStartTimeRef.current = 0;

        if (outputAudioContextRef.current?.state === 'closed') {
            outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
            if (audioAnalyserRef.current) {
                audioAnalyserRef.current.disconnect();
                audioAnalyserRef.current = outputAudioContextRef.current.createAnalyser();
                audioAnalyserRef.current.fftSize = 256;
                audioAnalyserRef.current.connect(outputAudioContextRef.current.destination);
            }
        }

        await outputAudioContextRef.current?.resume();
        await inputAudioContextRef.current?.resume();
        window.speechSynthesis.cancel(); 

        if (liveSessionControllerRef.current) {
             liveSessionControllerRef.current.stopPlayback();
             await liveSessionControllerRef.current.startMicrophone();
             setIsMicActive(true);
             setIsMicLoading(false);
             playBeep(outputAudioContextRef.current, 600, 150); 
             enviarStatusParaExtensao(true);
             return;
        }

        let agentInstruction = "";
        const customAgent = customAgents.find(a => a.id === activeAgent);
        if (customAgent) {
            agentInstruction = `\n\n${customAgent.systemInstruction}`;
        }

        const controller = createLiveSession(
            {
                onOpen: () => {
                    setIsMicActive(true);
                    setIsMicLoading(false);
                    playBeep(outputAudioContextRef.current, 600, 150); 
                    enviarStatusParaExtensao(true);
                },
                onClose: () => {
                    liveSessionControllerRef.current = null;
                    if (isMicActiveRef.current) {
                         setTimeout(() => handleToggleMicrophone(true), 500);
                    } else {
                        setIsMicActive(false);
                        setIsMicLoading(false);
                        enviarStatusParaExtensao(false);
                    }
                },
                onError: (e) => {
                    liveSessionControllerRef.current = null;
                    if (isMicActiveRef.current) {
                        setTimeout(() => handleToggleMicrophone(true), 1000);
                        return;
                    }
                    setIsMicActive(false);
                    setIsMicLoading(false);
                    enviarStatusParaExtensao(false);
                },
                onInputTranscriptionUpdate: (text) => setCurrentInputTranscription(text),
                onOutputTranscriptionUpdate: (text) => setCurrentOutputTranscription(text),
                onModelStartSpeaking: onModelStartSpeaking,
                onModelStopSpeaking: onModelStopSpeaking,
                onUserStopSpeaking: onUserStopSpeaking,
                onTurnComplete: () => { },
                onInterrupt: () => { setIsSpeaking(false); clearSilenceTimer(); },
                onDeactivateScreenSharingCommand: () => stopScreenSharing(),
                onActivateScreenSharingCommand: () => startScreenSharing(),
                onActivateCameraCommand: () => startCamera(),
                onDeactivateCameraCommand: () => stopCamera(),
                onSwitchAgentCommand: onSwitchAgentCommand,
                onSessionReady: (session) => { }
            },
            inputAudioContextRef.current!,
            outputAudioContextRef.current!,
            nextStartTimeRef,
            micStreamRef,
            audioAnalyserRef.current, 
            activeMessages, 
            activeAgent,
            isScreenSharing || isCameraActive,
            initialUserData.programmingLevel,
            agentInstruction,
            voiceName,
            isSummarizedMode 
        );

        liveSessionControllerRef.current = controller;
        await controller.startMicrophone();

      } catch (error) {
          setIsMicLoading(false);
          setIsMicActive(false);
      }
    }
  };

  const handleSend = async () => {
      if (!textInput.trim() || isSendingText) return;

      setIsSendingText(true);
      resetInactivityTimer(); 
      const messageText = textInput;
      setTextInput('');
      shouldAutoScrollRef.current = true; 
      
      window.speechSynthesis.cancel(); 

      await addMessage('user', messageText);
      checkAndSaveProgrammingLevel(messageText);

      let fileData = undefined;
      const fileInput = attachmentFileInputRef.current;
      if (fileInput && fileInput.files && fileInput.files[0]) {
          const file = fileInput.files[0];
          try {
              const base64 = await blobToBase64(file);
              fileData = { base64, mimeType: file.type };
              await addMessage('user', 'Enviou uma imagem.', { imageUrl: `data:${file.type};base64,${base64}` });
          } catch (e) {}
          fileInput.value = ''; 
      }

      if (!fileData && (isScreenSharing || isCameraActive)) {
          const blob = await captureScreenAsBlob();
          if (blob) {
               const base64 = await blobToBase64(blob);
               fileData = { base64, mimeType: 'image/jpeg' };
          }
      }
      
      try {
          let agentInstruction = "";
          const customAgent = customAgents.find(a => a.id === activeAgent);
          if (customAgent) agentInstruction = customAgent.systemInstruction;
          
          const result = await sendTextMessage(
              messageText, 
              activeMessages, 
              activeAgent, 
              fileData, 
              isScreenSharing || isCameraActive,
              initialUserData.programmingLevel,
              agentInstruction,
              isSummarizedMode 
          );
          
          if (result && result.text) {
              await handleModelResponse(result.text, messageText.toLowerCase().includes("copie") || messageText.toLowerCase().includes("copy"));
              if (isTextToSpeechEnabled) {
                  speakText(result.text);
              }

              const inputLen = messageText.length + (fileData ? 1000 : 0);
              const outputLen = result.text.length;
              updateUsage(
                  Math.ceil(inputLen / 4) + Math.ceil(outputLen / 4), 
                  (inputLen / 4 * COST_PER_INPUT_TOKEN) + (outputLen / 4 * COST_PER_OUTPUT_TOKEN)
              );
          }
      } catch (e: any) {
      } finally {
          setIsSendingText(false);
      }
  };

  const handleToggleTextToSpeech = async () => {
      resetInactivityTimer(); 
      const newState = !isTextToSpeechEnabled;
      setIsTextToSpeechEnabled(newState);
      if (!newState) {
          window.speechSynthesis.cancel();
      }
      try {
          await updateDoc(doc(db, 'users', user.uid), { textToSpeechEnabled: newState });
      } catch (e) {}
  };


  return (
    <div className={`flex h-[100dvh] w-full bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans overflow-hidden transition-colors duration-300 ${theme === 'light' ? 'theme-light' : ''}`}>
      <canvas ref={canvasRef} className="hidden" />
      
      <aside className={`${isSidebarOpen && !isImmersiveMode ? 'md:flex' : 'hidden'} hidden flex-col w-72 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] transition-all duration-300`}>
         <div className="p-6 border-b border-[var(--border-color)] flex items-center justify-between">
             <GideaoLogo className="text-2xl" />
             <button onClick={() => setIsSettingsModalOpen(true)} className="p-2 hover:bg-[var(--bg-tertiary)] rounded-full transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
             </button>
         </div>

         <div className="flex-1 overflow-y-auto p-4 space-y-2">
             <button onClick={handleNewChat} className="w-full py-3 px-4 bg-[var(--accent-primary)] text-[var(--accent-primary-text)] font-bold rounded-lg hover:bg-[var(--accent-primary-hover)] transition-colors shadow-md flex items-center justify-center space-x-2">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                 <span>Nova Conversa</span>
             </button>

             <button 
                onClick={() => setIsImmersiveMode(true)}
                className="w-full py-2 px-4 mt-2 bg-[var(--bg-tertiary)] hover:bg-[var(--accent-primary)] hover:text-[var(--accent-primary-text)] text-[var(--text-secondary)] font-semibold rounded-lg transition-colors flex items-center justify-center space-x-2 border border-[var(--border-color)]"
             >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                 </svg>
                 <span>Modo Imersivo</span>
             </button>

             <button 
                onClick={() => setIsBugReportOpen(true)}
                className="w-full py-2 px-4 mt-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 font-semibold rounded-lg transition-colors flex items-center justify-center space-x-2 border border-red-900/30"
             >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                 </svg>
                 <span>Reportar Erros</span>
             </button>

             <button 
                onClick={() => setIsSummarizedMode(!isSummarizedMode)}
                className={`w-full py-2 px-4 mt-2 font-semibold rounded-lg transition-colors flex items-center justify-center space-x-2 border ${
                    isSummarizedMode 
                    ? 'bg-green-600 hover:bg-green-700 text-white border-green-500' 
                    : 'bg-[var(--bg-tertiary)] hover:bg-[var(--accent-primary)] hover:text-[var(--accent-primary-text)] text-[var(--text-secondary)] border-[var(--border-color)]'
                }`}
             >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h8m-8 6h16" />
                 </svg>
                 <span>{isSummarizedMode ? 'Modo Resumido: ON' : 'Modo Resumido'}</span>
             </button>

             <div className="mt-6">
                 <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3 px-2">Histórico</h3>
                 {isConversationsLoading ? (
                     <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-6 w-6 border-2 border-[var(--accent-primary)]"></div></div>
                 ) : (
                     <ul className="space-y-1">
                         {activeConversations.map(convo => (
                             <li key={convo.id} className={`group relative flex items-center rounded-lg transition-colors ${activeConversationId === convo.id ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/50 hover:text-[var(--text-primary)]'}`}>
                                 <button onClick={() => setActiveConversationId(convo.id)} className="flex-1 text-left px-3 py-2.5 truncate text-sm">
                                     {editingConversationId === convo.id ? (
                                         <input 
                                             type="text" 
                                             value={editTitleInput} 
                                             onChange={e => setEditTitleInput(e.target.value)} 
                                             onKeyDown={e => handleEditKeyDown(e, convo.id)}
                                             onBlur={() => saveConversationTitle(convo.id)}
                                             autoFocus
                                             className="w-full bg-transparent border-b border-[var(--accent-primary)] focus:outline-none"
                                         />
                                     ) : convo.title}
                                 </button>
                                 {activeConversationId === convo.id && (
                                     <div className="hidden group-hover:flex items-center pr-2 space-x-1">
                                          <button onClick={() => startEditingConversation(convo)} className="p-1 hover:text-[var(--accent-primary)]" title="Renomear"><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                                          <button onClick={() => handleArchiveConversation(convo.id)} className="p-1 hover:text-[var(--accent-primary)]" title="Arquivar"><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg></button>
                                          <button onClick={() => setChatToDelete(convo)} className="p-1 hover:text-red-500" title="Excluir"><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                                     </div>
                                 )}
                             </li>
                         ))}
                     </ul>
                 )}
             </div>
         </div>
         
         <div className="p-4 border-t border-[var(--border-color)]">
             <div className="mt-4 flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <div className="flex items-center space-x-2">
                    {profilePicUrl ? (
                         <img src={profilePicUrl} alt="User" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                         <div className="w-8 h-8 rounded-full bg-[var(--accent-primary)] flex items-center justify-center text-white font-bold">{user.email ? user.email[0].toUpperCase() : 'U'}</div>
                    )}
                    <span className="truncate max-w-[100px]">{user.name || 'Usuário'}</span>
                </div>
                <button onClick={handleLogout} className="hover:text-[var(--text-primary)]">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                </button>
             </div>
         </div>
      </aside>

      {isImmersiveMode && (
         <div className="fixed inset-0 z-50 bg-[var(--bg-primary)] flex flex-col items-center justify-center animate-fade-in">
             <button 
                 onClick={() => setIsImmersiveMode(false)}
                 className="absolute top-6 right-6 p-3 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--accent-primary)] text-[var(--text-secondary)] hover:text-white transition-all z-50"
             >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
             </button>

             <div className="flex-1 w-full h-full flex items-center justify-center relative">
                 <canvas ref={immersiveCanvasRef} className="w-full h-full absolute inset-0" />
                 
                 {(currentInputTranscription || currentOutputTranscription) && (
                     <div className="absolute top-1/4 w-full text-center px-4">
                         <p className="text-xl md:text-3xl font-light text-[var(--text-primary)] animate-pulse max-w-4xl mx-auto leading-relaxed drop-shadow-lg">
                             {currentInputTranscription || currentOutputTranscription}
                         </p>
                     </div>
                 )}
             </div>

             <div className="absolute bottom-8 flex items-center gap-6 p-4 rounded-full bg-[var(--bg-secondary)]/50 backdrop-blur-md border border-[var(--border-color)]/30">
                 <button onClick={handleToggleTextToSpeech} className={`p-3 rounded-full transition-colors ${isTextToSpeechEnabled ? 'text-green-400' : 'text-[var(--text-secondary)] hover:text-white'}`}>
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                 </button>
                 
                 <div className="w-px h-6 bg-[var(--border-color)]/50"></div>

                 <button onClick={() => { setIsImmersiveMode(false); setTimeout(() => textareaRef.current?.focus(), 100); }} className="p-3 rounded-full text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                 </button>

                 <button 
                    onClick={() => handleToggleMicrophone()}
                    className={`p-4 rounded-full transition-all duration-300 shadow-lg ${isMicActive ? 'bg-green-500 text-white animate-pulse' : 'bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)]'}`}
                 >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                 </button>

                 <button onClick={isCameraActive ? stopCamera : startCamera} className={`p-3 rounded-full transition-colors ${isCameraActive ? 'text-white bg-green-500 animate-pulse shadow-lg' : 'text-[var(--text-secondary)] hover:text-white'}`}>
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                 </button>

                 <button onClick={isScreenSharing ? stopScreenSharing : startScreenSharing} className={`p-3 rounded-full transition-colors ${isScreenSharing ? 'text-white bg-green-500 animate-pulse shadow-lg' : 'text-[var(--text-secondary)] hover:text-white'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                 </button>
             </div>
         </div>
      )}

      <main className={`flex-1 flex flex-col relative h-full transition-opacity duration-500 overflow-hidden ${isImmersiveMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
         
         <div className="h-16 border-b border-[var(--border-color)] flex items-center justify-between px-4 bg-[var(--bg-primary)] z-10 flex-shrink-0">
             
             <div className="flex items-center z-10">
                 <button 
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
                    className="p-2 mr-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
                    title={isSidebarOpen ? "Expandir Tela (Ocultar Menu)" : "Mostrar Menu"}
                 >
                     {isSidebarOpen ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                     ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                     )}
                 </button>

                 <div className="md:hidden">
                    <GideaoLogo className="text-xl" />
                 </div>
             </div>

             <div className="flex-1 flex justify-center relative">
                 <button 
                    onClick={() => setIsAgentsModalOpen(true)}
                    className="relative z-10 flex items-center space-x-2 px-4 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] rounded-full transition-colors border border-[var(--border-color)]"
                 >
                     <span className={`w-2.5 h-2.5 rounded-full ${activeAgent !== 'default' ? 'bg-[var(--accent-primary)]' : 'bg-gray-400'}`}></span>
                     <span className="font-semibold text-sm hidden sm:inline">
                        {customAgents.find(a => a.id === activeAgent)?.name || 
                         SYSTEM_AGENTS.find(a => a.id === activeAgent)?.name || 
                         'Assistente Padrão'}
                     </span>
                      <span className="font-semibold text-sm sm:hidden">
                        Agentes
                     </span>
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                 </button>
             </div>
             <div className="flex items-center z-10">
                 <button 
                    onClick={() => { setIsNotificationsModalOpen(true); markNotificationsAsSeen(); }}
                    className={`relative p-2 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] rounded-full transition-colors mr-2 md:mr-0 ${unreadNotifications ? 'pulse-bell' : ''}`}
                 >
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                     </svg>
                     {unreadNotifications && (
                         <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 bg-red-500 rounded-full border border-[var(--bg-primary)]"></span>
                     )}
                 </button>
             </div>
         </div>

        <div className={`w-full flex justify-center bg-[var(--bg-primary)]/50 backdrop-blur-sm border-b border-[var(--border-color)] transition-all duration-300 overflow-hidden flex-shrink-0 ${isCameraActive || isScreenSharing ? 'py-4 max-h-[50vh] opacity-100' : 'max-h-0 opacity-0 border-none'}`}>
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border border-[var(--border-color)] bg-black max-w-2xl w-full min-h-[200px]">
                <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="w-full h-auto max-h-[40vh] object-contain"
                />
                <div className="absolute top-4 left-4 flex items-center space-x-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full z-10">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-white text-xs font-bold tracking-wider">AO VIVO</span>
                </div>
            </div>
        </div>

         <div 
             className="flex-1 overflow-y-auto p-4 space-y-6 relative min-h-0" 
             id="chat-container"
             ref={chatContainerRef}
             onScroll={handleChatScroll}
         >
            {isMessagesLoading ? (
                 <LoadingSpinner message="Carregando mensagens..." />
             ) : activeMessages.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-[var(--text-secondary)] opacity-60">
                     <GideaoLogo className="mb-4 opacity-50" />
                     <p>Inicie uma conversa por voz ou texto.</p>
                 </div>
             ) : (
                 activeMessages.map((msg) => (
                     <div key={msg.id} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                         <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl p-4 shadow-sm relative group ${
                             msg.role === 'user' 
                             ? 'bg-[var(--accent-primary)] text-[var(--accent-primary-text)] rounded-tr-none' 
                             : msg.role === 'system'
                               ? 'bg-[var(--bg-tertiary)] border border-[var(--destructive-color)]/30 text-[var(--text-primary)] w-full text-center text-sm py-2'
                               : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-tl-none'
                         }`}>
                             {msg.role !== 'system' && (
                                 <div className={`absolute top-2 ${msg.role === 'user' ? '-left-10' : '-right-10'} opacity-0 group-hover:opacity-100 transition-opacity`}>
                                     <MessageActions messageText={msg.text} messageId={msg.id} />
                                 </div>
                             )}
                             
                             {msg.imageUrl && (
                                 <div className="mb-3 rounded-lg overflow-hidden border border-black/10">
                                     <img src={msg.imageUrl} alt="User upload" className="max-w-full h-auto" />
                                 </div>
                             )}

                             {msg.blockType === 'code' || msg.blockType === 'text' || msg.blockType === 'prompt' ? (
                                <CopyableContentBlock content={msg.text} blockType={msg.blockType} />
                             ) : (
                                <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                             )}
                             
                             {msg.role !== 'system' && (
                                <p className={`text-[10px] mt-2 text-right ${msg.role === 'user' ? 'text-black/40' : 'text-gray-500'}`}>
                                    {msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </p>
                             )}
                         </div>
                     </div>
                 ))
             )}
             
             {(currentInputTranscription || currentOutputTranscription) && (
                 <div className="flex w-full justify-center my-4">
                     <div className="bg-[var(--bg-tertiary)]/90 backdrop-blur-sm border border-[var(--accent-primary)] rounded-lg p-4 max-w-xl text-center shadow-lg animate-pulse">
                         <p className="text-sm font-medium text-[var(--accent-primary)] mb-1">
                             {currentInputTranscription ? 'Ouvindo...' : 'Gideão está falando...'}
                         </p>
                         <p className="text-lg text-[var(--text-primary)]">
                             {currentInputTranscription || currentOutputTranscription}
                         </p>
                     </div>
                 </div>
             )}
             
             {silencePromptVisible && isMicActive && !isSpeaking && (
                 <div className="flex w-full justify-center my-2">
                     <div className="bg-yellow-500/20 text-yellow-200 text-xs px-3 py-1 rounded-full border border-yellow-500/30">
                         Gideão está ouvindo... (Fale "Pare de ouvir" para encerrar)
                     </div>
                 </div>
             )}
         </div>

         <div className="p-4 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex-shrink-0">
             <div className="max-w-4xl mx-auto flex items-end space-x-2">
                 <button
                    onClick={handleToggleTextToSpeech}
                    className={`p-2.5 rounded-xl transition-all mr-1 ${isTextToSpeechEnabled ? 'bg-green-500/20 text-green-500 border border-green-500' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'}`}
                    title={isTextToSpeechEnabled ? "Desativar Leitura em Voz Alta" : "Ativar Leitura em Voz Alta"}
                 >
                    {isTextToSpeechEnabled ? (
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                    ) : (
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" stroke-dasharray="2 2"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>
                    )}
                 </button>

                 <div className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl flex flex-col px-4 py-2 focus-within:ring-2 focus-within:ring-[var(--accent-primary)] transition-shadow">
                     <div className="flex items-center w-full">
                        <input 
                            type="file" 
                            ref={attachmentFileInputRef} 
                            className="hidden" 
                            accept="image/*"
                            onChange={() => { if(attachmentFileInputRef.current?.files?.length) handleSend(); }} 
                        />
                        <button onClick={() => attachmentFileInputRef.current?.click()} className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] p-1 mr-2" title="Anexar Imagem">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </button>
                        <textarea 
                            ref={textareaRef}
                            value={textInput}
                            onChange={(e) => setTextInput(e.target.value)}
                            onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                            placeholder="Digite sua mensagem..."
                            className="flex-1 bg-transparent border-none focus:outline-none resize-none max-h-32 py-2 text-sm"
                            rows={1}
                        />
                     </div>
                     <canvas 
                        ref={visualizerCanvasRef} 
                        width={300} 
                        height={10} 
                        className="w-full h-3 mt-1 opacity-80"
                     />
                 </div>
                 
                 <button 
                    onClick={handleSend}
                    disabled={!textInput.trim() && !isMicActive} 
                    className={`p-3 rounded-xl transition-all ${textInput.trim() ? 'bg-[var(--accent-primary)] text-[var(--accent-primary-text)] shadow-lg hover:scale-105' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'}`}
                 >
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                 </button>

                 <div className="h-8 w-px bg-[var(--border-color)] mx-2"></div>
                 
                 <button 
                    onClick={() => handleToggleMicrophone()}
                    className={`p-4 rounded-full transition-all duration-300 shadow-xl relative ${isMicActive ? 'bg-green-500 text-white hover:bg-green-600 animate-pulse' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--accent-primary)] hover:text-[var(--accent-primary-text)]'}`}
                    title={isMicActive ? "Parar Microfone" : "Iniciar Voz"}
                 >
                     {isMicLoading ? (
                         <div className="animate-spin h-6 w-6 border-2 border-current rounded-full border-t-transparent"></div>
                     ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                     )}
                 </button>

                 <button
                    onClick={isCameraActive ? stopCamera : startCamera}
                    className={`p-3 rounded-xl transition-all ${isCameraActive ? 'bg-green-500 text-white shadow-lg animate-pulse' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'}`}
                    title={isCameraActive ? "Desligar Câmera" : "Ligar Câmera"}
                 >
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                 </button>

                 <button 
                    onClick={isScreenSharing ? stopScreenSharing : startScreenSharing}
                    className={`p-3 rounded-xl transition-all ${isScreenSharing ? 'bg-green-500 text-white shadow-lg animate-pulse' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'}`}
                    title={isScreenSharing ? "Parar Compartilhamento" : "Compartilhar Tela"}
                 >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                 </button>
             </div>
             <p className="text-center text-[10px] text-[var(--text-secondary)] mt-2 opacity-50">Use os botões para controlar o microfone, câmera e tela.</p>
         </div>

         {errorMessage && (
             <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-xl z-50 flex items-center animate-bounce">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                 {errorMessage}
                 <button onClick={() => setErrorMessage(null)} className="ml-4 font-bold hover:text-red-200">&times;</button>
             </div>
         )}
      </main>

      <VisualHelpModal data={visualHelp} onClose={() => setVisualHelp(null)} />
      
      <ConfirmationModal 
          isOpen={!!chatToDelete} 
          onClose={() => setChatToDelete(null)}
          onConfirm={handleDeleteConversation}
          title="Excluir Conversa"
          message="Tem certeza que deseja excluir esta conversa? Esta ação não pode ser desfeita."
      />
      
      <NotificationsModal
          isOpen={isNotificationsModalOpen}
          onClose={() => setIsNotificationsModalOpen(false)}
          notifications={notifications}
      />
      
      <BugReportModal 
         isOpen={isBugReportOpen}
         onClose={() => setIsBugReportOpen(false)}
         user={user}
      />

      <AgentsModal 
        isOpen={isAgentsModalOpen}
        onClose={() => setIsAgentsModalOpen(false)}
        onActivate={handleActivateAgent}
        onDeactivate={handleDeactivateAgent}
        activeAgent={activeAgent}
        customAgents={customAgents}
        onCreateAgent={async (name, desc, instr) => {
            if(!user) return;
            try {
                await addDoc(collection(db, `users/${user.uid}/custom_agents`), {
                    name, description: desc, systemInstruction: instr, createdAt: serverTimestamp()
                });
            } catch(e) {}
        }}
        onUpdateAgent={async (id, name, desc, instr) => {
             if(!user) return;
             try {
                 await updateDoc(doc(db, `users/${user.uid}/custom_agents`, id), {
                     name, description: desc, systemInstruction: instr
                 });
             } catch(e) {}
        }}
        onDeleteAgent={async (id) => {
             if(!user) return;
             if(confirm("Excluir este agente?")) {
                 try {
                     await deleteDoc(doc(db, `users/${user.uid}/custom_agents`, id));
                     if(activeAgent === id) handleActivateAgent('default');
                 } catch(e) {}
             }
        }}
      />

      <ArchivedConversationsModal
          isOpen={isArchivedModalOpen}
          onClose={() => setIsArchivedModalOpen(false)}
          archivedConversations={archivedConversations}
          onRestoreConversation={handleRestoreConversation}
      />

       {isSettingsModalOpen && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setIsSettingsModalOpen(false)}>
               <div className="bg-[var(--bg-secondary)] p-8 rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                   <h2 className="text-2xl font-bold mb-4">Configurações</h2>
                   <div className="space-y-4">
                       <div>
                           <label className="block text-sm mb-1 text-[var(--text-secondary)]">Tema</label>
                           <select 
                                value={theme} 
                                onChange={e => {
                                    const newTheme = e.target.value;
                                    setTheme(newTheme);
                                    updateDoc(doc(db, 'users', user.uid), { theme: newTheme });
                                }}
                                className="w-full p-2 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] mb-3"
                           >
                               <option value="dark">Escuro</option>
                               <option value="light">Claro</option>
                           </select>
                       </div>
                       
                       <div className="bg-[var(--bg-primary)] p-4 rounded-lg border border-[var(--border-color)]">
                           <label className="block text-sm mb-2 text-[var(--text-secondary)] font-bold">Personalizar Cor do Sistema</label>
                           <p className="text-xs text-[var(--text-secondary)] mb-3">Escolha uma cor para alterar todo o visual do Gideão.</p>
                           
                           <div className="flex items-center gap-4">
                               <input 
                                   type="color" 
                                   value={tempColor}
                                   onChange={(e) => {
                                       setTempColor(e.target.value);
                                       if (onApplyTheme) onApplyTheme(theme, e.target.value);
                                   }}
                                   className="h-12 w-12 cursor-pointer border-none bg-transparent rounded-full overflow-hidden shadow-sm"
                               />
                               <div className="flex-1">
                                   <div className="text-sm font-mono text-[var(--text-primary)] mb-1">{tempColor}</div>
                                   <div className="flex gap-2">
                                       <button 
                                           onClick={() => {
                                               setCustomThemeColor(tempColor);
                                               if (onApplyTheme) onApplyTheme(theme, tempColor);
                                               updateDoc(doc(db, 'users', user.uid), { customThemeColor: tempColor });
                                           }}
                                           className="px-3 py-1.5 bg-[var(--accent-primary)] text-[var(--accent-primary-text)] rounded text-xs font-bold hover:opacity-90 transition-opacity"
                                       >
                                           Aplicar Cor
                                       </button>
                                       <button 
                                           onClick={() => {
                                               const defaultBlue = '#00B7FF';
                                               setTempColor(defaultBlue);
                                               setCustomThemeColor(defaultBlue);
                                               if (onApplyTheme) onApplyTheme(theme, defaultBlue);
                                               updateDoc(doc(db, 'users', user.uid), { customThemeColor: defaultBlue });
                                           }}
                                           className="px-3 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded text-xs hover:text-[var(--text-primary)] transition-colors"
                                       >
                                           Restaurar
                                       </button>
                                   </div>
                               </div>
                           </div>
                       </div>

                       <div>
                           <label className="block text-sm mb-1 text-[var(--text-secondary)]">Voz do Sistema</label>
                           <select 
                                value={voiceName}
                                onChange={e => {
                                    const v = e.target.value;
                                    setVoiceName(v);
                                    updateDoc(doc(db, 'users', user.uid), { voiceName: v });
                                }}
                                className="w-full p-2 rounded bg-[var(--bg-primary)] border border-[var(--border-color)]"
                           >
                               <option value="Kore">Kore (Padrão - Feminina)</option>
                               <option value="Fenrir">Fenrir (Masculina Profunda)</option>
                               <option value="Puck">Puck (Masculina Suave)</option>
                               <option value="Charon">Charon (Masculina Séria)</option>
                               <option value="Aoede">Aoede (Feminina Suave)</option>
                           </select>
                       </div>
                       <div className="pt-4 border-t border-[var(--border-color)]">
                            <a 
                                onClick={() => { setIsSettingsModalOpen(false); setIsArchivedModalOpen(true); }}
                                className="block py-2 text-[var(--accent-primary)] hover:underline cursor-pointer"
                            >
                                Conversas Arquivadas
                            </a>
                            <a href="/#/ajuda-e-suporte" className="block py-2 text-[var(--accent-primary)] hover:underline">Ajuda e Suporte</a>
                            <a href="/#/termos-e-condicoes" className="block py-2 text-[var(--accent-primary)] hover:underline">Termos e Condições</a>
                            <a href="/#/seguranca" className="block py-2 text-[var(--accent-primary)] hover:underline">Segurança</a>
                            <a href="/#/comandos-de-voz" className="block py-2 text-[var(--accent-primary)] hover:underline">Guia de Comandos</a>
                       </div>
                   </div>
                   <button onClick={() => setIsSettingsModalOpen(false)} className="mt-6 w-full py-2 bg-[var(--bg-tertiary)] rounded-lg hover:bg-[var(--border-color)] transition-colors">Fechar</button>
               </div>
           </div>
       )}

    </div>
  );
};

export default App;
