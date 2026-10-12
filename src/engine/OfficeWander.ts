import { findPath } from './PathFinding';
import { blockedCells, seatsIn } from '../lib/officeSpace';
import type { OfficeLayout, OfficeWorker } from '../types/office';

/** Visual-only scheduler. It never affects the activity coefficient or earnings. */
export class OfficeWander {
  private next = new Map<string,number>();
  update(now: number, layout: OfficeLayout, workers: Record<string,OfficeWorker>, random = Math.random) {
    const changes: Record<string,OfficeWorker> = {};
    const seats=seatsIn(layout), reserved=new Set(Object.values(workers).filter(w=>w.seat).map(w=>`${w.seat!.furnitureId}:${w.seat!.index}`));
    const blocked=blockedCells(layout), targets=new Set(Object.values(workers).map(w=>`${w.targetPosition.gridX},${w.targetPosition.gridY}`));
    for(const id of this.next.keys()) if(!workers[id]) this.next.delete(id);
    for(const [id,w] of Object.entries(workers)) {
      if(w.activity!=='idle') {this.next.delete(id);continue;}
      if(!this.next.has(id)) this.next.set(id,now+20000+random()*40000);
      if(now < this.next.get(id)!) continue;
      this.next.set(id,now+20000+random()*40000);
      const start={gridX:Math.round(w.position.x),gridY:Math.round(w.position.y)};
      const available=seats.filter(s=>!reserved.has(`${s.furnitureId}:${s.index}`) && !targets.has(`${s.approach.gridX},${s.approach.gridY}`));
      const seat=available.length && random()<.7 ? available[Math.floor(random()*available.length)] : undefined;
      let destination=seat?.approach;
      if(!destination) {
        for(let attempt=0;attempt<20;attempt++) {
          const p={gridX:Math.floor(random()*layout.width),gridY:Math.floor(random()*layout.height)}, key=`${p.gridX},${p.gridY}`;
          if(!blocked.has(key) && !targets.has(key) && findPath(layout,start,p).length) {destination=p;break;}
        }
      }
      if(destination && findPath(layout,start,destination).length) {
        changes[id]={...w,targetPosition:destination,seat};
        targets.add(`${destination.gridX},${destination.gridY}`);
        if(seat) reserved.add(`${seat.furnitureId}:${seat.index}`);
      }
    }
    return changes;
  }
}
