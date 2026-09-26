import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lumen.recorder',
  appName: 'Lumen',
  webDir: 'dist',
  backgroundColor: '#000000',
  plugins: {
    // Capacitor 8 core plugin: light status/nav bar icons on our black UI, and the real
    // insets exposed as --safe-area-inset-* (Android WebView < 140 reports env() as 0)
    SystemBars: {
      style: 'DARK',
      insetsHandling: 'css'
    }
  }
};

export default config;
