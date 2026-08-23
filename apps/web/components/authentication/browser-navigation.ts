'use client';

export function assignBrowserLocation(location: string): void {
  window.location.assign(location);
}

export function replaceBrowserLocation(location: string): void {
  window.location.replace(location);
}
