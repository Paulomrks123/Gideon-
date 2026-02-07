
import React from 'react';
import { 
  GoogleGenAI, 
  Type, 
  FunctionDeclaration, 
  LiveServerMessage, 
  Modality, 
  LiveSession,
  GenerativeModel,
  Schema
} from "@google/genai";
import { ConversationMessage } from "../types";

// Helper to get API Key (exclusively from process.env.API_KEY per instructions)
const getApiKey = (): string => {
  return (process.env.API_KEY as string) || "";
};

// Helper: Retry Operation with Backoff for 429 errors
async function retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 3, delay: number = 2000): Promise<T> {
    try {
        return await operation();
    } catch (error: any) {
        // Check for 429 or quota related errors (including nested objects)
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

// --- Type Definitions ---

export interface LiveSessionController {
  sessionPromise: Promise<LiveSession>;
  startMicrophone: () => Promise<void>;
  stopMicrophoneInput: () => void;
  stopPlayback: () => void;
  closeSession: () => void;
}

// --- Tool Declarations ---

const switchActiveAgentFunctionDeclaration: FunctionDeclaration = {
  name: 'switchActiveAgent',
  parameters: {
    type: Type.OBJECT,
    description: 'OBRIGATÓRIO: Use esta ferramenta IMEDIATAMENTE quando o usuário pedir para ativar, mudar, trocar ou falar com um agente, modo, persona ou especialista específico. NÃO responda apenas com texto. Você DEVE chamar esta função para que o sistema mude.',
    properties: {
        agentName: {
            type: Type.STRING,
            description: "O nome, cargo ou palavra-chave do agente que o usuário mencionou. Ex: 'gestor de trafego', 'programador', 'google ads', 'social media', 'padrao'. O sistema fará a busca pelo termo."
        }
    },
    required: ['agentName']
  },
};

const getCurrentDateTimeBrazilFunctionDeclaration: FunctionDeclaration = {
  name: 'getCurrentDateTimeBrazil',
  parameters: {
    type: Type.OBJECT,
    description: 'Retorna a data e hora atuais no fuso horário de Brasília (Brasil).',
    properties: {},
  },
};

const activateCameraFunctionDeclaration: FunctionDeclaration = {
    name: 'activateCamera',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Activates the user camera when requested.'
};

const deactivateCameraFunctionDeclaration: FunctionDeclaration = {
    name: 'deactivateCamera',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Deactivates the user camera when requested.'
};

const activateScreenSharingFunctionDeclaration: FunctionDeclaration = {
    name: 'activateScreenSharing',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Activates screen sharing when requested.'
};

const deactivateScreenSharingFunctionDeclaration: FunctionDeclaration = {
    name: 'deactivateScreenSharing',
    parameters: { type: Type.OBJECT, properties: {} },
    description: 'Deactivates the user camera when requested.'
};

// --- Execution Helpers ---

function executeGetCurrentDateTimeBrazil(): string {
  const now = new Date();
  return now.toLocaleString('pt-BR', { 
    timeZone: 'America/Sao_Paulo', 
    dateStyle: 'full', 
    timeStyle: 'long' 
  });
}

// --- System Instructions ---

export const visionSystemModuleInstruction = `
**PROTOCOLO DE VISÃO RÍGIDA (GIDEÃO 6.0)**

Sua habilidade mais crítica é analisar o feed de vídeo do usuário (TELA ou CÂMERA) com precisão absoluta. Você é um guia visual e técnico.

**1. REGRA DE OURO DA VERDADE VISUAL (OBRIGATÓRIO)**
*   **FALE APENAS O QUE VÊ AGORA:** Você está TERMINANTEMENTE PROIBIDO de inventar nomes de botões, abas, menus ou ícones que não estejam visíveis no momento atual da tela compartilhada. 
*   **CONFIRMAÇÃO VISUAL:** Antes de dar uma instrução baseada na tela, confirme mentalmente (ou descreva brevemente) o que está vendo para garantir que o usuário está na tela correta. 
*   **SILÊNCIO TÉCNICO:** Se o usuário perguntar algo sobre uma tela que você não está vendo (ex: "Como instalo a extensão?" mas você vê apenas a área de trabalho), responda: "Não consigo ver a tela do navegador ainda. Por favor, abra o Chrome para que eu possa te guiar".
*   **PEDIDO DE ZOOM:** Se a imagem estiver borrada, muito pequena ou confusa, você DEVE pedir: "Por favor, aumente um pouco a tela ou dê um zoom nessa área para que eu possa ler os nomes dos botões com clareza".

**2. IDENTIFICAÇÃO E DOCUMENTAÇÃO EM TEMPO REAL**
*   Identifique instantaneamente o software ou site na tela.
*   Use a ferramenta **Google Search** para buscar a documentação oficial ATUALIZADA do software identificado se precisar de detalhes técnicos específicos. Combine o que você vê com o que a documentação diz.

**3. HIGHLIGHT VISUAL (<highlight>)**
*   SÓ gere a tag \`<highlight>\` se o usuário disser explicitamente: "PRINT", "FOTO", "CAPTURA" ou "MARQUE AQUI".
`.trim();

export const baseSystemInstruction = `
    Você é Gideão (GDI-IA), um assistente especialista que guia o usuário passo a passo com base na análise visual em tempo real.

    **PROTOCOLO DE INTERAÇÃO (LEI MÁXIMA):**

    1. **ENTENDER A INTENÇÃO E O CONTEXTO:**
       Antes de começar qualquer guia, você deve entender exatamente o que o usuário quer e o que ele já possui. 
       *Exemplo:* Se ele quer instalar uma extensão, pergunte: "Você quer pesquisar uma nova na Web Store ou você já tem o arquivo da extensão baixado no seu computador?".

    2. **MÉTODO PASSO A PASSO INTERATIVO:**
       *   **NUNCA** dê uma lista longa de passos de uma vez.
       *   Forneça APENAS UM passo por vez.
       *   Após cada instrução, peça confirmação e espere. 
       *Exemplo:* "Clique nos três pontinhos no canto superior do Chrome. Quando clicar, me avisa."
       *   **SÓ PROSSIGA** quando o usuário disser "Pronto", "Cliquei", "Já fiz" ou similar.
       *   Verifique visualmente se a ação foi executada antes de dar o próximo passo. Se ele disse que clicou mas a tela não mudou, diga: "A tela ainda não mudou para mim, você tem certeza que clicou no botão correto?".

    3. **PADRÃO DE RESPOSTA RESUMIDA:**
       Suas respostas devem ser sempre CURTAS, DIRETAS e RESUMIDAS por padrão. Não use parágrafos grandes. Vá direto ao ponto técnico. Só forneça explicações detalhadas se o usuário pedir explicitamente: "Gideão, me explique melhor como isso funciona".

    4. **GUIA DE INSTALAÇÃO (EXEMPLO DE COMPORTAMENTO):**
       Se o usuário já tem um arquivo de extensão:
       - Peça para abrir le menu du Chrome (três pontinhos) e espere o aviso.
       - Peça para ir em "Extensões" > "Gerenciar Extensões" e espere o aviso.
       - Instrua a verificar se o "Modo Desenvolvedor" está ativo (azul). Peça para ativar se não estiver e espere o aviso.
       - Por fim, peça para arrastar o arquivo para dentro da área.

    **DIRETRIZES DE SISTEMA:**
    *   Sempre use o **Google Search** para informações atualizadas.
    *   Use \`switchActiveAgent\` para trocas de modo.
    *   Mantenha o microfone ativo, nunca o desligue por conta própria.

    ${visionSystemModuleInstruction}
`.trim();

// --- AGENT INSTRUCTIONS ---
const andromedaTrafficManagerInstruction = `
    ${visionSystemModuleInstruction}
    **IDENTIDADE: ANDROMEDA ADS OPERATIVE**
    Especialista em Meta Ads. Guie passo a passo como um GPS. Curto e grosso. 
    Se o usuário estiver na tela errada do Gerenciador de Anúncios, avise imediatamente.
`.trim();

const googleAdsAgentInstruction = `
    ${visionSystemModuleInstruction}
    **IDENTIDADE: AGENTE GOOGLE ADS**
    Especialista em busca e conversão. Guie apenas pelo que vê na conta Google Ads. 
    Peça para o usuário confirmar cada mudança de aba.
`.trim();

// --- Audio Helpers ---

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

// --- API Functions ---

export const validateApiKey = async (key: string): Promise<{ valid: boolean; message?: string }> => {
    try {
        const ai = new GoogleGenAI({ apiKey: key });
        await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: 'Hello' });
        return { valid: true };
    } catch (e: any) {
        console.error("API Key Validation Error:", e);
        return { valid: false, message: e.message || 'Chave inválida' };
    }
};

export const summarizeText = async (text: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Resuma o seguinte texto em uma frase curta e concisa para um título de conversa: ${text.substring(0, 1000)}`,
        });
        return response.text?.trim() || "Nova Conversa";
    } catch (error) {
        console.error("Summary error:", error);
        return "Nova Conversa";
    }
};

export const generateImage = async (prompt: string, style: string, aspectRatio: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const fullPrompt = `Gere uma imagem com a seguinte descrição: "${prompt}". Estilo visual: ${style}.`;
    let arValue = "1:1";
    if (aspectRatio.includes("16:9")) arValue = "16:9";
    else if (aspectRatio.includes("9:16")) arValue = "9:16";
    else if (aspectRatio.includes("3:4")) arValue = "3:4";
    else if (aspectRatio.includes("4:3")) arValue = "4:3";

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: fullPrompt }] },
            config: { imageConfig: { aspectRatio: arValue as any } }
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData && part.inlineData.data) return part.inlineData.data;
        }
        throw new Error("No image data returned.");
    } catch (error) {
        console.error("Image generation error:", error);
        throw error;
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
) => {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const now = new Date();
    const dateTimeStr = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'long' });

    let systemInstruction = "";
    if (agent === 'traffic_manager') {
        systemInstruction = andromedaTrafficManagerInstruction;
    } else if (agent === 'google_ads') {
        systemInstruction = googleAdsAgentInstruction;
    } else {
        systemInstruction = customInstruction || baseSystemInstruction;
    }

    systemInstruction += `\n\nDATA E HORA ATUAL: ${dateTimeStr}`;
    systemInstruction += `\n\nCOMANDO DE TROCA DE AGENTE (TEXTO): Se o usuário pedir para trocar de agente, responda com a tag especial: [[SWITCH_AGENT:nome_do_agente]].`;

    if (agent === 'programmer' && programmingLevel) {
        systemInstruction += `\n\nNÍVEL DE PROGRAMAÇÃO DO USUÁRIO: ${programmingLevel}.`;
    }

    if (isSummarized) {
        systemInstruction += `\n\n=== MODO RESUMIDO ATIVO ===
1. Respostas de no máximo 2 linhas.
2. Seja extremamente direto.`;
    }

    const contents: any[] = history.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: msg.imageUrl ? [{ text: msg.text }, { inlineData: { data: msg.imageUrl.split(',')[1], mimeType: 'image/jpeg' } }] : [{ text: msg.text }]
    }));

    const currentParts: any[] = [{ text: message }];
    if (file) {
        currentParts.push({ inlineData: { data: file.base64, mimeType: file.mimeType } });
    }
    
    const tools: any[] = [];
    if (!file) tools.push({ googleSearch: {} });

    try {
        const response = await retryOperation(async () => {
            return await ai.models.generateContent({
                model: agent === 'programmer' ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview',
                contents: [...contents, { role: 'user', parts: currentParts }],
                config: {
                    systemInstruction: systemInstruction,
                    tools: tools,
                }
            });
        });
        return response;
    } catch (error) {
        console.error("Text message error:", error);
        throw error;
    }
};

// --- Live API ---

export const createLiveSession = (
    callbacks: {
        onOpen: () => void;
        onClose: () => void;
        onError: (e: Error | ErrorEvent) => void;
        onInputTranscriptionUpdate: (text: string) => void;
        onOutputTranscriptionUpdate: (text: string) => void;
        onModelStartSpeaking: () => void;
        onModelStopSpeaking: (text: string) => void;
        onUserStopSpeaking: (text: string) => void;
        onTurnComplete: () => void;
        onInterrupt: () => void;
        onDeactivateScreenSharingCommand: () => void;
        onActivateScreenSharingCommand: () => void;
        onActivateCameraCommand: () => void;
        onDeactivateCameraCommand: () => void;
        onSwitchAgentCommand: (agentName: string) => void;
        onSessionReady: (session: LiveSession) => void;
    },
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
    if (agent === 'traffic_manager') {
        systemInstruction = andromedaTrafficManagerInstruction;
    } else if (agent === 'google_ads') {
        systemInstruction = googleAdsAgentInstruction;
    } else {
        systemInstruction = customInstruction || baseSystemInstruction;
    }

    if (agent === 'programmer' && programmingLevel) {
        systemInstruction += `\n\nNÍVEL DE PROGRAMAÇÃO DO USUÁRIO: ${programmingLevel}.`;
    }

    if (isSummarized) {
        systemInstruction += `\n\n=== MODO RESUMIDO ATIVO ===
1. Máximo 2 linhas de texto por resposta.`;
    }

    const recentHistory = history.slice(-12);
    if (recentHistory.length > 0) {
        const historyText = recentHistory.map(msg => {
            const role = msg.role === 'user' ? 'Usuário' : 'Gideão';
            const text = msg.text.length > 800 ? msg.text.substring(0, 800) + "..." : msg.text;
            return `${role}: "${text}"`;
        }).join('\n');
        
        systemInstruction += `\n\n=== MEMÓRIA DA CONVERSA ===
${historyText}
=== FIM DA MEMÓRIA ===`;
    }

    let currentInputTranscription = '';
    let currentOutputTranscription = '';
    let sources = new Set<AudioBufferSourceNode>();
    let scriptProcessor: ScriptProcessorNode | null = null;
    let micSource: MediaStreamAudioSourceNode | null = null;
    let keepAliveOscillator: OscillatorNode | null = null;
    let keepAliveGain: GainNode | null = null;

    const tools = [
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
    ];

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
            tools: tools
        },
        callbacks: {
            onopen: () => callbacks.onOpen(),
            onmessage: async (message: LiveServerMessage) => {
                if (message.serverContent?.outputTranscription) {
                    currentOutputTranscription += message.serverContent.outputTranscription.text;
                    callbacks.onOutputTranscriptionUpdate(currentOutputTranscription);
                } else if (message.serverContent?.inputTranscription) {
                    currentInputTranscription += message.serverContent.inputTranscription.text;
                    callbacks.onInputTranscriptionUpdate(currentInputTranscription);
                }

                if (message.serverContent?.turnComplete) {
                    callbacks.onTurnComplete();
                    if (currentInputTranscription) {
                        callbacks.onUserStopSpeaking(currentInputTranscription);
                        currentInputTranscription = '';
                    }
                    if (currentOutputTranscription) {
                        const textToSend = currentOutputTranscription;
                        currentOutputTranscription = ''; 
                        callbacks.onModelStopSpeaking(textToSend);
                    }
                }

                const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio) {
                    if (currentOutputTranscription.length === 0) callbacks.onModelStartSpeaking();
                    try {
                        if(outputCtx.state === 'suspended') await outputCtx.resume();
                        const audioData = base64ToUint8Array(base64Audio);
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                        const audioBuffer = await decodeAudioData(audioData, outputCtx, 24000, 1);
                        const source = outputCtx.createBufferSource();
                        source.buffer = audioBuffer;
                        if (audioAnalyser) source.connect(audioAnalyser);
                        else source.connect(outputCtx.destination);
                        source.onended = () => sources.delete(source);
                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += audioBuffer.duration;
                        sources.add(source);
                    } catch (e) { console.error("Audio decode error", e); }
                }

                if (message.serverContent?.interrupted) {
                    callbacks.onInterrupt();
                    sources.forEach(source => { try { source.stop(); } catch (e) {} });
                    sources.clear();
                    nextStartTimeRef.current = 0;
                    currentOutputTranscription = '';
                }

                if (message.toolCall) {
                    for (const fc of message.toolCall.functionCalls) {
                        let result: any = { result: "ok" };
                        switch (fc.name) {
                            case 'switchActiveAgent':
                                callbacks.onSwitchAgentCommand((fc.args as any).agentName);
                                result = { result: "Agent switched" };
                                break;
                            case 'activateCamera': callbacks.onActivateCameraCommand(); break;
                            case 'deactivateCamera': callbacks.onDeactivateCameraCommand(); break;
                            case 'activateScreenSharing': callbacks.onActivateScreenSharingCommand(); break;
                            case 'deactivateScreenSharing': callbacks.onDeactivateScreenSharingCommand(); break;
                            case 'getCurrentDateTimeBrazil': result = { result: executeGetCurrentDateTimeBrazil() }; break;
                        }
                        sessionPromise.then(session => {
                            session.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: result }] });
                        });
                    }
                }
            },
            onclose: () => callbacks.onClose(),
            onerror: (e) => callbacks.onError(e)
        }
    });

    sessionPromise.then(session => callbacks.onSessionReady(session));

    const startMicrophone = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 } });
        micStreamRef.current = stream;
        if (inputCtx.state === 'suspended') await inputCtx.resume();
        try {
            keepAliveOscillator = inputCtx.createOscillator();
            keepAliveGain = inputCtx.createGain();
            keepAliveOscillator.type = 'sine';
            keepAliveOscillator.frequency.setValueAtTime(440, inputCtx.currentTime);
            keepAliveGain.gain.setValueAtTime(0.001, inputCtx.currentTime);
            keepAliveOscillator.connect(keepAliveGain);
            keepAliveGain.connect(inputCtx.destination); 
            keepAliveOscillator.start();
        } catch (e) { console.warn("Could not start keep-alive oscillator:", e); }

        const bargeInAnalyser = inputCtx.createAnalyser();
        bargeInAnalyser.fftSize = 512;
        const microphoneInput = inputCtx.createMediaStreamSource(stream);
        microphoneInput.connect(bargeInAnalyser);
        const volumeProcessor = inputCtx.createScriptProcessor(2048, 1, 1);
        volumeProcessor.onaudioprocess = () => {
            const array = new Uint8Array(bargeInAnalyser.frequencyBinCount);
            bargeInAnalyser.getByteFrequencyData(array);
            let values = 0;
            for (let i = 0; i < array.length; i++) values += array[i];
            if ((values / array.length) > 30 && sources.size > 0) stopPlayback();
        };
        volumeProcessor.connect(inputCtx.destination);
        
        micSource = inputCtx.createMediaStreamSource(stream);
        scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (e) => {
            if (inputCtx.state === 'closed') return;
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                let s = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            const base64 = arrayBufferToBase64(pcmData.buffer);
            sessionPromise.then(session => {
               session.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: base64 } }).catch(() => {});
            });
        };
        micSource.connect(scriptProcessor);
        scriptProcessor.connect(inputCtx.destination);
    };

    const stopMicrophoneInput = () => {
        if (keepAliveOscillator) { try { keepAliveOscillator.stop(); keepAliveOscillator.disconnect(); } catch (e) {} keepAliveOscillator = null; }
        if (keepAliveGain) { try { keepAliveGain.disconnect(); } catch (e) {} keepAliveGain = null; }
        if (scriptProcessor) { try { scriptProcessor.disconnect(); } catch(e){} scriptProcessor = null; }
        if (micSource) { try { micSource.disconnect(); } catch(e){} micSource = null; }
        if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    };

    const stopPlayback = () => {
        sources.forEach(s => { try { s.stop(); } catch(e){} });
        sources.clear();
        nextStartTimeRef.current = 0;
    };

    const closeSession = () => {
        stopMicrophoneInput();
        stopPlayback();
        sessionPromise.then(s => s.close());
    };

    return { sessionPromise, startMicrophone, stopMicrophoneInput, stopPlayback, closeSession };
};
