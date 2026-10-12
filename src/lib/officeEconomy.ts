import type { ActivityUsage } from '../types/activity';
import type { OfficeLayout, OfficeLocation, OfficeRates, WorkerProfile } from '../types/office';
import { itemForFurniture, officeItem } from './officeCatalog';

/** Game values, not provider invoices. All tuning is centralized here. */
export const OFFICE_BALANCE = {
  coinsPerValue: 10, activePerHour: .05, idlePerHour: .10,
  environmentCap: .15, expansionPrice: 150,
  fallback: {
    economy: { input: .5, output: 2, cacheRead: .05, cacheWrite: .625 },
    standard: { input: 2, output: 10, cacheRead: .2, cacheWrite: 2.5 },
    premium: { input: 4, output: 20, cacheRead: .4, cacheWrite: 5 },
  } satisfies Record<string, OfficeRates>,
  modelTiers: [
    { match: /haiku|flash|mini|nano|luna/i, tier: 'economy' },
    { match: /opus|astra|mythos|fable|gemini.*pro|o[134](?:-|$)/i, tier: 'premium' },
  ] as const,
};
export const OFFICE_LOCATIONS: Record<OfficeLocation, { name: string; price: number; bonus: number; description: string }> = {
  studio: { name: 'Starter studio', price: 0, bonus: 0, description: 'A quiet courtyard and a company of your own.' },
  city: { name: 'City office', price: 1200, bonus: .03, description: 'A leafy street, warm brick, and room to grow.' },
  plaza: { name: 'Plaza headquarters', price: 3500, bonus: .08, description: 'Glass towers and a landscaped business plaza.' },
  seaside: { name: 'Seaside studio', price: 8000, bonus: .15, description: 'Ocean views, a sandy shore, and a calmer workspace.' },
};
export const ZERO_USAGE: ActivityUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
export function normalizedModel(model: string) { return model.toLowerCase().replace(/^.*\//, '').replace(/\./g, '-'); }
export function modelKey(provider: string, model: string) { return `${provider}:${normalizedModel(model)}`; }
export function usageRates(model: string, prices: Record<string, OfficeRates>) {
  const key = normalizedModel(model);
  const known = Object.keys(prices).filter(p => key === p || key.startsWith(`${p}-`)).sort((a,b) => b.length-a.length)[0];
  if (known) return { rates: prices[known], estimated: false };
  const tier = OFFICE_BALANCE.modelTiers.find(t => t.match.test(model))?.tier ?? 'standard';
  return { rates: OFFICE_BALANCE.fallback[tier], estimated: true };
}
export function usageDelta(next: ActivityUsage, previous = ZERO_USAGE): ActivityUsage {
  return Object.fromEntries(Object.keys(ZERO_USAGE).map(k => {
    const key = k as keyof ActivityUsage, n = next[key];
    return [key, Number.isFinite(n) ? Math.max(0, n - previous[key]) : 0];
  })) as unknown as ActivityUsage;
}
export function baseCoins(usage: ActivityUsage, rates: OfficeRates) {
  return (usage.input*rates.input + usage.output*rates.output + usage.cacheRead*rates.cacheRead + usage.cacheWrite*rates.cacheWrite) / 1e6 * OFFICE_BALANCE.coinsPerValue;
}
export const globalCoefficient = (base: number) => 1 + .001*Math.log2(1 + Math.max(0,base)/100);
export const modelCoefficient = (base: number) => 1 + .002*Math.log2(1 + Math.max(0,base)/100);
export const spinFactor = (base: number) => 1 + Math.floor(10*Math.log2(1 + Math.max(0,base)/250) + 1e-9)/100;
export const activeWork = (activity: string) => !['idle','new','unknown','error','awaiting_permission'].includes(activity);
export function activityAfter(profile: WorkerProfile, now: number, offline = false) {
  const hours = Math.max(0, now - (profile.activityAt ?? now))/3600000;
  const gain = !offline && activeWork(profile.activityState ?? 'unknown') ? OFFICE_BALANCE.activePerHour : -OFFICE_BALANCE.idlePerHour;
  return Math.max(1, Math.min(2, (profile.activity ?? 1) + hours*gain));
}
export function officeBonuses(layout: OfficeLayout, provider: string) {
  const families: Record<string, number> = {};
  let server = 0;
  for (const f of layout.furniture) {
    // Starter equipment is supplied for capacity, never a free paid bonus.
    if (f.workstationFor || f.id.startsWith('starter-')) continue;
    const b = itemForFurniture(f)?.bonus;
    if (b?.scope === 'environment') families[b.family ?? f.type] = Math.max(families[b.family ?? f.type] ?? 0, b.amount);
    if (b?.scope === 'provider' && b.provider === provider) server = Math.max(server, b.amount);
  }
  return { environment: Math.min(OFFICE_BALANCE.environmentCap, Object.values(families).reduce((a,b) => a+b,0)), server };
}
export function workerEquipment(profile?: WorkerProfile) {
  const pc = officeItem(profile?.pc ?? 'pc-0')?.pcMultiplier ?? 1;
  const accessories = Object.values(profile?.wearables ?? {}).reduce((sum,id) => sum + (officeItem(id ?? '')?.bonus?.amount ?? 0),0);
  return pc + accessories;
}
export interface EconomySnapshot {
  companyBase: number; modelBase: Record<string,number>; permanent: number;
  location: OfficeLocation; layout: OfficeLayout; profiles: Record<string, WorkerProfile>;
}
export function incomeMultiplier(s: EconomySnapshot, panel: string, provider: string, model: string) {
  const b = officeBonuses(s.layout,provider);
  return s.permanent * (globalCoefficient(s.companyBase) + b.environment + OFFICE_LOCATIONS[s.location].bonus)
    * (1 + b.server) * modelCoefficient(s.modelBase[modelKey(provider,model)] ?? 0)
    * workerEquipment(s.profiles[panel]) * (s.profiles[panel]?.activity ?? 1);
}
