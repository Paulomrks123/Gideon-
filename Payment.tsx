import React from 'react';
import { auth, signOut } from './firebase';
import type { User } from 'firebase/auth';
import { UserProfile } from './types';

const HypleyLogo = ({ className = "" }) => (
    <div className={`text-4xl font-extrabold ${className}`}>
        <span className="text-[var(--text-primary)]">HYPLEY</span><span className="text-[var(--accent-primary)]"> IA</span>
    </div>
);

interface PaymentProps {
  user: User;
  userData: Partial<UserProfile>;
}

export const Payment: React.FC<PaymentProps> = ({ user, userData }) => {
  const handleLogout = async () => { try { await signOut(auth); } catch (e) {} };
  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg-primary)] p-4">
        <div className="container mx-auto max-w-lg w-full">
            <div className="bg-[var(--bg-secondary)] rounded-2xl shadow-2xl overflow-hidden p-8 md:p-12 text-center border border-[var(--border-color)]">
                <HypleyLogo className="mb-8 mx-auto" />
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-4">Tudo Pronto!</h1>
                    <p className="text-[var(--text-primary)] mb-2">Sua conta HYPLEY IA foi criada com sucesso.</p>
                </div>
                <div className="mb-8 p-6 border rounded-xl bg-[var(--bg-primary)]/30">
                    <p className="text-base text-[var(--text-primary)] mb-6">Envie seu e-mail <strong>({user.email})</strong> para o suporte para ativar.</p>
                    <a href={`https://wa.me/5521997088624?text=Olá, criei minha conta no HYPLEY IA. Meu email é: ${user.email}.`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-full py-4 px-6 bg-[#25D366] text-white font-bold rounded-lg gap-2 text-lg">Falar com Suporte</a>
                </div>
                <div className="border-t pt-6"><button onClick={handleLogout} className="text-[var(--text-secondary)] hover:underline text-sm">Sair</button></div>
            </div>
        </div>
    </div>
  );
};