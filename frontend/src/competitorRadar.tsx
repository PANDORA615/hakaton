import { useMemo, useState } from 'react';
import { Award, Check, ChevronDown, ExternalLink, Plus, Radar, Scale, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';

type Language = 'ru' | 'en';
type Plan = {
  id: string; company: string; name: string; price: number; vcpu: number; ram: number; disk: number;
  diskType: string; traffic: string; speed: number; ddos: boolean; backup: boolean; sla: number;
  support: string; location: string; ipv4Included: boolean; source: string; checkedAt: string;
};

const seed: Plan[] = [
  { id: 'aeza-msk-4', company: 'Aéza', name: 'Cloud 4 · Москва', price: 1590, vcpu: 4, ram: 8, disk: 120, diskType: 'NVMe', traffic: 'Безлимитный', speed: 1000, ddos: true, backup: true, sla: 99.9, support: '24/7', location: 'Москва', ipv4Included: true, source: 'https://aeza.net/', checkedAt: '2026-10-25' },
  { id: 'selectel-cloud-4', company: 'Selectel', name: 'Cloud 4', price: 1890, vcpu: 4, ram: 8, disk: 100, diskType: 'SSD', traffic: '3 ТБ', speed: 500, ddos: true, backup: false, sla: 99.9, support: '24/7', location: 'Москва', ipv4Included: false, source: 'https://selectel.ru/', checkedAt: '2026-10-25' },
  { id: 'timeweb-pro', company: 'Timeweb Cloud', name: 'Cloud Pro', price: 1499, vcpu: 4, ram: 8, disk: 100, diskType: 'NVMe', traffic: 'Безлимитный', speed: 200, ddos: true, backup: false, sla: 99.9, support: '24/7', location: 'Санкт-Петербург', ipv4Included: true, source: 'https://timeweb.cloud/', checkedAt: '2026-10-25' },
  { id: 'reg-cloud-4', company: 'REG.RU', name: 'High CPU 4', price: 2110, vcpu: 4, ram: 8, disk: 100, diskType: 'SSD', traffic: 'Безлимитный', speed: 500, ddos: false, backup: true, sla: 99.5, support: 'Рабочее время', location: 'Москва', ipv4Included: true, source: 'https://www.reg.ru/cloud/', checkedAt: '2026-10-25' },
];

const loadPlans = () => {
  try { const saved = localStorage.getItem('aeza-competitor-plans-v1'); return saved ? JSON.parse(saved) as Plan[] : seed; }
  catch { return seed; }
};
const pct = (value: number) => `${Math.abs(Math.round(value))}%`;

function score(plan: Plan) {
  const price = Math.min(100, 100000 / Math.max(plan.price, 1));
  const capacity = Math.min(100, plan.vcpu * 10 + plan.ram * 4 + plan.disk / 5);
  const reliability = Math.min(100, (plan.sla - 98) * 35 + (plan.ddos ? 18 : 0) + (plan.backup ? 12 : 0));
  const service = (plan.support === '24/7' ? 100 : 55) * .7 + (plan.ipv4Included ? 100 : 40) * .3;
  return Math.round(price * .35 + capacity * .30 + reliability * .20 + service * .10 + 100 * .05);
}

function argumentsFor(base: Plan, rival: Plan, ru: boolean) {
  const advantages: string[] = [], gaps: string[] = [];
  const priceDelta = ((rival.price - base.price) / rival.price) * 100;
  if (priceDelta > 1) advantages.push(ru ? `Aéza дешевле на ${pct(priceDelta)}: экономия ${rival.price - base.price} ₽ в месяц.` : `Aéza is ${pct(priceDelta)} cheaper, saving ₽${rival.price - base.price} per month.`);
  if (priceDelta < -1) gaps.push(ru ? `Конкурент дешевле на ${pct(priceDelta)} — аргументируйте разницу сервисом и оснащением.` : `The competitor is ${pct(priceDelta)} cheaper; justify the gap with service and features.`);
  if (base.disk > rival.disk) advantages.push(ru ? `На ${base.disk - rival.disk} ГБ больше дискового пространства (${base.disk} против ${rival.disk} ГБ).` : `${base.disk - rival.disk} GB more disk space.`);
  if (base.speed > rival.speed) advantages.push(ru ? `Сетевой порт в ${base.speed / rival.speed}× быстрее: ${base.speed} против ${rival.speed} Мбит/с.` : `${base.speed / rival.speed}× faster network port.`);
  if (base.backup && !rival.backup) advantages.push(ru ? 'Резервное копирование уже включено; у конкурента его нужно приобретать отдельно.' : 'Backups are included; the competitor requires a separate option.');
  if (base.ddos && !rival.ddos) advantages.push(ru ? 'Защита от DDoS входит в предложение Aéza.' : 'DDoS protection is included with Aéza.');
  if (base.ipv4Included && !rival.ipv4Included) advantages.push(ru ? 'IPv4 включён в стоимость — без дополнительного ежемесячного платежа.' : 'IPv4 is included with no extra monthly fee.');
  if (base.disk < rival.disk) gaps.push(ru ? `У конкурента на ${rival.disk - base.disk} ГБ больше диска.` : `The competitor offers ${rival.disk - base.disk} GB more disk.`);
  if (base.sla < rival.sla) gaps.push(ru ? `Заявленный SLA конкурента выше на ${(rival.sla - base.sla).toFixed(1)} п.п.` : `The competitor SLA is ${(rival.sla - base.sla).toFixed(1)} pp higher.`);
  if (!advantages.length) advantages.push(ru ? 'По заполненным параметрам явного преимущества пока нет.' : 'No clear advantage from the entered data yet.');
  return { advantages, gaps };
}

export function CompetitorRadar({ language }: { language: Language }) {
  const ru = language === 'ru';
  const [plans, setPlans] = useState<Plan[]>(loadPlans);
  const aezaPlans = plans.filter(item => item.company === 'Aéza');
  const rivals = plans.filter(item => item.company !== 'Aéza');
  const [baseId, setBaseId] = useState(aezaPlans[0]?.id || '');
  const [rivalId, setRivalId] = useState(rivals[0]?.id || '');
  const [formOpen, setFormOpen] = useState(false);
  const base = plans.find(item => item.id === baseId) || aezaPlans[0];
  const rival = plans.find(item => item.id === rivalId) || rivals[0];
  const analysis = useMemo(() => base && rival ? argumentsFor(base, rival, ru) : null, [base, rival, ru]);
  const persist = (next: Plan[]) => { setPlans(next); localStorage.setItem('aeza-competitor-plans-v1', JSON.stringify(next)); };
  const remove = (id: string) => { persist(plans.filter(item => item.id !== id)); if (rivalId === id) setRivalId(rivals.find(item => item.id !== id)?.id || ''); };

  return <div className="radar-page">
    <section className="radar-summary-grid">
      <article className="panel radar-kpi accent"><Radar /><span>{ru ? 'Компаний в радаре' : 'Companies tracked'}</span><strong>{new Set(plans.map(p => p.company)).size}</strong><small>{ru ? `${plans.length} тарифов для сравнения` : `${plans.length} plans available`}</small></article>
      <article className="panel radar-kpi"><Scale /><span>{ru ? 'Критериев' : 'Criteria'}</span><strong>10</strong><small>{ru ? 'Цена, ресурсы, SLA и сервис' : 'Price, resources, SLA and service'}</small></article>
      <article className="panel radar-kpi"><ShieldCheck /><span>{ru ? 'Источники' : 'Sources'}</span><strong>{plans.filter(p => p.source).length}/{plans.length}</strong><small>{ru ? 'Каждый вывод можно проверить' : 'Every claim can be verified'}</small></article>
    </section>

    <section className="panel comparison-builder">
      <div className="panel-heading"><div><h2>{ru ? 'Сравнить предложения' : 'Compare offers'}</h2><p>{ru ? 'Выберите базовый тариф Aéza и предложение конкурента.' : 'Choose an Aéza baseline and a competitor offer.'}</p></div><button className="secondary" onClick={() => setFormOpen(true)}><Plus size={16}/>{ru ? 'Добавить тариф' : 'Add plan'}</button></div>
      <div className="comparison-selectors">
        <label><span>Aéza</span><div className="select-shell"><select value={base?.id || ''} onChange={e => setBaseId(e.target.value)}>{aezaPlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown /></div></label>
        <div className="versus">VS</div>
        <label><span>{ru ? 'Конкурент' : 'Competitor'}</span><div className="select-shell"><select value={rival?.id || ''} onChange={e => setRivalId(e.target.value)}>{rivals.map(p => <option key={p.id} value={p.id}>{p.company} · {p.name}</option>)}</select><ChevronDown /></div></label>
      </div>
      {base && rival && <>
        <div className="plan-heads"><PlanHead plan={base} winner={score(base) >= score(rival)} ru={ru}/><PlanHead plan={rival} winner={score(rival) > score(base)} ru={ru}/></div>
        <div className="comparison-table" role="table">
          {[['vCPU', base.vcpu, rival.vcpu], ['RAM', `${base.ram} ГБ`, `${rival.ram} ГБ`], [ru ? 'Диск' : 'Disk', `${base.disk} ГБ ${base.diskType}`, `${rival.disk} ГБ ${rival.diskType}`], [ru ? 'Сеть' : 'Network', `${base.speed} Мбит/с`, `${rival.speed} Мбит/с`], ['DDoS', base.ddos, rival.ddos], [ru ? 'Бэкапы' : 'Backups', base.backup, rival.backup], ['SLA', `${base.sla}%`, `${rival.sla}%`], ['IPv4', base.ipv4Included, rival.ipv4Included]].map(([label, a, b]) => <div className="comparison-row" role="row" key={String(label)}><strong>{label}</strong><Value value={a}/><Value value={b}/></div>)}
        </div>
      </>}
    </section>

    {analysis && base && rival && <section className="argument-grid">
      <article className="panel argument-card good"><div className="argument-title"><Award/><div><span>{ru ? 'Сильные стороны Aéza' : 'Aéza advantages'}</span><h2>{ru ? 'Аргументы для клиента' : 'Customer talking points'}</h2></div></div>{analysis.advantages.map(item => <p key={item}><Check/>{item}</p>)}</article>
      <article className="panel argument-card watch"><div className="argument-title"><Sparkles/><div><span>{ru ? 'Честное сравнение' : 'Honest comparison'}</span><h2>{ru ? 'Что важно учесть' : 'Important caveats'}</h2></div></div>{analysis.gaps.length ? analysis.gaps.map(item => <p key={item}><Scale/>{item}</p>) : <p><Check/>{ru ? 'По заполненным данным критичных уступок нет.' : 'No critical gaps in the entered data.'}</p>}<div className="evidence-note">{ru ? 'Вывод построен только по заполненным полям. Перед разговором проверьте дату и источник.' : 'Based only on entered fields. Check the date and source before use.'}</div></article>
    </section>}

    <section className="panel radar-register"><div className="panel-heading"><div><h2>{ru ? 'Реестр наблюдений' : 'Observation registry'}</h2><p>{ru ? 'Актуальность и первоисточник каждого предложения.' : 'Freshness and primary source for every offer.'}</p></div></div><div className="radar-plans">{plans.map(plan => <article key={plan.id}><div className="company-mark">{plan.company.slice(0,1)}</div><div><strong>{plan.company}</strong><span>{plan.name} · {plan.price.toLocaleString('ru-RU')} ₽/мес.</span><small>{ru ? 'Проверено' : 'Checked'}: {plan.checkedAt}</small></div>{plan.source && <a href={plan.source} target="_blank" rel="noreferrer" aria-label={ru ? 'Открыть источник' : 'Open source'}><ExternalLink/></a>}{plan.company !== 'Aéza' && <button className="icon-btn" onClick={() => remove(plan.id)} aria-label={ru ? 'Удалить тариф' : 'Delete plan'}><Trash2/></button>}</article>)}</div></section>
    {formOpen && <AddPlan ru={ru} onClose={() => setFormOpen(false)} onSave={plan => { persist([...plans, plan]); setRivalId(plan.id); setFormOpen(false); }}/>} 
  </div>;
}

function PlanHead({ plan, winner, ru }: { plan: Plan; winner: boolean; ru: boolean }) {
  return <article className={winner ? 'winner' : ''}><div><span>{plan.company}</span><h3>{plan.name}</h3></div>{winner && <em><Award/>{ru ? 'Лучшее значение' : 'Best value'}</em>}<strong>{plan.price.toLocaleString('ru-RU')} ₽<small>/{ru ? 'мес.' : 'mo.'}</small></strong><div className="value-score"><i style={{width: `${score(plan)}%`}}/><span>{ru ? 'Индекс ценности' : 'Value score'} {score(plan)}/100</span></div></article>;
}
function Value({ value }: { value: string | number | boolean }) { return <span>{typeof value === 'boolean' ? (value ? <Check className="yes"/> : <X className="no"/>) : value}</span>; }

function AddPlan({ ru, onClose, onSave }: { ru: boolean; onClose: () => void; onSave: (plan: Plan) => void }) {
  const [form, setForm] = useState({ company: '', name: '', price: '1500', vcpu: '4', ram: '8', disk: '100', diskType: 'NVMe', speed: '500', sla: '99.9', location: 'Москва', source: '', ddos: true, backup: false, ipv4Included: true });
  const change = (key: string, value: string | boolean) => setForm(current => ({...current, [key]: value}));
  const submit = (event: React.FormEvent) => { event.preventDefault(); onSave({ id: `plan-${Date.now()}`, company: form.company.trim(), name: form.name.trim(), price: Number(form.price), vcpu: Number(form.vcpu), ram: Number(form.ram), disk: Number(form.disk), diskType: form.diskType, traffic: 'Безлимитный', speed: Number(form.speed), ddos: form.ddos, backup: form.backup, sla: Number(form.sla), support: '24/7', location: form.location, ipv4Included: form.ipv4Included, source: form.source.trim(), checkedAt: new Date().toISOString().slice(0,10) }); };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><form className="panel radar-form" onSubmit={submit}><div className="panel-heading"><div><h2>{ru ? 'Новый тариф' : 'New plan'}</h2><p>{ru ? 'Укажите только проверенные характеристики.' : 'Enter verified specifications only.'}</p></div><button type="button" className="icon-btn" onClick={onClose}><X/></button></div><div className="radar-form-grid">
    {[['company', ru ? 'Компания' : 'Company'], ['name', ru ? 'Название тарифа' : 'Plan name'], ['price', ru ? 'Цена, ₽/мес.' : 'Price, ₽/mo.'], ['vcpu', 'vCPU'], ['ram', 'RAM, ГБ'], ['disk', ru ? 'Диск, ГБ' : 'Disk, GB'], ['speed', ru ? 'Скорость, Мбит/с' : 'Speed, Mbps'], ['sla', 'SLA, %'], ['location', ru ? 'Локация' : 'Location'], ['source', ru ? 'Ссылка на источник' : 'Source URL']].map(([key,label]) => <label key={key}><span>{label}</span><input required={['company','name','price'].includes(key)} type={['price','vcpu','ram','disk','speed','sla'].includes(key) ? 'number' : key === 'source' ? 'url' : 'text'} step={key === 'sla' ? '.1' : '1'} value={(form as any)[key]} onChange={e => change(key, e.target.value)}/></label>)}
  </div><div className="radar-checks">{[['ddos', 'DDoS'], ['backup', ru ? 'Бэкапы' : 'Backups'], ['ipv4Included', 'IPv4']].map(([key,label]) => <label key={key}><input type="checkbox" checked={(form as any)[key]} onChange={e => change(key, e.target.checked)}/><span><Check/>{label}</span></label>)}</div><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>{ru ? 'Отмена' : 'Cancel'}</button><button className="primary"><Plus/>{ru ? 'Добавить и сравнить' : 'Add and compare'}</button></div></form></div>;
}
