import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TileLayout — раскладка плитки',
  description: 'Варианты раскладки плитки на полу с оценкой подрезок и симметрии.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
