import { useState } from 'react';
import { Building2, X, ArrowUpRight } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { globalCoefficient, OFFICE_BALANCE, OFFICE_LOCATIONS, officeBonuses, spinFactor } from '../../lib/officeEconomy';
import type { OfficeLocation } from '../../types/office';

export function OfficeCompany() {
  const s=useOfficeGameStore(), [confirm,setConfirm]=useState(false);
  const expansionCost=OFFICE_BALANCE.expansionPrice*2**s.expansions;
  const factor=spinFactor(s.companyBase);
  return <aside className="office-company" aria-label="Company">
    <div className="office-panel-heading"><div><span className="office-eyebrow">BUILT BY YOUR WORK</span><h3>Your company</h3></div><button aria-label="Close company" onClick={()=>useOfficeGameStore.setState({companyOpen:false})}><X size={18}/></button></div>
    <div className="office-company-body">
      <div className="office-coefficients"><span>Global <b>{globalCoefficient(s.companyBase).toFixed(3)}</b></span><span>Environment <b>+{officeBonuses(s.layout,'').environment.toFixed(3)}</b></span><span>Location <b>+{OFFICE_LOCATIONS[s.location].bonus.toFixed(3)}</b></span><span>Permanent <b>×{s.permanent.toFixed(3)}</b></span></div>
      <p>Coins come from reported tokens. Workstations grow with your team; extra space is yours to decorate.</p>
      <button className="office-expansion" disabled={s.currency<expansionCost} onClick={s.expand}><Building2 size={18}/> Expand studio · {expansionCost.toLocaleString()} coins</button>
      <h4>Find a new home</h4>
      <div className="office-locations">{Object.entries(OFFICE_LOCATIONS).map(([id,l])=><article key={id} className={`office-location office-location--${id}`}><div className="office-location-art"><Building2 size={38}/></div><strong>{l.name}</strong><p>{l.description}</p><span>+{(l.bonus*100).toFixed(0)}% global</span><button disabled={s.location===id || s.currency<l.price} onClick={()=>s.relocate(id as OfficeLocation)}>{s.location===id?'Current home':`${l.price.toLocaleString()} coins · Move`}<ArrowUpRight size={13}/></button></article>)}</div>
      <details className="office-company-details"><summary>Income & lifetime statistics</summary><p>Usage value × 10 × permanent × (global + environment + location) × (1 + provider server) × model experience × (PC + accessories) × activity.</p><p>Prices come from Analytics where known; other models use labeled game estimates. These coins have no monetary value.</p><p>This company: {s.companyBase.toFixed(2)} base coins · {Math.floor(s.totalEarned).toLocaleString()} earned coins.</p><p>Lifetime: {Math.floor(s.lifetimeCoins).toLocaleString()} coins · {s.spinoffs} spin-offs{s.legacyEarned>0?` · ${s.legacyEarned.toLocaleString()} legacy coins`:''}.</p></details>
      <details className="office-company-details"><summary>Advanced</summary><h4>Start a spin-off</h4><p>Reset this company to start again with a permanent income multiplier. Coins, furniture, outfits, PCs, servers, location, expansions, and model experience will reset. Your chats and panels stay as they are.</p><p>Based on this company's earnings <b>before bonuses</b>. Requires 250 base coins. The reward grows logarithmically, in 0.01 steps.</p><p>×{s.permanent.toFixed(3)} × {factor.toFixed(2)} → <strong>×{(s.permanent*factor).toFixed(3)} permanent</strong></p>
        {!confirm ? <button className="office-danger" disabled={s.companyBase<250} onClick={()=>setConfirm(true)}>Reset company for spin-off</button> : <div role="alertdialog" aria-label="Confirm company reset"><p><b>This resets all game possessions and progression except your permanent multiplier and lifetime statistics.</b></p><button onClick={()=>setConfirm(false)}>Keep my company</button><button className="office-danger" onClick={()=>s.spinoff()}>Confirm reset and spin off</button></div>}
      </details>
    </div>
  </aside>;
}
