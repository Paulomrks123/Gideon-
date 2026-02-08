
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createLiveSession, LiveSessionController, sendTextMessage } from './services/geminiService';
import { ConversationMessage } from './types';
import { GenerateContentResponse } from "@google/genai";

type Agent = string;

const SYSTEM_AGENTS = [
    {
        id: 'default',
        name: 'Assistente Padrão',
        description: 'Versátil para qualquer tarefa.',
        icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
    },
    {
        id: 'luzia',
        name: 'Luzia (Paraibana)',
        description: 'Voz carinhosa e amorosa.',
        icon: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z'
    },
    {
        id: 'programmer',
        name: 'Programador Sênior',
        description: 'Análise de código e debug.',
        icon: 'M16 18l6-6-6-6M8 6l-6 6 6 6'
    }
];

export default function App({ user, initialUserData, onApplyTheme }: any) {
    const [activeAgent, setActiveAgent] = useState<Agent>('default');
    const [messages, setMessages] = useState<ConversationMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [isMicOn, setIsMicOn] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(initialUserData?.theme !== 'light');
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const liveSessionRef = useRef<LiveSessionController | null>(null);
    const inputAudioCtxRef = useRef<AudioContext | null>(null);
    const outputAudioCtxRef = useRef<AudioContext | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const micStreamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const screenIntervalRef = useRef<number | null>(null);

    const activeAgentData = useMemo(() => 
        SYSTEM_AGENTS.find(a => a.id === activeAgent) || SYSTEM_AGENTS[0]
    , [activeAgent]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
        }
    }, [inputText]);

    const toggleTheme = () => {
        const newTheme = isDarkMode ? 'light' : 'dark';
        setIsDarkMode(!isDarkMode);
        onApplyTheme(newTheme, initialUserData?.customThemeColor || '#00B7FF');
    };

    const handleSwitchAgent = (agentId: string) => {
        setActiveAgent(agentId);
        setIsSidebarOpen(false);
        if (isMicOn) {
            toggleMic();
            setTimeout(() => toggleMic(), 300);
        }
    };

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const stopScreenSharing = () => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
        }
        if (screenIntervalRef.current) {
            window.clearInterval(screenIntervalRef.current);
            screenIntervalRef.current = null;
        }
        setIsScreenSharing(false);
    };

    const startScreenSharing = async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 } });
            screenStreamRef.current = stream;
            setIsScreenSharing(true);
            
            stream.getTracks()[0].onended = () => stopScreenSharing();

            if (isMicOn && liveSessionRef.current) {
                beginVisionLoop();
            }
        } catch (err) {
            console.error("Erro ao compartilhar tela:", err);
        }
    };

    const beginVisionLoop = () => {
        if (!screenStreamRef.current || !liveSessionRef.current) return;
        
        const video = document.createElement('video');
        video.srcObject = screenStreamRef.current;
        video.play();
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        screenIntervalRef.current = window.setInterval(() => {
            if (video.videoWidth > 0 && ctx) {
                const ratio = Math.min(1, 768 / video.videoWidth);
                canvas.width = video.videoWidth * ratio;
                canvas.height = video.videoHeight * ratio;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                
                const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                liveSessionRef.current?.sessionPromise.then(session => {
                    session.sendRealtimeInput({
                        media: { data: base64, mimeType: 'image/jpeg' }
                    });
                });
            }
        }, 1500);
    };

    const toggleMic = async () => {
        if (isMicOn) {
            liveSessionRef.current?.closeSession();
            setIsMicOn(false);
            if (screenIntervalRef.current) {
                window.clearInterval(screenIntervalRef.current);
                screenIntervalRef.current = null;
            }
        } else {
            if (!inputAudioCtxRef.current) inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            if (!outputAudioCtxRef.current) outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            
            if (inputAudioCtxRef.current.state === 'suspended') await inputAudioCtxRef.current.resume();
            if (outputAudioCtxRef.current.state === 'suspended') await outputAudioCtxRef.current.resume();

            liveSessionRef.current = createLiveSession(
                {
                    onOpen: () => {
                        setIsMicOn(true);
                        if (isScreenSharing) beginVisionLoop();
                    },
                    onClose: () => setIsMicOn(false),
                    onTurnComplete: () => {},
                    onModelStopSpeaking: (text: string) => {
                        if (text) setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text, timestamp: new Date() }]);
                    },
                    onUserStopSpeaking: (text: string) => {
                        if (text) setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'user', text, timestamp: new Date() }]);
                    }
                },
                inputAudioCtxRef.current,
                outputAudioCtxRef.current,
                nextStartTimeRef,
                micStreamRef,
                null,
                messages,
                activeAgent,
                isScreenSharing,
                'advanced',
                '',
                'Kore',
                false
            );
            await liveSessionRef.current.startMicrophone();
        }
    };

    const handleSendMessage = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!inputText.trim() || isSending) return;

        const userMsg: ConversationMessage = {
            id: Date.now().toString(),
            role: 'user',
            text: inputText,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setIsSending(true);

        try {
            const response: GenerateContentResponse = await sendTextMessage(
                userMsg.text,
                messages,
                activeAgent,
                undefined,
                false,
                'advanced',
                '',
                false
            );

            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: response.text || "Sem resposta.",
                timestamp: new Date()
            }]);
        } catch (error) {
            console.error(error);
        } finally {
            setIsSending(false);
        }
    };

    const themeStyles = isDarkMode ? {
        bg: '#0b141a',
        sidebar: '#111b21',
        header: '#202c33',
        border: '#222d34',
        text: '#e9edef',
        textSec: '#8696a0',
        input: '#2a3942',
        bubbleUser: '#005c4b',
        bubbleIA: '#202c33'
    } : {
        bg: '#f0f2f5',
        sidebar: '#ffffff',
        header: '#f0f2f5',
        border: '#d1d7db',
        text: '#111b21',
        textSec: '#667781',
        input: '#ffffff',
        bubbleUser: '#dcf8c6',
        bubbleIA: '#ffffff'
    };

    return (
        <div className="flex h-screen overflow-hidden font-sans transition-colors duration-300" style={{ backgroundColor: themeStyles.bg }}>
            {/* Sidebar */}
            <div 
                className={`fixed inset-y-0 left-0 z-50 w-72 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out border-r flex flex-col shadow-2xl lg:relative lg:translate-x-0`}
                style={{ backgroundColor: themeStyles.sidebar, borderColor: themeStyles.border }}
            >
                <div className="p-4 flex justify-between items-center shrink-0" style={{ backgroundColor: themeStyles.header }}>
                    <h2 className="font-bold text-lg" style={{ color: themeStyles.text }}>Especialistas</h2>
                    <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-black/10 transition-colors">
                         {isDarkMode ? (
                             <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" /></svg>
                         ) : (
                             <svg className="w-5 h-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" /></svg>
                         )}
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {SYSTEM_AGENTS.map(agent => (
                        <div 
                            key={agent.id}
                            onClick={() => handleSwitchAgent(agent.id)}
                            className={`p-4 flex items-center gap-4 cursor-pointer hover:opacity-80 transition-all border-b ${activeAgent === agent.id ? 'opacity-100 shadow-inner' : 'opacity-60'}`}
                            style={{ backgroundColor: activeAgent === agent.id ? (isDarkMode ? '#2a3942' : '#f0f2f5') : 'transparent', borderColor: themeStyles.border }}
                        >
                            <div className="w-12 h-12 bg-indigo-500 rounded-full flex items-center justify-center shrink-0">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={agent.icon} /></svg>
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="font-medium truncate" style={{ color: themeStyles.text }}>{agent.name}</h3>
                                <p className="text-xs truncate" style={{ color: themeStyles.textSec }}>{agent.description}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 flex flex-col relative">
                <header className="h-16 border-b flex items-center px-4 gap-4 shrink-0 z-30 shadow-sm" style={{ backgroundColor: themeStyles.header, borderColor: themeStyles.border }}>
                    <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden" style={{ color: themeStyles.textSec }}>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
                    </button>
                    <div className="w-10 h-10 bg-indigo-500 rounded-full flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={activeAgentData.icon} /></svg>
                    </div>
                    <div className="flex-1">
                        <h1 className="font-bold text-base" style={{ color: themeStyles.text }}>{activeAgentData.name}</h1>
                        <p className="text-xs" style={{ color: themeStyles.textSec }}>{isMicOn ? 'Ouvindo...' : 'Ativo agora'}</p>
                    </div>
                    <button 
                        onClick={isScreenSharing ? stopScreenSharing : startScreenSharing}
                        className={`p-2 rounded-full transition-all ${isScreenSharing ? 'text-indigo-500 bg-indigo-500/10' : ''}`}
                        title="Transmitir Tela"
                        style={{ color: isScreenSharing ? '#3b82f6' : themeStyles.textSec }}
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-opacity-5" style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')" }}>
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div 
                                className={`max-w-[85%] md:max-w-[70%] rounded-2xl p-3 shadow-sm relative group transition-all ${msg.role === 'user' ? 'rounded-tr-none' : 'rounded-tl-none'}`}
                                style={{ backgroundColor: msg.role === 'user' ? themeStyles.bubbleUser : themeStyles.bubbleIA, color: themeStyles.text }}
                            >
                                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                                
                                {msg.role === 'model' && (
                                    <button 
                                        onClick={() => copyToClipboard(msg.text, msg.id)}
                                        className="absolute -top-2 -right-2 p-1.5 rounded-full bg-slate-700/80 text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                                        title="Copiar texto"
                                    >
                                        {copiedId === msg.id ? (
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                        ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                        )}
                                    </button>
                                )}

                                <span className="text-[10px] opacity-50 mt-1 block text-right">
                                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                <footer className="p-3 flex items-end gap-3 shrink-0 border-t" style={{ backgroundColor: themeStyles.header, borderColor: themeStyles.border }}>
                    <form 
                        onSubmit={handleSendMessage} 
                        className="flex-1 flex items-end bg-opacity-10 rounded-xl overflow-hidden shadow-sm"
                        style={{ backgroundColor: themeStyles.input }}
                    >
                        <textarea 
                            ref={textareaRef}
                            rows={1}
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                            placeholder="Digite uma mensagem"
                            className="w-full px-4 py-2.5 focus:outline-none text-sm transition-all bg-transparent resize-none overflow-y-auto"
                            style={{ color: themeStyles.text }}
                        />
                        <button 
                            type="submit" 
                            disabled={!inputText.trim() || isSending} 
                            className="p-2.5 disabled:opacity-30 transition-colors" 
                            style={{ color: '#00a884' }}
                        >
                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                        </button>
                    </form>
                    <button 
                        onClick={toggleMic}
                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg shrink-0 ${isMicOn ? 'bg-red-500 animate-pulse scale-110' : 'bg-[#00a884] hover:bg-[#008f72]'}`}
                    >
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {isMicOn ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H10a1 1 0 01-1-1v-4z" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />}
                        </svg>
                    </button>
                </footer>
            </div>
        </div>
    );
}
