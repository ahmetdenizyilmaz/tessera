"""Rebuild bundled office items. Runtime only reads the self-contained JSON files.
SVG views are projected from actual 3D furniture parts, not mirrored artwork.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'src' / 'content' / 'office'
ROOT.mkdir(parents=True, exist_ok=True)

def shade(color, scale):
    return '#' + ''.join(f'{min(255, round(int(color[i:i+2], 16)*scale)):02x}' for i in (1,3,5))

def artwork(kind, w, h, color, rotation):
    parts = []
    def box(x,y,z,dx,dy,dz,c): parts.append((x,y,z,dx,dy,dz,c))
    if kind == 'desk':
        box(.1,.08,.75,w-.2,h-.16,.1,color)
        for x in (.16,w-.24):
            for y in (.16,h-.24): box(x,y,0,.08,.08,.75,'#526274')
        box(.45,.25,.86,.75,.12,.65,'#344654')
        box(.48,.38,1,.68,.02,.45,'#91d2cc')
        box(.46,.55,.86,.72,.24,.04,'#ccd8d3')
    elif kind in ('couch','chair'):
        for x in (.15,w-.25):
            for y in (.15,h-.25): box(x,y,0,.1,.1,.2,'#594b45')
        box(.08,.08,.2,w-.16,h-.16,.25,color)
        box(.08,.06,.45,w-.16,.16,.65,color)
        if kind == 'couch':
            for x in (.02,w-.2): box(x,.12,.43,.18,h-.18,.25,color)
            for x in range(w): box(x+.23,.28,.45,.58,h-.38,.06,shade(color,1.1))
    elif kind in ('server_rack','bookshelf','filing_cabinet'):
        box(.12,.1,0,w-.24,h-.2,1.8,color)
        for z in (.3,.7,1.1,1.5):
            box(.2,h-.095,z,w-.4,.025,.2,'#263440')
            for x in range(3): box(.24+x*.18,h-.06,z+.07,.055,.02,.045,['#8edfc2','#e4c083','#d29384'][x])
    elif kind == 'plant':
        box(.3,.3,0,.4,.4,.45,'#c3957b')
        box(.48,.48,.4,.04,.04,.8,'#486650')
        for x,y,z in ((.15,.25,.7),(.48,.4,.9),(.25,.3,1.1)): box(x,y,z,.35,.35,.16,color)
    elif kind in ('whiteboard','task_board','poster'):
        box(.1,.15,.5,w-.2,.09,1.05,color)
        for x in range(w*3): box(.18+x*.24,.25,.8+(x%2)*.35,.16,.02,.22,['#a8d4ca','#eac389','#cfabbe'][x%3])
        if kind != 'poster':
            for x in (.2,w-.3): box(x,.15,0,.08,.09,.5,'#596f77')
    elif kind == 'rug': box(.04,.04,0,w-.08,h-.08,.025,color); box(.24,.24,.026,w-.48,h-.48,.008,shade(color,1.17))
    elif kind == 'lamp':
        box(.3,.3,0,.4,.4,.08,'#647780'); box(.48,.48,.08,.04,.04,1.25,color)
        box(.22,.22,1.3,.56,.56,.28,'#f4dca4')
    else:
        box(.2,.18,0,.6,.64,1 if kind == 'water_cooler' else .65,color)
        if kind == 'water_cooler': box(.28,.28,1,.44,.44,.4,'#94cadf')
        elif kind == 'coffee_machine': box(.28,.25,.65,.44,.44,.3,'#334650'); box(.4,.65,.68,.15,.15,.17,'#f0dac0')
        else: box(.27,.28,.65,.46,.4,.035,'#e0e8e4')
    def turn(x,y):
        return ((x,y),(h-y,x),(w-x,h-y),(y,w-x))[rotation]
    def project(x,y,z):
        a,b=turn(x,y); return (128+(a-b)*32, 75+(a+b)*16-z*32)
    def polygon(points,c):
        return '<polygon points="'+' '.join(f'{a:.2f},{b:.2f}' for a,b in points)+f'" fill="{c}" stroke="#20323c" stroke-opacity="0.18" stroke-width="0.65"/>'
    parts.sort(key=lambda p: sum(turn(p[0]+p[3]/2,p[1]+p[4]/2))+p[2]*.02)
    shapes=[]
    for x,y,z,dx,dy,dz,c in parts:
        corners=[turn(x,y),turn(x+dx,y),turn(x+dx,y+dy),turn(x,y+dy)]
        minx,maxx=min(a for a,b in corners),max(a for a,b in corners)
        miny,maxy=min(b for a,b in corners),max(b for a,b in corners)
        def p(a,b,v):return (128+(a-b)*32,75+(a+b)*16-v*32)
        shapes.append(polygon([p(minx,maxy,z),p(maxx,maxy,z),p(maxx,maxy,z+dz),p(minx,maxy,z+dz)],shade(c,.72)))
        shapes.append(polygon([p(maxx,miny,z),p(maxx,maxy,z),p(maxx,maxy,z+dz),p(maxx,miny,z+dz)],shade(c,.86)))
        shapes.append(polygon([p(minx,miny,z+dz),p(maxx,miny,z+dz),p(maxx,maxy,z+dz),p(minx,maxy,z+dz)],c))
    return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="192" viewBox="0 0 256 192">'+''.join(shapes)+'</svg>'

def wearable(kind,color,id):
    shapes = {
        'shirt':f'<path d="M20 18L8 26L14 37L21 33V60H59V33L66 37L72 26L60 18L48 22H32Z" fill="{color}"/><path d="M31 20Q40 35 49 20" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="3"/>',
        'head':f'<path d="M18 48V35C18 7 62 7 62 35V48" fill="none" stroke="{color}" stroke-width="7"/><rect x="12" y="36" width="13" height="23" rx="5" fill="{color}"/><rect x="55" y="36" width="13" height="23" rx="5" fill="{color}"/>',
        'face':f'<circle cx="25" cy="40" r="13" fill="none" stroke="{color}" stroke-width="4"/><circle cx="55" cy="40" r="13" fill="none" stroke="{color}" stroke-width="4"/><path d="M38 38H42" stroke="{color}" stroke-width="4"/>',
        'neck':f'<path d="M20 15L40 62L60 15" fill="none" stroke="{color}" stroke-width="6"/><rect x="29" y="49" width="22" height="24" rx="3" fill="{color}"/>'}
    specifics={
      'cap':f'<path d="M15 48L20 25Q40 12 59 25L64 48L74 55H15Z" fill="{color}"/><path d="M16 48H64" stroke="#937954" stroke-width="3"/>',
      'beanie':f'<path d="M17 49Q40 5 63 49V58H17Z" fill="{color}"/><rect x="17" y="49" width="46" height="9" fill="#8f4452"/><circle cx="40" cy="23" r="7" fill="#f0d7a6"/>',
      'beret':f'<ellipse cx="37" cy="40" rx="30" ry="14" fill="{color}"/><rect x="36" y="19" width="5" height="10" fill="#43537a"/>',
      'visor':f'<path d="M14 40H66L76 51H4Z" fill="{color}"/><rect x="17" y="29" width="46" height="11" fill="#358575"/>',
      'party_hat':f'<path d="M19 62L40 10L61 62Z" fill="{color}"/><path d="M25 46H55L51 35H29Z" fill="#f1d58b"/><circle cx="40" cy="10" r="5" fill="#dd93ae"/>',
      'crown':f'<path d="M15 59L10 23L28 38L40 16L52 38L70 23L65 59Z" fill="{color}" stroke="#a17c42" stroke-width="2"/>',
      'halo':f'<ellipse cx="40" cy="37" rx="29" ry="9" fill="none" stroke="{color}" stroke-width="5"/>',
      'sunglasses':f'<path d="M9 29H34V49H9ZM46 29H71V49H46Z" fill="{color}"/><path d="M34 34H46" stroke="{color}" stroke-width="4"/>',
      'monocle':f'<circle cx="36" cy="32" r="19" fill="none" stroke="{color}" stroke-width="4"/><path d="M52 44L66 67" stroke="{color}" stroke-width="2"/>',
      'tie':f'<path d="M29 14H51L45 25L51 58L40 70L29 58L35 25Z" fill="{color}"/>',
      'bowtie':f'<path d="M10 23L40 37L70 23V59L40 45L10 59Z" fill="{color}"/><rect x="35" y="33" width="10" height="16" rx="2" fill="#785069"/>',
      'scarf':f'<path d="M12 20H68V38H55V70H40V38H12Z" fill="{color}"/><path d="M40 63H55" stroke="#b87c52" stroke-width="3"/>',
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">'+specifics.get(id,shapes[kind])+'</svg>'

def furniture(id,name,kind,price,color='#9baeb1',bonus=0,family=None,provider=None,category=None):
    w,h={'desk':(2,1),'couch':(2,1),'bookshelf':(2,1),'whiteboard':(2,1),'task_board':(2,1),'server_rack':(1,2),'rug':(2,2)}.get(kind,(1,1))
    item=dict(version=1,id=id,name=name,description=f'{name}. A place for your team to work and recharge.',category=category or ('decoration' if kind in ('plant','lamp','rug','poster') else 'furniture'),price=price,sprite=kind,furnitureType=kind,footprint=dict(w=w,h=h),collision=[] if kind in ('rug','poster') else [[x,y] for x in range(w) for y in range(h)],anchor=dict(x=128,y=75),art=[artwork(kind,w,h,color,r) for r in range(4)],color=color)
    if bonus: item['bonus']=dict(scope='provider' if provider else 'environment',amount=bonus,family=family or kind,**({'provider':provider} if provider else {}))
    if kind in ('couch','chair'): item['seats']=[dict(x=x+.5,y=.55,approach=[x,1]) for x in range(w)]
    if kind=='desk':item['interaction']=[[0,1]]
    return item

items=[]
for id,name,kind,price,color,bonus in [
 ('shop-desk-oak','Oak workstation','desk',80,'#b79773',.002),('shop-chair-ergo','Ergonomic chair','chair',40,'#668e96',.001),
 ('shop-bookshelf','Research library','bookshelf',140,'#9e836c',.004),('shop-whiteboard','Planning board','whiteboard',100,'#d8dfd1',.003),
 ('shop-couch','Lounge sofa','couch',180,'#83a9a0',.005),('shop-server','Archive appliance','server_rack',500,'#4a596a',.008),
 ('shop-cabinet','Filing cabinet','filing_cabinet',90,'#899cad',.002),('shop-tasks','Task board','task_board',120,'#b8b39d',.003),
 ('shop-plant-small','Desk-side plant','plant',20,'#89b58b',.001),('shop-lamp-desk','Warm floor lamp','lamp',40,'#bba77d',.002),
 ('shop-poster-code','Code poster','poster',25,'#bfaa96',.001),('shop-rug-red','Terracotta rug','rug',60,'#b98478',.002),
 ('shop-water-cooler','Water cooler','water_cooler',100,'#abbac2',.003),('shop-coffee','Espresso machine','coffee_machine',220,'#a8b7ad',.006),
 ('shop-printer','Office printer','printer',140,'#b1b9ba',.003),('plant-monstera','Monstera','plant',110,'#539279',.004),
 ('plant-olive','Indoor olive tree','plant',350,'#a2b280',.009),('couch-velvet','Velvet lounge','couch',650,'#a481a5',.015),
 ('chair-leather','Executive chair','chair',320,'#b28669',.008),('library-premium','Walnut library','bookshelf',850,'#82644e',.018),
 ('lamp-architect','Architect lighting','lamp',450,'#d5bb86',.011),('coffee-bar','Barista station','coffee_machine',1000,'#d1b899',.020),
 ('rug-ocean','Ocean rug','rug',260,'#5c96a9',.006),('board-glass','Glass planning board','whiteboard',400,'#bee2da',.010)]:
    items.append(furniture(id,name,kind,price,color,bonus))
for n,(name,price,mult,color) in enumerate([('Basic PC',0,1,'#b3bab7'),('Improved PC',300,1.05,'#96c1b3'),('Professional PC',900,1.12,'#79a8cb'),('Workstation PC',2400,1.22,'#b49acb'),('Flagship PC',6000,1.35,'#e4c188')]):
    it=furniture(f'pc-{n}',name,'desk',price,color,category='pc'); it.pop('furnitureType');it['pcMultiplier']=mult;it['description']='Assign to one worker. Their desk displays this computer.';items.append(it)
for provider,color in [('claude','#cf927a'),('codex','#7da998'),('antigravity','#82a8cf'),('openrouter','#ab94ce')]:
    for tier,(price,bonus) in enumerate([(500,.03),(1500,.08),(4000,.15)],1):
        items.append(furniture(f'server-{provider}-{tier}',f'{provider.title()} server · Tier {tier}','server_rack',price,color,bonus,provider=provider,category='server'))
for id,name,price,slot,color in [('headphones','Studio headphones',80,'head','#dfbb83'),('cap','Builder cap',30,'head','#e7bb76'),('beanie','Cozy beanie',20,'head','#b75c6b'),('beret','Artist beret',40,'head','#7b89bc'),('visor','Sun visor',25,'head','#63bba2'),('party_hat','Party hat',20,'head','#7fc0e8'),('crown','Tiny crown',140,'head','#e6c678'),('halo','Halo',150,'head','#e8db9b'),('glasses','Reading glasses',35,'face','#bac4cf'),('sunglasses','Sunglasses',60,'face','#596b86'),('monocle','Monocle',110,'face','#e8ca88'),('tie','Red tie',30,'neck','#c97373'),('bowtie','Bow tie',35,'neck','#9e87be'),('scarf','Autumn scarf',55,'neck','#e5a36d'),('lanyard','Staff lanyard',20,'neck','#73afdb'),('shirt-sage','Sage tee',20,'shirt','#87b7a1'),('shirt-ocean','Ocean tee',35,'shirt','#699dc8'),('shirt-clay','Clay tee',35,'shirt','#c78470'),('shirt-midnight','Midnight tee',60,'shirt','#59627f'),('shirt-gold','Golden tee',150,'shirt','#dbb56d')]:
    art=wearable(slot,color,id)
    items.append(dict(version=1,id=id,name=name,category='accessory',price=price,sprite=id,slot=slot,description='One item for one worker. Provider badge stays visible.',art=[art]*4,footprint=dict(w=1,h=1),collision=[],anchor=dict(x=40,y=40),color=color,attachment=dict(x=0,y={'head':-43,'face':-35,'neck':-23,'shirt':-17}[slot],scale=.25),badgeAnchor=dict(x=0,y=-19),bonus=dict(scope='worker',amount=round(price/10000,4))))
for id,name,price,style in [('shop-floor-wood','Oak flooring',100,'wood'),('shop-floor-marble','Stone flooring',150,'marble'),('shop-floor-carpet','Blue carpet',80,'carpet')]:
    it=furniture(id,name,'rug',price,'#829aa0');it.update(category='floor',sprite=style);it.pop('furnitureType');items.append(it)
for item in items:
    (ROOT / (item['id']+'.json')).write_text(json.dumps(item,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(f'{len(items)} self-contained office definitions generated')
