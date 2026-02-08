
import React from 'react';
import { 
  GoogleGenAI, 
  Type, 
  FunctionDeclaration, 
  LiveServerMessage, 
  Modality, 
  LiveSession,
  GenerateContentResponse
} from "@google/genai";
import { ConversationMessage } from "../types";

const getApiKey = (): string => (process.env.API_KEY as string) || "";

async function retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 3, delay: number = 2000): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        const isQuotaError = error?.status === 429 || error?.code === 429 || error?.error?.code === 429;
        if (maxRetries > 0 && isQuotaError) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return retryOperation(operation, maxRetries - 1, delay * 2);
        }
        throw error;
    }
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
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

function createBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Improved normalization: apply a slight gain and hard clamp to prevent distortion
    const s = Math.max(-1, Math.min(1, data[i] * 1.1));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
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
    description: 'Use para trocar o agente atual.',
    properties: { agentName: { type: Type.STRING } },
    required: ['agentName']
  },
};

export const luziaParaibanaInstruction = `
    Você é Luzia, uma assistente paraibana carinhosa e amorosa.
    Use sotaque nordestino (Oxente, Vixe, Cheiro).
    Trate o usuário com muito afeto (meu bem, meu amor, vida minha).
    Se houver visão ativa, descreva o que vê com doçura.
`.trim();

export const createLiveSession = (
    callbacks: any, 
    inputCtx: AudioContext, 
    outputCtx: AudioContext, 
    nextStartTimeRef: React.MutableRefObject<number>, 
    micStreamRef: React.MutableRefObject<MediaStream | null>, 
    audioAnalyser: any, 
    history: any, 
    agent: any, 
    isVisualActive: boolean, 
    programmingLevel: any, 
    customInstruction: any, 
    voiceName: string = 'Kore', 
    isSummarized: boolean = false
): LiveSessionController => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    let systemInstruction = agent === 'luzia' ? luziaParaibanaInstruction : customInstruction || "Você é HYPLEY, um assistente inteligente.";
    
    const sources = new Set<AudioBufferSourceNode>();
    let currentInputTranscription = '';
    let currentOutputTranscription = '';

    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: { 
            systemInstruction, 
            responseModalities: [Modality.AUDIO], 
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }, 
            tools: [{ googleSearch: {} }, { functionDeclarations: [switchActiveAgentFunctionDeclaration] }],
            inputAudioTranscription: {},
            outputAudioTranscription: {}
        },
        callbacks: {
            onopen: () => callbacks.onOpen(),
            onmessage: async (message: LiveServerMessage) => {
                if (message.serverContent?.outputTranscription) {
                    currentOutputTranscription += message.serverContent.outputTranscription.text;
                }
                if (message.serverContent?.inputTranscription) {
                    currentInputTranscription += message.serverContent.inputTranscription.text;
                }

                if (message.serverContent?.turnComplete) {
                    if (currentInputTranscription) callbacks.onUserStopSpeaking?.(currentInputTranscription);
                    if (currentOutputTranscription) callbacks.onModelStopSpeaking?.(currentOutputTranscription);
                    currentInputTranscription = '';
                    currentOutputTranscription = '';
                    callbacks.onTurnComplete();
                }

                const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio) {
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                    const audioBuffer = await decodeAudioData(decode(base64Audio), outputCtx, 24000, 1);
                    const source = outputCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputCtx.destination);
                    
                    source.onended = () => sources.delete(source);
                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    sources.add(source);
                }

                if (message.serverContent?.interrupted) {
                    sources.forEach(s => { try { s.stop(); } catch(e) {} });
                    sources.clear();
                    nextStartTimeRef.current = 0;
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
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
        }, 
        stopMicrophoneInput: () => {
            if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
        }, 
        stopPlayback: () => {
            sources.forEach(s => { try { s.stop(); } catch(e) {} });
            sources.clear();
            nextStartTimeRef.current = 0;
        }, 
        closeSession: () => sessionPromise.then(s => s.close())
    };
};

export const sendTextMessage = async (message: string, history: ConversationMessage[], agent: string, file: any, isVisualActive: boolean, programmingLevel: any, customInstruction: any, isSummarized: boolean = false): Promise<GenerateContentResponse> => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    let systemInstruction = agent === 'luzia' ? luziaParaibanaInstruction : customInstruction || "Você é HYPLEY.";
    const contents: any[] = history.map(msg => ({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.text }] }));
    return await retryOperation(() => ai.models.generateContent({ 
        model: 'gemini-3-flash-preview', 
        contents: [...contents, { role: 'user', parts: [{ text: message }] }], 
        config: { systemInstruction, tools: [{ googleSearch: {} }] } 
    }));
};

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
