import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Приложение целиком клиентское — бэкенда и БД в MVP нет (SPEC.md §2).
  output: 'export',
};

export default nextConfig;
