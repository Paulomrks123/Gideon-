
import React, { useState, useEffect } from 'react';
import { db, collection, getDocs, updateDoc, doc, increment, addDoc, serverTimestamp, query, orderBy, onSnapshot, deleteDoc } from './firebase';
import { UserProfile, SystemNotification, BugReport } from './types';

const HypleyLogo = ({ className = "" }) => (
    <div className={`text-4xl font-extrabold ${className}`}>
        <span className="text-white">HYPLEY</span><span className="text-[#00B7FF]"> IA</span>
        <span className="text-xs block font-normal text-gray-400 tracking-widest mt-1 uppercase">Administração</span>
    </div>
);

const AdminPanel = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        
        // Simulando um pequeno delay para feedback visual
        setTimeout(() => {
            if (email === 'orionvirtual.com.br@gmail.com' && password === 'poi987iop') {
                setIsAuthenticated(true);
            } else {
                alert('Credenciais administrativas inválidas.');
            }
            setIsLoading(false);
        }, 500);
    };

    if (!isAuthenticated) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-[#0f172a] p-4 font-sans">
                <div className="bg-[#1e293b] p-10 rounded-3xl max-w-md w-full border border-slate-700 shadow-2xl text-center">
                    <HypleyLogo className="mb-10" />
                    <form onSubmit={handleLogin} className="space-y-5">
                        <div className="text-left">
                            <label className="block text-slate-400 text-sm font-medium mb-1.5 ml-1">E-mail Administrativo</label>
                            <input 
                                type="email" 
                                value={email} 
                                onChange={(e) => setEmail(e.target.value)} 
                                className="w-full p-4 bg-[#0f172a] border border-slate-600 rounded-xl text-white focus:outline-none focus:border-[#00B7FF] transition-all" 
                                placeholder="exemplo@admin.com"
                                required
                            />
                        </div>
                        <div className="text-left">
                            <label className="block text-slate-400 text-sm font-medium mb-1.5 ml-1">Senha de Acesso</label>
                            <input 
                                type="password" 
                                value={password} 
                                onChange={(e) => setPassword(e.target.value)} 
                                className="w-full p-4 bg-[#0f172a] border border-slate-600 rounded-xl text-white focus:outline-none focus:border-[#00B7FF] transition-all" 
                                placeholder="••••••••"
                                required
                            />
                        </div>
                        <button 
                            type="submit" 
                            disabled={isLoading}
                            className="w-full bg-[#00B7FF] hover:bg-[#0096d1] text-[#0f172a] font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50"
                        >
                            {isLoading ? 'Autenticando...' : 'Liberar Acesso'}
                        </button>
                    </form>
                    <p className="mt-8 text-slate-500 text-xs">Acesso restrito a desenvolvedores autorizados.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0f172a] text-white font-sans">
            <header className="bg-[#1e293b] border-b border-slate-700 p-6 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
                    <HypleyLogo />
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-slate-400 hidden md:block">Logado como: <span className="text-white font-medium">{email}</span></span>
                        <button 
                            onClick={() => setIsAuthenticated(false)}
                            className="bg-slate-700 hover:bg-red-500/20 hover:text-red-400 px-4 py-2 rounded-lg text-sm transition-all"
                        >
                            Sair
                        </button>
                    </div>
                </div>
            </header>
            
            <main className="max-w-7xl mx-auto p-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    <div className="bg-[#1e293b] p-6 rounded-2xl border border-slate-700 shadow-sm">
                        <h3 className="text-slate-400 text-sm font-medium mb-1 uppercase tracking-wider">Usuários Ativos</h3>
                        <p className="text-3xl font-bold">--</p>
                    </div>
                    <div className="bg-[#1e293b] p-6 rounded-2xl border border-slate-700 shadow-sm">
                        <h3 className="text-slate-400 text-sm font-medium mb-1 uppercase tracking-wider">Requisições (24h)</h3>
                        <p className="text-3xl font-bold text-[#00B7FF]">--</p>
                    </div>
                    <div className="bg-[#1e293b] p-6 rounded-2xl border border-slate-700 shadow-sm">
                        <h3 className="text-slate-400 text-sm font-medium mb-1 uppercase tracking-wider">Alertas Pendentes</h3>
                        <p className="text-3xl font-bold text-orange-400">0</p>
                    </div>
                </div>

                <div className="bg-[#1e293b] p-8 rounded-3xl border border-slate-700 shadow-sm">
                    <h2 className="text-xl font-bold mb-6">Painel de Controle Principal</h2>
                    <div className="flex items-center justify-center h-64 border-2 border-dashed border-slate-700 rounded-2xl">
                        <p className="text-slate-500 text-center">
                            Área administrativa liberada.<br/>
                            Módulos de gestão de e-mails e permissões carregando...
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default AdminPanel;
