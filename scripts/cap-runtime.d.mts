import type { Plugin } from 'vite';
export const sandboxPolicy: string;
export function widgetSource(): string;
export function runtimeAssets(): Map<string, { type: string; body: Buffer }>;
export default function capRuntime(): Plugin;
