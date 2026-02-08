import React, { useState } from 'react';
import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, db, doc, setDoc, sendPasswordResetEmail, signOut } from './firebase';
import { serverTimestamp } from 'firebase/firestore';

const HypleyLogo = ({ className = "" }: { className?: string }) => (
    <div className={`text-5xl font-extrabold leading-tight text-center ${className}`}>
        <span className="text-[var(--text-primary)]">HYPLEY</span><span className="text-[var(--accent-primary)]"> IA</span>
    </div>
);

const BrandingSection = () => (
    <div className="bg-[#0f172a] p-6 lg:p-8 flex flex-col justify-center items-center text-center md:w-[35%] min-h-[30vh] md:min-h-screen border-b md:border-b-0 md:border-r border-[#1e293b] relative overflow-hidden shrink-0">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-blue-900/10 to-transparent pointer-events-none"></div>
        <div className="relative z-10 w-full max-w-xs mx-auto flex flex-col items-center justify-center h-full space-y-8">
            <div>
                <HypleyLogo className="mb-4 text-4xl md:text-5xl" />
                <p className="text-gray-400 text-lg font-medium leading-relaxed">
                    Vê o que você vê e te guia passo a passo.
                </p>
            </div>
            <div className="w-full bg-gradient-to-br from-indigo-900/30 to-purple-900/30 p-5 rounded-xl border border-indigo-500/20 shadow-lg backdrop-blur-sm">
                <p className="text-sm text-gray-300 mb-4 leading-relaxed">
                    A cada indicação do HYPLEY IA, o parceiro autorizado ganha <span className="text-yellow-400 font-bold">até R$ 218,71 de comissão</span>.
                </p>
                <a href="https://dashboard.kiwify.com/join/affiliate/fqEvvbDM" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg transition-all transform hover:scale-[1.02] shadow-md">Torne-se um parceiro</a>
            </div>
        </div>
    </div>
);

const Login = ({ onSwitchToSignup }: { onSwitchToSignup: () => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setSuccessMessage(''); setLoading(true);
    try { await signInWithEmailAndPassword(auth, email, password); } 
    catch (err: any) { setError('Email ou senha incorretos.'); setLoading(false); }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="w-full mb-6 rounded-xl overflow-hidden shadow-2xl border border-[var(--border-color)] bg-black">
          <h3 className="text-xs font-bold text-white text-center py-2 bg-[var(--bg-tertiary)] uppercase">Veja como ativar sua conta!</h3>
          <div className="relative pt-[56.25%]"><iframe className="absolute top-0 left-0 w-full h-full" src="https://www.youtube.com/embed/uSK6zEm6JAI" title="HYPLEY IA Video" frameBorder="0" allowFullScreen></iframe></div>
      </div>
      <div className="mb-8"><button onClick={onSwitchToSignup} className="w-full bg-[#22c55e] hover:bg-[#16a34a] text-white font-bold py-3.5 px-6 rounded-lg shadow-lg">Criar Conta</button></div>
      <h2 className="text-3xl font-bold mb-6 text-center text-white">Acessar Conta</h2>
      <form onSubmit={handleLogin} className="space-y-4">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full p-3.5 bg-[#1e293b] border rounded-lg text-white" required />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" className="w-full p-3.5 bg-[#1e293b] border rounded-lg text-white" required />
        <button type="submit" className="w-full bg-[#3b82f6] hover:bg-blue-600 text-white font-bold py-3.5 rounded-lg">Entrar</button>
      </form>
    </div>
  );
};

const Signup = ({ onSwitchToLogin }: { onSwitchToLogin: () => void }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); if (password !== confirmPassword) { setError('As senhas não coincidem.'); return; }
    setLoading(true);
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;
        await setDoc(doc(db, "users", newUser.uid), { uid: newUser.uid, email: newUser.email, name, subscriptionStatus: 'pending', createdAt: serverTimestamp(), theme: 'dark', usage: { totalTokens: 0, totalCost: 0, remainingTokens: 0 } });
        await signOut(auth); alert("Conta criada com sucesso!"); onSwitchToLogin();
    } catch (err: any) { setError('Erro ao criar conta.'); setLoading(false); }
  };
  return (
     <div className="w-full max-w-md mx-auto">
      <h2 className="text-3xl font-bold mb-6 text-center text-white">Criar Conta</h2>
      <form onSubmit={handleSignup} className="space-y-4">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" className="w-full p-3.5 bg-[#1e293b] border rounded-lg text-white" required />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full p-3.5 bg-[#1e293b] border rounded-lg text-white" required />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" className="w-full p-3.5 bg-[#1e293b] border rounded-lg text-white" required />
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirmar senha" className="w-full p-3.5 bg-[#1e293b] border rounded-lg text-white" required />
            <button type="submit" className="w-full bg-[#3b82f6] text-white font-bold py-3.5 rounded-lg">Cadastrar</button>
      </form>
       <div className="mt-6 text-center"><button onClick={onSwitchToLogin} className="text-blue-400 font-bold hover:underline">Entrar</button></div>
    </div>
  );
};

const Auth = () => {
    const [isLogin, setIsLogin] = useState(true);
    return (
        <div className="flex flex-col md:flex-row min-h-screen bg-[#0f172a] text-white">
            <BrandingSection /><div className="md:flex-1 flex items-center justify-center p-6 md:p-12 bg-[#0f172a]"><div className="w-full max-w-md">{isLogin ? <Login onSwitchToSignup={() => setIsLogin(false)} /> : <Signup onSwitchToLogin={() => setIsLogin(true)} />}</div></div>
        </div>
    );
};

export default Auth;