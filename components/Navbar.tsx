'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { PieChart, Coins, Wallet, Calculator, Receipt, Menu, X } from 'lucide-react';

const navItems = [
  { name: '資産管理', href: '/', icon: Wallet },
  { name: '配当金管理', href: '/dividend', icon: PieChart },
  { name: '会計', href: '/accounting', icon: Receipt },
  { name: '税金', href: '/tax', icon: Calculator },
  { name: '外貨管理', href: '/forex', icon: Coins },
];

// ロゴマーク。読み込み時に一度だけ、ぽんと現れる
function Seal({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  return (
    <span
      aria-hidden
      className={`seal-press ${dim} inline-flex items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/25`}
    >
      <PieChart className={size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'} />
    </span>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <>
      {/* ── デスクトップ: 左に固定するサイドバー ── */}
      <aside className="hidden lg:flex sticky top-0 h-screen w-60 shrink-0 flex-col bg-white border-r border-slate-200">
        <Link href="/" className="flex items-center gap-3 px-5 pt-7 pb-6 hover:opacity-90">
          <Seal />
          <span className="font-bold text-lg text-slate-800">資産管理アプリ</span>
        </Link>

        <nav aria-label="メインメニュー" className="flex-1 px-3">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors ${
                      active
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className={`w-[18px] h-[18px] ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                    <span>{item.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* ── モバイル/タブレット: 上部バー ── */}
      <header className="lg:hidden sticky top-0 z-40 w-full bg-white/95 backdrop-blur border-b border-slate-200 text-slate-800">
        <div className="flex items-center justify-between h-14 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-lg">
            <Seal size="sm" />
            <span>資産管理</span>
          </Link>
          <button
            onClick={() => setOpen(!open)}
            aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
            aria-expanded={open}
            className="p-2 -mr-2 rounded-lg text-slate-600 hover:bg-slate-100"
          >
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {open && (
          <nav aria-label="メインメニュー" className="border-t border-slate-200 bg-white px-3 pt-2 pb-4 shadow-lg">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl text-base ${
                    active ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </header>
    </>
  );
}
