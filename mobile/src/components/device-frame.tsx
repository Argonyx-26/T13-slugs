import { IconAntennaBars5, IconBattery3Filled, IconWifi } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';

// On a desktop the app sits in a 412 × 915 phone (the viewport of Nothing Phone-class
// devices) with a mock status bar, so the localhost review matches the device. On a phone,
// and inside the APK, the frame and status bar are hidden by CSS and the app is full-bleed.

export function DeviceFrame({ children }: { children: ReactNode }) {
  return (
    <div className='device-stage'>
      <div className='device-frame'>
        <div className='device-screen'>
          {children}
          <MockStatusBar />
        </div>
      </div>
      <p className='device-caption text-center text-[12px] text-faint'>
        Lumen · localhost preview · 412 × 915
      </p>
    </div>
  );
}

function clock() {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function MockStatusBar() {
  const [time, setTime] = useState(clock);
  useEffect(() => {
    const timer = window.setInterval(() => setTime(clock()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      aria-hidden
      className='device-chrome pointer-events-none absolute inset-x-0 top-0 z-[70] h-[36px] items-center justify-between px-7 text-[13px] font-medium text-fg'
    >
      <span className='tabular-nums'>{time}</span>
      <span className='absolute top-[11px] left-1/2 size-[14px] -translate-x-1/2 rounded-full bg-[#050505] ring-1 ring-[#1d1d1d]' />
      <span className='flex items-center gap-1.5'>
        <IconAntennaBars5 size={15} />
        <IconWifi size={15} />
        <IconBattery3Filled size={18} />
      </span>
    </div>
  );
}
