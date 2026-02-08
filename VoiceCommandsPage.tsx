import React from 'react';

const VoiceCommandsPage = () => {
    return (
        <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans antialiased">
            <div className="container mx-auto px-4 py-12">
                <header className="text-center mb-12 relative">
                    <a href="#" className="absolute top-2 left-0 flex items-center text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] transition-colors text-lg font-medium z-10">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                        Voltar
                    </a>
                    <h1 className="text-6xl font-extrabold drop-shadow-[0_4px_15px_rgba(0,183,255,0.4)]">
                        <span className="text-white">HYPLEY</span><span className="text-[var(--accent-primary)]"> IA</span>
                    </h1>
                    <h2 className="text-3xl font-bold mt-2 text-white">Guia de Comandos de Voz</h2>
                    <p className="text-lg text-[var(--text-secondary)] mt-4 max-w-3xl mx-auto">Entenda como interagir de forma eficiente com o HYPLEY. A chave é a naturalidade: ele está sempre pronto para ajudar quando o microfone ou a tela estão ativos.</p>
                </header>
                <main className="max-w-4xl mx-auto prose prose-lg prose-invert">
                    <h3>Princípios Básicos da Interação</h3>
                    <p>O HYPLEY foi projetado para ser um copiloto atento.</p>
                </main>
            </div>
        </div>
    );
};

export default VoiceCommandsPage;