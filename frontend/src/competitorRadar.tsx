import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Clock3, ExternalLink, Radar, Scale } from 'lucide-react';
import { api } from './api';

type Language = 'ru' | 'en';
type Plan = { id: string; name: string; price_rub: number; cpu: number; ram_gb: number; disk_gb: number; disk_type: string; cpu_class: string | null; billing: string; location: string | null };
type Provider = { id: string; name: string; source_url: string; fetched_at: string | null; next_refresh_at: string | null; stale: boolean; error: string | null; plans: Plan[] };
type Catalog = { refresh_interval_hours: number; providers: Provider[] };
const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
const date = (value: string | null, ru: boolean) => value ? new Date(value).toLocaleString(ru ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : (ru ? 'нет данных' : 'no data');

function compare(base: Plan, rival: Plan, ru: boolean) {
  const strengths: string[] = [];
  const caveats: string[] = [];
  const delta = rival.price_rub - base.price_rub;
  if (delta > 0) strengths.push(ru ? `На ${rub(delta)} в месяц дешевле по опубликованной цене.` : `${rub(delta)} less per month at the published price.`);
  if (delta < 0) caveats.push(ru ? `Тариф конкурента дешевле на ${rub(-delta)} в месяц.` : `The rival costs ${rub(-delta)} less per month.`);
  if (base.cpu > rival.cpu) strengths.push(ru ? `На ${base.cpu - rival.cpu} vCPU больше (${base.cpu} против ${rival.cpu}).` : `${base.cpu - rival.cpu} more vCPU (${base.cpu} vs ${rival.cpu}).`);
  if (base.cpu < rival.cpu) caveats.push(ru ? `У конкурента на ${rival.cpu - base.cpu} vCPU больше.` : `The rival has ${rival.cpu - base.cpu} more vCPU.`);
  if (base.ram_gb > rival.ram_gb) strengths.push(ru ? `На ${base.ram_gb - rival.ram_gb} ГБ больше RAM.` : `${base.ram_gb - rival.ram_gb} GB more RAM.`);
  if (base.ram_gb < rival.ram_gb) caveats.push(ru ? `У конкурента на ${rival.ram_gb - base.ram_gb} ГБ больше RAM.` : `The rival has ${rival.ram_gb - base.ram_gb} GB more RAM.`);
  if (base.disk_gb > rival.disk_gb) strengths.push(ru ? `На ${base.disk_gb - rival.disk_gb} ГБ больше диска (${base.disk_type} против ${rival.disk_type}).` : `${base.disk_gb - rival.disk_gb} GB more disk (${base.disk_type} vs ${rival.disk_type}).`);
  if (base.disk_gb < rival.disk_gb) caveats.push(ru ? `У конкурента на ${rival.disk_gb - base.disk_gb} ГБ больше диска.` : `The rival has ${rival.disk_gb - base.disk_gb} GB more disk.`);
  if (base.disk_type !== rival.disk_type) caveats.push(ru ? `Типы дисков различаются: ${base.disk_type} и ${rival.disk_type}. Скорость по объёму не определяется.` : `Disk types differ: ${base.disk_type} and ${rival.disk_type}. Capacity does not establish speed.`);
  if (base.cpu_class !== rival.cpu_class) caveats.push(ru ? 'Класс процессора может отличаться. Выделенные и общие vCPU нельзя считать полностью эквивалентными.' : 'CPU class may differ. Dedicated and shared vCPU are not directly equivalent.');
  if (!strengths.length) strengths.push(ru ? 'По проверенным полям преимущества Aéza в этой паре нет.' : 'No Aéza advantage in the verified fields for this pair.');
  return { strengths, caveats };
}

export function CompetitorRadar({ language }: { language: Language }) {
  const ru = language === 'ru';
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [baseId, setBaseId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [rivalId, setRivalId] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => api<Catalog>('/competitors/tariffs').then(data => { if (active) { setCatalog(data); setError(''); } }).catch(e => { if (active) setError(e.message); });
    load();
    const timer = window.setInterval(load, 60 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const aeza = catalog?.providers.find(p => p.id === 'aeza');
  const competitors = catalog?.providers.filter(p => p.id !== 'aeza') || [];
  const company = competitors.find(p => p.id === companyId) || competitors.find(p => p.plans.length) || competitors[0];
  const base = aeza?.plans.find(p => p.id === baseId) || aeza?.plans[0];
  const rival = company?.plans.find(p => p.id === rivalId) || company?.plans[0];
  const analysis = useMemo(() => base && rival ? compare(base, rival, ru) : null, [base, rival, ru]);
  const compared = !!(base && rival);
  return <div className="radar-page">
    <section className="radar-summary-grid">
      <article className="panel radar-kpi accent"><Radar/><span>{ru ? 'Компаний' : 'Providers'}</span><strong>{catalog?.providers.filter(p => p.plans.length).length ?? '—'}</strong><small>{ru ? 'Официальные сайты' : 'Official websites'}</small></article>
      <article className="panel radar-kpi"><Scale/><span>{ru ? 'Тарифов' : 'Plans'}</span><strong>{catalog?.providers.reduce((sum, p) => sum + p.plans.length, 0) ?? '—'}</strong><small>{ru ? 'Цены за месяц в рублях' : 'Monthly RUB prices'}</small></article>
      <article className="panel radar-kpi"><Clock3/><span>{ru ? 'Обновление' : 'Refresh'}</span><strong>72 ч</strong><small>{ru ? 'Автоматически раз в 3 дня' : 'Automatically every 3 days'}</small></article>
    </section>
    {error && <div className="panel radar-status" role="alert">{ru ? 'Не удалось загрузить каталог: ' : 'Could not load catalog: '}{error}</div>}
    {catalog?.providers.some(p => p.stale || p.error) && <div className="panel radar-status" role="status">{ru ? 'Часть источников недоступна или данные старше трёх дней. Смотрите дату проверки рядом с компанией.' : 'Some sources are unavailable or older than three days. Check each provider’s verification date.'}</div>}
    <section className="panel comparison-builder"><div className="panel-heading"><div><h2>{ru ? 'Сравнить реальные тарифы' : 'Compare published plans'}</h2><p>{ru ? 'Сначала тариф Aéza, затем компания и её тариф. Все цифры берутся с сайтов провайдеров.' : 'Choose an Aéza plan, then a provider and plan. Values come from provider websites.'}</p></div></div>
      <div className="radar-picker-grid">
        <div className="radar-picker-side radar-aeza-side"><div className="radar-side-heading"><span>Aéza</span><a href={aeza?.source_url} target="_blank" rel="noreferrer">{ru ? 'Источник' : 'Source'} <ExternalLink size={14}/></a></div><label>{ru ? 'Тариф Aéza' : 'Aéza plan'}<div className="select-shell"><select value={base?.id || ''} onChange={e => setBaseId(e.target.value)}>{aeza?.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown/></div></label><Freshness provider={aeza} ru={ru}/>{base && <PlanCard plan={base} ru={ru}/>}</div>
        <div className="radar-picker-side"><div className="radar-side-heading"><span>{ru ? 'Конкуренты' : 'Competitors'}</span></div><div className="radar-company-tabs" role="group" aria-label={ru ? 'Выбрать компанию' : 'Choose provider'}>{competitors.map(p => <button key={p.id} type="button" className={company?.id === p.id ? 'selected' : ''} onClick={() => { setCompanyId(p.id); setRivalId(''); }}>{p.name}<small>{p.plans.length}</small></button>)}</div>{company && <><label>{ru ? `Тариф ${company.name}` : `${company.name} plan`}<div className="select-shell"><select value={rival?.id || ''} onChange={e => setRivalId(e.target.value)}>{company.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown/></div></label><Freshness provider={company} ru={ru}/>{rival && <PlanCard plan={rival} ru={ru}/>}<small className="radar-freshness">{company.id === 'ruvds' ? (ru ? 'У RUVDS «Старт» действует с ограничениями; смотрите условия на сайте.' : 'RUVDS Start has restrictions; check the provider website.') : ''}</small></>}</div>
      </div>
      {compared && <div className="comparison-table" role="table">{[
        [ru ? 'Цена / месяц' : 'Monthly price', rub(base.price_rub), rub(rival.price_rub)],
        ['vCPU', String(base.cpu), String(rival.cpu)], ['RAM', `${base.ram_gb} GB`, `${rival.ram_gb} GB`],
        [ru ? 'Диск' : 'Disk', `${base.disk_gb} GB ${base.disk_type}`, `${rival.disk_gb} GB ${rival.disk_type}`],
        [ru ? 'Класс CPU' : 'CPU class', base.cpu_class || '—', rival.cpu_class || '—'],
      ].map(([label, a, b]) => <div className="comparison-row" role="row" key={label}><strong>{label}</strong><span>{a}</span><span>{b}</span></div>)}</div>}
    </section>
    {analysis && <section className="argument-grid" key={`${base?.id}-${rival?.id}`}>
      <article className="panel argument-card good"><div className="argument-title"><Check/><div><span>Aéza</span><h2>{ru ? 'Проверенные преимущества' : 'Verified advantages'}</h2></div></div>{analysis.strengths.map(item => <p key={item}><Check/>{item}</p>)}</article>
      <article className="panel argument-card watch"><div className="argument-title"><Scale/><div><span>{ru ? 'Честное сравнение' : 'Fair comparison'}</span><h2>{ru ? 'Ограничения и уступки' : 'Caveats and tradeoffs'}</h2></div></div>{analysis.caveats.length ? analysis.caveats.map(item => <p key={item}><Scale/>{item}</p>) : <p><Check/>{ru ? 'По опубликованным полям явных уступок нет.' : 'No evident tradeoffs in published fields.'}</p>}<div className="evidence-note">{ru ? 'Выводы учитывают только цену, vCPU, RAM и объём диска. SLA, скорость и прочие свойства не оцениваются без подтверждения обоих источников. Цены и акции проверяйте перед покупкой.' : 'Only price, vCPU, RAM and disk capacity are compared. SLA, speed and other attributes require evidence from both sources. Check prices and promotions before purchase.'}</div></article>
    </section>}
    <section className="panel radar-register"><div className="panel-heading"><div><h2>{ru ? 'Источники и актуальность' : 'Sources and freshness'}</h2><p>{ru ? 'Последний успешный снимок сохраняется, даже если сайт провайдера временно недоступен.' : 'Last good snapshot remains available if a provider site is temporarily unavailable.'}</p></div></div><div className="radar-source-list">{catalog?.providers.map(p => <a key={p.id} href={p.source_url} target="_blank" rel="noreferrer"><strong>{p.name}</strong><span>{p.plans.length} {ru ? 'тарифов' : 'plans'} · {ru ? 'Проверено' : 'Checked'}: {date(p.fetched_at, ru)}{p.stale || p.error ? ` · ${ru ? 'нужно обновить' : 'refresh pending'}` : ''}</span><ArrowUpRight size={18}/></a>)}</div></section>
  </div>;
}
function Freshness({ provider, ru }: { provider?: Provider; ru: boolean }) { return <small className={`radar-freshness ${provider?.stale || provider?.error ? 'stale' : ''}`}>{ru ? 'Проверено' : 'Checked'}: {date(provider?.fetched_at || null, ru)}{provider?.stale || provider?.error ? ` · ${ru ? 'ожидает обновления' : 'refresh pending'}` : ''}</small>; }
function PlanCard({ plan, ru }: { plan: Plan; ru: boolean }) { return <div className="radar-selected-plan" key={plan.id}><div><strong>{plan.name}</strong><span>{rub(plan.price_rub)}<small> / {ru ? 'мес.' : 'mo.'}</small></span></div><p>{plan.cpu} vCPU · {plan.ram_gb} GB RAM · {plan.disk_gb} GB {plan.disk_type}</p></div>; }
