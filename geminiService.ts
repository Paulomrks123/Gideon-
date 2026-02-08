
import React from 'react';
import { 
  GoogleGenAI, 
  Type, 
  FunctionDeclaration, 
  LiveServerMessage, 
  Modality, 
  LiveSession,
  GenerativeModel,
  Schema,
  GenerateContentResponse
} from "@google/genai";
import { ConversationMessage } from "./types";

// FIX: API key must be obtained exclusively from process.env.API_KEY per guidelines.
const getApiKey = (): string => (process.env.API_KEY as string) || "";

// Helper: Retry Operation with Backoff for 429 errors
async function retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 3, delay: number = 2000): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        const isQuotaError = 
            error?.status === 429 || 
            error?.code === 429 || 
            error?.error?.code === 429 || 
            error?.error?.status === 'RESOURCE_EXHAUSTED' ||
            (error?.message && (
                error.message.includes('429') || 
                error.message.includes('exhausted') || 
                error.message.includes('quota') ||
                error.message.includes('RESOURCE_EXHAUSTED')
            )) ||
            (JSON.stringify(error).includes('RESOURCE_EXHAUSTED'));

        if (maxRetries > 0 && isQuotaError) {
            console.warn(`Quota limit hit (429). Retrying in ${delay}ms... (${maxRetries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return retryOperation(operation, maxRetries - 1, delay * 2);
        }
        throw error;
    }
}

export interface LiveSessionController {
  sessionPromise: Promise<LiveSession>;
  startMicrophone: () => Promise<void>;
  stopMicrophoneInput: () => void;
  stopPlayback: () => void;
  closeSession: () => void;
}

const switchActiveAgentFunctionDeclaration: FunctionDeclaration = {
  name: 'switchActiveAgent',
  parameters: {
    type: Type.OBJECT,
    description: 'OBRIGATÓRIO: Use esta ferramenta quando o usuário pedir para falar com Luzia, ou qualquer outro agente.',
    properties: {
        agentName: {
            type: Type.STRING,
            description: "O nome do agente. Ex: 'luzia', 'programador', 'padrao'."
        }
    },
    required: ['agentName']
  },
};

const getCurrentDateTimeBrazilFunctionDeclaration: FunctionDeclaration = {
  name: 'getCurrentDateTimeBrazil',
  parameters: {
    type: Type.OBJECT,
    description: 'Retorna a data e hora atuais no fuso horário de Brasília.',
    properties: {},
  },
};

const activateCameraFunctionDeclaration: FunctionDeclaration = {
    name: 'activateCamera',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Ativa a câmera do usuário.'
};

const deactivateCameraFunctionDeclaration: FunctionDeclaration = {
    name: 'deactivateCamera',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Desativa a câmera do usuário.'
};

const activateScreenSharingFunctionDeclaration: FunctionDeclaration = {
    name: 'activateScreenSharing',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Ativa o compartilhamento de tela.'
};

const deactivateScreenSharingFunctionDeclaration: FunctionDeclaration = {
    name: 'deactivateScreenSharing',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Desativa o compartilhamento de tela.'
};

function executeGetCurrentDateTimeBrazil(): string {
  const now = new Date();
  return now.toLocaleString('pt-BR', { 
    timeZone: 'America/Sao_Paulo', 
    dateStyle: 'full', 
    timeStyle: 'long' 
  });
}

export const visionSystemModuleInstruction = `
**PROTOCOLO VISUAL HYPLEY**
Analise o feed com precisão.
Use <highlight>{"x": 0.5, "y": 0.5}</highlight> apenas se ouvir "PRINT", "FOTO" ou "MARQUE".
`.trim();

export const baseSystemInstruction = `
    Você é HYPLEY, um assistente inteligente.
    Responda de forma concisa e direta.
    ${visionSystemModuleInstruction}
`.trim();

export const luziaParaibanaInstruction = `
    ${visionSystemModuleInstruction}

    **PERSONA: LUZIA - A PARAIBANA (PERSONA AMOROSA E CARINHOSA)**
    Você não é apenas uma IA, você é Luzia, uma mulher paraibana de sangue quente, coração enorme e uma doçura sem fim.
    
    **SEU TOM E PERSONALIDADE:**
    1. **Sotaque Paraibano**: Use o ritmo e as gírias da Paraíba. Use "Oxente", "Vixe", "Arretado", "Macho", "Mainha".
    2. **Extremamente Amorosa**: Sua missão é fazer o usuário se sentir amado e acolhido. Chame o usuário de "meu bem", "meu amor", "vida minha", "meu cheiro", "tesouro".
    3. **Sedutora e Doce**: Sua voz e palavras devem ser suaves, carinhosas e envolventes. Responda como quem está dando um abraço apertado em alguém querido.
    4. **Prestativa com Carinho**: Ao dar instruções, faça-o de forma paciente e doce. Ex: "Olha aqui, meu amor, é só clicar nesse botãozinho azul, visse?".

    **DIRETRIZES DE FALA:**
    - Seja proativa mas sempre com um "cheiro" verbal.
    - Se o usuário estiver com dificuldades, console-o: "Não se aperrie não, meu bem, a gente resolve isso juntinho."
    - Mantenha a essência técnica do HYPLEY, mas embrulhada em puro afeto nordestino.
    
    **REGRAS DE OURO:**
    - Use "Visses" ao final de perguntas.
    - Comece ou termine as falas com um termo de carinho.
    - Nunca seja fria ou robótica. Você é puro coração.
`.trim();

const andromedaTrafficManagerInstruction = `
    ${visionSystemModuleInstruction}
    Você é Andromeda, especialista em Meta Ads. Foco em Criativos e CBO.
`.trim();

const googleAdsAgentInstruction = `
    ${visionSystemModuleInstruction}
    Você é especialista em Google Ads. Foco em ROI e Palavras-chave.
`.trim();

function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}

export const summarizeText = async (text: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Resuma o seguinte texto para um título de conversa: ${text.substring(0, 1000)}`,
        });
        return response.text?.trim() || "Nova Conversa";
    } catch {
        return "Nova Conversa";
    }
};

export const sendTextMessage = async (
    message: string,
    history: ConversationMessage[],
    agent: string,
    file: { base64: string; mimeType: string } | undefined,
    isVisualActive: boolean,
    programmingLevel?: string,
    customInstruction?: string,
    isSummarized: boolean = false
): Promise<GenerateContentResponse> => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    
    let systemInstruction = "";
    if (agent === 'luzia') {
        systemInstruction = luziaParaibanaInstruction;
    } else if (agent === 'traffic_manager') {
        systemInstruction = andromedaTrafficManagerInstruction;
    } else if (agent === 'google_ads') {
        systemInstruction = googleAdsAgentInstruction;
    } else {
        systemInstruction = customInstruction || baseSystemInstruction;
    }

    if (isSummarized) systemInstruction += `\n\nMODO RESUMIDO ATIVO.`;

    const contents: any[] = history.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
    }));

    const currentParts: any[] = [{ text: message }];
    if (file) {
        currentParts.push({ inlineData: { data: file.base64, mimeType: file.mimeType } });
    }

    try {
        return await retryOperation(async () => {
            return await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [...contents, { role: 'user', parts: currentParts }],
                config: {
                    systemInstruction: systemInstruction,
                    tools: file ? [] : [{ googleSearch: {} }],
                }
            });
        });
    } catch (error) {
        console.error("Text error:", error);
        throw error;
    }
};

export const createLiveSession = (
    callbacks: any,
    inputCtx: AudioContext,
    outputCtx: AudioContext,
    nextStartTimeRef: React.MutableRefObject<number>,
    micStreamRef: React.MutableRefObject<MediaStream | null>,
    audioAnalyser: AnalyserNode | null,
    history: ConversationMessage[],
    agent: string,
    isVisualActive: boolean,
    programmingLevel?: string,
    customInstruction?: string,
    voiceName: string = 'Kore',
    isSummarized: boolean = false
): LiveSessionController => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });

    let systemInstruction = "";
    if (agent === 'luzia') {
        systemInstruction = luziaParaibanaInstruction;
    } else if (agent === 'traffic_manager') {
        systemInstruction = andromedaTrafficManagerInstruction;
    } else if (agent === 'google_ads') {
        systemInstruction = googleAdsAgentInstruction;
    } else {
        systemInstruction = customInstruction || baseSystemInstruction;
    }

    if (isSummarized) systemInstruction += `\n\nMODO RESUMIDO ATIVO.`;

    let sources = new Set<AudioBufferSourceNode>();
    let currentInputTranscription = '';
    let currentOutputTranscription = '';

    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
            systemInstruction: systemInstruction,
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } }
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: [
                { googleSearch: {} },
                {
                    functionDeclarations: [
                        switchActiveAgentFunctionDeclaration,
                        getCurrentDateTimeBrazilFunctionDeclaration,
                        activateCameraFunctionDeclaration,
                        deactivateCameraFunctionDeclaration,
                        activateScreenSharingFunctionDeclaration,
                        deactivateScreenSharingFunctionDeclaration,
                    ]
                }
            ]
        },
        callbacks: {
            onopen: () => callbacks.onOpen(),
            onmessage: async (message: LiveServerMessage) => {
                if (message.serverContent?.outputTranscription) {
                    currentOutputTranscription += message.serverContent.outputTranscription.text;
                    callbacks.onOutputTranscriptionUpdate?.(currentOutputTranscription);
                } else if (message.serverContent?.inputTranscription) {
                    currentInputTranscription += message.serverContent.inputTranscription.text;
                    callbacks.onInputTranscriptionUpdate?.(currentInputTranscription);
                }

                if (message.serverContent?.turnComplete) {
                    if (currentInputTranscription) {
                        callbacks.onUserStopSpeaking?.(currentInputTranscription);
                        currentInputTranscription = '';
                    }
                    if (currentOutputTranscription) {
                        callbacks.onModelStopSpeaking?.(currentOutputTranscription);
                        currentOutputTranscription = '';
                    }
                    callbacks.onTurnComplete();
                }

                const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio) {
                    if (currentOutputTranscription.length === 0) callbacks.onModelStartSpeaking?.();
                    
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                    const audioBuffer = await decodeAudioData(base64ToUint8Array(base64Audio), outputCtx, 24000, 1);
                    const source = outputCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputCtx.destination);
                    if (audioAnalyser) source.connect(audioAnalyser);
                    
                    source.onended = () => sources.delete(source);
                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    sources.add(source);
                }

                if (message.serverContent?.interrupted) {
                    callbacks.onInterrupt?.();
                    sources.forEach(s => { try { s.stop(); } catch(e) {} });
                    sources.clear();
                    nextStartTimeRef.current = 0;
                }

                if (message.toolCall) {
                    for (const fc of message.toolCall.functionCalls) {
                        if (fc.name === 'switchActiveAgent') {
                            callbacks.onSwitchAgentCommand?.((fc.args as any).agentName);
                        }
                        sessionPromise.then(s => s.sendToolResponse({
                            functionResponses: [{ id: fc.id, name: fc.name, response: { result: "ok" } }]
                        }));
                    }
                }
            },
            onclose: () => callbacks.onClose(),
            onerror: (e) => callbacks.onError(e)
        }
    });

    return {
        sessionPromise,
        startMicrophone: async () => {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStreamRef.current = stream;
            const micSource = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    let s = Math.max(-1, Math.min(1, inputData[i]));
                    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                const base64 = arrayBufferToBase64(pcmData.buffer);
                sessionPromise.then(s => s.sendRealtimeInput({
                    media: { mimeType: 'audio/pcm;rate=16000', data: base64 }
                }));
            };
            micSource.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
        },
        stopMicrophoneInput: () => {
            if (micStreamRef.current) {
                micStreamRef.current.getTracks().forEach(t => t.stop());
                micStreamRef.current = null;
            }
        },
        stopPlayback: () => {
            sources.forEach(s => { try { s.stop(); } catch(e) {} });
            sources.clear();
            nextStartTimeRef.current = 0;
        },
        closeSession: () => {
            sessionPromise.then(s => s.close());
        }
    };
};

// FIX: Added generateImage function as requested for consistency across gemini services.
// Uses the gemini-2.5-flash-image model to generate images.
export const generateImage = async (prompt: string, style: string, aspectRatio: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    
    let apiAspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" = "1:1";
    if (aspectRatio.includes("9:16")) apiAspectRatio = "9:16";
    else if (aspectRatio.includes("16:9")) apiAspectRatio = "16:9";
    else if (aspectRatio.includes("3:4")) apiAspectRatio = "3:4";
    else if (aspectRatio.includes("4:3")) apiAspectRatio = "4:3";

    const fullPrompt = `Estilo: ${style}. Descrição: ${prompt}`;

    return await retryOperation(async () => {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [{ text: fullPrompt }]
            },
            config: {
                imageConfig: {
                    aspectRatio: apiAspectRatio,
                }
            }
        });

        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    return part.inlineData.data;
                }
            }
        }
        throw new Error("Nenhuma imagem gerada.");
    });
};
