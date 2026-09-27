import type { Profile } from './types';
export function searchProfiles(profiles: Profile[], query: string, browserNames: Record<string, string> = {}) {
  const q = query.trim().toLocaleLowerCase();
  const score = (p: Profile) => {
    const name = p.name.toLocaleLowerCase();
    if (!q) return (p.favorite ? 1e15 : 0) + (p.lastUsed || 0);
    if (name === q) return 1000;
    if (name.startsWith(q)) return 800;
    if (name.includes(q)) return 600;
    const text = [name, ...p.labels, browserNames[p.browserId] || ''].join(' ').toLocaleLowerCase();
    if (q.split(/\s+/).every(word => text.includes(word))) return 400;
    let at = 0;
    for (const char of text) if (char === q[at]) at++;
    return at === q.length ? 100 : 0;
  };
  return profiles.map(p => ({ p, score: score(p) })).filter(x => !q || x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name)).map(x => x.p);
}
