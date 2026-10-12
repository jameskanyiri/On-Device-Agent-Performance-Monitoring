'use client';

import { HomeIcon as HomeOutline, MoonIcon, QueueListIcon as QueueListOutline, SunIcon } from '@heroicons/react/24/outline';
import { HomeIcon as HomeSolid, QueueListIcon as QueueListSolid } from '@heroicons/react/24/solid';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import type { Icon } from '@/ui/icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

type Item = { href: string; label: string; icon: Icon; activeIcon: Icon; match: (path: string) => boolean };

const ITEMS: Item[] = [
  { href: '/', label: 'Home', icon: HomeOutline, activeIcon: HomeSolid, match: (p) => p === '/' },
  {
    href: '/traces',
    label: 'Traces',
    icon: QueueListOutline,
    activeIcon: QueueListSolid,
    // Devices, their traces and benchmark sessions all open from Traces.
    match: (p) => p.startsWith('/traces') || p.startsWith('/chats') || p.startsWith('/sessions') || p.startsWith('/bench'),
  },
];

const ITEM_CLASS =
  'flex size-9 items-center justify-center rounded-xl transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:active:scale-95';

/** The left rail, as in Shift: icons only, each name a tooltip and the accessible label. */
export function NavRail() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex w-14 shrink-0 flex-col items-center gap-2 pt-3 pb-3">
      {ITEMS.map((item) => {
        const current = item.match(path);
        const Glyph = current ? item.activeIcon : item.icon;
        return (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={current ? 'page' : undefined}
                className={cn(ITEM_CLASS, current ? 'bg-foreground/[0.07] text-foreground' : 'text-foreground/60 hover:bg-foreground/5 hover:text-foreground')}>
                <Glyph className="size-5" aria-hidden="true" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
      <div className="mt-auto">
        <ThemeButton />
      </div>
    </nav>
  );
}

/** Flips light and dark over the system setting, remembered in this browser. */
function ThemeButton() {
  const toggle = () => {
    const root = document.documentElement;
    const dark = !root.classList.contains('dark');
    root.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      // private mode: not remembered
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Switch light or dark" onClick={toggle} className={cn(ITEM_CLASS, 'text-foreground/60 hover:bg-foreground/5 hover:text-foreground')}>
          <SunIcon className="hidden size-5 dark:block" aria-hidden="true" />
          <MoonIcon className="size-5 dark:hidden" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Light or dark</TooltipContent>
    </Tooltip>
  );
}
