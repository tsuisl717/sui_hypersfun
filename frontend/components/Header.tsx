'use client'

import { useState, useEffect } from 'react';
import { Search, Plus, Wallet, Menu, X } from 'lucide-react';
import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit';
import { useRouter } from 'next/navigation';
import Logo from './Logo';
import ZkLoginButton from './ZkLoginButton';
import NetworkSwitcher from './NetworkSwitcher';
import { formatAddress } from '@/lib/contracts/config';

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onLogoClick: () => void;
}

export default function Header({ searchQuery, onSearchChange, onLogoClick }: HeaderProps) {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const account = useCurrentAccount();
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setShowMobileMenu(false);
  }, [router]);

  return (
    <nav className={`sticky top-0 z-50 transition-all border-b border-border ${scrolled ? 'bg-black/95 backdrop-blur-md h-12 md:h-14' : 'bg-black h-14 md:h-18'}`}>
      <div className="w-full h-full px-2 md:px-4 flex items-center justify-between">
        <div className="flex items-center gap-4 md:gap-10">
          <div className="flex items-center justify-center gap-2 md:gap-3 cursor-pointer group" onClick={onLogoClick}>
            <Logo size={scrolled ? 36 : 42} className="md:w-[58px] md:h-[58px]" />
            <div className="flex flex-col">
              <div className="flex items-start gap-2">
                <span className="text-lg md:text-2xl font-black tracking-tighter uppercase italic leading-none text-white mt-1">
                  HYPERS<span className="text-primary">FUN</span>
                </span>
                <span className="text-[10px] md:text-[12px] font-black text-blue-400 uppercase tracking-tight">
                  SUI
                </span>
              </div>
              <span className="text-[8px] md:block md:text-[10px] font-bold text-gray-500 uppercase tracking-[0.4em]">Tokenized Fund Protocol</span>
            </div>
          </div>

          <div className="hidden xl:flex items-center bg-white/5 border border-white/5 rounded-sm px-4 h-9 w-[400px] focus-within:border-primary/40 group">
            <Search size={14} className="text-gray-500 group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              placeholder="Search vaults, symbols, addresses..."
              className="bg-transparent border-none outline-none ml-3 w-full text-xs font-mono placeholder:text-gray-600 text-white"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        </div>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center gap-4">
          <div className="hidden lg:flex items-center border border-border h-9 rounded-sm overflow-hidden">
            {(['VAULTS', 'FAUCET', 'DOCS', 'PROFILE'] as const).map(link => (
              <button
                key={link}
                className="px-5 h-full cursor-pointer text-xs font-bold text-gray-500 hover:text-white hover:bg-white/5 transition-all uppercase tracking-widest"
                onClick={() => {
                  if (link === 'VAULTS') router.push('/');
                  else if (link === 'FAUCET') router.push('/faucet');
                  else if (link === 'DOCS') window.open('https://docs.sui.io/', '_blank');
                  else if (link === 'PROFILE') router.push('/profile');
                }}
              >
                {link}
              </button>
            ))}
          </div>

          <button
            onClick={() => router.push('/launch')}
            className="h-9 px-6 bg-primary text-black cursor-pointer font-black text-xs uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all rounded-sm flex items-center gap-2"
          >
            <Plus size={14} strokeWidth={3} />
            <span className="hidden lg:inline">Create Vault</span>
            <span className="lg:hidden">CREATE</span>
          </button>

          {/* Network Switcher */}
          <NetworkSwitcher />

          {/* zkLogin (Google) */}
          <ZkLoginButton />

          {/* SUI Wallet Connect Button */}
          <ConnectButton
            connectText="Connect Wallet"
            className="!h-9 !px-4 !bg-white/5 !border !border-white/10 hover:!border-primary/40 !transition-all !rounded-sm"
          />
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden p-2 text-gray-400 hover:text-white"
          onClick={() => setShowMobileMenu(!showMobileMenu)}
        >
          {showMobileMenu ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {showMobileMenu && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-black border-b border-border z-50">
          <div className="p-4 space-y-3">
            {/* Navigation Links */}
            <div className="flex flex-col gap-2">
              {(['VAULTS', 'FAUCET', 'DOCS', 'PROFILE'] as const).map(link => (
                <button
                  key={link}
                  className="w-full py-2 px-3 text-left text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-all uppercase tracking-widest"
                  onClick={() => {
                    if (link === 'VAULTS') router.push('/');
                    else if (link === 'FAUCET') router.push('/faucet');
                    else if (link === 'DOCS') window.open('https://docs.sui.io/', '_blank');
                    else if (link === 'PROFILE') router.push('/profile');
                    setShowMobileMenu(false);
                  }}
                >
                  {link}
                </button>
              ))}
            </div>

            {/* Create Vault - Mobile */}
            <button
              onClick={() => {
                router.push('/launch');
                setShowMobileMenu(false);
              }}
              className="w-full py-3 bg-primary text-black font-black text-sm uppercase tracking-widest rounded-sm flex items-center justify-center gap-2"
            >
              <Plus size={16} strokeWidth={3} />
              Create Vault
            </button>

            {/* Network Switcher - Mobile */}
            <div className="w-full flex justify-center">
              <NetworkSwitcher />
            </div>

            {/* zkLogin (Google) - Mobile */}
            <div className="w-full">
              <ZkLoginButton />
            </div>

            {/* SUI Wallet Connect - Mobile */}
            <div className="w-full">
              <ConnectButton
                connectText="Connect Wallet"
                className="!w-full !py-3 !bg-white/10 !border !border-border !text-white !font-bold !text-sm !uppercase !tracking-widest !rounded-sm"
              />
            </div>

            {/* Show connected address */}
            {account && (
              <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-400">
                <Wallet size={14} className="text-primary" />
                <span className="font-mono">{formatAddress(account.address)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
