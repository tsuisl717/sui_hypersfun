'use client';

import { Cpu as CircuitIcon } from 'lucide-react';

export default function HeroSection() {
  // Mock stats for now - will be replaced with actual SUI data
  const stats = {
    neuralTVLFormatted: '$125K',
    totalVaults: 3,
    isLoadingTVL: false,
  };

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-card to-surface border border-primary/30 h-auto sm:h-72 flex items-center shadow-2xl">
      <div className="biometric-scan"></div>

      {/* Circuits SVG Background */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <svg className="w-full h-full" viewBox="0 0 1000 300" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 50H200L250 100H400L450 150H1000" stroke="#10b981" fill="none" className="circuit-trace" />
          <path d="M0 250H300L350 200H550L600 250H1000" stroke="#10b981" fill="none" className="circuit-trace" />
          <circle cx="200" cy="50" r="4" fill="#10b981" />
          <circle cx="400" cy="100" r="4" fill="#10b981" />
          <circle cx="600" cy="250" r="4" fill="#10b981" />
        </svg>
      </div>

      <div className="relative z-10 px-3 sm:px-12 py-4 sm:py-0 flex flex-col md:flex-row items-center justify-between w-full gap-4">
        {/* Mobile: Compact layout */}
        <div className="sm:hidden w-full">
          {/* Header row with logo and title */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 bg-primary/20 border border-primary/40 flex items-center justify-center rounded-full">
              <CircuitIcon size={28} className="text-primary" />
            </div>
            <div>
              <div className="text-2xl font-black tracking-tighter leading-none italic uppercase text-white" aria-hidden="true">
                LAUNCH YOUR <span className="text-primary">FUND</span>
              </div>
              <div className="inline-flex items-center gap-1.5 mt-1 text-[8px] font-black text-primary uppercase tracking-widest">
                <CircuitIcon size={10} className="animate-pulse" />
                CopyFundFi Protocol // SUI
              </div>
            </div>
          </div>
          {/* Stats row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-black/30 border border-primary/20 p-2">
              <span className="text-[9px] text-primary/40 font-bold uppercase">Total TVL</span>
              <div className="text-xl font-mono font-bold text-white">
                {stats.isLoadingTVL ? <span className="animate-pulse">...</span> : stats.neuralTVLFormatted}
              </div>
            </div>
            <div className="bg-black/30 border border-primary/20 p-2">
              <span className="text-[9px] text-primary/40 font-bold uppercase">Total Vaults</span>
              <div className="text-xl font-mono font-bold text-primary">{stats.totalVaults}</div>
            </div>
          </div>
        </div>

        {/* Desktop: Original layout */}
        <div className="hidden sm:flex items-center gap-12">
          <div className="relative" style={{ minWidth: '190px', minHeight: '190px' }}>
            <div className="w-[190px] h-[190px] p-2 bg-primary/10 rounded-full border border-primary/20 shadow-[0_0_60px_rgba(16,185,129,0.2)] flex items-center justify-center">
              <CircuitIcon size={80} className="text-primary" />
            </div>
          </div>
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3 px-4 py-1.5 bg-primary/10 border border-primary/30 text-[10px] font-black text-primary uppercase tracking-[0.4em]">
              <CircuitIcon size={14} className="animate-pulse" />
              The CopyFundFi Protocol // SUI NATIVE
            </div>
            <div>
              <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-none italic uppercase text-white">
                LAUNCH YOUR <span className="text-primary">FUND</span>
              </h1>
              <p className="text-primary/60 text-base font-bold uppercase tracking-[0.3em] mt-4 max-w-2xl leading-relaxed">
                TOKENIZED FUNDS IN ONE CLICK • NAV-ANCHORED PRICING • BONDING CURVE AMM
              </p>
            </div>
          </div>
        </div>

        <div className="hidden xl:grid grid-cols-2 gap-24 border-l border-primary/20 pl-16">
          <div className="space-y-2">
            <span className="text-[12px] text-primary/40 font-black uppercase tracking-widest">Total TVL</span>
            <div className="text-6xl font-mono font-bold text-white tracking-tighter">
              {stats.isLoadingTVL ? (
                <span className="animate-pulse">...</span>
              ) : (
                stats.neuralTVLFormatted
              )}
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-[12px] text-primary/40 font-black uppercase tracking-widest">Total Vaults</span>
            <div className="text-6xl font-mono font-bold text-primary tracking-tighter">
              {stats.totalVaults}
            </div>
          </div>
        </div>
      </div>

      {/* CopyFundFi Formula - Top Right */}
      <div className="absolute top-2 right-3 sm:top-3 sm:right-4 z-20">
        <div className="text-[9px] sm:text-[10px] font-medium text-white/50 tracking-wide flex items-center gap-1.5">
          <span className="text-white/60">CopyTrade</span>
          <span className="text-primary/40 text-[11px] sm:text-[12px]">+</span>
          <span className="text-white/60">Tokenized Fund</span>
          <span className="text-primary/40 text-[11px] sm:text-[12px]">+</span>
          <span className="text-white/60">DeFi</span>
          <span className="text-primary/40 text-[11px] sm:text-[12px]">=</span>
          <span className="text-primary/70">CopyFundFi</span>
        </div>
      </div>
    </div>
  );
}
