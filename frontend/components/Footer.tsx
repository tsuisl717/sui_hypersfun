import { Send, BookOpen, Twitter } from 'lucide-react';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-black border-t border-border py-2 px-2 md:px-6 w-full mt-auto" style={{ height: "40px" }}>
      <div className="mx-auto h-full">
        <div className="flex items-center justify-between h-full gap-2">

          {/* Copyright - shorter on mobile */}
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest whitespace-nowrap">
            <span className="md:hidden">© HYPERSFUN</span>
            <span className="hidden md:inline">© 2026 HYPERSFUN PROTOCOL - SUI</span>
          </p>

          <div className="flex items-center gap-2 md:gap-6">
            {/* Links - shorter on mobile */}
            <div className="flex gap-2 md:gap-6 text-[8px] md:text-[10px] font-mono text-gray-400 uppercase  md:tracking-widest">
              <Link href="/terms-of-service" className="hover:text-primary cursor-pointer transition-colors">Terms</Link>
              <Link href="/privacy-policy" className="hover:text-primary cursor-pointer transition-colors">Privacy</Link>
            </div>

            {/* Social icons */}
            <div className="flex gap-1 md:gap-2 items-center">
              <a href="https://t.me/hypersfun" target="_blank" rel="noopener noreferrer" className="w-5 h-5 md:w-6 md:h-6 bg-white/5 border border-border flex items-center justify-center hover:border-primary transition-colors cursor-pointer">
                <Send size={10} className="md:w-3 md:h-3" />
              </a>
              <a href="https://x.com/hypersFun" target="_blank" rel="noopener noreferrer" className="w-5 h-5 md:w-6 md:h-6 bg-white/5 border border-border flex items-center justify-center hover:border-primary transition-colors cursor-pointer">
                <Twitter size={10} className="md:w-3 md:h-3" />
              </a>
              <a href="https://docs.sui.io/" target="_blank" rel="noopener noreferrer" className="w-5 h-5 md:w-6 md:h-6 bg-white/5 border border-border flex items-center justify-center hover:border-primary transition-colors cursor-pointer">
                <BookOpen size={10} className="md:w-3 md:h-3" />
              </a>
            </div>
          </div>

        </div>
      </div>
    </footer>
  );
}
