export function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export function severityColor(sev: number): string {
  if (sev <= 2) return '#27ae60';
  if (sev <= 5) return '#f0ad4e';
  if (sev <= 7) return '#e67e22';
  return '#e74c3c';
}

export function prettyPart(p: string): string {
  return p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatRel(iso: string): string {
  const hrs = (Date.now() - new Date(iso).getTime()) / 3600_000;
  if (hrs < 1) return `${Math.round(hrs * 60)}m ago`;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
